const express = require('express');
const router = express.Router();
const config = require('../config');
const metricsService = require('../services/metricsService');
const storagePath = require('../services/storagePath');
const { create } = require('../services/reportCenterService');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const reports = create({ metrics: metricsService, storage: storagePath, config });
const clean = value => (!value || value === 'undefined' || value === 'null') ? 'TODOS' : String(value);
// Center managers only see their own center.
const centerFor = (req, value) => (req.user.role === 'ADMIN' || req.user.isSuperadmin) ? clean(value) : req.user.center;
const fail = (res, err, where) => {
  console.error(`[reportRoutes] Error in ${where}:`, err);
  res.status(err.status || 500).json({ success: false, message: err.message });
};

router.use(authenticate, requireRole(['ENCARGADO']));

// GET /api/reports/catalog — periods available per report kind and their generation status
router.get('/catalog', async (req, res) => {
  try {
    res.json({ success: true, ...await reports.catalog({ type: clean(req.query.type), center: centerFor(req, req.query.center), refresh: ['1', 'true'].includes(String(req.query.refresh)) }) });
  } catch (err) { fail(res, err, '/catalog'); }
});

// GET /api/reports/build — full report for one period, compared with the previous one
router.get('/build', async (req, res) => {
  try {
    const { kind, ref, type, center } = req.query;
    res.json({ success: true, report: await reports.build({ kind, ref, type: clean(type), center: centerFor(req, center), user: req.user }) });
  } catch (err) { fail(res, err, '/build'); }
});

// GET /api/reports/log — reports generated so far
router.get('/log', (req, res) => {
  try {
    res.json({ success: true, log: reports.history({ center: centerFor(req, req.query.center) }) });
  } catch (err) { fail(res, err, '/log'); }
});

// POST /api/reports/log — registers a generated report with its indicators
router.post('/log', (req, res) => {
  try {
    const body = req.body || {};
    const entry = reports.record({ ...body, center: centerFor(req, body.center), type: clean(body.type) }, req.user);
    res.json({ success: true, entry });
  } catch (err) { fail(res, err, 'POST /log'); }
});

module.exports = router;
