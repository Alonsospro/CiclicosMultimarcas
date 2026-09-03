const express = require('express');
const router = express.Router();
const inventoryService = require('../services/inventoryService');
const gasService = require('../services/gasService');
const { authenticate, requireRole, requireInventoryCreator } = require('../middlewares/authMiddleware');
const { restrictCenter } = require('../middlewares/centerMiddleware');

// GET /api/inventories (List)
router.get('/', authenticate, restrictCenter, (req, res) => {
  try {
    const { center, type } = req.query;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;
    const list = inventoryService.getInventories(req.user, targetCenter, type);
    res.json({ success: true, inventories: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/inventories/:id (Detail + Blind count filter for Auxiliar)
router.get('/:id', authenticate, (req, res) => {
  try {
    const inv = inventoryService.getInventoryById(req.params.id, req.user);
    res.json({ success: true, inventory: inv });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
});

// POST /api/inventories (Create new - Juan Carlos & Alonso Only)
router.post('/', authenticate, requireInventoryCreator, restrictCenter, async (req, res) => {
  try {
    const { type, center, name, items } = req.body;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? (center || '1120') : req.user.center;
    const newInv = await inventoryService.createInventory({
      type,
      center: targetCenter,
      name,
      items,
      user: req.user
    });
    res.status(201).json({ success: true, inventory: newInv });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/fetch-from-gas (Fetch remote template items from Google Apps Script - Juan Carlos & Alonso Only)
router.post('/fetch-from-gas', authenticate, requireInventoryCreator, async (req, res) => {
  try {
    const { type, center } = req.body;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? (center || '1120') : req.user.center;
    const products = await gasService.fetchProductsFromScript(type, targetCenter);
    res.json({
      success: true,
      message: `Se cargaron ${products.length} productos desde Google Apps Script`,
      products
    });
  } catch (err) {
    // If GAS fails or is unreachable in offline dev, return helpful message without crash
    res.status(200).json({
      success: true,
      fallback: true,
      message: `Aviso de conexión con Google Apps Script: ${err.message}. Puede ingresar ítems manualmente o usar la plantilla local.`,
      products: []
    });
  }
});

// POST /api/inventories/:id/count (Register physical count)
router.post('/:id/count', authenticate, (req, res) => {
  try {
    const { itemId, sku, stockFisico, malEstado, location, isNewLocation, reason, photoUrl, locked } = req.body;

    const result = inventoryService.updateCount({
      inventoryId: req.params.id,
      itemId,
      sku,
      stockFisico,
      malEstado,
      location,
      isNewLocation,
      user: req.user,
      reason,
      photoUrl,
      locked
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/:id/items/:itemId/request-unlock (Unlock item for modification)
router.post('/:id/items/:itemId/request-unlock', authenticate, restrictCenter, (req, res) => {
  try {
    const { reason } = req.body;
    const result = inventoryService.requestUnlockItem({
      inventoryId: req.params.id,
      itemId: req.params.itemId,
      user: req.user,
      reason: reason || 'Modificación de conteo solicitada por el usuario'
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/inventories/:id/items/:itemId (Delete additional location or item)
router.delete('/:id/items/:itemId', authenticate, (req, res) => {
  try {
    const result = inventoryService.deleteItem({
      inventoryId: req.params.id,
      itemId: req.params.itemId,
      user: req.user
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/:id/reassign (Reassign items)
router.post('/:id/reassign', authenticate, requireRole(['ADMIN', 'ENCARGADO']), (req, res) => {
  try {
    const { itemIds, toUser, reason } = req.body;
    const result = inventoryService.reassignTasks({
      inventoryId: req.params.id,
      itemIds,
      toUser,
      requestingUser: req.user,
      reason
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/:id/submit (Submit for review)
router.post('/:id/submit', authenticate, (req, res) => {
  try {
    const { signature } = req.body;
    const result = inventoryService.submitInventoryForReview({
      inventoryId: req.params.id,
      user: req.user,
      signature
    });
    res.json({ success: true, inventory: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/:id/reopen (Reopen inventory - Admin only)
router.post('/:id/reopen', authenticate, requireRole(['ADMIN']), (req, res) => {
  try {
    const { reason } = req.body;
    const result = inventoryService.reopenInventory({
      inventoryId: req.params.id,
      user: req.user,
      reason
    });
    res.json({ success: true, inventory: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/inventories/:id (Delete inventory with confirmation key - Admin & Encargado)
router.delete('/:id', authenticate, requireRole(['ADMIN', 'ENCARGADO']), (req, res) => {
  try {
    const { deleteKey, reason } = req.body;
    const result = inventoryService.deleteInventory({
      inventoryId: req.params.id,
      user: req.user,
      deleteKey,
      reason
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/sync (Rehydrate inventories from client cache in serverless environments)
router.post('/sync', authenticate, (req, res) => {
  try {
    const { inventories } = req.body;
    if (Array.isArray(inventories) && inventories.length > 0) {
      let synced = 0;
      inventories.forEach(inv => {
        if (inv && inv.id) {
          const existing = inventoryService.getInventoryRaw(inv.id);
          if (!existing) {
            inventoryService.saveInventory(inv);
            synced++;
          }
        }
      });
      return res.json({ success: true, synced, total: inventories.length });
    }
    res.json({ success: true, synced: 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
