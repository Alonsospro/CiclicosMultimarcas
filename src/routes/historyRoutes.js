const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const storagePath = require('../services/storagePath');
const config = require('../config');
const gasService = require('../services/gasService');
const { authenticate } = require('../middlewares/authMiddleware');
const { restrictCenter } = require('../middlewares/centerMiddleware');

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
          if (!item) return;
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
      if (!record) return;

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
            h.fileId === req.params.fileId ||
            h.fileName === req.params.fileId ||
            (h.fileId && req.params.fileId.includes(h.fileId))
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

    // Generate standard CSV with all 16 columns A to P
    const headers = [
      'SKU', 'Codigo_Barras', 'Descripcion', 'Ubicacion', 'Categoria',
      'Clasificacion_ABC', 'Unidad', 'Costo_Unitario', 'Stock_Sistema',
      'Stock_Fisico', 'Diferencia', 'Costo_Diferencia', 'Fecha_Ultimo_Conteo',
      'Responsable', 'Estado', 'Mal_estado'
    ];

    let csvContent = '\uFEFF' + headers.join(',') + '\n';

    (record.items || []).forEach(it => {
      const row = [
        `"${it.SKU || ''}"`,
        `"${it.Codigo_Barras || ''}"`,
        `"${(it.Descripcion || '').replace(/"/g, '""')}"`,
        `"${it.Ubicacion || ''}"`,
        `"${it.Categoria || ''}"`,
        `"${it.Clasificacion_ABC || ''}"`,
        `"${it.Unidad || ''}"`,
        it.Costo_Unitario || 0,
        it.Stock_Sistema || 0,
        it.Stock_Fisico !== null ? it.Stock_Fisico : '',
        it.Diferencia || 0,
        it.Costo_Diferencia || 0,
        `"${it.Fecha_Ultimo_Conteo || ''}"`,
        `"${it.Responsable || ''}"`,
        `"${it.Estado || ''}"`,
        it.Mal_estado || 0
      ];
      csvContent += row.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${record.fileName.replace('.xlsx', '.csv')}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).send('Error exportando reporte: ' + err.message);
  }
});

module.exports = router;
