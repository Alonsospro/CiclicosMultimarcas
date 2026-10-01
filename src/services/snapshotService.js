const fs = require('fs');
const path = require('path');
const storagePath = require('./storagePath');
const config = require('../config');
const auditService = require('./auditService');

function isAlonso(user) {
  if (!user) return false;
  if (user.isSuperadmin) return true;
  if (user.permissions && user.permissions.deleteSnapshots === true) return true;
  const u = String(user.username || user.usuario || '').toLowerCase().trim();
  const d = String(user.displayName || user.name || '').toLowerCase().trim();
  const email = String(user.email || '').toLowerCase().trim();
  return u === 'alonso' || d.includes('alonso') || email === 'alonsospro@gmail.com' || (user.isSuperadmin && u === 'alonso');
}

function extractSheetId(url) {
  if (!url) return '';
  const m = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : '';
}

class SnapshotService {
  constructor() {
    this.tombstoneFile = path.join(storagePath.getDataDirectory(), 'deleted_snapshots.json');
  }

  getTombstones() {
    return storagePath.readJson(this.tombstoneFile, []);
  }

  saveTombstones(list) {
    storagePath.writeJson(this.tombstoneFile, list);
  }

  isSnapshotDeleted(itemOrId) {
    if (!itemOrId) return false;
    const tombstones = this.getTombstones();
    if (!Array.isArray(tombstones) || tombstones.length === 0) return false;

    const targetIds = new Set();
    if (typeof itemOrId === 'string') {
      const clean = itemOrId.toLowerCase().trim();
      targetIds.add(clean);
      targetIds.add(clean.replace(/\.json$/, ''));
      targetIds.add(clean.replace(/\.xlsx$/, ''));
      const sId = extractSheetId(itemOrId);
      if (sId) targetIds.add(sId.toLowerCase());
    } else if (typeof itemOrId === 'object') {
      if (itemOrId.id) {
        const idStr = String(itemOrId.id).toLowerCase().trim();
        targetIds.add(idStr);
        targetIds.add(idStr.replace(/\.json$/, ''));
      }
      if (itemOrId.fileId) {
        const fStr = String(itemOrId.fileId).toLowerCase().trim();
        targetIds.add(fStr);
        targetIds.add(fStr.replace(/\.json$/, ''));
      }
      if (itemOrId.inventoryId) {
        const invStr = String(itemOrId.inventoryId).toLowerCase().trim();
        targetIds.add(invStr);
        targetIds.add(invStr.replace(/\.json$/, ''));
      }
      if (itemOrId.fileName) {
        const fn = String(itemOrId.fileName).toLowerCase().trim();
        targetIds.add(fn);
        targetIds.add(fn.replace(/\.xlsx$/, '').replace(/\.json$/, '').replace(/\.csv$/, ''));
      }
      const sId = extractSheetId(itemOrId.spreadsheetUrl || itemOrId.driveUrl);
      if (sId) targetIds.add(sId.toLowerCase());
    }

    return tombstones.some(t => {
      const tFileId = String(t.fileId || '').toLowerCase().trim();
      const tInvId = String(t.inventoryId || '').toLowerCase().trim();
      const tFileName = String(t.fileName || '').toLowerCase().trim();
      const tSheetId = String(t.sheetId || '').toLowerCase().trim();

      for (const tid of targetIds) {
        if (!tid) continue;
        if (tFileId && (tid === tFileId || tid.includes(tFileId) || tFileId.includes(tid))) return true;
        if (tInvId && (tid === tInvId || tid.includes(tInvId) || tInvId.includes(tid))) return true;
        if (tSheetId && (tid === tSheetId || tid.includes(tSheetId))) return true;
        if (tFileName && (tid === tFileName || tid.replace(/\.xlsx$/, '').replace(/\.json$/, '') === tFileName.replace(/\.xlsx$/, '').replace(/\.json$/, ''))) return true;
      }
      return false;
    });
  }

  async deleteSnapshot({ fileId, user, reason }) {
    if (!isAlonso(user)) {
      const err = new Error('Acceso denegado: Solo el perfil de usuario de Alonso tiene autorización para borrar snapshots y depurar cálculos.');
      err.status = 403;
      throw err;
    }

    if (!fileId) {
      const err = new Error('Identificador de snapshot requerido');
      err.status = 400;
      throw err;
    }

    const historyDir = storagePath.getHistoryDirectory();
    const invDir = storagePath.getInventoriesDirectory();
    const trashDir = storagePath.getTrashDirectory();

    const cleanId = String(fileId).trim();
    const cleanIdNorm = cleanId.toLowerCase().replace(/\.json$/, '');

    // 1. Search for all matching snapshot files in history
    const historyFiles = storagePath.listFiles(historyDir).filter(f => f.endsWith('.json'));
    const matchedRecords = [];
    const filesToDelete = [];

    let detectedInventoryId = null;
    let detectedFileName = null;
    let detectedSheetId = null;
    let detectedCenter = 'GLOBAL';

    for (const f of historyFiles) {
      const filePath = path.join(historyDir, f);
      const record = storagePath.readJson(filePath, null);
      if (!record) continue;

      const rFileId = String(record.fileId || f.replace(/\.json$/, '')).toLowerCase().trim();
      const rInvId = String(record.inventoryId || '').toLowerCase().trim();
      const rFileName = String(record.fileName || '').toLowerCase().trim();
      const sId = extractSheetId(record.spreadsheetUrl || record.driveUrl).toLowerCase().trim();

      const isMatch = (
        rFileId === cleanIdNorm ||
        f.replace(/\.json$/, '').toLowerCase() === cleanIdNorm ||
        (cleanIdNorm.length >= 10 && rFileId.includes(cleanIdNorm)) ||
        (rInvId && rInvId === cleanIdNorm) ||
        (rFileName && (rFileName === cleanIdNorm || rFileName.replace(/\.xlsx$/, '') === cleanIdNorm)) ||
        (sId && sId === cleanIdNorm)
      );

      if (isMatch) {
        matchedRecords.push(record);
        filesToDelete.push(filePath);
        if (record.inventoryId) detectedInventoryId = record.inventoryId;
        if (record.fileName) detectedFileName = record.fileName;
        if (record.center) detectedCenter = record.center;
        if (sId) detectedSheetId = sId;
      }
    }

    // If matching inventoryId was detected, also locate any secondary snapshot files with the same inventoryId
    if (detectedInventoryId) {
      const normInv = String(detectedInventoryId).toLowerCase().trim();
      for (const f of historyFiles) {
        const filePath = path.join(historyDir, f);
        if (filesToDelete.includes(filePath)) continue;
        const record = storagePath.readJson(filePath, null);
        if (record && String(record.inventoryId || '').toLowerCase().trim() === normInv) {
          matchedRecords.push(record);
          filesToDelete.push(filePath);
          if (!detectedSheetId) detectedSheetId = extractSheetId(record.spreadsheetUrl || record.driveUrl);
        }
      }
    }

    // 2. Register in persistent tombstone blacklist so GAS / Drive sync never resurrects it
    const tombstones = this.getTombstones();
    const newTombstone = {
      id: cleanId,
      fileId: cleanId,
      inventoryId: detectedInventoryId || cleanId,
      fileName: detectedFileName || `${cleanId}.xlsx`,
      sheetId: detectedSheetId || extractSheetId(cleanId) || '',
      center: detectedCenter,
      deletedBy: user.username || 'Alonso',
      deletedByEmail: user.email || 'alonsospro@gmail.com',
      deletedAt: new Date().toISOString(),
      reason: reason || 'Eliminado formalmente desde el perfil de Alonso'
    };

    const filteredTombstones = tombstones.filter(t => {
      const tF = String(t.fileId || '').toLowerCase();
      const tI = String(t.inventoryId || '').toLowerCase();
      return tF !== cleanIdNorm && (!detectedInventoryId || tI !== String(detectedInventoryId).toLowerCase());
    });
    filteredTombstones.push(newTombstone);
    this.saveTombstones(filteredTombstones);

    // 3. Delete all matching snapshot files in data/history
    for (const fp of filesToDelete) {
      storagePath.deleteFile(fp);
    }
    const directPath = path.join(historyDir, `${cleanId}.json`);
    if (fs.existsSync(directPath)) {
      storagePath.deleteFile(directPath);
    }

    // 4. Note: Active inventories in data/inventories are preserved.
    // Deleting a snapshot only removes the historical file from the History list and marks its tombstone.

    // 5. Purge calculation data and audit logs for this inventory/snapshot
    if (detectedInventoryId || cleanIdNorm) {
      try {
        const auditDir = storagePath.getAuditDirectory();
        const globalAuditPath = path.join(auditDir, 'audit-consolidated.json');
        let globalLogs = storagePath.readJson(globalAuditPath, []);
        if (Array.isArray(globalLogs) && globalLogs.length > 0) {
          const normInv = detectedInventoryId ? String(detectedInventoryId).toLowerCase().trim() : '';
          const cleanedGlobal = globalLogs.filter(l => {
            const lInv = String(l.inventoryId || l.targetId || '').toLowerCase().trim();
            if (normInv && (lInv === normInv || lInv.includes(normInv))) return false;
            if (cleanIdNorm && (lInv === cleanIdNorm || lInv.includes(cleanIdNorm))) return false;
            return true;
          });
          storagePath.writeJson(globalAuditPath, cleanedGlobal);
        }

        // Clean center-specific audit files
        const auditFiles = storagePath.listFiles(auditDir).filter(f => f.startsWith('audit-') && f.endsWith('.json') && f !== 'audit-consolidated.json');
        for (const af of auditFiles) {
          const afPath = path.join(auditDir, af);
          let logs = storagePath.readJson(afPath, []);
          if (Array.isArray(logs) && logs.length > 0) {
            const normInv = detectedInventoryId ? String(detectedInventoryId).toLowerCase().trim() : '';
            const cleaned = logs.filter(l => {
              const lInv = String(l.inventoryId || l.targetId || '').toLowerCase().trim();
              if (normInv && (lInv === normInv || lInv.includes(normInv))) return false;
              if (cleanIdNorm && (lInv === cleanIdNorm || lInv.includes(cleanIdNorm))) return false;
              return true;
            });
            storagePath.writeJson(afPath, cleaned);
          }
        }
      } catch (auditErr) {
        console.warn('[snapshotService] Notice cleaning audit logs:', auditErr.message);
      }
    }

    // 6. Invalidate all metrics calculation caches so consolidated view is immediately clean
    const metricsService = require('./metricsService');
    if (metricsService && typeof metricsService.invalidateCache === 'function') {
      metricsService.invalidateCache();
    }
    if (metricsService && typeof metricsService.invalidateMetricsCache === 'function') {
      metricsService.invalidateMetricsCache();
    }

    // 7. Log snapshot deletion event in audit trail
    auditService.logAction({
      action: 'SNAPSHOT_DELETED',
      details: `Snapshot "${detectedFileName || cleanId}" (${detectedCenter}) eliminado por Alonso. Cálculos consolidados depurados.`,
      user: user.displayName || user.username || 'Alonso',
      center: detectedCenter,
      targetId: cleanId
    });

    console.log(`[snapshotService] ✅ Snapshot ${cleanId} ("${detectedFileName || cleanId}") eliminado por Alonso. Cálculos depurados.`);

    return {
      success: true,
      message: `Snapshot "${detectedFileName || cleanId}" eliminado con éxito. Los datos de cálculo fueron depurados y las métricas consolidadas se actualizaron.`,
      deletedSnapshot: {
        fileId: cleanId,
        fileName: detectedFileName || cleanId,
        inventoryId: detectedInventoryId,
        center: detectedCenter
      }
    };
  }
}

module.exports = new SnapshotService();
