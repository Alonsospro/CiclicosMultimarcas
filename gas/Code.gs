/**
 * Google Apps Script - Webhook API para Inventarios
 * 
 * Actualizaciones realizadas:
 * - Columna R (18): Razón de Justificación (Razon)
 * - Columna S (19): Comentarios de la Justificación (Comentarios_Justificacion)
 * - Nueva acción doPost: "saveJustification" para guardar justificaciones directas
 * - Soporte en "upsertCount", "createFinalFile", "batchUpsertCounts" y sincronización general
 * - Función ensureColumns_ para asegurar encabezados en R y S automáticamente
 * - Todo lo existente se mantiene 100% intacto y funcional
 */

const CFG = {
  defaultCenterIfMissing: '1120',
  defaultSheetName: 'Inventario',
  headerRow: 1,
  dataStartRow: 2,
  driveRoots: {
    'CICLICO': '11N39_pZhy5iT8p7Y-zD9_C-V9eM7f0c1',
    'GENERAL': '1A9876543210ZYXWVUTSRQPONMLKJIHGF',
    'EXPRESS': '1B1234567890ABCDEFGHJKLMNPQRSTUVWX'
  }
};

const COL = {
  SKU: 1,                          // A
  Codigo_Barras: 2,                // B
  Descripcion: 3,                  // C
  Ubicacion: 4,                    // D
  Ubicacion_1: 5,                  // E
  Ubicacion_2: 6,                  // F
  Almacen: 7,                      // G
  Clasificacion_ABC: 8,            // H
  Unidad: 9,                       // I
  Costo_Unitario: 10,              // J
  Stock_Sistema: 11,               // K
  Stock_Fisico: 12,                // L
  Diferencia: 13,                  // M
  Costo_Diferencia: 14,            // N
  Fecha_Ultimo_Conteo: 15,         // O
  Responsable: 16,                 // P
  Mal_estado: 17,                  // Q
  Fecha_Primera_Justificacion: 18, // R
  Estado: 19,                      // S
  Razon: 20,                       // T
  Comentario_Justificacion: 21,    // U
  Responsable_Justificacion: 22,   // V
  Fecha_Reconteo: 23,              // W
  Reconteo: 24,                    // X
  Malestado_Reconteo: 25,          // Y
  Diferencia_Final: 26,            // Z
  Costo_Diferencia_Final: 27,      // AA
  Fecha_Justificacion_2: 28,       // AB
  Estado_Justificacion_2: 29,      // AC
  Razon_Justificacion_2: 30,       // AD
  Comentario_Justificacion_2: 31,  // AE
  Responsable_Justificacion_2: 32, // AF
  Fecha_Reconteo_2: 33,            // AG
  Reconteo_2: 34,                  // AH
  Malestado_Reconteo_2: 35,        // AI
  Diferencia_Final_2: 36,          // AJ
  Costo_Diferencia_Final_2: 37     // AK
};

const COL_HEADERS = [
  'SKU', 'Codigo_Barras', 'Descripcion', 'Ubicación', 'Ubicación 1', 'Ubicación 2',
  'Almacen', 'Clasificacion_ABC', 'Unidad', 'Costo_Unitario', 'Stock_Sistema',
  'Stock_Fisico', 'Diferencia', 'Costo_Diferencia', 'Fecha_Ultimo_Conteo', 'Responsable',
  'Mal_estado', 'FECHA PRIMERA JUSTIFICACION', 'Estado', 'Razón', 'Comentario Justificacion',
  'RESPONSABLE JUSTIFICACION', 'Fecha reconteo', 'RECONTEO', 'MALESTADO RECONTEO',
  'Diferencia Final', 'Costo Diferencia Final', 'FECHA JUSTIFICACION 2', 'ESTADO JUSTIFICACION 2',
  'Razón JUSTIFICACION 2', 'Comentario JustificaciON 2', 'RESPONSABLE JUSTIFICACION 2',
  'Fecha reconteo 2', 'RECONTEO 2', 'MALESTADO RECONTEO 2', 'Diferencia Final 2', 'Costo Diferencia Final 2'
];

// Regla 2: Lógica de Stock Efectivo según Mal Estado vs Conteo
function calculateEffectiveStock_(qty, damagedQty) {
  const d = (damagedQty !== null && damagedQty !== undefined && damagedQty !== '') ? Number(damagedQty) : 0;
  if (qty === null || qty === undefined || qty === '') {
    return d >= 1 ? d : null;
  }
  const c = Number(qty);
  if (c === 0 && d >= 1) return d;
  if (c >= 1) return c;
  return 0;
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'ping';

    if (action === 'ping') {
      return json_({
        success: true,
        message: 'GAS Inventory Webhook activo',
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'getItems' || action === 'getProducts' || action === 'readItems') {
      const center = p.center || p.centro || CFG.defaultCenterIfMissing;
      const sh = getCenterSheet_(center);
      const rows = readRowsAsObjects_(sh);
      return json_({ success: true, status: 'success', center, total: rows.length, items: rows, products: rows, rows: rows });
    }

    if (action === 'getHistory' || action === 'listFinalFiles') {
      const type = p.type || 'CICLICO';
      const center = p.center || null;
      const history = getHistory_(type, center);
      return json_({ success: true, count: history.length, history: history });
    }

    if (action === 'diagnostic') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = ss.getSheets().map(s => ({ name: s.getName(), rows: s.getLastRow(), cols: s.getLastColumn() }));
      return json_({
        success: true,
        spreadsheetName: ss.getName(),
        spreadsheetId: ss.getId(),
        sheets,
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'getReferencePhoto') {
      const sku = String(p.sku || '').trim();
      const photo = getReferencePhotoBySku_(sku);
      return json_({ success: true, sku, photo });
    }

    return json_({ success: false, error: `Accion GET no soportada: ${action}` });
  } catch (err) {
    return json_({ success: false, error: err.message, stack: err.stack });
  }
}

function getHistory_(type, center) {
  const results = [];
  try {
    const rootFolder = getRootFolderForType_(type || 'CICLICO');
    const targetCenters = center ? [center] : ['1120', '1300', 'WARNES', '1100', '1200'];

    targetCenters.forEach(c => {
      try {
        const cFolders = rootFolder.getFoldersByName(c);
        while (cFolders.hasNext()) {
          const cFolder = cFolders.next();
          const snapFolders = cFolder.getFoldersByName('Archivos Finales');
          while (snapFolders.hasNext()) {
            const sFolder = snapFolders.next();
            const files = sFolder.getFiles();
            while (files.hasNext()) {
              const f = files.next();
              results.push({
                fileId: f.getId(),
                fileName: f.getName(),
                driveUrl: f.getUrl(),
                spreadsheetUrl: f.getUrl(),
                center: c,
                type: type || 'CICLICO',
                closedAt: f.getDateCreated().toISOString(),
                closedBy: 'GAS / Drive',
                source: 'GOOGLE_DRIVE'
              });
            }
          }
        }
      } catch (e) {}
    });
  } catch (err) {}
  return results;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(30000);
  if (!locked) {
    return json_({ success: false, error: 'Servidor ocupado. Intenta de nuevo.' });
  }

  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(raw);
    const action = body.action || '';

    if (action === 'ping') {
      return json_({ success: true, message: 'GAS POST webhook activo', timestamp: new Date().toISOString() });
    }

    if (action === 'upsertCount') {
      const result = upsertCount_(body);
      return json_({ success: true, action, ...result });
    }

    if (action === 'batchUpsertCounts') {
      const result = batchUpsertCounts_(body);
      return json_({ success: true, action, ...result });
    }

    if (action === 'saveJustification') {
      const result = saveJustificationToSheet_(body);
      return json_({ success: true, action, ...result });
    }

    if (action === 'createFinalFile') {
      const result = createFinalFile_(body);
      return json_({ success: true, action, ...result });
    }

    if (action === 'getReferencePhoto') {
      const sku = String(body.sku || '').trim();
      const photo = getReferencePhotoBySku_(sku);
      return json_({ success: true, sku, photo });
    }

    return json_({ success: false, error: `Accion POST no soportada: ${action}` });
  } catch (err) {
    return json_({ success: false, error: err.message, stack: err.stack });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function upsertCount_(payload) {
  const center = String(payload.center || payload.centro || CFG.defaultCenterIfMissing).trim();
  const sku = String(payload.sku || payload.SKU || '').trim();
  const barcode = String(payload.barcode || payload.codigoBarras || payload.Codigo_Barras || '').trim();
  const location = String(payload.location || payload.ubicacion || payload.Ubicacion || '').trim();
  const isNewLocation = !!payload.isNewLocation;

  if (!sku && !barcode) {
    throw new Error('upsertCount requiere al menos sku o barcode');
  }

  const sh = getCenterSheet_(center);
  ensureColumns_(sh);

  let targetRow = null;
  let createdByNewLocation = false;

  if (location && !isNewLocation) {
    targetRow = findExactRow_(sh, sku, barcode, location);
  }

  if (!targetRow && !isNewLocation) {
    targetRow = findBySkuBarcode_(sh, sku, barcode);
  }

  if (isNewLocation) {
    const baseRow = targetRow || findBySkuBarcode_(sh, sku, barcode);
    if (!baseRow) {
      throw new Error(`No existe fila base para clonar la nueva ubicacion (${sku || barcode})`);
    }
    const newRowNumber = appendNewLocationFromRow_(sh, baseRow.rowNumber, payload);
    targetRow = { rowNumber: newRowNumber };
    createdByNewLocation = true;
  }

  if (!targetRow) {
    throw new Error(`No se encontro el producto en centro ${center}: SKU=${sku} Barcode=${barcode}`);
  }

  if (!createdByNewLocation) {
    updateExistingRow_(sh, targetRow.rowNumber, payload);
  }

  const photoSaved = saveDamagedPhotoIfAny_(payload, center, payload.type, sku || barcode);

  return {
    center,
    row: targetRow.rowNumber,
    sku,
    barcode,
    isNewLocation: createdByNewLocation,
    photoSaved
  };
}

function batchUpsertCounts_(payload) {
  const center = String(payload.center || payload.centro || CFG.defaultCenterIfMissing).trim();
  const updates = Array.isArray(payload.updates) ? payload.updates : [];
  const sh = getCenterSheet_(center);
  ensureColumns_(sh);

  let updatedCount = 0;
  let createdCount = 0;

  updates.forEach(item => {
    try {
      const res = upsertCount_({
        center,
        type: payload.type,
        ...item
      });
      if (res.isNewLocation) createdCount++;
      else updatedCount++;
    } catch (e) {
      // continua con los demas
    }
  });

  return { center, total: updates.length, updatedCount, createdCount };
}

function saveJustificationToSheet_(payload) {
  const center = String(payload.center || payload.centro || CFG.defaultCenterIfMissing).trim();
  const sku = String(payload.sku || payload.SKU || '').trim();
  const razon = String(payload.razon || payload.reasonType || payload.razonJustificacion || payload.Razon || 'AJUSTE_INVENTARIO').trim();
  const comentarioJust = String(payload.comentarioJustificacion || payload.justification || payload.comentariosJustificacion || payload.Comentario_Justificacion || '').trim();

  if (!sku) throw new Error('saveJustification requiere sku');

  const sh = getCenterSheet_(center);
  ensureColumns_(sh);

  const found = findBySkuBarcode_(sh, sku, '');
  if (!found) {
    throw new Error(`Ítem ${sku} no encontrado en centro ${center}`);
  }

  const row = sh.getRange(found.rowNumber, 1, 1, COL.Comentario_Justificacion).getValues()[0];
  row[COL.Razon - 1] = razon;
  row[COL.Comentario_Justificacion - 1] = comentarioJust;
  row[COL.Estado - 1] = 'Justificado';
  sh.getRange(found.rowNumber, 1, 1, COL.Comentario_Justificacion).setValues([row]);

  return { center, row: found.rowNumber, sku, razon, comentarioJustificacion: comentarioJust, updated: true };
}

function createFinalFile_(payload) {
  const centerCode = String(payload.center || payload.centro || CFG.defaultCenterIfMissing).trim();
  const type = String(payload.type || 'CICLICO').toUpperCase();
  const driveRecord = payload.driveRecord || {};

  const rootFolder = getRootFolderForType_(type);
  const centerFolder = getOrCreateFolder_(rootFolder, centerCode);
  const snapshotFolder = getOrCreateFolder_(centerFolder, 'Archivos Finales');

  const activeSs = SpreadsheetApp.getActiveSpreadsheet();
  const fileName = buildFinalSpreadsheetName_(type, centerCode);

  const copyFile = DriveApp.getFileById(activeSs.getId()).makeCopy(fileName, snapshotFolder);
  const copySs = SpreadsheetApp.openById(copyFile.getId());
  const sh = getCenterSheetFromSs_(copySs, centerCode);
  ensureColumns_(sh);

  const incomingItems = (Array.isArray(driveRecord.items) && driveRecord.items.length)
    ? driveRecord.items
    : (Array.isArray(payload.items) ? payload.items : []);

  if (incomingItems.length) {
    syncFromDriveRecordItems_(sh, incomingItems, centerCode, type);
  }

  const justifications = Array.isArray(driveRecord.justifications)
    ? driveRecord.justifications
    : (Array.isArray(payload.justifications) ? payload.justifications : []);
  const justifSaved = saveJustificationPhotosBatch_(justifications, centerCode);

  if (justifications.length) {
    applyJustificationsToSheet_(sh, justifications);
  }

  return {
    fileId: copyFile.getId(),
    fileName: copyFile.getName(),
    spreadsheetUrl: copyFile.getUrl(),
    folderId: snapshotFolder.getId(),
    center: centerCode,
    type,
    itemsSynced: incomingItems.length,
    justificationsSaved: justifSaved
  };
}

function applyJustificationsToSheet_(sheet, justifications) {
  if (!justifications || !justifications.length) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  ensureColumns_(sheet);
  const range = sheet.getRange(2, 1, lastRow - 1, COL.Comentario_Justificacion);
  const values = range.getValues();

  const justMap = new Map();
  justifications.forEach(j => {
    const sku = norm_(j.sku || j.SKU || '');
    if (sku) {
      justMap.set(sku, {
        razon: String(j.reasonType || j.razon || j.Razon || j.razonJustificacion || 'AJUSTE_INVENTARIO'),
        comentario: String(j.justification || j.comentario || j.Comentario_Justificacion || j.comentarioJustificacion || '')
      });
    }
  });

  let modified = false;
  for (let i = 0; i < values.length; i++) {
    const rowSku = norm_(values[i][COL.SKU - 1]);
    if (justMap.has(rowSku)) {
      const justData = justMap.get(rowSku);
      values[i][COL.Razon - 1] = justData.razon;
      values[i][COL.Comentario_Justificacion - 1] = justData.comentario;
      if (!values[i][COL.Estado - 1] || values[i][COL.Estado - 1] === 'Pendiente' || values[i][COL.Estado - 1] === 'Contado') {
        values[i][COL.Estado - 1] = 'Justificado';
      }
      modified = true;
    }
  }

  if (modified) {
    range.setValues(values);
  }
}

function getCenterSheet_(center) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return getCenterSheetFromSs_(ss, center);
}

function getCenterSheetFromSs_(ss, center) {
  const cleanCenter = String(center || '').trim();

  let sh = ss.getSheetByName(cleanCenter);
  if (sh) return sh;

  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName().trim();
    if (name.toUpperCase().indexOf(cleanCenter.toUpperCase()) !== -1) {
      return sheets[i];
    }
  }

  sh = ss.getSheetByName(CFG.defaultSheetName);
  if (sh) return sh;

  return ss.getSheets()[0];
}

function ensureColumns_(sheet) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < COL.Costo_Diferencia_Final_2) {
    sheet.insertColumnsAfter(maxCols, COL.Costo_Diferencia_Final_2 - maxCols);
  }
  if (sheet.getLastRow() >= 1) {
    const headerRange = sheet.getRange(1, 1, 1, COL.Costo_Diferencia_Final_2);
    const headers = headerRange.getValues()[0];
    let needsUpdate = false;
    for (let c = 0; c < COL_HEADERS.length; c++) {
      if (!headers[c] || String(headers[c]).trim() === '') {
        headers[c] = COL_HEADERS[c];
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      headerRange.setValues([headers]);
    }
  }
}

function findExactRow_(sheet, sku, barcode, location) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  ensureColumns_(sheet);
  const data = sheet.getRange(2, 1, lastRow - 1, COL.Costo_Diferencia_Final_2).getValues();
  const sTarget = norm_(sku);
  const bTarget = norm_(barcode);
  const lTarget = norm_(location);

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const s = norm_(r[COL.SKU - 1]);
    const b = norm_(r[COL.Codigo_Barras - 1]);
    const loc = norm_(r[COL.Ubicacion - 1]);

    const matchSku = sTarget && s === sTarget;
    const matchBar = bTarget && b === bTarget;
    const matchLoc = !lTarget || loc === lTarget;

    if ((matchSku || matchBar) && matchLoc) {
      return { rowNumber: i + 2, row: r };
    }
  }
  return null;
}

function findBySkuBarcode_(sheet, sku, barcode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  ensureColumns_(sheet);
  const data = sheet.getRange(2, 1, lastRow - 1, COL.Costo_Diferencia_Final_2).getValues();
  const sTarget = norm_(sku);
  const bTarget = norm_(barcode);

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const s = norm_(r[COL.SKU - 1]);
    const b = norm_(r[COL.Codigo_Barras - 1]);

    if ((sTarget && s === sTarget) || (bTarget && b === bTarget)) {
      return { rowNumber: i + 2, row: r };
    }
  }
  return null;
}

function updateExistingRow_(sheet, rowNumber, data) {
  ensureColumns_(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, COL.Costo_Diferencia_Final_2).getValues()[0];

  const stockSistema = num_(row[COL.Stock_Sistema - 1]);
  const costoUnitario = num_(row[COL.Costo_Unitario - 1]);

  const stockFisico = hasValue_(data.stockFisico) ? num_(data.stockFisico) : (hasValue_(row[COL.Stock_Fisico - 1]) ? num_(row[COL.Stock_Fisico - 1]) : null);
  const malEstado = hasValue_(data.malEstado) ? num_(data.malEstado) : num_(row[COL.Mal_estado - 1]);

  // Conteo 1 & Regla 2: Stock Efectivo
  if (stockFisico !== null) {
    const eff1 = calculateEffectiveStock_(stockFisico, malEstado);
    const dif1 = eff1 !== null ? (eff1 - stockSistema) : 0;
    row[COL.Stock_Fisico - 1] = stockFisico;
    row[COL.Diferencia - 1] = dif1;
    row[COL.Costo_Diferencia - 1] = dif1 * costoUnitario;
    row[COL.Fecha_Ultimo_Conteo - 1] = data.fechaUltimoConteo ? new Date(data.fechaUltimoConteo) : new Date();
    row[COL.Responsable - 1] = data.responsable || data.username || row[COL.Responsable - 1] || '';
    row[COL.Mal_estado - 1] = malEstado;
    row[COL.Estado - 1] = dif1 === 0 ? 'CUADRA' : 'NO CUADRA';
  }

  // Ubicaciones adicionales
  if (data.ubicacion1 || data.Ubicacion_1) row[COL.Ubicacion_1 - 1] = data.ubicacion1 || data.Ubicacion_1;
  if (data.ubicacion2 || data.Ubicacion_2) row[COL.Ubicacion_2 - 1] = data.ubicacion2 || data.Ubicacion_2;
  if (data.almacen || data.Almacen) row[COL.Almacen - 1] = data.almacen || data.Almacen;

  // Justificación 1
  if (hasValue_(data.fechaPrimeraJustificacion)) row[COL.Fecha_Primera_Justificacion - 1] = new Date(data.fechaPrimeraJustificacion);
  if (hasValue_(data.razon)) row[COL.Razon - 1] = data.razon;
  if (hasValue_(data.comentarioJustificacion)) row[COL.Comentario_Justificacion - 1] = data.comentarioJustificacion;
  if (hasValue_(data.responsableJustificacion)) row[COL.Responsable_Justificacion - 1] = data.responsableJustificacion;
  if (hasValue_(data.estado)) row[COL.Estado - 1] = data.estado;

  // Reconteo 1 (Regla 1: cálculos solo si hay reconteo)
  if (hasValue_(data.reconteo) && data.reconteo !== '') {
    const rec1 = num_(data.reconteo);
    const malRec1 = hasValue_(data.malestadoReconteo) ? num_(data.malestadoReconteo) : 0;
    const effRec1 = calculateEffectiveStock_(rec1, malRec1);
    const difRec1 = effRec1 !== null ? (effRec1 - stockSistema) : null;
    row[COL.Reconteo - 1] = rec1;
    row[COL.Malestado_Reconteo - 1] = malRec1;
    row[COL.Fecha_Reconteo - 1] = data.fechaReconteo ? new Date(data.fechaReconteo) : new Date();
    row[COL.Diferencia_Final - 1] = difRec1;
    row[COL.Costo_Diferencia_Final - 1] = difRec1 !== null ? (difRec1 * costoUnitario) : '';
  }

  // Justificación 2
  if (hasValue_(data.fechaJustificacion2)) row[COL.Fecha_Justificacion_2 - 1] = new Date(data.fechaJustificacion2);
  if (hasValue_(data.estadoJustificacion2)) row[COL.Estado_Justificacion_2 - 1] = data.estadoJustificacion2;
  if (hasValue_(data.razonJustificacion2)) row[COL.Razon_Justificacion_2 - 1] = data.razonJustificacion2;
  if (hasValue_(data.comentarioJustificacion2)) row[COL.Comentario_Justificacion_2 - 1] = data.comentarioJustificacion2;
  if (hasValue_(data.responsableJustificacion2)) row[COL.Responsable_Justificacion_2 - 1] = data.responsableJustificacion2;

  // Reconteo 2 (Regla 1: cálculos solo si hay reconteo 2)
  if (hasValue_(data.reconteo2) && data.reconteo2 !== '') {
    const rec2 = num_(data.reconteo2);
    const malRec2 = hasValue_(data.malestadoReconteo2) ? num_(data.malestadoReconteo2) : 0;
    const effRec2 = calculateEffectiveStock_(rec2, malRec2);
    const difRec2 = effRec2 !== null ? (effRec2 - stockSistema) : null;
    row[COL.Reconteo_2 - 1] = rec2;
    row[COL.Malestado_Reconteo_2 - 1] = malRec2;
    row[COL.Fecha_Reconteo_2 - 1] = data.fechaReconteo2 ? new Date(data.fechaReconteo2) : new Date();
    row[COL.Diferencia_Final_2 - 1] = difRec2;
    row[COL.Costo_Diferencia_Final_2 - 1] = difRec2 !== null ? (difRec2 * costoUnitario) : '';
  }

  sheet.getRange(rowNumber, 1, 1, COL.Costo_Diferencia_Final_2).setValues([row]);
}

function appendNewLocationFromRow_(sheet, sourceRowNumber, data) {
  ensureColumns_(sheet);
  const source = sheet.getRange(sourceRowNumber, 1, 1, COL.Costo_Diferencia_Final_2).getValues()[0];
  const row = source.slice();

  const stockSistema = 0; // Ubicación adicional stock sistema es 0
  const costoUnitario = num_(row[COL.Costo_Unitario - 1]);

  const nuevaUbicacion = String(
    data.newLocation || data.nuevaUbicacion || data.location || data.ubicacion || row[COL.Ubicacion - 1]
  ).trim();

  const stockFisico = hasValue_(data.stockFisico) ? num_(data.stockFisico) : 0;
  const malEstado = hasValue_(data.malEstado) ? num_(data.malEstado) : 0;
  const eff = calculateEffectiveStock_(stockFisico, malEstado);
  const dif = eff !== null ? (eff - stockSistema) : 0;

  row[COL.Ubicacion - 1] = nuevaUbicacion;
  row[COL.Stock_Sistema - 1] = 0;
  row[COL.Stock_Fisico - 1] = stockFisico;
  row[COL.Diferencia - 1] = dif;
  row[COL.Costo_Diferencia - 1] = dif * costoUnitario;
  row[COL.Fecha_Ultimo_Conteo - 1] = data.fechaUltimoConteo ? new Date(data.fechaUltimoConteo) : new Date();
  row[COL.Responsable - 1] = data.responsable || data.username || row[COL.Responsable - 1] || '';
  row[COL.Estado - 1] = dif === 0 ? 'CUADRA' : 'NO CUADRA';
  row[COL.Mal_estado - 1] = malEstado;

  sheet.appendRow(row);
  return sheet.getLastRow();
}

function syncFromDriveRecordItems_(sheet, items, center, type) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !items || !items.length) return;

  ensureColumns_(sheet);
  const range = sheet.getRange(2, 1, lastRow - 1, COL.Costo_Diferencia_Final_2);
  const values = range.getValues();

  const rowMap = new Map();
  const skuMap = new Map();

  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const s = norm_(r[COL.SKU - 1]);
    const b = norm_(r[COL.Codigo_Barras - 1]);
    const u = norm_(r[COL.Ubicacion - 1]);

    const fullKey = `${s}|${b}|${u}`;
    if (!rowMap.has(fullKey)) rowMap.set(fullKey, i);

    const skuBarKey = `${s}|${b}`;
    if (!rowMap.has(skuBarKey)) rowMap.set(skuBarKey, i);

    if (s && !skuMap.has(s)) skuMap.set(s, i);
  }

  let hasUpdates = false;

  items.forEach(it => {
    const sku = String(it.SKU || it.sku || '').trim();
    const barcode = String(it.Codigo_Barras || it.codigoBarras || it.barcode || '').trim();
    const ubicacion = String(it.Ubicacion || it.ubicacion || '').trim();
    if (!sku && !barcode) return;

    const sNorm = norm_(sku);
    const bNorm = norm_(barcode);
    const uNorm = norm_(ubicacion);

    let rowIndex = -1;
    if (uNorm && rowMap.has(`${sNorm}|${bNorm}|${uNorm}`)) {
      rowIndex = rowMap.get(`${sNorm}|${bNorm}|${uNorm}`);
    } else if (rowMap.has(`${sNorm}|${bNorm}`)) {
      rowIndex = rowMap.get(`${sNorm}|${bNorm}`);
    } else if (skuMap.has(sNorm)) {
      rowIndex = skuMap.get(sNorm);
    }

    if (rowIndex >= 0) {
      const row = values[rowIndex];
      const stockSistema = num_(row[COL.Stock_Sistema - 1]);
      const costoUnitario = num_(row[COL.Costo_Unitario - 1]);

      const stockFisico = hasValue_(it.Stock_Fisico) ? num_(it.Stock_Fisico) : (hasValue_(it.stockFisico) ? num_(it.stockFisico) : null);
      const malEstado = hasValue_(it.Mal_estado) ? num_(it.Mal_estado) : (hasValue_(it.malEstado) ? num_(it.malEstado) : 0);

      if (stockFisico !== null) {
        const eff1 = calculateEffectiveStock_(stockFisico, malEstado);
        const dif1 = eff1 !== null ? (eff1 - stockSistema) : 0;
        row[COL.Stock_Fisico - 1] = stockFisico;
        row[COL.Diferencia - 1] = dif1;
        row[COL.Costo_Diferencia - 1] = dif1 * costoUnitario;
        row[COL.Fecha_Ultimo_Conteo - 1] = it.Fecha_Ultimo_Conteo ? new Date(it.Fecha_Ultimo_Conteo) : new Date();
        row[COL.Responsable - 1] = it.Responsable || it.responsable || row[COL.Responsable - 1] || '';
        row[COL.Mal_estado - 1] = malEstado;
        row[COL.Estado - 1] = dif1 === 0 ? 'CUADRA' : 'NO CUADRA';
      }

      // Ubicaciones 1 y 2
      if (it.Ubicacion_1 || it.ubicacion1) row[COL.Ubicacion_1 - 1] = it.Ubicacion_1 || it.ubicacion1;
      if (it.Ubicacion_2 || it.ubicacion2) row[COL.Ubicacion_2 - 1] = it.Ubicacion_2 || it.ubicacion2;
      if (it.Almacen || it.almacen) row[COL.Almacen - 1] = it.Almacen || it.almacen || center;

      // Justificación 1
      if (hasValue_(it.Fecha_Primera_Justificacion)) row[COL.Fecha_Primera_Justificacion - 1] = new Date(it.Fecha_Primera_Justificacion);
      if (hasValue_(it.Razon || it.razon)) row[COL.Razon - 1] = it.Razon || it.razon;
      if (hasValue_(it.Comentario_Justificacion || it.comentarioJustificacion)) row[COL.Comentario_Justificacion - 1] = it.Comentario_Justificacion || it.comentarioJustificacion;
      if (hasValue_(it.Responsable_Justificacion || it.responsableJustificacion)) row[COL.Responsable_Justificacion - 1] = it.Responsable_Justificacion || it.responsableJustificacion;
      if (hasValue_(it.Estado)) row[COL.Estado - 1] = it.Estado;

      // Reconteo 1 (Regla 1: cálculos condicionales)
      if (hasValue_(it.Reconteo) && it.Reconteo !== '') {
        const rec1 = num_(it.Reconteo);
        const malRec1 = hasValue_(it.Malestado_Reconteo) ? num_(it.Malestado_Reconteo) : 0;
        const effRec1 = calculateEffectiveStock_(rec1, malRec1);
        const difRec1 = effRec1 !== null ? (effRec1 - stockSistema) : null;
        row[COL.Reconteo - 1] = rec1;
        row[COL.Malestado_Reconteo - 1] = malRec1;
        row[COL.Fecha_Reconteo - 1] = it.Fecha_Reconteo ? new Date(it.Fecha_Reconteo) : new Date();
        row[COL.Diferencia_Final - 1] = difRec1;
        row[COL.Costo_Diferencia_Final - 1] = difRec1 !== null ? (difRec1 * costoUnitario) : '';
      }

      // Justificación 2
      if (hasValue_(it.Fecha_Justificacion_2)) row[COL.Fecha_Justificacion_2 - 1] = new Date(it.Fecha_Justificacion_2);
      if (hasValue_(it.Estado_Justificacion_2)) row[COL.Estado_Justificacion_2 - 1] = it.Estado_Justificacion_2;
      if (hasValue_(it.Razon_Justificacion_2)) row[COL.Razon_Justificacion_2 - 1] = it.Razon_Justificacion_2;
      if (hasValue_(it.Comentario_Justificacion_2)) row[COL.Comentario_Justificacion_2 - 1] = it.Comentario_Justificacion_2;
      if (hasValue_(it.Responsable_Justificacion_2)) row[COL.Responsable_Justificacion_2 - 1] = it.Responsable_Justificacion_2;

      // Reconteo 2 (Regla 1: cálculos condicionales)
      if (hasValue_(it.Reconteo_2) && it.Reconteo_2 !== '') {
        const rec2 = num_(it.Reconteo_2);
        const malRec2 = hasValue_(it.Malestado_Reconteo_2) ? num_(it.Malestado_Reconteo_2) : 0;
        const effRec2 = calculateEffectiveStock_(rec2, malRec2);
        const difRec2 = effRec2 !== null ? (effRec2 - stockSistema) : null;
        row[COL.Reconteo_2 - 1] = rec2;
        row[COL.Malestado_Reconteo_2 - 1] = malRec2;
        row[COL.Fecha_Reconteo_2 - 1] = it.Fecha_Reconteo_2 ? new Date(it.Fecha_Reconteo_2) : new Date();
        row[COL.Diferencia_Final_2 - 1] = difRec2;
        row[COL.Costo_Diferencia_Final_2 - 1] = difRec2 !== null ? (difRec2 * costoUnitario) : '';
      }

      hasUpdates = true;
      saveDamagedPhotoIfAny_(it, center, type, sku);
    }
  });

  if (hasUpdates) {
    range.setValues(values);
  }
}

function readRowsAsObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  ensureColumns_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, COL.Costo_Diferencia_Final_2).getValues();
  return values.map(rowToObject_);
}

function rowToObject_(r) {
  return {
    SKU: r[COL.SKU - 1],
    Codigo_Barras: r[COL.Codigo_Barras - 1],
    Descripcion: r[COL.Descripcion - 1],
    Ubicacion: r[COL.Ubicacion - 1],
    Ubicacion_1: r[COL.Ubicacion_1 - 1],
    Ubicacion_2: r[COL.Ubicacion_2 - 1],
    Almacen: r[COL.Almacen - 1],
    Clasificacion_ABC: r[COL.Clasificacion_ABC - 1],
    Unidad: r[COL.Unidad - 1],
    Costo_Unitario: r[COL.Costo_Unitario - 1],
    Stock_Sistema: r[COL.Stock_Sistema - 1],
    Stock_Fisico: r[COL.Stock_Fisico - 1],
    Diferencia: r[COL.Diferencia - 1],
    Costo_Diferencia: r[COL.Costo_Diferencia - 1],
    Fecha_Ultimo_Conteo: r[COL.Fecha_Ultimo_Conteo - 1],
    Responsable: r[COL.Responsable - 1],
    Mal_estado: r[COL.Mal_estado - 1],
    Fecha_Primera_Justificacion: r[COL.Fecha_Primera_Justificacion - 1],
    Estado: r[COL.Estado - 1],
    Razon: r[COL.Razon - 1] || '',
    Comentario_Justificacion: r[COL.Comentario_Justificacion - 1] || '',
    Responsable_Justificacion: r[COL.Responsable_Justificacion - 1] || '',
    Fecha_Reconteo: r[COL.Fecha_Reconteo - 1],
    Reconteo: r[COL.Reconteo - 1],
    Malestado_Reconteo: r[COL.Malestado_Reconteo - 1],
    Diferencia_Final: r[COL.Diferencia_Final - 1],
    Costo_Diferencia_Final: r[COL.Costo_Diferencia_Final - 1],
    Fecha_Justificacion_2: r[COL.Fecha_Justificacion_2 - 1],
    Estado_Justificacion_2: r[COL.Estado_Justificacion_2 - 1],
    Razon_Justificacion_2: r[COL.Razon_Justificacion_2 - 1],
    Comentario_Justificacion_2: r[COL.Comentario_Justificacion_2 - 1],
    Responsable_Justificacion_2: r[COL.Responsable_Justificacion_2 - 1],
    Fecha_Reconteo_2: r[COL.Fecha_Reconteo_2 - 1],
    Reconteo_2: r[COL.Reconteo_2 - 1],
    Malestado_Reconteo_2: r[COL.Malestado_Reconteo_2 - 1],
    Diferencia_Final_2: r[COL.Diferencia_Final_2 - 1],
    Costo_Diferencia_Final_2: r[COL.Costo_Diferencia_Final_2 - 1]
  };
}

function getReferencePhotoBySku_(sku) {
  if (!sku) return null;

  try {
    const files = DriveApp.searchFiles(`title contains '${sku}' and mimeType contains 'image/' and trashed = false`);
    if (files.hasNext()) {
      const f = files.next();
      return {
        id: f.getId(),
        name: f.getName(),
        mimeType: f.getMimeType(),
        viewUrl: f.getUrl(),
        downloadUrl: `https://drive.google.com/uc?export=view&id=${f.getId()}`,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${f.getId()}&sz=w800`
      };
    }
  } catch (err) {
    Logger.log('Error buscando foto de referencia: ' + err.message);
  }

  return null;
}

function saveDamagedPhotoIfAny_(payload, center, type, skuOrBar) {
  const photo = payload.photoBase64 || payload.photoUrl || payload.foto_mal_estado;
  if (!photo) return null;

  try {
    const rootFolder = getRootFolderForType_(type || 'CICLICO');
    const centerFolder = getOrCreateFolder_(rootFolder, center || CFG.defaultCenterIfMissing);
    const damagedFolder = getOrCreateFolder_(centerFolder, 'Fotos Dañados');

    const cleanSku = String(skuOrBar || 'SKU').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const fileName = `Dañado_${cleanSku}_${dateTag}.jpg`;

    return saveBase64Image_(damagedFolder, fileName, photo);
  } catch (err) {
    Logger.log('Error guardando foto danado: ' + err.message);
    return null;
  }
}

function saveJustificationPhotosBatch_(justifications, center) {
  if (!justifications || !justifications.length) return 0;

  let saved = 0;
  try {
    const rootFolder = getRootFolderForType_('CICLICO');
    const centerFolder = getOrCreateFolder_(rootFolder, center || CFG.defaultCenterIfMissing);
    const justFolder = getOrCreateFolder_(centerFolder, 'Fotos Justificaciones');

    justifications.forEach(j => {
      const photo = j.photoBase64 || j.photoUrl;
      if (!photo) return;

      const sku = String(j.sku || j.SKU || 'SKU').replace(/[^a-zA-Z0-9_-]/g, '_');
      const dateTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
      const fileName = `Just_${sku}_${dateTag}.jpg`;

      const f = saveBase64Image_(justFolder, fileName, photo);
      if (f) saved++;
    });
  } catch (err) {
    Logger.log('Error batch fotos justificaciones: ' + err.message);
  }

  return saved;
}

function saveBase64Image_(folder, fileName, dataUriOrBase64) {
  let base64 = String(dataUriOrBase64 || '').trim();
  if (!base64) return null;

  let mimeType = 'image/jpeg';
  if (base64.indexOf(';base64,') !== -1) {
    const parts = base64.split(';base64,');
    const meta = parts[0];
    base64 = parts[1];
    if (meta.indexOf('image/png') !== -1) mimeType = 'image/png';
    else if (meta.indexOf('image/webp') !== -1) mimeType = 'image/webp';
  }

  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: file.getId(),
    name: file.getName(),
    url: file.getUrl()
  };
}

function getRootFolderForType_(type) {
  const cleanType = String(type || 'CICLICO').toUpperCase();
  const folderId = CFG.driveRoots[cleanType] || CFG.driveRoots['CICLICO'];

  try {
    return DriveApp.getFolderById(folderId);
  } catch (e) {
    return DriveApp.getRootFolder();
  }
}

function getOrCreateFolder_(parentFolder, folderName) {
  const it = parentFolder.getFoldersByName(folderName);
  if (it.hasNext()) {
    return it.next();
  }
  return parentFolder.createFolder(folderName);
}

function buildFinalSpreadsheetName_(type, center) {
  const dateTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  return `Inventario_${type}_${center}_FINAL_${dateTag}`;
}

function inferEstado_(dif, malEstado) {
  if (malEstado > 0) return 'Dañado';
  if (dif === 0) return 'Correcto';
  return 'Diferencia';
}


function hasValue_(v) {
  return v !== undefined && v !== null && v !== '';
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function norm_(v) {
  return String(v || '').trim().toUpperCase();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
