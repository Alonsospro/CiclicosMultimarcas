const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcryptjs');

// Loads the real authService with storage and config stubbed, so no Firestore connection is opened.
function authService(users) {
  const file = name => path.join(__dirname, '../src', name + '.js');
  const service = file('services/authService');
  const stubs = {[file('services/storagePath')]: {getUsersFilePath: () => '/users.json', readJson: () => users},
    [file('config/index')]: {jwtSecret: 'test-secret', centersList: []}};
  delete require.cache[service];
  for (const [name, exports] of Object.entries(stubs)) require.cache[name] = {id: name, filename: name, loaded: true, exports};
  try { return require(service); }
  finally { for (const name of [service, ...Object.keys(stubs)]) delete require.cache[name]; }
}

const alonso = {id: 'USR-SUPERADMIN-ALONSO', username: 'Alonso', displayName: 'Alonso Rios', email: 'alonsospro@gmail.com',
  role: 'ADMIN', isSuperadmin: true, clave: 'ADM', passwordHash: bcrypt.hashSync('Nueva-Clave-Segura-2026', 4), active: true};

test('Alonso no longer logs in with the old fixed passwords', () => {
  const auth = authService([alonso]);
  for (const password of ['123456', 'admin', 'alonso.superadmin2026', 'admin.nibol2026', 'alonsospro', 'nibol2026', 'alonsospro@gmail.com'])
    assert.throws(() => auth.authenticate('Alonso', password), /Credenciales inválidas/, password);
});

test('Alonso logs in with the password stored as a bcrypt hash', () => {
  const auth = authService([alonso]);
  assert.equal(auth.authenticate('alonsospro@gmail.com', 'Nueva-Clave-Segura-2026').user.username, 'Alonso');
});
