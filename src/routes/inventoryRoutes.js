const express = require('express');
const router = express.Router();
const inventoryService = require('../services/inventoryService');
const gasService = require('../services/gasService');
const { authenticate, requireRole, requireInventoryCreator } = require('../middlewares/authMiddleware');
const { restrictCenter } = require('../middlewares/centerMiddleware');

// GET /api/inventories (List)
router.get('/', authenticate, restrictCenter, async (req, res) => {
  try {
    const { center, type } = req.query;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;
    const list = await inventoryService.getInventories(req.user, targetCenter, type);
    res.json({ success: true, inventories: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/inventories/gas-health (Check real-time status of all Google Apps Script endpoints)
router.get('/gas-health', authenticate, async (req, res) => {
  try {
    const health = await gasService.checkHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/inventories/gas-diagnostics (Comprehensive diagnostic for Administrator console)
router.get('/gas-diagnostics', authenticate, async (req, res) => {
  try {
    const report = await gasService.runGasDiagnostics({ verbose: true });
    res.json(report);
  } catch (err) {
    console.error('[gas-diagnostics] Error running diagnostics:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/inventories/trash (List deleted inventories in safety trash)
router.get('/trash', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const list = inventoryService.getTrashInventories(req.user);
    res.json({ success: true, count: list.length, inventories: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/inventories/:id/restore (Restore deleted inventory from safety trash)
router.post('/:id/restore', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const restored = await inventoryService.restoreInventoryFromTrash(req.params.id, req.user);
    res.json({ success: true, message: `Inventario ${restored.name} restaurado con éxito`, inventory: restored });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// GET /api/inventories/:id (Detail + Blind count filter for Auxiliar)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const inv = await inventoryService.getInventoryById(req.params.id, req.user);
    res.json({ success: true, inventory: inv });
  } catch (err) {
    res.status(err.status || 404).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories (Create new - Juan Carlos & Alonso Only)
router.post('/', authenticate, requireInventoryCreator, restrictCenter, async (req, res) => {
  try {
    const { type, center, name, items, assignedAuxiliar } = req.body;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? (center || '1120') : req.user.center;
    const newInv = await inventoryService.createInventory({
      type,
      center: targetCenter,
      name,
      items,
      user: req.user,
      assignedAuxiliar
    });
    res.status(201).json({ success: true, inventory: newInv });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
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
router.post('/:id/count', authenticate, async (req, res) => {
  try {
    const { itemId, sku, stockFisico, malEstado, location, almacen, warehouse, isNewLocation, reason, photoUrl, locked } = req.body;

    const result = await inventoryService.updateCount({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      itemId,
      sku,
      stockFisico,
      malEstado,
      location,
      almacen,
      warehouse,
      isNewLocation,
      user: req.user,
      reason,
      photoUrl,
      locked
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/:id/items/:itemId/request-unlock (Unlock item for modification)
router.post('/:id/items/:itemId/request-unlock', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await inventoryService.requestUnlockItem({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      itemId: req.params.itemId,
      user: req.user,
      reason: reason || 'Modificación de conteo solicitada por el usuario'
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// DELETE /api/inventories/:id/items/:itemId (Delete additional location or item)
router.delete('/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const sku = req.query.sku || (req.body && req.body.sku);
    const location = req.query.location || (req.body && req.body.location);
    const result = await inventoryService.deleteItem({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      itemId: req.params.itemId,
      sku,
      location,
      user: req.user
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/:id/reassign (Reassign items)
router.post('/:id/reassign', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { itemIds, toUser, reason, assignAll } = req.body;
    const result = await inventoryService.reassignTasks({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      itemIds,
      toUser,
      requestingUser: req.user,
      reason,
      assignAll
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/:id/submit (Submit for review)
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const { signature } = req.body;
    const result = await inventoryService.submitInventoryForReview({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user,
      signature
    });
    res.json({ success: true, inventory: result });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/:id/reopen (Reopen inventory - Admin & Encargado)
router.post('/:id/reopen', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { reason, targetPhase, syncFromGAS } = req.body;
    const result = await inventoryService.reopenInventory({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user,
      reason,
      targetPhase,
      syncFromGAS
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/sync-all-sheets (Resync all active inventories from Google Sheets)
router.post('/sync-all-sheets', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const results = await inventoryService.syncAllActiveInventoriesFromSheets(req.user);
    res.json({ success: true, results });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/:id/sync-sheet (Resync items and amounts directly from Google Sheets)
router.post('/:id/sync-sheet', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const result = await inventoryService.syncInventoryFromSheet({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/:id/update-count-item (Update physical count directly for 1st count, recount 1 or recount 2)
router.post('/:id/update-count-item', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { sku, itemId, location, almacen, warehouse, countPhase, stockFisico, malEstado, reason } = req.body;
    const result = await inventoryService.updateItemQuantityInInventory({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user,
      sku,
      itemId,
      location,
      almacen: almacen || warehouse,
      countPhase,
      stockFisico,
      malEstado,
      reason
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/purge-all (Reset completely to 0 - Admin only)
// POST /api/inventories/purge-all (Bulk purge all inventories and test data - Admin only)
router.post('/purge-all', authenticate, requireRole(['ADMIN']), async (req, res) => {
  try {
    const result = await inventoryService.purgeAllData(req.user);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// DELETE /api/inventories/all (Bulk delete all inventories - Admin only)
router.delete('/all', authenticate, requireRole(['ADMIN']), async (req, res) => {
  try {
    const result = await inventoryService.purgeAllData(req.user);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// DELETE /api/inventories/:id (Delete inventory with confirmation key - Admin & Encargado)
router.delete('/:id', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const { deleteKey, reason } = req.body;
    const result = await inventoryService.deleteInventory({
      inventoryId: req.params.id,
      operationId: req.body?.operationId,
      expectedItemVersion: req.body?.expectedItemVersion,
      user: req.user,
      deleteKey,
      reason
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ success: false, message: err.message, code: err.code });
  }
});

// POST /api/inventories/sync (Safe sync endpoint - prevents ghost rehydration of deleted inventories)
router.post('/sync', authenticate, async (req, res) => {
  // Real inventory creation must be deliberate through POST /api/inventories.
  // We explicitly prevent re-injecting deleted test inventories from client caches.
  return res.json({ success: true, synced: 0, message: 'Sincronización persistente centralizada en el servidor.' });
});

module.exports = router;
