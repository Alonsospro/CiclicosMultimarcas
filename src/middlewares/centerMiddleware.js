const config = require('../config');

function restrictCenter(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado.' });
  }

  const requestedCenter = (req.params && req.params.center) ||
                          (req.body && req.body.center) ||
                          (req.query && req.query.center) || null;

  // Admin and Superadmin have global center access across all centers
  if (req.user.isSuperadmin || req.user.role === 'ADMIN') {
    req.targetCenter = requestedCenter;
    return next();
  }

  // Encargados and Auxiliares are strictly tied to their assigned center
  const userCenter = req.user.center;

  if (requestedCenter && requestedCenter !== 'ALL' && requestedCenter !== 'TODOS' && requestedCenter !== 'GLOBAL') {
    if (!config.isSameCenter(requestedCenter, userCenter)) {
      return res.status(403).json({
        success: false,
        message: `Acceso restringido: Su usuario pertenece al centro ${userCenter}. No puede operar ni acceder al centro ${requestedCenter}.`
      });
    }
  }

  // Force targetCenter, query.center and body.center to user's assigned center
  req.targetCenter = userCenter;
  if (req.query) req.query.center = userCenter;
  if (req.body && req.body.center) req.body.center = userCenter;
  next();
}

module.exports = {
  restrictCenter
};
