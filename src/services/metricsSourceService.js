const path = require('path');
const storage = require('./storagePath');
const gas = require('./gasService');
const config = require('../config');
const snapshots = require('./snapshotService');
const model = require('./inventorySheetModel');

const reads = new Map();
const norm = value => String(value || '').trim().toLowerCase().replace(/\.json$/, '');
const sheetKey = record => gas.extractSpreadsheetId(record.spreadsheetUrl || record.driveUrl || '') || record.driveFileId || '';
const closed = record => record.isHistory || String(record.status).toUpperCase() === 'REVISADO';
const matchesId = (record, id) => [record.id, record.inventoryId, record.fileId, record.driveFileId, record.fileName, record.name, ...(record.aliases || [])].some(value => value && norm(value) === norm(id));

class MetricsSourceService {
  invalidate() { reads.clear(); this.historyCache = null; }

  async history(type, center) {
    const cacheKey = `${type}:${center}`;
    this.historyCache ||= new Map();
    const cached = this.historyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 30000) return cached.value;
    const types = type && type !== 'TODOS' ? [type] : config.inventoryTypes;
    const results = await Promise.allSettled(types.map(t => gas.getHistoryFromGAS(t, center)));
    const value = results.flatMap(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
    this.historyCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  async load({ type = 'TODOS', center = 'TODOS', inventoryId = 'TODOS' } = {}) {
    const candidates = [];
    for (const [dir, isHistory] of [[storage.getHistoryDirectory(), true], [storage.getInventoriesDirectory(), false]]) {
      for (const file of storage.listFiles(dir).filter(f => f.endsWith('.json'))) {
        const record = storage.readJson(path.join(dir, file), null);
        if (!record || snapshots.isSnapshotDeleted(file) || snapshots.isSnapshotDeleted(record)) continue;
        const inventoryId = record.inventoryId || (!isHistory ? record.id : null);
        candidates.push({ ...record, center: record.center ? config.getCenterCode(record.center) : null, inventoryId, id: inventoryId || record.fileId || file.replace(/\.json$/, ''),
          name: record.name || record.fileName || record.id, isHistory,
          createdAt: isHistory ? (record.closedAt || record.createdAt) : record.createdAt });
      }
    }
    for (const record of await this.history(type, center)) {
      if (snapshots.isSnapshotDeleted(record)) continue;
      candidates.push({ ...record, center: record.center ? config.getCenterCode(record.center) : null, id: record.inventoryId || record.fileId, name: record.fileName, isHistory: true,
        createdAt: record.closedAt, status: 'REVISADO' });
    }

    // Join aliases of the same closure. Date, row count and names never identify a closure.
    const groups = [];
    for (const record of candidates) {
      if (type !== 'TODOS' && record.type !== type) continue;
      if (center !== 'TODOS' && center !== 'GLOBAL' && !config.isSameCenter(record.center, center)) continue;
      if (String(record.inventoryId || record.id).startsWith('REC-') || record.parentInventoryId) continue;
      const sheet = sheetKey(record);
      const related = groups.filter(g => g.some(r => (sheet && sheet === sheetKey(r)) || (record.inventoryId && r.inventoryId === record.inventoryId)));
      if (!related.length) groups.push([record]);
      else {
        related[0].push(record);
        for (const other of related.slice(1)) { related[0].push(...other); groups.splice(groups.indexOf(other), 1); }
      }
    }

    const inventories = [];
    for (let start = 0; start < groups.length; start += 3) {
      inventories.push(...await Promise.all(groups.slice(start, start + 3).map(group =>
        this.resolve(group, inventoryId !== 'TODOS' && !group.some(record => matchesId(record, inventoryId))))));
    }
    return inventories;
  }

  async resolve(group, skipRead = false) {
    // Locally signed closures carry membership; a remote cache of rows is never that membership.
    const rank = r => r.manifest ? 4 : (r.isHistory && String(r.fileId).startsWith('DRIVE-FILE-') && r.inventoryId ? 3 : (!r.isHistory ? 2 : 1));
    group.sort((a, b) => rank(b) - rank(a) ||
      ((Date.parse(b.manifest?.closedAt || b.closedAt || b.createdAt) || 0) - (Date.parse(a.manifest?.closedAt || a.closedAt || a.createdAt) || 0)));
    const anchor = group[0];
    const linked = group.some(closed) ? group.find(r => sheetKey(r)) : null;
    const record = { ...anchor, items: [], aliases: [...new Set(group.flatMap(r => [r.id, r.inventoryId, r.fileId, r.driveFileId, r.fileName]).filter(Boolean))] };
    if (linked) {
      record.spreadsheetUrl = group.find(r => sheetKey(r) === sheetKey(linked) && /[#&?]gid=\d+/.test(r.spreadsheetUrl || ''))?.spreadsheetUrl || linked.spreadsheetUrl || linked.driveUrl;
      record.driveFileId = sheetKey(linked);
      record.isHistory = group.some(closed);
      if (record.isHistory) record.status = 'REVISADO';
    }
    const localManifest = anchor.manifest || ((rank(anchor) >= 3 || (!anchor.isHistory && closed(anchor))) && anchor.items?.length ? model.createManifest(anchor) : null);
    const validation = { status: 'valid', source: linked ? 'GOOGLE_SHEETS' : 'LOCAL_ACTIVE', issues: [], warnings: [],
      expectedRows: localManifest?.itemCount ?? null, expectedSkus: localManifest?.skuCount ?? null };
    record.sourceValidation = validation;
    record.totalItems = localManifest?.itemCount ?? anchor.totalItems ?? anchor.items?.length ?? 0;
    if (skipRead) { validation.status = 'not_requested'; return record; }
    try {
      if (!record.center) { const error = new Error('Falta el centro del inventario'); error.code = 'INVALID_SHEET'; throw error; }
      let items;
      if (linked) {
        const cacheKey = `${record.driveFileId}:${record.center}:${record.spreadsheetUrl}:${localManifest?.membershipHash || ''}:${linked.modifiedAt || ''}`;
        let cached = reads.get(cacheKey);
        if (!cached || Date.now() - cached.at > 30000) {
          cached = { at: Date.now(), promise: gas.readInventorySpreadsheet(record) };
          reads.set(cacheKey, cached);
        }
        let source;
        try { source = await cached.promise; } catch (error) { reads.delete(cacheKey); throw error; }
        validation.sheetName = source.sheetName;
        validation.gid = source.gid;
        validation.readAt = source.readAt;
        try { items = model.normalizeTable(source.headers, source.rows); }
        catch (error) { error.code = 'INVALID_SHEET'; throw error; }
        const remoteManifest = source.manifest;
        validation.issues.push(...model.validateManifest(localManifest, record, items));
        validation.issues.push(...model.validateManifest(remoteManifest, record, items));
        if (!localManifest && !remoteManifest) validation.warnings.push('Archivo antiguo sin manifiesto: se validó su estructura, pero no se puede confirmar su pertenencia al cierre.');
      } else {
        if (closed(record)) throw new Error('El cierre no tiene un enlace confirmado a Google Sheets');
        items = (anchor.items || []).map(model.normalizeItem);
      }
      validation.actualRows = items.length;
      validation.actualSkus = new Set(items.map(it => it.SKU)).size;
      if (!items.length) validation.issues.push('La hoja no contiene registros de inventario');
      if (closed(record) && items.some(it => it.Stock_Total === null)) validation.issues.push('El archivo final contiene filas sin conteo');
      if (validation.issues.length) validation.status = 'inconsistent';
      else { record.items = items; record.totalItems = items.length; }
    } catch (error) {
      validation.status = error.code === 'INVALID_SHEET' ? 'inconsistent' : 'unavailable';
      validation.issues.push(error.message);
    }
    return record;
  }
}

module.exports = new MetricsSourceService();
module.exports.matchesId = matchesId;
