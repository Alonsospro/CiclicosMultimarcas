const path = require('path');
const storage = require('./storagePath');
const config = require('../config');
const contract = require('./inventoryContract');
const workflow = require('./inventoryWorkflow');
const snapshots = require('./snapshotService');
const { getInventoryIdentifier } = require('./metricsSourceService');

const clean = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const time = value => Date.parse(value) || 0;
const NO_PHOTO_NEEDED_WHEN_CUADRA = new Set(['error de conteo', 'balanceo']);
const STATUS_ORDER = ['falta', 'por_confirmar', 'con_foto', 'no_requiere', 'cierre_forzado'];
const isDriveLink = link => /^https:\/\/([\w-]+\.)*(google\.com|googleusercontent\.com)\//.test(link);

function photoLinks(entry) {
  const listed = (entry.photoUrls || []).map(photo => typeof photo === 'string' ? photo : photo?.driveUrl || photo?.photoUrl);
  return [...new Set([entry.driveUrl, entry.photoUrl, ...listed].filter(Boolean).map(String))];
}

function photoStatus(entry, links = photoLinks(entry)) {
  const reason = clean(entry.reasonType);
  const decision = String(entry.corroboracion || entry.corroboration || '').trim().toUpperCase();
  if (entry.forced || reason === 'cierre forzado') return 'cierre_forzado';
  if (decision === 'CUADRA' && NO_PHOTO_NEEDED_WHEN_CUADRA.has(reason)) return 'no_requiere';
  if (!links.length) return 'falta';
  return entry.driveFileId || links.some(isDriveLink) ? 'con_foto' : 'por_confirmar';
}

// A recount belongs to its parent inventory, so both rounds of one item appear under the same name.
function buildRows({ inventories = [], records = [] }) {
  const byId = new Map();
  inventories.forEach(inventory => {
    const id = inventory.inventoryId || inventory.id || inventory.fileId;
    if (id) byId.set(id, inventory);
  });
  const rootOf = id => {
    const inventory = byId.get(id);
    return inventory?.parentInventoryId && byId.has(inventory.parentInventoryId) ? inventory.parentInventoryId : id;
  };
  const keyOf = (rootId, entry, round) => JSON.stringify([rootId, contract.member(entry), round]);
  const entries = new Map();

  // The same rule as the review flow: an archived review is history, the latest one is the current one.
  records.filter(record => !record.superseded && record.inventoryId)
    .sort((a, b) => time(a.reviewedAt) - time(b.reviewedAt))
    .forEach(record => {
      const rootId = rootOf(record.inventoryId), round = Number(record.round || 1);
      entries.set(keyOf(rootId, record, round), {...record, rootId, round});
    });

  // Rows without their own record, such as Barrido, or whose record lost the photo.
  byId.forEach((inventory, id) => {
    const rootId = rootOf(id);
    (inventory.items || []).forEach(item => [1, 2].forEach(round => {
      const row = workflow.review(item, round, []);
      if (!String(row.justification || '').trim()) return;
      const key = keyOf(rootId, item, round), existing = entries.get(key);
      if (!existing) entries.set(key, {...row, rootId, round, sku:item.SKU, almacen:item.Almacen, ubicacion:item.Ubicacion, center:inventory.center, type:inventory.type});
      else if (!photoLinks(existing).length) entries.set(key, {...existing, photoUrl:row.photoUrl, photoUrls:row.photoUrls});
    }));
  });

  return [...entries.values()].map(entry => {
    const inventory = byId.get(entry.rootId) || {};
    const links = photoLinks(entry);
    const center = entry.center || inventory.center;
    return {
      inventoryId:entry.rootId, inventoryName:inventory.name || inventory.fileName || entry.rootId,
      suffix:getInventoryIdentifier(entry.rootId) || getInventoryIdentifier(inventory),
      type:entry.type || inventory.type || 'OTRO', center:center ? config.getCenterCode(center) : 'Sin centro',
      sku:entry.sku, almacen:entry.almacen, ubicacion:entry.ubicacion, round:entry.round,
      decision:String(entry.corroboracion || entry.corroboration || '').trim().toUpperCase(),
      reason:entry.reasonType || '', justification:entry.justification || '',
      reviewedBy:entry.reviewedBy || '', reviewedAt:entry.reviewedAt || '', links, status:photoStatus(entry, links)
    };
  }).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || String(a.center).localeCompare(String(b.center)) || String(a.inventoryName).localeCompare(String(b.inventoryName))
    || String(a.sku).localeCompare(String(b.sku)) || a.round - b.round);
}

function readDirectory(dir) {
  return storage.listFiles(dir).filter(file => file.endsWith('.json'))
    .map(file => storage.readJson(path.join(dir, file), null)).filter(Boolean);
}

function getRows() {
  // History first: an open inventory has the current version of a reopened one.
  const inventories = [...readDirectory(storage.getHistoryDirectory()), ...readDirectory(storage.getInventoriesDirectory())]
    .filter(inventory => !snapshots.isSnapshotDeleted(inventory));
  const records = readDirectory(storage.getJustificationsDirectory())
    .filter(record => !snapshots.isSnapshotDeleted(String(record.inventoryId || '')));
  return buildRows({inventories, records});
}

module.exports = {buildRows, photoStatus, getRows};
