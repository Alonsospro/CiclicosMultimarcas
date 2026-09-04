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

  appendLog(entry) {
    try {
      const logEntry = {
        id: 'LOG-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        timestamp: new Date().toISOString(),
        ...entry
      };

      const filePath = this.getAuditFilePath(entry.center || 'GLOBAL');
      const existing = storagePath.readJson(filePath, []);
      existing.push(logEntry);
      storagePath.writeJson(filePath, existing);

      // Also append to a consolidated global log
      const globalPath = path.join(this.auditDir, 'audit-consolidated.json');
      const globalExisting = storagePath.readJson(globalPath, []);
      globalExisting.push(logEntry);
      // Keep consolidated to last 5000 entries
      if (globalExisting.length > 5000) {
        globalExisting.splice(0, globalExisting.length - 5000);
      }
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
}

module.exports = new AuditService();
