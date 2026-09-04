const express = require('express');
const router = express.Router();
const config = require('../config');
const inventoryService = require('../services/inventoryService');
const gasService = require('../services/gasService');
const { authenticate } = require('../middlewares/authMiddleware');
const { restrictCenter } = require('../middlewares/centerMiddleware');

// GET /api/barrido/search
router.get('/search', authenticate, restrictCenter, async (req, res) => {
  try {
    const { q, center } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, message: 'Debe ingresar un código de barras o SKU' });
    }

    const requestedCenter = center || (req.user.center !== 'GLOBAL' ? req.user.center : '1120');
    const targetCenter = config.getCenterCode ? config.getCenterCode(requestedCenter) : requestedCenter;

    const result = await inventoryService.searchProductForBarrido({
      barcodeOrSku: q,
      center: targetCenter
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/barrido/count
router.post('/count', authenticate, restrictCenter, async (req, res) => {
  try {
    const {
      inventoryId,
      sku,
      itemId,
      stockFisico,
      malEstado,
      location,
      isNewLocation,
      reason,
      center,
      photoUrl,
      comentario
    } = req.body;

    const requestedCenter = center || (req.user.center !== 'GLOBAL' ? req.user.center : '1120');
    const targetCenter = config.getCenterCode ? config.getCenterCode(requestedCenter) : requestedCenter;
    const targetInvId = inventoryId || `INV-BARRIDO-${targetCenter}-001`;

    const result = await inventoryService.updateCount({
      inventoryId: targetInvId,
      itemId,
      sku,
      stockFisico,
      malEstado: malEstado || 0,
      location,
      isNewLocation: !!isNewLocation,
      user: req.user,
      reason: reason || 'Registro desde Escáner Barrido',
      photoUrl,
      comentario: comentario || ''
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/barrido/finish
router.post('/finish', authenticate, restrictCenter, async (req, res) => {
  try {
    const { inventoryId, signature, center } = req.body;
    const requestedCenter = center || (req.user.center !== 'GLOBAL' ? req.user.center : '1120');
    const cleanCenter = config.getCenterCode ? config.getCenterCode(requestedCenter) : requestedCenter;
    const targetInvId = inventoryId || `INV-BARRIDO-${cleanCenter}-001`;

    const inv = inventoryService.getInventoryRaw(targetInvId);
    if (!inv || !inv.items || inv.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No hay ítems registrados en el barrido actual para el centro ${cleanCenter}. Realice al menos un conteo antes de finalizar.`
      });
    }

    inv.status = 'PENDIENTE_JUSTIFICACION';
    inv.submittedAt = new Date().toISOString();
    inv.submittedBy = req.user.username;
    inv.signature = signature || `Barrido finalizado por ${req.user.username}`;
    inventoryService.saveInventory(inv);

    // Sync to Google Apps Script (createFinalFile)
    let gasResult = null;
    try {
      gasResult = await gasService.syncFinalInventoryToGAS('BARRIDO', {
        inventoryId: inv.id,
        inventoryName: inv.name,
        type: 'BARRIDO',
        center: cleanCenter,
        items: inv.items,
        user: req.user.username
      });
    } catch (gasErr) {
      console.warn('[barridoRoutes] Warning sending final file to GAS:', gasErr.message);
    }

    res.json({
      success: true,
      message: `Barrido finalizado exitosamente con ${inv.items.length} ítems y enviado a Google Sheets / Drive.`,
      inventory: inv,
      gasResult
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
