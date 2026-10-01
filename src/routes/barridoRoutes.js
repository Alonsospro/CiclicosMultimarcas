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

    const isAdmin = req.user.isSuperadmin || req.user.role === 'ADMIN';
    const effectiveCenter = (!isAdmin && req.user.center && req.user.center !== 'GLOBAL')
      ? req.user.center
      : (center || (req.user.center !== 'GLOBAL' ? req.user.center : '1120'));
    const targetCenter = config.getCenterCode ? config.getCenterCode(effectiveCenter) : effectiveCenter;

    const result = await inventoryService.searchProductForBarrido({
      barcodeOrSku: q,
      center: targetCenter
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/barrido/count
router.post('/count', authenticate, restrictCenter, async (req, res) => {
  try {
    const {
      inventoryId,
      sku,
      itemId,
      barcode,
      codigoBarras,
      descripcion,
      description,
      stockFisico,
      malEstado,
      location,
      isNewLocation,
      reason,
      center,
      photoUrl,
      photoBase64,
      justificationPhotoUrl,
      justificationPhoto,
      comentario,
      categoria,
      clasificacionAbc,
      unidad,
      costoUnitario,
      stockSistema
    } = req.body;

    const isAdmin = req.user.isSuperadmin || req.user.role === 'ADMIN';
    const effectiveCenter = (!isAdmin && req.user.center && req.user.center !== 'GLOBAL')
      ? req.user.center
      : (center || (req.user.center !== 'GLOBAL' ? req.user.center : '1120'));
    const targetCenter = config.getCenterCode ? config.getCenterCode(effectiveCenter) : effectiveCenter;
    const targetInvId = inventoryId || `INV-BARRIDO-${targetCenter}-001`;

    const cleanCategoria = (categoria && !['BARRIDO', 'CICLICO', 'GENERAL', 'EXPRESS'].includes(String(categoria).toUpperCase().trim()))
      ? categoria
      : 'repuesto';

    const result = await inventoryService.updateCount({
      inventoryId: targetInvId,
      operationId: req.body.operationId,
      expectedItemVersion: req.body.expectedItemVersion,
      type: 'BARRIDO',
      itemId,
      sku,
      barcode: barcode || codigoBarras || '',
      descripcion: descripcion || description || '',
      stockFisico,
      malEstado: malEstado || 0,
      location,
      isNewLocation: !!isNewLocation,
      user: req.user,
      reason: reason || 'Registro desde Escáner Barrido',
      photoUrl,
      photoBase64,
      justificationPhotoUrl,
      justificationPhoto,
      comentario: comentario || '',
      categoria: cleanCategoria,
      clasificacionAbc,
      unidad,
      costoUnitario,
      stockSistema
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/barrido/finish
router.post('/finish', authenticate, restrictCenter, async (req, res) => {
  try {
    const { inventoryId, signature, center } = req.body;
    const isAdmin = req.user.isSuperadmin || req.user.role === 'ADMIN';
    const effectiveCenter = (!isAdmin && req.user.center && req.user.center !== 'GLOBAL')
      ? req.user.center
      : (center || (req.user.center !== 'GLOBAL' ? req.user.center : '1120'));
    const cleanCenter = config.getCenterCode ? config.getCenterCode(effectiveCenter) : effectiveCenter;
    const targetInvId = inventoryId || `INV-BARRIDO-${cleanCenter}-001`;

    const result = await require('../services/storagePath').runDurable(async () => {
      const inv = inventoryService.getInventoryRaw(targetInvId);
      if (!inv?.items?.length) throw new Error('No hay ítems registrados en este barrido.');
      const gasResult = await gasService.syncFinalInventoryToGAS('BARRIDO', {
          operationId: `barrido-close:${inv.id}:${require('crypto').createHash('sha256').update(JSON.stringify(inv.items)).digest('hex')}`,
        inventoryId: inv.id, inventoryName: inv.name, type: 'BARRIDO', center: cleanCenter,
        items: inv.items, user: req.user.username
      });
      inv.status = 'PENDIENTE_JUSTIFICACION';
      inv.submittedAt = new Date().toISOString();
      inv.submittedBy = req.user.username;
      inv.signature = signature || `Barrido finalizado por ${req.user.username}`;
      inventoryService.saveInventory(inv);
      return { success: true, inventory: inv, gasResult, message: 'Barrido finalizado y archivo confirmado en Drive.' };
      }, { scope: targetInvId, requireSynced: true });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

module.exports = router;
