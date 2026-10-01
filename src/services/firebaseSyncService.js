const path = require('path');
const fs = require('fs');

/**
 * Service for local store hydration and data synchronization.
 * Direct Mode: Operates directly with Google Apps Script / Google Drive and local persistent storage.
 * Firestore cloud mirroring is fully deactivated to avoid quota exhaustion and stream timeouts.
 */
class FirebaseSyncService {
  constructor() {
    this.enabled = false; // Direct Apps Script + Local Disk mode
  }

  // Extract canonical relative path, removing any container prefix (/app/applet/data/ or /workspace/data/)
  _getCanonicalRelPath(rawPath) {
    if (!rawPath) return '';
    let p = String(rawPath).replace(/\\/g, '/');
    const dataIdx = p.indexOf('/data/');
    if (dataIdx !== -1) {
      p = p.substring(dataIdx + 6);
    }
    return p.replace(/^[\\\/]+/, '');
  }

  _hydrateFromLocalStorage(memoryStore, cacheTimestamps, dirListings, storagePathInstance) {
    if (!storagePathInstance || !storagePathInstance.baseDir) return;
    try {
      const baseDir = storagePathInstance.baseDir;
      if (!fs.existsSync(baseDir)) return;

      const subdirs = ['inventories', 'justifications', 'history', 'trash', 'audit'];
      let localFilesCount = 0;
      for (const sub of subdirs) {
        const fullDir = path.join(baseDir, sub);
        if (fs.existsSync(fullDir)) {
          const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.json'));
          const dirKey = storagePathInstance.normalizeKey(fullDir);
          if (dirListings && !dirListings.has(dirKey)) {
            dirListings.set(dirKey, new Set());
          }
          for (const f of files) {
            const filePath = path.join(fullDir, f);
            const key = storagePathInstance.normalizeKey(filePath);
            if (!memoryStore.has(key)) {
              try {
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                memoryStore.set(key, parsed);
                if (cacheTimestamps) cacheTimestamps.set(key, Date.now());
                localFilesCount++;
              } catch (_) {}
            }
            if (dirListings && dirListings.has(dirKey)) {
              dirListings.get(dirKey).add(f);
            }
          }
        }
      }

      // Also ensure users.json is loaded
      const usersPath = storagePathInstance.getUsersFilePath();
      if (usersPath && fs.existsSync(usersPath)) {
        const key = storagePathInstance.normalizeKey(usersPath);
        if (!memoryStore.has(key)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
            memoryStore.set(key, parsed);
            if (cacheTimestamps) cacheTimestamps.set(key, Date.now());
            localFilesCount++;
          } catch (_) {}
        }
      }
      console.log(`[syncService] Memoria local inicializada (${localFilesCount} archivos cargados en caché).`);
    } catch (e) {
      console.warn('[syncService] Aviso en hidratación local:', e.message);
    }
  }

  async hydrateMemoryStore(memoryStore, cacheTimestamps, dirListings, storagePathInstance = null) {
    // Direct mode: hydrate instantly from local persistent disk storage
    this._hydrateFromLocalStorage(memoryStore, cacheTimestamps, dirListings, storagePathInstance);
    return Promise.resolve();
  }

  async syncToFirestore(normalizedKey, dirKey, fileName, dataObj) {
    // Direct Apps Script mode: local files are saved to disk and synced to Google Apps Script / Drive directly
    return Promise.resolve();
  }

  async deleteFromFirestore(normalizedKey, fallbackKey = null) {
    // Direct Apps Script mode: no cloud Firestore operations needed
    return Promise.resolve();
  }

  async clearAllInFirestore(keepUsers = true) {
    // Direct Apps Script mode: no cloud Firestore operations needed
    return Promise.resolve();
  }
}

module.exports = new FirebaseSyncService();
