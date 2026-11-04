const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRows, photoStatus } = require('../src/services/justificationPhotoReport');

const DRIVE = 'https://drive.google.com/file/d/abc/view';
const record = (fields = {}) => ({inventoryId:'INV-1120-7', sku:'SKU-1', almacen:'A1', ubicacion:'U1', round:1, corroboracion:'NO CUADRA',
  reasonType:'otro', justification:'Texto', reviewedAt:'2026-11-01T10:00:00.000Z', ...fields});

test('the justification form offers the new reasons, and they still need a photo', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const select = page.slice(page.indexOf('id="just-select-reason"'), page.indexOf('</select>', page.indexOf('id="just-select-reason"')));
  const reasons = [...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)];
  assert.equal(reasons.at(-1)[1], 'otro');
  for (const reason of ['Mal Ubicado', 'Error de Typeo', 'Sobrestock', 'Empaque Diferente', 'Empaque Similar']) {
    assert.ok(reasons.some(option => option[1] === reason && option[2] === reason), reason);
    assert.equal(photoStatus(record({corroboracion:'CUADRA', reasonType:reason})), 'falta', reason);
  }
});

test('only CUADRA with Error de Conteo or Balanceo goes without a photo', () => {
  assert.equal(photoStatus(record({corroboracion:'CUADRA', reasonType:'Error de Conteo'})), 'no_requiere');
  assert.equal(photoStatus(record({corroboracion:'CUADRA', reasonType:'balanceo'})), 'no_requiere');
  assert.equal(photoStatus(record({corroboracion:'CUADRA', reasonType:'transferencia'})), 'falta');
  assert.equal(photoStatus(record({reasonType:'Error de Conteo'})), 'falta');
  assert.equal(photoStatus(record({reasonType:'balanceo'})), 'falta');
});

test('a photo counts as saved only with a Drive link or file id', () => {
  assert.equal(photoStatus(record({photoUrl:DRIVE})), 'con_foto');
  assert.equal(photoStatus(record({photoUrls:[{photoUrl:DRIVE}]})), 'con_foto');
  assert.equal(photoStatus(record({photoUrl:'/api/photos/PHOTO-1.jpg', driveFileId:'abc'})), 'con_foto');
  assert.equal(photoStatus(record({photoUrl:'/api/photos/PHOTO-1.jpg'})), 'por_confirmar');
  assert.equal(photoStatus(record({photoUrl:'https://evil.example/drive.google.com/x'})), 'por_confirmar');
});

test('forced closures stay apart from missing photos', () => {
  assert.equal(photoStatus(record({forced:true, reasonType:'CIERRE FORZADO'})), 'cierre_forzado');
  assert.equal(photoStatus(record({reasonType:'CIERRE FORZADO'})), 'cierre_forzado');
});

test('archived reviews are skipped and missing photos come first', () => {
  const rows = buildRows({records:[
    record({sku:'WITH', photoUrl:DRIVE}),
    record({sku:'OLD', superseded:true}),
    record({sku:'MISSING'})
  ]});
  assert.deepEqual(rows.map(row => [row.sku, row.status]), [['MISSING', 'falta'], ['WITH', 'con_foto']]);
});

test('a recount is reported under its parent inventory with one photo per link', () => {
  const inventories = [{id:'INV-1120-7', name:'Inventario 7', center:'1120', type:'CICLICO'},
    {id:'REC-INV-1120-7', parentInventoryId:'INV-1120-7', name:'Reconteo', center:'1120', type:'CICLICO'}];
  const [row] = buildRows({inventories, records:[record({inventoryId:'REC-INV-1120-7', round:2, driveUrl:DRIVE, photoUrl:DRIVE, photoUrls:[{photoUrl:DRIVE}]})]});
  assert.equal(row.inventoryName, 'Inventario 7');
  assert.equal(row.suffix, '7');
  assert.equal(row.round, 2);
  assert.deepEqual(row.links, [DRIVE]);
});

test('justified rows without a record are reported, and rows supply a photo the record lost', () => {
  const item = sku => ({SKU:sku, Almacen:'A1', Ubicacion:'U1', Estado:'NO CUADRA', Razon:'otro', Comentario_Justificacion:'Texto',
    Fecha_Primera_Justificacion:'2026-11-01T10:00:00.000Z', foto_justificacion:DRIVE, fotos_justificacion:[DRIVE]});
  const inventories = [{id:'INV-1120-7', name:'Inventario 7', center:'1120', type:'BARRIDO',
    items:[item('ROW-ONLY'), item('LOST'), {SKU:'UNJUSTIFIED', Almacen:'A1', Ubicacion:'U1'}]}];
  const rows = buildRows({inventories, records:[record({sku:'LOST'})]});
  assert.deepEqual(rows.map(row => [row.sku, row.status]), [['LOST', 'con_foto'], ['ROW-ONLY', 'con_foto']]);
});
