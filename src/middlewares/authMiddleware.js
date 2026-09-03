const authService = require('../services/authService');

function authenticate(req, res, next) {
  let token = null;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Acceso no autorizado. Se requiere inicio de sesión.'
    });
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      success: false,
      message: 'Sesión expirada o token inválido.'
    });
  }

  req.user = payload;
  next();
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado.'
      });
    }

    if (req.user.isSuperadmin || req.user.role === 'ADMIN') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado. Se requiere uno de los roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

function isAlonso(user) {
  if (!user) return false;
  if (user.isSuperadmin) return true;
  const u = String(user.username || '').toLowerCase().trim();
  const d = String(user.displayName || '').toLowerCase().trim();
  return u === 'alonso' || d.includes('alonso rios') || user.clave === 'ADM';
}

function canCreateInventory(user) {
  if (!user) return false;
  if (isAlonso(user)) return true;
  const u = String(user.username || '').toLowerCase().trim();
  const d = String(user.displayName || '').toLowerCase().trim();
  return u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'juan_carlos' || u === 'juan.carlos' || d.includes('juan carlos') || user.clave === 'JCS';
}

function requireAlonso(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado.' });
  }

  if (isAlonso(req.user)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Acceso denegado: Solo el superadministrador Alonso tiene permisos para gestionar y crear usuarios.'
  });
}

function requireInventoryCreator(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado.' });
  }

  if (canCreateInventory(req.user)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Acceso denegado: Solo Juan Carlos y Alonso están autorizados para crear nuevos inventarios.'
  });
}

module.exports = {
  authenticate,
  requireRole,
  requireAlonso,
  requireInventoryCreator,
  isAlonso,
  canCreateInventory
};
