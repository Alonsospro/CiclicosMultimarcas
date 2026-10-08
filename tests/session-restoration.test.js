const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function app() {
  const classes = new Map();
  function element(id) {
    const active = new Set();
    const node = {
      id, style: {}, dataset: {}, textContent: '', attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      classList: {
        add(value) { active.add(value); },
        remove(value) { active.delete(value); },
        contains(value) { return active.has(value); }
      }
    };
    classes.set(id, node);
    return node;
  }
  const views = ['login', 'inventories', 'count', 'dashboard', 'barrido'].map(v => element('view-' + v));
  ['session-loading', 'main-navbar', 'count-inv-title', 'count-blind-banner', 'count-recount-banner'].forEach(element);
  const main = element('main-content');
  const storage = new Map();
  const user = { id: 'user-1', role: 'ADMIN', username: 'test', center: '2100' };
  const context = vm.createContext({
    console: { error() {} }, AbortController, setTimeout, clearTimeout, FormData,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: {
      body: { dataset: { authState: 'checking' } },
      addEventListener() {},
      getElementById(id) { return classes.get(id) || null; },
      querySelectorAll(selector) { return selector === '.view-container' ? views : []; },
      querySelector(selector) { return selector === '.main-content' ? main : null; }
    }
  });
  context.window = context;
  context.scrollTo = () => {};
  context.AppConfig = { storageTokenKey: 'token', storageUserKey: 'user', apiBaseUrl: '/api' };
  context.Toast = { info() {}, danger() {}, warning() {} };
  context.ModalHelper = { closeAll() {} };
  context.DashboardView = { loadDashboard() {} };
  for (const name of ['api.js', 'auth.js', 'views/inventoryView.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', name), 'utf8'), context);
  }
  context.Auth.currentUser = user;
  context.Auth.token = 'valid-token';
  storage.set('token', 'valid-token');
  storage.set('user', JSON.stringify(user));
  context.InventoryView.loadInventories = () => {};
  context.InventoryView.renderCountTable = () => {};
  context.InventoryView.updateSubmitButtonState = () => {};
  const activeViews = () => views.filter(v => v.classList.contains('active')).map(v => v.id);
  return { context, storage, classes, activeViews };
}

function inventory(id = 'INV-1') {
  return { inventory: { id, name: 'Inventario', center: '2100', status: 'EN_PROGRESO', items: [] } };
}

test('refresh restores the count view and removes the login view', async () => {
  const { context: c, classes, activeViews, storage } = app();
  classes.get('view-login').classList.add('active');
  c.API.getInventoryById = async () => inventory();
  await c.InventoryView.openInventory('INV-1');
  assert.deepEqual(activeViews(), ['view-count']);
  assert.equal(c.Router.currentView, 'count');
  assert.equal(c.document.body.dataset.authState, 'authenticated');
  assert.equal(storage.get('nibol_active_view'), 'count');
});

test('a 401 during restoration cannot fall back to cached inventory', async () => {
  const { context: c, storage, activeViews } = app();
  storage.set('nibol_inv_detail_INV-1', JSON.stringify(inventory().inventory));
  c.fetch = async () => ({ status: 401, ok: false,
    headers: { get: () => 'application/json' }, json: async () => ({ message: 'Sesión expirada' }) });
  await c.InventoryView.openInventory('INV-1');
  assert.deepEqual(activeViews(), ['view-login']);
  assert.equal(c.InventoryView.currentInventory, null);
  assert.equal(c.Auth.currentUser, null);
});

test('a server permission refusal is not replaced by cached data', async () => {
  const { context: c, storage, activeViews } = app();
  storage.set('nibol_inv_detail_INV-1', JSON.stringify(inventory().inventory));
  c.API.getInventoryById = async () => { throw Object.assign(new Error('Sin permiso'), { status: 403 }); };
  await c.InventoryView.openInventory('INV-1');
  assert.deepEqual(activeViews(), ['view-inventories']);
  assert.equal(c.InventoryView.currentInventory, null);
});

test('logout discards a successful inventory response that arrives later', async () => {
  const { context: c, activeViews } = app();
  const pending = deferred();
  c.API.getInventoryById = () => pending.promise;
  const opening = c.InventoryView.openInventory('INV-1');
  c.Auth.logout(false);
  pending.resolve(inventory());
  await opening;
  assert.deepEqual(activeViews(), ['view-login']);
  assert.equal(c.InventoryView.currentInventory, null);
});

test('the last requested inventory wins if responses arrive out of order', async () => {
  const { context: c } = app();
  const first = deferred();
  c.API.getInventoryById = id => id === 'INV-1' ? first.promise : Promise.resolve(inventory(id));
  const opening = c.InventoryView.openInventory('INV-1');
  await c.InventoryView.openInventory('INV-2');
  first.resolve(inventory('INV-1'));
  await opening;
  assert.equal(c.InventoryView.currentInventory.id, 'INV-2');
});

test('navigating elsewhere cancels the pending inventory restoration', async () => {
  const { context: c, activeViews } = app();
  const pending = deferred();
  c.API.getInventoryById = () => pending.promise;
  const opening = c.InventoryView.openInventory('INV-1');
  c.Router.navigate('dashboard');
  pending.resolve(inventory());
  await opening;
  assert.deepEqual(activeViews(), ['view-dashboard']);
  assert.equal(c.InventoryView.currentInventory, null);
});

test('cached inventory remains available on a temporary network failure with a valid session', async () => {
  const { context: c, storage, activeViews } = app();
  storage.set('nibol_inv_detail_INV-1', JSON.stringify(inventory().inventory));
  c.API.getInventoryById = async () => { throw new TypeError('Failed to fetch'); };
  await c.InventoryView.openInventory('INV-1');
  assert.deepEqual(activeViews(), ['view-count']);
  assert.equal(c.InventoryView.currentInventory.id, 'INV-1');
});

test('session validation keeps the stored session on a temporary network failure', async () => {
  const { context: c } = app();
  c.API.getMe = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await c.Auth.checkSession(), true);
  assert.equal(c.Auth.token, 'valid-token');
});

test('an old unauthorized response does not log out a newer session', async () => {
  const { context: c, storage } = app();
  const pending = deferred();
  c.fetch = () => pending.promise;
  const request = c.API.getInventoryById('INV-1');
  storage.set('token', 'new-session-token');
  c.Auth.token = 'new-session-token';
  pending.resolve({ status: 401, ok: false, headers: { get: () => 'application/json' },
    json: async () => ({ message: 'Token vencido' }) });
  await assert.rejects(request, error => error.status === 401);
  assert.equal(c.Auth.token, 'new-session-token');
  assert.ok(c.Auth.currentUser);
});
