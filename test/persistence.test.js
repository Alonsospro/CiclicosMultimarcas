const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FakeFirestore = require('./helpers/fakeFirestore');
const config = require('../src/config');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nibol-tests-'));
config.baseDataDir = temp;
config.referencePhotosDir = path.join(temp,'references');
const storage = require('../src/services/storagePath');
const cloud = require('../src/services/firebaseSyncService');
const inventory = require('../src/services/inventoryService');
const { FirebaseSyncService } = require('../src/services/firestorePersistence');
const user = { username:'tester', displayName:'Test', role:'ADMIN', center:'GLOBAL' };
const makeInv = (id='I1') => ({id,name:id,type:'CICLICO',center:'1310',status:'EN_PROGRESO',createdAt:'2026-10-01',items:[
  {id:'A',SKU:'SAME',Ubicacion:'L1',Almacen:'W1',Stock_Sistema:10,Stock_Fisico:null,Mal_estado:0,Costo_Unitario:2},
  {id:'B',SKU:'SAME',Ubicacion:'L2',Almacen:'W2',Stock_Sistema:20,Stock_Fisico:null,Mal_estado:0,Costo_Unitario:2}
]});
let fake;
beforeEach(() => {
  fake = new FakeFirestore(); global.fetch = fake.fetch;
  storage.clearMemory(); storage.knownMissing.clear(); storage.lastOperationalRefresh=0;
  cloud.records.clear(); cloud.loaded=false; cloud.lastError=null;
  fake.seed('inventories/I1.json',makeInv());
});
after(() => { fs.rmSync(temp,{recursive:true,force:true}); });
const count = (overrides={}) => inventory.updateCount({inventoryId:'I1',itemId:'A',sku:'SAME',stockFisico:5,malEstado:0,locked:true,user,operationId:'op1',expectedItemVersion:0,...overrides});

test('confirmed count survives full memory loss and a cold start',async()=>{
  const result=await count(); assert.equal(result.success,true);
  storage.clearMemory(); cloud.loaded=false;
  await storage.ensureReady();
  assert.equal(inventory.getInventoryRaw('I1').items[0].Stock_Fisico,5);
  assert.equal(fake.gasCalls.length,1);
});
test('quota failure leaves original data untouched and reports failure',async()=>{
  fake.failCommit='RESOURCE_EXHAUSTED';
  await assert.rejects(count(),e=>e.code==='RESOURCE_EXHAUSTED');
  assert.equal(fake.value('inventories/I1.json').items[0].Stock_Fisico,null);
  assert.equal(inventory.getInventoryRaw('I1').items[0].Stock_Fisico,null);
  assert.equal(fake.gasCalls.length,0);
});
test('lost acknowledgement retries the same operation exactly once',async()=>{
  fake.afterCommit=async()=>{throw new Error('connection dropped after commit');};
  await assert.rejects(count());
  const result=await count(); assert.equal(result.duplicate,true);
  assert.equal(fake.value('inventories/I1.json').items[0]._version,1);
  await storage.drainSync('I1'); assert.equal(fake.gasCalls.length,1);
});
test('failed Sheets delivery is durable and resumes after restart',async()=>{
  fake.gasFailure=true;
  const result=await count(); assert.equal(result.success,true);assert.equal(result.syncPending,true);
  assert.equal(fake.value(storage.queuePath('I1')).jobs.length,1);
  storage.clearMemory();cloud.loaded=false;fake.gasFailure=false;
  await storage.ensureReady();await storage.resumeSync();
  assert.equal(fake.value(storage.queuePath('I1')).jobs.length,0);
  assert.equal(fake.gasCalls.length,1);
});
test('same ID with a changed payload is rejected',async()=>{
  await count();await assert.rejects(count({stockFisico:7}),e=>e.code==='OPERATION_MISMATCH');
});
test('concurrent edits to one inventory preserve both rows',async()=>{
  await Promise.all([count(),count({itemId:'B',stockFisico:9,operationId:'op2'})]);
  assert.deepEqual(fake.value('inventories/I1.json').items.map(i=>i.Stock_Fisico),[5,9]);
});
test('second instance cannot commit an obsolete snapshot',async()=>{
  const a=new FirebaseSyncService(),b=new FirebaseSyncService();
  await a.queryPaths();await b.queryPaths();
  const old=b.records.get('inventories/I1.json');
  await a.commit([{rel:'inventories/I1.json',expected:a.records.get('inventories/I1.json'),data:{id:'I1',newer:true}}]);
  await assert.rejects(b.commit([{rel:'inventories/I1.json',expected:old,data:{id:'I1',stale:true}}]),e=>e.status===409);
  assert.equal(fake.value('inventories/I1.json').newer,true);
});
test('stale item version is rejected without overwriting a confirmed quantity',async()=>{
  await count();await assert.rejects(count({operationId:'op2',stockFisico:8}),e=>e.code==='ITEM_CONFLICT');
  assert.equal(fake.value('inventories/I1.json').items[0].Stock_Fisico,5);
});
test('duplicate SKU in another warehouse cannot be silently selected',async()=>{
  await assert.rejects(count({itemId:undefined,location:'L1',almacen:'W2'}));
  assert.equal(fake.value('inventories/I1.json').items[0].Stock_Fisico,null);
});
test('negative, fractional and malformed quantities are rejected',async()=>{
  for (const stockFisico of [-1,1.5,'2units',Infinity,true]) await assert.rejects(count({stockFisico}),e=>e.code==='INVALID_QUANTITY');
});
test('zero is a valid confirmed count',async()=>{
  await count({stockFisico:0});assert.equal(fake.value('inventories/I1.json').items[0].Stock_Fisico,0);
});
test('Barrido can still count a new catalogue item with its own ID',async()=>{
  const inv=makeInv('INV-BARRIDO-1310-001');inv.type='BARRIDO';inv.items=[];
  fake.seed(`inventories/${inv.id}.json`,inv);
  await count({inventoryId:inv.id,itemId:'CATALOG-17',sku:'NEW',location:'BIN',almacen:'W1',expectedItemVersion:undefined});
  const saved=fake.value(`inventories/${inv.id}.json`).items[0];
  assert.equal(saved.Stock_Fisico,5);assert.equal(saved.Almacen,'W1');assert.equal(saved._version,1);
});
test('adding a location sends the exact warehouse without changing a confirmed count',async()=>{
  await count();
  await count({isNewLocation:true,location:'NEW-BIN',stockFisico:undefined,expectedItemVersion:1,operationId:'add-location'});
  const saved=fake.value('inventories/I1.json').items[0];
  assert.equal(saved.Ubicacion_1,'NEW-BIN');assert.equal(saved.Stock_Fisico,5);
  assert.equal(fake.gasCalls.at(-1).almacen,'W1');
});
test('submission remains blocked while Sheets has unconfirmed changes',async()=>{
  fake.gasFailure=true;await count();
  await assert.rejects(inventory.submitInventoryForReview({inventoryId:'I1',user,signature:'test'}),e=>e.code==='SHEETS_PENDING');
  assert.equal(fake.value('inventories/I1.json').status,'EN_PROGRESO');
});
test('an older packaged file with more counts never overrides cloud recovery',async()=>{
  const packaged=makeInv();packaged.items.forEach(i=>i.Stock_Fisico=99);
  fs.writeFileSync(path.join(temp,'inventories','I1.json'),JSON.stringify(packaged));
  await storage.ensureReady();assert.equal(inventory.getInventoryRaw('I1').items[0].Stock_Fisico,null);
});
test('a late Sheets snapshot cannot reset an existing confirmed count',async()=>{
  await count();
  const gas=require('../src/services/gasService');const original=gas.fetchProductsFromScript;
  gas.fetchProductsFromScript=async()=>[{SKU:'SAME',Ubicacion:'L1',Almacen:'W1',Stock_Fisico:1}];
  try { await inventory.syncInventoryFromSheet({inventoryId:'I1',user}); }
  finally {gas.fetchProductsFromScript=original;}
  assert.equal(fake.value('inventories/I1.json').items[0].Stock_Fisico,5);
});
test('document limit is checked before a cloud commit',async()=>{
  await assert.rejects(cloud.commit([{rel:'inventories/huge.json',data:{value:'x'.repeat(960000)}}]),e=>e.code==='DOCUMENT_TOO_LARGE');
});
test('20 simultaneous operators preserve 20 independently confirmed counts',async()=>{
  for(let i=0;i<20;i++) fake.seed(`inventories/C${i}.json`,makeInv(`C${i}`));
  const results=await Promise.all(Array.from({length:20},(_,i)=>count({inventoryId:`C${i}`,operationId:`load-${i}`,stockFisico:i})));
  assert.equal(results.filter(r=>r.success).length,20);
  for(let i=0;i<20;i++) assert.equal(fake.value(`inventories/C${i}.json`).items[0].Stock_Fisico,i);
  assert.equal(fake.gasCalls.length,20);
});
test('failed Drive closure never marks an inventory reviewed',async()=>{
  fake.gasFailure=true;
  await assert.rejects(inventory.finishReviewAndClose({inventoryId:'I1',user}));
  assert.equal(fake.value('inventories/I1.json').status,'EN_PROGRESO');
});
test('a persistent deletion suppresses older legacy document copies',async()=>{
  fake.seed('/workspace/data/inventories/I1.json',makeInv());
  await storage.ensureReady();
  await storage.runDurable(()=>storage.deleteFile(storage.resolveFilePath('inventories/I1.json')),{scope:'I1'});
  storage.clearMemory();cloud.loaded=false;await storage.ensureReady();
  assert.equal(inventory.getInventoryRaw('I1'),null);
});
test('two simultaneous queue workers cannot deliver the same job',async()=>{
  fake.gasFailure=true;await count();fake.gasFailure=false;
  await Promise.allSettled([storage.drainSync('I1'),storage.drainSync('I1')]);
  assert.equal(fake.gasCalls.length,1);
});
test('the final inventory stores the real Drive file ID',async()=>{
  const result=await inventory.finishReviewAndClose({inventoryId:'I1',user});
  assert.equal(result.success,true);
  assert.equal(fake.value('inventories/I1.json').driveFileId,'real-drive-id');
});
test('justifications and photo references remain distinct for duplicate SKUs after restart',async()=>{
  await count();await count({itemId:'B',stockFisico:4,operationId:'count-B'});
  for (const itemId of ['A','B']) await inventory.saveJustification({inventoryId:'I1',itemId,sku:'SAME',justification:`Evidence ${itemId}`,reasonType:'AJUSTE_INVENTARIO',corroboration:'NO_CUADRA',photoUrl:`https://drive.google.com/file/d/photo-${itemId}/view`,driveFileId:`photo-${itemId}`,user});
  storage.clearMemory();cloud.loaded=false;await storage.ensureReady();
  const justifications=inventory.getJustificationsForInventory('I1');
  assert.equal(justifications.length,2);
  for (const itemId of ['A','B']) {
    const record=justifications.find(j=>j.itemId===itemId);
    assert.equal(record.driveFileId,`photo-${itemId}`);
    assert.match(record.photoUrl,new RegExp(`photo-${itemId}`));
  }
});
