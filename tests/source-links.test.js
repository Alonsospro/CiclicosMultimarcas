const test = require('node:test');
const assert = require('node:assert/strict');
const hideSourceLinks = require('../src/middlewares/sourceLinkMiddleware');

const sheet = 'https://docs.google.com/spreadsheets/d/1luX2nt/edit#gid=1627169164';
const folder = 'https://drive.google.com/drive/folders/1TLSggg?usp=sharing';
const photo = 'https://drive.google.com/file/d/1abc/view';
const body = {success:true, tasks:[{inventoryId:'INV', driveFileName:'Inventario_CICLICO_5100_FINAL', spreadsheetUrl:sheet,
  driveUrl:sheet, previousSpreadsheetUrl:sheet, items:[{SKU:'A', foto_justificacion:photo, fotos_justificacion:[photo]}]}],
  sourceDiagnostics:[{name:'final', spreadsheetUrl:sheet}], folderUrl:folder, closedAt:new Date('2026-10-31T00:00:00Z')};

function send(user) {
  let sent;
  const req = {}, res = {json: value => { sent = value; return res; }};
  hideSourceLinks(req, res, () => {});
  req.user = user; // set later by the route's authenticate middleware
  res.json(body);
  return sent;
}

test('sheet and folder links reach administrators only; names and photo evidence stay visible', () => {
  for (const user of [{role:'ADMIN'}, {role:'ENCARGADO', isSuperadmin:true}]) assert.equal(send(user), body);
  for (const user of [{role:'ENCARGADO'}, {role:'AUXILIAR'}, undefined]) {
    const sent = send(user);
    const task = sent.tasks[0];
    assert.equal(task.spreadsheetUrl, null);
    assert.equal(task.driveUrl, null);
    assert.equal(task.previousSpreadsheetUrl, null);
    assert.equal(sent.sourceDiagnostics[0].spreadsheetUrl, null);
    assert.equal(sent.folderUrl, null);
    assert.equal(task.driveFileName, 'Inventario_CICLICO_5100_FINAL');
    assert.equal(task.items[0].foto_justificacion, photo);
    assert.deepEqual(task.items[0].fotos_justificacion, [photo]);
    assert.equal(sent.closedAt, body.closedAt);
  }
  assert.equal(body.tasks[0].spreadsheetUrl, sheet, 'The original object is not modified');
});
