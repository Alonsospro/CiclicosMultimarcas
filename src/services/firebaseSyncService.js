const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, query, where, writeBatch } = require('firebase/firestore');
const config = require('../../firebase-applet-config.json');

const app = initializeApp(config);
const db = getFirestore(app);
const SECRET = 'NIBOL_BACKEND_SECRET_987654321';

class FirebaseSyncService {
  constructor() {
    this.collectionName = 'app_files';
    this.quotaExhaustedUntil = null;
    this.debounceTimers = new Map();
  }

  // Hash/encode the path to create a safe Firestore document ID
  _getSafeId(filePath) {
    if (!filePath) return '';
    return Buffer.from(String(filePath).trim()).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

  async hydrateMemoryStore(memoryStore, cacheTimestamps, dirListings, storagePathInstance = null) {
    try {
      console.log('[firebaseSync] Loading persistent data from Firestore...');
      const q = query(collection(db, this.collectionName), where('secret', '==', SECRET));
      const querySnapshot = await getDocs(q);
      
      let loadedCount = 0;
      querySnapshot.forEach((document) => {
        const data = document.data();
        if (data && data.path && data.content) {
          try {
            const parsed = JSON.parse(data.content);
            const rawPath = data.path;
            const relPath = this._getCanonicalRelPath(rawPath);
            
            // If storagePath instance provided, resolve to active baseDir
            let activeFullPath = rawPath;
            let activeDir = data.dir;
            if (storagePathInstance && typeof storagePathInstance.resolveFilePath === 'function') {
              activeFullPath = storagePathInstance.resolveFilePath(relPath);
              activeDir = path.dirname(activeFullPath);
            }

            const key = storagePathInstance ? storagePathInstance.normalizeKey(activeFullPath) : activeFullPath;
            const dirKey = storagePathInstance ? storagePathInstance.normalizeKey(activeDir) : activeDir;

            // Preserve disk file if it already exists and has newer or more complete data
            let effectiveObj = parsed;
            if (activeFullPath && fs.existsSync(activeFullPath)) {
              try {
                const stat = fs.statSync(activeFullPath);
                const diskContent = fs.readFileSync(activeFullPath, 'utf8');
                const diskParsed = JSON.parse(diskContent);

                const countCounted = (obj) => {
                  if (!obj || !Array.isArray(obj.items)) return 0;
                  return obj.items.filter(i => (i.Stock_Fisico !== null && i.Stock_Fisico !== undefined && i.Stock_Fisico !== '') || !!i.Fecha_Ultimo_Conteo || i.Estado === 'Contado' || i.counted).length;
                };

                const countJustified = (obj) => {
                  if (!obj || !Array.isArray(obj.items)) return 0;
                  return obj.items.filter(i => !!i.Comentario_Justificacion || !!i.justification || !!i.Razon || i.corroboracion === 'CUADRA' || i.isCuadra === true).length;
                };

                const isInv = diskParsed && Array.isArray(diskParsed.items);
                if (isInv) {
                  const diskCounted = countCounted(diskParsed);
                  const firestoreCounted = countCounted(parsed);
                  const diskJust = countJustified(diskParsed);
                  const firestoreJust = countJustified(parsed);

                  // Priority 1: Greater or equal counted items and more justifications
                  if (diskCounted > firestoreCounted || diskJust > firestoreJust) {
                    effectiveObj = diskParsed;
                  } else if (diskCounted === firestoreCounted && (diskParsed.status === 'REVISADO' || diskParsed.status === 'PENDIENTE_JUSTIFICACION') && parsed.status === 'EN_PROGRESO') {
                    effectiveObj = diskParsed;
                  } else if (diskCounted >= firestoreCounted && stat.mtimeMs > (data.updatedAt || 0)) {
                    effectiveObj = diskParsed;
                  } else if (diskParsed.items.length > 0 && (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0)) {
                    effectiveObj = diskParsed;
                  }
                } else if (activeFullPath.includes('justifications')) {
                  // For individual justifications, prefer disk if it has justification content
                  if (diskParsed && (diskParsed.justification || diskParsed.comentario || diskParsed.driveUrl || diskParsed.photoUrl)) {
                    effectiveObj = diskParsed;
                  }
                } else {
                  // General files: if disk file is newer than Firestore updatedAt, keep disk
                  if (stat.mtimeMs > (data.updatedAt || 0)) {
                    effectiveObj = diskParsed;
                  }
                }
              } catch (_) {}
            }

            memoryStore.set(key, effectiveObj);
            if (cacheTimestamps) {
              cacheTimestamps.set(key, Date.now());
            }

            // Only mirror to disk if effectiveObj is what we got or if file didn't exist
            try {
              if (activeDir && !fs.existsSync(activeDir)) {
                fs.mkdirSync(activeDir, { recursive: true });
              }
              if (activeFullPath && typeof activeFullPath === 'string' && effectiveObj === parsed) {
                fs.writeFileSync(activeFullPath, JSON.stringify(parsed, null, 2), 'utf8');
              }
            } catch (_) {}
            
            if (dirListings) {
              if (!dirListings.has(dirKey)) {
                dirListings.set(dirKey, new Set());
              }
              
              const set = dirListings.get(dirKey);
              const targetLower = String(data.fileName || path.basename(relPath)).toLowerCase();
              for (const item of set) {
                if (item.toLowerCase() === targetLower) {
                  set.delete(item);
                }
              }
              set.add(data.fileName || path.basename(relPath));
            }
            loadedCount++;
          } catch (e) {
            console.error(`[firebaseSync] Failed to parse content for ${data.path}`, e);
          }
        }
      });
      console.log(`[firebaseSync] Successfully loaded ${loadedCount} files from Firestore.`);
    } catch (err) {
      console.error('[firebaseSync] Error hydrating from Firestore:', err);
    }
  }

  async syncToFirestore(normalizedKey, dirKey, fileName, dataObj, immediate = false) {
    if (this.quotaExhaustedUntil && Date.now() < this.quotaExhaustedUntil) {
      return;
    }
    const relPath = this._getCanonicalRelPath(normalizedKey);
    // Ignore internal backups or temporary write probes from flooding Firestore
    if (!relPath || relPath.startsWith('backups/') || relPath.includes('.test_write_')) {
      return;
    }
    const docId = this._getSafeId(relPath);
    if (!docId) return;

    const performSync = async () => {
      try {
        const relDir = path.dirname(relPath).replace(/\\/g, '/');
        const docRef = doc(db, this.collectionName, docId);
        const payload = {
          path: relPath,
          dir: relDir,
          fileName: fileName || path.basename(relPath),
          content: JSON.stringify(dataObj),
          secret: SECRET,
          updatedAt: Date.now()
        };
        await setDoc(docRef, payload, { merge: true });
      } catch (err) {
        if (err.message && (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('quota') || err.message.includes('Quota'))) {
          this.quotaExhaustedUntil = Date.now() + (30 * 60 * 1000);
          console.warn(`[firebaseSync] Cuota de base de datos alcanzada. Operando en almacenamiento local seguro hasta que se actualice la cuota de la base de datos.`);
        } else {
          console.error(`[firebaseSync] Error syncing ${fileName} to Firestore:`, err.message);
        }
      } finally {
        this.debounceTimers.delete(docId);
      }
    };

    if (immediate) {
      if (this.debounceTimers.has(docId)) {
        clearTimeout(this.debounceTimers.get(docId));
        this.debounceTimers.delete(docId);
      }
      return performSync();
    }

    // Debounce rapid continuous saves for the same file by 350ms
    if (this.debounceTimers.has(docId)) {
      clearTimeout(this.debounceTimers.get(docId));
    }
    this.debounceTimers.set(docId, setTimeout(performSync, 350));
  }

  async syncAllDiskFilesToFirestore(storagePathInstance) {
    if (!storagePathInstance) return 0;
    if (this.quotaExhaustedUntil && Date.now() < this.quotaExhaustedUntil) {
      return 0;
    }
    try {
      console.log('[firebaseSync] Asegurando persistencia en la nube de archivos locales en Firestore...');
      const targetDirs = [
        storagePathInstance.getInventoriesDirectory(),
        storagePathInstance.getJustificationsDirectory(),
        storagePathInstance.getHistoryDirectory(),
        storagePathInstance.getAuditDirectory()
      ];

      let syncedCount = 0;
      // 1. users.json
      const usersPath = storagePathInstance.getUsersFilePath();
      if (fs.existsSync(usersPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
          await this.syncToFirestore('users.json', '.', 'users.json', content, true);
          syncedCount++;
        } catch (_) {}
      }

      // 2. Directorios clave (inventories, justifications, history, audit)
      for (const dir of targetDirs) {
        if (!fs.existsSync(dir)) continue;
        const files = storagePathInstance.listFiles(dir);
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          const fullPath = path.join(dir, f);
          try {
            const dataObj = storagePathInstance.readJson(fullPath);
            if (dataObj) {
              const relPath = storagePathInstance.getRelativePath(fullPath);
              const relDir = path.dirname(relPath).replace(/\\/g, '/');
              await this.syncToFirestore(relPath, relDir, f, dataObj, true);
              syncedCount++;
            }
          } catch (_) {}
        }
      }
      console.log(`[firebaseSync] Sincronización completa: ${syncedCount} archivos asegurados en Firestore.`);
      return syncedCount;
    } catch (err) {
      console.error('[firebaseSync] Error sincronizando archivos locales a Firestore:', err.message);
      return 0;
    }
  }

  async deleteFromFirestore(normalizedKey, fallbackKey = null) {
    if (this.quotaExhaustedUntil && Date.now() < this.quotaExhaustedUntil) {
      return;
    }
    try {
      const candidates = new Set();
      if (normalizedKey) {
        const rel = this._getCanonicalRelPath(normalizedKey);
        candidates.add(this._getSafeId(rel));
        candidates.add(this._getSafeId(normalizedKey));
        candidates.add(this._getSafeId('/workspace/data/' + rel));
        candidates.add(this._getSafeId('/app/applet/data/' + rel));
      }
      if (fallbackKey) {
        const rel2 = this._getCanonicalRelPath(fallbackKey);
        candidates.add(this._getSafeId(rel2));
        candidates.add(this._getSafeId(fallbackKey));
        candidates.add(this._getSafeId('/workspace/data/' + rel2));
        candidates.add(this._getSafeId('/app/applet/data/' + rel2));
      }

      for (const docId of candidates) {
        try {
          await deleteDoc(doc(db, this.collectionName, docId));
        } catch (_) {}
      }
    } catch (err) {
      if (err.message && (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('quota') || err.message.includes('Quota'))) {
        this.quotaExhaustedUntil = Date.now() + (30 * 60 * 1000);
      } else {
        console.error(`[firebaseSync] Error deleting ${normalizedKey} from Firestore:`, err.message);
      }
    }
  }

  async clearAllInFirestore(keepUsers = true) {
    try {
      this.debounceTimers.forEach(t => clearTimeout(t));
      this.debounceTimers.clear();
      console.log('[firebaseSync] Clearing test data in Firestore (keepUsers=' + keepUsers + ')...');
      const q = query(collection(db, this.collectionName), where('secret', '==', SECRET));
      const snapshot = await getDocs(q);
      
      const chunks = [];
      let currentBatch = writeBatch(db);
      let count = 0;
      
      snapshot.forEach((document) => {
        const data = document.data();
        const fName = (data && data.fileName) ? String(data.fileName).toLowerCase() : '';
        const p = (data && data.path) ? String(data.path).toLowerCase() : '';
        if (keepUsers && (fName === 'users.json' || p.endsWith('users.json') || p === 'users.json')) {
          return; // preserve users.json
        }
        currentBatch.delete(document.ref);
        count++;
        if (count === 500) {
          chunks.push(currentBatch);
          currentBatch = writeBatch(db);
          count = 0;
        }
      });
      
      if (count > 0) {
        chunks.push(currentBatch);
      }
      
      for (const batch of chunks) {
        await batch.commit();
      }
      console.log('[firebaseSync] Cleared Firestore test data successfully.');
    } catch (err) {
      if (err.message && (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('quota') || err.message.includes('Quota'))) {
        this.quotaExhaustedUntil = Date.now() + (30 * 60 * 1000);
      }
      console.warn('[firebaseSync] Notice clearing Firestore data:', err.message);
    }
  }
}

module.exports = new FirebaseSyncService();
