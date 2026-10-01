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

// API Routes
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/inventories', require('./src/routes/inventoryRoutes'));
app.use('/api/barrido', require('./src/routes/barridoRoutes'));
app.use('/api/justifications', require('./src/routes/justificationRoutes'));
app.use('/api/history', require('./src/routes/historyRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));
app.use('/api/photos', require('./src/routes/photoRoutes'));
app.use('/api/logos', require('./src/routes/logoRoutes'));

// Health check route
app.get('/api/health', (req, res) => {
  const isVercel = !!process.env.VERCEL;
  res.json({
    status: 'online',
    appName: 'NIBOL Inventarios Cíclicos, Barrido, Semanales y Mensuales',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    storage: isVercel ? 'ephemeral' : 'persistent',
    warning: isVercel ? 'Entorno Vercel detectado: los datos almacenados en disco (inventarios, fotos, historial) son efímeros y se perderán entre deploys. Se recomienda usar un servidor persistente (VPS) para producción.' : null
  });
});

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

// Start Server
if (require.main === module) {
  const PORT = config.port || 3000;
  
  // Initialize local memory store from persistent storage
  const firebaseSyncService = require('./src/services/firebaseSyncService');
  const dailyBackupService = require('./src/services/dailyBackupService');

  firebaseSyncService.hydrateMemoryStore(storagePath.memoryStore, storagePath.cacheTimestamps, storagePath.dirListings, storagePath)
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`====================================================`);
        console.log(`🚀 SERVIDOR NIBOL INVENTARIOS ACTIVO EN PUERTO ${PORT}`);
        console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
        console.log(`🔒 Entorno: ${config.nodeEnv}`);
        console.log(`📊 Modo de Datos: CONEXIÓN DIRECTA GOOGLE APPS SCRIPT / DRIVE`);
        console.log(`💾 Almacenamiento Local: DISCO PERSISTENTE / CACHÉ ACTIVO`);
        console.log(`====================================================`);
        dailyBackupService.startScheduler();
      });
    })
    .catch(err => {
      console.error('Error inicializando memoria local:', err);
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 SERVIDOR NIBOL INVENTARIOS INICIADO.`);
        dailyBackupService.startScheduler();
      });
    });
}

module.exports = app;
