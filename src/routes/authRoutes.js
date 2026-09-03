const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate, requireRole, requireAlonso } = require('../middlewares/authMiddleware');

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña son requeridos' });
    }

    const authResult = authService.authenticate(username, password);
    res.json({
      success: true,
      message: 'Autenticación exitosa',
      ...authResult
    });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = authService.getUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  }
  res.json({ success: true, user });
});

// GET /api/auth/centers (List all 15 operational centers)
router.get('/centers', (req, res) => {
  try {
    const centers = authService.getCentersList();
    res.json({ success: true, centers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/users (Admin / Encargado)
router.get('/users', authenticate, (req, res) => {
  try {
    const users = authService.getAllUsers(req.user);
    res.json({ success: true, users });
  } catch (err) {
    res.status(403).json({ success: false, message: err.message });
  }
});

// POST /api/auth/users (Create user - Superadmin Alonso Only)
router.post('/users', authenticate, requireAlonso, (req, res) => {
  try {
    const newUser = authService.createUser(req.body, req.user);
    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/auth/users/:id (Update user - Superadmin Alonso Only)
router.put('/users/:id', authenticate, requireAlonso, (req, res) => {
  try {
    const updated = authService.updateUser(req.params.id, req.body, req.user);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/auth/users/:id (Superadmin Alonso Only)
router.delete('/users/:id', authenticate, requireAlonso, (req, res) => {
  try {
    const result = authService.deleteUser(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
