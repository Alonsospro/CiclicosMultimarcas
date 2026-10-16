const fs = require('fs');
const path = require('path');
const storagePath = require('./storagePath');

class AuditService {
  constructor() {
    this.auditDir = storagePath.getAuditDirectory();
  }

  getAuditFilePath(center = 'GLOBAL') {
    const safeCenter = (center || 'GLOBAL').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 7); // YYYY-MM
    return path.join(this.auditDir, `audit-${safeCenter}-${dateStr}.json`);
  }

  _sanitizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const sanitized = { ...entry };
    if (typeof sanitized.details === 'string' && sanitized.details.length > 1000) {
      sanitized.details = sanitized.details.slice(0, 1000) + '... [truncado]';
    } else if (sanitized.details && typeof sanitized.details === 'object') {
      try {
        const str = JSON.stringify(sanitized.details);
        if (str.length > 1000) {
          sanitized.details = str.slice(0, 1000) + '... [truncado]';
        }
      } catch (_) {}
    }
    if (typeof sanitized.reason === 'string' && sanitized.reason.length > 500) {
      sanitized.reason = sanitized.reason.slice(0, 500) + '... [truncado]';
    }
    return sanitized;
  }

  _pruneLogs(logs, maxEntries = 600, maxBytes = 500000) {
    if (!Array.isArray(logs)) return [];
    if (logs.length > maxEntries) {
      logs.splice(0, logs.length - maxEntries);
    }
    while (logs.length > 20 && Buffer.byteLength(JSON.stringify(logs), 'utf8') > maxBytes) {
      const dropCount = Math.min(10, logs.length - 20);
      logs.splice(0, dropCount);
    }
    return logs;
  }

  appendLog(entry) {
    try {
      const cleanEntry = this._sanitizeEntry(entry);
      const logEntry = {
        id: 'LOG-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        timestamp: new Date().toISOString(),
        ...cleanEntry
      };

      const filePath = this.getAuditFilePath(cleanEntry.center || 'GLOBAL');
      let existing = storagePath.readJson(filePath, []);
      if (!Array.isArray(existing)) existing = [];
      existing.push(logEntry);
      this._pruneLogs(existing, 600, 500000);
      storagePath.writeJson(filePath, existing);

      // Also append to a consolidated global log
      const globalPath = path.join(this.auditDir, 'audit-consolidated.json');
      let globalExisting = storagePath.readJson(globalPath, []);
      if (!Array.isArray(globalExisting)) globalExisting = [];
      globalExisting.push(logEntry);
      this._pruneLogs(globalExisting, 600, 500000);
      storagePath.writeJson(globalPath, globalExisting);

      return logEntry;
    } catch (err) {
      console.error('[auditService] Error writing audit log:', err);
      return null;
    }
  }

  logCount({ inventoryId, sku, previousQty, newQty, user, center, reason, location, malEstado }) {
    const isReEdit = previousQty !== null && previousQty !== undefined;
    return this.appendLog({
      action: isReEdit ? 'COUNT_MODIFIED' : 'COUNT_REGISTERED',
      inventoryId,
      sku,
      previousQty: isReEdit ? previousQty : null,
      newQty,
      isReEdit,
      user: user || 'anonymous',
      center: center || 'GLOBAL',
      location: location || '',
      malEstado: malEstado || 0,
      reason: reason || (isReEdit ? 'Modificación de conteo ya realizado' : 'Conteo físico inicial')
    });
  }

  logUnlockRequest({ inventoryId, itemId, sku, user, center, location, previousQty, reason }) {
    return this.appendLog({
      action: 'COUNT_UNLOCK_REQUESTED',
      inventoryId,
      itemId,
      sku,
      previousQty: previousQty !== undefined ? previousQty : null,
      user: user || 'anonymous',
      center: center || 'GLOBAL',
      location: location || '',
      reason: reason || 'Solicitud de desbloqueo y modificación de conteo'
    });
  }

  logReassignment({ inventoryId, fromUser, toUser, adminUser, center, reason, affectedCount }) {
    return this.appendLog({
      action: 'ITEMS_REASSIGNED',
      inventoryId,
      fromUser,
      toUser,
      user: adminUser,
      center,
      affectedCount: affectedCount || 0,
      reason: reason || 'Reasignación de tareas'
    });
  }

  logJustification({ inventoryId, sku, justification, photoUrl, user, center, diffQty, diffCost }) {
    return this.appendLog({
      action: 'JUSTIFICATION_SUBMITTED',
      inventoryId,
      sku,
      justification,
      photoUrl: photoUrl || null,
      user,
      center,
      diffQty,
      diffCost
    });
  }

  logDeletion({ inventoryId, user, reason, center }) {
    return this.appendLog({
      action: 'INVENTORY_DELETED',
      inventoryId,
      user,
      center,
      reason: reason || 'Eliminado con clave de confirmación'
    });
  }

  logReopen({ inventoryId, user, reason, center }) {
    return this.appendLog({
      action: 'INVENTORY_REOPENED',
      inventoryId,
      user,
      center,
      reason: reason || 'Reapertura controlada por administrador'
    });
  }

  logAction({ action, details, user, center, targetId }) {
    return this.appendLog({
      action,
      details,
      user,
      center,
      targetId
    });
  }

  getAuditLogs({ inventoryId, center, startDate, endDate, limit = 200 }) {
    try {
      const globalPath = path.join(this.auditDir, 'audit-consolidated.json');
      let logs = storagePath.readJson(globalPath, []);

      if (center && center !== 'GLOBAL' && center !== 'TODOS' && center !== 'undefined' && center !== 'null') {
        logs = logs.filter(l => (l.center || '').toUpperCase() === center.toUpperCase());
      }

      if (inventoryId && inventoryId !== 'TODOS' && inventoryId !== 'undefined' && inventoryId !== 'null') {
        logs = logs.filter(l => l.inventoryId === inventoryId);
      }

      if (startDate && startDate !== 'undefined' && startDate !== 'null') {
        const dStart = new Date(startDate);
        if (!isNaN(dStart.getTime())) {
          logs = logs.filter(l => new Date(l.timestamp) >= dStart);
        }
      }

      if (endDate && endDate !== 'undefined' && endDate !== 'null') {
        const dEnd = new Date(endDate);
        if (!isNaN(dEnd.getTime())) {
          logs = logs.filter(l => new Date(l.timestamp) <= dEnd);
        }
      }

      return logs.slice(-limit).reverse();
    } catch (err) {
      console.error('[auditService] Error retrieving logs:', err);
      return [];
    }
  }

  pruneExistingAuditFiles() {
    try {
      const globalPath = path.join(this.auditDir, 'audit-consolidated.json');
      let globalLogs = storagePath.readJson(globalPath, []);
      if (Array.isArray(globalLogs) && (globalLogs.length > 600 || Buffer.byteLength(JSON.stringify(globalLogs), 'utf8') > 500000)) {
        this._pruneLogs(globalLogs, 600, 500000);
        storagePath.writeJson(globalPath, globalLogs);
      }
      if (fs.existsSync(this.auditDir)) {
        const files = fs.readdirSync(this.auditDir);
        for (const file of files) {
          if (!file.endsWith('.json') || file === 'audit-consolidated.json') continue;
          const filePath = path.join(this.auditDir, file);
          let logs = storagePath.readJson(filePath, []);
          if (Array.isArray(logs) && (logs.length > 600 || Buffer.byteLength(JSON.stringify(logs), 'utf8') > 500000)) {
            this._pruneLogs(logs, 600, 500000);
            storagePath.writeJson(filePath, logs);
          }
        }
      }
    } catch (err) {
      console.warn('[auditService] Notice during log maintenance:', err.message);
    }
  }
}

module.exports = new AuditService();
