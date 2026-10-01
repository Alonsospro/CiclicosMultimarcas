const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const storagePath = require('./storagePath');

// Pre-load bundled users so NFT bundles users.json and cold-start uses it instantly
let bundledUsers = null;
try {
  bundledUsers = require('../../data/users.json');
} catch (e) {
  bundledUsers = null;
}

const OFFICIAL_USERS_RAW = [
  // Centro: Volvo - Km 14 (1120)
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Isaias Burgos Arandia', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'IA2351', usuario: 'Isaias' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Ignacio Suarez Justiniano', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'IJ6508', usuario: 'Ignacio' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Brayan Balderrama', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'BB3078', usuario: 'Brayan' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Wenderson Da silva', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'WS8386', usuario: 'Wenderson' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Guillermo López Jaillita', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'GJ5408', usuario: 'Guillermo' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Reynaldo Aguilar', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'RA6326', usuario: 'Reynaldo' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Juan Gabriel Gutiérrez Méndez', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JM1114', usuario: 'Gabriel' },
  { center: '1120', centerName: 'Volvo - Km 14', name: 'Abraham Edson Quispe Flores', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'AF3090', usuario: 'Abraham' },

  // Centro: Av. Banzer 3er anillo (1160)
  { center: '1160', centerName: 'Av. Banzer 3er anillo', name: 'Jimmy Jairo Cortez', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'JC0160', usuario: 'Jimmy' },
  { center: '1160', centerName: 'Av. Banzer 3er anillo', name: 'Diego Rodrigo Ramos Ibarra', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'DI4741', usuario: 'Rodrigo' },

  // Centro: Foton - Km 10 (1180)
  { center: '1180', centerName: 'Foton - Km 10', name: 'Gustavo Dominguez', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'GD9500', usuario: 'Gustavo' },
  { center: '1180', centerName: 'Foton - Km 10', name: 'Ismael Aguilar', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'IA4389', usuario: 'Ismael' },
  { center: '1180', centerName: 'Foton - Km 10', name: 'Miguel Duarte', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'MD7146', usuario: 'Miguel' },

  // Centro: John Deere - Km 10 (1300)
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Javier Eduardo López', cargo: 'Encargado de Almacen', role: 'ENCARGADO', clave: 'JL8764', usuario: 'Javier' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Jose Manuel Duran', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JD7094', usuario: 'Manuel' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Samir Rivas', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'SR8486', usuario: 'Samir' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Jorge Eduardo Rios', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JR0210', usuario: 'Eduardo' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Fernando Pinto', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'FP3189', usuario: 'Fernando2' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Erick Morales', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'EM5962', usuario: 'Morales' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Yamil Cadima', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'YC8095', usuario: 'Yamil' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Bladimir Avalos', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'BA0856', usuario: 'Bladimir' },
  { center: '1300', centerName: 'John Deere - Km 10', name: 'Luis Fernando Torrico', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'LT3970', usuario: 'Fernando' },

  // Centro: Sucursal Montero (1310)
  { center: '1310', centerName: 'Sucursal Montero', name: 'David Sanchez', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'DS4645', usuario: 'David' },
  { center: '1310', centerName: 'Sucursal Montero', name: 'Jose Sandro Duran', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JD4349', usuario: 'Sandro' },

  // Centro: Sucursal Cuatro Cañadas (1340)
  { center: '1340', centerName: 'Sucursal Cuatro Cañadas', name: 'Darwin Vega', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'DV3728', usuario: 'Darwin' },
  { center: '1340', centerName: 'Sucursal Cuatro Cañadas', name: 'Jhon Russell Rojas Salvatierra', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JS7102', usuario: 'Jhon' },

  // Centro: Av. Grigota 3er anillo (1700)
  { center: '1700', centerName: 'Av. Grigota 3er anillo', name: 'Dionel Perez', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'DP9318', usuario: 'Dionel' },
  { center: '1700', centerName: 'Av. Grigota 3er anillo', name: 'German Mendez', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'GM5157', usuario: 'German' },

  // Centro: Express San Julián (1800)
  { center: '1800', centerName: 'Express San Julián', name: 'Erick Padilla', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'EP5811', usuario: 'Padilla' },

  // Centro: Express San Pedro (1820)
  { center: '1820', centerName: 'Express San Pedro', name: 'Luis Miguel Bustamante', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'LB4522', usuario: 'Bustamante' },

  // Centro: Sucursal El Alto, La Paz (2100)
  { center: '2100', centerName: 'Sucursal El Alto, La Paz', name: 'Hugo Aramayo', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'HA5303', usuario: 'Hugo' },
  { center: '2100', centerName: 'Sucursal El Alto, La Paz', name: 'Walter Ruiz', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'WR5483', usuario: 'Walter' },
  { center: '2100', centerName: 'Sucursal El Alto, La Paz', name: 'Jise Simon condori Roca', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JR7182', usuario: 'Jise' },

  // Centro: Centro Foton El Alto, La Paz (2150)
  { center: '2150', centerName: 'Centro Foton El Alto, La Paz', name: 'Marco Nina', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'MN4410', usuario: 'Marco' },
  { center: '2150', centerName: 'Centro Foton El Alto, La Paz', name: 'Alem Fabian Calamani Quispe', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'AQ8037', usuario: 'Alem' },

  // Centro: Sucursal Cochabamba (3100)
  { center: '3100', centerName: 'Sucursal Cochabamba', name: 'Edgar Barrionuevo', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'EB6152', usuario: 'Edgar' },
  { center: '3100', centerName: 'Sucursal Cochabamba', name: 'Jonathan Ferrufino Carrasco', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'JC6954', usuario: 'Jonathan' },
  { center: '3100', centerName: 'Sucursal Cochabamba', name: 'Diego Zurita Tejerina', cargo: 'Auxiliar de Almacén', role: 'AUXILIAR', clave: 'DT0876', usuario: 'Zurita' },

  // Centro: Centro Foton Blanco Galindo (3200)
  { center: '3200', centerName: 'Centro Foton Blanco Galindo', name: 'Brigham Jared Perez', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'BP8043', usuario: 'Brigham' },

  // Centro: Sucursal Tarija (5100)
  { center: '5100', centerName: 'Sucursal Tarija', name: 'Jose Renan Chavarria', cargo: 'Encargado de Almacén', role: 'ENCARGADO', clave: 'JC5181', usuario: 'Renan' },

  // Usuarios Administrativos y Superadmin
  {
    center: 'GLOBAL',
    centerName: 'Global',
    name: 'Absael Antelo',
    cargo: 'ADMINISTRADOR',
    role: 'ADMIN',
    clave: 'ABS',
    usuario: 'Absael',
    isSuperadmin: false,
    permissions: {
      createInventory: true,
      deleteSnapshots: false,
      manageUsers: false,
      exportReports: true,
      recalculateMetrics: true,
      manageJustifications: true,
      viewAllCenters: true
    },
    allowedCenters: ['GLOBAL'],
    allowedViews: ['dashboard', 'history', 'justifications', 'assignments', 'inventories', 'barrido']
  },
  {
    center: 'GLOBAL',
    centerName: 'Global',
    name: 'Juan Carlos',
    cargo: 'ADMINISTRADOR',
    role: 'ADMIN',
    clave: 'JCS',
    usuario: 'Jcarlos',
    isSuperadmin: false,
    permissions: {
      createInventory: true,
      deleteSnapshots: false,
      manageUsers: false,
      exportReports: true,
      recalculateMetrics: true,
      manageJustifications: true,
      viewAllCenters: true
    },
    allowedCenters: ['GLOBAL'],
    allowedViews: ['dashboard', 'history', 'justifications', 'assignments', 'inventories', 'barrido']
  },
  {
    center: 'GLOBAL',
    centerName: 'Global',
    name: 'Alonso Rios',
    cargo: 'SUPERADMIN',
    role: 'ADMIN',
    clave: 'ADM',
    usuario: 'Alonso',
    email: 'alonsospro@gmail.com',
    isSuperadmin: true,
    permissions: {
      createInventory: true,
      deleteSnapshots: true,
      manageUsers: true,
      exportReports: true,
      recalculateMetrics: true,
      manageJustifications: true,
      viewAllCenters: true
    },
    allowedCenters: ['GLOBAL'],
    allowedViews: ['dashboard', 'history', 'justifications', 'assignments', 'inventories', 'barrido', 'users']
  }
];

class AuthService {
  constructor() {
    this.usersFile = storagePath.getUsersFilePath();
    this.usersCache = null;
    this.initUsers();
  }

  initUsers() {
    const existing = storagePath.readJson(this.usersFile, null);
    if (Array.isArray(existing) && existing.length > 0) {
      const alonso = existing.find(u => u.username && u.username.toLowerCase() === 'alonso');
      if (alonso && !alonso.email) alonso.email = 'alonsospro@gmail.com';
      
      this.usersCache = existing;
      return existing;
    }
    // In serverless or on first run, use pre-bundled pre-hashed users instantly
    if (Array.isArray(bundledUsers) && bundledUsers.length > 0) {
      const alonso = bundledUsers.find(u => u.username && u.username.toLowerCase() === 'alonso');
      if (alonso && !alonso.email) alonso.email = 'alonsospro@gmail.com';
      this.usersCache = bundledUsers;
      try {
        storagePath.writeJson(this.usersFile, bundledUsers);
      } catch (e) {}
      return bundledUsers;
    }
    return this.seedDefaultUsers(true);
  }

  seedDefaultUsers(force = false) {
    let currentUsers = storagePath.readJson(this.usersFile, []);
    const salt = bcrypt.genSaltSync(10);

    const userMap = new Map();
    if (Array.isArray(currentUsers) && !force) {
      currentUsers.forEach(u => {
        if (u && u.username) {
          userMap.set(u.username.toLowerCase(), u);
          if (u.clave) userMap.set(u.clave.toLowerCase(), u);
        }
      });
    }

    const officialSeeded = OFFICIAL_USERS_RAW.map(item => {
      const usernameKey = item.usuario.toLowerCase();
      const existing = userMap.get(usernameKey) || userMap.get(item.clave.toLowerCase());

      const passwordToHash = item.clave;
      const hash = bcrypt.hashSync(passwordToHash, salt);

      const isSup = !!item.isSuperadmin;
      const isAdm = item.role === 'ADMIN';

      return {
        id: existing?.id || (item.isSuperadmin ? 'USR-SUPERADMIN-ALONSO' : `USR-${item.center}-${item.usuario}`),
        username: existing?.username || item.usuario,
        displayName: existing?.displayName || item.name,
        cargo: existing?.cargo || item.cargo,
        role: existing?.role || item.role,
        center: existing?.center || item.center,
        centerName: existing?.centerName || item.centerName,
        clave: item.clave,
        email: item.email || (item.usuario.toLowerCase() === 'alonso' ? 'alonsospro@gmail.com' : `${item.usuario.toLowerCase()}@nibol.com.bo`),
        isSuperadmin: isSup,
        permissions: existing?.permissions || item.permissions || {
          createInventory: isSup || isAdm,
          deleteSnapshots: isSup,
          manageUsers: isSup,
          exportReports: isSup || isAdm || item.role === 'ENCARGADO',
          recalculateMetrics: isSup || isAdm,
          manageJustifications: isSup || isAdm || item.role === 'ENCARGADO',
          viewAllCenters: isSup || isAdm
        },
        allowedCenters: existing?.allowedCenters || item.allowedCenters || [item.center || 'GLOBAL'],
        allowedViews: existing?.allowedViews || item.allowedViews || (
          isSup ? ['dashboard', 'history', 'justifications', 'assignments', 'inventories', 'barrido', 'users'] :
          isAdm ? ['dashboard', 'history', 'justifications', 'assignments', 'inventories', 'barrido'] :
          item.role === 'ENCARGADO' ? ['inventories', 'count', 'barrido', 'assignments', 'justifications', 'history', 'dashboard'] :
          ['inventories', 'count', 'barrido']
        ),
        passwordHash: hash,
        createdAt: existing?.createdAt || new Date().toISOString(),
        active: true
      };
    });

    // Also include legacy / test helper users for backward compatibility with existing tests
    const legacyHelpers = [
      {
        id: 'USR-ADMIN-GLOBAL',
        username: 'admin',
        displayName: 'Administrador General',
        cargo: 'ADMINISTRADOR',
        role: 'ADMIN',
        center: 'GLOBAL',
        centerName: 'Global',
        clave: 'admin.nibol2026',
        isSuperadmin: false,
        passwordHash: bcrypt.hashSync('admin.nibol2026', salt),
        createdAt: new Date().toISOString(),
        active: true
      },
      {
        id: 'USR-ENC-WARNES',
        username: 'encargado_warnes',
        displayName: 'Encargado Warnes (Test)',
        cargo: 'Encargado de Almacén',
        role: 'ENCARGADO',
        center: 'WARNES',
        centerName: 'Warnes',
        clave: 'warnes2026',
        isSuperadmin: false,
        passwordHash: bcrypt.hashSync('warnes2026', salt),
        createdAt: new Date().toISOString(),
        active: true
      },
      {
        id: 'USR-AUX-WARNES-1',
        username: 'auxiliar_warnes',
        displayName: 'Carlos Pérez (Auxiliar Warnes)',
        cargo: 'Auxiliar de Almacén',
        role: 'AUXILIAR',
        center: 'WARNES',
        centerName: 'Warnes',
        clave: 'auxiliar2026',
        isSuperadmin: false,
        passwordHash: bcrypt.hashSync('auxiliar2026', salt),
        createdAt: new Date().toISOString(),
        active: true
      },
      {
        id: 'USR-AUX-WARNES-2',
        username: 'auxiliar_warnes2',
        displayName: 'Jorge Medina (Auxiliar Warnes 2)',
        cargo: 'Auxiliar de Almacén',
        role: 'AUXILIAR',
        center: 'WARNES',
        centerName: 'Warnes',
        clave: 'auxiliar2026',
        isSuperadmin: false,
        passwordHash: bcrypt.hashSync('auxiliar2026', salt),
        createdAt: new Date().toISOString(),
        active: true
      },
      {
        id: 'USR-ENC-CENTRAL',
        username: 'encargado_central',
        displayName: 'Encargado Central',
        cargo: 'Encargado de Almacén',
        role: 'ENCARGADO',
        center: 'CENTRAL',
        centerName: 'Central',
        clave: 'central2026',
        isSuperadmin: false,
        passwordHash: bcrypt.hashSync('central2026', salt),
        createdAt: new Date().toISOString(),
        active: true
      },
      {
        id: 'USR-AUX-CENTRAL-1',
        username: 'auxiliar_central',
        displayName: 'Roberto Siles (Auxiliar Central)',
        cargo: 'Auxiliar de Almacén',
        role: 'AUXILIAR',
        center: 'CENTRAL',
        centerName: 'Central',
        clave: 'auxiliar2026',
        isSuperadmin: false,
        passwordHash: bcrypt.hashSync('auxiliar2026', salt),
        createdAt: new Date().toISOString(),
        active: true
      }
    ];

    const finalUsers = [...officialSeeded];
    legacyHelpers.forEach(leg => {
      if (!finalUsers.some(u => u.username.toLowerCase() === leg.username.toLowerCase())) {
        finalUsers.push(leg);
      }
    });

    this.usersCache = finalUsers;
    storagePath.writeJson(this.usersFile, finalUsers);
    console.log(`[authService] Seeded ${finalUsers.length} users (${officialSeeded.length} official table users).`);
    return finalUsers;
  }

  getUsersList() {
    if (this.usersCache && this.usersCache.length > 0) {
      return this.usersCache;
    }
    const fromDisk = storagePath.readJson(this.usersFile, []);
    if (Array.isArray(fromDisk) && fromDisk.length > 0) {
      this.usersCache = fromDisk;
      return this.usersCache;
    }
    return this.seedDefaultUsers(false);
  }

  saveUsersList(users) {
    this.usersCache = users;
    storagePath.writeJson(this.usersFile, users);
  }

  getCentersList() {
    return config.centersList || [];
  }

  authenticate(usernameOrIdentifier, password) {
    if (!usernameOrIdentifier || !password) {
      throw new Error('Debe proporcionar usuario y contraseña');
    }

    const cleanInput = String(usernameOrIdentifier).trim();
    const cleanInputLower = cleanInput.toLowerCase();
    const stripAccents = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const cleanInputNoAccents = stripAccents(cleanInput);

    const users = this.getUsersList();

    const user = users.find(u => {
      if (u.active === false) return false;
      const uUsername = (u.username || '').toLowerCase();
      const uClave = (u.clave || '').toLowerCase();
      const uDisplayName = (u.displayName || '').toLowerCase();
      const uDisplayNameNoAcc = stripAccents(u.displayName);
      const uId = (u.id || '').toLowerCase();
      const uEmail = (u.email || '').toLowerCase();

      const matchUsername = uUsername === cleanInputLower || stripAccents(u.username) === cleanInputNoAccents;
      const matchClave = uClave === cleanInputLower;
      const matchDisplayName = uDisplayName === cleanInputLower || uDisplayNameNoAcc === cleanInputNoAccents;
      const matchId = uId === cleanInputLower;
      const matchEmail = uEmail === cleanInputLower;
      const matchAlonso = (cleanInputLower === 'alonsospro@gmail.com' || cleanInputLower === 'alonsospro' || cleanInputLower === 'alonso') && (u.isSuperadmin || uUsername === 'alonso');

      return matchUsername || matchClave || matchDisplayName || matchId || matchEmail || matchAlonso;
    });

    if (!user) {
      throw new Error('Credenciales inválidas o usuario inactivo');
    }

    const cleanPassword = String(password).trim();
    let isMatch = false;

    // 1. Verificación con bcrypt (tal cual, en mayúsculas y minúsculas)
    try {
      if (user.passwordHash) {
        isMatch = bcrypt.compareSync(cleanPassword, user.passwordHash) ||
                  bcrypt.compareSync(cleanPassword.toUpperCase(), user.passwordHash) ||
                  bcrypt.compareSync(cleanPassword.toLowerCase(), user.passwordHash);
      }
    } catch (e) {
      isMatch = false;
    }

    // 2. Verificación contra user.clave (sensible e insensible a mayúsculas/minúsculas)
    if (!isMatch && user.clave) {
      const uClave = String(user.clave).trim();
      if (cleanPassword === uClave ||
          cleanPassword.toUpperCase() === uClave.toUpperCase() ||
          cleanPassword.toLowerCase() === uClave.toLowerCase()) {
        isMatch = true;
      }
    }

    // 3. Verificación si la contraseña coincide con el username
    if (!isMatch && user.username) {
      if (cleanPassword.toLowerCase() === String(user.username).trim().toLowerCase()) {
        isMatch = true;
      }
    }

    // 4. Fallback especial para Superadmin Alonso
    if (!isMatch && (user.isSuperadmin || (user.username && user.username.toUpperCase() === 'ALONSO') || (user.email && user.email.toLowerCase() === 'alonsospro@gmail.com'))) {
      const allowedAlonso = [
        'adm', 'alonso.superadmin2026', 'admin.nibol2026', 'admin', 'alonsospro', 'alonsospro@gmail.com', 'alonso', '123456', 'nibol2026'
      ];
      if (allowedAlonso.includes(cleanPassword.toLowerCase()) || allowedAlonso.includes(cleanPassword)) {
        isMatch = true;
      }
    }

    // 5. Fallback para Admin general
    if (!isMatch && (user.username && user.username.toLowerCase() === 'admin')) {
      const allowedAdmin = ['admin', 'admin.nibol2026', 'nibol2026'];
      if (allowedAdmin.includes(cleanPassword.toLowerCase())) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      throw new Error('Credenciales inválidas o usuario inactivo');
    }

    const token = this.generateToken(user);
    const sanitizedUser = this.sanitizeUser(user);

    return {
      token,
      user: sanitizedUser
    };
  }

  generateToken(user) {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        center: user.center,
        centerName: user.centerName || '',
        displayName: user.displayName || user.username,
        cargo: user.cargo || '',
        clave: user.clave || '',
        isSuperadmin: !!user.isSuperadmin,
        permissions: user.permissions || {},
        allowedCenters: user.allowedCenters || [user.center || 'GLOBAL'],
        allowedViews: user.allowedViews || []
      },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch (err) {
      return null;
    }
  }

  getUserById(userId) {
    const users = this.getUsersList();
    const found = users.find(u => u.id === userId);
    return found ? this.sanitizeUser(found) : null;
  }

  getUserByUsername(username) {
    const users = this.getUsersList();
    const clean = String(username).trim().toLowerCase();
    const found = users.find(u =>
      (u.username && u.username.toLowerCase() === clean) ||
      (u.clave && u.clave.toLowerCase() === clean)
    );
    return found ? this.sanitizeUser(found) : null;
  }

  sanitizeUser(user) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  isAlonso(user) {
    if (!user) return false;
    if (user.isSuperadmin) return true;
    const u = String(user.username || '').toLowerCase().trim();
    const d = String(user.displayName || '').toLowerCase().trim();
    return u === 'alonso' || d.includes('alonso rios') || user.clave === 'ADM';
  }

  isTargetAdmin(user) {
    if (!user) return false;
    const u = String(user.username || user.usuario || '').toLowerCase().trim();
    const d = String(user.displayName || user.name || '').toLowerCase().trim();
    return u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'absael' ||
           d.includes('juan carlos') || d.includes('absael') || user.clave === 'JCS' || user.clave === 'ABS';
  }

  canManageUsers(user) {
    if (!user) return false;
    if (this.isAlonso(user) || this.isTargetAdmin(user)) return true;
    return !!(user.permissions && user.permissions.manageUsers === true);
  }

  getAllUsers(requestingUser) {
    const users = this.getUsersList();
    let filtered = users;

    if (requestingUser.role === 'ADMIN' || requestingUser.isSuperadmin || this.canManageUsers(requestingUser)) {
      filtered = users;
    } else if (requestingUser.role === 'ENCARGADO') {
      // Encargado only sees users in their own operational center (excluding global admins)
      filtered = users.filter(u => {
        if (!u.center || String(u.center).toUpperCase() === 'GLOBAL') return false;
        return config.isSameCenter(u.center, requestingUser.center);
      });
    } else {
      // Auxiliar cannot view user lists
      return [];
    }

    return filtered.map(u => this.sanitizeUser(u));
  }

  createUser(userData, requestingUser) {
    if (!this.canManageUsers(requestingUser)) {
      throw new Error('Acceso denegado: Requiere privilegios de administración (Alonso, Juan Carlos, Absael o Administrador autorizado) para crear nuevos usuarios.');
    }

    const { username, password, displayName, role, center, cargo } = userData;
    if (!username || !password || !role) {
      throw new Error('Faltan campos obligatorios (username, password, role)');
    }

    const targetCenter = center || 'GLOBAL';
    const targetRole = role;

    const users = this.getUsersList();
    const exists = users.some(u =>
      u.username.toLowerCase() === username.toLowerCase() ||
      (u.clave && u.clave.toLowerCase() === username.toLowerCase())
    );

    if (exists) {
      throw new Error(`El usuario con identificador '${username}' ya existe`);
    }

    const centerObj = config.findCenter(targetCenter);
    const salt = bcrypt.genSaltSync(10);
    const newUser = {
      id: 'USR-' + targetCenter + '-' + Date.now().toString(36).toUpperCase(),
      username: username.trim(),
      displayName: (displayName || username).trim(),
      cargo: cargo || (targetRole === 'ENCARGADO' ? 'Encargado de Almacén' : (targetRole === 'ADMIN' ? 'ADMINISTRADOR' : 'Auxiliar de Almacén')),
      role: targetRole,
      center: targetCenter,
      centerName: centerObj ? centerObj.name : targetCenter,
      clave: password.trim(),
      isSuperadmin: false,
      passwordHash: bcrypt.hashSync(password.trim(), salt),
      createdAt: new Date().toISOString(),
      active: true
    };

    users.push(newUser);
    this.saveUsersList(users);

    return this.sanitizeUser(newUser);
  }

  updateUser(userId, updateData, requestingUser) {
    if (!this.canManageUsers(requestingUser)) {
      throw new Error('Acceso denegado: Requiere privilegios de administración (Alonso, Juan Carlos, Absael o Administrador autorizado) para modificar usuarios.');
    }

    const users = this.getUsersList();
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
      throw new Error('Usuario no encontrado');
    }

    const target = users[userIndex];

    if ((target.isSuperadmin || target.username.toUpperCase() === 'ALONSO' || target.clave === 'ADM') && !this.isAlonso(requestingUser)) {
      throw new Error('Acceso restringido: Solo el superadministrador principal Alonso puede modificar los privilegios de su propia cuenta.');
    }

    if (updateData.displayName) target.displayName = updateData.displayName.trim();
    if (updateData.cargo) target.cargo = updateData.cargo.trim();
    if (updateData.password && updateData.password.trim().length >= 3) {
      const salt = bcrypt.genSaltSync(10);
      target.clave = updateData.password.trim();
      target.passwordHash = bcrypt.hashSync(updateData.password.trim(), salt);
    }

    if (updateData.role) target.role = updateData.role;
    if (updateData.center) {
      target.center = updateData.center;
      const cObj = config.findCenter(updateData.center);
      target.centerName = cObj ? cObj.name : updateData.center;
      // Sincronizar allowedCenters si estaba asignado a un centro puntual
      if (!Array.isArray(target.allowedCenters) || target.allowedCenters.length === 0 || (target.allowedCenters.length === 1 && target.allowedCenters[0] !== 'GLOBAL')) {
        target.allowedCenters = [updateData.center];
      }
    }
    if (typeof updateData.active === 'boolean') target.active = updateData.active;

    // Actualización de permisos y accesos específicos de usuario/administrador
    if (updateData.permissions && typeof updateData.permissions === 'object') {
      target.permissions = {
        ...(target.permissions || {}),
        ...updateData.permissions
      };
    }
    if (Array.isArray(updateData.allowedCenters)) {
      target.allowedCenters = updateData.allowedCenters;
    }
    if (Array.isArray(updateData.allowedViews)) {
      target.allowedViews = updateData.allowedViews;
    }

    users[userIndex] = target;
    this.saveUsersList(users);

    return this.sanitizeUser(target);
  }

  deleteUser(userId, requestingUser) {
    if (!this.canManageUsers(requestingUser)) {
      throw new Error('Acceso denegado: Requiere permisos de administración para eliminar usuarios.');
    }

    const users = this.getUsersList();
    const target = users.find(u => u.id === userId);
    if (!target) {
      throw new Error('Usuario no encontrado');
    }

    if (target.isSuperadmin || target.username.toUpperCase() === 'ALONSO' || target.clave === 'ADM') {
      throw new Error('No se puede eliminar al usuario Superadministrador principal');
    }

    const updated = users.filter(u => u.id !== userId);
    this.saveUsersList(updated);
    return { success: true, message: `Usuario ${target.displayName || target.username} eliminado` };
  }
}

module.exports = new AuthService();
