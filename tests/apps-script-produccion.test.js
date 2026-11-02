const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');

// Simulates the Drive/Sheets behaviour used by the production webhook: final files are
// copies of the master book that keep the center tab plus hidden manifest sheets.
function fixture({failOn, script = 'InventoryWebhook.gs'} = {}) {
  const width = script.includes('Semanales') ? 44 : 40;
  const files = new Map(), books = new Map(), calls = [];
  let serial = 0;
  const iterator = values => {let i = 0; return {hasNext:() => i < values.length, next:() => values[i++]};};
  const folder = {getId:() => 'FINALS', getName:() => 'Archivos Finales',
    getFiles:() => iterator([...files.values()].filter(f => !f.trashed && f.inFolder)),
    getFoldersByName:() => iterator([folder])};
  function sheet(name, id, grid = []) {
    const sh = {name, id, grid:grid.map(r => r.slice()), hidden:false,
      getName:() => sh.name, setName(v) {sh.name = v; return sh;}, getSheetId:() => id,
      getMaxRows:() => Math.max(100, sh.grid.length), getMaxColumns:() => width, getLastRow() {
        let n = sh.grid.length; while (n && !sh.grid[n - 1].some(v => v !== '' && v !== null && v !== undefined)) n--; return n;},
      insertRowsAfter() {}, deleteColumns() {}, hideSheet() {sh.hidden = true;},
      getRange(row, col, height = 1, width = 1) {
        const values = () => Array.from({length:height}, (_, i) => Array.from({length:width}, (_, j) => sh.grid[row - 1 + i]?.[col - 1 + j] ?? ''));
        return {getValues:values, getDisplayValues:() => values().map(r => r.map(String)), getValue:() => values()[0][0],
          setValue(v) {this.setValues([[v]]);}, setNumberFormat() {},
          setValues(rows) {
            if (failOn && failOn(sh, row, rows)) throw new Error('Fallo simulado de escritura');
            rows.forEach((r, i) => {sh.grid[row - 1 + i] ||= []; r.forEach((v, j) => {sh.grid[row - 1 + i][col - 1 + j] = v;});});
          },
          clearContent() {for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) if (sh.grid[row - 1 + i]) sh.grid[row - 1 + i][col - 1 + j] = '';}};
      }};
    return sh;
  }
  function book(id, sheets) {
    const b = {id, sheets, getId:() => id, getSheets:() => b.sheets.slice(), getSpreadsheetTimeZone:() => 'America/La_Paz',
      getSheetByName:n => b.sheets.find(s => s.name === n) || null,
      deleteSheet(s) {b.sheets = b.sheets.filter(o => o !== s);},
      insertSheet(n) {const s = sheet(n, 1000 + (++serial)); b.sheets.push(s); return s;}};
    books.set(id, b); return b;
  }
  function file(id, name, inFolder) {
    const f = {id, name, description:'', inFolder, trashed:false,
      getId:() => id, getName:() => f.name, setName(v) {f.name = v;}, getUrl:() => `https://docs.google.com/spreadsheets/d/${id}/edit`,
      getDescription:() => f.description, setDescription(v) {f.description = v;}, isTrashed:() => f.trashed,
      setTrashed(v) {f.trashed = v;}, getParents:() => iterator(inFolder ? [folder] : []), getLastUpdated:() => new Date(),
      makeCopy(newName) {
        calls.push('makeCopy');
        const copyId = 'final_' + (++serial), master = books.get(id);
        book(copyId, master.sheets.map(s => sheet(s.name, s.id, s.grid)));
        return file(copyId, newName, true);
      }};
    files.set(id, f); return f;
  }
  const context = vm.createContext({console, Date, JSON,
    Session:{getScriptTimeZone:() => 'America/La_Paz'},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'}, formatDate:() => `20261031_${String(++serial).padStart(6, '0')}`,
      computeDigest:(_a, v) => [...createHash('sha256').update(v).digest()]},
    SpreadsheetApp:{openById:id => books.get(id), flush() {}},
    DriveApp:{getFileById:id => {const f = files.get(id); if (!f) throw new Error('No existe'); return f;}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../integrations/apps-script/produccion', script), 'utf8'), context);
  const headers = Array.from(vm.runInContext('DEFAULT_HEADERS', context));
  const master = book('MASTER', [sheet('5100', 77, [headers]), sheet('1120', 78, [headers]), sheet('BD_BASE', 79, [['x']])]);
  file('MASTER', 'Inventario maestro', false);
  context.spreadsheet_ = () => master;
  context.getRootFolderForType_ = () => folder;
  context.getOrCreateFolder_ = () => folder;
  context.allowedRoots_ = () => ['FINALS'];
  context.belongsToRoot_ = () => true;
  context.savePhotoIfAny_ = () => null;
  return {context, files, books, calls};
}

const contract = require('../src/services/inventoryContract');

for (const script of ['InventoryWebhook.gs', 'InventoryWebhookSemanales.gs']) {
  const weekly = script.includes('Semanales'), type = weekly ? 'SEMANALES' : 'CICLICO';
  const row = (sku, qty) => ({...(weekly ? {Schema_Version:contract.weeklyVersion, Sobrestock:'9Z99999Z99'} : {}),
    SKU:sku, Almacen:'RVO6', Ubicacion:'1A01002C00', Costo_Unitario:10, Stock_Sistema:5,
    Stock_Buen_Estado:qty, Mal_estado:0, Stock_Total:qty, Fecha_Ultimo_Conteo:'2026-10-12T16:00:00.000Z'});
  const close = (f, operationId, items, extra = {}, inventoryId = 'INV-' + type + '-5100-1') => f.context.createFinalFile_({
    type, center:'5100', operationId, ...(weekly ? {schemaVersion:contract.weeklyVersion} : {}),
    driveRecord:{inventoryId, items, justifications:[{sku:items[0].SKU, round:1, justification:'Ok'}]}, ...extra});

  test(`production ${script}: a reclosure rewrites the same final file, keeps hidden sheets consistent and logs revisions`, () => {
    const f = fixture({script});
    const first = close(f, 'CLOSE-1', [row('A', 5), row('B', 4)]);
    const second = close(f, 'CLOSE-2', [row('A', 6)], {replaceFileId:first.fileId});
    assert.equal(second.fileId, first.fileId);
    assert.equal(second.spreadsheetUrl, first.spreadsheetUrl, 'Same link and gid');
    assert.equal(second.replaced, true); assert.equal(second.revision, 2);
    assert.equal(f.calls.filter(c => c === 'makeCopy').length, 1, 'No second copy of the master book');
    const book = f.books.get(first.fileId);
    assert.deepEqual(book.sheets.map(s => s.name).sort(), ['5100', '__INVENTORY_MANIFEST', '__JUSTIFICATIONS']);
    const read = f.context.readFinalInventory_({spreadsheetId:first.fileId, center:'5100'});
    assert.equal(read.rows.filter(r => r[0]).length, 1, 'Rows of the previous closure are removed');
    assert.equal(read.manifest.itemCount, 1);
    if (weekly) assert.equal(read.rows[0][contract.weeklyColumns.indexOf('Sobrestock')], '9Z99999Z99');
    assert.equal(f.files.get(first.fileId).name, second.fileName);
    const description = JSON.parse(f.files.get(first.fileId).description);
    assert.deepEqual(description.revisions.map(r => [r.operationId, r.itemCount]), [['CLOSE-1', 2], ['CLOSE-2', 1]]);
    assert.equal(f.context.getHistory_(type, '5100').length, 1, 'History lists a single file');
  });

  test(`production ${script}: without a valid previous file it still creates a new copy`, () => {
    const f = fixture({script});
    const first = close(f, 'CLOSE-1', [row('A', 5)]);
    const other = close(f, 'OTHER', [row('Z', 1)], {replaceFileId:first.fileId}, 'INV-' + type + '-5100-2');
    assert.notEqual(other.fileId, first.fileId); assert.equal(other.replaced, false);
    assert.equal(close(f, 'CLOSE-3', [row('A', 5)], {replaceFileId:'does-not-exist'}).replaced, false);
    assert.equal(close(f, 'CLOSE-4', [row('A', 5)]).replaced, false, 'A first closure creates a file');
  });

  test(`production ${script}: a failed reclosure restores rows, hidden sheets, name and description`, () => {
    let failing = false;
    const f = fixture({script, failOn:(sh, rowIndex) => failing && sh.name === '__JUSTIFICATIONS' && rowIndex === 2});
    const first = close(f, 'CLOSE-1', [row('A', 5), row('B', 4)]);
    const book = f.books.get(first.fileId), file = f.files.get(first.fileId);
    const before = JSON.stringify(book.sheets.map(s => [s.name, s.grid])), name = file.name, description = file.description;
    failing = true;
    assert.throws(() => close(f, 'CLOSE-2', [row('A', 6)], {replaceFileId:first.fileId}), /Fallo simulado/);
    assert.equal(file.trashed, false);
    assert.equal(JSON.stringify(book.sheets.map(s => [s.name, s.grid])), before);
    assert.equal(file.name, name); assert.equal(file.description, description);
    assert.equal(f.context.readFinalInventory_({spreadsheetId:first.fileId, center:'5100'}).manifest.itemCount, 2);
  });
}
