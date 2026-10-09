const test = require('node:test');
const assert = require('node:assert/strict');
const CloudFileStore = require('../src/services/cloudFileStore');

function fixture() {
  const usersId = Buffer.from('users.json').toString('base64url');
  const docs = new Map([[usersId, { path: 'users.json', content: '[{"username":"admin"}]' }]]);
  let failCommit = false, failCleanup = false;
  const adapter = {
    readControl: async () => docs.get(usersId),
    readAll: async () => [...docs].map(([id, data]) => ({ id, data })),
    commit: async (expected, mutations, generation) => {
      if (failCommit) throw new Error('offline');
      const control = docs.get(usersId);
      if ((control.syncGeneration || 0) !== expected.generation || (control.syncRevision || 0) !== expected.revision) throw Object.assign(new Error('stale'), { status: 409 });
      for (const mutation of mutations) {
        if (mutation.type === 'delete') docs.delete(mutation.id);
        else docs.set(mutation.id, { ...docs.get(mutation.id), ...mutation.data });
      }
      Object.assign(docs.get(usersId), { syncGeneration: generation, syncRevision: expected.revision + 1 });
    },
    removeOld: async ids => { if (failCleanup) throw new Error('offline'); ids.forEach(id => docs.delete(id)); }
  };
  return { docs, adapter, store: () => new CloudFileStore(adapter, 'test-only'), failCommit: () => { failCommit = true; }, failCleanup: () => { failCleanup = true; } };
}

test('a purge invalidates a stale instance and a restart cannot resurrect older files', async () => {
  const f = fixture(), first = f.store(), stale = f.store();
  await first.refresh();
  first.syncToFirestore('inventories/one.json', '', '', { items: [1] });
  await first.flush();
  await stale.refresh();
  await first.clearAllInFirestore();
  stale.syncToFirestore('inventories/one.json', '', '', { items: [1] });
  await assert.rejects(stale.flush(), error => error.status === 409);
  // Simulate a deployed older revision uploading its disk copy into generation zero.
  f.docs.set('old-disk-copy', { path: '/app/data/inventories/one.json', content: '{"items":[1]}' });
  const restarted = f.store(); await restarted.refresh();
  assert.deepEqual([...restarted.files.keys()], ['users.json']);
});

test('failed cleanup hides retired files while new inventories remain available', async () => {
  const f = fixture(), store = f.store(); await store.refresh();
  store.syncToFirestore('inventories/one.json', '', '', { items: [1] }); await store.flush();
  f.failCleanup();
  assert.equal((await store.clearAllInFirestore()).cleanupPending, true);
  store.syncToFirestore('inventories/one.json', '', '', { items: [2] }); await store.flush();
  const restarted = f.store(); await restarted.refresh();
  assert.deepEqual(restarted.files.get('inventories/one.json').value, { items: [2] });
});

test('failed purge leaves data and generation unchanged', async () => {
  const f = fixture(), store = f.store(); await store.refresh();
  store.syncToFirestore('inventories/one.json', '', '', { items: [1] }); await store.flush();
  const before = { ...store.state }; f.failCommit();
  await assert.rejects(store.clearAllInFirestore(), /offline/);
  assert.deepEqual(store.state, before);
  assert.ok(store.files.has('inventories/one.json'));
});

test('concurrent writers cannot overwrite one another and readers see deletions', async () => {
  const f = fixture(), a = f.store(), b = f.store(); await a.refresh(); await b.refresh();
  a.syncToFirestore('inventories/one.json', '', '', { count: 2 });
  b.syncToFirestore('inventories/one.json', '', '', { count: 3 });
  await a.flush(); await assert.rejects(b.flush(), error => error.status === 409);
  b.pending.clear(); await b.refresh(); assert.equal(b.files.get('inventories/one.json').value.count, 2);
  a.deleteFromFirestore('inventories/one.json'); await a.flush(); await b.refresh();
  assert.equal(b.files.has('inventories/one.json'), false);
});

test('oversized writes are rejected before being queued', async () => {
  const f = fixture(), store = f.store(); await store.refresh();
  assert.throws(() => store.syncToFirestore('inventories/large.json', '', '', { text: 'a'.repeat(900001) }), error => error.status === 413);
  assert.equal(store.pending.size, 0);
});

test('an individual deletion keeps legacy duplicates hidden until explicitly recreated', async () => {
  const f = fixture(), cloud = f.store(); await cloud.refresh();
  cloud.syncToFirestore('inventories/one.json', '', '', { count: 1 }); await cloud.flush();
  cloud.deleteFromFirestore('inventories/one.json'); await cloud.flush();
  f.docs.set('legacy-duplicate', { path: '/app/data/inventories/one.json', content: '{"count":99}' });
  const reader = f.store(); await reader.refresh();
  assert.equal(reader.files.has('inventories/one.json'), false);
  reader.syncToFirestore('inventories/one.json', '', '', { count: 2 }); await reader.flush();
  const restarted = f.store(); await restarted.refresh();
  assert.equal(restarted.files.get('inventories/one.json').value.count, 2);
});

test('API waits for persistence and refuses a false success on a failed commit', async t => {
  const express = require('express');
  const middleware = require('../src/services/persistenceMiddleware');
  const f = fixture(), cloud = f.store();
  const storage = { refreshFromCloud: force => cloud.refresh(force) };
  const app = express();
  app.use(middleware(storage, cloud));
  app.post('/save', (req, res) => {
    cloud.syncToFirestore('inventories/api.json', '', '', { saved: true });
    res.json({ success: true });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/save`;
  const successful = await fetch(url, { method: 'POST' });
  assert.equal(successful.status, 200);
  assert.equal((await successful.json()).success, true);
  assert.ok([...f.docs.values()].some(data => data.path === 'inventories/api.json'));
  f.failCommit();
  const failed = await fetch(url, { method: 'POST' });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).success, false);
  assert.equal(cloud.pending.size, 0);
});

test('managed JSON reads and listings never fall back to stale deployment files', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const fakeFs = { ...fs, existsSync: () => true, mkdirSync: () => {}, writeFileSync: () => {}, unlinkSync: () => {}, readFileSync: () => '{"old":true}', readdirSync: () => ['old.json'] };
  const f = fixture(), cloud = f.store();
  const context = { require: name => name === 'fs' ? fakeFs : name === '../config' ? { baseDataDir: path.resolve('test-data') } : name === './firebaseSyncService' ? cloud : require(name), module: { exports: {} }, process, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/storagePath'), 'utf8'), context);
  const storage = context.module.exports;
  await storage.refreshFromCloud();
  assert.equal(storage.readJson(path.join(storage.getInventoriesDirectory(), 'old.json')), null);
  assert.equal(storage.listFiles(storage.getInventoriesDirectory()).length, 0);
  assert.equal(storage.readJson(storage.getUsersFilePath())[0].username, 'admin');
});
