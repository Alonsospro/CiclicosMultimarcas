const fs = require('fs');
const path = require('path');
const config = require('../config');

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
    this.ensureDirs();
  }

  normalizeKey(p) {
    if (!p) return '';
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  clearMemory() {
    this.memoryStore.clear();
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
      this.getAuditDirectory()
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
    if (this.memoryStore.has(key)) {
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

    // 1b. Fallback files from initialDataDir if running in Vercel
    if (this.initialDataDir && dirPath.startsWith(this.baseDir)) {
      try {
        const relative = path.relative(this.baseDir, dirPath);
        const fallbackDir = path.join(this.initialDataDir, relative);
        if (fs.existsSync(fallbackDir)) {
          const fallbackFiles = fs.readdirSync(fallbackDir);
          fallbackFiles.forEach(f => {
            if (!fileMap.has(f.toLowerCase())) {
              fileMap.set(f.toLowerCase(), f);
            }
          });
        }
      } catch (e) {}
    }

    // 2. Files from memory listings
    if (this.dirListings.has(dirKey)) {
      this.dirListings.get(dirKey).forEach(f => {
        fileMap.set(f.toLowerCase(), f);
      });
    }

    return Array.from(fileMap.values());
  }

  deleteFile(filePath) {
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
    return true;
  }
}

const storagePathInstance = new StoragePath();
module.exports = storagePathInstance;
