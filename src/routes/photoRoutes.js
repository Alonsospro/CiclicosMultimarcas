const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const storagePath = require('../services/storagePath');
const driveService = require('../services/driveService');
const { authenticate } = require('../middlewares/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// POST /api/photos/upload
router.post('/upload', authenticate, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se envió ningún archivo de imagen' });
    }

    const { category, photoType, sku, center, date, inventoryId, itemId } = req.body;

    const saved = await driveService.savePhotoFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      {
        category: category || photoType || 'malestado',
        sku,
        center: center || req.user?.center,
        date,
        inventoryId,
        itemId
      }
    );

    res.json({
      success: true,
      message: 'Foto cargada y organizada correctamente para Google Drive',
      photo: saved
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const referencePhotoService = require('../services/referencePhotoService');

// POST /api/photos/sync-reference (Trigger Google Drive folder sync)
router.post('/sync-reference', async (req, res) => {
  try {
    const result = await referencePhotoService.syncDriveFolder();
    res.json({
      success: true,
      message: 'Sincronización de fotos de Google Drive completada',
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/photos/reference-info/:sku (Get metadata of reference photo)
router.get('/reference-info/:sku', async (req, res) => {
  try {
    const rawSku = String(req.params.sku || '').trim();
    const rawBarcode = String(req.query.barcode || '').trim();
    const photo = await referencePhotoService.getPhoto(rawSku, rawBarcode);

    if (photo) {
      return res.json({
        found: true,
        sku: rawSku,
        source: photo.source,
        mimeType: photo.mimeType,
        url: `/api/photos/reference/${encodeURIComponent(rawSku)}?barcode=${encodeURIComponent(rawBarcode)}`
      });
    }

    return res.json({
      found: false,
      sku: rawSku,
      message: 'No existe imagen cargada en Google Drive ni en almacenamiento local',
      url: `/api/photos/reference/${encodeURIComponent(rawSku)}`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/photos/reference/:sku (Serve reference photo for product by SKU or Barcode)
router.get('/reference/:sku', async (req, res) => {
  const rawSku = String(req.params.sku || '').trim();
  const rawBarcode = String(req.query.barcode || '').trim();

  try {
    // 1. If configured as an external URL template (e.g. https://servidor.com/fotos/{sku}.jpg)
    const configuredDir = config.referencePhotosDir || '';
    if (configuredDir.startsWith('http://') || (configuredDir.startsWith('https://') && !configuredDir.includes('drive.google.com'))) {
      const remoteUrl = configuredDir.includes('{sku}')
        ? configuredDir.replace('{sku}', encodeURIComponent(rawSku)).replace('{barcode}', encodeURIComponent(rawBarcode))
        : `${configuredDir.replace(/\/+$/, '')}/${encodeURIComponent(rawSku)}.jpg`;
      return res.redirect(remoteUrl);
    }

    // 2. Query Reference Photo Service (Google Drive + Local Cache)
    const photo = await referencePhotoService.getPhoto(rawSku, rawBarcode);

    if (photo) {
      const contentType = photo.mimeType || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Photo-Source', photo.source || 'REFERENCE_STORE');

      if (photo.buffer) {
        return res.send(photo.buffer);
      }

      if (photo.filePath && fs.existsSync(photo.filePath)) {
        return fs.createReadStream(photo.filePath).pipe(res);
      }
    }
  } catch (err) {
    console.warn(`[photoRoutes] Error serving reference photo for SKU ${rawSku}:`, err.message);
  }

  // Fallback: Generate dynamic SVG placeholder with part branding & SKU
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(referencePhotoService.getFallbackSvg(rawSku));
});

// GET /api/photos/:filename (Serve real binary image)
router.get('/:filename', (req, res) => {
  const photo = driveService.getPhoto(req.params.filename);
  if (!photo) {
    return res.status(404).json({ success: false, message: 'Imagen no encontrada' });
  }

  const contentType = photo.mimeType || 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (photo.buffer) {
    return res.send(photo.buffer);
  }
  if (photo.filePath && fs.existsSync(photo.filePath)) {
    const stream = fs.createReadStream(photo.filePath);
    return stream.pipe(res);
  }
  res.status(404).json({ success: false, message: 'Imagen no disponible' });
});

module.exports = router;
