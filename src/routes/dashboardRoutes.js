const express = require('express');
const router = express.Router();
const metricsService = require('../services/metricsService');
const auditService = require('../services/auditService');
const { authenticate } = require('../middlewares/authMiddleware');

// GET /api/dashboard/metrics
router.get('/metrics', authenticate, async (req, res) => {
  try {
    let { type, center, inventoryId, period, startDate, endDate } = req.query;

    if (type === 'undefined' || type === 'null') type = 'TODOS';
    if (center === 'undefined' || center === 'null') center = 'TODOS';
    if (inventoryId === 'undefined' || inventoryId === 'null') inventoryId = 'TODOS';
    if (period === 'undefined' || period === 'null') period = 'TODO';
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;

    const data = await metricsService.getDashboardMetrics({
      type: type || 'TODOS',
      center: targetCenter || 'TODOS',
      inventoryId: inventoryId || 'TODOS',
      period: period || 'TODO',
      startDate,
      endDate
    });

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[dashboardRoutes] Error in /metrics:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/audit (Audit trail logs)
router.get('/audit', authenticate, (req, res) => {
  try {
    let { inventoryId, center, startDate, endDate, limit } = req.query;

    if (inventoryId === 'undefined' || inventoryId === 'null' || inventoryId === 'TODOS') inventoryId = null;
    if (center === 'undefined' || center === 'null') center = 'TODOS';
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;

    const logs = auditService.getAuditLogs({
      inventoryId: inventoryId || undefined,
      center: targetCenter,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : 200
    });

    res.json({ success: true, logs });
  } catch (err) {
    console.error('[dashboardRoutes] Error in /audit:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
