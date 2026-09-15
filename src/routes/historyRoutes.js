const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const storagePath = require('../services/storagePath');
const config = require('../config');
const gasService = require('../services/gasService');
const { authenticate } = require('../middlewares/authMiddleware');
const { restrictCenter } = require('../middlewares/centerMiddleware');

// A final-file returned by GAS is considered CICLICO only when its identity
// actually contains CICLICO. This prevents files from other inventory flows
// (e.g. SEMANAL) from appearing in the CICLICO history when GAS scans the
// shared Drive root.
function isCiclicoHistoryItem(item) {
  if (!item) return false;

  const type = String(item.type || '').trim().toUpperCase();
  const fileName = String(item.fileName || '').trim().toUpperCase();
  const inventoryId = String(item.inventoryId || '').trim().toUpperCase();

  // Strong positive match: explicit CICLICO in the file/inventory identity.
  if (fileName.includes('CICLICO') || inventoryId.includes('CICLICO')) return true;

  // If GAS/local data explicitly identifies another type, reject it.
  if (type && !['CICLICO', 'CICLICOS'].includes(type)) return false;

  // Do not guess CICLICO for unrelated files with no usable identity.
  return false;
}

// GET /api/history (List finalized inventories directly from Google Drive / Sheets)
router.get('/', authenticate, restrictCenter, async (req, res) => {
  try {
    const historyDir = storagePath.getHistoryDirectory();
    const files = storagePath.listFiles(historyDir).filter(f => f.endsWith('.json'));
    const list = [];
    const seenKeys = new Set();

    // 1. Query live history directly from Google Drive and Google Sheets via GAS
    try {
      const userCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? null : req.user.center;
      const gasHistory = await gasService.getHistoryFromGAS('CICLICO', userCenter);
      if (Array.isArray(gasHistory) && gasHistory.length > 0) {
        gasHistory.forEach(item => {
          if (!item || !isCiclicoHistoryItem(item)) return;
          if (req.user.role !== 'ADMIN' && !req.user.isSuperadmin) {
            if (item.center && !config.isSameCenter(item.center, req.user.center)) return;
          }

          const dedupeKey = (item.fileId || item.fileName || '').toLowerCase();
          if (dedupeKey) seenKeys.add(dedupeKey);

          list.push({
            fileId: item.fileId || `DRIVE-${Date.now()}`,
            fileName: item.fileName,
            logicalPath: item.logicalPath || `Nibol/Ciclicosn/${item.fileName}`,
            inventoryId: item.inventoryId || item.fileId,
            type: item.type || 'CICLICO',
            center: item.center || '1120',
            closedBy: item.closedBy || 'Admin / GAS',
            closedAt: item.closedAt || new Date().toISOString(),
            totalItems: Number(item.totalItems || item.processed || 0),
            justificationsCount: Number(item.justificationsCount || item.savedJustificationPhotos || 0),
            driveUrl: item.driveUrl || item.spreadsheetUrl || process.env.DRIVE_REFERENCE_FOLDER_URL || null,
            spreadsheetUrl: item.spreadsheetUrl || item.driveUrl || null,
            source: 'GOOGLE_DRIVE'
          });
        });
      }
    } catch (gasErr) {
      console.warn('[historyRoutes] Warning fetching from Google Drive:', gasErr.message);
    }

    // 2. Fallback to local files if not already populated from Drive
    files.forEach(f => {
      const record = storagePath.readJson(path.join(historyDir, f), null);
      if (!record || !isCiclicoHistoryItem(record)) return;

      const dedupeKey = (record.fileId || record.fileName || '').toLowerCase();
      if (seenKeys.has(dedupeKey)) return;

      if (req.user.role !== 'ADMIN' && !req.user.isSuperadmin) {
        if (!config.isSameCenter(record.center, req.user.center)) return;
      }

      list.push({
        fileId: record.fileId,
        fileName: record.fileName,
        logicalPath: record.logicalPath,
        inventoryId: record.inventoryId,
        type: record.type,
        center: record.center,
        closedBy: record.closedBy,
        closedAt: record.closedAt,
        totalItems: record.totalItems,
        justificationsCount: record.justificationsCount,
        driveUrl: record.driveUrl || record.spreadsheetUrl || process.env.DRIVE_REFERENCE_FOLDER_URL || null,
        spreadsheetUrl: record.spreadsheetUrl || record.driveUrl || null,
        source: 'LOCAL'
      });
    });

    res.json({
      success: true,
      history: list.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/history/:fileId (Detail)
router.get('/:fileId', authenticate, async (req, res) => {
  try {
    const historyDir = storagePath.getHistoryDirectory();
    const filePath = path.join(historyDir, `${req.params.fileId}.json`);
    let record = storagePath.readJson(filePath, null);

    if (!record) {
      // Fallback: search in Google Drive / Google Sheets via GAS
      try {
        const gasHistory = await gasService.getHistoryFromGAS('CICLICO', null);
        if (Array.isArray(gasHistory)) {
          const match = gasHistory.find(h =>
            isCiclicoHistoryItem(h) &&
            (h.fileId === req.params.fileId ||
            h.fileName === req.params.fileId ||
            (h.fileId && req.params.fileId.includes(h.fileId)))
          );
          if (match) {
            record = {
              fileId: match.fileId,
              fileName: match.fileName,
              type: match.type || 'CICLICO',
              center: match.center || '1120',
              closedBy: match.closedBy || 'Administrador',
              closedAt: match.closedAt,
              totalItems: Number(match.totalItems || 0),
              driveUrl: match.driveUrl || match.spreadsheetUrl,
              spreadsheetUrl: match.spreadsheetUrl,
              reviewNotes: match.notes || 'Registrado en Google Drive / Google Sheets',
              items: match.items || []
            };
          }
        }
      } catch (gasErr) {
        console.warn('[historyRoutes] GAS lookup fallback notice:', gasErr.message);
      }
    }

    if (!record) {
      return res.status(404).json({ success: false, message: 'Registro histórico no encontrado' });
    }

    if (!isCiclicoHistoryItem(record)) {
      return res.status(404).json({ success: false, message: 'Registro histórico CICLICO no encontrado' });
    }

    if (req.user.role !== 'ADMIN' && !req.user.isSuperadmin && !config.isSameCenter(record.center, req.user.center)) {
      return res.status(403).json({ success: false, message: 'Acceso denegado a registros de otro centro' });
    }

    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/history/:fileId/download (Export CSV representation)
router.get('/:fileId/download', authenticate, (req, res) => {
  try {
    const historyDir = storagePath.getHistoryDirectory();
    const filePath = path.join(historyDir, `${req.params.fileId}.json`);
    const record = storagePath.readJson(filePath, null);

    if (!record) {
      return res.status(404).send('Registro no encontrado');
    }

    // Generate official CSV with all 37 columns A to AK
    const headers = [
      'SKU',
      'Codigo_Barras',
      'Descripcion',
      'Ubicacion',
      'Ubicacion 1',
      'Ubicacion 2',
      'Almacen',
      'Clasificacion_ABC',
      'Unidad',
      'Costo_Unitario',
      'Stock_Sistema',
      'Stock_Fisico',
      'Diferencia',
      'Costo_Diferencia',
      'Fecha_Ultimo_Conteo',
      'Responsable',
      'Mal_estado',
      'FECHA PRIMERA JUSTIFICACION',
      'Estado',
      'Razon',
      'Comentario Justificacion',
      'RESPONSABLE JUSTIFICACION',
      'Fecha reconteo',
      'RECONTEO',
      'MALESTADO RECONTEO',
      'Diferencia Final',
      'Costo Diferencia Final',
      'FECHA JUSTIFICACION 2',
      'ESTADO JUSTIFICACION 2',
      'Razon JUSTIFICACION 2',
      'Comentario Justificacion 2',
      'RESPONSABLE JUSTIFICACION 2',
      'Fecha reconteo 2',
      'RECONTEO 2',
      'MALESTADO RECONTEO 2',
      'Diferencia Final 2',
      'Costo Diferencia Final 2'
    ];

    let csvContent = '\uFEFF' + headers.join(';') + '\n';

    (record.items || []).forEach(it => {
      const hasReconteo1 = it.Reconteo !== null && it.Reconteo !== undefined && it.Reconteo !== '';
      const hasReconteo2 = it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && it.Reconteo_2 !== '';

      const row = [
        `"${it.SKU || ''}"`,                                              // A: SKU
        `"${it.Codigo_Barras || ''}"`,                                     // B: Codigo_Barras
        `"${(it.Descripcion || '').replace(/"/g, '""')}"`,                 // C: Descripcion
        `"${it.Ubicacion || ''}"`,                                         // D: Ubicacion
        `"${it.Ubicacion_1 || ''}"`,                                       // E: Ubicacion 1
        `"${it.Ubicacion_2 || ''}"`,                                       // F: Ubicacion 2
        `"${it.Almacen || record.center || ''}"`,                          // G: Almacen
        `"${it.Clasificacion_ABC || 'C'}"`,                                // H: Clasificacion_ABC
        `"${it.Unidad || 'PZA'}"`,                                         // I: Unidad
        (it.Costo_Unitario !== null && it.Costo_Unitario !== undefined) ? it.Costo_Unitario : 0, // J: Costo_Unitario
        (it.Stock_Sistema !== null && it.Stock_Sistema !== undefined) ? it.Stock_Sistema : 0,     // K: Stock_Sistema
        (it.Stock_Fisico !== null && it.Stock_Fisico !== undefined) ? it.Stock_Fisico : '',      // L: Stock_Fisico
        (it.Diferencia !== null && it.Diferencia !== undefined) ? it.Diferencia : '',             // M: Diferencia
        (it.Costo_Diferencia !== null && it.Costo_Diferencia !== undefined) ? it.Costo_Diferencia : '', // N: Costo_Diferencia
        `"${it.Fecha_Ultimo_Conteo || ''}"`,                               // O: Fecha_Ultimo_Conteo
        `"${it.Responsable || ''}"`,                                       // P: Responsable
        (it.Mal_estado !== null && it.Mal_estado !== undefined) ? it.Mal_estado : 0,             // Q: Mal_estado
        `"${it.Fecha_Primera_Justificacion || ''}"`,                       // R: FECHA PRIMERA JUSTIFICACION
        `"${it.Estado || ''}"`,                                            // S: Estado (CUADRA / NO CUADRA)
        `"${it.Razon || ''}"`,                                             // T: Razon
        `"${(it.Comentario_Justificacion || '').replace(/"/g, '""')}"`,    // U: Comentario Justificacion
        `"${it.Responsable_Justificacion || ''}"`,                         // V: RESPONSABLE JUSTIFICACION
        `"${it.Fecha_Reconteo || ''}"`,                                    // W: Fecha reconteo
        hasReconteo1 ? it.Reconteo : '',                                   // X: RECONTEO
        hasReconteo1 ? (it.Malestado_Reconteo !== null && it.Malestado_Reconteo !== undefined ? it.Malestado_Reconteo : 0) : '', // Y: MALESTADO RECONTEO
        hasReconteo1 ? (it.Diferencia_Final !== null && it.Diferencia_Final !== undefined ? it.Diferencia_Final : '') : '',       // Z: Diferencia Final
        hasReconteo1 ? (it.Costo_Diferencia_Final !== null && it.Costo_Diferencia_Final !== undefined ? it.Costo_Diferencia_Final : '') : '', // AA: Costo Diferencia Final
        `"${it.Fecha_Justificacion_2 || ''}"`,                             // AB: FECHA JUSTIFICACION 2
        `"${it.Estado_Justificacion_2 || ''}"`,                            // AC: ESTADO JUSTIFICACION 2
        `"${it.Razon_Justificacion_2 || ''}"`,                             // AD: Razon JUSTIFICACION 2
        `"${(it.Comentario_Justificacion_2 || '').replace(/"/g, '""')}"`,  // AE: Comentario Justificacion 2
        `"${it.Responsable_Justificacion_2 || ''}"`,                       // AF: RESPONSABLE JUSTIFICACION 2
        `"${it.Fecha_Reconteo_2 || ''}"`,                                  // AG: Fecha reconteo 2
        hasReconteo2 ? it.Reconteo_2 : '',                                 // AH: RECONTEO 2
        hasReconteo2 ? (it.Malestado_Reconteo_2 !== null && it.Malestado_Reconteo_2 !== undefined ? it.Malestado_Reconteo_2 : 0) : '', // AI: MALESTADO RECONTEO 2
        hasReconteo2 ? (it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== undefined ? it.Diferencia_Final_2 : '') : '',       // AJ: Diferencia Final 2
        hasReconteo2 ? (it.Costo_Diferencia_Final_2 !== null && it.Costo_Diferencia_Final_2 !== undefined ? it.Costo_Diferencia_Final_2 : '') : '' // AK: Costo Diferencia Final 2
      ];
      csvContent += row.join(';') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${record.fileName.replace('.xlsx', '.csv')}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).send('Error exportando reporte: ' + err.message);
  }
});

module.exports = router;
