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
  const u = String(user.username || user.usuario || '').toLowerCase().trim();
  const d = String(user.displayName || user.name || '').toLowerCase().trim();
  const email = String(user.email || '').toLowerCase().trim();
  return u === 'alonso' || d.includes('alonso') || email === 'alonsospro@gmail.com' || (user.isSuperadmin && u === 'alonso');
}

function canCreateInventory(user) {
  if (!user) return false;
  if (user.isSuperadmin) return true;
  if (user.permissions && typeof user.permissions.createInventory === 'boolean') {
    return user.permissions.createInventory;
  }
  if (user.role === 'ADMIN' || user.role === 'ENCARGADO') return true;
  if (isAlonso(user)) return true;
  const u = String(user.username || '').toLowerCase().trim();
  const d = String(user.displayName || '').toLowerCase().trim();
  return u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'absael' || d.includes('juan carlos') || d.includes('absael') || user.clave === 'JCS' || user.clave === 'ABS';
}

function canManageUsers(user) {
  if (!user) return false;
  if (user.isSuperadmin || isAlonso(user)) return true;
  const u = String(user.username || user.usuario || '').toLowerCase().trim();
  const d = String(user.displayName || user.name || '').toLowerCase().trim();
  if (u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'absael' ||
      d.includes('juan carlos') || d.includes('absael') || user.clave === 'JCS' || user.clave === 'ABS') {
    return true;
  }
  return user.permissions && user.permissions.manageUsers === true;
}

function canDeleteSnapshots(user) {
  if (!user) return false;
  if (user.isSuperadmin || isAlonso(user)) return true;
  const u = String(user.username || user.usuario || '').toLowerCase().trim();
  const d = String(user.displayName || user.name || '').toLowerCase().trim();
  if (u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'absael' ||
      d.includes('juan carlos') || d.includes('absael') || user.clave === 'JCS' || user.clave === 'ABS') {
    return true;
  }
  return user.permissions && user.permissions.deleteSnapshots === true;
}

function requireAlonso(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado.' });
  }

  if (isAlonso(req.user) || canManageUsers(req.user)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Acceso denegado: Esta acción está reservada exclusivamente para administradores con permisos de gestión.'
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
    message: 'Acceso denegado: No cuenta con permisos para crear o aperturar inventarios.'
  });
}

module.exports = {
  authenticate,
  requireRole,
  requireAlonso,
  requireInventoryCreator,
  isAlonso,
  canCreateInventory,
  canManageUsers,
  canDeleteSnapshots
};
