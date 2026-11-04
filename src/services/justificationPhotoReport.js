const path = require('path');
const storage = require('./storagePath');
const config = require('../config');
const contract = require('./inventoryContract');
const workflow = require('./inventoryWorkflow');
const snapshots = require('./snapshotService');
const { getInventoryIdentifier } = require('./metricsSourceService');

const clean = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const time = value => Date.parse(value) || 0;
// Any other reason, including the earlier faltante and sobrante names, needs a photo.
const NO_PHOTO_NEEDED = new Set(['transferencia', 'balanceo', 'error de conteo', 'mal ubicado', 'error de typeo', 'sobrestock',
  'empaque diferente', 'empaque similar', 'sin justificacion', 'otro']);
const STATUS_ORDER = ['falta', 'en_drive', 'por_confirmar', 'con_foto', 'no_requiere', 'cierre_forzado'];
const isDriveLink = link => /^https:\/\/([\w-]+\.)*(google\.com|googleusercontent\.com)\//.test(link);

const byStatus = (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  || String(a.center).localeCompare(String(b.center)) || String(a.inventoryName).localeCompare(String(b.inventoryName))
  || String(a.sku).localeCompare(String(b.sku)) || a.round - b.round;

function photoLinks(entry) {
  const listed = (entry.photoUrls || []).map(photo => typeof photo === 'string' ? photo : photo?.driveUrl || photo?.photoUrl);
  return [...new Set([entry.driveUrl, entry.photoUrl, ...listed].filter(Boolean).map(String))];
}

function photoStatus(entry, links = photoLinks(entry)) {
  const reason = clean(entry.reasonType);
  if (entry.forced || reason === 'cierre forzado') return 'cierre_forzado';
  if (NO_PHOTO_NEEDED.has(reason)) return 'no_requiere';
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
  }).sort(byStatus);
}

function readDirectory(dir) {
  return storage.listFiles(dir).filter(file => file.endsWith('.json'))
    .map(file => storage.readJson(path.join(dir, file), null)).filter(Boolean);
}

function readInventories() {
  // History first: an open inventory has the current version of a reopened one.
  return [...readDirectory(storage.getHistoryDirectory()), ...readDirectory(storage.getInventoriesDirectory())]
    .filter(inventory => !snapshots.isSnapshotDeleted(inventory));
}

function readRecords() {
  return readDirectory(storage.getJustificationsDirectory())
    .filter(record => !snapshots.isSnapshotDeleted(String(record.inventoryId || '')));
}

function getRows() {
  return buildRows({inventories:readInventories(), records:readRecords()});
}

const gasPhotos = (type, center) => require('./gasService').listJustificationPhotos(type, center);

const startOf = inventory => time(inventory.launchedAt || inventory.createdAt || inventory.closedAt);
const photoName = value => String(value || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 100).toLowerCase();
const sameType = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

// A row without a photo takes the Drive files with its code and warehouse that nobody linked, from any
// upload day, but only until the next group of its center and type starts: the same code in another week is not its photo.
function attachDrivePhotos(rows, inventories, files) {
  const launches = inventories.filter(inventory => !inventory.parentInventoryId).map(inventory => {
    const id = inventory.inventoryId || inventory.id || inventory.fileId;
    return {id, start:startOf(inventory), type:inventory.type, center:inventory.center ? config.getCenterCode(inventory.center) : '',
      suffix:getInventoryIdentifier(id) || getInventoryIdentifier(inventory)};
  });
  const linked = rows.flatMap(row => row.links).join(' ');
  const free = files.filter(file => !linked.includes(file.id));
  const used = new Set();
  return rows.map(row => {
    if (row.status !== 'falta') return row;
    const start = launches.find(launch => launch.id === row.inventoryId)?.start || 0;
    const end = Math.min(Infinity, ...launches.filter(launch => sameType(launch.type, row.type) && launch.center === row.center
      && launch.suffix !== row.suffix && launch.start > start).map(launch => launch.start));
    const base = `just-${photoName(row.sku)}-${photoName(row.almacen)}`;
    const found = free.filter(file => {
      const created = time(file.createdAt);
      return !used.has(file.id) && file.center === row.center && sameType(file.type, row.type)
        && String(file.name || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/(-r2)?(-evidencia-\d+)?$/, '') === base
        && created >= start && created < end;
    });
    if (!found.length) return row;
    found.forEach(file => used.add(file.id));
    return {...row, status:'en_drive', links:found.map(file => file.url), driveFolders:[...new Set(found.map(file => file.folderDate))]};
  }).sort(byStatus);
}

// The selected group only. Drive is looked up just for the rows still missing a photo.
async function getReport({type = 'TODOS', center = 'TODOS', suffix = 'TODOS'} = {}, listPhotos = gasPhotos) {
  const inventories = readInventories();
  const rows = buildRows({inventories, records:readRecords()}).filter(row => (type === 'TODOS' || sameType(row.type, type))
    && (center === 'TODOS' || row.center === center)
    && (suffix === 'TODOS' || (row.suffix || 'SIN_TERMINACION') === suffix));
  const drive = {checked:true, truncated:false, error:''};
  const files = [];
  for (const rowType of new Set(rows.filter(row => row.status === 'falta').map(row => row.type))) {
    try {
      const result = await listPhotos(rowType, center === 'TODOS' ? '' : center);
      files.push(...result.files);
      drive.truncated = drive.truncated || !!result.truncated;
    } catch (error) {
      drive.checked = false;
      drive.error = error.message;
    }
  }
  return {rows:attachDrivePhotos(rows, inventories, files), drive};
}

module.exports = {buildRows, photoStatus, getRows, attachDrivePhotos, getReport};
