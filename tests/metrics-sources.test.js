const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../src/services/inventoryContract');
const model = require('../src/services/inventorySheetModel');
const reliability = require('../src/services/counterReliability');
const config={inventoryTypes:['CICLICO','SEMANAL','MENSUAL','BARRIDO'],getCenterCode:c=>c,
  isSameCenter:(a,b)=>a===b,findCenter:code=>({code,name:'Centro'})};
const base={SKU:'X',Almacen:'RVO6',Ubicacion:'L1',Stock_Sistema:10,Costo_Unitario:5,
  Stock_Total:10,Stock_Buen_Estado:8,Mal_estado:2,Fecha_Ultimo_Conteo:'2026-10-20T10:00:00.000Z',Responsable:'Contador'};
const url='https://docs.google.com/spreadsheets/d/copy_5100/edit#gid=123';
function moduleAt(name,mocks){
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services',name),'utf8'),{
    module,console,Date,Map,Set,require:key=>Object.hasOwn(mocks,key)?mocks[key]:require(key)
  });return module.exports;
}
function sourceFixture({active=[],history=[],remote=[],read}={}) {
  const calls=[],files=new Map();
  active.forEach((r,i)=>files.set(`/inventories/${i}.json`,r));
  history.forEach((r,i)=>files.set(`/history/${i}.json`,r));
  const service=moduleAt('metricsSourceService.js',{
    '../config':config,'./inventorySheetModel':model,'./counterReliability':reliability,
    './storagePath':{getHistoryDirectory:()=>'/history',getInventoriesDirectory:()=>'/inventories',
      listFiles:dir=>[...files.keys()].filter(f=>f.startsWith(dir+'/')).map(f=>path.posix.basename(f)),readJson:p=>files.get(p.replaceAll('\\','/'))},
    './snapshotService':{isSnapshotDeleted:r=>r?.deleted===true},
    './gasService':{extractSpreadsheetId:value=>(value.match(/\/d\/([^/]+)/)||[])[1],
      getHistoryFromGAS:async(type,center)=>{calls.push({kind:'history',type,center});return typeof remote==='function'?remote(type):remote;},
      readInventorySpreadsheet:async record=>{calls.push({kind:'read',record});return read?read(record):{
        headers:contract.columns,rows:[contract.columns.map(key=>base[key]??'')],gid:123,sheetName:'5100'};}}
  });return {service,calls};
}
function dashboard(source){return moduleAt('metricsService.js',{
  './metricsSourceService':source,'./inventoryContract':contract,'./counterReliability':reliability,'../config':config,
  './storagePath':{getInventoriesDirectory:()=>'/inventories',getHistoryDirectory:()=>'/history',getUsersFilePath:()=>'/users',readJson:()=>[]},
  './auditService':{getAuditLogs:()=>[],logAction(){}}
});}

test('parent, history and child recount become one inventory with the exact final copy link',async()=>{
  const parent={id:'INV-5100-1',type:'CICLICO',center:'5100',status:'REVISADO',items:[base],spreadsheetUrl:url};
  const f=sourceFixture({active:[parent,{...parent,id:'REC-5100-1',parentInventoryId:parent.id}],
    history:[{...parent,inventoryId:parent.id,fileId:'copy_5100',isHistory:true}],
    remote:[{inventoryId:parent.id,fileId:'copy_5100',type:'CICLICO',center:'5100',spreadsheetUrl:url}]});
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100'});
  assert.equal(metrics.availableInventories.length,1);assert.equal(metrics.summary.totalInventories,1);
  assert.equal(metrics.summary.totalItemsAudited,1);assert.equal(metrics.availableInventories[0].spreadsheetUrl,url);
  assert.equal(metrics.sourceDiagnostics[0].spreadsheetUrl,url);assert.equal(metrics.metricsComplete,true);
  assert.equal(f.calls.filter(call=>call.kind==='read').length,1);
  const selected=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100',inventoryId:'copy_5100'});
  assert.equal(selected.selectedInventory.spreadsheetUrl,url);assert.equal(selected.summary.totalInventories,1);
});

test('an orphan recount cannot generate metrics when the selector contains zero inventories',async()=>{
  const f=sourceFixture({active:[{id:'REC-5100-1',parentInventoryId:'INV-5100-1',type:'CICLICO',center:'5100',items:[base]}]});
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100'});
  assert.equal(metrics.availableInventories.length,0);assert.equal(metrics.summary.totalInventories,0);
  assert.equal(metrics.summary.totalItemsAudited,0);assert.equal(metrics.metricsValid,false);assert.equal(metrics.metricsComplete,false);
});

test('an old closure can be discovered without a local JSON snapshot',async()=>{
  const f=sourceFixture({remote:[{fileId:'copy_5100',fileName:'Inventario_CICLICO_5100_FINAL_20261001_081711',
    type:'CICLICO',center:'5100',spreadsheetUrl:url,legacy:true}]});
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100'});
  assert.equal(metrics.summary.totalInventories,1);assert.equal(metrics.metricsValid,true);
  assert.ok(metrics.sourceDiagnostics[0].warnings.some(w=>w.includes('sin manifiesto')));
});

test('corrupt archives remain listed with their link but do not enter metrics or exports',async()=>{
  for(const wrong of [{Costo_Unitario:-54541},{Stock_Buen_Estado:1900}]) {
    const f=sourceFixture({remote:[{fileId:'copy_5100',type:'CICLICO',center:'5100',spreadsheetUrl:url}],
      read:()=>({headers:contract.columns,rows:[contract.columns.map(key=>({...base,...wrong})[key]??'')],gid:123})});
    const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100'});
    assert.equal(metrics.availableInventories.length,1);assert.equal(metrics.summary.totalInventories,0);
    assert.equal(metrics.metricsValid,false);assert.equal(metrics.metricsComplete,false);
    assert.equal(metrics.sourceDiagnostics[0].status,'inconsistent');assert.equal(metrics.sourceDiagnostics[0].spreadsheetUrl,url);
  }
});

test('weekly source normalization preserves compensations and signed authorship by full item identity',async()=>{
  const evidence={version:1,drafts:{},signed:[],corrections:[],verifications:[]};
  const counted=contract.normalize({...base,Schema_Version:contract.weeklyVersion,Stock_Buen_Estado:8,Mal_estado:0,Stock_Total:8,
    Estado:'CUADRA',Cantidad_Justificada_1:2,Fecha_Primera_Justificacion:'2026-10-20T11:00:00.000Z',counterEvidence:evidence});
  const record={id:'INV-WEEKLY',type:'SEMANAL',center:'5100',status:'REVISADO',items:[counted],spreadsheetUrl:url};
  const f=sourceFixture({active:[record],read:()=>({headers:contract.weeklyHeaders,rows:[contract.weeklyColumns.map(k=>counted[k]??'')],
    schemaVersion:contract.weeklyVersion,gid:123})});
  const loaded=await f.service.load({type:'SEMANAL',center:'5100'});
  assert.equal(loaded[0].items[0].Cantidad_Fisica_Final,10);
  assert.equal(JSON.stringify(loaded[0].items[0].counterEvidence),JSON.stringify(evidence));
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'SEMANAL',center:'5100'});
  assert.equal(metrics.summary.eriItemInicial,80);assert.equal(metrics.summary.eriItemFinal,100);
});

test('recalculation re-reads the same archive without overwriting snapshots or using the master Sheet',async()=>{
  let stock=10;
  const f=sourceFixture({history:[{inventoryId:'INV',fileId:'copy_5100',type:'CICLICO',center:'5100',spreadsheetUrl:url}],
    read:()=>({headers:contract.columns,rows:[contract.columns.map(key=>({...base,Stock_Total:stock,Stock_Buen_Estado:stock-2})[key]??'')],gid:123})});
  const service=dashboard(f.service);
  assert.equal((await service.getDashboardMetrics({type:'CICLICO',center:'5100'})).summary.eriItemFinal,100);
  stock=8;
  const refreshed=await service.recalculateMetrics({type:'CICLICO',center:'5100'});
  assert.equal(refreshed.summary.eriItemFinal,80);assert.equal(refreshed.resyncedCount,1);
  assert.equal(f.calls.filter(call=>call.kind==='read').length,2);
  assert.ok(f.calls.filter(call=>call.kind==='read').every(call=>call.record.spreadsheetUrl===url));
});

test('failure discovering history is reported and a selected valid file still has verified metrics',async()=>{
  const f=sourceFixture({active:[{id:'INV',type:'CICLICO',center:'5100',status:'REVISADO',items:[base],spreadsheetUrl:url}],
    remote:()=>{throw new Error('Apps Script unavailable');}});
  const service=dashboard(f.service);
  const partial=await service.getDashboardMetrics({type:'CICLICO',center:'5100'});
  assert.equal(partial.metricsValid,true);assert.equal(partial.metricsComplete,false);
  assert.ok(partial.sourceDiagnostics.some(s=>s.issues?.includes('Apps Script unavailable')));
  const selected=await service.getDashboardMetrics({type:'CICLICO',center:'5100',inventoryId:'INV'});
  assert.equal(selected.metricsComplete,true);
});

test('different closures on the same day and with identical products are not merged',async()=>{
  const f=sourceFixture({remote:['first','second'].map(id=>({fileId:id,inventoryId:'INV-'+id,
    type:'CICLICO',center:'5100',closedAt:'2026-10-20T10:00:00.000Z',spreadsheetUrl:url.replace('copy_5100',id)}))});
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100'});
  assert.equal(metrics.availableInventories.length,2);assert.equal(metrics.summary.totalInventories,2);
  assert.equal(new Set(metrics.sourceDiagnostics.map(s=>s.spreadsheetUrl)).size,2);
});

test('period filtering skips remote reads for archives outside the requested dates',async()=>{
  const f=sourceFixture({remote:[{fileId:'copy_5100',type:'CICLICO',center:'5100',spreadsheetUrl:url,closedAt:'2026-09-01T10:00:00.000Z'}]});
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100',period:'PERSONALIZADO',
    startDate:'2026-10-01',endDate:'2026-10-20'});
  assert.equal(metrics.availableInventories.length,0);assert.equal(metrics.metricsValid,false);
  assert.equal(f.calls.filter(c=>c.kind==='read').length,0);
});

test('reopened inventories use current observations and retain the old copy as a previous closure',async()=>{
  const previous={inventoryId:'INV',fileId:'copy_5100',type:'CICLICO',center:'5100',spreadsheetUrl:url,items:[base],
    manifest:model.createManifest({id:'INV',center:'5100',type:'CICLICO',items:[base]})};
  const active={...previous,id:'INV',status:'EN_PROGRESO',reopenedAt:'2026-10-20T12:00:00.000Z',
    items:[{...base,Stock_Total:8,Stock_Buen_Estado:6}]};
  const f=sourceFixture({active:[active],history:[previous]});
  const metrics=await dashboard(f.service).getDashboardMetrics({type:'CICLICO',center:'5100',inventoryId:'INV'});
  assert.equal(metrics.summary.eriItemFinal,80);
  assert.equal(metrics.selectedInventory.previousSpreadsheetUrl,url);
  assert.equal(metrics.selectedInventory.spreadsheetUrl,undefined);
  assert.equal(metrics.sourceDiagnostics[0].source,'LOCAL_ACTIVE');
  assert.equal(f.calls.filter(c=>c.kind==='read').length,0);
});
