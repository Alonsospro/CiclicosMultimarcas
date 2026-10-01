const express = require('express');
const router = express.Router();
const inventoryService = require('../services/inventoryService');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

// GET /api/justifications
router.get('/', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { center } = req.query;
    await require('../services/storagePath').refreshOperational();
    const tasks = await inventoryService.getPendingJustifications(req.user, center);
    res.json({
      success: true,
      tasks
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/justifications (Submit a single justification)
router.post('/', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { inventoryId, sku, justification, photoUrl, reasonType, driveUrl, driveFileId, almacen, warehouse, location, itemId, corroboration, corroboracion, status, isCuadra, isJustification2, round } = req.body;
    if (!inventoryId || !sku) {
      return res.status(400).json({ success: false, message: 'inventoryId y sku son obligatorios' });
    }

    const saved = await inventoryService.saveJustification({
      inventoryId,
      operationId: req.body.operationId,
      sku,
      justification,
      photoUrl,
      reasonType,
      driveUrl,
      driveFileId,
      almacen: almacen || warehouse,
      location,
      itemId,
      corroboration,
      corroboracion,
      status,
      isCuadra,
      isJustification2: isJustification2 === true || isJustification2 === 'true' || round === 2 || round === '2',
      round: round ? parseInt(round, 10) : undefined,
      user: req.user
    });

    res.json({
      success: true,
      message: `Justificación guardada para SKU ${sku}`,
      justification: saved
    });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/justifications/:id/corroborate (Mark item as CUADRA or NO_CUADRA)
router.post('/:id/corroborate', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { sku, status, almacen, warehouse, location, itemId } = req.body;
    if (!sku || !status) {
      return res.status(400).json({ success: false, message: 'sku y status (CUADRA/NO_CUADRA) son obligatorios' });
    }
    const result = await inventoryService.corroborateItem({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      sku,
      status,
      almacen: almacen || warehouse,
      location,
      itemId,
      user: req.user
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/justifications/:id/enable-recount (Enable re-count for discrepant items to assigned counter)
router.post('/:id/enable-recount', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { skusToRecount } = req.body;
    const result = await inventoryService.enableRecount({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user,
      skusToRecount
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/justifications/:id/finish-review ("Terminar revisión" -> creates final Drive file)
router.post('/:id/finish-review', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const result = await inventoryService.finishReviewAndClose({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user,
      reviewNotes
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

module.exports = router;
