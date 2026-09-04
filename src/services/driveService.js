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

  formatJustificationName(type, sku, center) {
    const cleanType = (type || 'CICLICO').toUpperCase();
    const cleanSku = (sku || 'SKU').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const cleanCenter = (center || 'WARNES').toUpperCase();
    return `JUST-${cleanType}-${cleanSku}-${cleanCenter}`;
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
   * Mal Estado: nibol/ciclicos/fotos/malestado/{fecha}/{centro}/{sku}.jpg
   * Justificaciones: nibol/ciclicos/fotos/justificaciones/{fecha}/{centro}/{sku}.jpg
   */
  getPhotoDriveDetails({ category = 'malestado', sku = 'SKU', center = '1120', date = new Date(), ext = '.jpg' }) {
    const cleanCategory = String(category).toLowerCase().includes('just') ? 'justificaciones' : 'malestado';
    const dateStr = this.formatDate(date);
    const centerName = this.getCenterName(center);
    const cleanSku = this.sanitizeFilename(sku);
    const fileExt = ext.startsWith('.') ? ext : `.${ext}`;
    const fileName = `${cleanSku}${fileExt}`;

    const folderPath = `nibol/ciclicos/fotos/${cleanCategory}/${dateStr}/${centerName}`;
    const logicalPath = `${folderPath}/${fileName}`;

    return {
      category: cleanCategory,
      date: dateStr,
      centerName,
      cleanSku,
      fileName,
      folderPath,
      logicalPath
    };
  }

  getPhotoAsDataUri(identifier) {
    if (!identifier) return null;
    const str = String(identifier).trim();
    if (str.startsWith('data:image')) return str;
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
    const driveRecord = {
      fileId,
      fileName: `${fileName}.xlsx`,
      logicalPath: `${folderPath}/${fileName}.xlsx`,
      inventoryId: id,
      type,
      center,
      closedBy: user.username,
      closedAt: new Date().toISOString(),
      reviewNotes: reviewNotes || 'Revisión finalizada y aprobada por administrador',
      totalItems: items.length,
      justificationsCount: (justifications || []).length,
      items: items.map(item => {
        const matchingJust = (justifications || []).find(j => (j.sku || j.SKU) === item.SKU);
        const razon = item.Razon || item.Razon_Justificacion || (matchingJust ? (matchingJust.reasonType || matchingJust.razon) : '');
        const comentarioJust = item.Comentario_Justificacion || (matchingJust ? (matchingJust.justification || matchingJust.comentario) : '');

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
          photoBase64: this.getPhotoAsDataUri(item.foto_mal_estado) || ''
        };
      }),
      justifications: (justifications || []).map(j => ({
        sku: j.sku || j.SKU || '',
        justification: j.justification || '',
        reasonType: j.reasonType || '',
        photoBase64: this.getPhotoAsDataUri(j.photoUrl) || ''
      }))
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

    const details = this.getPhotoDriveDetails({
      category,
      sku,
      center,
      date,
      ext
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
    try {
      await gasService.syncPhotoToGAS({
        category: details.category,
        date: details.date,
        center: details.centerName,
        sku: details.cleanSku,
        fileName: details.fileName,
        folderPath: details.folderPath,
        fileBuffer,
        mimeType,
        inventoryId: metadata.inventoryId || null
      });
    } catch (err) {
      console.warn('[driveService] Notice during GAS photo sync:', err.message);
    }

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
      url: `/api/photos/${photoId}`,
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
