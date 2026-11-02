const path = require('path');

const CONTROL_TTL_MS = 10000;
const PROTECT_CONTROL_TTL_MS = 60000;
const PROTECT_STALE_MS = 15 * 60000;
const RECONCILE_MS = 6 * 60 * 60000;
const MAX_INCREMENTAL_REVISIONS = 25;
const sameState = (a, b) => !!a && !!b && a.generation === b.generation && a.revision === b.revision;

class CloudFileStore {
  constructor(adapter, secret, options = {}) {
    this.adapter = adapter;
    this.secret = secret;
    this.state = null;
    this.pending = new Map();
    this.files = new Map();
    this.deferWrites = true;
    this.background = null;
    this.flushing = null;
    this.usage = options.usage || null;
    this.controlTtlMs = options.controlTtlMs ?? CONTROL_TTL_MS;
    this.now = options.now || (() => Date.now());
    // Confirmed data for read-only requests. These Maps are replaced, never changed in place,
    // because a running request can keep using the one it received.
    this.readCache = null;
    this.sharedControl = null;
    this.controlPending = null;
    this.snapshotPending = null;
    this.incrementalFailureLogged = false;
  }

  stateOf(data) {
    return { generation: Number(data.syncGeneration || 0), revision: Number(data.syncRevision || 0) };
  }

  // Control fields of a commit. Revisions after syncIncrementalFrom are guaranteed to be stamped
  // on their documents; a write from an older deployment breaks the chain and forces a full read.
  static nextControlFields(current, expected, generation) {
    const revision = expected.revision + 1;
    const chained = Number(current.syncStampedRevision) === expected.revision && Number.isFinite(Number(current.syncIncrementalFrom));
    return {
      syncGeneration: generation,
      syncRevision: revision,
      syncStampedRevision: revision,
      syncIncrementalFrom: chained ? Number(current.syncIncrementalFrom) : expected.revision
    };
  }

  controlOf(data) {
    return {
      state: this.stateOf(data),
      stampedRevision: Number(data.syncStampedRevision),
      incrementalFrom: Number(data.syncIncrementalFrom),
      at: this.now()
    };
  }

  async readFreshControl() {
    const control = this.controlOf(await this.adapter.readControl());
    this.sharedControl = control;
    return control;
  }

  isProtecting() { return this.usage?.level() === 'protect'; }

  // At most one control read per window for all read-only requests of this instance.
  async readSharedControl() {
    const ttl = this.isProtecting() ? Math.max(this.controlTtlMs, PROTECT_CONTROL_TTL_MS) : this.controlTtlMs;
    if (this.sharedControl && this.now() - this.sharedControl.at < ttl) return this.sharedControl;
    if (!this.controlPending) {
      this.controlPending = this.readFreshControl().finally(() => { this.controlPending = null; });
    }
    return this.controlPending;
  }

  canReadIncrementally(base, control) {
    if (!base || typeof this.adapter.readRevision !== 'function') return false;
    const gap = control.state.revision - base.state.revision;
    return base.state.generation === control.state.generation
      && gap > 0 && gap <= MAX_INCREMENTAL_REVISIONS
      && control.stampedRevision === control.state.revision
      && Number.isFinite(control.incrementalFrom)
      && base.state.revision >= control.incrementalFrom;
  }

  applyChanges(baseFiles, documents, state) {
    const files = new Map(baseFiles);
    for (const document of documents) {
      const data = document.data;
      if (!data.path) continue;
      const relative = this._getCanonicalRelPath(data.path);
      if (!this.isManaged(relative)) continue;
      if (relative !== 'users.json' && Number(data.generation || 0) !== state.generation) continue;
      if (data.deleted) { files.delete(relative); continue; }
      if (data.content) files.set(relative, { value: JSON.parse(data.content), id: document.id });
    }
    return files;
  }

  async readIncremental(base, before) {
    try {
      const revisions = Array.from({ length: before.state.revision - base.state.revision }, (_, index) => base.state.revision + index + 1);
      const changes = await Promise.all(revisions.map(revision => this.adapter.readRevision(revision)));
      const after = await this.readFreshControl();
      if (!sameState(before.state, after.state)) return { moved: true };
      const at = this.now();
      return { snapshot: { state: after.state, files: this.applyChanges(base.files, changes.flat(), after.state), fullAt: base.fullAt, loadedAt: at } };
    } catch (error) {
      if (!this.incrementalFailureLogged) {
        this.incrementalFailureLogged = true;
        console.error('[firebaseSync] Incremental read unavailable; using a full read:', error.code || error.message);
      }
      return {};
    }
  }

  // Stable confirmed data at one revision: only changed documents when that is provably
  // complete, otherwise the whole collection.
  async loadConfirmed(base, control = null) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = attempt === 0 && control && this.now() - control.at <= 1000 ? control : await this.readFreshControl();
      if (base && sameState(base.state, before.state)) return base;
      if (this.canReadIncrementally(base, before)) {
        const incremental = await this.readIncremental(base, before);
        if (incremental.moved) continue;
        if (incremental.snapshot) return incremental.snapshot;
      }
      const documents = await this.adapter.readAll();
      const after = await this.readFreshControl();
      if (!sameState(before.state, after.state)) continue;
      const at = this.now();
      return { state: after.state, files: this.buildFiles(documents, after.state), fullAt: at, loadedAt: at, documents };
    }
    throw this.conflict();
  }

  publishSnapshot({ state, files, fullAt, loadedAt, documents }) {
    // A full read may replace a higher revision only after an external restoration of the control.
    if (!this.readCache || documents || state.revision >= this.readCache.state.revision) {
      this.readCache = { state, files, fullAt, loadedAt };
    }
  }

  publishWriterState() {
    const at = this.now();
    this.readCache = { state: this.state, files: this.files, fullAt: this.readCache?.fullAt ?? at, loadedAt: at };
    this.sharedControl = null;
  }

  buildFiles(documents, state) {
    const files = new Map();
    const deletedPaths = new Set(documents.filter(document => document.data.deleted && Number(document.data.generation || 0) === state.generation).map(document => this._getCanonicalRelPath(document.data.path)));
    for (const document of documents) {
      const data = document.data;
      if (!data.path || !data.content) continue;
      const relative = this._getCanonicalRelPath(data.path);
      if (!this.isManaged(relative) || deletedPaths.has(relative)) continue;
      if (relative !== 'users.json' && Number(data.generation || 0) !== state.generation) continue;
      // Prefer canonical documents over historical absolute-path duplicates.
      const existing = files.get(relative);
      if (!existing || document.id === this._getSafeId(relative, state.generation)) {
        files.set(relative, { value: JSON.parse(data.content), id: document.id });
      }
    }
    return files;
  }

  _getCanonicalRelPath(raw) {
    const normalized = String(raw || '').replace(/\\/g, '/');
    const index = normalized.indexOf('/data/');
    const relative = (index >= 0 ? normalized.slice(index + 6) : normalized).replace(/^\/+/, '');
    if (!relative || relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error('Ruta de datos inválida');
    return relative;
  }

  _getSafeId(relative, generation = this.state?.generation || 0) {
    const encoded = Buffer.from(relative).toString('base64url');
    return relative === 'users.json' || generation === 0 ? encoded : `g${generation}_${encoded}`;
  }

  isManaged(relative) {
    return relative.endsWith('.json') && !relative.startsWith('backups/') && !relative.startsWith('sync/');
  }

  async refresh(force = false) {
    const control = await this.readFreshControl();
    if (!force && this.state && sameState(control.state, this.state)) return false;
    if (this.pending.size) throw this.conflict();
    const snapshot = await this.loadConfirmed(force ? null : this.readCache, control);
    this.files = snapshot.files;
    this.state = snapshot.state;
    this.publishSnapshot(snapshot);
    const retired = (snapshot.documents || []).filter(document => document.data.path && this._getCanonicalRelPath(document.data.path) !== 'users.json' && Number(document.data.generation || 0) < snapshot.state.generation);
    if (retired.length) {
      try { await this.adapter.removeOld(retired.map(document => document.id)); }
      catch (error) { console.error('[firebaseSync] Retired file cleanup pending:', error.code || error.message); }
    }
    return true;
  }

  // Read a stable, confirmed snapshot without touching the writer state or waiting behind a
  // pending write. Another instance's change can take up to one control window to appear;
  // minRevision guarantees that a client sees the revision of its own confirmed writes.
  async readConfirmedSnapshot({ minRevision = 0 } = {}) {
    let control = await this.readSharedControl();
    if (control.state.revision < minRevision) control = await this.readFreshControl();
    const cache = this.readCache;
    const protecting = this.isProtecting();
    const reconcile = !!cache && !protecting && this.now() - cache.fullAt >= RECONCILE_MS;
    if (cache && !reconcile && cache.state.revision >= control.state.revision) return cache;
    if (cache && protecting && cache.state.revision >= minRevision && this.now() - cache.loadedAt < PROTECT_STALE_MS && !this.canReadIncrementally(cache, control)) return cache;
    if (!this.snapshotPending) {
      this.snapshotPending = this.loadConfirmed(reconcile ? null : cache, control)
        .then(snapshot => { this.publishSnapshot(snapshot); return snapshot; })
        .finally(() => { this.snapshotPending = null; });
    }
    let snapshot = await this.snapshotPending;
    // A load that began before this client's write can finish below its revision.
    if (snapshot.state.revision < minRevision && control.state.revision >= minRevision) {
      snapshot = await this.loadConfirmed(snapshot);
      this.publishSnapshot(snapshot);
    }
    return { state: snapshot.state, files: snapshot.files };
  }

  conflict() {
    return Object.assign(new Error('Los datos cambiaron en otra sesión. Actualiza la vista y vuelve a intentar.'), { status: 409, code: 'STALE_DATA' });
  }

  syncToFirestore(raw, dir, name, value) {
    const relative = this._getCanonicalRelPath(raw);
    if (!this.isManaged(relative)) return;
    if (!this.state) throw Object.assign(new Error('La conexión con Firestore todavía no está preparada.'), { status: 503 });
    const content = JSON.stringify(value);
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > 900000) {
      const isInv = relative.startsWith('inventories/');
      const msg = isInv
        ? 'El inventario excede el tamaño admitido para un documento. Divide el inventario antes de guardarlo.'
        : `El archivo ${relative} excede el tamaño admitido para un documento de Firestore (${Math.round(byteLength / 1024)} KB > 900 KB).`;
      throw Object.assign(new Error(msg), { status: 413 });
    }
    this.pending.set(relative, { type: 'set', relative, content });
    this.scheduleBackground();
  }

  deleteFromFirestore(raw) {
    const relative = this._getCanonicalRelPath(raw);
    if (!this.isManaged(relative)) return;
    this.pending.set(relative, { type: 'delete', relative });
    this.scheduleBackground();
  }

  scheduleBackground() {
    if (this.deferWrites || this.background) return;
    this.background = setTimeout(() => {
      this.background = null;
      this.flush().catch(error => {
        this.pending.clear();
        this.state = null;
        console.error('[firebaseSync] Background persistence failed:', error.code || error.message);
      });
    }, 0);
  }

  async flush() {
    if (this.flushing) await this.flushing;
    if (!this.pending.size) return;
    this.flushing = this.commitPending();
    try { await this.flushing; } finally { this.flushing = null; }
  }

  async commitPending() {
    if (!this.pending.size) return;
    if (!this.state) throw this.conflict();
    const expected = { ...this.state };
    const operations = [...this.pending.values()];
    if (operations.length > 450) throw Object.assign(new Error('La operación contiene demasiados archivos. Divide la operación en lotes menores.'), { status: 413 });
    if (operations.reduce((bytes, operation) => bytes + Buffer.byteLength(operation.content || '', 'utf8'), 0) > 8000000) throw Object.assign(new Error('La operación excede el tamaño admitido. Divide el guardado en lotes menores.'), { status: 413 });
    const mutations = operations.flatMap(operation => {
      if (operation.type === 'delete') {
        const id = this._getSafeId(operation.relative);
        const existingId = this.files.get(operation.relative)?.id;
        const marker = { type: 'set', id, data: { path: operation.relative, content: 'null', secret: this.secret, generation: expected.generation, deleted: true, updatedAt: Date.now(), syncRevision: expected.revision + 1 } };
        return existingId && existingId !== id ? [marker, { type: 'delete', id: existingId }] : [marker];
      }
      return [{ type: 'set', id: this._getSafeId(operation.relative), data: {
        path: operation.relative, dir: path.posix.dirname(operation.relative), fileName: path.posix.basename(operation.relative),
        content: operation.content, secret: this.secret, generation: expected.generation, deleted: false, updatedAt: Date.now(), syncRevision: expected.revision + 1
      } }];
    });
    if (mutations.length > 450) throw Object.assign(new Error('Demasiados archivos en una operación.'), { status: 413 });
    await this.adapter.commit(expected, mutations, expected.generation);
    this.state = { generation: expected.generation, revision: expected.revision + 1 };
    const files = new Map(this.files);
    for (const operation of operations) {
      if (this.pending.get(operation.relative) === operation) this.pending.delete(operation.relative);
      if (operation.type === 'delete') files.delete(operation.relative);
      else files.set(operation.relative, { value: JSON.parse(operation.content), id: this._getSafeId(operation.relative) });
    }
    this.files = files;
    this.publishWriterState();
  }

  async clearAllInFirestore(keepUsers = true) {
    if (!keepUsers) throw new Error('La limpieza debe conservar los usuarios y el control de sincronización.');
    if (!this.state) throw this.conflict();
    await this.flush();
    const expected = { ...this.state };
    const documents = await this.adapter.readAll();
    const oldDocuments = documents.filter(document => this._getCanonicalRelPath(document.data.path) !== 'users.json' && Number(document.data.generation || 0) <= expected.generation);
    // Switch generations atomically. Old instances cannot commit against the new generation.
    await this.adapter.commit(expected, [], expected.generation + 1);
    this.state = { generation: expected.generation + 1, revision: expected.revision + 1 };
    const users = this.files.get('users.json');
    this.files = new Map(users ? [['users.json', users]] : []);
    this.pending.clear();
    this.publishWriterState();
    // Generation-specific IDs are never reused, so cleanup cannot delete new inventories.
    try {
      await this.adapter.removeOld(oldDocuments.map(document => document.id));
    } catch (error) {
      console.error('[firebaseSync] Old generation cleanup deferred:', error.code || error.message);
      return { deletedCount: oldDocuments.length, preservedUsersCount: users ? 1 : 0, cleanupPending: true };
    }
    return { deletedCount: oldDocuments.length, preservedUsersCount: users ? 1 : 0, cleanupPending: false };
  }
}

module.exports = CloudFileStore;
