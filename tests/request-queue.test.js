const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const createMiddleware = require('../src/services/persistenceMiddleware');

function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.send = () => { res.emit('finish'); return res; };
  return res;
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

test('a cancelled request waiting behind active work never invokes its route', async () => {
  const blocker = gate(), entered = gate();
  let reads = 0, routes = 0;
  const cloud = { flush: async () => {}, pending: new Map() };
  const middleware = createMiddleware({ refreshFromCloud: async () => { reads++; } }, cloud);
  const active = middleware.runExclusive(async () => { entered.release(); await blocker.promise; });
  await entered.promise;
  const res = response();
  middleware({}, res, () => { routes++; res.send(); });
  res.destroyed = true;
  blocker.release();
  await active;
  await middleware.runExclusive(async () => {});
  assert.equal(routes, 0);
  assert.equal(reads, 2, 'cancelled request does not read Firestore');
});

test('disconnecting during preparation skips remote side effects and leaves the queue usable', async () => {
  const blocker = gate(), entered = gate();
  let reads = 0, routes = 0;
  const middleware = createMiddleware({ refreshFromCloud: async () => {
    if (++reads === 1) { entered.release(); await blocker.promise; }
  } }, { flush: async () => {}, pending: new Map() });
  const res = response();
  middleware({}, res, () => { routes++; res.send(); });
  await entered.promise;
  res.destroyed = true;
  blocker.release();
  await middleware.runExclusive(async () => {});
  assert.equal(routes, 0);
  assert.equal(reads, 2);
});

test('connected requests expose queue timing and still wait for the cloud commit', async () => {
  const committing = gate(), entered = gate();
  let flushes = 0;
  const middleware = createMiddleware({ refreshFromCloud: async () => {} }, {
    pending: new Map(), flush: async () => {
      if (++flushes === 2) { entered.release(); await committing.promise; }
    }
  });
  const res = response();
  let finished = false;
  res.once('finish', () => { finished = true; });
  middleware({}, res, () => res.send('saved'));
  await entered.promise;
  assert.equal(finished, false);
  assert.match(res.headers['X-Queue-Wait-Ms'], /^\d+$/);
  committing.release();
  await middleware.runExclusive(async () => {});
  assert.equal(finished, true);
});

test('an incomplete multipart upload cannot block other API calls', async t => {
  const express = require('express');
  const http = require('node:http');
  const parsePhoto = require('../src/middlewares/photoUploadMiddleware');
  const app = express();
  app.post('/api/photos/upload', parsePhoto);
  app.use('/api', createMiddleware({ refreshFromCloud: async () => {} }, {
    pending: new Map(), flush: async () => {}
  }));
  let uploaded = 0;
  app.post('/api/photos/upload', parsePhoto, (req, res) => {
    uploaded++;
    res.json({ success: true, filename: req.file.originalname, data: req.file.buffer.toString() });
  });
  app.get('/api/read', (req, res) => res.json({ success: true }));
  app.use((error, req, res, next) => { if (!res.destroyed) res.status(400).end(); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const stalled = http.request({ host: '127.0.0.1', port, path: '/api/photos/upload', method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=load-test', 'Content-Length': '5000' }
  });
  stalled.on('error', () => {});
  t.after(() => stalled.destroy());
  const receiving = new Promise(resolve => server.once('request', resolve));
  stalled.write('--load-test\r\nContent-Disposition: form-data; name="photo"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\npartial');
  await receiving;
  const read = await fetch(`http://127.0.0.1:${port}/api/read`, { signal: AbortSignal.timeout(1500) });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).success, true);
  stalled.destroy();
  const afterAbort = await fetch(`http://127.0.0.1:${port}/api/read`, { signal: AbortSignal.timeout(1500) });
  assert.equal(afterAbort.status, 200);
  assert.equal(uploaded, 0);
  const form = new FormData();
  form.set('photo', new Blob(['valid-photo-data'], { type: 'image/jpeg' }), 'evidence.jpg');
  const valid = await fetch(`http://127.0.0.1:${port}/api/photos/upload`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(1500)
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { success: true, filename: 'evidence.jpg', data: 'valid-photo-data' });
  assert.equal(uploaded, 1);
});

test('a parsed photo survives a second route parser without reading the stream again', async () => {
  const parser = require('../src/middlewares/photoUploadMiddleware');
  const file = { originalname: 'evidence.jpg', buffer: Buffer.from('test') };
  const req = { photoUploadParsed: true, file };
  let called = false;
  parser(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.file, file);
});
