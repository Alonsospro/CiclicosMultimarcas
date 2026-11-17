const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function view(prefix, stored = {}) {
  const elements = { 'barrido-select-prefix': { value: prefix } };
  const context = vm.createContext({
    window: {}, console,
    document: { getElementById: id => elements[id] || null, addEventListener() {} },
    localStorage: { getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/views/barridoView.js'), 'utf8'), context);
  return context.window.BarridoView;
}

test('the SKU keeps the chosen brand prefix and the barcode is the code without it', () => {
  const jd = view('JD_');
  assert.equal(jd.skuFor('re505881'), 'JD_RE505881');
  assert.equal(jd.stripPrefix('re505881'), 'RE505881');
  assert.equal(jd.skuFor('WI_64645'), 'WI_64645', 'A code that already brings a prefix keeps it');
  assert.equal(jd.stripPrefix('WI_64645'), '64645');
  assert.equal(jd.stripPrefix('JD-AT456941'), 'AT456941');
  assert.equal(jd.stripPrefix('7501031311309'), '7501031311309');
  assert.equal(jd.stripPrefix('AB-12345'), 'AB-12345', 'Only underscores (or the old JD-) are prefixes');
  const none = view('');
  assert.equal(none.skuFor('re505881'), 'RE505881');
  const added = view('ZX_');
  added.prefixes = [...added.prefixes, 'ZX_'];
  assert.equal(added.skuFor('123'), 'ZX_123');
  assert.equal(added.stripPrefix('ZX_123'), '123');
});

test('the center, warehouse, prefix and last location chosen on a device are remembered', () => {
  const stored = {};
  const v = view('JD_', stored);
  v.remember('centro', '1300');
  v.remember('almacen', 'AL04');
  assert.equal(stored.nibol_barrido_centro, '1300');
  assert.equal(v.recall('almacen'), 'AL04');
  assert.equal(v.recall('prefijo'), '');
});
