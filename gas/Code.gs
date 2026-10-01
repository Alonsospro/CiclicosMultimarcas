/**
 * Google Apps Script - Webhook API para Inventarios & Barrido
 * 
 * Estructura de Columnas (40 Columnas - A a AN):
 * A (1): SKU
 * B (2): Codigo_Barras
 * C (3): Descripcion
 * D (4): Ubicación (UBICACIÓN ORIGINAL)
 * E (5): Ubicación 1 (UBICACIÓN EXTRA 1)
 * F (6): Ubicación 2 (UBICACIÓN EXTRA 2)
 * G (7): Almacen (ALMCEN)
 * H (8): Clasificacion_ABC (ABC)
 * I (9): Unidad
 * J (10): Costo_Unitario (COSTO)
 * K (11): Stock_Sistema (STOCK DE SISTEMA)
 * L (12): STOCK TOTAL (cantidad total de la suma items en buen estado y mal estado del primer conteo)
 * M (13): stock B/E (BUEN ESTADO DEL PRIMER CONTEO)
 * N (14): stock M/E (MAL ESTADO DEL PRIMER CONTEO)
 * O (15): Diferencia (RESULTADO DE DIFERENCIA ENTRE STOCK FISICO Y PRIMER CONTEO)
 * P (16): Costo_Diferencia (RESULTADO DE MULTIPLICACION DE DIFERENCIA POR EL COSTO UNITARIO)
 * Q (17): Fecha_Ultimo_Conteo (FECHA Y HORA DEL PRIMER CONTEO)
 * R (18): Responsable (EL QUE HAYA CONTADO/COMPLETADO EL PRIMER CONTEO)
 * S (19): FECHA PRIMERA JUSTIFICACION (FECHA Y HORA DE LA PRIMERA JUSTIFICACION)
 * T (20): Estado (ESTADO DE LA PRIMERA JUSTIFICACION (CUADRA - NO CUADRA))
 * U (21): Razón (TIPO DE JUSTIFICACION)
 * V (22): Comentario Justificacion (DETALLE DE JUSTIFICACION)
 * W (23): RESPONSABLE JUSTIFICACION (NOMBRE DEL RESPONSABLE QUE REVISA EL PRIMER CONTEO)
 * X (24): Fecha reconteo (FECHA Y HORA DEL PRIMER RECONTEO)
 * Y (25): stock total reconteo (cantidad total de la suma de items en buen estado y mal estado del reconteo)
 * Z (26): RECONTEO (buen estado del primer reconteo)
 * AA (27): MALESTADO RECONTEO (MAL ESTADO DEL PRIMER RECONTEO)
 * AB (28): Diferencia Final (DIFERENCIA ENTRE EL PRIMER RECONTEO Y EL STOCK DE SISTEMA)
 * AC (29): Costo Diferencia Final (RESULTADO DE MULTIPLICACION DE DIFERENCIA FINAL PRIMER RECONTEO POR EL COSTO UNITARIO)
 * AD (30): FECHA JUSTIFICACION 2 (FECHA Y HORA DE LA SEGUNDA JUSTIFICACION)
 * AE (31): ESTADO JUSTIFICACION 2 (ESTADO DE LA SEGUNDA JUSTIFICACION (CUADRA - NO CUADRA))
 * AF (32): RazónJUSTIFICACION 2 (TIPO DE JUSTIFICACION 2)
 * AG (33): Comentario JustificaciON 2 (DETALLE DE SEGUNDA JUSTIFICACION)
 * AH (34): RESPONSABLE JUSTIFICACION 2 (NOMBRE DEL RESPONSABLE QUE REVISA EL PRIMER RECONTEO)
 * AI (35): Fecha reconteo 2 (FECHA Y HORA DEL SEGUNDO RECONTEO)
 * AJ (36): stock total reconteo 2 (cantidad total de la suma de items en buen estado y mal estado del segundo reconteo)
 * AK (37): RECONTEO 2 (CANTIDAD TOTAL DEL SEGUNDO RECONTEO)
 * AL (38): MALESTADO RECONTEO 2 (MAL ESTADO DEL SEGUNDO RECONTEO)
 * AM (39): Diferencia Final 2 (DIFERENCIA ENTRE EL SEGUNDO RECONTEO Y EL STOCK DE SISTEMA)
 * AN (40): Costo Diferencia Final 2 (RESULTADO DE MULTIPLICACION DE DIFERENCIA FINAL SEGUNDO RECONTEO POR EL COSTO UNITARIO)
 * 
 * Características:
 * - Soporta hasta 2 ubicaciones adicionales (Ubicación 1 en Col E, Ubicación 2 en Col F) dentro de la misma fila.
 * - Ya no genera filas duplicadas ni ingresos paralelos de conteo o mal estado por ubicación adicional.
 * - Al marcar como "CUADRA" en justificación, reescribe la Columna K (Stock_Sistema) con el Stock Físico/Total y pone Diferencia en 0.
 * - Sincronización bidireccional con la aplicación web.
 * - Guardado jerárquico de fotos en Google Drive (malestado y justificaciones).
 */

const CFG = {
  defaultCenterIfMissing: '1120',
  defaultSheetName: 'Inventario',
  headerRow: 1,
  dataStartRow: 2,
  driveRoots: {
    'CICLICO': '11N39_pZhy5iT8p7Y-zD9_C-V9eM7f0c1',
    'GENERAL': '1A9876543210ZYXWVUTSRQPONMLKJIHGF',
    'EXPRESS': '1B1234567890ABCDEFGHJKLMNPQRSTUVWX',
    'BARRIDO': '11N39_pZhy5iT8p7Y-zD9_C-V9eM7f0c1'
  }
};

const COL = {
  SKU: 1,                           // A (1)
  Codigo_Barras: 2,                 // B (2)
  Descripcion: 3,                   // C (3)
  Ubicacion: 4,                     // D (4)
  Ubicacion_1: 5,                   // E (5)
  Ubicacion_2: 6,                   // F (6)
  Almacen: 7,                       // G (7)
  Clasificacion_ABC: 8,             // H (8)
  Unidad: 9,                        // I (9)
  Costo_Unitario: 10,               // J (10)
  Stock_Sistema: 11,                // K (11)
  Stock_Total: 12,                  // L (12) STOCK TOTAL
  Stock_Fisico: 12,                 // L (12) alias para compatibilidad interna
  Stock_Buen_Estado: 13,            // M (13) stock B/E (BUEN ESTADO PRIMER CONTEO)
  Mal_estado: 14,                   // N (14) stock M/E (MAL ESTADO PRIMER CONTEO)
  Diferencia: 15,                   // O (15) Diferencia
  Costo_Diferencia: 16,             // P (16) Costo_Diferencia
  Fecha_Ultimo_Conteo: 17,          // Q (17) Fecha_Ultimo_Conteo
  Responsable: 18,                  // R (18) Responsable
  Fecha_Primera_Justificacion: 19,  // S (19) FECHA PRIMERA JUSTIFICACION
  Estado: 20,                       // T (20) Estado
  Razon: 21,                        // U (21) Razón
  Comentario_Justificacion: 22,     // V (22) Comentario Justificacion
  Responsable_Justificacion: 23,    // W (23) RESPONSABLE JUSTIFICACION
  Fecha_Reconteo: 24,               // X (24) Fecha reconteo
  Stock_Total_Reconteo: 25,         // Y (25) stock total reconteo
  Reconteo: 26,                     // Z (26) RECONTEO (BUEN ESTADO PRIMER RECONTEO)
  Malestado_Reconteo: 27,           // AA (27) MALESTADO RECONTEO (MAL ESTADO PRIMER RECONTEO)
  Diferencia_Final: 28,             // AB (28) Diferencia Final
  Costo_Diferencia_Final: 29,       // AC (29) Costo Diferencia Final
  Fecha_Justificacion_2: 30,        // AD (30) FECHA JUSTIFICACION 2
  Estado_Justificacion_2: 31,       // AE (31) ESTADO JUSTIFICACION 2
  Razon_Justificacion_2: 32,        // AF (32) RazónJUSTIFICACION 2
  Comentario_Justificacion_2: 33,   // AG (33) Comentario JustificaciON 2
  Responsable_Justificacion_2: 34,  // AH (34) RESPONSABLE JUSTIFICACION 2
  Fecha_Reconteo_2: 35,             // AI (35) Fecha reconteo 2
  Stock_Total_Reconteo_2: 36,       // AJ (36) stock total reconteo 2
  Reconteo_2: 37,                   // AK (37) RECONTEO 2 (BUEN ESTADO SEGUNDO RECONTEO)
  Malestado_Reconteo_2: 38,         // AL (38) MALESTADO RECONTEO 2 (MAL ESTADO SEGUNDO RECONTEO)
  Diferencia_Final_2: 39,           // AM (39) Diferencia Final 2
  Costo_Diferencia_Final_2: 40       // AN (40) Costo Diferencia Final 2
};

const DEFAULT_HEADERS = [
  'SKU',                          // A (1)
  'Codigo_Barras',                // B (2)
  'Descripcion',                  // C (3)
  'Ubicación',                    // D (4)
  'Ubicación 1',                  // E (5)
  'Ubicación 2',                  // F (6)
  'Almacen',                      // G (7)
  'Clasificacion_ABC',            // H (8)
  'Unidad',                       // I (9)
  'Costo_Unitario',               // J (10)
  'Stock_Sistema',                // K (11)
  'STOCK TOTAL',                  // L (12)
  'stock B/E',                    // M (13)
  'stock M/E',                    // N (14)
  'Diferencia',                   // O (15)
  'Costo_Diferencia',             // P (16)
  'Fecha_Ultimo_Conteo',          // Q (17)
  'Responsable',                  // R (18)
  'FECHA PRIMERA JUSTIFICACION',  // S (19)
  'Estado',                       // T (20)
  'Razón',                        // U (21)
  'Comentario Justificacion',     // V (22)
  'RESPONSABLE JUSTIFICACION',    // W (23)
  'Fecha reconteo',               // X (24)
  'stock total reconteo',         // Y (25)
  'RECONTEO',                     // Z (26)
  'MALESTADO RECONTEO',           // AA (27)
  'Diferencia Final',             // AB (28)
  'Costo Diferencia Final',       // AC (29)
  'FECHA JUSTIFICACION 2',        // AD (30)
  'ESTADO JUSTIFICACION 2',       // AE (31)
  'RazónJUSTIFICACION 2',         // AF (32)
  'Comentario JustificaciON 2',   // AG (33)
  'RESPONSABLE JUSTIFICACION 2',  // AH (34)
  'Fecha reconteo 2',             // AI (35)
  'stock total reconteo 2',       // AJ (36)
  'RECONTEO 2',                   // AK (37)
  'MALESTADO RECONTEO 2',         // AL (38)
  'Diferencia Final 2',           // AM (39)
  'Costo Diferencia Final 2'      // AN (40)
];

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 Inventarios')
    .addItem('Distribuir BD_BASE a Centros', 'distribuirBaseACentros')
    .addItem('Asegurar 40 Columnas en Hojas', 'asegurarTodasLasColumnas')
    .addToUi();
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'ping';

    if (action === 'ping') {
      return json_({
        success: true,
        message: 'GAS Inventory Webhook activo (40 columnas)',
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'getItems' || action === 'getProducts' || action === 'readItems') {
      const center = p.center || p.centro || CFG.defaultCenterIfMissing;
      const sh = getCenterSheet_(center);
      const rows = readRowsAsObjects_(sh);
      return json_({ success: true, status: 'success', center, total: rows.length, items: rows, products: rows, rows: rows });
    }

    if (action === 'readFinalInventory') {
      return json_({ success: true, ...readFinalInventory_(p) });
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

    if (action === 'getLogos' || action === 'listLogos') {
      const folderId = '1ZECgK7i8DAqXH0K3quRqaIlcnbpF7nSe';
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      const logos = [];
      while (files.hasNext()) {
        const f = files.next();
        logos.push({
          id: f.getId(),
          name: f.getName(),
          url: f.getUrl(),
          downloadUrl: 'https://drive.google.com/uc?export=download&id=' + f.getId()
        });
      }
      return json_({ success: true, count: logos.length, logos: logos });
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
    const targetCenters = [];
    if (center) targetCenters.push(center);
    else {
      const folders = rootFolder.getFolders();
      while (folders.hasNext()) {
        const name = folders.next().getName();
        if (/^(\d{4}|WARNES)$/i.test(name)) targetCenters.push(name);
      }
    }

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
              let metadata = {};
              try { metadata = JSON.parse(f.getDescription() || '{}'); } catch (_) {}
              const manifest = metadata.inventoryManifest || null;
              results.push({
                fileId: f.getId(),
                fileName: f.getName(),
                driveUrl: f.getUrl(),
                spreadsheetUrl: f.getUrl() + (manifest && manifest.gid !== undefined ? '#gid=' + manifest.gid : ''),
                inventoryId: manifest && manifest.inventoryId,
                manifest,
                totalItems: manifest && manifest.itemCount,
                center: c,
                type: type || 'CICLICO',
                closedAt: f.getDateCreated().toISOString(),
                modifiedAt: f.getLastUpdated().toISOString(),
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
  const locked = lock.tryLock(25000);
  if (!locked) {
    return json_({ success: false, error: 'Servidor ocupado. Intenta de nuevo.' });
  }

  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(raw);
    const action = body.action || '';
    const previous = body.operationId ? readOperation_(body.operationId) : null;
    if (previous) return json_(previous);

    if (action === 'ping') {
      return json_({ success: true, message: 'GAS POST webhook activo', timestamp: new Date().toISOString() });
    }

    if (action === 'savePhoto' || action === 'uploadPhoto') {
      const result = savePhotoDirectly_(body);
      return json_({ success: true, action, ...result });
    }

    if (action === 'upsertCount') {
      const result = upsertCount_(body);
      return confirmOperation_(body, { success: true, action, ...result });
    }

    if (action === 'batchUpsertCounts') {
      const result = batchUpsertCounts_(body);
      return confirmOperation_(body, { success: true, action, ...result });
    }

    if (action === 'saveJustification') {
      const result = saveJustificationToSheet_(body);
      return confirmOperation_(body, { success: true, action, ...result });
    }

    if (action === 'deleteAdditionalLocation' || action === 'deleteItem') {
      const result = deleteAdditionalLocation_(body);
      return confirmOperation_(body, { success: true, action, ...result });
    }

    if (action === 'createFinalFile') {
      const result = createFinalFile_(body);
      return confirmOperation_(body, { success: true, action, ...result });
    }

    if (action === 'getReferencePhoto') {
      const sku = String(body.sku || '').trim();
      const photo = getReferencePhotoBySku_(sku);
      return json_({ success: true, sku, photo });
    }

    if (action === 'distribuirBaseACentros') {
      distribuirBaseACentros();
      return json_({ success: true, message: 'Distribución completada' });
    }

    return json_({ success: false, error: `Accion POST no soportada: ${action}` });
  } catch (err) {
    return json_({ success: false, error: err.message, stack: err.stack });
  } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

/**
 * Registra o actualiza el conteo físico de un ítem.
 * REGLA NUEVA:
 * Si se envía una nueva ubicación para un ítem existente, NO crea una nueva fila.
 * En su lugar guarda en Col E (Ubicación 1) o Col F (Ubicación 2).
 */
function upsertCount_(payload, batch) {
  ['stockFisico', 'stockBuenEstado', 'malEstado', 'reconteo', 'reconteoFisico', 'reconteoMalEstado', 'malestadoReconteo', 'reconteo2', 'malestadoReconteo2'].forEach(key => {
    if (hasValue_(payload[key]) && (!Number.isSafeInteger(Number(payload[key])) || Number(payload[key]) < 0 || typeof payload[key] === 'boolean')) throw new Error('Cantidad inválida: ' + key);
  });
  const center = String(payload.center || payload.centro || '').trim();
  const sku = String(payload.sku || payload.SKU || '').trim();
  const barcode = String(payload.barcode || payload.codigoBarras || payload.Codigo_Barras || '').trim();
  const location = String(payload.location || payload.ubicacion || payload.Ubicacion || '').trim();
  const warehouse = String(payload.almacen || payload.warehouse || payload.Almacen || '').trim();

  if (!sku && !barcode) {
    throw new Error('upsertCount requiere al menos sku o barcode');
  }

  const sh = batch ? batch.sheet : getCenterSheet_(center);

  // Búsqueda en una sola lectura de memoria
  let targetRow = findRowInSheet_(sh, sku, barcode, payload.isNewLocation ? '' : location, warehouse, batch && batch.rows);
  let isNewDiscovery = false;

  // Si el ítem no existe en absoluto en el Sheet, se agrega una sola fila con 37 columnas
  if (!targetRow) {
    if (String(payload.type || '').toUpperCase() !== 'BARRIDO' && !payload.allowNewItem) throw new Error('Ítem no encontrado en ese almacén y ubicación.');
    const newRowNumber = appendNewItem_(sh, payload);
    targetRow = { rowNumber: newRowNumber };
    isNewDiscovery = true;
    if (batch) batch.rows.push(sh.getRange(newRowNumber, 1, 1, 40).getValues()[0]);
  } else {
    // Si ya existe, actualiza reutilizando la fila leída
    updateExistingRow_(sh, targetRow.rowNumber, payload, targetRow.row);
  }

  const invType = payload.type || (payload.inventoryId && String(payload.inventoryId).includes('BARRIDO') ? 'BARRIDO' : 'CICLICO');
  const photoSaved = saveDamagedPhotoIfAny_(payload, center, invType, sku || barcode);
  const justPhotoSaved = saveJustificationPhotoIfAny_(payload, center, invType, sku || barcode);

  return {
    center,
    row: targetRow.rowNumber,
    sku,
    barcode,
    isNewLocation: false, // Ya no genera filas paralelas
    isNewItem: isNewDiscovery,
    photoSaved,
    justPhotoSaved
  };
}

function batchUpsertCounts_(payload) {
  const center = String(payload.center || payload.centro || '').trim();
  const updates = Array.isArray(payload.updates) ? payload.updates : [];
  const sheet = getCenterSheet_(center);
  ensureColumns_(sheet);
  const batch = { sheet, rows: sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 40).getValues() : [] };
  const failedItems = [];
  let updatedCount = 0, createdCount = 0;
  updates.forEach((item, index) => {
    try {
      const result = upsertCount_({ ...item, center, type: payload.type }, batch);
      if (result.isNewItem) createdCount++; else updatedCount++;
    } catch (error) { failedItems.push({ index, itemId: item.itemId, sku: item.sku || item.SKU, error: error.message }); }
  });
  return { success: failedItems.length === 0, center, total: updates.length, updatedCount, createdCount, failedItems };
}

/**
 * Guarda la justificación en el Sheet.
 * REGLA NUEVA:
 * Si se marca como "CUADRA", se reescribe la Columna K (Stock_Sistema) con el Stock Físico
 * y la diferencia queda en 0.
 */
function saveJustificationToSheet_(payload) {
  const center = String(payload.center || payload.centro || '').trim();
  const sku = String(payload.sku || payload.SKU || '').trim();
  const razon = String(payload.razon || payload.reasonType || payload.razonJustificacion || payload.Razon || 'AJUSTE_INVENTARIO').trim();
  const comentarioJust = String(payload.comentarioJustificacion || payload.justification || payload.comentariosJustificacion || payload.Comentario_Justificacion || '').trim();
  const reviewer = String(payload.reviewedBy || payload.responsableJustificacion || payload.responsable || '').trim();
  const corroboracion = String(payload.corroboracion || payload.corroboration || '').toUpperCase();
  const rawCorroboracion = String(payload.corroboracion || payload.corroboration || payload.status || payload.estado || '').trim().toUpperCase();
  const isNoCuadra = rawCorroboracion.includes('NO') || payload.isCuadra === false;
  const isCuadra = !isNoCuadra && (rawCorroboracion === 'CUADRA' || payload.isCuadra === true);

  if (!sku) throw new Error('saveJustification requiere sku');

  const sh = getCenterSheet_(center);
  const warehouse = String(payload.almacen || payload.warehouse || payload.Almacen || '').trim();
  const location = String(payload.location || payload.ubicacion || payload.Ubicacion || '').trim();

  // Búsqueda única en memoria
  const found = findRowInSheet_(sh, sku, '', location, warehouse);
  if (!found) {
    throw new Error(`Ítem ${sku} no encontrado en centro ${center}`);
  }

  const row = found.row;

  const stockFisico = hasValue_(payload.stockFisico) ? num_(payload.stockFisico) : num_(row[COL.Stock_Total - 1]);
  const costoUnitario = num_(row[COL.Costo_Unitario - 1]);
  const isRound2 = payload.round === 2 || payload.justificationRound === 2 || !!payload.isJustification2;
  const estadoJustificacion = isCuadra ? 'CUADRA' : 'NO CUADRA';

  // Si se marca como CUADRA en la Columna T, reescribir Columna K (Stock_Sistema) con el último conteo físico
  if (isCuadra) {
    let stockFisicoCuadra = num_(row[COL.Stock_Total - 1]);
    if (hasValue_(row[COL.Stock_Total_Reconteo_2 - 1])) {
      stockFisicoCuadra = num_(row[COL.Stock_Total_Reconteo_2 - 1]);
    } else if (hasValue_(row[COL.Stock_Total_Reconteo - 1])) {
      stockFisicoCuadra = num_(row[COL.Stock_Total_Reconteo - 1]);
    } else if (hasValue_(payload.stockFisico)) {
      stockFisicoCuadra = num_(payload.stockFisico);
    }
    row[COL.Stock_Sistema - 1] = stockFisicoCuadra; // Col K (11)
    row[COL.Diferencia - 1] = 0;                    // Col O (15) = 0
    row[COL.Costo_Diferencia - 1] = 0;              // Col P (16) = 0
    if (hasValue_(row[COL.Stock_Total_Reconteo - 1]) || hasValue_(row[COL.Reconteo - 1])) {
      row[COL.Diferencia_Final - 1] = 0;            // Col AB (28) = 0
      row[COL.Costo_Diferencia_Final - 1] = 0;      // Col AC (29) = 0
    }
    if (hasValue_(row[COL.Stock_Total_Reconteo_2 - 1]) || hasValue_(row[COL.Reconteo_2 - 1])) {
      row[COL.Diferencia_Final_2 - 1] = 0;          // Col AM (39) = 0
      row[COL.Costo_Diferencia_Final_2 - 1] = 0;    // Col AN (40) = 0
    }
  } else {
    // Si NO CUADRA, NUNCA reescribir Columna K con el stock físico.
    // Si se envía el stock original de sistema, restaurarlo en Columna K
    if (hasValue_(payload.originalStockSistema)) {
      row[COL.Stock_Sistema - 1] = num_(payload.originalStockSistema);
    } else if (hasValue_(payload.stockSistemaOriginal)) {
      row[COL.Stock_Sistema - 1] = num_(payload.stockSistemaOriginal);
    }
    const currentStockSis = num_(row[COL.Stock_Sistema - 1]);
    const currentPhys = hasValue_(row[COL.Stock_Total - 1]) ? num_(row[COL.Stock_Total - 1]) : stockFisico;
    const dif = currentPhys - currentStockSis;
    row[COL.Diferencia - 1] = dif;
    row[COL.Costo_Diferencia - 1] = dif * costoUnitario;
  }

  if (isRound2) {
    row[COL.Fecha_Justificacion_2 - 1] = payload.fechaJustificacion2 ? new Date(payload.fechaJustificacion2) : (payload.fecha ? new Date(payload.fecha) : new Date());
    row[COL.Estado_Justificacion_2 - 1] = estadoJustificacion;
    row[COL.Razon_Justificacion_2 - 1] = razon;
    row[COL.Comentario_Justificacion_2 - 1] = comentarioJust;
    if (reviewer) row[COL.Responsable_Justificacion_2 - 1] = reviewer;
  } else {
    row[COL.Fecha_Primera_Justificacion - 1] = payload.fechaPrimeraJustificacion ? new Date(payload.fechaPrimeraJustificacion) : (payload.fecha ? new Date(payload.fecha) : new Date());
    row[COL.Estado - 1] = estadoJustificacion;
    row[COL.Razon - 1] = razon;
    row[COL.Comentario_Justificacion - 1] = comentarioJust;
    if (reviewer) row[COL.Responsable_Justificacion - 1] = reviewer;
  }

  // Escribir columnas D a AN (4 a 40 -> 37 columnas) manteniendo A-C intactos
  const colsDToEnd = row.slice(3, 40);
  sh.getRange(found.rowNumber, 4, 1, 37).setValues([colsDToEnd]);

  const justPhotoSaved = saveJustificationPhotoIfAny_(payload, center, payload.type, sku);

  return {
    center,
    row: found.rowNumber,
    sku,
    razon,
    comentarioJustificacion: comentarioJust,
    stockSistemaReescrito: isCuadra ? stockFisico : null,
    justPhotoSaved,
    updated: true
  };
}

function createFinalFile_(payload) {
  const centerCode = String(payload.center || payload.centro || '').trim();
  const type = String(payload.type || 'CICLICO').toUpperCase();
  const driveRecord = payload.driveRecord || {};
  const incomingItems = (Array.isArray(driveRecord.items) && driveRecord.items.length)
    ? driveRecord.items : (Array.isArray(payload.items) ? payload.items : []);
  if (!incomingItems.length) throw new Error('No se puede crear un cierre sin ítems');

  const rootFolder = getRootFolderForType_(type);
  const centerFolder = getOrCreateFolder_(rootFolder, centerCode);
  const snapshotFolder = getOrCreateFolder_(centerFolder, 'Archivos Finales');

  const activeSs = SpreadsheetApp.getActiveSpreadsheet();
  const fileName = buildFinalSpreadsheetName_(type, centerCode);

  const copyFile = DriveApp.getFileById(activeSs.getId()).makeCopy(fileName, snapshotFolder);
  const copySs = SpreadsheetApp.openById(copyFile.getId());
  const sh = getCenterSheetFromSs_(copySs, centerCode);
  ensureColumns_(sh);

  sh.getRange(1, 1, 1, 40).setValues([DEFAULT_HEADERS]);
  if (sh.getMaxColumns && sh.getMaxColumns() > 40) sh.deleteColumns(41, sh.getMaxColumns() - 40);
  syncFromDriveRecordItems_(sh, incomingItems, centerCode, type);
  copySs.getSheets().forEach(sheet => { if (sheet.getSheetId() !== sh.getSheetId()) copySs.deleteSheet(sheet); });

  const justifications = Array.isArray(driveRecord.justifications)
    ? driveRecord.justifications
    : (Array.isArray(payload.justifications) ? payload.justifications : []);
  const justifSaved = saveJustificationPhotosBatch_(justifications, centerCode, type);

  if (justifications.length) {
    applyJustificationsToSheet_(sh, justifications);
  }

  const manifest = { ...(driveRecord.manifest || payload.manifest || {}), version: 1,
    inventoryId: driveRecord.inventoryId || payload.inventoryId || driveRecord.manifest?.inventoryId || null,
    center: centerCode, type, gid: sh.getSheetId(), sheetName: sh.getName(),
    closedAt: driveRecord.closedAt || new Date().toISOString(), itemCount: incomingItems.length,
    skuCount: new Set(incomingItems.map(it => norm_(it.SKU || it.sku))).size };
  const members = incomingItems.map(it => JSON.stringify([norm_(it.SKU || it.sku), norm_(it.Almacen || it.almacen || it.warehouse), norm_(it.Ubicacion || it.ubicacion || it.location)])).sort();
  const metaSheet = copySs.insertSheet('__INVENTORY_MANIFEST');
  if (metaSheet.getMaxRows && metaSheet.getMaxRows() < members.length + 1) metaSheet.insertRowsAfter(metaSheet.getMaxRows(), members.length + 1 - metaSheet.getMaxRows());
  const summary = { ...manifest }; delete summary.members;
  metaSheet.getRange(1, 1).setValue(JSON.stringify(summary));
  metaSheet.getRange(2, 1, members.length, 1).setValues(members.map(member => [member]));
  metaSheet.hideSheet();
  copyFile.setDescription(JSON.stringify({ inventoryManifest: summary }));
  SpreadsheetApp.flush();

  return {
    fileId: copyFile.getId(),
    fileName: copyFile.getName(),
    spreadsheetUrl: copyFile.getUrl() + '#gid=' + sh.getSheetId(),
    folderId: snapshotFolder.getId(),
    center: centerCode,
    type,
    itemsSynced: incomingItems.length,
    manifest: summary,
    justificationsSaved: justifSaved
  };
}

function applyJustificationsToSheet_(sheet, justifications) {
  if (!justifications || !justifications.length) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  ensureColumns_(sheet);
  const numCols = Math.max(sheet.getLastColumn(), 40);
  const range = sheet.getRange(2, 1, lastRow - 1, 40);
  const values = range.getValues();

  const justMap = new Map();
  justifications.forEach(j => {
    const sku = norm_(j.sku || j.SKU || '');
    const war = norm_(j.almacen || j.warehouse || j.Almacen || '');
    if (sku) {
      const data = {
        razon: String(j.reasonType || j.razon || j.Razon || j.razonJustificacion || 'AJUSTE_INVENTARIO'),
        comentario: String(j.justification || j.comentario || j.Comentario_Justificacion || j.comentarioJustificacion || ''),
        reviewer: String(j.reviewedBy || j.responsableJustificacion || ''),
        corroboracion: String(j.corroboracion || j.corroboration || '').toUpperCase(),
        round: j.round || j.justificationRound || 1
      };
      const location = norm_(j.ubicacion || j.location || j.Ubicacion || '');
      justMap.set(`${sku}___${war}___${location}`, data);
    }
  });

  let modified = false;
  for (let i = 0; i < values.length; i++) {
    const rowSku = norm_(values[i][COL.SKU - 1]);
    const rowWar = COL.Almacen ? norm_(values[i][COL.Almacen - 1]) : '';
    const keyWithWar = `${rowSku}___${rowWar}___${norm_(values[i][COL.Ubicacion - 1])}`;
    const justData = justMap.get(keyWithWar);
    if (justData) {
      const stockFisico = num_(values[i][COL.Stock_Total - 1]);
      const estadoJust = justData.corroboracion === 'CUADRA' ? 'CUADRA' : 'NO CUADRA';

      if (justData.corroboracion === 'CUADRA') {
        values[i][COL.Stock_Sistema - 1] = stockFisico;
        values[i][COL.Diferencia - 1] = 0;
        values[i][COL.Costo_Diferencia - 1] = 0;
      }

      if (justData.round === 2) {
        values[i][COL.Fecha_Justificacion_2 - 1] = new Date();
        values[i][COL.Estado_Justificacion_2 - 1] = estadoJust;
        values[i][COL.Razon_Justificacion_2 - 1] = justData.razon;
        values[i][COL.Comentario_Justificacion_2 - 1] = justData.comentario;
        if (justData.reviewer) {
          values[i][COL.Responsable_Justificacion_2 - 1] = justData.reviewer;
        }
      } else {
        values[i][COL.Fecha_Primera_Justificacion - 1] = new Date();
        values[i][COL.Estado - 1] = estadoJust;
        values[i][COL.Razon - 1] = justData.razon;
        values[i][COL.Comentario_Justificacion - 1] = justData.comentario;
        if (justData.reviewer) {
          values[i][COL.Responsable_Justificacion - 1] = justData.reviewer;
        }
      }
      modified = true;
    }
  }

  if (modified) {
    const updateRange = sheet.getRange(2, 4, lastRow - 1, 37);
    const updateValues = values.map(row => row.slice(3, 40));
    updateRange.setValues(updateValues);
  }
}

function getCenterSheet_(center) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return getCenterSheetFromSs_(ss, center);
}

function getCenterSheetFromSs_(ss, center) {
  const clean = String(center || '').trim();
  if (!/^\d{4}$/.test(clean)) throw new Error('Centro inválido: ' + clean);
  const sheet = ss.getSheetByName(clean);
  if (!sheet) throw new Error('No existe la pestaña del centro ' + clean);
  return sheet;
}

function ensureColumns_(sheet) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < 40) {
    sheet.insertColumnsAfter(maxCols, 40 - maxCols);
    if (sheet.getLastRow() >= 1) {
      sheet.getRange(1, 1, 1, 40).setValues([DEFAULT_HEADERS]);
    }
  }
}

function asegurarTodasLasColumnas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  sheets.forEach(sh => {
    if (sh.getName() !== 'BD_BASE' && sh.getName() !== '_NIBOL_SYNC') {
      const maxCols = sh.getMaxColumns();
      if (maxCols < 40) {
        sh.insertColumnsAfter(maxCols, 40 - maxCols);
      }
      if (sh.getLastRow() >= 1) {
        const headerRange = sh.getRange(1, 1, 1, 40);
        const headers = headerRange.getValues()[0];
        let needsUpdate = false;
        for (let c = 0; c < DEFAULT_HEADERS.length; c++) {
          if (!headers[c] || headers[c] !== DEFAULT_HEADERS[c]) {
            headers[c] = DEFAULT_HEADERS[c];
            needsUpdate = true;
          }
        }
        if (needsUpdate) headerRange.setValues([headers]);
      }
    }
  });
  SpreadsheetApp.getUi().alert('40 Columnas verificadas y configuradas en todas las hojas.');
}

/**
 * Búsqueda de alta velocidad: lee los datos de la hoja una sola vez en memoria
 * y aplica prioridades de coincidencia sin llamadas redundantes a Google Sheets.
 */
function findRowInSheet_(sheet, sku, barcode, location, warehouse, cachedRows) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = cachedRows || sheet.getRange(2, 1, lastRow - 1, 40).getValues();
  const candidates = [];
  data.forEach((row, index) => {
    if (sku ? norm_(row[COL.SKU - 1]) !== norm_(sku) : (!barcode || norm_(row[COL.Codigo_Barras - 1]) !== norm_(barcode))) return;
    if (warehouse && norm_(row[COL.Almacen - 1]) !== norm_(warehouse)) return;
    if (location && ![COL.Ubicacion, COL.Ubicacion_1, COL.Ubicacion_2].some(col => norm_(row[col - 1]) === norm_(location))) return;
    candidates.push({ rowNumber: index + 2, row });
  });
  if (candidates.length > 1) throw new Error('SKU ambiguo: especifique almacén y ubicación exactos.');
  return candidates[0] || null;
}

function findExactRow_(sheet, sku, barcode, location, warehouse) {
  return findRowInSheet_(sheet, sku, barcode, location, warehouse);
}

function findBySkuBarcode_(sheet, sku, barcode, warehouse) {
  return findRowInSheet_(sheet, sku, barcode, '', warehouse);
}

/**
 * Actualiza la fila existente con los datos del conteo y/o justificación.
 * Si se envían ubicaciones adicionales, las guarda en Col E (Ubicación 1) o Col F (Ubicación 2).
 */
function updateExistingRow_(sheet, rowNumber, data, existingRow) {
  const row = existingRow || sheet.getRange(rowNumber, 1, 1, 40).getValues()[0];

  // COLUMNAS PROTEGIDAS (NO MODIFICAR NUNCA):
  // A (1): SKU
  // B (2): Codigo_Barras
  // C (3): Descripcion
  // D (4): Ubicacion (UBICACIÓN ORIGINAL)
  // G (7): Almacen
  // H (8): Clasificacion_ABC
  // I (9): Unidad
  // J (10): Costo_Unitario
  const costoUnitario = num_(row[COL.Costo_Unitario - 1]);
  let stockSistema = num_(row[COL.Stock_Sistema - 1]);

  // E (5): Ubicacion 1 (UBICACIÓN EXTRA 1)
  if (hasValue_(data.ubicacion1 || data.Ubicacion_1)) {
    row[COL.Ubicacion_1 - 1] = String(data.ubicacion1 || data.Ubicacion_1).trim();
  }
  // F (6): Ubicacion 2 (UBICACIÓN EXTRA 2)
  if (hasValue_(data.ubicacion2 || data.Ubicacion_2)) {
    row[COL.Ubicacion_2 - 1] = String(data.ubicacion2 || data.Ubicacion_2).trim();
  }
  if (data.isNewLocation && data.newLocation) {
    const nLoc = String(data.newLocation).trim();
    if (!row[COL.Ubicacion_1 - 1]) {
      row[COL.Ubicacion_1 - 1] = nLoc;
    } else if (!row[COL.Ubicacion_2 - 1] && norm_(row[COL.Ubicacion_1 - 1]) !== norm_(nLoc)) {
      row[COL.Ubicacion_2 - 1] = nLoc;
    }
  }

  // Detección de Justificación
  const isRound2 = data.round === 2 || data.justificationRound === 2 || !!data.isJustification2;
  const rawEstado = String(data.estadoJustificacion || data.estado || data.corroboracion || data.corroboration || '').trim().toUpperCase();
  const isNoCuadra = rawEstado.includes('NO') || data.isCuadra === false || String(data.corroboracion || '').toUpperCase().includes('NO');
  const isCuadra = !isNoCuadra && (data.corroboracion === 'CUADRA' || data.corroboration === 'CUADRA' || data.isCuadra === true || rawEstado === 'CUADRA');

  const hasJust1 = !isRound2 && (
    hasValue_(data.estadoJustificacion) ||
    hasValue_(data.estado) ||
    hasValue_(data.corroboracion) ||
    hasValue_(data.isCuadra) ||
    hasValue_(data.razon) ||
    hasValue_(data.reasonType) ||
    hasValue_(data.Razon) ||
    hasValue_(data.comentarioJustificacion) ||
    hasValue_(data.justification) ||
    hasValue_(data.Comentario_Justificacion) ||
    hasValue_(data.responsableJustificacion) ||
    hasValue_(data.reviewedBy) ||
    hasValue_(data.fechaPrimeraJustificacion) ||
    data.action === 'saveJustification'
  );

  // K (11): Stock_Sistema (STOCK DE SISTEMA) - solo se modifica si en la justificación se marca como cuadra en la columna T
  if (hasJust1) {
    if (isCuadra) {
      let stockFisicoCuadra = num_(row[COL.Stock_Total - 1]);
      if (hasValue_(row[COL.Stock_Total_Reconteo_2 - 1])) {
        stockFisicoCuadra = num_(row[COL.Stock_Total_Reconteo_2 - 1]);
      } else if (hasValue_(row[COL.Stock_Total_Reconteo - 1])) {
        stockFisicoCuadra = num_(row[COL.Stock_Total_Reconteo - 1]);
      } else if (hasValue_(data.stockTotal)) {
        stockFisicoCuadra = num_(data.stockTotal);
      } else if (hasValue_(data.stockFisico)) {
        stockFisicoCuadra = num_(data.stockFisico);
      }
      row[COL.Stock_Sistema - 1] = stockFisicoCuadra;
      stockSistema = stockFisicoCuadra;
      row[COL.Diferencia - 1] = 0;
      row[COL.Costo_Diferencia - 1] = 0;
      if (hasValue_(row[COL.Stock_Total_Reconteo - 1]) || hasValue_(row[COL.Reconteo - 1])) {
        row[COL.Diferencia_Final - 1] = 0;
        row[COL.Costo_Diferencia_Final - 1] = 0;
      }
      if (hasValue_(row[COL.Stock_Total_Reconteo_2 - 1]) || hasValue_(row[COL.Reconteo_2 - 1])) {
        row[COL.Diferencia_Final_2 - 1] = 0;
        row[COL.Costo_Diferencia_Final_2 - 1] = 0;
      }
    } else {
      // SI NO CUADRA, NUNCA reescribir Col K con el stock físico.
      // Si se envía el stock original, restaurarlo en Col K
      if (hasValue_(data.originalStockSistema)) {
        row[COL.Stock_Sistema - 1] = num_(data.originalStockSistema);
        stockSistema = num_(data.originalStockSistema);
      } else if (hasValue_(data.stockSistemaOriginal)) {
        row[COL.Stock_Sistema - 1] = num_(data.stockSistemaOriginal);
        stockSistema = num_(data.stockSistemaOriginal);
      }
      const stTotal = num_(row[COL.Stock_Total - 1]);
      const dif = stTotal - stockSistema;
      row[COL.Diferencia - 1] = dif;
      row[COL.Costo_Diferencia - 1] = dif * costoUnitario;
    }
  }

  // 1ER CONTEO: Col L (12), M (13), N (14), O (15), P (16), Q (17), R (18)
  // Solo se actualiza si se envía información de primer conteo
  const hasFirstCount = !data.isReconteo && !data.isReconteo2 && (
    hasValue_(data.stockBuenEstado) ||
    hasValue_(data.stockFisico) ||
    hasValue_(data.stockTotal) ||
    (hasValue_(data.malEstado) && !data.isReconteo)
  );

  if (hasFirstCount) {
    const stockBuenEstado = hasValue_(data.stockBuenEstado)
      ? num_(data.stockBuenEstado)
      : (hasValue_(data.stockFisico) ? num_(data.stockFisico) : num_(row[COL.Stock_Buen_Estado - 1]));
    const malEstado = hasValue_(data.malEstado) ? num_(data.malEstado) : num_(row[COL.Mal_estado - 1]);
    let stockTotal = stockBuenEstado + malEstado;
    if (hasValue_(data.stockTotal)) {
      stockTotal = num_(data.stockTotal);
    }

    row[COL.Stock_Total - 1] = stockTotal;             // Col L (12)
    row[COL.Stock_Buen_Estado - 1] = stockBuenEstado;  // Col M (13)
    row[COL.Mal_estado - 1] = malEstado;               // Col N (14)

    if (hasJust1 && isCuadra) {
      row[COL.Diferencia - 1] = 0;
      row[COL.Costo_Diferencia - 1] = 0;
    } else {
      const dif = stockTotal - stockSistema;
      row[COL.Diferencia - 1] = dif;                   // Col O (15)
      row[COL.Costo_Diferencia - 1] = dif * costoUnitario; // Col P (16)
    }

    // Col Q (17): Fecha_Ultimo_Conteo
    if (hasValue_(data.fechaUltimoConteo)) {
      row[COL.Fecha_Ultimo_Conteo - 1] = new Date(data.fechaUltimoConteo);
    } else if (!hasValue_(row[COL.Fecha_Ultimo_Conteo - 1])) {
      row[COL.Fecha_Ultimo_Conteo - 1] = new Date();
    }

    // Col R (18): Responsable
    if (hasValue_(data.responsable || data.username)) {
      row[COL.Responsable - 1] = String(data.responsable || data.username).trim();
    }
  }

  // 1RA JUSTIFICACIÓN: Col S (19), T (20), U (21), V (22), W (23)
  if (hasJust1) {
    // S (19): FECHA PRIMERA JUSTIFICACION
    row[COL.Fecha_Primera_Justificacion - 1] = data.fechaPrimeraJustificacion
      ? new Date(data.fechaPrimeraJustificacion)
      : (data.fecha ? new Date(data.fecha) : new Date());

    // T (20): Estado (ESTADO DE LA PRIMERA JUSTIFICACION (CUADRA - NO CUADRA))
    row[COL.Estado - 1] = isCuadra ? 'CUADRA' : (hasValue_(data.estadoJustificacion || data.corroboracion || data.estado) ? String(data.estadoJustificacion || data.corroboracion || data.estado).trim() : 'NO CUADRA');

    // U (21): Razón
    if (hasValue_(data.razon || data.reasonType || data.Razon || data.razonJustificacion)) {
      row[COL.Razon - 1] = String(data.razon || data.reasonType || data.Razon || data.razonJustificacion).trim();
    }

    // V (22): Comentario Justificacion
    const cJust = data.comentarioJustificacion || data.justification || data.Comentario_Justificacion || data.comentariosJustificacion;
    if (hasValue_(cJust)) {
      row[COL.Comentario_Justificacion - 1] = String(cJust).trim();
    }

    // W (23): RESPONSABLE JUSTIFICACION
    const respJust = data.responsableJustificacion || data.reviewedBy || data.reviewer || data.RESPONSABLE_JUSTIFICACION;
    if (hasValue_(respJust)) {
      row[COL.Responsable_Justificacion - 1] = String(respJust).trim();
    }
  }

  // 1ER RECONTEO: Col X (24), Y (25), Z (26), AA (27), AB (28), AC (29)
  const hasRec1 = hasValue_(data.reconteo) ||
    hasValue_(data.reconteoFisico) ||
    hasValue_(data.stockTotalReconteo) ||
    hasValue_(data.malestadoReconteo) ||
    hasValue_(data.reconteoMalEstado) ||
    (data.isReconteo && !isRound2 && !data.isReconteo2);

  if (hasRec1) {
    // X (24): Fecha reconteo
    row[COL.Fecha_Reconteo - 1] = data.fechaReconteo
      ? new Date(data.fechaReconteo)
      : (data.FECHA_RECONTEO ? new Date(data.FECHA_RECONTEO) : new Date());

    // AA (27): MALESTADO RECONTEO
    const malRec1 = hasValue_(firstValue_(data.malestadoReconteo, data.reconteoMalEstado, data.MALESTADO_RECONTEO))
      ? num_(firstValue_(data.malestadoReconteo, data.reconteoMalEstado, data.MALESTADO_RECONTEO))
      : (hasValue_(row[COL.Malestado_Reconteo - 1]) ? num_(row[COL.Malestado_Reconteo - 1]) : 0);
    row[COL.Malestado_Reconteo - 1] = malRec1;

    // Z (26): RECONTEO (buen estado)
    const recBuenEstado = hasValue_(firstValue_(data.reconteo, data.reconteoFisico, data.RECONTEO))
      ? num_(firstValue_(data.reconteo, data.reconteoFisico, data.RECONTEO))
      : num_(row[COL.Reconteo - 1]);
    row[COL.Reconteo - 1] = recBuenEstado;

    // Y (25): stock total reconteo
    let recTotal = recBuenEstado + malRec1;
    if (hasValue_(data.stockTotalReconteo)) {
      recTotal = num_(data.stockTotalReconteo);
    }
    row[COL.Stock_Total_Reconteo - 1] = recTotal;

    // AB (28) y AC (29): Diferencia Final y Costo Diferencia Final
    if (hasJust1 && isCuadra) {
      row[COL.Diferencia_Final - 1] = 0;
      row[COL.Costo_Diferencia_Final - 1] = 0;
    } else {
      const difF = recTotal - stockSistema;
      row[COL.Diferencia_Final - 1] = difF;
      row[COL.Costo_Diferencia_Final - 1] = difF * costoUnitario;
    }
  }

  // 2DA JUSTIFICACIÓN: Col AD (30), AE (31), AF (32), AG (33), AH (34)
  const hasJust2 = isRound2 && (
    hasValue_(data.estadoJustificacion2) ||
    hasValue_(data.estadoJustificacion) ||
    hasValue_(data.corroboracion) ||
    hasValue_(data.isCuadra) ||
    hasValue_(data.razonJustificacion2) ||
    hasValue_(data.comentarioJustificacion2) ||
    hasValue_(data.responsableJustificacion2) ||
    hasValue_(data.fechaJustificacion2)
  );

  if (hasJust2) {
    // AD (30): FECHA JUSTIFICACION 2
    row[COL.Fecha_Justificacion_2 - 1] = data.fechaJustificacion2
      ? new Date(data.fechaJustificacion2)
      : (data.FECHA_JUSTIFICACION_2 ? new Date(data.FECHA_JUSTIFICACION_2) : new Date());

    // AE (31): ESTADO JUSTIFICACION 2
    row[COL.Estado_Justificacion_2 - 1] = isCuadra ? 'CUADRA' : (hasValue_(data.estadoJustificacion2 || data.estadoJustificacion || data.corroboracion) ? String(data.estadoJustificacion2 || data.estadoJustificacion || data.corroboracion).trim() : 'NO CUADRA');

    // AF (32): RazónJUSTIFICACION 2
    if (hasValue_(data.razonJustificacion2 || data.RAZON_JUSTIFICACION_2)) {
      row[COL.Razon_Justificacion_2 - 1] = String(data.razonJustificacion2 || data.RAZON_JUSTIFICACION_2).trim();
    }

    // AG (33): Comentario JustificaciON 2
    const cJust2 = data.comentarioJustificacion2 || data.COMENTARIO_JUSTIFICACION_2 || data.justification;
    if (hasValue_(cJust2)) {
      row[COL.Comentario_Justificacion_2 - 1] = String(cJust2).trim();
    }

    // AH (34): RESPONSABLE JUSTIFICACION 2
    const respJust2 = data.responsableJustificacion2 || data.RESPONSABLE_JUSTIFICACION_2 || data.reviewedBy || data.reviewer;
    if (hasValue_(respJust2)) {
      row[COL.Responsable_Justificacion_2 - 1] = String(respJust2).trim();
    }
  }

  // 2DO RECONTEO: Col AI (35), AJ (36), AK (37), AL (38), AM (39), AN (40)
  const hasRec2 = hasValue_(data.reconteo2) ||
    hasValue_(data.RECONTEO_2) ||
    hasValue_(data.stockTotalReconteo2) ||
    hasValue_(data.malestadoReconteo2) ||
    hasValue_(data.MALESTADO_RECONTEO_2) ||
    !!data.isReconteo2;

  if (hasRec2) {
    // AI (35): Fecha reconteo 2
    row[COL.Fecha_Reconteo_2 - 1] = data.fechaReconteo2
      ? new Date(data.fechaReconteo2)
      : (data.FECHA_RECONTEO_2 ? new Date(data.FECHA_RECONTEO_2) : new Date());

    // AL (38): MALESTADO RECONTEO 2
    const malRec2 = hasValue_(firstValue_(data.malestadoReconteo2, data.MALESTADO_RECONTEO_2))
      ? num_(firstValue_(data.malestadoReconteo2, data.MALESTADO_RECONTEO_2))
      : (hasValue_(row[COL.Malestado_Reconteo_2 - 1]) ? num_(row[COL.Malestado_Reconteo_2 - 1]) : 0);
    row[COL.Malestado_Reconteo_2 - 1] = malRec2;

    // AK (37): RECONTEO 2 (buen estado)
    const recBuenEstado2 = hasValue_(firstValue_(data.reconteo2, data.RECONTEO_2))
      ? num_(firstValue_(data.reconteo2, data.RECONTEO_2))
      : num_(row[COL.Reconteo_2 - 1]);
    row[COL.Reconteo_2 - 1] = recBuenEstado2;

    // AJ (36): stock total reconteo 2
    let recTotal2 = recBuenEstado2 + malRec2;
    if (hasValue_(data.stockTotalReconteo2)) {
      recTotal2 = num_(data.stockTotalReconteo2);
    }
    row[COL.Stock_Total_Reconteo_2 - 1] = recTotal2;

    // AM (39) y AN (40): Diferencia Final 2 y Costo Diferencia Final 2
    if (hasJust1 && isCuadra) {
      row[COL.Diferencia_Final_2 - 1] = 0;
      row[COL.Costo_Diferencia_Final_2 - 1] = 0;
    } else {
      const difF2 = recTotal2 - stockSistema;
      row[COL.Diferencia_Final_2 - 1] = difF2;
      row[COL.Costo_Diferencia_Final_2 - 1] = difF2 * costoUnitario;
    }
  }

  // Escribir columnas D a AN (4 a 40 -> 37 columnas) manteniendo SKU, Codigo_Barras y Descripcion protegidos
  const colsDToEnd = row.slice(3, 40);
  sheet.getRange(rowNumber, 4, 1, 37).setValues([colsDToEnd]);
}

/**
 * Agrega un nuevo ítem al final de la base de datos (descubrimiento en barrido/conteo)
 */
function appendNewItem_(sheet, data) {
  ensureColumns_(sheet);
  const row = new Array(40).fill('');

  const sku = String(data.sku || data.SKU || '').trim();
  const barcode = String(data.barcode || data.codigoBarras || data.Codigo_Barras || sku || '').trim();
  const descripcion = String(data.descripcion || data.description || data.Descripcion || `Ítem ${sku}`).trim();
  const ubicacion = String(data.location || data.ubicacion || data.Ubicacion || 'PRINCIPAL').trim();
  const ubicacion1 = String(data.ubicacion1 || data.Ubicacion_1 || '').trim();
  const ubicacion2 = String(data.ubicacion2 || data.Ubicacion_2 || '').trim();
  const almacen = String(data.almacen || data.Almacen || data.categoria || data.Categoria || 'repuesto').trim();
  const clasificacionAbc = String(data.clasificacionAbc || data.Clasificacion_ABC || 'C').trim();
  const unidad = String(data.unidad || data.Unidad || 'PZA').trim();
  const costoUnitario = num_(data.costoUnitario || data.Costo_Unitario || 0);
  const stockSistema = num_(data.stockSistema || data.Stock_Sistema || 0);
  const stockBuenEstado = hasValue_(data.stockBuenEstado) ? num_(data.stockBuenEstado) : (hasValue_(data.stockFisico) ? num_(data.stockFisico) : 0);
  const malEstado = hasValue_(data.malEstado) ? num_(data.malEstado) : 0;

  let stockTotal = stockBuenEstado + malEstado;
  if (hasValue_(data.stockTotal)) {
    stockTotal = num_(data.stockTotal);
  }

  const dif = stockTotal - stockSistema;
  const costoDif = dif * costoUnitario;
  const fechaConteo = data.fechaUltimoConteo ? new Date(data.fechaUltimoConteo) : new Date();
  const responsable = String(data.responsable || data.username || 'Barrido').trim();
  const estadoJustificacion = hasValue_(data.estadoJustificacion || data.estadoJustificacion1 || data.ESTADO_JUSTIFICACION)
    ? String(data.estadoJustificacion || data.estadoJustificacion1 || data.ESTADO_JUSTIFICACION)
    : '';

  row[COL.SKU - 1] = sku;
  row[COL.Codigo_Barras - 1] = barcode;
  row[COL.Descripcion - 1] = descripcion;
  row[COL.Ubicacion - 1] = ubicacion;
  row[COL.Ubicacion_1 - 1] = ubicacion1;
  row[COL.Ubicacion_2 - 1] = ubicacion2;
  row[COL.Almacen - 1] = almacen;
  row[COL.Clasificacion_ABC - 1] = clasificacionAbc;
  row[COL.Unidad - 1] = unidad;
  row[COL.Costo_Unitario - 1] = costoUnitario;
  row[COL.Stock_Sistema - 1] = stockSistema;
  row[COL.Stock_Total - 1] = stockTotal;
  row[COL.Stock_Buen_Estado - 1] = stockBuenEstado;
  row[COL.Mal_estado - 1] = malEstado;
  row[COL.Diferencia - 1] = dif;
  row[COL.Costo_Diferencia - 1] = costoDif;
  row[COL.Fecha_Ultimo_Conteo - 1] = fechaConteo;
  row[COL.Responsable - 1] = responsable;
  row[COL.Estado - 1] = estadoJustificacion;
  row[COL.Razon - 1] = String(data.razon || data.reasonType || '');
  row[COL.Comentario_Justificacion - 1] = String(data.comentarioJustificacion || data.justification || '');
  row[COL.Responsable_Justificacion - 1] = String(data.responsableJustificacion || data.reviewedBy || '');

  sheet.appendRow(row);
  return sheet.getLastRow();
}

function syncFromDriveRecordItems_(sheet, items, center, type) {
  ensureColumns_(sheet);
  const rows = items.map(item => {
    const row = Array(40).fill('');
    Object.keys(COL).forEach(key => {
      if (key !== 'Stock_Fisico' && hasValue_(item[key])) row[COL[key] - 1] = item[key];
    });
    row[COL.Stock_Total - 1] = firstValue_(item.Stock_Total, hasValue_(item.Stock_Fisico) ? num_(item.Stock_Fisico) + num_(item.Mal_estado) : null) ?? '';
    row[COL.Stock_Buen_Estado - 1] = firstValue_(item.Stock_Buen_Estado, item.Stock_Fisico) ?? '';
    row[COL.Reconteo - 1] = firstValue_(item.Reconteo, item.Reconteo_Fisico) ?? '';
    row[COL.Malestado_Reconteo - 1] = firstValue_(item.Malestado_Reconteo, item.Reconteo_Mal_Estado) ?? '';
    return row;
  });
  const oldRows = sheet.getLastRow() - 1;
  if (sheet.getMaxRows && sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  if (oldRows > 0) sheet.getRange(2, 1, oldRows, 40).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 40).setValues(rows);
}

function readFinalInventory_(params) {
  const spreadsheetId = String(params.spreadsheetId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) throw new Error('Identificador de Google Sheets inválido');
  const file = DriveApp.getFileById(spreadsheetId);
  const parents = file.getParents();
  let isFinal = false;
  while (parents.hasNext()) { if (parents.next().getName() === 'Archivos Finales') isFinal = true; }
  if (!isFinal) throw new Error('El archivo no pertenece a Archivos Finales');
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const meta = ss.getSheetByName('__INVENTORY_MANIFEST');
  let manifest = null;
  if (meta) {
    manifest = JSON.parse(meta.getRange(1, 1).getValue());
    manifest.members = meta.getLastRow() > 1 ? meta.getRange(2, 1, meta.getLastRow() - 1, 1).getValues().map(row => row[0]) : [];
  }
  const center = String(params.center || '').trim();
  if (manifest && String(manifest.center) !== center) throw new Error('El centro solicitado no coincide con el manifiesto');
  const gid = hasValue_(params.gid) ? String(params.gid) : (manifest && manifest.gid !== undefined ? String(manifest.gid) : null);
  if (manifest && gid !== String(manifest.gid)) throw new Error('La pestaña solicitada no coincide con el cierre');
  const sheet = gid !== null ? ss.getSheets().find(s => String(s.getSheetId()) === gid) : ss.getSheetByName(center);
  if (!sheet || sheet.getName() === '__INVENTORY_MANIFEST') throw new Error('No se encontró la pestaña exacta del inventario; indique su centro o gid');
  if (!manifest && sheet.getName().trim() !== center) throw new Error('La pestaña no corresponde al centro solicitado');
  const columns = sheet.getLastColumn();
  const headers = columns ? sheet.getRange(1, 1, 1, columns).getDisplayValues()[0] : [];
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, columns).getValues() : [];
  return { headers, rows, manifest, sheetName: sheet.getName(), gid: sheet.getSheetId(),
    spreadsheetId, modifiedAt: file.getLastUpdated().toISOString() };
}

function readRowsAsObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  ensureColumns_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, 40).getValues();
  return values.map(rowToObject_);
}

function rowToObject_(r) {
  return {
    SKU: r[COL.SKU - 1],
    Codigo_Barras: r[COL.Codigo_Barras - 1],
    Descripcion: r[COL.Descripcion - 1],
    Ubicacion: r[COL.Ubicacion - 1],
    Ubicacion_1: r[COL.Ubicacion_1 - 1] || '',
    Ubicacion_2: r[COL.Ubicacion_2 - 1] || '',
    Almacen: r[COL.Almacen - 1],
    Categoria: r[COL.Almacen - 1] || 'repuesto',
    Clasificacion_ABC: r[COL.Clasificacion_ABC - 1],
    Unidad: r[COL.Unidad - 1],
    Costo_Unitario: r[COL.Costo_Unitario - 1],
    Stock_Sistema: r[COL.Stock_Sistema - 1],
    Stock_Total: r[COL.Stock_Total - 1],
    Stock_Fisico: r[COL.Stock_Total - 1], // Retrocompatibilidad para vistas que leen Stock_Fisico
    Mal_estado: r[COL.Mal_estado - 1],
    Diferencia: r[COL.Diferencia - 1],
    Costo_Diferencia: r[COL.Costo_Diferencia - 1],
    Fecha_Ultimo_Conteo: r[COL.Fecha_Ultimo_Conteo - 1],
    Stock_Buen_Estado: r[COL.Stock_Buen_Estado - 1],
    Responsable: r[COL.Responsable - 1],
    Estado: r[COL.Estado - 1],
    Fecha_Primera_Justificacion: r[COL.Fecha_Primera_Justificacion - 1] || null,
    Razon: r[COL.Razon - 1] || '',
    Comentario_Justificacion: r[COL.Comentario_Justificacion - 1] || '',
    Responsable_Justificacion: r[COL.Responsable_Justificacion - 1] || '',
    Fecha_Reconteo: r[COL.Fecha_Reconteo - 1] || null,
    Stock_Total_Reconteo: r[COL.Stock_Total_Reconteo - 1] !== undefined && r[COL.Stock_Total_Reconteo - 1] !== '' ? r[COL.Stock_Total_Reconteo - 1] : null,
    Reconteo: r[COL.Reconteo - 1] !== undefined && r[COL.Reconteo - 1] !== '' ? r[COL.Reconteo - 1] : null,
    Reconteo_Fisico: r[COL.Reconteo - 1] !== undefined && r[COL.Reconteo - 1] !== '' ? r[COL.Reconteo - 1] : null,
    Malestado_Reconteo: r[COL.Malestado_Reconteo - 1] !== undefined && r[COL.Malestado_Reconteo - 1] !== '' ? r[COL.Malestado_Reconteo - 1] : null,
    Reconteo_Mal_Estado: r[COL.Malestado_Reconteo - 1] !== undefined && r[COL.Malestado_Reconteo - 1] !== '' ? r[COL.Malestado_Reconteo - 1] : null,
    Diferencia_Final: r[COL.Diferencia_Final - 1] !== undefined && r[COL.Diferencia_Final - 1] !== '' ? r[COL.Diferencia_Final - 1] : null,
    Costo_Diferencia_Final: r[COL.Costo_Diferencia_Final - 1] !== undefined && r[COL.Costo_Diferencia_Final - 1] !== '' ? r[COL.Costo_Diferencia_Final - 1] : null,
    Fecha_Justificacion_2: r[COL.Fecha_Justificacion_2 - 1] || null,
    Estado_Justificacion_2: r[COL.Estado_Justificacion_2 - 1] || '',
    Razon_Justificacion_2: r[COL.Razon_Justificacion_2 - 1] || '',
    Comentario_Justificacion_2: r[COL.Comentario_Justificacion_2 - 1] || '',
    Responsable_Justificacion_2: r[COL.Responsable_Justificacion_2 - 1] || '',
    Fecha_Reconteo_2: r[COL.Fecha_Reconteo_2 - 1] || null,
    Stock_Total_Reconteo_2: r[COL.Stock_Total_Reconteo_2 - 1] !== undefined && r[COL.Stock_Total_Reconteo_2 - 1] !== '' ? r[COL.Stock_Total_Reconteo_2 - 1] : null,
    Reconteo_2: r[COL.Reconteo_2 - 1] !== undefined && r[COL.Reconteo_2 - 1] !== '' ? r[COL.Reconteo_2 - 1] : null,
    Malestado_Reconteo_2: r[COL.Malestado_Reconteo_2 - 1] !== undefined && r[COL.Malestado_Reconteo_2 - 1] !== '' ? r[COL.Malestado_Reconteo_2 - 1] : null,
    Diferencia_Final_2: r[COL.Diferencia_Final_2 - 1] !== undefined && r[COL.Diferencia_Final_2 - 1] !== '' ? r[COL.Diferencia_Final_2 - 1] : null,
    Costo_Diferencia_Final_2: r[COL.Costo_Diferencia_Final_2 - 1] !== undefined && r[COL.Costo_Diferencia_Final_2 - 1] !== '' ? r[COL.Costo_Diferencia_Final_2 - 1] : null
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

function savePhotoDirectly_(payload) {
  const center = String(payload.center || payload.centro || '').trim();
  const type = String(payload.type || 'BARRIDO').toUpperCase().trim();
  const sku = String(payload.sku || payload.SKU || payload.barcode || 'SKU').trim();
  const category = String(payload.category || payload.photoType || 'malestado').toLowerCase();

  if (category.indexOf('just') !== -1) {
    const saved = saveJustificationPhotoIfAny_(payload, center, type, sku);
    return { success: !!saved, photo: saved, category: 'justificaciones', sku, center, type };
  } else {
    const saved = saveDamagedPhotoIfAny_(payload, center, type, sku);
    return { success: !!saved, photo: saved, category: 'malestado', sku, center, type };
  }
}

function getDamagedPhotosTargetFolder_(center, type, dateStr) {
  const cleanCenter = String(center || CFG.defaultCenterIfMissing).trim();
  const cleanType = String(type || 'BARRIDO').toUpperCase().trim();
  const tz = Session.getScriptTimeZone() || 'America/La_Paz';
  let dateTag = dateStr ? String(dateStr).trim() : '';
  if (!dateTag) {
    dateTag = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  } else if (dateTag.indexOf('T') !== -1) {
    dateTag = dateTag.split('T')[0];
  }
  const centerTypeFolder = `${cleanCenter} ${cleanType}`;
  const segments = ['nibol', 'ciclicos', 'fotos', 'malestado', dateTag, centerTypeFolder];
  return resolveOrCreateDrivePath_(segments);
}

function getJustificationPhotosTargetFolder_(center, type, dateStr) {
  const cleanCenter = String(center || CFG.defaultCenterIfMissing).trim();
  const cleanType = String(type || 'BARRIDO').toUpperCase().trim();
  const tz = Session.getScriptTimeZone() || 'America/La_Paz';
  let dateTag = dateStr ? String(dateStr).trim() : '';
  if (!dateTag) {
    dateTag = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  } else if (dateTag.indexOf('T') !== -1) {
    dateTag = dateTag.split('T')[0];
  }
  const centerTypeFolder = `${cleanCenter} ${cleanType}`;
  const segments = ['nibol', 'ciclicos', 'fotos', 'justificaciones', dateTag, centerTypeFolder];
  return resolveOrCreateDrivePath_(segments);
}

function resolveOrCreateDrivePath_(segments) {
  if (!segments || !segments.length) {
    return DriveApp.getRootFolder();
  }

  let current = null;
  const firstSeg = String(segments[0]).trim();

  try {
    const root = DriveApp.getRootFolder();
    const rootFolders = root.getFolders();
    while (rootFolders.hasNext()) {
      const f = rootFolders.next();
      if (!f.isTrashed() && f.getName().trim().toLowerCase() === firstSeg.toLowerCase()) {
        current = f;
        break;
      }
    }

    if (!current) {
      const globalMatches = DriveApp.getFoldersByName(firstSeg);
      while (globalMatches.hasNext()) {
        const f = globalMatches.next();
        if (!f.isTrashed()) {
          current = f;
          break;
        }
      }
    }

    if (!current) {
      current = root.createFolder(firstSeg);
      try {
        current.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (_) {}
    }
  } catch (err) {
    current = DriveApp.getRootFolder();
  }

  for (let i = 1; i < segments.length; i++) {
    const segName = String(segments[i]).trim();
    if (!segName) continue;

    let found = null;
    const subFolders = current.getFolders();
    const segLower = segName.toLowerCase();

    while (subFolders.hasNext()) {
      const sf = subFolders.next();
      if (!sf.isTrashed()) {
        const sfLower = sf.getName().trim().toLowerCase();
        if (sfLower === segLower || sfLower.replace(/[_\s-]+/g, ' ') === segLower.replace(/[_\s-]+/g, ' ')) {
          found = sf;
          break;
        }
      }
    }

    if (!found) {
      try {
        found = current.createFolder(segName);
        try {
          found.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (_) {}
      } catch (errSub) {
        return current;
      }
    }
    current = found;
  }

  return current;
}

function saveDamagedPhotoIfAny_(payload, center, type, skuOrBar) {
  const photo = payload.photoBase64 || payload.photoUrl || payload.foto_mal_estado || payload.photo;
  // Optimización crítica: no consultar Google Drive si no hay foto real
  if (!photo || typeof photo !== 'string' || (!photo.startsWith('data:image') && !photo.startsWith('http'))) {
    return null;
  }

  let targetFolder = null;
  try {
    const invType = type || payload.type || (payload.inventoryId && String(payload.inventoryId).includes('BARRIDO') ? 'BARRIDO' : 'CICLICO');
    const dateStr = payload.date || payload.fecha || payload.fechaUltimoConteo;
    targetFolder = getDamagedPhotosTargetFolder_(center, invType, dateStr);
  } catch (errF) {
    Logger.log('Error creando carpeta fotos malestado: ' + errF.message);
  }

  if (!targetFolder) targetFolder = getRootFolderForType_(type);

  const cleanSku = String(skuOrBar || 'SKU').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = photoFileName_(payload, cleanSku, photo);

  const existing = targetFolder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType(), folderId: targetFolder.getId() };
  }

  return saveBase64Image_(targetFolder, fileName, photo);
}

function saveJustificationPhotoIfAny_(payload, center, type, skuOrBar) {
  const photo = payload.photoJustificacion || payload.photoBase64 || payload.justificationPhoto || payload.photoUrl || payload.photo;
  // Optimización crítica: no consultar Google Drive si no hay foto real
  if (!photo || typeof photo !== 'string' || (!photo.startsWith('data:image') && !photo.startsWith('http'))) {
    return null;
  }

  const isJustification = !!(payload.razon || payload.comentarioJustificacion || payload.justification || payload.action === 'saveJustification' || String(payload.category || '').includes('just') || payload.photoJustificacion);
  if (!isJustification) return null;

  let targetFolder = null;
  try {
    const invType = type || payload.type || (payload.inventoryId && String(payload.inventoryId).includes('BARRIDO') ? 'BARRIDO' : 'CICLICO');
    const dateStr = payload.date || payload.fecha || payload.fechaUltimoConteo;
    targetFolder = getJustificationPhotosTargetFolder_(center, invType, dateStr);
  } catch (errF) {
    Logger.log('Error creando carpeta fotos justificaciones: ' + errF.message);
  }

  if (!targetFolder) targetFolder = getRootFolderForType_(type);

  const cleanSku = String(skuOrBar || 'SKU').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = photoFileName_(payload, cleanSku, photo);

  const existing = targetFolder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType(), folderId: targetFolder.getId() };
  }

  return saveBase64Image_(targetFolder, fileName, photo);
}

function saveJustificationPhotosBatch_(justifications, center, type) {
  let saved = 0;
  (justifications || []).forEach(j => {
    const photo = j.photoBase64 || j.photoJustificacion || '';
    // Existing Drive URLs already refer to durable evidence; do not re-upload.
    if (!String(photo).startsWith('data:image/')) return;
    const result = saveJustificationPhotoIfAny_({ ...j, category: 'justificaciones', photoJustificacion: photo }, center, type, j.sku || j.SKU);
    if (!result) throw new Error('No se pudo guardar una foto del archivo final.');
    saved++;
  });
  return saved;
}

function photoFileName_(payload, sku, photo) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(photo));
  const hash = digest.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('').slice(0, 20);
  const identity = [payload.inventoryId || '', payload.itemId || sku, payload.almacen || '', payload.location || '', payload.category || '', payload.round || (payload.isJustification2 ? 2 : 1), hash].join('_');
  const ext = String(photo).startsWith('data:image/png') ? '.png' : String(photo).startsWith('data:image/webp') ? '.webp' : '.jpg';
  return identity.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 150) + '_' + hash + ext;
}

function saveBase64Image_(folder, fileName, dataUriOrBase64) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUriOrBase64 || ''));
  if (!match) throw new Error('Formato de imagen inválido; se requiere JPEG, PNG o WebP en base64.');
  const bytes = Utilities.base64Decode(match[2]);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Tamaño de imagen inválido.');
  const file = folder.createFile(Utilities.newBlob(bytes, match[1], fileName));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
  return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: match[1], folderId: folder.getId(), folderName: folder.getName() };
}

function getRootFolderForType_(type) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      const file = DriveApp.getFileById(ss.getId());
      const parents = file.getParents();
      if (parents.hasNext()) {
        const p = parents.next();
        if (p) return p;
      }
    }
  } catch (e) {}

  const cleanType = String(type || 'CICLICO').toUpperCase();
  const folderId = CFG.driveRoots[cleanType] || CFG.driveRoots['CICLICO'];
  if (folderId && !folderId.startsWith('1A987') && !folderId.startsWith('1B123')) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {}
  }
  return DriveApp.getRootFolder();
}

function getCenterFolder_(rootFolder, center) {
  const cleanCenter = String(center || CFG.defaultCenterIfMissing).trim();
  const rootName = rootFolder.getName().trim().toUpperCase();
  if (rootName === cleanCenter.toUpperCase() || rootName.includes(cleanCenter.toUpperCase())) {
    return rootFolder;
  }
  return getOrCreateFolder_(rootFolder, cleanCenter);
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

/**
 * Elimina o limpia una ubicación adicional (Ubicación 1 o Ubicación 2) de un ítem.
 * REGLA NUEVA:
 * Ya no elimina una fila completa del Sheet, sino que borra el valor en Col E o Col F.
 */
function deleteAdditionalLocation_(payload) {
  const center = String(payload.center || payload.centro || '').trim();
  const sku = norm_(payload.sku || payload.SKU || '');
  const location = norm_(payload.location || payload.ubicacion || payload.Ubicacion || '');
  const warehouse = norm_(payload.warehouse || payload.almacen || payload.Almacen || '');
  const slot = Number(payload.slot || payload.locationSlot || 0);

  if (!sku) throw new Error('deleteAdditionalLocation requiere sku');

  const sh = getCenterSheet_(center);
  ensureColumns_(sh);

  const found = findBySkuBarcode_(sh, sku, '', warehouse);
  if (!found) {
    return { success: true, cleared: false, message: 'Ítem no encontrado' };
  }

  const row = sh.getRange(found.rowNumber, 1, 1, 40).getValues()[0];
  const u1 = norm_(row[COL.Ubicacion_1 - 1]);
  const u2 = norm_(row[COL.Ubicacion_2 - 1]);

  let changed = false;
  if (slot === 2 || (location && u2 === location)) {
    row[COL.Ubicacion_2 - 1] = '';
    changed = true;
  } else if (slot === 1 || (location && u1 === location)) {
    row[COL.Ubicacion_1 - 1] = row[COL.Ubicacion_2 - 1] || '';
    row[COL.Ubicacion_2 - 1] = '';
    changed = true;
  }

  if (changed) {
    sh.getRange(found.rowNumber, COL.Ubicacion_1, 1, 2).setValues([[row[COL.Ubicacion_1 - 1], row[COL.Ubicacion_2 - 1]]]);
    return { success: true, cleared: true, sku, ubicacion1: row[COL.Ubicacion_1 - 1], ubicacion2: row[COL.Ubicacion_2 - 1] };
  }

  return { success: true, cleared: false, message: 'Ubicación no encontrada en Col E ni Col F' };
}

/**
 * Distribuye la base BD_BASE hacia las pestañas de cada centro según el nuevo orden de columnas.
 */
function distribuirBaseACentros() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBase = ss.getSheetByName("BD_BASE");
  
  if (!hojaBase) {
    SpreadsheetApp.getUi().alert("Error: No se encontró la pestaña BD_BASE.");
    return;
  }

  const ultimaFila = hojaBase.getLastRow();
  if (ultimaFila < 2) {
    SpreadsheetApp.getUi().alert("La pestaña BD_BASE está vacía.");
    return;
  }

  // Leer todas las columnas de BD_BASE
  const totalCols = hojaBase.getLastColumn();
  const datos = hojaBase.getRange(2, 1, ultimaFila - 1, totalCols).getValues();

  // Agrupar por Centro (Col G = Almacen = índice 6 en BD_BASE)
  const agrupadoPorCentro = {};

  datos.forEach(fila => {
    // Almacen / Centro está en Col G (índice 6)
    const centro = String(fila[6] || fila[4] || "").trim();
    if (centro) {
      if (!agrupadoPorCentro[centro]) {
        agrupadoPorCentro[centro] = [];
      }
      
      // Construir fila de 40 columnas para el nuevo formato
      const nuevaFila = new Array(40).fill("");
      nuevaFila[COL.SKU - 1] = fila[0] || "";               // Col A
      nuevaFila[COL.Codigo_Barras - 1] = fila[1] || "";      // Col B
      nuevaFila[COL.Descripcion - 1] = fila[2] || "";        // Col C
      nuevaFila[COL.Ubicacion - 1] = fila[3] || "";          // Col D
      nuevaFila[COL.Ubicacion_1 - 1] = fila[4] && fila[4] !== centro ? fila[4] : ""; // Col E
      nuevaFila[COL.Ubicacion_2 - 1] = fila[5] && fila[5] !== centro ? fila[5] : ""; // Col F
      nuevaFila[COL.Almacen - 1] = centro;                   // Col G
      nuevaFila[COL.Clasificacion_ABC - 1] = fila[7] || fila[5] || "C"; // Col H
      nuevaFila[COL.Unidad - 1] = fila[8] || fila[6] || "PZA";           // Col I
      nuevaFila[COL.Costo_Unitario - 1] = fila[9] || fila[7] || 0;       // Col J
      nuevaFila[COL.Stock_Sistema - 1] = fila[10] || fila[8] || 0;      // Col K
      nuevaFila[COL.Estado - 1] = "";                                   // Col T (Justificación - Vacío inicialmente)

      agrupadoPorCentro[centro].push(nuevaFila);
    }
  });

  // Escribir a cada hoja de centro
  for (const centro in agrupadoPorCentro) {
    let hojaDestino = ss.getSheetByName(centro);
    if (!hojaDestino) {
      hojaDestino = ss.insertSheet(centro);
    }

    ensureColumns_(hojaDestino);

    // Limpiar contenido previo desde fila 2
    if (hojaDestino.getLastRow() > 1) {
      hojaDestino.getRange(2, 1, hojaDestino.getLastRow() - 1, 40).clearContent();
    }

    const filasParaInsertar = agrupadoPorCentro[centro];
    if (filasParaInsertar.length > 0) {
      hojaDestino.getRange(2, 1, filasParaInsertar.length, 40).setValues(filasParaInsertar);
    }
  }

  SpreadsheetApp.getUi().alert("Distribución completada exitosamente.");
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

function firstValue_() {
  for (let i = 0; i < arguments.length; i++) if (hasValue_(arguments[i])) return arguments[i];
  return null;
}

function operationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('_NIBOL_SYNC');
  if (!sheet) {
    sheet = ss.insertSheet('_NIBOL_SYNC');
    sheet.appendRow(['Operacion', 'Resultado', 'Fecha']);
    sheet.hideSheet();
  }
  return sheet;
}
function readOperation_(id) {
  const sheet = operationSheet_();
  if (sheet.getLastRow() < 2) return null;
  const cell = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).useRegularExpression(false).findNext();
  return cell ? JSON.parse(sheet.getRange(cell.getRow(), 2).getValue()) : null;
}
function confirmOperation_(body, result) {
  if (body.operationId && result.success === true) operationSheet_().appendRow([String(body.operationId), JSON.stringify(result), new Date()]);
  SpreadsheetApp.flush();
  return json_(result);
}
