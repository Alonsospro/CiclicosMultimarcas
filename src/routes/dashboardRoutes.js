const express = require('express');
const router = express.Router();
const metricsService = require('../services/metricsService');
const inventoryTrackingService = require('../services/inventoryTrackingService');
const auditService = require('../services/auditService');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

// Aggregate scores may be visible to auxiliaries; signed quantities remain private during blind counts.
router.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = body => {
    if (req.user?.role === 'AUXILIAR' && body?.counterReliability) {
      return json({...body, counterReliability: {...body.counterReliability,
        workers: body.counterReliability.workers.map(worker => ({...worker, records: []}))}});
    }
    return json(body);
  };
  next();
});

// GET /api/dashboard/tracking — status and active workflow stage per inventory launch.
router.get('/tracking', authenticate, requireRole(['ADMIN', 'ENCARGADO']), async (req, res) => {
  try {
    const type = req.query.type || 'TODOS';
    const center = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? (req.query.center || 'TODOS') : req.user.center;
    const data = await inventoryTrackingService.getTracking({type, center, refresh:req.query.refresh === 'true' || req.query.refresh === '1'});
    res.json({success:true, ...data});
  } catch (err) {
    console.error('[dashboardRoutes] Error in /tracking:', err);
    res.status(500).json({success:false, message:err.message});
  }
});

// GET /api/dashboard/metrics
router.get('/metrics', authenticate, async (req, res) => {
  try {
    let { type, center, inventoryId, period, startDate, endDate, refresh, recalculate } = req.query;

    if (type === 'undefined' || type === 'null') type = 'TODOS';
    if (center === 'undefined' || center === 'null') center = 'TODOS';
    if (inventoryId === 'undefined' || inventoryId === 'null') inventoryId = 'TODOS';
    if (period === 'undefined' || period === 'null') period = 'TODO';
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;

    if (recalculate === 'true' || recalculate === '1') {
      const data = await metricsService.recalculateMetrics({
        type: type || 'TODOS',
        center: targetCenter || 'TODOS',
        inventoryId: inventoryId || 'TODOS',
        period: period || 'TODO',
        startDate,
        endDate,
        user: req.user
      });
      return res.json({ success: true, ...data });
    }

    if (refresh === 'true' || refresh === '1') {
      metricsService.invalidateCache();
    }

    const data = await metricsService.getDashboardMetrics({
      type: type || 'TODOS',
      center: targetCenter || 'TODOS',
      inventoryId: inventoryId || 'TODOS',
      period: period || 'TODO',
      startDate,
      endDate,
      forceRefresh: (refresh === 'true' || refresh === '1')
    });

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[dashboardRoutes] Error in /metrics:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/dashboard/recalculate (Recalculate metrics directly from Database & Google Sheets)
router.post('/recalculate', authenticate, async (req, res) => {
  try {
    let { type, center, inventoryId, period, startDate, endDate } = req.body || {};

    if (type === 'undefined' || type === 'null') type = 'TODOS';
    if (center === 'undefined' || center === 'null') center = 'TODOS';
    if (inventoryId === 'undefined' || inventoryId === 'null') inventoryId = 'TODOS';
    if (period === 'undefined' || period === 'null') period = 'TODO';
    if (startDate === 'undefined' || startDate === 'null' || startDate === '') startDate = null;
    if (endDate === 'undefined' || endDate === 'null' || endDate === '') endDate = null;

    const targetCenter = (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? center : req.user.center;

    const data = await metricsService.recalculateMetrics({
      type: type || 'TODOS',
      center: targetCenter || 'TODOS',
      inventoryId: inventoryId || 'TODOS',
      period: period || 'TODO',
      startDate,
      endDate,
      user: req.user
    });

    res.json({ success: true, message: data.metricsComplete ? 'Archivos leídos y métricas validadas' : 'Lectura terminada con archivos pendientes de validación', ...data });
  } catch (err) {
    console.error('[dashboardRoutes] Error in /recalculate:', err);
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
