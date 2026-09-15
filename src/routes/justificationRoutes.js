const express = require('express');
const router = express.Router();
const inventoryService = require('../services/inventoryService');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

// GET /api/justifications (Admin only)
router.get('/', authenticate, requireRole(['ADMIN']), (req, res) => {
  try {
    const { center } = req.query;
    const tasks = inventoryService.getPendingJustifications(req.user, center);
    res.json({
      success: true,
      tasks
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/justifications (Submit a single justification)
router.post('/', authenticate, requireRole(['ADMIN']), (req, res) => {
  try {
    const { inventoryId, sku, itemId, justification, photoUrl, reasonType, stage } = req.body;
    if (!inventoryId || (!sku && !itemId)) {
      return res.status(400).json({ success: false, message: 'inventoryId y sku/itemId son obligatorios' });
    }

    const saved = inventoryService.saveJustification({
      inventoryId,
      sku,
      itemId,
      justification,
      photoUrl,
      reasonType,
      stage: stage || 1,
      user: req.user
    });

    res.json({
      success: true,
      message: `Justificación guardada para SKU ${sku}`,
      justification: saved
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/justifications/:id/finish-review ("Terminar revisión" -> creates final Drive file)
router.post('/:id/finish-review', authenticate, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { reviewNotes } = req.body;
    const result = await inventoryService.finishReviewAndClose({
      inventoryId: req.params.id,
      user: req.user,
      reviewNotes
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
