const path = require('path');
const fs = require('fs');
const storagePath = require('./storagePath');
const gasService = require('./gasService');
const auditService = require('./auditService');
const config = require('../config');

class DailyBackupService {
  constructor() {
    this.backupDir = path.join(storagePath.getDataDirectory(), 'backups', 'daily');
    this.intervalId = null;
    this.ensureDirs();
  }

  ensureDirs() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
    } catch (_) {}
  }

  /**
   * Ejecuta el respaldo completo de inventarios activos y finalizados a Google Sheets y almacenamiento local
   */
  async runDailyBackup({ triggeredBy = 'CRON_AUTO', user = null } = {}) {
    this.ensureDirs();
    const invDir = storagePath.getInventoriesDirectory();
    const files = storagePath.listFiles(invDir).filter(f => f.endsWith('.json') && !f.startsWith('REC-'));

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const timestampStr = `${dateStr}_${timeStr}`;

    const results = [];
    console.log(`[dailyBackupService] Iniciando respaldo diario de inventarios (Trigger: ${triggeredBy})...`);

    const backupPromises = files.map(async (f) => {
      try {
        const inv = storagePath.readJson(path.join(invDir, f), null);
        if (!inv || !inv.id || !inv.center) return null;
        if (!Array.isArray(inv.items) || inv.items.length === 0) return null;

        // 1. Guardar copia local en data/backups/daily/
        const localBackupPath = path.join(this.backupDir, `BACKUP_${inv.id}_${timestampStr}.json`);
        storagePath.writeJson(localBackupPath, {
          backupTimestamp: now.toISOString(),
          triggeredBy,
          inventory: inv
        });

        // 2. Exportar respaldo a Google Sheets / Google Drive
        let gasSuccess = false;
        let driveUrl = null;
        try {
          const gasPayload = {
            center: inv.center,
            type: inv.type || 'CICLICO',
            inventoryId: inv.id,
            isReconteo: !!(inv.isReconteo || inv.phase === 'RECONTEO'),
            reviewNotes: `Respaldo diario automático (${dateStr}) - ${inv.name} - Trigger: ${triggeredBy}`,
            driveRecord: {
              center: inv.center,
              type: inv.type || 'CICLICO',
              inventoryName: inv.name,
              inventoryId: inv.id,
              status: inv.status,
              createdAt: inv.createdAt,
              backupAt: now.toISOString(),
              items: inv.items
            },
            items: inv.items
          };

          const gasRes = await gasService.syncFinalInventoryToGAS(inv.type || 'CICLICO', gasPayload);
          gasSuccess = !!(gasRes && (gasRes.success || gasRes.fileUrl || gasRes.url));
          driveUrl = (gasRes && (gasRes.fileUrl || gasRes.url)) || null;
        } catch (gasErr) {
          console.warn(`[dailyBackupService] Advertencia al sincronizar respaldo de ${inv.id} con GAS:`, gasErr.message);
        }

        return {
          inventoryId: inv.id,
          center: inv.center,
          totalItems: inv.items.length,
          countedItems: inv.items.filter(it => it.Stock_Fisico !== null && it.Stock_Fisico !== undefined).length,
          localBackup: localBackupPath,
          gasSuccess,
          driveUrl
        };
      } catch (err) {
        console.error(`[dailyBackupService] Error respaldando ${f}:`, err.message);
        return { file: f, error: err.message, success: false };
      }
    });

    const settled = await Promise.allSettled(backupPromises);
    settled.forEach(s => {
      if (s.status === 'fulfilled' && s.value) {
        results.push(s.value);
      }
    });

    // Registrar en auditoría
    auditService.logAction({
      action: 'DAILY_BACKUP_EXECUTED',
      details: `Respaldo diario completado para ${results.length} inventarios activos. Trigger: ${triggeredBy}`,
      user: user ? user.username : 'SYSTEM_SCHEDULER',
      center: 'GLOBAL',
      targetId: `BACKUP_${timestampStr}`
    });

    console.log(`[dailyBackupService] Respaldo diario completado exitosamente: ${results.length} inventarios respaldados.`);

    return {
      success: true,
      timestamp: now.toISOString(),
      date: dateStr,
      triggeredBy,
      totalInventoriesBackedUp: results.length,
      details: results
    };
  }

  /**
   * Inicia el temporizador de respaldo recurrente (cada 24 horas a las 23:30)
   */
  startScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    // Ejecutar cada 12 horas para máxima seguridad
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.runDailyBackup({ triggeredBy: 'SCHEDULED_TIMER' }).catch(err => {
        console.error('[dailyBackupService] Error en respaldo programado:', err.message);
      });
    }, TWELVE_HOURS);

    console.log('[dailyBackupService] Planificador de respaldo automático activo (cada 12h).');
  }

  stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

module.exports = new DailyBackupService();
