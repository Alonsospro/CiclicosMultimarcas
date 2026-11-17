const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const HEADERS = ['Sku', 'Codigo de Barras', 'Descripcion', 'Ubicacion', 'Ubicación 1', 'Ubicación 2', 'Sobrestock', 'Almacen', 'CLasificacion ABC',
  'Unidad', 'Costo Unitario', 'Stock Sistema', 'Cantidad Fisica Final', 'Total Conteo', 'Conteo B/E', 'Conteo M/E', 'Diferencia', 'Costo Diferencia',
  'Fecha Ultimo Conteo', 'Responsable Conteo', ...Array.from({ length: 24 }, (_, i) => 'Extra ' + i)];

function sheet(name, rows = []) {
  const grid = rows.map(r => r.slice());
  const notes = {};
  const self = {
    validations: [],
    getName: () => name, getSheetId: () => name.length, getLastRow: () => grid.length, getLastColumn: () => 44, getMaxRows: () => 1000,
    appendRow(row) { grid.push(row.slice()); },
    hideSheet() {},
    getRange(r, c, h = 1, w = 1) {
      return {
        getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
        setValues(values) { values.forEach((row, i) => { grid[r - 1 + i] = grid[r - 1 + i] || []; row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); }); },
        setDataValidation(rule) { self.validations.push({ r, c, h, rule }); },
        getNote: () => notes[r + ':' + c] || '', setNote(v) { notes[r + ':' + c] = v; },
        getRow: () => r,
        createTextFinder(text) { return { matchEntireCell() { return this; }, findNext: () => { const i = grid.findIndex((row, k) => k >= r - 1 && row[0] === text); return i < 0 ? null : { getRow: () => i + 1 }; } }; }
      };
    },
    grid, notes
  };
  return self;
}

function folder(name) {
  const self = {
    name, folders: [], files: [],
    getName: () => name, getId: () => 'F-' + name,
    getFoldersByName(n) { const list = self.folders.filter(f => f.name === n); return { hasNext: () => list.length > 0, next: () => list.shift() }; },
    createFolder(n) { const f = folder(n); self.folders.push(f); return f; },
    getFilesByName(n) { const list = self.files.filter(f => f.getName() === n); return { hasNext: () => list.length > 0, next: () => list.shift() }; },
    createFile(blob) { const f = { getName: () => blob.name, getSize: () => blob.bytes.length, getId: () => 'ID-' + blob.name, getUrl: () => 'https://drive/' + blob.name }; self.files.push(f); return f; }
  };
  return self;
}

function script({ rows = [] } = {}) {
  const props = { APPS_SCRIPT_TOKEN: 'secret' };
  const center = sheet('1120', [HEADERS, ...rows]);
  const sheets = [sheet('BD_BASE', [['codigo']]), center];
  const root = folder('barridos');
  const ss = { getSheets: () => sheets, getSheetByName: n => sheets.find(s => s.getName() === n) || null, insertSheet: n => { const s = sheet(n); sheets.push(s); return s; } };
  const rule = { requireValueInList(list) { this.list = list; return this; }, setAllowInvalid() { return this; }, setHelpText() { return this; }, build() { return { list: this.list }; } };
  const context = vm.createContext({
    console, JSON, Date, Math, Number, String, Object, Array, Set, isNaN,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, newDataValidation: () => Object.create(rule) },
    DriveApp: { getFolderById: () => root },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }), getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, v) => [...crypto.createHash('sha256').update(v).digest()].map(b => b > 127 ? b - 256 : b),
      base64Decode: v => [...Buffer.from(v, 'base64')],
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      formatDate: (d, tz, format) => format === 'yyyy-MM-dd' ? '2026-11-17' : '20261117_120000'
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../integrations/apps-script/produccion/BarridoWebhook.gs'), 'utf8'), context);
  let n = 0;
  const post = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ apiToken: 'secret', operationId: 'op-' + (++n), type: 'BARRIDO', ...body }) } }).text);
  return { post, center, root, props };
}

const photo = 'data:image/jpeg;base64,' + Buffer.from('foto-1').toString('base64');

test('barrido writes a new code in the chosen warehouse of its center and updates it on the next count', () => {
  const { post, center } = script();
  assert.equal(post({ action: 'getWarehouses' }).warehouses.join(), 'AL04,RJD0,AM01');
  const first = post({ action: 'upsertCount', center: '1120', sku: 'RE505881', barcode: '7501031311309', descripcion: 'POLEA', location: '1A01002C00',
    almacen: 'rjd0', stockBuenEstado: 3, malEstado: 1, stockSistema: 0, costoUnitario: 10, responsable: 'Erick' });
  assert.equal(first.success, true, first.error);
  assert.equal(first.created, true);
  const row = center.grid[1];
  assert.deepEqual([row[0], row[1], row[3], row[7], row[11], row[12], row[13], row[14], row[15], row[16], row[17], row[19]],
    ['RE505881', '7501031311309', '1A01002C00', 'RJD0', 0, 4, 4, 3, 1, 4, 40, 'Erick']);
  assert.equal(first.item.Stock_Total, 4);

  const again = post({ action: 'upsertCount', center: '1120', sku: 'RE505881', almacen: 'RJD0', location: '2B03001A00', stockBuenEstado: 5, malEstado: 0 });
  assert.equal(again.created, false);
  assert.equal(center.grid.length, 2, 'Same code and warehouse: same row');
  assert.equal(center.grid[1][13], 5);
  assert.equal(center.grid[1][4], '2B03001A00', 'A new location goes to Ubicación 1');

  const other = post({ action: 'upsertCount', center: '1120', sku: 'RE505881', almacen: 'AL04', stockBuenEstado: 2, malEstado: 0 });
  assert.equal(other.created, true, 'Another warehouse is another row');
  assert.equal(center.grid.length, 3);
});

test('barrido refuses a warehouse outside the list and a count without warehouse', () => {
  const { post } = script();
  assert.match(post({ action: 'upsertCount', center: '1120', sku: 'X', almacen: 'ZZ99', stockBuenEstado: 1 }).error, /no está en la lista/);
  assert.match(post({ action: 'upsertCount', center: '1120', sku: 'X', stockBuenEstado: 1 }).error, /Seleccione el almacén/);
  assert.match(post({ action: 'upsertCount', center: '9999', sku: 'X', almacen: 'AL04', stockBuenEstado: 1 }).error, /Centro no reconocido/);
});

test('the warehouse list is changed from the app and applied as the dropdown of every center tab', () => {
  const { post, center, props } = script();
  const saved = post({ action: 'setWarehouses', warehouses: ['al04', 'RJD0', 'AM01', 'AL05', 'AL04'] });
  assert.equal(saved.warehouses.join(), 'AL04,RJD0,AM01,AL05');
  assert.equal(props.BARRIDO_ALMACENES, 'AL04,RJD0,AM01,AL05');
  assert.equal(center.validations.at(-1).c, 8, 'Column H, Almacen');
  assert.equal(center.validations.at(-1).rule.list.join(), 'AL04,RJD0,AM01,AL05');
  assert.match(post({ action: 'setWarehouses', warehouses: ['AL-04'] }).error, /inválidos/);
  assert.match(post({ action: 'setWarehouses', warehouses: [] }).error, /vacía/);
});

test('photos go to a date and center folder, named after the code entered, without duplicates', () => {
  const { post, root, center } = script();
  const saved = post({ action: 'savePhoto', center: 'Volvo - Km 14', sku: 'RE505881', date: '2026-11-17', category: 'malestado', photoBase64: photo });
  assert.equal(saved.photo.folder, '2026-11-17 · 1120 Volvo - Km 14');
  assert.equal(saved.photo.name, 'RE505881.jpg');
  const repeated = post({ action: 'savePhoto', center: '1120', sku: 'RE505881', date: '2026-11-17', photoBase64: photo });
  assert.equal(repeated.photo.name, 'RE505881.jpg', 'The same photo sent twice is reused');
  const second = post({ action: 'savePhoto', center: '1120', sku: 'RE505881', date: '2026-11-17', photoBase64: 'data:image/jpeg;base64,' + Buffer.from('otra foto').toString('base64') });
  assert.equal(second.photo.name, 'RE505881 (2).jpg');
  assert.equal(root.folders.length, 1);
  assert.equal(root.folders[0].files.length, 2);

  const counted = post({ action: 'upsertCount', center: '1120', sku: 'RE505881', almacen: 'AM01', stockBuenEstado: 0, malEstado: 1, photoBase64: photo });
  assert.equal(counted.photos.length, 1);
  assert.equal(root.folders[0].files.length, 2, 'The photo already uploaded is not saved again');
  assert.match(center.notes['2:1'], /Foto: https:\/\/drive\/RE505881\.jpg/);
});

test('products of a center are read from its tab, and a retried operation is not written twice', () => {
  const { post, center } = script({ rows: [['A1', 'B1', 'Desc', 'L1', '', '', '', 'RJD0', 'C', 'PZA', 5, 3, '', '', '', '', '', '', '', '']] });
  const read = post({ action: 'getProducts', center: '1120' });
  assert.equal(read.items.length, 1);
  assert.deepEqual([read.items[0].SKU, read.items[0].Almacen, read.items[0].Stock_Sistema], ['A1', 'RJD0', 3]);
  const first = post({ action: 'upsertCount', center: '1120', sku: 'NEW', almacen: 'AL04', stockBuenEstado: 1, operationId: 'same' });
  const retry = post({ action: 'upsertCount', center: '1120', sku: 'NEW', almacen: 'AL04', stockBuenEstado: 1, operationId: 'same' });
  assert.equal(first.created, true);
  assert.equal(retry.created, true, 'The stored answer is returned');
  assert.equal(center.grid.filter(r => r[0] === 'NEW').length, 1);
  assert.match(post({ action: 'upsertCount', center: '1120', sku: 'NEW', almacen: 'AL04', stockBuenEstado: 2, operationId: 'same' }).error, /reutilizado/);
});

test('a new code takes the first empty row of the tab, even when an old row sits further down', () => {
  const empty = Array(44).fill('');
  const old = ['AL15071', 'al15071', 'repuesto', ...Array(41).fill('')];
  const { post, center } = script({ rows: [empty, empty, empty, old] });
  const saved = post({ action: 'upsertCount', center: '1120', sku: 'RE15143', almacen: 'AL04', stockBuenEstado: 2 });
  assert.equal(saved.item.row, 2);
  assert.equal(center.grid[1][0], 'RE15143');
  assert.equal(center.grid[4][0], 'AL15071', 'The old row is left as it is');
  const next = post({ action: 'upsertCount', center: '1120', sku: 'RE99', almacen: 'AL04', stockBuenEstado: 1 });
  assert.equal(next.item.row, 3);
});
