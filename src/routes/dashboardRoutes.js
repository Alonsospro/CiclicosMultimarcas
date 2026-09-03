const express = require('express');
const router = express.Router();
const metricsService = require('../services/metricsService');
const auditService = require('../services/auditService');
const { authenticate } = require('../middlewares/authMiddleware');

// GET /api/dashboard/metrics
router.get('/metrics', authenticate, (req, res) => {
  try {
    const { type, center, inventoryId, period, startDate, endDate } = req.query;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;

    const data = metricsService.getDashboardMetrics({
      type: type || 'TODOS',
      center: targetCenter || 'TODOS',
      inventoryId: inventoryId || 'TODOS',
      period: period || 'TODO',
      startDate,
      endDate
    });

    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/dashboard/audit (Audit trail logs)
router.get('/audit', authenticate, (req, res) => {
  try {
    const { inventoryId, center, startDate, endDate, limit } = req.query;
    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;

    const logs = auditService.getAuditLogs({
      inventoryId,
      center: targetCenter,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : 200
    });

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
