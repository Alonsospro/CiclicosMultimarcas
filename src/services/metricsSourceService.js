const path = require('path');
const storage = require('./storagePath');
const gas = require('./gasService');
const config = require('../config');
const snapshots = require('./snapshotService');
const model = require('./inventorySheetModel');
const reliability = require('./counterReliability');

const reads = new Map();
const verified = new Map();
const FRESH_MS = 30000;
const MAX_CACHE_MS = 5 * 60000;
const norm = value => String(value || '').trim().toLowerCase().replace(/\.json$/, '');
const sheetKey = record => gas.extractSpreadsheetId(record.spreadsheetUrl || record.driveUrl || '') || record.driveFileId || '';
const closed = record => record.isHistory || String(record.status).toUpperCase() === 'REVISADO';
const child = record => record.parentInventoryId || String(record.inventoryId || record.id || '').startsWith('REC-');
const matchesId = (record, id) => [record.id, record.inventoryId, record.fileId, record.driveFileId, record.fileName, record.name, ...(record.aliases || [])].some(value => value && norm(value) === norm(id));
const getInventoryIdentifier = value => {
  const str = typeof value === 'string'
    ? value
    : (value?.id || value?.inventoryId || value?.fileName || value?.name || '');
  const clean = String(str).replace(/\.json$/i, '').replace(/_FINAL_.*$/i, '').trim();
  const match = clean.match(/-(\d+)$/);
  if (match) return match[1];
  const parts = clean.split('-');
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    if (last && !isNaN(Number(last))) return last;
  }
  return '';
};

class MetricsSourceService {
  invalidate() { reads.clear(); verified.clear(); this.historyCache = null; this.historyPending = new Map(); this.discoveryErrorCache?.clear(); this.generation = (this.generation || 0) + 1; }

  background(work) {
    this.queue ||= [];
    const generation = this.generation;
    this.queue.push(() => generation === this.generation ? work() : undefined);
    this.drain();
  }

  drain() {
    this.running ||= 0;
    while (this.running < 3 && this.queue.length) {
      const work = this.queue.shift();
      this.running++;
      Promise.resolve().then(work).catch(() => {}).finally(() => { this.running--; this.drain(); });
    }
  }

  async history(type, center) {
    center = ['GLOBAL','TODOS'].includes(center) ? 'TODOS' : center;
    const cacheKey = `${type}:${center}`;
    this.historyCache ||= new Map();
    const cached = this.historyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MAX_CACHE_MS) {
      if (Date.now() - cached.at >= FRESH_MS && !cached.refreshing) {
        cached.refreshing = true;
        this.background(async () => {
          try { await this.fetchHistory(type, center, cacheKey); }
          finally { cached.refreshing = false; }
        });
      }
      return cached.value;
    }
    const broad = [this.historyCache.get(`${type}:TODOS`), this.historyCache.get('TODOS:TODOS')]
      .find(entry => entry && Date.now() - entry.at < FRESH_MS);
    if (broad) {
      const value = broad.value.filter(record => (type === 'TODOS' || record.type === type) &&
        (center === 'TODOS' || config.isSameCenter(record.center, center)));
      value.discoveryIssues = (broad.value.discoveryIssues || []).filter(issue => type === 'TODOS' || issue.type === type);
      return value;
    }
    return this.fetchHistory(type, center, cacheKey);
  }

  async fetchHistory(type, center, cacheKey) {
    this.historyPending ||= new Map();
    if (this.historyPending.has(cacheKey)) return this.historyPending.get(cacheKey);
    const generation = this.generation;
    const pending = this.readHistory(type, center).then(value => {
      if (generation === this.generation) this.historyCache.set(cacheKey, {at:Date.now(), value});
      return value;
    }).finally(() => { if (this.historyPending.get(cacheKey) === pending) this.historyPending.delete(cacheKey); });
    this.historyPending.set(cacheKey, pending);
    return pending;
  }

  async readHistory(type, center) {
    const types = type && type !== 'TODOS' ? [type] : config.inventoryTypes;
    const now = Date.now();
    const toQuery = [];
    const cachedIssues = [];
    this.discoveryErrorCache ||= new Map();
    types.forEach(t => {
      const errKey = `${t}:${center}`;
      const errCached = this.discoveryErrorCache.get(errKey);
      if (errCached && now - errCached.at < 180000) {
        cachedIssues.push(errCached.issue);
      } else {
        toQuery.push(t);
      }
    });

    const results = await Promise.allSettled(toQuery.map(t => gas.getHistoryFromGAS(t, ['TODOS','GLOBAL'].includes(center) ? null : center)));
    const value = results.flatMap(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
    const newIssues = results.flatMap((r, i) => {
      if (r.status === 'rejected') {
        const issue = { type: toQuery[i], center, kind: 'discovery', status: 'unavailable', name: 'Historial de cierres', issues: [r.reason?.message || 'No se pudo consultar el historial'] };
        this.discoveryErrorCache.set(`${toQuery[i]}:${center}`, { at: Date.now(), issue });
        return [issue];
      }
      return [];
    });
    value.discoveryIssues = [...cachedIssues, ...newIssues];
    return value;
  }

  async load({ type = 'TODOS', center = 'TODOS', inventoryId = 'TODOS', startDate = null, endDate = null, refresh = false, includeChildren = false } = {}) {
    const candidates = [];
    for (const [dir, isHistory] of [[storage.getHistoryDirectory(), true], [storage.getInventoriesDirectory(), false]]) {
      for (const file of storage.listFiles(dir).filter(f => f.endsWith('.json'))) {
        const record = storage.readJson(path.join(dir, file), null);
        if (!record || snapshots.isSnapshotDeleted(file) || snapshots.isSnapshotDeleted(record)) continue;
        const inventoryId = record.inventoryId || (!isHistory ? record.id : null);
        candidates.push({ ...record, center: record.center ? config.getCenterCode(record.center) : null, inventoryId, id: inventoryId || record.fileId || file.replace(/\.json$/, ''),
          name: record.name || record.fileName || record.id, isHistory, launchedAt:record.launchedAt || record.createdAt,
          createdAt: isHistory ? (record.closedAt || record.createdAt) : record.createdAt });
      }
    }
    const remoteHistory = await this.history(type, center);
    for (const record of remoteHistory) {
      if (snapshots.isSnapshotDeleted(record)) continue;
      candidates.push({ ...record, center: record.center ? config.getCenterCode(record.center) : null, id: record.inventoryId || record.fileId, name: record.fileName, isHistory: true,
        launchedAt:record.createdAt || record.launchedAt,
        createdAt: record.closedAt, status: 'REVISADO' });
    }

    // Join aliases of the same closure. Date, row count and names never identify a closure.
    const groups = [];
    for (const record of candidates) {
      if (type !== 'TODOS' && record.type !== type) continue;
      if (center !== 'TODOS' && center !== 'GLOBAL' && !config.isSameCenter(record.center, center)) continue;
      const sheet = sheetKey(record);
      const related = groups.filter(g => g.some(r => (sheet && sheet === sheetKey(r)) || (record.inventoryId && r.inventoryId === record.inventoryId)));
      if (!related.length) groups.push([record]);
      else {
        related[0].push(record);
        for (const other of related.slice(1)) { related[0].push(...other); groups.splice(groups.indexOf(other), 1); }
      }
    }

    const primaryGroups = includeChildren ? groups : groups.filter(group => group.some(record => !child(record)));
    const inventories = new Array(primaryGroups.length);
    let next = 0;
    await Promise.all(Array.from({length:Math.min(3, primaryGroups.length)}, async () => {
      while (next < primaryGroups.length) {
        const index = next++, group = primaryGroups[index];
        const isGroupFilter = String(inventoryId || '').startsWith('GRUPO:');
        const groupSuffix = isGroupFilter ? String(inventoryId).slice(6) : null;
        const matchesRecord = r => isGroupFilter
          ? (getInventoryIdentifier(r) === groupSuffix)
          : matchesId(r, inventoryId);
        inventories[index] = await this.resolve(group, inventoryId !== 'TODOS' && !group.some(matchesRecord), {startDate, endDate, refresh});
      }
    }));
    inventories.discoveryIssues = remoteHistory.discoveryIssues || [];
    return inventories;
  }

  async resolve(group, skipRead = false, {startDate, endDate, refresh = false} = {}) {
    const generation = this.generation;
    // Locally signed closures carry membership; a remote cache of rows is never that membership.
    const rank = r => !closed(r) ? 5 : (r.manifest ? 4 : (r.isHistory && String(r.fileId).startsWith('DRIVE-FILE-') && r.inventoryId ? 3 : (!r.isHistory ? 2 : 1)));
    group.sort((a, b) => rank(b) - rank(a) ||
      ((Date.parse(b.manifest?.closedAt || b.closedAt || b.createdAt) || 0) - (Date.parse(a.manifest?.closedAt || a.closedAt || a.createdAt) || 0)));
    const primary = group.filter(record => !child(record));
    const anchor = primary[0] || group[0];
    const reopened = !closed(anchor) && !!anchor.reopenedAt;
    const linked = reopened ? null : (closed(anchor) ? primary.find(r => closed(r) && sheetKey(r)) : (primary.find(r => sheetKey(r)) || null));
    const record = { ...anchor, items: [], aliases: [...new Set(group.flatMap(r => [r.id, r.inventoryId, r.fileId, r.driveFileId, r.fileName]).filter(Boolean))] };
    if (linked) {
      record.spreadsheetUrl = group.find(r => sheetKey(r) === sheetKey(linked) && /[#&?]gid=\d+/.test(r.spreadsheetUrl || ''))?.spreadsheetUrl || linked.spreadsheetUrl || linked.driveUrl;
      record.driveFileId = sheetKey(linked);
      record.driveUrl = record.spreadsheetUrl;
      record.isHistory = group.some(closed);
      if (record.isHistory) record.status = 'REVISADO';
    } else if (!closed(anchor)) {
      // An explicitly reopened inventory without a linked spreadsheet uses local observations.
      record.previousSpreadsheetUrl = anchor.spreadsheetUrl || anchor.driveUrl;
      delete record.spreadsheetUrl; delete record.driveUrl; delete record.driveFileId;
      record.closedAt = null;
      record.createdAt = anchor.reopenedAt || anchor.createdAt;
    }
    const localManifest = closed(anchor) ? (anchor.manifest || ((rank(anchor) >= 3 || !anchor.isHistory) && anchor.items?.length ? model.createManifest(anchor) : null)) : null;
    const validation = { status: 'valid', source: linked ? 'GOOGLE_SHEETS' : 'LOCAL_ACTIVE', issues: [], warnings: [],
      expectedRows: localManifest?.itemCount ?? null, expectedSkus: localManifest?.skuCount ?? null };
    record.sourceValidation = validation;
    record.totalItems = localManifest?.itemCount ?? anchor.totalItems ?? anchor.items?.length ?? 0;
    const date = Date.parse(record.closedAt || record.createdAt);
    if (Number.isFinite(date) && ((startDate && date < Date.parse(startDate)) || (endDate && date > Date.parse(endDate)))) skipRead = true;
    if (skipRead) { validation.status = 'not_requested'; return record; }
    const verifiedKey = linked ? JSON.stringify([record.driveFileId, record.center, record.type, record.spreadsheetUrl,
      localManifest, linked.modifiedAt, primary.map(r => [r.id, r.inventoryId, r.closedAt])]) : null;
    const previous = verifiedKey && verified.get(verifiedKey);
    if (!refresh && previous && Date.now() - previous.at < MAX_CACHE_MS) {
      if (Date.now() - previous.at >= FRESH_MS && !previous.refreshing) {
        previous.refreshing = true;
        this.background(async () => {
          try { await this.resolve(group, false, {startDate, endDate, refresh:true}); }
          finally { previous.refreshing = false; }
        });
      }
      return {...previous.record, sourceValidation:{...previous.record.sourceValidation,
        cached:true, verifiedAt:new Date(previous.at).toISOString(), refreshing:!!previous.refreshing}};
    }
    try {
      if (!record.center) { const error = new Error('Falta el centro del inventario'); error.code = 'INVALID_SHEET'; throw error; }
      let items;
      if (linked) {
        const cacheKey = `${record.driveFileId}:${record.center}:${record.spreadsheetUrl}:${localManifest?.membershipHash || ''}:${linked.modifiedAt || ''}`;
        let cached = reads.get(cacheKey);
        if (!cached || (refresh && !cached.pending) || (!cached.pending && Date.now() - cached.at > FRESH_MS)) {
          cached = { at: Date.now(), pending:true };
          cached.promise = gas.readInventorySpreadsheet(record).then(source => {
            cached.pending = false; cached.at = Date.now(); return source;
          });
          reads.set(cacheKey, cached);
        }
        let source;
        try { source = await cached.promise; } catch (error) {
          if (reads.get(cacheKey) === cached) reads.delete(cacheKey);
          throw error;
        }
        validation.sheetName = source.sheetName;
        validation.gid = source.gid;
        validation.readAt = source.readAt;
        if (source.gid !== undefined) {
          record.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${record.driveFileId}/edit#gid=${source.gid}`;
          record.driveUrl = record.spreadsheetUrl;
        }
        try { items = model.normalizeTable(source.headers, source.rows, source.schemaVersion); }
        catch (error) { error.code = 'INVALID_SHEET'; throw error; }
        const authorship = primary.find(record => record.items?.some(item => item.counterEvidence));
        if (authorship) items = reliability.preserve(items, authorship.items);
        const remoteManifest = source.manifest;
        validation.issues.push(...model.validateManifest(localManifest, record, items));
        validation.issues.push(...model.validateManifest(remoteManifest, record, items));
        if (!localManifest && !remoteManifest) validation.warnings.push('Archivo antiguo sin manifiesto: se validó su estructura, pero no se puede confirmar su pertenencia al cierre.');
        if (remoteManifest) record.manifest = remoteManifest;
      } else {
        if (closed(record)) throw new Error('El cierre no tiene un enlace confirmado a Google Sheets');
        items = (anchor.items || []).map(model.normalizeItem);
      }
      validation.actualRows = items.length;
      validation.actualSkus = new Set(items.map(it => it.SKU)).size;
      if (new Set(items.map(model.member)).size !== items.length) validation.issues.push('Hay SKU, almacenes y ubicaciones duplicados en la hoja');
      if (!items.length) validation.issues.push('La hoja no contiene registros de inventario');
      if (closed(record) && items.some(it => it.Stock_Total === null)) validation.issues.push('El archivo final contiene filas sin conteo');
      if (validation.issues.length) validation.status = 'inconsistent';
      else { record.items = items; record.totalItems = items.length; }
    } catch (error) {
      validation.status = error.code === 'INVALID_SHEET' ? 'inconsistent' : 'unavailable';
      validation.issues.push(error.message);
    }
    if (verifiedKey && generation === this.generation) {
      if (validation.status === 'valid') {
        validation.verifiedAt = new Date().toISOString();
        verified.set(verifiedKey, {at:Date.now(), record});
      } else {
        // A failed revalidation must not silently keep a closure marked as valid.
        verified.delete(verifiedKey);
      }
    }
    return record;
  }
}

module.exports = new MetricsSourceService();
module.exports.matchesId = matchesId;
module.exports.getInventoryIdentifier = getInventoryIdentifier;
