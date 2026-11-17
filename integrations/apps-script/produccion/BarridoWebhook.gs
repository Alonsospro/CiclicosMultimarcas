/**
 * Apps Script de BARRIDO — planilla "BARRIDO NIBOL MULTIMARCAS".
 *
 * Qué hace:
 *  - Escribe cada conteo de la appweb directo en la pestaña del centro (1120, 1160, ...): si el código no está
 *    en ese almacén, agrega la fila; si está, actualiza su conteo.
 *  - El almacén se elige de una lista (por defecto AL04, RJD0, AM01). La lista vive en este archivo
 *    (propiedad BARRIDO_ALMACENES), se aplica como desplegable en la columna Almacen de cada centro y
 *    la appweb la lee y la puede cambiar.
 *  - Guarda las fotos en la carpeta de barridos: una subcarpeta por fecha y centro
 *    ("2026-11-17 · 1120 Volvo - Km 14") y cada archivo con el código ingresado ("RE505881.jpg").
 *  - Al finalizar el barrido crea una copia de la pestaña del centro en esa misma subcarpeta.
 *
 * Instalación:
 *  1. Extensiones → Apps Script en la planilla BARRIDO NIBOL MULTIMARCAS; pegar este archivo completo.
 *  2. Propiedades del proyecto (Configuración del proyecto → Propiedades de la secuencia de comandos):
 *       APPS_SCRIPT_TOKEN  = el mismo valor que BARRIDO_APPS_SCRIPT_TOKEN en la appweb.
 *       BARRIDO_FOLDER_ID  = 1SucBFevV5PEzM-ONZCriDQiBag31byD1 (opcional: es el valor por defecto).
 *  3. Implementar → Administrar implementaciones → editar → Nueva versión (se conserva la URL /exec,
 *     que es BARRIDO_URL en la appweb).
 *  4. En la planilla: menú 📦 Barrido → Aplicar lista de almacenes.
 */

const BARRIDO_DEFAULT_FOLDER_ID = '1SucBFevV5PEzM-ONZCriDQiBag31byD1';
const BARRIDO_DEFAULT_WAREHOUSES = ['AL04', 'RJD0', 'AM01'];
const BARRIDO_TZ = 'America/La_Paz';

// Las 44 columnas de las pestañas de centro, en orden (A:AR).
const BARRIDO_COLUMNS = ['SKU', 'Codigo_Barras', 'Descripcion', 'Ubicacion', 'Ubicacion_1', 'Ubicacion_2', 'Sobrestock', 'Almacen',
  'Clasificacion_ABC', 'Unidad', 'Costo_Unitario', 'Stock_Sistema', 'Cantidad_Fisica_Final', 'Stock_Total', 'Stock_Buen_Estado', 'Mal_estado',
  'Diferencia', 'Costo_Diferencia', 'Fecha_Ultimo_Conteo', 'Responsable', 'Fecha_Primera_Justificacion', 'Estado', 'Razon',
  'Comentario_Justificacion', 'Responsable_Justificacion', 'Cantidad_Justificada_1', 'Fecha_Reconteo', 'Stock_Total_Reconteo', 'Reconteo',
  'Malestado_Reconteo', 'Diferencia_Final', 'Costo_Diferencia_Final', 'Fecha_Justificacion_2', 'Estado_Justificacion_2', 'Razon_Justificacion_2',
  'Comentario_Justificacion_2', 'Responsable_Justificacion_2', 'Cantidad_Justificada_2', 'Fecha_Reconteo_2', 'Stock_Total_Reconteo_2',
  'Reconteo_2', 'Malestado_Reconteo_2', 'Diferencia_Final_2', 'Costo_Diferencia_Final_2'];
const COL = Object.fromEntries(BARRIDO_COLUMNS.map((key, index) => [key, index]));

const BARRIDO_CENTERS = {
  '1120': 'Volvo - Km 14', '1160': 'Av. Banzer 3er anillo', '1180': 'Foton - Km 10', '1300': 'John Deere - Km 10',
  '1310': 'Sucursal Montero', '1340': 'Sucursal Cuatro Cañadas', '1700': 'Av. Grigota 3er anillo', '1800': 'Express San Julián',
  '1820': 'Express San Pedro', '2100': 'Sucursal El Alto, La Paz', '2150': 'Centro Foton El Alto, La Paz', '3100': 'Sucursal Cochabamba',
  '3200': 'Centro Foton Blanco Galindo', '5100': 'Sucursal Tarija'
};

// ---------------------------------------------------------------- utilidades

function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function property_(key) { return PropertiesService.getScriptProperties().getProperty(key); }
function spreadsheet_() {
  const id = property_('INVENTORY_SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Configure INVENTORY_SPREADSHEET_ID o pegue el script en la planilla de barrido.');
  return ss;
}
function authenticate_(p) {
  const expected = property_('APPS_SCRIPT_TOKEN');
  if (!expected || String(p.apiToken || '') !== expected) throw new Error('Acceso no autorizado');
}
function identity_(value) { return String(value === null || value === undefined ? '' : value).trim().toUpperCase(); }
function has_(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function number_(value, fallback) {
  if (!has_(value)) return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}
function quantity_(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(label + ' debe ser un entero mayor o igual a 0');
  return n;
}
function iso_(value) {
  if (!has_(value)) return '';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toISOString();
}
function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function centerCode_(value) {
  const text = String(value || '').trim();
  const code = text.match(/\b\d{4}\b/);
  if (code && BARRIDO_CENTERS[code[0]]) return code[0];
  const byName = Object.keys(BARRIDO_CENTERS).find(key => identity_(BARRIDO_CENTERS[key]) === identity_(text));
  if (byName) return byName;
  throw new Error('Centro no reconocido: ' + text);
}

// ---------------------------------------------------------------- almacenes

function warehouses_() {
  const saved = property_('BARRIDO_ALMACENES');
  const list = saved ? saved.split(',').map(identity_).filter(Boolean) : BARRIDO_DEFAULT_WAREHOUSES;
  return [...new Set(list)];
}
function setWarehouses_(p) {
  const list = (Array.isArray(p.warehouses) ? p.warehouses : String(p.warehouses || '').split(','))
    .map(identity_).filter(Boolean);
  const unique = [...new Set(list)];
  if (!unique.length) throw new Error('La lista de almacenes no puede quedar vacía.');
  const invalid = unique.filter(code => !/^[A-Z0-9]{2,10}$/.test(code));
  if (invalid.length) throw new Error('Códigos de almacén inválidos: ' + invalid.join(', ') + '. Use solo letras y números (2 a 10).');
  PropertiesService.getScriptProperties().setProperty('BARRIDO_ALMACENES', unique.join(','));
  applyWarehouseValidation_();
  return { warehouses: unique };
}
// Desplegable en la columna Almacen (H) de cada pestaña de centro; permite escribir otro valor con advertencia.
function applyWarehouseValidation_() {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(warehouses_(), true).setAllowInvalid(true)
    .setHelpText('Almacén del barrido: ' + warehouses_().join(', ')).build();
  centerSheets_().forEach(sh => sh.getRange(2, COL.Almacen + 1, Math.max(1, sh.getMaxRows() - 1), 1).setDataValidation(rule));
}
function aplicarListaDeAlmacenes() { applyWarehouseValidation_(); SpreadsheetApp.getActive().toast('Lista aplicada: ' + warehouses_().join(', ')); }
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📦 Barrido').addItem('Aplicar lista de almacenes', 'aplicarListaDeAlmacenes').addToUi();
}

// ---------------------------------------------------------------- hojas

function centerSheets_() { return spreadsheet_().getSheets().filter(sh => /^\d{4}$/.test(sh.getName())); }
function centerSheet_(center) {
  const code = centerCode_(center);
  const sh = spreadsheet_().getSheetByName(code);
  if (!sh) throw new Error('No existe la pestaña del centro ' + code + ' en la planilla de barrido.');
  const headers = sh.getRange(1, 1, 1, BARRIDO_COLUMNS.length).getValues()[0].map(h => String(h).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (headers[COL.SKU] !== 'sku' || headers[COL.Almacen] !== 'almacen' || headers[COL.Stock_Sistema] !== 'stocksistema')
    throw new Error('La pestaña ' + code + ' no tiene las 44 columnas del barrido (A Sku, H Almacen, L Stock Sistema).');
  return sh;
}
function rows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, BARRIDO_COLUMNS.length).getValues();
}
// Lo que la appweb guarda de una fila: las columnas del contrato que el barrido usa.
function rowToItem_(row, rowNumber) {
  const value = key => row[COL[key]];
  const n = key => number_(value(key), has_(value(key)) ? 0 : '');
  return {
    SKU: String(value('SKU')).trim(), Codigo_Barras: String(value('Codigo_Barras')).trim(), Descripcion: String(value('Descripcion')).trim(),
    Ubicacion: String(value('Ubicacion')).trim(), Ubicacion_1: String(value('Ubicacion_1')).trim(), Ubicacion_2: String(value('Ubicacion_2')).trim(),
    Almacen: identity_(value('Almacen')), Clasificacion_ABC: String(value('Clasificacion_ABC')).trim(), Unidad: String(value('Unidad')).trim(),
    Costo_Unitario: number_(value('Costo_Unitario'), 0), Stock_Sistema: number_(value('Stock_Sistema'), 0),
    Stock_Total: n('Stock_Total'), Stock_Buen_Estado: n('Stock_Buen_Estado'), Mal_estado: number_(value('Mal_estado'), 0),
    Diferencia: n('Diferencia'), Costo_Diferencia: n('Costo_Diferencia'),
    Fecha_Ultimo_Conteo: iso_(value('Fecha_Ultimo_Conteo')), Responsable: String(value('Responsable')).trim(),
    row: rowNumber
  };
}
function findRow_(rows, sku, almacen) {
  const target = identity_(sku), wh = identity_(almacen);
  const index = rows.findIndex(r => identity_(r[COL.SKU]) === target && (!wh || identity_(r[COL.Almacen]) === wh));
  return index < 0 ? null : { index, rowNumber: index + 2, row: rows[index] };
}

// ---------------------------------------------------------------- fotos

function rootFolder_() {
  const id = property_('BARRIDO_FOLDER_ID') || BARRIDO_DEFAULT_FOLDER_ID;
  try { return DriveApp.getFolderById(id); } catch (e) { throw new Error('No se pudo abrir la carpeta de barridos (' + id + ').'); }
}
function childFolder_(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
// "2026-11-17 · 1120 Volvo - Km 14"
function dayFolder_(center, date) {
  const code = centerCode_(center);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : Utilities.formatDate(new Date(), BARRIDO_TZ, 'yyyy-MM-dd');
  return childFolder_(rootFolder_(), day + ' · ' + code + ' ' + BARRIDO_CENTERS[code]);
}
function safeName_(value) { return String(value || '').trim().replace(/[\\/:*?"<>|#%]+/g, '_').slice(0, 80) || 'SIN_CODIGO'; }
// Archivo con el código ingresado. La misma foto enviada dos veces se reutiliza; otra foto del mismo código suma (2), (3)...
function savePhoto_(p) {
  const data = String(p.photoBase64 || '');
  const match = data.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) throw new Error('La foto no llegó en un formato válido.');
  const mime = match[1].toLowerCase(), bytes = Utilities.base64Decode(match[2]);
  const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
  const folder = dayFolder_(p.center || p.centro, p.date);
  const isJust = String(p.category || p.photoType || '').toLowerCase().indexOf('just') >= 0;
  const base = safeName_(p.code || p.sku || p.barcode) + (isJust ? ' - justificacion' : '');
  let name = base + ext, n = 1;
  while (true) {
    const same = folder.getFilesByName(name);
    if (!same.hasNext()) break;
    const existing = same.next();
    if (existing.getSize() === bytes.length) return photoInfo_(existing, folder);
    n += 1; name = base + ' (' + n + ')' + ext;
  }
  const file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  return photoInfo_(file, folder);
}
function photoInfo_(file, folder) {
  return { id: file.getId(), name: file.getName(), url: file.getUrl(), folder: folder.getName(), folderId: folder.getId() };
}

// ---------------------------------------------------------------- conteo

function upsertCount_(p) {
  const sh = centerSheet_(p.center || p.centro);
  const sku = String(p.sku || p.SKU || p.barcode || '').trim();
  if (!sku) throw new Error('Falta el código del producto.');
  const almacen = identity_(p.almacen || p.warehouse || p.Almacen);
  if (!almacen) throw new Error('Seleccione el almacén del barrido.');
  const allowed = warehouses_();
  if (allowed.length && allowed.indexOf(almacen) < 0) throw new Error('El almacén ' + almacen + ' no está en la lista del barrido (' + allowed.join(', ') + ').');

  const rows = rows_(sh);
  let found = findRow_(rows, sku, almacen);
  const now = new Date();
  let row;
  if (found) row = found.row.slice();
  else {
    row = BARRIDO_COLUMNS.map(() => '');
    row[COL.SKU] = sku;
    row[COL.Almacen] = almacen;
    row[COL.Stock_Sistema] = number_(p.stockSistema, 0);
    row[COL.Costo_Unitario] = number_(p.costoUnitario, 0);
    row[COL.Unidad] = p.unidad || 'PZA';
    row[COL.Clasificacion_ABC] = p.clasificacionAbc || '';
  }
  if (has_(p.barcode) && !has_(row[COL.Codigo_Barras])) row[COL.Codigo_Barras] = String(p.barcode).trim();
  if (has_(p.descripcion) && !has_(row[COL.Descripcion])) row[COL.Descripcion] = String(p.descripcion).trim();

  const location = identity_(p.location || p.Ubicacion);
  if (location) {
    const locations = [row[COL.Ubicacion], row[COL.Ubicacion_1], row[COL.Ubicacion_2]].map(identity_);
    if (locations.indexOf(location) < 0) {
      if (!locations[0]) row[COL.Ubicacion] = location;
      else if (!locations[1]) row[COL.Ubicacion_1] = location;
      else if (!locations[2]) row[COL.Ubicacion_2] = location;
      else throw new Error('El código ya tiene tres ubicaciones en ' + almacen + '.');
    }
  }

  if (has_(p.stockBuenEstado)) {
    const good = quantity_(p.stockBuenEstado, 'El conteo en buen estado');
    const bad = quantity_(has_(p.malEstado) ? p.malEstado : 0, 'El conteo en mal estado');
    const total = good + bad, system = number_(row[COL.Stock_Sistema], 0), cost = number_(row[COL.Costo_Unitario], 0);
    row[COL.Stock_Buen_Estado] = good;
    row[COL.Mal_estado] = bad;
    row[COL.Stock_Total] = total;
    row[COL.Cantidad_Fisica_Final] = total;
    row[COL.Diferencia] = total - system;
    row[COL.Costo_Diferencia] = (total - system) * cost;
    row[COL.Fecha_Ultimo_Conteo] = has_(p.fechaUltimoConteo) && !isNaN(new Date(p.fechaUltimoConteo)) ? new Date(p.fechaUltimoConteo) : now;
    row[COL.Responsable] = p.responsable || p.user || '';
  }

  // A new code takes the first empty row, so the sweep fills the tab from the top even after rows were cleared.
  const emptyIndex = found ? -1 : rows.findIndex(r => r.every(v => !has_(v)));
  const rowNumber = found ? found.rowNumber : emptyIndex >= 0 ? emptyIndex + 2 : Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(rowNumber, 1, 1, BARRIDO_COLUMNS.length).setValues([row]);

  const photos = [];
  if (has_(p.photoBase64)) photos.push(savePhoto_({ photoBase64: p.photoBase64, center: p.center, code: sku, category: 'malestado' }));
  if (has_(p.justificationPhoto)) photos.push(savePhoto_({ photoBase64: p.justificationPhoto, center: p.center, code: sku, category: 'justificaciones' }));
  if (photos.length) {
    const cell = sh.getRange(rowNumber, COL.SKU + 1);
    const note = [cell.getNote(), ...photos.map(photo => 'Foto: ' + photo.url)].filter(Boolean).join('\n');
    cell.setNote(note);
  }
  const item = rowToItem_(row, rowNumber);
  if (photos[0]) item.foto_mal_estado = photos[0].url;
  return { success: true, created: !found, item, photos };
}

// ---------------------------------------------------------------- archivo final

function createFinalFile_(p) {
  const code = centerCode_(p.center || p.driveRecord?.center);
  const sh = centerSheet_(code);
  const stamp = Utilities.formatDate(new Date(), BARRIDO_TZ, 'yyyyMMdd_HHmmss');
  const fileName = 'Inventario_BARRIDO_' + code + '_FINAL_' + stamp;
  const copy = SpreadsheetApp.create(fileName);
  const tab = sh.copyTo(copy).setName(code);
  copy.getSheets().filter(s => s.getSheetId() !== tab.getSheetId()).forEach(s => copy.deleteSheet(s));
  const file = DriveApp.getFileById(copy.getId());
  file.moveTo(dayFolder_(code));
  file.setDescription(JSON.stringify({ inventoryId: p.inventoryId || '', center: code, type: 'BARRIDO', closedAt: new Date().toISOString(),
    user: p.user || '', rows: Math.max(0, sh.getLastRow() - 1) }));
  return { success: true, fileId: copy.getId(), fileName, spreadsheetUrl: copy.getUrl() + '#gid=' + tab.getSheetId(), center: code, type: 'BARRIDO' };
}

// ---------------------------------------------------------------- operaciones (idempotentes)

function operationSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName('_NIBOL_SYNC');
  if (!sh) { sh = ss.insertSheet('_NIBOL_SYNC'); sh.appendRow(['Operacion', 'Resultado', 'Fecha', 'RequestHash']); sh.hideSheet(); }
  return sh;
}
function readOperation_(id) {
  const sh = operationSheet_();
  if (sh.getLastRow() < 2) return null;
  const found = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!found) return null;
  const values = sh.getRange(found.getRow(), 1, 1, 4).getValues()[0];
  return { result: JSON.parse(values[1]), hash: values[3] };
}
function confirmOperation_(id, hash, result) {
  const value = JSON.stringify(result);
  if (value.length > 45000) return;
  operationSheet_().appendRow([id, value, new Date(), hash]);
}

function dispatchRead_(p) {
  switch (p.action) {
    case 'ping': return { success: true, version: 'barrido-1' };
    case 'getWarehouses': return { success: true, warehouses: warehouses_() };
    case 'getItems': case 'getProducts': case 'readItems': {
      const sh = centerSheet_(p.center || p.centro);
      const items = rows_(sh).map((row, index) => rowToItem_(row, index + 2)).filter(item => item.SKU);
      return { success: true, items, warehouses: warehouses_() };
    }
    case 'diagnostic': return { success: true, version: 'barrido-1', warehouses: warehouses_(),
      sheets: centerSheets_().map(sh => ({ name: sh.getName(), rows: sh.getLastRow(), cols: sh.getLastColumn() })) };
    default: throw new Error('Acción no soportada: ' + p.action);
  }
}

function doGet() { return json_({ success: true, service: 'Barrido NIBOL', version: 'barrido-1' }); }

function doPost(e) {
  let lock;
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    authenticate_(body);
    if (['ping', 'getWarehouses', 'getItems', 'getProducts', 'readItems', 'diagnostic'].indexOf(body.action) >= 0) return json_(dispatchRead_(body));
    if (body.action === 'savePhoto' || body.action === 'uploadPhoto') {
      const photoLock = LockService.getUserLock();
      if (!photoLock.tryLock(25000)) return json_({ success: false, retryable: true, error: 'Servidor ocupado al guardar la foto. Reintente.' });
      try { return json_({ success: true, action: body.action, photo: savePhoto_(body) }); } finally { photoLock.releaseLock(); }
    }
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return json_({ success: false, retryable: true, error: 'Servidor ocupado. Reintente con el mismo operationId.' });
    const clean = { ...body }; delete clean.apiToken;
    const fingerprint = hash_(JSON.stringify(clean)), id = String(body.operationId || '');
    if (!id) throw new Error('Falta operationId');
    const previous = readOperation_(id);
    if (previous) {
      if (previous.hash !== fingerprint) throw new Error('operationId reutilizado con datos diferentes');
      return json_(previous.result);
    }
    let result;
    switch (body.action) {
      case 'upsertCount': result = upsertCount_(body); break;
      case 'setWarehouses': result = { success: true, ...setWarehouses_(body) }; break;
      case 'createFinalFile': result = createFinalFile_(body); break;
      default: throw new Error('Acción no soportada en barrido: ' + body.action);
    }
    confirmOperation_(id, fingerprint, result);
    return json_(result);
  } catch (err) {
    return json_({ success: false, error: err.message || String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}
