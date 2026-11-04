const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { canViewProgress, requireProgressAccess } = require('../src/middlewares/authMiddleware');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const JUAN_CARLOS = { username: 'Jcarlos', displayName: 'Juan Carlos', role: 'ADMIN', clave: 'JCS', isSuperadmin: false };
const ALONSO = { username: 'Alonso', displayName: 'Alonso Rios', role: 'ADMIN', clave: 'ADM', isSuperadmin: true };
const OTHERS = [
  { username: 'Absael', displayName: 'Absael', role: 'ADMIN', clave: 'ABS', isSuperadmin: false },
  { username: 'Jgutierrez', displayName: 'Juan Gabriel Gutiérrez Méndez', role: 'ENCARGADO', clave: 'JGG', isSuperadmin: false }
];

function browserAuth(currentUser) {
  const context = vm.createContext({ window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  vm.runInContext(read('public/js/auth.js'), context);
  context.window.Auth.currentUser = currentUser;
  return context.window.Auth;
}

test('the progress window opens for Alonso and Juan Carlos, and for nobody else', () => {
  for (const user of [ALONSO, JUAN_CARLOS]) {
    assert.equal(canViewProgress(user), true, user.username);
    assert.equal(browserAuth(user).canViewProgress(), true, user.username);
  }
  for (const user of OTHERS) {
    assert.equal(canViewProgress(user), false, user.username);
    assert.equal(browserAuth(user).canViewProgress(), false, user.username);
  }
  assert.equal(canViewProgress(null), false);
  assert.equal(browserAuth(null).canViewProgress(), false);
});

test('the progress data answers the same way as the window', () => {
  const call = user => {
    const result = { nexted: false, status: null };
    const res = { status(code) { result.status = code; return this; }, json() { return this; } };
    requireProgressAccess({ user }, res, () => { result.nexted = true; });
    return result;
  };
  assert.deepEqual(call(JUAN_CARLOS), { nexted: true, status: null });
  assert.deepEqual(call(OTHERS[0]), { nexted: false, status: 403 });
  assert.deepEqual(call(undefined), { nexted: false, status: 401 });

  const routes = read('src/routes/dashboardRoutes.js');
  assert.match(routes, /router\.get\('\/tracking', authenticate, requireProgressAccess,/);
  assert.match(routes, /router\.get\('\/justification-photos', authenticate, requireProgressAccess,/);
});

test('Juan Carlos gets the progress window but not the Firestore usage indicator', () => {
  assert.equal(browserAuth(JUAN_CARLOS).isSuperadminAlonso(), false);
  const page = read('public/index.html');
  assert.match(page, /class="role-progress-only"[^>]*><button class="nav-item-btn" data-view="progress">/);
  assert.match(page, /class="firestore-usage-bars role-alonso-only"/);
  assert.match(read('src/routes/dashboardRoutes.js'), /router\.get\('\/usage', authenticate, requireSuperadminAlonso,/);
});
