const path = require('path');

class CloudFileStore {
  constructor(adapter, secret) {
    this.adapter = adapter;
    this.secret = secret;
    this.state = null;
    this.pending = new Map();
    this.files = new Map();
    this.deferWrites = true;
    this.background = null;
    this.flushing = null;
  }

  stateOf(data) {
    return { generation: Number(data.syncGeneration || 0), revision: Number(data.syncRevision || 0) };
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
    const current = this.stateOf(await this.adapter.readControl());
    if (!force && this.state && current.revision === this.state.revision && current.generation === this.state.generation) return false;
    if (this.pending.size) throw this.conflict();
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = this.stateOf(await this.adapter.readControl());
      const documents = await this.adapter.readAll();
      const after = this.stateOf(await this.adapter.readControl());
      if (before.revision !== after.revision || before.generation !== after.generation) continue;
      const files = new Map();
      const deletedPaths = new Set(documents.filter(document => document.data.deleted && Number(document.data.generation || 0) === after.generation).map(document => this._getCanonicalRelPath(document.data.path)));
      for (const document of documents) {
        const data = document.data;
        if (!data.path || !data.content) continue;
        const relative = this._getCanonicalRelPath(data.path);
        if (!this.isManaged(relative) || deletedPaths.has(relative)) continue;
        if (relative !== 'users.json' && Number(data.generation || 0) !== after.generation) continue;
        // Prefer canonical documents over historical absolute-path duplicates.
        const existing = files.get(relative);
        if (!existing || document.id === this._getSafeId(relative, after.generation)) {
          files.set(relative, { value: JSON.parse(data.content), id: document.id });
        }
      }
      this.files = files;
      this.state = after;
      return true;
    }
    throw this.conflict();
  }

  conflict() {
    return Object.assign(new Error('Los datos cambiaron en otra sesión. Actualiza la vista y vuelve a intentar.'), { status: 409, code: 'STALE_DATA' });
  }

  syncToFirestore(raw, dir, name, value) {
    const relative = this._getCanonicalRelPath(raw);
    if (!this.isManaged(relative)) return;
    if (!this.state) throw Object.assign(new Error('La conexión con Firestore todavía no está preparada.'), { status: 503 });
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content, 'utf8') > 900000) throw Object.assign(new Error('El inventario excede el tamaño admitido para un documento. Divide el inventario antes de guardarlo.'), { status: 413 });
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
    const mutations = operations.flatMap(operation => {
      if (operation.type === 'delete') {
        const id = this._getSafeId(operation.relative);
        const existingId = this.files.get(operation.relative)?.id;
        const marker = { type: 'set', id, data: { path: operation.relative, content: 'null', secret: this.secret, generation: expected.generation, deleted: true, updatedAt: Date.now() } };
        return existingId && existingId !== id ? [marker, { type: 'delete', id: existingId }] : [marker];
      }
      return [{ type: 'set', id: this._getSafeId(operation.relative), data: {
        path: operation.relative, dir: path.posix.dirname(operation.relative), fileName: path.posix.basename(operation.relative),
        content: operation.content, secret: this.secret, generation: expected.generation, deleted: false, updatedAt: Date.now()
      } }];
    });
    if (mutations.length > 450) throw Object.assign(new Error('Demasiados archivos en una operación.'), { status: 413 });
    await this.adapter.commit(expected, mutations, expected.generation);
    this.state = { generation: expected.generation, revision: expected.revision + 1 };
    for (const operation of operations) {
      if (this.pending.get(operation.relative) === operation) this.pending.delete(operation.relative);
      if (operation.type === 'delete') this.files.delete(operation.relative);
      else this.files.set(operation.relative, { value: JSON.parse(operation.content), id: this._getSafeId(operation.relative) });
    }
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
