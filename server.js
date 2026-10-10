const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const storagePath = require('./src/services/storagePath');

// Initialize Express app
const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

const cloud = require('./src/services/firebaseSyncService');
const persistence = require('./src/services/persistenceMiddleware')(storagePath, cloud);
app.get('/api/health', async (req, res) => {
  try {
    await cloud.adapter.readControl();
    res.json({ status: 'online', storage: 'firestore', databaseId: cloud.databaseId, version: '2.0.0', revision: process.env.K_REVISION || 'local', timestamp: new Date().toISOString() });
  } catch (_) { res.status(503).json({ status: 'unavailable', storage: 'firestore', version: '2.0.0' }); }
});
app.post('/api/photos/upload', require('./src/middlewares/photoUploadMiddleware'));
app.use('/api', persistence);

// API Routes
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/inventories', require('./src/routes/inventoryRoutes'));
app.use('/api/barrido', require('./src/routes/barridoRoutes'));
app.use('/api/justifications', require('./src/routes/justificationRoutes'));
app.use('/api/history', require('./src/routes/historyRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));
app.use('/api/photos', require('./src/routes/photoRoutes'));
app.use('/api/logos', require('./src/routes/logoRoutes'));

// Single Page Application (SPA) fallback
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    return res.status(200).send('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=/index.html"></head><body>NIBOL Inventarios API Online</body></html>');
  }
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: `Endpoint no encontrado: ${req.method} ${req.path}` });
  }
  next();
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Error interno del servidor'
  });
});

// HTTP starts promptly for Cloud Run; API readiness is verified against Firestore on every request.
if (require.main === module) {
  const PORT = config.port || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('[server] Listening; authoritative database:', cloud.databaseId);
    const backups = require('./src/services/dailyBackupService');
    backups.startScheduler(work => persistence.runExclusive(work));
  });
}
module.exports = app;
