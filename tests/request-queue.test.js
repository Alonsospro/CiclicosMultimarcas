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
