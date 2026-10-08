const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const contract=require('../src/services/inventoryContract');
const root=path.join(__dirname,'..');
function isolated(file,mocks={},globals={}){
  const module={exports:{}};
  const sandbox={module,exports:module.exports,console:{log(){},warn(){},error(){}},Date,Map,Set,Intl,
    require(name){if(Object.hasOwn(mocks,name))return mocks[name];if(['fs','path','crypto'].includes(name))return require(name);throw new Error('Unmocked dependency: '+name);},...globals};
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox,{filename:file});
  return module.exports;
}
const base={SKU:'X',Almacen:'A',Ubicacion:'LOC',Costo_Unitario:5,Stock_Sistema:10,Stock_Buen_Estado:8,Mal_estado:2,Stock_Total:10,Diferencia:0};
test('reading a sheet total does not turn damaged stock into good stock',()=>{
  assert.equal(contract.normalize({...base,Stock_Fisico:10}).Stock_Fisico,8);
});
test('count and CUADRA use the new total',()=>{
  const r=contract.update(base,{stockBuenEstado:9,malEstado:2,isCuadra:true});
  assert.equal(r.Stock_Sistema,11);assert.equal(r.Stock_Total,11);assert.equal(r.Diferencia,0);
});
test('second justification resolves latest recount and restores the original stock on reversal',()=>{
  const counted={...base,Reconteo:10,Malestado_Reconteo:2,Stock_Total_Reconteo:12};
  const resolved=contract.update(counted,{round:2,isCuadra:true});
  assert.equal(resolved.Stock_Sistema,12);assert.equal(resolved.Diferencia_Final,0);
  const restored=contract.update(resolved,{round:2,isCuadra:false,originalStockSistema:20});
  assert.equal(restored.Diferencia,-10);assert.equal(restored.Diferencia_Final,-8);
});
test('location-only edits preserve counts and allow explicit clearing',()=>{
  const r=contract.update({...base,Stock_Sistema:12,Ubicacion_1:'E',Ubicacion_2:'F'},{ubicacion1:'F',ubicacion2:''});
  assert.equal(r.Ubicacion_2,'');assert.equal(r.Stock_Total,10);assert.equal(r.Diferencia,0);
  assert.throws(()=>contract.update(base,{ubicacion1:'LOC'}),/duplicadas/);
});
test('quantities and totals are validated before writing',()=>{
  for(const value of [true,-1,1.5,'invalid'])assert.throws(()=>contract.update(base,{stockBuenEstado:value}));
  assert.throws(()=>contract.update(base,{stockBuenEstado:8,malEstado:2,stockTotal:100}),/inconsistente/);
});
test('final records retain all forty columns including both rounds',()=>{
  const r=contract.finalItem({...base,Ubicacion_1:'E',Reconteo_2:9,Malestado_Reconteo_2:1,Estado_Justificacion_2:'CUADRA'});
  assert.equal(Object.keys(r).length,40);assert.equal(r.Reconteo_2,9);assert.equal(r.Stock_Total_Reconteo_2,10);assert.equal(r.Almacen,'A');
});
function inventoryService(gas,allowed=true){
  const records=new Map();
  const service=isolated('src/services/inventoryService.js',{
    './inventoryContract':contract,'../config':{centersList:[{code:'1120'},{code:'1160'}],findCenter:v=>['1120','1160'].includes(v)?{code:v}:null},
    './storagePath':{getInventoriesDirectory:()=>'/fake',getJustificationsDirectory:()=>'/fake-just'},
    './auditService':{logAction(){},logCount(){}},'./driveService':{getPhotoAsDataUri:()=>''},'./gasService':gas,'./metricsService':{},'./snapshotService':{},
    '../middlewares/authMiddleware':{isBulkInventoryCreator:()=>allowed}
  });
  service.getInventoryRaw=id=>records.get(id);
  service.saveInventory=inv=>records.set(inv.id,inv);
  return {service,records};
}
const user={username:'test'};
test('bulk loads each center, clears inherited counts and reports failed centers',async()=>{
  const calls=[];
  const {service,records}=inventoryService({fetchProductsFromScript:async(type,center)=>{
    calls.push(center);if(center==='1160')throw new Error('Sheets unavailable');return [base];
  }});
  const first=await service.bulkCreateInventories({date:'2026-10-08',centers:['1120','1120','1160'],user});
  assert.equal(first.count,1);assert.equal(first.failedCount,1);assert.equal(records.size,1);
  assert.deepEqual(calls,['1120','1160']);
  const item=first.results[0].inventory.items[0];
  assert.equal(item.Stock_Sistema,10);assert.equal(item.Stock_Fisico,null);assert.equal(item.Almacen,'A');
  const retry=await service.bulkCreateInventories({date:'2026-10-08',centers:['1120'],user});
  assert.equal(retry.count,0);assert.equal(retry.existingCount,1);assert.equal(calls.length,2);
});
test('bulk rejects invalid inputs and does not create empty inventories',async()=>{
  const {service,records}=inventoryService({fetchProductsFromScript:async()=>[]});
  await assert.rejects(service.bulkCreateInventories({centers:[],user}));
  await assert.rejects(service.bulkCreateInventories({centers:['9999'],user}));
  await assert.rejects(service.bulkCreateInventories({type:'INVALID',user}));
  await assert.rejects(service.bulkCreateInventories({date:'2026-02-31',user}));
  const result=await service.bulkCreateInventories({date:'2026-10-08',centers:['1120'],user});
  assert.equal(result.failedCount,1);assert.equal(records.size,0);
  const forbidden=inventoryService({},false).service;
  await assert.rejects(forbidden.bulkCreateInventories({user}));
});
function transport(fetch){
  return isolated('src/services/gasTransport.js',{},{
    process:{env:{APPS_SCRIPT_TOKEN:'test-only'}},fetch,AbortSignal:{timeout:()=>null},setTimeout:fn=>fn()
  });
}
test('transport preserves identity/original stock and retries with the same operationId',async()=>{
  const bodies=[];
  const request=transport(async(url,opts)=>{
    bodies.push(JSON.parse(opts.body));
    return {ok:true,text:async()=>JSON.stringify(bodies.length===1?{success:false,retryable:true,error:'Busy'}:{success:true})};
  });
  await request('mock://gas',{action:'upsertCount',originalStockSistema:20,inventoryId:'INV',round:2});
  assert.equal(bodies.length,2);assert.equal(bodies[0].operationId,bodies[1].operationId);
  assert.equal(bodies[1].originalStockSistema,20);assert.equal(bodies[1].round,2);
});
test('invalid or failed responses never become success',async()=>{
  await assert.rejects(transport(async()=>({ok:true,text:async()=>'<html>Error</html>'}))('mock://gas',{}),/no JSON/);
  await assert.rejects(transport(async()=>({ok:true,text:async()=>JSON.stringify({success:false,error:'Denied'})}))('mock://gas',{}),/Denied/);
  await assert.rejects(transport(async()=>({ok:true,text:async()=>JSON.stringify({success:true})}))('mock://gas',{}, {file:true}),/identificador/);
});
test('closure fails on a remote error and adopts the real Drive id on success',async()=>{
  let fail=true,captured;const saved=[];
  const drive=isolated('src/services/driveService.js',{
    './inventoryContract':contract,'../config':{},'./storagePath':{getHistoryDirectory:()=>'/history',getPhotosDirectory:()=>'/photos',writeJson:(p,v)=>saved.push(v)},
    './gasService':{syncFinalInventoryToGAS:async(type,payload)=>{
      captured=payload;if(fail)throw new Error('Google failed');
      return {success:true,fileId:'real-google-id',fileName:'final',spreadsheetUrl:'https://example.test/sheet',manifest:{itemCount:1}};
    }}
  });
  const args={inventory:{id:'INV',type:'CICLICO',center:'1120',closeOperationId:'CLOSE',items:[{...base,Reconteo_2:9,Malestado_Reconteo_2:1}]},justifications:[],user};
  await assert.rejects(drive.createFinalDriveFile(args),/Google failed/);assert.equal(saved.length,0);
  fail=false;const result=await drive.createFinalDriveFile(args);
  assert.equal(result.fileId,'real-google-id');assert.equal(captured.driveRecord.items[0].Almacen,'A');
  assert.equal(captured.driveRecord.items[0].Reconteo_2,9);assert.equal(saved.length,1);
});
test('Apps Script and Node share exactly the same quantity contract',()=>{
  const server=fs.readFileSync(path.join(root,'src/services/inventoryContract.js'),'utf8').replace("if (typeof module !== 'undefined') module.exports = InventoryContract;",'');
  const gas=fs.readFileSync(path.join(root,'integrations/apps-script/InventoryWebhook.gs'),'utf8');
  assert.ok(gas.includes(server));
  new vm.Script(gas);
});

test('count update waits for Sheets and sends only the requested second recount',async()=>{
  let payload;
  const {service,records}=inventoryService({upsertCountToGAS:async(type,p)=>{
    payload=p;return {success:true,item:contract.update(base,p)};
  }});
  const inv={id:'INV',type:'CICLICO',center:'1120',phase:'RECONTEO_2',items:[{...base,id:'I'}]};
  records.set('INV',inv);
  const result=await service.updateCount({inventoryId:'INV',itemId:'I',stockFisico:11,malEstado:2,user:{role:'ADMIN',username:'test'}});
  assert.equal(payload.isReconteo2,true);assert.equal(payload.reconteo,undefined);
  assert.equal(payload.stockBuenEstado,undefined);
  assert.equal(result.item.Stock_Total,10);assert.equal(result.item.Stock_Total_Reconteo_2,13);
});
test('a failed count never saves a parent recount',async()=>{
  const {service,records}=inventoryService({upsertCountToGAS:async()=>{throw new Error('Sheets down');}});
  records.set('REC-I',{id:'REC-I',type:'CICLICO',center:'1120',phase:'RECONTEO',parentInventoryId:'P',items:[{...base,id:'I'}]});
  records.set('P',{id:'P',items:[{...base,id:'I'}]});
  const original=service.getInventoryRaw;
  service.getInventoryRaw=id=>JSON.parse(JSON.stringify(original(id)));
  let saves=0;service.saveInventory=()=>saves++;
  await assert.rejects(service.updateCount({inventoryId:'REC-I',itemId:'I',stockFisico:11,malEstado:2,user:{role:'ADMIN',username:'test'}}),/Sheets down/);
  assert.equal(saves,0);assert.equal(records.get('P').items[0].Reconteo,undefined);
});
