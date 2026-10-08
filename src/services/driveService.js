const fs = require('fs');
const path = require('path');
const config = require('../config');
const storagePath = require('./storagePath');
const gasService = require('./gasService');

class DriveService {
  constructor() {
    this.historyDir = storagePath.getHistoryDirectory();
    this.photosDir = storagePath.getPhotosDirectory();
    this.photoMemoryCache = new Map();
    this.MAX_CACHE_ENTRIES = 50;
    this.MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100MB
  }

  /**
   * Evict oldest entries when cache exceeds limits (LRU by savedAt).
   */
  pruneCache() {
    // Check entry count
    if (this.photoMemoryCache.size <= this.MAX_CACHE_ENTRIES) {
      // Also check total bytes
      let totalBytes = 0;
      for (const entry of this.photoMemoryCache.values()) {
        totalBytes += (entry.buffer ? entry.buffer.length : 0);
      }
      if (totalBytes <= this.MAX_CACHE_BYTES) return;
    }

    // Sort entries by savedAt ascending (oldest first)
    const entries = Array.from(this.photoMemoryCache.entries())
      .sort((a, b) => (a[1].savedAt || 0) - (b[1].savedAt || 0));

    let totalBytes = 0;
    for (const entry of this.photoMemoryCache.values()) {
      totalBytes += (entry.buffer ? entry.buffer.length : 0);
    }

    // Remove oldest entries until within limits
    for (const [key, entry] of entries) {
      if (this.photoMemoryCache.size <= this.MAX_CACHE_ENTRIES && totalBytes <= this.MAX_CACHE_BYTES) {
        break;
      }
      totalBytes -= (entry.buffer ? entry.buffer.length : 0);
      this.photoMemoryCache.delete(key);
    }
  }

  formatInventoryFileName(type, center, date = new Date()) {
    const cleanType = (type || 'CICLICO').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let target = String(center || 'WARNES').trim();
    if (target.toUpperCase() !== 'WARNES') {
      const code = config.getCenterCode ? config.getCenterCode(target) : target;
      if (code) target = code;
    }
    const cleanCenter = target.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let dateStr = '';
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dateStr = date;
    } else {
      const d = new Date(date);
      dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return `${cleanType}-${cleanCenter}-${dateStr}`;
  }

  formatJustificationName(type, sku, center, warehouse) {
    const cleanType = (type || 'CICLICO').toUpperCase();
    const cleanSku = (sku || 'SKU').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const cleanCenter = (center || 'WARNES').toUpperCase();
    const cleanWarehouse = warehouse ? `-${String(warehouse).toUpperCase().replace(/[^A-Z0-9_-]/g, '_')}` : '';
    return `JUST-${cleanType}-${cleanSku}-${cleanCenter}${cleanWarehouse}`;
  }

  getDriveFolderPath(type, center) {
    const cleanType = (type || 'CICLICO').toUpperCase();
    const cleanCenter = (center || 'WARNES').toUpperCase();
    return `${config.drive.baseFolder}/${cleanType}/${cleanCenter}`;
  }

  formatDate(date) {
    if (!date) {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  getCenterName(center) {
    if (!center) return 'Volvo - Km 14';
    const found = config.findCenter(center);
    if (found && found.name) return found.name;
    return String(center).trim();
  }

  sanitizeFilename(name) {
    if (!name) return 'ITEM';
    return String(name).trim().replace(/[/\\?%*:|"<>]/g, '_');
  }

  /**
   * Generates exact Google Drive path and filename:
   * Mal Estado: nibol/ciclicos/fotos/malestado/{fecha}/{centro y tipo de inventario}/{sku}.jpg
   * Justificaciones: nibol/ciclicos/fotos/justificaciones/{fecha}/{centro y tipo de inventario}/{sku}.jpg
   */
  getPhotoDriveDetails({ category = 'malestado', sku = 'SKU', center = '1120', date = new Date(), ext = '.jpg', type = 'CICLICO', isJustification2 = false, prefix = '' }) {
    const cleanCategory = String(category).toLowerCase().includes('just') ? 'justificaciones' : 'malestado';
    const dateStr = this.formatDate(date);
    const centerName = this.getCenterName(center);
    const cleanSku = this.sanitizeFilename(sku);
    const fileExt = ext.startsWith('.') ? ext : `.${ext}`;

    const isSecondJust = isJustification2 === true || isJustification2 === 'true' || prefix === 'JS2' || String(prefix || '').toUpperCase() === 'JS2';
    let filePrefix = '';
    if (isSecondJust) {
      filePrefix = 'JS2_';
    } else if (prefix && String(prefix).trim()) {
      const p = String(prefix).trim().replace(/[_\-]+$/, '');
      filePrefix = `${p}_`;
    }

    // Evitar duplicar el prefijo si cleanSku ya lo contiene
    let finalSku = cleanSku;
    if (filePrefix && finalSku.toUpperCase().startsWith(filePrefix.toUpperCase())) {
      filePrefix = '';
    }

    const fileName = `${filePrefix}${finalSku}${fileExt}`;
    const cleanType = String(type || 'CICLICO').toUpperCase().trim();
    const centerTypeFolder = `${centerName} ${cleanType}`;

    const folderPath = `nibol/ciclicos/fotos/${cleanCategory}/${dateStr}/${centerTypeFolder}`;
    const logicalPath = `${folderPath}/${fileName}`;

    return {
      category: cleanCategory,
      date: dateStr,
      centerName,
      type: cleanType,
      centerTypeFolder,
      cleanSku,
      fileName,
      folderPath,
      logicalPath,
      filePrefix,
      isJustification2: isSecondJust
    };
  }

  getPhotoAsDataUri(identifier) {
    if (!identifier) return null;
    const str = String(identifier).trim();
    if (str.startsWith('data:image')) return str;
    // CRITICAL: Never return HTTP/HTTPS URLs as Data URI. Passing URLs causes GAS to fetch HTML preview and overwrite images as .doc
    if (str.startsWith('http://') || str.startsWith('https://')) return null;
    const safeName = path.basename(str);

    // 1. Check memory cache
    if (this.photoMemoryCache.has(safeName)) {
      const entry = this.photoMemoryCache.get(safeName);
      if (entry && entry.buffer) {
        return `data:${entry.mimeType || 'image/jpeg'};base64,${entry.buffer.toString('base64')}`;
      }
    }

    // 2. Check disk storage
    const fullPath = path.join(this.photosDir, safeName);
    try {
      if (fs.existsSync(fullPath)) {
        const buf = fs.readFileSync(fullPath);
        const ext = path.extname(safeName).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        if (ext === '.webp') mimeType = 'image/webp';
        if (ext === '.gif') mimeType = 'image/gif';
        return `data:${mimeType};base64,${buf.toString('base64')}`;
      }
    } catch (e) {}

    return null;
  }

  async createFinalDriveFile({ inventory, justifications, user, reviewNotes }) {
    const { id, type, center, items } = inventory;
    const fileName = this.formatInventoryFileName(type, center, new Date());
    const folderPath = this.getDriveFolderPath(type, center);

    const fileId = `DRIVE-FILE-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const isReconteo = !!(inventory.isReconteo || inventory.phase === 'RECONTEO' || String(inventory.id || '').startsWith('REC-') || inventory.hasRecount);

    const driveRecord = {
      fileId,
      fileName: `${fileName}.xlsx`,
      logicalPath: `${folderPath}/${fileName}.xlsx`,
      inventoryId: id,
      type,
      center,
      isReconteo,
      closedBy: user.username,
      closedAt: new Date().toISOString(),
      reviewNotes: reviewNotes || 'Revisión finalizada y aprobada por administrador',
      totalItems: items.length,
      justificationsCount: (justifications || []).length,
      items: items.map(item => {
        const matchingJust = (justifications || []).find(j => (j.sku || j.SKU) === item.SKU);
        const razon = item.Razon || item.Razon_Justificacion || (matchingJust ? (matchingJust.reasonType || matchingJust.razon) : '');
        const comentarioJust = item.Comentario_Justificacion || (matchingJust ? (matchingJust.justification || matchingJust.comentario) : '');

        // In reconteo, or if not a valid data:image, NEVER send photoBase64 to prevent overwriting images with .doc
        const rawPhoto = isReconteo ? null : this.getPhotoAsDataUri(item.foto_mal_estado);
        const photoData = (rawPhoto && String(rawPhoto).startsWith('data:image/')) ? rawPhoto : '';

        return {
          SKU: item.SKU,
          Codigo_Barras: item.Codigo_Barras,
          Descripcion: item.Descripcion,
          Ubicacion: item.Ubicacion,
          Categoria: item.Categoria,
          Clasificacion_ABC: item.Clasificacion_ABC,
          Unidad: item.Unidad,
          Costo_Unitario: item.Costo_Unitario,
          Stock_Sistema: item.Stock_Sistema,
          Stock_Fisico: item.Stock_Fisico,
          Diferencia: (item.Stock_Fisico !== null ? item.Stock_Fisico : 0) - item.Stock_Sistema,
          Costo_Diferencia: ((item.Stock_Fisico !== null ? item.Stock_Fisico : 0) - item.Stock_Sistema) * (item.Costo_Unitario || 0),
          Fecha_Ultimo_Conteo: item.Fecha_Ultimo_Conteo,
          Responsable: item.Responsable,
          Estado: item.Estado || 'Revisado',
          Mal_estado: item.Mal_estado || 0,
          Comentario: item.Comentario || '',
          Razon: razon || '',
          Razon_Justificacion: razon || '',
          Comentario_Justificacion: comentarioJust || '',
          Reconteo_Fisico: item.Reconteo_Fisico !== undefined ? item.Reconteo_Fisico : null,
          Reconteo_Mal_Estado: item.Reconteo_Mal_Estado !== undefined ? item.Reconteo_Mal_Estado : 0,
          Diferencia_Final: (item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== '')
            ? (Number(item.Reconteo_Fisico) - Number(item.Stock_Sistema || 0))
            : ((item.Stock_Fisico !== null ? Number(item.Stock_Fisico) : 0) - Number(item.Stock_Sistema || 0)),
          Costo_Diferencia_Final: (item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== '')
            ? ((Number(item.Reconteo_Fisico) - Number(item.Stock_Sistema || 0)) * (Number(item.Costo_Unitario) || 0))
            : (((item.Stock_Fisico !== null ? Number(item.Stock_Fisico) : 0) - Number(item.Stock_Sistema || 0)) * (Number(item.Costo_Unitario) || 0)),
          photoBase64: photoData
        };
      }),
      justifications: isReconteo ? [] : (justifications || []).map(j => {
        const rawPhoto = this.getPhotoAsDataUri(j.photoUrl);
        const photoData = (rawPhoto && String(rawPhoto).startsWith('data:image/')) ? rawPhoto : '';
        return {
          sku: j.sku || j.SKU || '',
          justification: j.justification || '',
          reasonType: j.reasonType || '',
          photoBase64: photoData
        };
      })
    };

    // Call GAS Webhook and capture real Drive URL if returned
    let realDriveUrl = null;
    let spreadsheetUrl = null;
    try {
      const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
      const gasResult = await gasService.syncFinalInventoryToGAS(type, {
        fileId,
        fileName: `${fileName}.xlsx`,
        folderPath,
        center: cleanCenter,
        isReconteo,
        items,
        driveRecord,
        reviewNotes: reviewNotes || 'Revisión finalizada'
      });
      // Extract real Drive URLs from GAS response
      if (gasResult) {
        if (gasResult.spreadsheetUrl && typeof gasResult.spreadsheetUrl === 'string') {
          spreadsheetUrl = gasResult.spreadsheetUrl;
        }
        const candidateUrl = gasResult.driveUrl || gasResult.url || gasResult.folderUrl || gasResult.spreadsheetUrl || null;
        if (candidateUrl && typeof candidateUrl === 'string' && candidateUrl.includes('google.com')) {
          realDriveUrl = candidateUrl;
        }
      }
    } catch (err) {
      console.warn('[driveService] GAS remote sync fallback:', err.message);
    }

    // Fallback: use the configured Drive snapshots folder
    const fallbackDriveUrl = config.driveSnapshotsFolderUrl || config.driveReferenceFolderUrl || null;
    const driveUrl = realDriveUrl || fallbackDriveUrl;

    // Save real Drive URLs in history record
    driveRecord.driveUrl = driveUrl;
    driveRecord.spreadsheetUrl = spreadsheetUrl;

    // Save final file record to history directory
    const historyFilePath = path.join(this.historyDir, `${fileId}.json`);
    storagePath.writeJson(historyFilePath, driveRecord);

    try {
      const metricsService = require('./metricsService');
      if (metricsService && typeof metricsService.invalidateCache === 'function') {
        metricsService.invalidateCache();
      }
    } catch (cacheErr) {
      // ignore circular reference or cache err
    }

    return {
      success: true,
      fileId,
      fileName: `${fileName}.xlsx`,
      folderPath,
      driveUrl,
      spreadsheetUrl,
      historyFilePath
    };
  }

  async savePhotoFile(fileBuffer, originalName = 'photo.jpg', mimeType = 'image/jpeg', metadata = {}) {
    const ext = path.extname(originalName) || (mimeType === 'image/png' ? '.png' : '.jpg');
    
    // Determine category: 'malestado' or 'justificaciones'
    let category = metadata.category || metadata.photoType || 'malestado';
    if (String(category).toLowerCase().includes('just')) {
      category = 'justificaciones';
    } else {
      category = 'malestado';
    }

    let sku = metadata.sku || '';
    let center = metadata.center || '';
    let date = metadata.date || new Date();

    // If inventoryId provided and center/date/sku missing, look up inventory
    if (metadata.inventoryId && (!sku || !center)) {
      try {
        const inventoryService = require('./inventoryService');
        const inv = inventoryService.getInventoryRaw(metadata.inventoryId);
        if (inv) {
          if (!center) center = inv.center;
          if (!metadata.date && inv.createdAt) date = inv.createdAt;
          if (metadata.itemId && !sku) {
            const item = inv.items?.find(it => it.id === metadata.itemId);
            if (item) sku = item.SKU;
          }
        }
      } catch (e) {
        // ignore lookup fallback
      }
    }

    if (!sku) sku = 'SKU_' + Date.now().toString(36);
    if (!center) center = '1120';
    const invType = metadata.type || (metadata.inventoryId && String(metadata.inventoryId).includes('BARRIDO') ? 'BARRIDO' : 'CICLICO');

    const isJustification2 = metadata.isJustification2 === true ||
      metadata.isJustification2 === 'true' ||
      metadata.round === 2 ||
      metadata.round === '2' ||
      metadata.prefix === 'JS2' ||
      String(metadata.prefix || '').toUpperCase() === 'JS2';

    const prefix = metadata.prefix || (isJustification2 ? 'JS2' : '');

    const details = this.getPhotoDriveDetails({
      category,
      sku,
      center,
      date,
      ext,
      type: invType,
      isJustification2,
      prefix
    });

    // 1. Generate unique photo ID for URL mapping & backward compatibility
    const photoId = `PHOTO-${Date.now()}-${Math.random().toString(36).substring(2, 7)}${ext}`;
    const legacyPath = path.join(this.photosDir, photoId);

    // Cache photo in memory for instant online retrieval (especially on Vercel)
    this.photoMemoryCache.set(photoId, {
      buffer: fileBuffer,
      mimeType: mimeType || 'image/jpeg',
      details,
      savedAt: Date.now()
    });
    this.pruneCache();

    // 2. Primary cloud storage: Sync immediately to Google Drive via Google Apps Script
    let gasResult = null;
    try {
      gasResult = await gasService.syncPhotoToGAS({
        category: details.category,
        date: details.date,
        center: details.centerName,
        type: invType,
        sku: details.cleanSku,
        fileName: details.fileName,
        folderPath: details.folderPath,
        fileBuffer,
        mimeType,
        inventoryId: metadata.inventoryId || null,
        isJustification2,
        prefix
      });
    } catch (err) {
      console.warn('[driveService] Notice during GAS photo sync:', err.message);
    }

    const drivePhoto = (gasResult && gasResult.photo) || {};
    const defaultFolderUrl = details.category === 'justificaciones' ? config.driveJustifFolderUrl : config.driveDamagedFolderUrl;
    const driveUrl = gasResult?.driveUrl || drivePhoto.url || defaultFolderUrl;
    const driveFileId = gasResult?.driveFileId || drivePhoto.id || null;
    const thumbnailUrl = gasResult?.thumbnailUrl || drivePhoto.thumbnailUrl || (driveFileId ? `https://lh3.googleusercontent.com/d/${driveFileId}=s1600` : null);
    const directUrl = gasResult?.directUrl || drivePhoto.directUrl || (driveFileId ? `https://drive.google.com/uc?export=view&id=${driveFileId}` : driveUrl);

    // Cache photo in memory with Drive URLs for instant online retrieval
    this.photoMemoryCache.set(photoId, {
      buffer: fileBuffer,
      mimeType: mimeType || 'image/jpeg',
      details,
      driveUrl,
      driveFileId,
      thumbnailUrl,
      directUrl,
      savedAt: Date.now()
    });
    this.pruneCache();

    // 3. Save single local copy only if NOT running on Vercel to preserve disk space and avoid /tmp limits
    if (!process.env.VERCEL) {
      try {
        if (!fs.existsSync(this.photosDir)) {
          fs.mkdirSync(this.photosDir, { recursive: true });
        }
        fs.writeFileSync(legacyPath, fileBuffer);
      } catch (e) {
        // Safe fallback
      }
    }

    return {
      photoId,
      filename: photoId,
      url: driveUrl || `/api/photos/${photoId}`,
      localUrl: `/api/photos/${photoId}`,
      driveUrl,
      driveFileId,
      thumbnailUrl,
      directUrl,
      driveSaved: !!driveUrl,
      driveFolderPath: details.folderPath,
      driveLogicalPath: details.logicalPath,
      driveFileName: details.fileName,
      category: details.category,
      sku: details.cleanSku,
      center: details.centerName,
      date: details.date,
      mimeType: mimeType || 'image/jpeg',
      size: fileBuffer.length
    };
  }

  getPhoto(filename) {
    const safeName = path.basename(filename);
    if (this.photoMemoryCache.has(safeName)) {
      return this.photoMemoryCache.get(safeName);
    }
    const fullPath = path.join(this.photosDir, safeName);
    try {
      if (fs.existsSync(fullPath)) {
        const ext = path.extname(safeName).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        if (ext === '.webp') mimeType = 'image/webp';
        if (ext === '.gif') mimeType = 'image/gif';
        return {
          filePath: fullPath,
          mimeType
        };
      }
    } catch (e) {}

    // Fallback: Check if this photo was registered in any justification record with a Google Drive URL
    try {
      const justDir = storagePath.getJustificationsDirectory();
      const files = storagePath.listFiles(justDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const j = storagePath.readJson(path.join(justDir, f), null);
        if (j && (String(j.photoUrl || '').includes(safeName) || j.photoId === safeName)) {
          const driveUrl = j.driveUrl || (j.photoUrl && j.photoUrl.includes('drive.google.com') ? j.photoUrl : null);
          if (driveUrl || j.driveFileId) {
            return {
              driveUrl: driveUrl,
              directUrl: j.driveFileId ? `https://drive.google.com/uc?export=view&id=${j.driveFileId}` : driveUrl,
              thumbnailUrl: j.thumbnailUrl || (j.driveFileId ? `https://lh3.googleusercontent.com/d/${j.driveFileId}=s1600` : null),
              isDriveRedirect: true
            };
          }
        }
      }
    } catch (_) {}

    return null;
  }

  getPhotoPath(filename) {
    // Prevent path traversal
    const safeName = path.basename(filename);
    const fullPath = path.join(this.photosDir, safeName);
    try {
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    } catch (e) {}
    return null;
  }
}

module.exports = new DriveService();
