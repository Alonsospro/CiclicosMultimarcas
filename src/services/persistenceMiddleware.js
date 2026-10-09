// Serialize local work and commit all JSON mutations before confirming an API response.
function createPersistenceMiddleware(storage, cloud) {
  let tail = Promise.resolve();
  function exclusive(work) {
    const task = tail.then(work, work);
    tail = task.catch(() => {});
    return task;
  }
  async function prepare() {
    await cloud.flush();
    await storage.refreshFromCloud();
    cloud.deferWrites = true;
  }
  async function rollback() {
    cloud.pending.clear();
    await storage.refreshFromCloud(true);
  }
  const middleware = (req, res, next) => {
    exclusive(async () => {
      try { await prepare(); }
      catch (error) {
        return res.status(error.status || 503).json({ success: false, code: error.code || 'PERSISTENCE_UNAVAILABLE', message: 'No se pudo verificar Firestore. Intenta nuevamente.', detail: error.status ? error.message : undefined });
      }
      await new Promise(resolve => {
        const originalSend = res.send.bind(res);
        let responding = false;
        res.once('finish', () => { if (!responding) resolve(); });
        res.send = function (body) {
          if (responding) return res;
          responding = true;
          (async () => {
            try {
              if (res.statusCode >= 400) await rollback();
              else await cloud.flush();
              res.send = originalSend;
              if (!res.destroyed) originalSend(body);
            } catch (error) {
              console.error('[persistence] Request not committed:', error.code || error.message);
              try { await rollback(); } catch (_) { cloud.state = null; }
              res.send = originalSend;
              res.removeHeader('Content-Length');
              if (!res.destroyed) res.status(error.status || 503).json({ success: false, code: error.code || 'PERSISTENCE_UNAVAILABLE', message: error.status ? error.message : 'Firestore no confirmó el guardado. Actualiza la vista antes de intentar nuevamente.' });
            } finally { resolve(); }
          })();
          return res;
        };
        next();
      });
    }).catch(error => {
      console.error('[persistence] Request failed:', error.code || error.message);
      if (!res.headersSent && !res.destroyed) res.status(503).json({ success: false, message: 'Conexión con Firestore no disponible.' });
    });
  };
  middleware.runExclusive = work => exclusive(async () => {
    await prepare();
    try { const result = await work(); await cloud.flush(); return result; }
    catch (error) { await rollback(); throw error; }
  });
  return middleware;
}
module.exports = createPersistenceMiddleware;
