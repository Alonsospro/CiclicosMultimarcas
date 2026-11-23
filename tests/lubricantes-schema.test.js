const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const contract = require('../src/services/inventoryContract');

// Loads the real gasService with the Apps Script transport replaced by a recorder.
// storagePath is stubbed so the test never loads the Firestore connection.
function gasService(reply = () => ({success:true})) {
  const file = name => path.join(__dirname, '../src/services', name + '.js');
  const service = file('gasService'), stubs = {[file('gasTransport')]:async (url, body) => { requests.push(body); return reply(body); },
    [file('storagePath')]:{}};
  const requests = [];
  delete require.cache[service];
  for (const [name, exports] of Object.entries(stubs)) require.cache[name] = {id:name, filename:name, loaded:true, exports};
  try { return {gas:require(service), requests}; }
  finally { for (const name of [service, ...Object.keys(stubs)]) delete require.cache[name]; }
}

const weeklyRow = contract.weeklyColumns.map(key => ({SKU:'JD_TY26812', Descripcion:'ACEITE GL5', Ubicacion:'LUBRICANTE',
  Almacen:'CD01', Costo_Unitario:228.28, Stock_Sistema:219})[key] ?? '');

test('Lubricantes (MENSUAL) and Cíclicos use the 44-column schema like Semanales; Barrido stays apart', () => {
  assert.equal(contract.usesWeeklySchema('MENSUAL'), true);
  assert.equal(contract.usesWeeklySchema('mensuales'), true);
  assert.equal(contract.usesWeeklySchema('SEMANAL'), true);
  assert.equal(contract.usesWeeklySchema('CICLICO'), true);
  assert.equal(contract.isWeeklyType('CICLICO'), false, 'Weekly-only rules stay for Semanales');
  assert.equal(contract.usesWeeklySchema('BARRIDO'), false);
  assert.equal(contract.isWeeklyType('MENSUAL'), false, 'Weekly-only rules stay for Semanales');
});

test('Lubricantes reads the center sheet with the 44 columns', async () => {
  const {gas} = gasService(() => ({success:true, schemaVersion:contract.weeklyVersion, items:[weeklyRow]}));
  const [item] = await gas.fetchProductsFromScript('MENSUAL', '1120');
  assert.equal(item.Schema_Version, contract.weeklyVersion);
  assert.equal(item.Almacen, 'CD01');
  assert.equal(item.Stock_Sistema, 219);
});

test('Lubricantes refuses an Apps Script that still answers with 40 columns', async () => {
  const {gas} = gasService(() => ({success:true, items:[]}));
  await assert.rejects(gas.fetchProductsFromScript('MENSUAL', '1120'), /44 columnas/);
});

test('Lubricantes and Cíclicos writes declare the 44-column schema; Barrido does not', async () => {
  const {gas, requests} = gasService();
  await gas.upsertCountToGAS('MENSUAL', {center:'1120', sku:'JD_TY26812', almacen:'CD01', location:'LUBRICANTE'});
  await gas.batchUpsertCountsToGAS('MENSUAL', {center:'1120', updates:[]});
  await gas.saveJustificationToGAS('MENSUAL', {center:'1120', sku:'JD_TY26812'});
  await gas.batchUpsertCountsToGAS('CICLICO', {center:'1120', updates:[]});
  await gas.upsertCountToGAS('BARRIDO', {center:'1120', sku:'X'});
  assert.deepEqual(requests.map(r => r.schemaVersion), [contract.weeklyVersion, contract.weeklyVersion, contract.weeklyVersion, contract.weeklyVersion, undefined]);
});
