const fs = require('fs');
const path = require('path');
const config = require('../config');
const firebaseSyncService = require('./firebaseSyncService');
const { AsyncLocalStorage } = require('async_hooks');
const { createHash, randomUUID } = require('crypto');
const PersistenceError = require('./persistenceError');

class StoragePath {
  constructor() {
    this.initialDataDir = config.baseDataDir;
    // On Vercel serverless or when baseDataDir is read-only, use writable /tmp directory
    if (process.env.VERCEL) {
      this.baseDir = path.join('/tmp', 'nibol_data');
    } else {
      let isWritable = false;
      try {
        if (!fs.existsSync(config.baseDataDir)) {
          fs.mkdirSync(config.baseDataDir, { recursive: true });
        }
        const testPath = path.join(config.baseDataDir, '.test_write_' + Date.now());
        fs.writeFileSync(testPath, 'ok', 'utf8');
        fs.unlinkSync(testPath);
        isWritable = true;
      } catch (err) {
        isWritable = false;
      }
      this.baseDir = isWritable ? config.baseDataDir : path.join('/tmp', 'nibol_data');
    }
    this.memoryStore = new Map();
    this.cacheTimestamps = new Map(); // Track when each entry was cached
    this.dirListings = new Map();
    this.CACHE_TTL_MS = 60 * 1000; // 60 seconds refresh window
    this.operationContext = new AsyncLocalStorage();
    this.operationTails = new Map();
    this.knownMissing = new Set();
    this.ensureDirs();
  }

  normalizeKey(p) {
    if (!p) return '';
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  clearMemory() {
    this.memoryStore.clear();
    this.cacheTimestamps.clear();
    this.dirListings.clear();
  }

  ensureDirs() {
    const dirs = [
      this.baseDir,
      this.getDataDirectory(),
      this.getPhotosDirectory(),
      this.getReferencePhotosDirectory(),
      this.getInventoriesDirectory(),
      this.getJustificationsDirectory(),
      this.getHistoryDirectory(),
      this.getAuditDirectory(),
      this.getTrashDirectory()
    ];

    dirs.forEach(dir => {
      if (dir && typeof dir === 'string' && !dir.startsWith('http://') && !dir.startsWith('https://')) {
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        } catch (err) {
          // Graceful handling
        }
      }
    });

    // Copy packaged initial users and seed files from read-only package to baseDir if different
    if (this.baseDir !== this.initialDataDir && this.initialDataDir && fs.existsSync(this.initialDataDir)) {
      try {
        const copySeedDir = (src, dest) => {
          if (!fs.existsSync(src)) return;
          if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
          const entries = fs.readdirSync(src, { withFileTypes: true });
          for (const entry of entries) {
            // NEVER copy residual inventories or justifications from initialDataDir
            if (entry.name === 'inventories' || entry.name === 'justifications') continue;
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              copySeedDir(srcPath, destPath);
            } else if (!fs.existsSync(destPath)) {
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        copySeedDir(this.initialDataDir, this.baseDir);
      } catch (e) {
        console.warn('[storagePath] Seed copy notice:', e.message);
      }
    }
  }

  resolveFilePath(relPath) {
    if (!relPath) return this.baseDir;
    return path.resolve(this.baseDir, relPath);
  }

  getRelativePath(filePath) {
    if (!filePath) return '';
    const normalized = path.resolve(filePath);
    if (normalized.startsWith(this.baseDir)) {
      return path.relative(this.baseDir, normalized).replace(/\\/g, '/');
    }
    const idx = normalized.indexOf('/data/');
    if (idx !== -1) {
      return normalized.substring(idx + 6).replace(/\\/g, '/');
    }
    return path.basename(filePath);
  }

  getDataDirectory() {
    return this.baseDir;
  }

  getPhotosDirectory() {
    return path.join(this.baseDir, 'photos');
  }

  getReferencePhotosDirectory() {
    if (process.env.VERCEL) {
      return path.join(this.baseDir, 'fotosreferencias');
    }
    const configured = config.referencePhotosDir;
    if (configured && typeof configured === 'string' && !configured.startsWith('http://') && !configured.startsWith('https://')) {
      return configured;
    }
    return path.join(this.baseDir, 'fotosreferencias');
  }

  getInventoriesDirectory() {
    return path.join(this.baseDir, 'inventories');
  }

  getJustificationsDirectory() {
    return path.join(this.baseDir, 'justifications');
  }

  getHistoryDirectory() {
    return path.join(this.baseDir, 'history');
  }

  getAuditDirectory() {
    return path.join(this.baseDir, 'audit');
  }

  getTrashDirectory() {
    return path.join(this.baseDir, 'trash');
  }

  getUsersFilePath() {
    const tmpPath = path.join(this.baseDir, 'users.json');
    if (fs.existsSync(tmpPath)) return tmpPath;
    if (this.initialDataDir) {
      const initPath = path.join(this.initialDataDir, 'users.json');
      if (fs.existsSync(initPath)) return initPath;
    }
    return tmpPath;
  }

  readJson(filePath, defaultValue = null) {
    const key = this.normalizeKey(filePath);
    const ctx = this.operationContext.getStore();
    if (ctx) {
      const rel = this.getRelativePath(filePath);
      if (!ctx.expected.has(rel)) ctx.expected.set(rel, firebaseSyncService.records.get(rel));
      if (ctx.changes.has(rel)) return this.clone(ctx.changes.get(rel).data ?? defaultValue);
    }
    if (this.knownMissing.has(key)) return this.clone(defaultValue);
    // Once cloud recovery succeeds, operational files in the deployment package
    // are never used to resurrect deleted or unconfirmed inventories.
    if (firebaseSyncService.loaded && this.isOperational(filePath) && !firebaseSyncService.records.has(this.getRelativePath(filePath))) return this.clone(defaultValue);
    if (this.memoryStore.has(key)) {
      if (this.isOperational(filePath) && firebaseSyncService.loaded) return this.clone(this.memoryStore.get(key));
      const cachedAt = this.cacheTimestamps.get(key) || 0;
      if (Date.now() - cachedAt < this.CACHE_TTL_MS) {
        return JSON.parse(JSON.stringify(this.memoryStore.get(key)));
      }
      // If TTL expired, try to refresh from disk if a newer file exists
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          this.memoryStore.set(key, parsed);
          this.cacheTimestamps.set(key, Date.now());
          return JSON.parse(JSON.stringify(parsed));
        }
      } catch (e) {
        // Disk read failed, retain memory copy safely
      }
      // CRITICAL FIX: NEVER delete from memoryStore if disk file doesn't exist!
      // In serverless / ephemeral containers, memoryStore is the source of truth if disk is unavailable.
      this.cacheTimestamps.set(key, Date.now());
      return JSON.parse(JSON.stringify(this.memoryStore.get(key)));
    }
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.memoryStore.set(key, parsed);
        this.cacheTimestamps.set(key, Date.now());
        return JSON.parse(JSON.stringify(parsed));
      }
      // Fallback check in initialDataDir if running in Vercel
      if (this.initialDataDir && filePath.startsWith(this.baseDir)) {
        const relative = path.relative(this.baseDir, filePath);
        const fallbackPath = path.join(this.initialDataDir, relative);
        if (fs.existsSync(fallbackPath)) {
          const raw = fs.readFileSync(fallbackPath, 'utf8');
          const parsed = JSON.parse(raw);
          this.memoryStore.set(key, parsed);
          this.cacheTimestamps.set(key, Date.now());
          return JSON.parse(JSON.stringify(parsed));
        }
      }
    } catch (err) {
      console.warn(`[storagePath] Note reading JSON from ${filePath}:`, err.message);
    }
    return defaultValue;
  }

  writeJson(filePath, data) {
    const ctx = this.operationContext.getStore();
    if (ctx) {
      const rel = this.getRelativePath(filePath);
      if (!ctx.expected.has(rel)) ctx.expected.set(rel, firebaseSyncService.records.get(rel));
      ctx.changes.set(rel, { filePath, data: this.clone(data) });
      return true;
    }
    const key = this.normalizeKey(filePath);
    const cloned = JSON.parse(JSON.stringify(data));
    this.memoryStore.set(key, cloned);
    this.cacheTimestamps.set(key, Date.now());

    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const dirKey = this.normalizeKey(dir);
    if (!this.dirListings.has(dirKey)) {
      this.dirListings.set(dirKey, new Set());
    }

    const set = this.dirListings.get(dirKey);
    const targetLower = fileName.toLowerCase();
    for (const item of set) {
      if (item.toLowerCase() === targetLower) {
        set.delete(item);
      }
    }
    set.add(fileName);

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(cloned, null, 2), 'utf8');
    } catch (err) {
      // In read-only cloud/serverless environments, file is safely cached in memory
    }
    
    // Async Firebase persistence using relative canonical keys
    const relPath = this.getRelativePath(filePath);
    const relDir = path.dirname(relPath).replace(/\\/g, '/');
    firebaseSyncService.syncToFirestore(relPath, relDir, fileName, cloned).catch(err => console.error('[storagePath] Persistencia pendiente:', err.code || err.message));
    
    return true;
  }

  listFiles(dirPath) {
    const dirKey = this.normalizeKey(dirPath);
    const fileMap = new Map();

    // 1. Files from disk (case-preserving, deduplicated)
    try {
      if (fs.existsSync(dirPath)) {
        const diskFiles = fs.readdirSync(dirPath);
        diskFiles.forEach(f => {
          fileMap.set(f.toLowerCase(), f);
        });
      }
    } catch (e) {}

    // 1b. Fallback files from initialDataDir if running in Vercel (excluding inventories & justifications)
    if (this.initialDataDir && dirPath.startsWith(this.baseDir)) {
      try {
        const relative = path.relative(this.baseDir, dirPath);
        if (!relative.startsWith('inventories') && !relative.startsWith('justifications')) {
          const fallbackDir = path.join(this.initialDataDir, relative);
          if (fs.existsSync(fallbackDir)) {
            const fallbackFiles = fs.readdirSync(fallbackDir);
            fallbackFiles.forEach(f => {
              if (!fileMap.has(f.toLowerCase())) {
                fileMap.set(f.toLowerCase(), f);
              }
            });
          }
        }
      } catch (e) {}
    }

    // 2. Files from memory listings
    if (this.dirListings.has(dirKey)) {
      this.dirListings.get(dirKey).forEach(f => {
        fileMap.set(f.toLowerCase(), f);
      });
    }

    if (firebaseSyncService.loaded && this.isOperational(path.join(dirPath, '_'))) {
      fileMap.clear();
      for (const rel of firebaseSyncService.records.keys()) {
        if (this.normalizeKey(path.dirname(this.resolveFilePath(rel))) === dirKey) fileMap.set(path.basename(rel).toLowerCase(), path.basename(rel));
      }
    }
    const ctx = this.operationContext.getStore();
    if (ctx) for (const { filePath, data } of ctx.changes.values()) {
      if (this.normalizeKey(path.dirname(filePath)) === dirKey) {
        if (data === null) fileMap.delete(path.basename(filePath).toLowerCase());
        else fileMap.set(path.basename(filePath).toLowerCase(), path.basename(filePath));
      }
    }
    return Array.from(fileMap.values());
  }

  deleteFile(filePath) {
    const ctx = this.operationContext.getStore();
    if (ctx) {
      const rel = this.getRelativePath(filePath);
      if (!ctx.expected.has(rel)) ctx.expected.set(rel, firebaseSyncService.records.get(rel));
      ctx.changes.set(rel, { filePath, data: null });
      return true;
    }
    const key = this.normalizeKey(filePath);
    this.memoryStore.delete(key);
    this.cacheTimestamps.delete(key);

    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const dirKey = this.normalizeKey(dir);
    if (this.dirListings.has(dirKey)) {
      const set = this.dirListings.get(dirKey);
      const targetLower = fileName.toLowerCase();
      for (const item of set) {
        if (item.toLowerCase() === targetLower) {
          set.delete(item);
        }
      }
    }

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {}
    
    // Async Firebase deletion using relative and fallback paths
    const relPath = this.getRelativePath(filePath);
    firebaseSyncService.deleteFromFirestore(relPath, filePath).catch(err => console.error('[storagePath] Eliminación pendiente:', err.code || err.message));
    
    return true;
  }

  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  isOperational(filePath) {
    return /^(inventories|justifications|history|audit|trash|sync)\//.test(this.getRelativePath(filePath));
  }

  cacheConfirmed(filePath, data) {
    const key = this.normalizeKey(filePath);
    if (data === null) {
      this.memoryStore.delete(key);
      this.knownMissing.add(key);
      return;
    }
    this.knownMissing.delete(key);
    this.memoryStore.set(key, this.clone(data));
    this.cacheTimestamps.set(key, Date.now());
    const dir = path.dirname(filePath);
    const dirKey = this.normalizeKey(dir);
    if (!this.dirListings.has(dirKey)) this.dirListings.set(dirKey, new Set());
    this.dirListings.get(dirKey).add(path.basename(filePath));
    // Disk is only a cache. Atomic replacement avoids half-written JSON files.
    const temp = filePath + '.' + randomUUID() + '.tmp';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(data), 'utf8');
      fs.renameSync(temp, filePath);
    } catch (_) {
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
    }
  }

  async ensureReady() {
    if (firebaseSyncService.loaded) return;
    if (!this.initializing) this.initializing = firebaseSyncService.hydrateMemoryStore(this.memoryStore, this.cacheTimestamps, this.dirListings, this)
      .finally(() => { this.initializing = null; });
    return this.initializing;
  }

  queuePath(scope) { return `sync/${createHash('sha256').update(String(scope)).digest('hex')}.json`; }

  deferSync(method, args) {
    const ctx = this.operationContext.getStore();
    if (!ctx) return false;
    ctx.effects.push({ method, args: this.clone(args), id: `${ctx.operationId}-${ctx.effects.length}` });
    return true;
  }

  async runDurable(callback, { scope = 'global', operationId = randomUUID(), fingerprint = '', requireSynced = false } = {}) {
    if (this.operationContext.getStore()) return callback();
    const execute = async () => {
      await this.ensureReady();
      const queueRel = this.queuePath(scope);
      const paths = [queueRel];
      if (scope !== 'global') paths.push(`inventories/${scope}.json`);
      await firebaseSyncService.refresh(paths, this);
      if (requireSynced) {
        const pending = this.readJson(this.resolveFilePath(queueRel), null);
        if (pending?.jobs.length && await this.drainSync(scope)) {
          throw new PersistenceError('Hay cambios guardados pendientes de sincronizar con Sheets. Reintente al terminar la sincronización.', 'SHEETS_PENDING');
        }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const queueFile = this.resolveFilePath(queueRel);
        const queue = this.readJson(queueFile, { scope, jobs: [], receipts: [] });
        const queueExpected = firebaseSyncService.records.get(queueRel);
        const receipt = queue.receipts.find(r => r.id === operationId);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new PersistenceError('El identificador de operación ya se usó con otros datos.', 'OPERATION_MISMATCH', 409);
          const result = this.clone(receipt.result);
          if (result?.item) {
            const current = this.readJson(this.resolveFilePath(`inventories/${scope}.json`), null);
            result.item = current?.items?.find(item => item.id === result.item.id) || result.item;
          }
          return Array.isArray(result) ? result : { ...result, duplicate: true, syncPending: queue.jobs.length > 0 };
        }
        const ctx = { changes: new Map(), expected: new Map(), effects: [], operationId };
        const result = await this.operationContext.run(ctx, callback);
        queue.jobs.push(...ctx.effects);
        const receiptResult = result?.item ? { ...result, item: { id: result.item.id } } : result;
        queue.receipts.push({ id: operationId, fingerprint, result: this.clone(receiptResult) });
        // Count receipts are small; large create/close results are not duplicated.
        queue.receipts = queue.receipts.slice(-128).map(r => ({ ...r, result: JSON.stringify(r.result || {}).length > 12000 ? { success: true, duplicate: true } : r.result }));
        while (queue.receipts.length > 1 && Buffer.byteLength(JSON.stringify(queue.receipts)) > 200000) queue.receipts.shift();
        if (ctx.effects.length || fingerprint) {
          ctx.changes.set(queueRel, { filePath: queueFile, data: queue });
          ctx.expected.set(queueRel, queueExpected);
        }
        const changes = [...ctx.changes].map(([rel, change]) => ({ rel, data: change.data, expected: ctx.expected.get(rel) }));
        try {
          await firebaseSyncService.commit(changes);
        } catch (err) {
          if (err.status === 409 && attempt < 2) {
            await firebaseSyncService.refresh([...new Set([...ctx.expected.keys(), ...paths])], this);
            continue;
          }
          throw err;
        }
        for (const change of ctx.changes.values()) this.cacheConfirmed(change.filePath, change.data);
        let pending = queue.jobs.length > 0;
        if (pending) pending = await this.drainSync(scope).catch(() => true);
        return result && typeof result === 'object' && !Array.isArray(result) ? { ...result, syncPending: pending } : result;
      }
    };
    const tail = this.operationTails.get(scope) || Promise.resolve();
    const pending = tail.then(execute, execute);
    const settled = pending.catch(() => {});
    this.operationTails.set(scope, settled);
    settled.finally(() => { if (this.operationTails.get(scope) === settled) this.operationTails.delete(scope); });
    return pending;
  }

  async drainSync(scope) {
    const rel = this.queuePath(scope);
    const file = this.resolveFilePath(rel);
    await firebaseSyncService.refresh([rel], this);
    let queue = this.readJson(file, null);
    if (!queue?.jobs.length) return false;
    if (queue.leaseUntil > Date.now()) return true;
    const owner = randomUUID();
    queue.leaseOwner = owner;
    // Longer than the Apps Script execution limit, so a lost response cannot
    // let a second worker overtake a script still running in Google.
    queue.leaseUntil = Date.now() + 7 * 60 * 1000;
    await firebaseSyncService.commit([{ rel, data: queue, expected: firebaseSyncService.records.get(rel) }]);
    this.cacheConfirmed(file, queue);
    const job = queue.jobs[0];
    let succeeded = false;
    let failure = null;
    let deliveryUnknown = true;
    try {
      const gas = require('./gasService');
      const args = this.clone(job.args);
      if (args[1] && typeof args[1] === 'object') args[1].operationId = job.id;
      const result = await gas[job.method](...args);
      if (!result || result.success !== true) throw new Error(result?.error || result?.message || 'Sheets no confirmó la operación');
      succeeded = true;
    } catch (err) { failure = err.message; deliveryUnknown = err.deliveryUnknown !== false; }
    // A new count may have appended to this queue in another process.
    for (let attempt = 0; attempt < 3; attempt++) {
      await firebaseSyncService.refresh([rel], this);
      queue = this.readJson(file, null);
      if (!queue || queue.leaseOwner !== owner) return true;
      if (succeeded) queue.jobs = queue.jobs.filter(entry => entry.id !== job.id);
      queue.lastError = failure;
      // Keep the lease on ambiguous network failures; the script may still run.
      if (succeeded || !deliveryUnknown) queue.leaseUntil = 0;
      try {
        await firebaseSyncService.commit([{ rel, data: queue, expected: firebaseSyncService.records.get(rel) }]);
        this.cacheConfirmed(file, queue);
        return queue.jobs.length > 0;
      } catch (err) { if (err.status !== 409 || attempt === 2) throw err; }
    }
    return true;
  }

  async refreshInventory(id) {
    if (this.operationContext.getStore()) return;
    await this.ensureReady();
    await firebaseSyncService.refresh([`inventories/${id}.json`], this);
  }

  async refreshOperational() {
    if (this.operationContext.getStore()) return;
    await this.ensureReady();
    if (Date.now() - (this.lastOperationalRefresh || 0) < 10000) return;
    const records = await firebaseSyncService.queryPaths();
    for (const [rel, record] of records) if (this.isOperational(this.resolveFilePath(rel))) {
      this.cacheConfirmed(this.resolveFilePath(rel), firebaseSyncService.decode(record));
    }
    this.lastOperationalRefresh = Date.now();
  }

  async resumeSync() {
    await this.ensureReady();
    const scopes = [];
    for (const [rel, record] of firebaseSyncService.records) {
      if (!rel.startsWith('sync/')) continue;
      const queue = firebaseSyncService.decode(record);
      if (queue?.jobs?.length) scopes.push(queue.scope);
    }
    // A few centres per pass; each has a durable lease, so multiple instances
    // cannot drain the same queue concurrently.
    const offset = (this.syncOffset || 0) % Math.max(1, scopes.length);
    const rotated = scopes.slice(offset).concat(scopes.slice(0, offset));
    this.syncOffset = offset + 4;
    await Promise.allSettled(rotated.slice(0, 4).map(scope => this.drainSync(scope)));
  }

  async clearAllData(keepUsers = true) {
    this.memoryStore.clear();
    this.cacheTimestamps.clear();
    this.dirListings.clear();

    let usersData = null;
    const usersPath = this.getUsersFilePath();
    try {
      if (fs.existsSync(usersPath)) {
        usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      }
    } catch (_) {}

    await firebaseSyncService.clearAllInFirestore(keepUsers);

    const targetDirs = [
      this.getInventoriesDirectory(),
      this.getHistoryDirectory(),
      this.getAuditDirectory(),
      this.getJustificationsDirectory(),
      this.getPhotosDirectory(),
      this.getTrashDirectory()
    ];

    targetDirs.forEach(dir => {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach(f => {
            try {
              const full = path.join(dir, f);
              if (fs.statSync(full).isFile()) {
                fs.unlinkSync(full);
              }
            } catch (_) {}
          });
        }
      } catch (_) {}
    });

    this.ensureDirs();

    if (keepUsers && usersData) {
      this.writeJson(usersPath, usersData);
    }
    return true;
  }
}

const storagePathInstance = new StoragePath();
module.exports = storagePathInstance;
