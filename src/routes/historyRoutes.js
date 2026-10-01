const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const storagePath = require('../services/storagePath');
const config = require('../config');
const gasService = require('../services/gasService');
const snapshotService = require('../services/snapshotService');
const { authenticate, requireAlonso } = require('../middlewares/authMiddleware');
const { restrictCenter } = require('../middlewares/centerMiddleware');

// GET /api/history (List finalized inventories directly from Google Drive / Sheets)
router.get('/', authenticate, restrictCenter, async (req, res) => {
  try {
    const historyDir = storagePath.getHistoryDirectory();
    const files = storagePath.listFiles(historyDir).filter(f => f.endsWith('.json'));
    const list = [];
    const seenKeys = new Set();

    // Map existing valid local snapshots first (excluding deleted snapshots)
    const validSnapshotsMap = new Map();
    files.forEach(f => {
      if (snapshotService.isSnapshotDeleted(f)) return;
      const record = storagePath.readJson(path.join(historyDir, f), null);
      if (record && !snapshotService.isSnapshotDeleted(record) && Array.isArray(record.items) && record.items.length > 0) {
        const id = record.fileId || record.inventoryId || f.replace(/\.json$/, '');
        validSnapshotsMap.set(String(id).toLowerCase().trim(), record);
        if (record.fileId) validSnapshotsMap.set(String(record.fileId).toLowerCase().trim(), record);
        if (record.inventoryId) validSnapshotsMap.set(String(record.inventoryId).toLowerCase().trim(), record);
        if (record.fileName) validSnapshotsMap.set(String(record.fileName).toLowerCase().trim(), record);
      }
    });

    // 1. Query live history directly from Google Drive and Google Sheets via GAS
    try {
      const userCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? null : req.user.center;
      const gasHistory = await gasService.getHistoryFromGAS('CICLICO', userCenter);
      if (Array.isArray(gasHistory) && gasHistory.length > 0) {
        for (const item of gasHistory) {
          if (!item) continue;
          if (snapshotService.isSnapshotDeleted(item)) continue;
          if (req.user.role !== 'ADMIN' && !req.user.isSuperadmin) {
            if (item.center && !config.isSameCenter(item.center, req.user.center)) continue;
          }

          const dedupeKey = (item.fileId || item.fileName || '').toLowerCase().trim();
          if (dedupeKey && seenKeys.has(dedupeKey)) continue;

          // Check if a local snapshot with items exists
          let localSnapshot = validSnapshotsMap.get(dedupeKey) ||
            (item.fileId ? validSnapshotsMap.get(String(item.fileId).toLowerCase().trim()) : null) ||
            (item.inventoryId ? validSnapshotsMap.get(String(item.inventoryId).toLowerCase().trim()) : null);

          let hasPhysicalItems = Array.isArray(item.items) && item.items.length > 0;
          let totalCount = Number(item.totalItems || item.processed || 0);

          // If no local snapshot and no embedded items, verify if physical document exists and can be retrieved
          if (!localSnapshot && !hasPhysicalItems && (item.spreadsheetUrl || item.driveUrl)) {
            try {
              const fetched = await gasService.fetchSpreadsheetItems(item.spreadsheetUrl || item.driveUrl);
              if (fetched && fetched.length > 0) {
                hasPhysicalItems = true;
                totalCount = fetched.length;
                // Save snapshot locally so future accesses are instant
                const savePath = path.join(historyDir, `${item.fileId || Date.now()}.json`);
                const snapData = {
                  fileId: item.fileId,
                  fileName: item.fileName,
                  center: item.center || '1120',
                  type: item.type || 'CICLICO',
                  closedAt: item.closedAt || new Date().toISOString(),
                  closedBy: item.closedBy || 'Admin / GAS',
                  totalItems: fetched.length,
                  driveUrl: item.driveUrl,
                  spreadsheetUrl: item.spreadsheetUrl,
                  items: fetched
                };
                storagePath.writeJson(savePath, snapData);
                validSnapshotsMap.set(dedupeKey, snapData);
                localSnapshot = snapData;
              }
            } catch (_) {}
          }

          // CRITICAL: If neither snapshot exists nor physical document has items, automatically DO NOT show it!
          if (!localSnapshot && !hasPhysicalItems && totalCount <= 0) {
            continue;
          }

          if (dedupeKey) seenKeys.add(dedupeKey);
          if (item.fileId) seenKeys.add(String(item.fileId).toLowerCase().trim());
          if (item.inventoryId) seenKeys.add(String(item.inventoryId).toLowerCase().trim());
          if (localSnapshot && localSnapshot.fileId) seenKeys.add(String(localSnapshot.fileId).toLowerCase().trim());

          list.push({
            fileId: item.fileId || (localSnapshot ? localSnapshot.fileId : `DRIVE-${Date.now()}`),
            fileName: item.fileName || (localSnapshot ? localSnapshot.fileName : 'Inventario'),
            logicalPath: item.logicalPath || (localSnapshot ? localSnapshot.logicalPath : null),
            inventoryId: item.inventoryId || item.fileId || (localSnapshot ? localSnapshot.inventoryId : null),
            type: item.type || (localSnapshot ? localSnapshot.type : 'CICLICO'),
            center: item.center || (localSnapshot ? localSnapshot.center : '1120'),
            closedBy: item.closedBy || (localSnapshot ? localSnapshot.closedBy : 'Admin / GAS'),
            closedAt: item.closedAt || (localSnapshot ? localSnapshot.closedAt : new Date().toISOString()),
            totalItems: Number(localSnapshot && localSnapshot.items ? localSnapshot.items.length : (item.totalItems || totalCount)),
            justificationsCount: Number(item.justificationsCount || item.savedJustificationPhotos || (localSnapshot ? localSnapshot.justificationsCount : 0) || 0),
            driveUrl: item.driveUrl || item.spreadsheetUrl || (localSnapshot ? localSnapshot.driveUrl : null) || process.env.DRIVE_REFERENCE_FOLDER_URL || null,
            spreadsheetUrl: item.spreadsheetUrl || item.driveUrl || (localSnapshot ? localSnapshot.spreadsheetUrl : null),
            source: localSnapshot ? 'SNAPSHOT' : 'GOOGLE_DRIVE'
          });
        }
      }
    } catch (gasErr) {
      console.warn('[historyRoutes] Warning fetching from Google Drive:', gasErr.message);
    }

    // 2. Fallback to valid local snapshot files if not already populated from Drive
    files.forEach(f => {
      if (snapshotService.isSnapshotDeleted(f)) return;
      const record = storagePath.readJson(path.join(historyDir, f), null);
      // Ensure local file is a real snapshot with actual items and not deleted
      if (!record || snapshotService.isSnapshotDeleted(record) || !Array.isArray(record.items) || record.items.length === 0) return;

      const dedupeKey = (record.fileId || record.fileName || f.replace(/\.json$/, '')).toLowerCase().trim();
      if (seenKeys.has(dedupeKey)) return;
      if (record.fileId && seenKeys.has(String(record.fileId).toLowerCase().trim())) return;
      if (record.inventoryId && seenKeys.has(String(record.inventoryId).toLowerCase().trim())) return;

      if (req.user.role !== 'ADMIN' && !req.user.isSuperadmin) {
        if (!config.isSameCenter(record.center, req.user.center)) return;
      }

      seenKeys.add(dedupeKey);

      list.push({
        fileId: record.fileId || f.replace(/\.json$/, ''),
        fileName: record.fileName || f,
        logicalPath: record.logicalPath,
        inventoryId: record.inventoryId,
        type: record.type || 'CICLICO',
        center: record.center || '1120',
        closedBy: record.closedBy || 'Administrador',
        closedAt: record.closedAt || new Date().toISOString(),
        totalItems: (record.items || []).length,
        justificationsCount: record.justificationsCount || 0,
        driveUrl: record.driveUrl || record.spreadsheetUrl || process.env.DRIVE_REFERENCE_FOLDER_URL || null,
        spreadsheetUrl: record.spreadsheetUrl || record.driveUrl || null,
        source: 'SNAPSHOT'
      });
    });

    // Deduplicar para mantener solo el snapshot final si existe tanto el maestro como el snapshot
    const isFinal = (item) => {
      const s = `${item.fileName || ''} ${item.fileId || ''}`.toUpperCase();
      return s.includes('FINAL') || s.includes('SNAPSHOT');
    };
    const getSheetId = (url) => {
      if (!url) return '';
      const m = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : '';
    };
    const groups = new Map();
    for (const item of list) {
      const sid = getSheetId(item.spreadsheetUrl || item.driveUrl);
      const k = sid ? `sheet:${sid}` : (item.inventoryId ? `inv:${item.inventoryId}` : `c:${item.center}:${(item.closedAt || '').substring(0, 10)}`);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    }
    const deduplicatedList = [];
    for (const [, group] of groups.entries()) {
      if (group.length === 1) {
        deduplicatedList.push(group[0]);
      } else {
        const finalSnap = group.find(it => isFinal(it));
        deduplicatedList.push(finalSnap || group[0]);
      }
    }

    res.json({
      success: true,
      history: deduplicatedList.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/history/:fileId (Detail)
router.get('/:fileId', authenticate, async (req, res) => {
  try {
    if (snapshotService.isSnapshotDeleted(req.params.fileId)) {
      return res.status(404).json({ success: false, message: 'Registro histórico no encontrado o eliminado' });
    }

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

    if ((!record.items || record.items.length === 0) && (record.spreadsheetUrl || record.driveUrl)) {
      try {
        const fetchedItems = await gasService.fetchSpreadsheetItems(record.spreadsheetUrl || record.driveUrl);
        if (fetchedItems && fetchedItems.length > 0) {
          record.items = fetchedItems;
          record.totalItems = fetchedItems.length;
          storagePath.writeJson(filePath, record);
        }
      } catch (fErr) {
        console.warn('[historyRoutes] Error fetching sheet items for record detail:', fErr.message);
      }
    }

    if (!record.items || record.items.length === 0) {
      return res.status(404).json({ success: false, message: 'Registro histórico no encontrado o sin datos físicos' });
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
router.get('/:fileId/download', authenticate, async (req, res) => {
  try {
    if (snapshotService.isSnapshotDeleted(req.params.fileId)) {
      return res.status(404).send('Registro no encontrado o eliminado');
    }

    const historyDir = storagePath.getHistoryDirectory();
    const filePath = path.join(historyDir, `${req.params.fileId}.json`);
    let record = storagePath.readJson(filePath, null);

    if (!record) {
      try {
        const gasHistory = await gasService.getHistoryFromGAS('CICLICO', null);
        if (Array.isArray(gasHistory)) {
          const match = gasHistory.find(h =>
            (h.fileId === req.params.fileId ||
            h.fileName === req.params.fileId ||
            (h.fileId && req.params.fileId.includes(h.fileId))) &&
            !snapshotService.isSnapshotDeleted(h)
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
        console.warn('[historyRoutes] GAS lookup fallback notice on download:', gasErr.message);
      }
    }

    if (!record) {
      return res.status(404).send('Registro no encontrado');
    }

    if ((!record.items || record.items.length === 0) && (record.spreadsheetUrl || record.driveUrl)) {
      try {
        const fetchedItems = await gasService.fetchSpreadsheetItems(record.spreadsheetUrl || record.driveUrl);
        if (fetchedItems && fetchedItems.length > 0) {
          record.items = fetchedItems;
          record.totalItems = fetchedItems.length;
          storagePath.writeJson(filePath, record);
        }
      } catch (fErr) {
        console.warn('[historyRoutes] Error fetching sheet items for download:', fErr.message);
      }
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

// DELETE /api/history/:fileId (Permanently delete snapshot & purge consolidated calculations - Alonso only)
router.delete('/:fileId', authenticate, requireAlonso, async (req, res) => {
  try {
    const result = await snapshotService.deleteSnapshot({
      fileId: req.params.fileId,
      user: req.user,
      reason: req.body?.reason || 'Eliminado formalmente desde el perfil de Alonso'
    });
    res.json(result);
  } catch (err) {
    console.error('[historyRoutes] Error deleting snapshot:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

module.exports = router;
