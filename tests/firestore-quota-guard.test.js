const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CloudFileStore = require('../src/services/cloudFileStore');
const FirestoreUsage = require('../src/services/firestoreUsage');
const createPersistenceMiddleware = require('../src/services/persistenceMiddleware');
const createHeavyReadLimiter = require('../src/middlewares/quotaGuardMiddleware');

const usersId = Buffer.from('users.json').toString('base64url');

function fixture() {
  const docs = new Map([[usersId, { path: 'users.json', content: '[{"username":"admin"}]' }]]);
  const calls = { control: 0, all: 0, revision: 0, changedDocs: 0 };
  let clock = 1000000;
  const hooks = { beforeControl: null, failRevision: false };
  const adapter = {
    readControl: async () => {
      calls.control++;
      if (hooks.beforeControl) { const hook = hooks.beforeControl; hooks.beforeControl = null; await hook(); }
      return { ...docs.get(usersId) };
    },
    readAll: async () => { calls.all++; return [...docs].map(([id, data]) => ({ id, data: { ...data } })); },
    readRevision: async revision => {
      calls.revision++;
      if (hooks.failRevision) throw new Error('query unavailable');
      const found = [...docs].filter(([, data]) => data.syncRevision === revision).map(([id, data]) => ({ id, data: { ...data } }));
      calls.changedDocs += found.length;
      return found;
    },
    commit: async (expected, mutations, generation) => {
      const control = docs.get(usersId);
      if ((control.syncGeneration || 0) !== expected.generation || (control.syncRevision || 0) !== expected.revision) throw Object.assign(new Error('stale'), { status: 409 });
      for (const mutation of mutations) {
        if (mutation.type === 'delete') docs.delete(mutation.id);
        else docs.set(mutation.id, { ...docs.get(mutation.id), ...mutation.data });
      }
      Object.assign(docs.get(usersId), CloudFileStore.nextControlFields(control, expected, generation));
    },
    removeOld: async ids => ids.forEach(id => docs.delete(id))
  };
  return {
    docs, calls, hooks, adapter,
    store: (options = {}) => new CloudFileStore(adapter, 'test-only', { now: () => clock, ...options }),
    advance: ms => { clock += ms; }
  };
}

async function save(store, name, value) {
  await store.refresh();
  store.syncToFirestore(`inventories/${name}.json`, '', '', value);
  await store.flush();
}

test('repeated reads inside the window share one control read and no collection read', async () => {
  const f = fixture(), reader = f.store();
  await reader.readConfirmedSnapshot();
  const after = { ...f.calls };
  for (let index = 0; index < 50; index++) await reader.readConfirmedSnapshot();
  assert.deepEqual(f.calls, after);
  assert.equal(f.calls.all, 1);
});

test('simultaneous reads on a cold instance perform a single collection read', async () => {
  const f = fixture(), reader = f.store();
  const results = await Promise.all(Array.from({ length: 10 }, () => reader.readConfirmedSnapshot()));
  assert.equal(f.calls.all, 1);
  results.forEach(result => assert.ok(result.files.has('users.json')));
});

test('an instance sees its own commit immediately without reading the collection again', async () => {
  const f = fixture(), store = f.store();
  await save(store, 'one', { count: 1 });
  await store.readConfirmedSnapshot();
  const reads = f.calls.all;
  await save(store, 'one', { count: 2 });
  const snapshot = await store.readConfirmedSnapshot();
  assert.equal(snapshot.files.get('inventories/one.json').value.count, 2);
  assert.equal(f.calls.all, reads);
});

test('a running request keeps a stable snapshot while a commit replaces the cache', async () => {
  const f = fixture(), store = f.store();
  await save(store, 'one', { count: 1 });
  const running = await store.readConfirmedSnapshot();
  await save(store, 'one', { count: 2 });
  assert.equal(running.files.get('inventories/one.json').value.count, 1);
});

test('another instance reads only changed documents, including deletions', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await save(writer, 'two', { count: 2 });
  await reader.readConfirmedSnapshot();
  const fullReads = f.calls.all;
  await save(writer, 'one', { count: 10 });
  writer.deleteFromFirestore('inventories/two.json');
  await writer.flush();

  const before = await reader.readConfirmedSnapshot();
  assert.equal(before.files.get('inventories/one.json').value.count, 1, 'inside the window the shared control is reused');
  f.advance(10000);
  const after = await reader.readConfirmedSnapshot();
  assert.equal(after.files.get('inventories/one.json').value.count, 10);
  assert.equal(after.files.has('inventories/two.json'), false);
  assert.equal(f.calls.all, fullReads, 'no additional full collection read');
});

test('incremental reading produces the same data as a full read', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  await save(writer, 'one', { count: 2 });
  await save(writer, 'three', { count: 3 });
  writer.deleteFromFirestore('inventories/three.json');
  await writer.flush();
  await save(writer, 'three', { count: 33 });
  f.advance(10000);
  const incremental = await reader.readConfirmedSnapshot();
  const fresh = await f.store().readConfirmedSnapshot();
  const contents = snapshot => Object.fromEntries([...snapshot.files].map(([key, file]) => [key, file.value]));
  assert.deepEqual(contents(incremental), contents(fresh));
  assert.deepEqual(incremental.state, fresh.state);
});

test('a client revision bypasses the window so it always sees its own confirmed write', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  await save(writer, 'one', { count: 2 });
  const snapshot = await reader.readConfirmedSnapshot({ minRevision: writer.state.revision });
  assert.equal(snapshot.files.get('inventories/one.json').value.count, 2);
  assert.equal(snapshot.state.revision, writer.state.revision);
});

test('a write from an older deployment forces a full read until the chain restarts', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  const fullReads = f.calls.all;
  // An older revision commits without stamping its document.
  const id = Buffer.from('inventories/old.json').toString('base64url');
  const control = f.docs.get(usersId);
  f.docs.set(id, { path: 'inventories/old.json', content: '{"old":true}', generation: 0, secret: 'test-only' });
  control.syncRevision += 1;
  f.advance(10000);
  const seen = await reader.readConfirmedSnapshot();
  assert.deepEqual(seen.files.get('inventories/old.json').value, { old: true });
  assert.equal(f.calls.all, fullReads + 1);
  // The next new write marks later revisions as safe, but an instance behind that point reads everything.
  const behind = f.store();
  await behind.readConfirmedSnapshot();
  await save(writer, 'two', { count: 2 });
  assert.equal(f.docs.get(usersId).syncIncrementalFrom, control.syncRevision - 1);
  f.advance(10000);
  const reads = f.calls.all;
  const caughtUp = await behind.readConfirmedSnapshot();
  assert.deepEqual(caughtUp.files.get('inventories/two.json').value, { count: 2 });
  assert.equal(f.calls.all, reads, 'an instance past the break continues incrementally');
});

test('an instance behind an older-deployment write cannot miss it after new writes resume', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  // Older revision commits unstamped; then a current instance commits, so the latest revision is stamped again.
  const id = Buffer.from('inventories/old.json').toString('base64url');
  f.docs.set(id, { path: 'inventories/old.json', content: '{"old":true}', generation: 0, secret: 'test-only' });
  f.docs.get(usersId).syncRevision += 1;
  await save(writer, 'two', { count: 2 });
  f.advance(10000);
  const snapshot = await reader.readConfirmedSnapshot();
  assert.deepEqual(snapshot.files.get('inventories/old.json').value, { old: true });
  assert.deepEqual(snapshot.files.get('inventories/two.json').value, { count: 2 });
});

test('a failed incremental query falls back to the full read', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  await save(writer, 'one', { count: 2 });
  f.hooks.failRevision = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    f.advance(10000);
    const snapshot = await reader.readConfirmedSnapshot();
    assert.equal(snapshot.files.get('inventories/one.json').value.count, 2);
  } finally { console.error = originalError; }
});

test('more than 25 pending revisions use a full read', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await reader.readConfirmedSnapshot();
  for (let index = 0; index < 26; index++) await save(writer, 'one', { count: index });
  const fullReads = f.calls.all;
  f.advance(10000);
  const snapshot = await reader.readConfirmedSnapshot();
  assert.equal(snapshot.files.get('inventories/one.json').value.count, 25);
  assert.equal(f.calls.all, fullReads + 1);
  assert.equal(f.calls.revision, 0);
});

test('a commit during an incremental read cannot leave a mixed snapshot', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  await save(writer, 'one', { count: 2 });
  f.advance(10000);
  // Shared control sees revision R; the document then moves to R+1 before the final check.
  await reader.readSharedControl();
  f.hooks.beforeControl = () => save(writer, 'one', { count: 3 });
  const snapshot = await reader.readConfirmedSnapshot();
  assert.equal(snapshot.files.get('inventories/one.json').value.count, 3);
  assert.equal(snapshot.state.revision, f.docs.get(usersId).syncRevision);
});

test('the writer also catches up with only the changed documents', async () => {
  const f = fixture(), first = f.store(), second = f.store();
  await save(first, 'one', { count: 1 });
  await second.refresh();
  const fullReads = f.calls.all;
  await save(first, 'one', { count: 2 });
  assert.equal(await second.refresh(), true);
  assert.equal(second.files.get('inventories/one.json').value.count, 2);
  assert.equal(f.calls.all, fullReads);
  second.syncToFirestore('inventories/one.json', '', '', { count: 3 });
  await second.flush();
  assert.equal(f.docs.get(Buffer.from('inventories/one.json').toString('base64url')).syncRevision, second.state.revision);
});

test('a forced refresh still reloads the whole collection', async () => {
  const f = fixture(), store = f.store();
  await save(store, 'one', { count: 1 });
  const fullReads = f.calls.all;
  await store.refresh(true);
  assert.equal(f.calls.all, fullReads + 1);
});

test('a purge replaces the cached data even for an instance reading incrementally', async () => {
  const f = fixture(), writer = f.store(), reader = f.store();
  await save(writer, 'one', { count: 1 });
  await reader.readConfirmedSnapshot();
  await writer.clearAllInFirestore();
  f.advance(10000);
  const snapshot = await reader.readConfirmedSnapshot();
  assert.deepEqual([...snapshot.files.keys()], ['users.json']);
});

test('reconciliation performs a full read every six hours and sees unversioned changes', async () => {
  const f = fixture(), reader = f.store();
  await reader.readConfirmedSnapshot();
  f.docs.set('manual', { path: 'inventories/manual.json', content: '{"manual":true}', generation: 0 });
  f.advance(6 * 60 * 60000);
  const snapshot = await reader.readConfirmedSnapshot();
  assert.deepEqual(snapshot.files.get('inventories/manual.json').value, { manual: true });
});

test('usage levels follow the larger of reads and writes and reset with the quota day', () => {
  let clock = Date.parse('2026-11-02T12:00:00-08:00');
  const warnings = [];
  const usage = new FirestoreUsage({ readQuota: 100, writeQuota: 100, now: () => clock, log: { warn: message => warnings.push(message) } });
  assert.equal(usage.level(), 'normal');
  usage.addReads(70);
  assert.equal(usage.level(), 'warning');
  usage.addWrites(90);
  assert.equal(usage.level(), 'protect');
  usage.level();
  assert.equal(warnings.length, 2, 'each level is logged once');
  clock = Date.parse('2026-11-03T00:00:01-08:00');
  assert.equal(usage.level(), 'normal');
  assert.deepEqual(usage.totals(), { reads: 0, writes: 0 });
});

test('usage is shared through the control document without double counting', () => {
  const clock = Date.parse('2026-11-02T12:00:00-08:00');
  const first = new FirestoreUsage({ now: () => clock }), second = new FirestoreUsage({ now: () => clock });
  first.addReads(100); first.addWrites(5);
  const delta = first.unreported();
  const fields = first.fieldsFor({ usageDay: first.day, usageReads: 40, usageWrites: 1 }, delta);
  assert.equal(fields.usageReads, 140);
  first.markReported(delta, fields);
  assert.deepEqual(first.totals(), { reads: 140, writes: 6 });
  second.addReads(10);
  second.absorb(fields);
  assert.deepEqual(second.totals(), { reads: 150, writes: 6 });
  assert.equal(second.fieldsFor({ usageDay: '2000-01-01', usageReads: 999, usageWrites: 999 }, { reads: 1, writes: 2 }).usageReads, 1, 'an earlier day is not accumulated');
});

test('usage reports are throttled, and invalid quota settings fall back to the free quota', () => {
  let clock = Date.parse('2026-11-02T12:00:00-08:00');
  const usage = new FirestoreUsage({ readQuota: 'abc', writeQuota: '-1', now: () => clock });
  assert.equal(usage.readQuota, 50000);
  assert.equal(usage.writeQuota, 20000);
  assert.equal(usage.shouldReport(), false);
  usage.addReads(10);
  assert.equal(usage.shouldReport(), false);
  clock += 15 * 60000;
  assert.equal(usage.shouldReport(), true);
  usage.noteReportAttempt();
  assert.equal(usage.shouldReport(), false);
  usage.addReads(2000);
  clock += 60000;
  assert.equal(usage.shouldReport(), true);
});

test('protection lengthens the control window and serves the cache instead of a full read', async () => {
  const f = fixture(), writer = f.store();
  const usage = { level: () => 'protect' };
  const reader = f.store({ usage });
  await reader.readConfirmedSnapshot();
  for (let index = 0; index < 26; index++) await save(writer, 'one', { count: index });
  const fullReads = f.calls.all, controlReads = f.calls.control;
  f.advance(30000);
  await reader.readConfirmedSnapshot();
  assert.equal(f.calls.control, controlReads, 'the window is 60 s in protection');
  f.advance(30000);
  const served = await reader.readConfirmedSnapshot();
  assert.equal(served.files.has('inventories/one.json'), false);
  assert.equal(f.calls.all, fullReads, 'no full read while the cache is recent');
  f.advance(15 * 60000);
  const refreshed = await reader.readConfirmedSnapshot();
  assert.equal(refreshed.files.get('inventories/one.json').value.count, 25, 'data is never older than the limit');
});

test('protection still honours a client revision', async () => {
  const f = fixture(), writer = f.store();
  const reader = f.store({ usage: { level: () => 'protect' } });
  await reader.readConfirmedSnapshot();
  for (let index = 0; index < 26; index++) await save(writer, 'one', { count: index });
  const snapshot = await reader.readConfirmedSnapshot({ minRevision: writer.state.revision });
  assert.equal(snapshot.files.get('inventories/one.json').value.count, 25);
});

test('the limiter pauses only heavy work and only under protection', () => {
  const run = (level, req) => {
    let nextCalled = false, status = null, body = null;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    createHeavyReadLimiter({ level: () => level })(req, res, () => { nextCalled = true; });
    return { nextCalled, status, body };
  };
  assert.equal(run('warning', { method: 'POST', query: {} }).nextCalled, true);
  const blocked = run('protect', { method: 'POST', query: {} });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'FIRESTORE_QUOTA_PROTECTION');
  const query = { refresh: 'true', recalculate: '1', center: '1120' };
  assert.equal(run('protect', { method: 'GET', query }).nextCalled, true);
  assert.deepEqual(query, { center: '1120' });
  const untouched = { refresh: 'true' };
  run('normal', { method: 'GET', query: untouched });
  assert.deepEqual(untouched, { refresh: 'true' });
});

test('HTTP flow exposes revisions, reads own writes and avoids reloads on rejected requests', async t => {
  const express = require('express');
  const f = fixture();
  const cloud = f.store({ usage: { level: () => 'warning' } });
  let refreshes = 0;
  const storage = {
    refreshFromCloud: force => { if (force) refreshes++; return cloud.refresh(force); },
    withReadSnapshot: (snapshot, work) => { storage.current = snapshot; return work(); }
  };
  const app = express();
  app.use(createPersistenceMiddleware(storage, cloud));
  app.get('/inventories', (req, res) => res.json({ count: storage.current.files.get('inventories/api.json')?.value.count ?? null }));
  app.post('/save', (req, res) => { cloud.syncToFirestore('inventories/api.json', '', '', { count: 7 }); res.json({ success: true }); });
  app.post('/reject', (req, res) => res.status(400).json({ success: false }));
  app.post('/reject-after-change', (req, res) => { cloud.syncToFirestore('inventories/api.json', '', '', { count: 99 }); res.status(400).json({ success: false }); });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const saved = await fetch(`${base}/save`, { method: 'POST' });
  const revision = saved.headers.get('x-sync-revision');
  assert.equal(revision, '1');
  assert.equal(saved.headers.get('x-firestore-usage'), 'warning');

  const read = await fetch(`${base}/inventories`, { headers: { 'X-Min-Revision': revision } });
  assert.deepEqual(await read.json(), { count: 7 });
  assert.equal(read.headers.get('x-read-snapshot'), '0:1');
  assert.equal(read.headers.get('x-firestore-usage'), 'warning');

  const bogus = await fetch(`${base}/inventories`, { headers: { 'X-Min-Revision': 'not-a-number' } });
  assert.equal(bogus.status, 200);

  assert.equal((await fetch(`${base}/reject`, { method: 'POST' })).status, 400);
  assert.equal(refreshes, 0, 'nothing changed, so nothing is reloaded');

  assert.equal((await fetch(`${base}/reject-after-change`, { method: 'POST' })).status, 400);
  assert.equal(refreshes, 1, 'a rejected request with queued changes is still rolled back');
  assert.equal(cloud.pending.size, 0);
  const afterRollback = await fetch(`${base}/inventories`);
  assert.deepEqual(await afterRollback.json(), { count: 7 });
});

test('the browser client sends its newest revision on reads only and warns administrators once', async () => {
  const toasts = [];
  const requests = [];
  const responses = [
    { 'x-sync-revision': '12' },
    { 'x-read-snapshot': '0:15', 'x-firestore-usage': 'warning' },
    { 'x-firestore-usage': 'warning' }
  ];
  const context = vm.createContext({
    window: { AppConfig: { apiBaseUrl: '/api', storageTokenKey: 'token' }, Auth: { currentUser: { role: 'ADMIN' } }, Toast: { warning: message => toasts.push(message) } },
    localStorage: { getItem: () => null },
    FormData: class {},
    AbortSignal,
    console,
    fetch: async (url, options) => {
      requests.push(options);
      const headers = { 'content-type': 'application/json', ...responses.shift() };
      return { ok: true, status: 200, headers: { get: name => headers[name.toLowerCase()] ?? null }, json: async () => ({ success: true }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8'), context);
  const api = context.window.API;
  await api.request('/save', { method: 'POST' });
  assert.equal(api.minRevision, 12);
  await api.request('/inventories');
  assert.equal(requests[1].headers['X-Min-Revision'], '12');
  assert.equal(api.minRevision, 15);
  assert.equal(toasts.length, 1);
  await api.request('/other', { method: 'POST' });
  assert.equal(requests[2].headers['X-Min-Revision'], undefined);
  assert.equal(toasts.length, 1, 'the same level does not repeat the warning');
});
