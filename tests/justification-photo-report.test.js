const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildRows, photoStatus, attachDrivePhotos } = require('../src/services/justificationPhotoReport');

const DRIVE = 'https://drive.google.com/file/d/abc/view';
const record = (fields = {}) => ({inventoryId:'INV-1120-7', sku:'SKU-1', almacen:'A1', ubicacion:'U1', round:1, corroboracion:'NO CUADRA',
  reasonType:'otro', justification:'Texto', reviewedAt:'2026-11-01T10:00:00.000Z', ...fields});

test('the justification form offers the new reasons, and they still need a photo', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const select = page.slice(page.indexOf('id="just-select-reason"'), page.indexOf('</select>', page.indexOf('id="just-select-reason"')));
  const reasons = [...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)];
  assert.equal(reasons.at(-1)[1], 'otro');
  for (const reason of ['Mal Ubicado', 'Error de Typeo', 'Sobrestock', 'Empaque Diferente', 'Empaque Similar', 'Sin Justificación']) {
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

const row = (fields = {}) => ({inventoryId:'INV-1120-1', inventoryName:'Semana 1', suffix:'1', type:'SEMANAL', center:'1120', sku:'SKU/1', almacen:'A1',
  round:1, links:[], status:'falta', ...fields});
const launches = [
  {id:'INV-1120-1', center:'1120', type:'SEMANAL', createdAt:'2026-10-01T12:00:00.000Z'},
  {id:'INV-1120-2', center:'1120', type:'SEMANAL', createdAt:'2026-10-08T12:00:00.000Z'},
  {id:'INV-1300-3', center:'1300', type:'SEMANAL', createdAt:'2026-10-03T12:00:00.000Z'}
];
const driveFile = (fields = {}) => ({id:'F1', name:'JUST-SKU_1-A1.jpg', url:DRIVE, createdAt:'2026-10-02T15:00:00.000Z', center:'1120', type:'SEMANAL', folderDate:'2026-10-02', ...fields});

test('a photo uploaded days later is found in Drive and reported as not linked', () => {
  const [found] = attachDrivePhotos([row()], launches, [driveFile()]);
  assert.equal(found.status, 'en_drive');
  assert.deepEqual(found.links, [DRIVE]);
  assert.deepEqual(found.driveFolders, ['2026-10-02']);
});

test('a Drive photo never crosses into another group, week, center or type', () => {
  const stays = file => attachDrivePhotos([row()], launches, [driveFile(file)])[0].status;
  assert.equal(stays({createdAt:'2026-10-07T23:00:00.000Z'}), 'en_drive', 'last moment of its own week');
  assert.equal(stays({createdAt:'2026-10-08T13:00:00.000Z'}), 'falta', 'the next week');
  assert.equal(stays({createdAt:'2026-09-30T13:00:00.000Z'}), 'falta', 'the previous week');
  assert.equal(stays({center:'1300'}), 'falta');
  assert.equal(stays({type:'CICLICO'}), 'falta');
  assert.equal(stays({name:'JUST-OTRO-A1.jpg'}), 'falta');
  const later = attachDrivePhotos([row({inventoryId:'INV-1120-2', suffix:'2'})], launches, [driveFile({createdAt:'2026-10-02T15:00:00.000Z'})]);
  assert.equal(later[0].status, 'falta', 'an earlier week does not fill a later one');
});

test('a Drive photo linked to another row, or claimed by one, is not used twice', () => {
  const linked = row({sku:'OTRO', status:'con_foto', links:['https://drive.google.com/file/d/F1/view']});
  assert.equal(attachDrivePhotos([row(), linked], launches, [driveFile()]).find(entry => entry.sku === 'SKU/1').status, 'falta');
  const rounds = attachDrivePhotos([row(), row({round:2})], launches, [driveFile()]);
  assert.deepEqual(rounds.map(entry => [entry.round, entry.status]).sort(), [[1, 'en_drive'], [2, 'falta']]);
});

test('Drive is not searched when no row of the selected group is missing a photo', async () => {
  const report = require('../src/services/justificationPhotoReport');
  const none = await report.getReport({suffix:'NO-EXISTE'}, async () => { throw new Error('no debe consultarse'); });
  assert.deepEqual(JSON.parse(JSON.stringify(none)), {rows:[], drive:{checked:true, truncated:false, error:''}});
});

for (const script of ['InventoryWebhook.gs', 'InventoryWebhookSemanales.gs']) {
  test(`produccion/${script}: lists photos from every date folder of one center and type, read-only`, () => {
    const source = fs.readFileSync(path.join(__dirname, '../integrations/apps-script/produccion', script), 'utf8');
    assert.match(source, /'diagnostic','listJustificationPhotos'\];/);
    const body = source.slice(source.indexOf('function listJustificationPhotos_'), source.indexOf('function dispatchRead_'));
    assert.doesNotMatch(body, /createFile|createFolder|setTrashed|getOrCreateFolder_|setSharing/);
    const iterator = values => { let i = 0; return {hasNext:() => i < values.length, next:() => values[i++]}; };
    const file = id => ({getId:() => id, getName:() => `JUST-${id}.jpg`, getUrl:() => `u/${id}`, getDateCreated:() => new Date('2026-10-02T00:00:00.000Z')});
    const group = (name, ids) => ({getName:() => name, getFiles:() => iterator(ids.map(file))});
    const date = (name, groups) => ({getName:() => name, getFolders:() => iterator(groups)});
    const root = {getFolders:() => iterator([
      date('2026-10-01', [group('1120 SEMANAL', ['A']), group('1300 SEMANAL', ['B']), group('1120 CICLICO', ['C'])]),
      date('2026-10-02', [group('1120 SEMANAL', ['D'])])
    ])};
    const context = {getDriveFolder_:() => root, property_:() => '', CFG:{photoRoots:{justificaciones:'ROOT'}}, Date};
    vm.runInNewContext(body, context);
    const all = context.listJustificationPhotos_({type:'SEMANAL', center:'1120'});
    assert.deepEqual(Array.from(all.files, entry => [entry.id, entry.folderDate]), [['A', '2026-10-01'], ['D', '2026-10-02']]);
    assert.equal(all.truncated, false);
    assert.equal(context.listJustificationPhotos_({type:'SEMANAL'}).files.length, 3);
  });
}
