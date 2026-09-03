const fs = require('fs');
const path = require('path');
const config = require('../config');
const storagePath = require('./storagePath');

class ReferencePhotoService {
  constructor() {
    this.folderId = config.driveReferenceFolderId || '1dp0MUZ4HcCSpDejpF5JknWN_09ZCshU6';
    this.folderUrl = config.driveReferenceFolderUrl || `https://drive.google.com/drive/folders/${this.folderId}?usp=drive_link`;
    this.localDir = storagePath.getReferencePhotosDirectory();
    
    // In-memory indexes
    this.driveIndex = new Map(); // normalizedKey -> { fileId, name, thumbUrl, directUrl, originalName }
    this.localIndex = new Map(); // normalizedKey -> fullFilePath
    this.lastSyncTime = 0;
    this.currentSyncPromise = null;

    this.ensureLocalDir();
    this.indexLocalFiles();
    
    const isTesting = process.env.NODE_ENV === 'test' || process.argv.some(arg => typeof arg === 'string' && arg.includes('test'));
    const isServerless = !!(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
    // Initial sync from Google Drive in background only in continuous server environments
    if (!isServerless && !isTesting) {
      this.syncDriveFolder().catch(err => {
        console.warn('[referencePhotoService] Initial Drive sync notice:', err.message);
      });

      // Background recurring sync every 10 minutes (600,000 ms)
      setInterval(() => {
        this.syncDriveFolder().catch(err => {
          console.warn('[referencePhotoService] Background Drive sync notice:', err.message);
        });
      }, 10 * 60 * 1000).unref();
    }
  }

  ensureLocalDir() {
    try {
      if (!fs.existsSync(this.localDir)) {
        fs.mkdirSync(this.localDir, { recursive: true });
      }
    } catch (e) {
      // Graceful in read-only environments
    }
  }

  normalizeKey(key) {
    if (!key) return '';
    return String(key)
      .trim()
      .toLowerCase()
      .replace(/^jd[_\-\s]*/i, '')
      .replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, '');
  }

  indexLocalFiles() {
    try {
      this.ensureLocalDir();
      if (!fs.existsSync(this.localDir)) {
        return;
      }
      const files = fs.readdirSync(this.localDir);
      this.localIndex.clear();

      for (const file of files) {
        const fullPath = path.join(this.localDir, file);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        const ext = path.extname(file).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) continue;

        const baseName = path.basename(file, ext);
        const norm = this.normalizeKey(baseName);
        const exactNorm = baseName.toLowerCase();

        this.localIndex.set(norm, fullPath);
        this.localIndex.set(exactNorm, fullPath);
      }
      console.log(`[referencePhotoService] Local photos indexed: ${this.localIndex.size} entries.`);
    } catch (err) {
      console.warn('[referencePhotoService] Error indexing local files:', err.message);
    }
  }

  async syncDriveFolder() {
    if (this.currentSyncPromise) {
      return this.currentSyncPromise;
    }

    this.currentSyncPromise = (async () => {
      try {
        if (!this.folderId) {
          console.warn('[referencePhotoService] No Google Drive folder ID configured');
          return { success: false, message: 'No folder ID' };
        }

        console.log(`[referencePhotoService] Syncing Google Drive reference photos (Folder ID: ${this.folderId})...`);

      // 1. Fetch Google Drive embedded folder view (HTML list view)
      const embeddedUrl = `https://drive.google.com/embeddedfolderview?id=${this.folderId}#list`;
      const res = await fetch(embeddedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      });

      if (!res.ok) {
        throw new Error(`Google Drive returned status ${res.status}`);
      }

      const html = await res.text();
      let foundCount = 0;

      // Regular expressions to extract entries
      // Entry pattern: <div class="flip-entry" id="entry-FILE_ID" ... <div class="flip-entry-title">FILENAME</div>
      const entryRegex = /id="entry-([a-zA-Z0-9_-]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
      let match;
      while ((match = entryRegex.exec(html)) !== null) {
        const fileId = match[1];
        const originalTitle = match[2].trim();
        this.registerDriveFile(fileId, originalTitle);
        foundCount++;
      }

      // Secondary fallback parsing: Match direct link & title
      if (foundCount === 0) {
        const linkRegex = /href="https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)[^"]*"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
        while ((match = linkRegex.exec(html)) !== null) {
          const fileId = match[1];
          const originalTitle = match[2].trim();
          this.registerDriveFile(fileId, originalTitle);
          foundCount++;
        }
      }

      this.lastSyncTime = Date.now();
      this.indexLocalFiles();

      console.log(`[referencePhotoService] Drive sync complete: ${foundCount} items registered (Total keys in index: ${this.driveIndex.size})`);

        return {
          success: true,
          folderId: this.folderId,
          itemsFound: foundCount,
          totalKeys: this.driveIndex.size,
          lastSync: new Date(this.lastSyncTime).toISOString()
        };
      } catch (err) {
        console.warn('[referencePhotoService] Error during Drive sync:', err.message);
        return { success: false, error: err.message };
      } finally {
        this.currentSyncPromise = null;
      }
    })();

    return this.currentSyncPromise;
  }

  registerDriveFile(fileId, originalTitle) {
    const cleanName = originalTitle.replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, '').trim();
    const norm = this.normalizeKey(cleanName);
    const exact = cleanName.toLowerCase();
    const withJd = `jd_${norm}`;

    const record = {
      fileId,
      originalTitle,
      name: cleanName,
      thumbUrl: `https://lh3.googleusercontent.com/d/${fileId}=s1600`,
      backupThumbUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
      directDownloadUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
      cachedLocalPath: path.join(this.localDir, `drive_${fileId}_${cleanName}.jpg`)
    };

    this.driveIndex.set(norm, record);
    this.driveIndex.set(exact, record);
    this.driveIndex.set(withJd, record);
    this.driveIndex.set(`jd-${norm}`, record);
  }

  generateSearchCandidates(rawSku = '', rawBarcode = '') {
    const sSku = String(rawSku || '').trim();
    const sBarcode = String(rawBarcode || '').trim();

    const candidates = new Set();
    if (sSku) {
      candidates.add(sSku);
      candidates.add(sSku.toLowerCase());
      candidates.add(this.normalizeKey(sSku));
      candidates.add(`jd_${this.normalizeKey(sSku)}`);
      candidates.add(`jd-${this.normalizeKey(sSku)}`);
    }

    if (sBarcode) {
      candidates.add(sBarcode);
      candidates.add(sBarcode.toLowerCase());
      candidates.add(this.normalizeKey(sBarcode));
      candidates.add(`jd_${this.normalizeKey(sBarcode)}`);
    }

    return Array.from(candidates).filter(Boolean);
  }

  async getPhoto(rawSku, rawBarcode = '') {
    const candidates = this.generateSearchCandidates(rawSku, rawBarcode);

    // 1. Check in local files or local cache
    for (const cand of candidates) {
      const normCand = this.normalizeKey(cand);
      const exactCand = cand.toLowerCase();

      let localHit = this.localIndex.get(exactCand) || this.localIndex.get(normCand);
      if (!localHit) {
        // Direct disk probe
        for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.svg']) {
          const p1 = path.join(this.localDir, `${cand}${ext}`);
          const p2 = path.join(this.localDir, `JD_${cand}${ext}`);
          const p3 = path.join(this.localDir, `${normCand}${ext}`);
          if (fs.existsSync(p1)) { localHit = p1; break; }
          if (fs.existsSync(p2)) { localHit = p2; break; }
          if (fs.existsSync(p3)) { localHit = p3; break; }
        }
        if (localHit) {
          this.localIndex.set(exactCand, localHit);
          this.localIndex.set(normCand, localHit);
        }
      }

      if (localHit && fs.existsSync(localHit)) {
        return {
          source: 'LOCAL',
          filePath: localHit,
          mimeType: this.getMimeType(localHit),
          sku: rawSku
        };
      }
    }

    // 2. Check Drive Index
    let driveRecord = null;
    for (const cand of candidates) {
      const normCand = this.normalizeKey(cand);
      const exactCand = cand.toLowerCase();

      driveRecord = this.driveIndex.get(exactCand) || this.driveIndex.get(normCand);
      if (driveRecord) break;
    }

    // 2.1. Query Google Apps Script WebApp action=getReferencePhoto directly
    if (!driveRecord) {
      try {
        const gasService = require('./gasService');
        for (const cand of candidates) {
          const gasRes = await gasService.getReferencePhotoFromGAS(cand);
          if (gasRes && gasRes.found && gasRes.fileId) {
            this.registerDriveFile(gasRes.fileId, gasRes.fileName || `${cand}.jpg`);
            const normCand = this.normalizeKey(cand);
            const exactCand = cand.toLowerCase();
            driveRecord = this.driveIndex.get(exactCand) || this.driveIndex.get(normCand);
            if (driveRecord) break;
          }
        }
      } catch (gasErr) {
        // Fallback gracefully
      }
    }

    // If still not found and haven't synced recently (>30s), trigger quick sync
    if (!driveRecord && (Date.now() - this.lastSyncTime > 30 * 1000)) {
      await this.syncDriveFolder();
      for (const cand of candidates) {
        const normCand = this.normalizeKey(cand);
        const exactCand = cand.toLowerCase();
        driveRecord = this.driveIndex.get(exactCand) || this.driveIndex.get(normCand);
        if (driveRecord) break;
      }
    }

    // 3. If found in Drive Index
    if (driveRecord) {
      // Check if already cached to disk
      if (fs.existsSync(driveRecord.cachedLocalPath)) {
        return {
          source: 'DRIVE_CACHED',
          filePath: driveRecord.cachedLocalPath,
          mimeType: 'image/jpeg',
          sku: rawSku,
          fileId: driveRecord.fileId
        };
      }

      // Download from Google Drive and save to disk cache
      try {
        const buffer = await this.downloadDriveImage(driveRecord);
        if (buffer && buffer.length > 0) {
          try {
            fs.writeFileSync(driveRecord.cachedLocalPath, buffer);
            this.localIndex.set(this.normalizeKey(driveRecord.name), driveRecord.cachedLocalPath);
          } catch (writeErr) {
            console.warn('[referencePhotoService] Failed caching image to disk:', writeErr.message);
          }

          return {
            source: 'GOOGLE_DRIVE',
            buffer,
            filePath: driveRecord.cachedLocalPath,
            mimeType: 'image/jpeg',
            sku: rawSku,
            fileId: driveRecord.fileId
          };
        }
      } catch (dlErr) {
        console.warn(`[referencePhotoService] Failed downloading Drive image (${driveRecord.fileId}):`, dlErr.message);
      }
    }

    return null;
  }

  async downloadDriveImage(record) {
    const urlsToTry = [
      record.thumbUrl,
      record.backupThumbUrl,
      record.directDownloadUrl
    ];

    for (const url of urlsToTry) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!res.ok) continue;

        const contentType = res.headers.get('content-type') || '';
        // Ensure response is an image, not an error HTML page
        if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
          const arrayBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          if (buf.length > 100) {
            return buf;
          }
        }
      } catch (e) {
        // try next URL
      }
    }

    return null;
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.png': return 'image/png';
      case '.webp': return 'image/webp';
      case '.gif': return 'image/gif';
      case '.svg': return 'image/svg+xml';
      case '.jpg':
      case '.jpeg':
      default:
        return 'image/jpeg';
    }
  }

  getFallbackSvg(sku = 'NIBOL REPUESTOS') {
    const displaySku = (sku && sku !== 'default') ? sku : 'NIBOL REPUESTOS';
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="220" viewBox="0 0 400 220" style="background:#0f172a; font-family: system-ui, -apple-system, sans-serif;">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1e293b;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0f172a;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)"/>
        <rect x="10" y="10" width="380" height="200" rx="10" fill="none" stroke="rgba(56,189,248,0.25)" stroke-width="1.5" stroke-dasharray="6,4"/>
        
        <!-- Icon Graphic -->
        <g transform="translate(160, 40)">
          <polygon points="40,5 75,25 40,45 5,25" fill="#38bdf8" opacity="0.85"/>
          <polygon points="5,25 40,45 40,85 5,65" fill="#0284c7" opacity="0.95"/>
          <polygon points="40,45 75,25 75,65 40,85" fill="#0369a1" opacity="1"/>
          <path d="M40,5 L40,45" stroke="#ffffff" stroke-width="1" opacity="0.5"/>
        </g>
        
        <!-- Badge Text -->
        <rect x="100" y="135" width="200" height="26" rx="13" fill="rgba(56,189,248,0.12)" stroke="rgba(56,189,248,0.3)"/>
        <text x="200" y="152" font-size="12" font-weight="700" fill="#38bdf8" text-anchor="middle" letter-spacing="1">FOTO REFERENCIAL</text>
        
        <text x="200" y="180" font-size="14" font-weight="600" fill="#f8fafc" text-anchor="middle" font-family="monospace">${displaySku}</text>
        <text x="200" y="198" font-size="10" fill="#64748b" text-anchor="middle">Google Drive / NIBOL Repuestos</text>
      </svg>
    `.trim();
  }
}

module.exports = new ReferencePhotoService();
