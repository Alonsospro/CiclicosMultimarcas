const path = require('path');
const config = require('../../firebase-applet-config.json');
const PersistenceError = require('./persistenceError');

// Same database, collection and rules. Bounded requests and updateTime
// preconditions prevent offline write queues and stale snapshot overwrites.
const SECRET = 'NIBOL_BACKEND_SECRET_987654321';
class FirebaseSyncService {
  constructor() {
    this.collectionName = 'app_files';
    this.root = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
    this.records = new Map();
    this.loaded = false;
    this.lastError = null;
  }
  _getSafeId(value) { return Buffer.from(value).toString('base64url'); }
  _getCanonicalRelPath(value) {
    let p = String(value || '').replace(/\\/g, '/');
    const i = p.indexOf('/data/');
    if (i >= 0) p = p.slice(i + 6);
    p = p.replace(/^\/+/, '');
    if (!p || p.split('/').includes('..') || path.isAbsolute(p) || p.includes(':')) {
      throw new PersistenceError('Ruta de almacenamiento inválida.', 'INVALID_PATH', 400);
    }
    return p;
  }
  async request(action, body) {
    try {
      const response = await fetch(`https://firestore.googleapis.com/v1/${this.root}:${action}?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        const code = result.error?.status || 'PERSISTENCE_UNAVAILABLE';
        throw new PersistenceError(
          code === 'RESOURCE_EXHAUSTED' ? 'Firebase alcanzó su cuota. El cambio sigue pendiente; vuelva a intentar cuando se restablezca el servicio.' :
          ['FAILED_PRECONDITION', 'ABORTED', 'ALREADY_EXISTS'].includes(code) ? 'Los datos cambiaron en otra sesión. Actualice y vuelva a intentar.' :
          'No se pudo confirmar el guardado en Firebase. El cambio sigue pendiente.',
          code, ['FAILED_PRECONDITION', 'ABORTED', 'ALREADY_EXISTS'].includes(code) ? 409 : 503);
      }
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = error.code || 'PERSISTENCE_UNAVAILABLE';
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError('No se recibió confirmación de Firebase. Reintente la misma operación.');
    }
  }
  async queryPaths(paths = null) {
    const filters = [{ fieldFilter: { field: { fieldPath: 'secret' }, op: 'EQUAL', value: { stringValue: SECRET } } }];
    if (paths) {
      const variants = [...new Set(paths.flatMap(rel => [rel, this.records.get(rel)?.fields.path.stringValue,
        '/workspace/data/' + rel, '/app/applet/data/' + rel].filter(Boolean)))];
      filters.push({ fieldFilter: { field: { fieldPath: 'path' }, op: 'IN', value: { arrayValue: { values: variants.map(stringValue => ({ stringValue })) } } } });
    }
    const rows = await this.request('runQuery', { structuredQuery: { from: [{ collectionId: this.collectionName }],
      where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } });
    const found = new Map();
    for (const row of rows) {
      const record = row.document;
      if (!record) continue;
      const rel = this._getCanonicalRelPath(record.fields.path.stringValue);
      const previous = found.get(rel);
      const stamp = time => time.replace(/(?:\.(\d+))?Z$/, (_, fraction = '') => '.' + fraction.padEnd(9, '0') + 'Z');
      if (!previous || stamp(record.updateTime) > stamp(previous.updateTime)) found.set(rel, record);
    }
    if (paths) for (const rel of paths) this.records.delete(rel);
    else this.records.clear();
    for (const [rel, record] of found) this.records.set(rel, record);
    return found;
  }
  decode(record) {
    try { const value = JSON.parse(record.fields.content.stringValue); return value?.__deleted === true ? null : value; }
    catch { throw new PersistenceError('Hay un archivo persistente ilegible. Se requiere revisar su respaldo.', 'INVALID_STORED_JSON'); }
  }
  async hydrateMemoryStore(memoryStore, timestamps, listings, storage) {
    const found = await this.queryPaths();
    // Parse first; never promote packaged counts over a confirmed cloud version.
    const parsed = [...found].map(([rel, record]) => [rel, this.decode(record)]);
    for (const [rel, value] of parsed) storage.cacheConfirmed(storage.resolveFilePath(rel), value);
    this.loaded = true;
    console.log(`[firebaseSync] ${parsed.length} archivos persistentes recuperados.`);
  }
  async refresh(paths, storage) {
    for (let i = 0; i < paths.length; i += 6) {
      const batch = paths.slice(i, i + 6);
      const found = await this.queryPaths(batch);
      for (const rel of batch) storage.cacheConfirmed(storage.resolveFilePath(rel), found.has(rel) ? this.decode(found.get(rel)) : null);
    }
  }
  async commit(changes) {
    if (!changes.length) return;
    const writes = changes.map(({ rel, data, expected }) => {
      const record = expected || null;
      const name = record?.name || `${this.root}/${this.collectionName}/${this._getSafeId(rel)}`;
      const currentDocument = record ? { updateTime: record.updateTime } : { exists: false };
      // A persistent tombstone also suppresses older copies under legacy IDs.
      // Physically deleting only the newest document would resurrect those copies.
      if (data === null) data = { __deleted: true };
      const content = JSON.stringify(data);
      if (Buffer.byteLength(content, 'utf8') > 950000) throw new PersistenceError(
        'El registro supera el tamaño seguro de Firebase. No se confirmó el guardado.', 'DOCUMENT_TOO_LARGE', 413);
      const fields = record ? { ...record.fields } : {
        path: { stringValue: rel }, dir: { stringValue: path.posix.dirname(rel) },
        fileName: { stringValue: path.posix.basename(rel) }, secret: { stringValue: SECRET }
      };
      fields.content = { stringValue: content };
      fields.updatedAt = { integerValue: String(Date.now()) };
      return { update: { name, fields }, currentDocument, ...(record ? { updateMask: { fieldPaths: ['content', 'updatedAt'] } } : {}) };
    });
    if (writes.length > 450 || Buffer.byteLength(JSON.stringify({ writes })) > 9000000) {
      throw new PersistenceError('Operación demasiado grande para confirmarla de una vez.', 'OPERATION_TOO_LARGE', 413);
    }
    const result = await this.request('commit', { writes });
    changes.forEach((change, i) => {
      this.records.set(change.rel, { ...writes[i].update, updateTime: result.writeResults[i].updateTime });
    });
  }
  async syncToFirestore(rel, dir, fileName, data) {
    rel = this._getCanonicalRelPath(rel);
    if (!this.loaded) await this.queryPaths([rel]);
    await this.commit([{ rel, data, expected: this.records.get(rel) }]);
  }
  async deleteFromFirestore(rel) {
    rel = this._getCanonicalRelPath(rel);
    await this.queryPaths([rel]);
    await this.commit([{ rel, data: null, expected: this.records.get(rel) }]);
  }
  async clearAllInFirestore(keepUsers = true) {
    await this.queryPaths();
    const changes = [...this.records].filter(([rel]) => !(keepUsers && rel === 'users.json'))
      .map(([rel, expected]) => ({ rel, expected, data: null }));
    for (let i = 0; i < changes.length; i += 400) await this.commit(changes.slice(i, i + 400));
  }
}
module.exports = new FirebaseSyncService();
module.exports.FirebaseSyncService = FirebaseSyncService;
