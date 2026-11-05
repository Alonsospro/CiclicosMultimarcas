const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../src/services/inventoryContract');
const workflow = require('../src/services/inventoryWorkflow');
const reliability = require('../src/services/counterReliability');
const root = path.join(__dirname, '..');
const user = {role:'ADMIN', username:'reviewer', displayName:'Reviewer'};
const old = '2020-01-01T00:00:00.000Z';
const counted = (sku = 'A', warehouse = 'R001') => contract.normalize({id:sku+warehouse, SKU:sku, Almacen:warehouse,
  Ubicacion:'LOC', Stock_Sistema:10, Costo_Unitario:5, Stock_Buen_Estado:8, Mal_estado:0, Fecha_Ultimo_Conteo:old});

function fixture({countSheetSync='inmediato'}={}) {
  const files = new Map(), sheets = new Map(), gasCalls = [], closures = [], batches = [];
  const failures = {drive:false, batch:null};
  let held = null;
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const store = {
    getInventoriesDirectory:()=>'/inventories', getJustificationsDirectory:()=>'/justifications',
    readJson:(file, fallback)=>files.has(file)?clone(files.get(file)):fallback,
    writeJson:(file, value)=>files.set(file,clone(value)),
    listFiles:dir=>[...files.keys()].filter(file=>path.dirname(file)===path.normalize(dir)).map(file=>path.basename(file))
  };
  const gasContext = vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(root,'integrations/apps-script/InventoryWebhook.gs'),'utf8'),gasContext);
  const gas = {
    saveJustificationToGAS:async(type,p)=>{
      const item=sheets.get(contract.member(p));
      gasContext.validateJustificationStage_(item,p);
      gasCalls.push(p);
      const updated=contract.update(item,p); sheets.set(contract.member(p),updated);
      return {item:updated};
    },
    batchUpsertCountsToGAS:async(type,p)=>{
      batches.push(p);
      if(held)await held;
      if(failures.batch==='network')throw new Error('Google no respondió');
      const failedItems=[];
      p.updates.forEach((update,index)=>{
        try{
          if(failures.batch===update.sku)throw new Error('Ítem no encontrado');
          const item=sheets.get(contract.member(update));
          if(update.action==='saveJustification')gasContext.validateJustificationStage_(item,update);
          sheets.set(contract.member(update),contract.update(item,update));
        }catch(error){failedItems.push({index,sku:update.sku,error:error.message});}
      });
      if(failedItems.length)throw Object.assign(new Error('Lote incompleto'),{result:{success:false,failedItems}});
      return {success:true};
    },
    upsertCountToGAS:async(type,p)=>{
      const updated=contract.update(sheets.get(contract.member(p)),p);
      sheets.set(contract.member(p),updated); gasCalls.push(p); return {item:updated};
    }
  };
  const mocks = {
    './counterReliability':require('../src/services/counterReliability'),
    './inventoryContract':contract,'./inventoryWorkflow':workflow,'../config':{countSheetSync,isSameCenter:(a,b)=>a===b},
    './storagePath':store,'./auditService':new Proxy({}, {get:()=>()=>{}}),
    './gasService':gas,'./metricsService':{},'./snapshotService':{},'../../public/js/justificationPhotoRule':require('../public/js/justificationPhotoRule'),
    './driveService':{getPhotoAsDataUri:()=>failures.photo||'',createFinalDriveFile:async p=>{
      if(failures.drive)throw new Error('Drive no disponible');
      closures.push(clone(p)); return {fileId:'drive-id',fileName:'final',spreadsheetUrl:'https://example.test/final'};
    }}
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/services/inventoryService.js'),'utf8'),{
    module,console,Date,Map,Set,Intl,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name)
  });
  const service=module.exports;
  const put = inv=>{
    store.writeJson(path.join('/inventories',inv.id+'.json'),inv);
    inv.items.forEach(item=>sheets.set(contract.member(item),clone(item)));
  };
  const save = (invId,item,decision,round=1,text='Se verificaron las existencias y documentos.',justifiedQuantity)=>service.saveJustification({
    inventoryId:invId,sku:item.SKU,itemId:item.id,almacen:item.Almacen,location:item.Ubicacion,
    round,corroboracion:decision,reasonType:'balanceo',justification:text,justifiedQuantity,user
  });
  return {service,gas,files,sheets,gasCalls,closures,batches,failures,put,save,gasContext,holdBatches:gate=>{held=gate;}};
}

test('weekly physical verification uses signed author, checks role/center and never changes Sheets', async () => {
  const {service, put, gasCalls} = fixture();
  const item = {...counted(), Schema_Version:contract.weeklyVersion};
  put({id:'INV-SEMANAL-1120-1', type:'SEMANAL', center:'1120', name:'Semanal', status:'EN_PROGRESO', items:[item]});
  const id = 'INV-SEMANAL-1120-1';
  await service.updateCount({inventoryId:id, itemId:item.id, stockFisico:8, malEstado:0, user});
  service.submitInventoryForReview({inventoryId:id, user});
  const row = service.getPhysicalReviews(id, user).rows[0];
  assert.equal(row.ready, true); assert.equal(row.signed[0].actor.username, user.username);
  const input = {itemId:item.id, revision:row.revision, requestId:'physical-test-123', good:8, bad:0,
    comparable:true, physicallyChecked:true, reason:'Comprobación física realizada sin movimientos.'};
  const calls = gasCalls.length;
  assert.throws(() => service.savePhysicalReview(id, input, {...user, role:'AUXILIAR', center:'1120'}), /encargado o administrador/);
  assert.throws(() => service.savePhysicalReview(id, input, {...user, role:'ENCARGADO', center:'1160'}), /fuera de su centro/);
  assert.throws(() => service.getPhysicalReviews('../escape', user), /Identificador/);
  service.savePhysicalReview(id, input, {...user, role:'ENCARGADO', center:'1120'});
  assert.equal(gasCalls.length, calls);
  const stored = service.getInventoryRaw(id);
  assert.equal(stored.items[0].Stock_Total,8); assert.equal(stored.items[0].Stock_Sistema,10);
  assert.equal(reliability.summarize([stored]).workers[0].selfVerified, 1);
  await service.reopenInventory({inventoryId:id,user,reason:'Validar nueva cantidad',syncFromGAS:false});
  assert.equal(service.getPhysicalReviews(id,user).rows[0].ready,false);
  assert.equal(reliability.summarize([service.getInventoryRaw(id)]).verified,0);
  assert.equal(service.getInventoryRaw(id).items[0].counterEvidence.verifications.length,1);
});

test('weekly recount keeps both stage authors and pending verification until signed', async () => {
  const {service,put,save} = fixture(); const item = {...counted(), Schema_Version:contract.weeklyVersion};
  put({id:'WEEK',type:'SEMANAL',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[item]});
  await service.updateCount({inventoryId:'WEEK',itemId:item.id,stockFisico:8,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:'WEEK',user});
  await save('WEEK',item,'NO CUADRA');
  const child = service.enableRecount({inventoryId:'WEEK',user}).recountInventory;
  await service.updateCount({inventoryId:child.id,itemId:child.items[0].id,stockFisico:10,malEstado:0,user:{...user,username:'second-counter'}});
  assert.equal(service.getPhysicalReviews('WEEK',user).rows[0].ready,false);
  service.submitInventoryForReview({inventoryId:child.id,user});
  const row = service.getPhysicalReviews('WEEK',user).rows[0];
  assert.equal(row.ready,true); assert.equal(row.signed.length,2);
  service.savePhysicalReview('WEEK',{itemId:item.id,revision:row.revision,requestId:'recount-verification',
    comparable:true,physicallyChecked:true,good:10,bad:0,reason:'Conteo físico de diez piezas confirmado.'},user);
  const result = reliability.summarize([service.getInventoryRaw('WEEK')]);
  assert.equal(result.verified,2); assert.equal(result.correct,1);
  assert.equal(service.getInventoryRaw(child.id).items[0].counterEvidence.verifications.length,1);
});

test('weekly CUADRA without recount can close with L reconciled, K/M preserved and physical reliability unchanged', async () => {
  const {service,put,save,gasCalls,closures}=fixture();
  const item={...counted(),Schema_Version:contract.weeklyVersion};
  put({id:'WEEK-COMP',type:'SEMANALES',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[item]});
  await service.updateCount({inventoryId:'WEEK-COMP',itemId:item.id,stockFisico:8,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:'WEEK-COMP',user});
  const signedBefore=JSON.stringify(service.getInventoryRaw('WEEK-COMP').items[0].counterEvidence.signed);
  const calls=gasCalls.length;
  await assert.rejects(save('WEEK-COMP',item,'CUADRA',1,'Cantidad equivocada.',3),/debe ser 2/);
  assert.equal(gasCalls.length,calls);
  // CUADRA compensates automatically; no quantity has to be typed.
  await save('WEEK-COMP',item,'CUADRA',1,'Dos unidades compensadas con documento.');
  const stored=service.getInventoryRaw('WEEK-COMP');
  assert.equal(stored.items[0].Stock_Sistema,10);
  assert.equal(stored.items[0].Stock_Total,8);
  assert.equal(stored.items[0].Cantidad_Fisica_Final,10);
  assert.equal(service.getReviewPlan(stored).canClose,true);
  assert.equal(JSON.stringify(stored.items[0].counterEvidence.signed),signedBefore);
  assert.equal(reliability.summarize([stored]).verified,0);
  await service.finishReviewAndClose({inventoryId:'WEEK-COMP',user});
  assert.equal(closures.length,1);
  assert.equal(closures[0].inventory.items[0].Cantidad_Justificada_1,2);
});

test('a weekly photo-only update preserves physical quantities, date and signed evidence',async()=>{
  const {service,put,gasCalls}=fixture();
  const item=contract.normalize({...counted(),Schema_Version:contract.weeklyVersion,Stock_Buen_Estado:7,Stock_Total:8,Mal_estado:1});
  put({id:'PHOTO-WEEK',type:'SEMANALES',center:'1120',status:'EN_PROGRESO',items:[item]});
  await service.updateCount({inventoryId:'PHOTO-WEEK',itemId:item.id,photoUrl:'https://example.test/photo.jpg',user});
  const payload=gasCalls.at(-1);
  assert.equal(payload.stockBuenEstado,undefined);
  assert.equal(payload.malEstado,undefined);
  const stored=service.getInventoryRaw('PHOTO-WEEK').items[0];
  assert.equal(stored.Stock_Total,8);
  assert.equal(stored.Mal_estado,1);
  assert.equal(stored.Fecha_Ultimo_Conteo,old);
  assert.equal(stored.counterEvidence,undefined);
});

for (const quantity of [9,10,11]) {
  test(`weekly signed recount ${quantity} requires its own review and exports the final compensation in AK`,async()=>{
    const {service,put,save,closures}=fixture();
    const item={...counted(),Schema_Version:contract.weeklyVersion};
    put({id:'WEEK-REC',type:'SEMANALES',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[item]});
    await service.updateCount({inventoryId:'WEEK-REC',itemId:item.id,stockFisico:8,malEstado:0,user});
    service.submitInventoryForReview({inventoryId:'WEEK-REC',user});
    await save('WEEK-REC',item,'NO CUADRA');
    const child=service.enableRecount({inventoryId:'WEEK-REC',user}).recountInventory;
    await service.updateCount({inventoryId:child.id,itemId:child.items[0].id,stockFisico:quantity,malEstado:0,user});
    service.submitInventoryForReview({inventoryId:child.id,user});
    await assert.rejects(service.finishReviewAndClose({inventoryId:'WEEK-REC',user}),/No se puede cerrar/);
    await save('WEEK-REC',item,'CUADRA',2,'Reconteo comprobado y compensación documentada.',Math.abs(10-quantity));
    await service.finishReviewAndClose({inventoryId:'WEEK-REC',user});
    const result=closures[0].inventory.items[0];
    assert.equal(result.Stock_Sistema,10);
    assert.equal(result.Stock_Total,8);
    assert.equal(result.Stock_Total_Reconteo,quantity);
    assert.equal(result.Cantidad_Justificada_2,10-quantity);
    assert.equal(result.Cantidad_Fisica_Final,10);
    assert.equal(result.Diferencia,-2);
    assert.equal(result.Diferencia_Final,quantity-10);
  });
}

for (const [label,schema] of [['cyclic',{}],['weekly',{Schema_Version:contract.weeklyVersion}]]) {
  const type=label==='weekly'?'SEMANALES':'CICLICO';
  const start=async({service,put},id)=>{
    const item={...counted(),...schema};
    put({id,type,center:'1120',name:id,status:'EN_PROGRESO',items:[item]});
    await service.updateCount({inventoryId:id,itemId:item.id,stockFisico:3,malEstado:0,user});
    service.submitInventoryForReview({inventoryId:id,user});
    return item;
  };

  test(`${label}: 6 of 7 justified stays NO CUADRA, goes through recount and closes with 1 really missing`,async()=>{
    const f=fixture(),{service,save,closures,gasCalls}=f;
    const item=await start(f,'PART');
    const calls=gasCalls.length;
    await assert.rejects(save('PART',item,'NO CUADRA',1,'Más de lo contado.',8),/no puede superar la diferencia de 7/);
    assert.equal(gasCalls.length,calls,'A rejected quantity never reaches Sheets');
    const first=await save('PART',item,'NO CUADRA',1,'Seis con guía de remisión.',6);
    assert.equal(first.justifiedQuantity,6);
    assert.equal(first.corroboracion,'NO CUADRA');
    assert.equal(first.sheetWarning,null);
    assert.equal(gasCalls.at(-1).justifiedQuantity,6);
    assert.equal(contract.differenceDetail(service.getInventoryRaw('PART').items[0]).remaining,-1);
    assert.equal(first.reviewItem.reviewComplete,true);
    assert.equal(first.reviewState.canClose,false,'NO CUADRA still needs its recount');

    const child=service.enableRecount({inventoryId:'PART',user}).recountInventory;
    await service.updateCount({inventoryId:child.id,itemId:child.items[0].id,stockFisico:3,malEstado:0,user});
    service.submitInventoryForReview({inventoryId:child.id,user});
    assert.equal(contract.differenceDetail(service.getInventoryRaw('PART').items[0]).remaining,-7,'The recount replaces the earlier justification');
    await assert.rejects(service.finishReviewAndClose({inventoryId:'PART',user}),/No se puede cerrar/);

    await save('PART',item,'NO CUADRA',2,'Se confirman seis con guía de remisión.',6);
    await service.finishReviewAndClose({inventoryId:'PART',user});
    const closed=closures[0].inventory.items[0];
    assert.equal(closed.Stock_Sistema,10);
    assert.equal(closed.Estado_Justificacion_2,'NO CUADRA');
    assert.equal(closed.Stock_Total,3);
    assert.equal(closed.Stock_Total_Reconteo,3);
    assert.equal(closed.Diferencia,-7,'The first count keeps what was counted');
    assert.equal(contract.differenceDetail(closed).remaining,-1);
    assert.equal(contract.differenceDetail(closed).remaining*closed.Costo_Unitario,-5);
    if(label==='cyclic'){assert.equal(closed.Diferencia_Final,-1);assert.equal(closed.Costo_Diferencia_Final,-5);}
    else{assert.equal(closed.Cantidad_Justificada_2,6);assert.equal(closed.Cantidad_Fisica_Final,9);}
  });

  test(`${label}: justifying the whole difference from NO CUADRA records CUADRA, and zero keeps all of it`,async()=>{
    const f=fixture(),{service,save,gasCalls}=f;
    const item=await start(f,'WHOLE');
    const zero=await save('WHOLE',item,'NO CUADRA',1,'Sin respaldo.',0);
    assert.equal(zero.corroboracion,'NO CUADRA');
    assert.equal(contract.differenceDetail(service.getInventoryRaw('WHOLE').items[0]).remaining,-7);
    const whole=await save('WHOLE',item,'NO CUADRA',1,'Todo con respaldo.',7);
    assert.equal(whole.corroboracion,'CUADRA');
    assert.equal(whole.isCuadra,true);
    assert.equal(gasCalls.at(-1).corroboracion,'CUADRA');
    assert.equal(contract.differenceDetail(service.getInventoryRaw('WHOLE').items[0]).remaining,0);
    assert.equal(whole.reviewState.canClose,true);
  });

  test(`${label}: a script that ignores the quantity does not lose the partial result in the app`,async()=>{
    const f=fixture(),{service,save,gas,sheets}=f;
    const item=await start(f,'OLD');
    gas.saveJustificationToGAS=async(_type,p)=>({item:contract.update(sheets.get(contract.member(p)),{...p,justifiedQuantity:undefined})});
    const saved=await save('OLD',item,'NO CUADRA',1,'Seis con guía de remisión.',6);
    assert.match(saved.sheetWarning,/publique la nueva versión del Apps Script/);
    assert.equal(contract.differenceDetail(service.getInventoryRaw('OLD').items[0]).remaining,-1);
  });
}

test('counting inventories are absent from review and direct justification calls cannot write Sheets',async()=>{
  const {service,put,save,gasCalls}=fixture(),item=counted();
  put({id:'INV',status:'EN_PROGRESO',center:'1120',items:[item]});
  assert.equal(service.getPendingJustifications(user).length,0);
  await assert.rejects(save('INV',item,'CUADRA'),/no está habilitada/);
  assert.equal(gasCalls.length,0);
});

test('a first decision or a photo cannot be used as a second justification before recount',async()=>{
  const {service,put,save,gasCalls}=fixture(),item=counted();
  put({id:'INV',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[item]});
  await save('INV',item,'NO CUADRA');
  await assert.rejects(save('INV',item,'CUADRA',2),/no está habilitada/);
  await assert.rejects(save('INV',item,'CUADRA',1,'  '),/obligatorio explicar/);
  assert.equal(gasCalls.length,1);
  assert.equal(service.getPendingJustifications(user)[0].items[0].justificationRound,1);
});

test('recount selects exactly NO CUADRA members with complete first explanations, even with repeated SKUs',async()=>{
  const {service,put,save}=fixture(),a=counted('SKU','A'),b=counted('SKU','B');
  put({id:'INV',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[a,b]});
  assert.throws(()=>service.enableRecount({inventoryId:'INV',user,skusToRecount:['SKU']}),/Complete las primeras/);
  await save('INV',a,'CUADRA'); await save('INV',b,'NO CUADRA');
  assert.throws(()=>service.enableRecount({inventoryId:'INV',user,skusToRecount:['OTHER']}),/únicamente/);
  const result=service.enableRecount({inventoryId:'INV',user});
  assert.equal(result.itemsCount,1);assert.equal(result.recountInventory.items[0].Almacen,'B');
  assert.equal(workflow.hasCount(result.recountInventory.items[0],1),false);
  assert.throws(()=>service.enableRecount({inventoryId:'INV',user}),/Complete las primeras/);
  assert.throws(()=>service.submitInventoryForReview({inventoryId:result.recountInventoryId,user}),/pendientes/);
  const task=service.getPendingJustifications(user)[0];
  assert.equal(task.status,'EN_RECONTEO'); assert.equal(task.items.length,2);
  assert.ok(task.items.every(item=>!item.canJustify));
});

for (const [finalDecision,quantity] of [['CUADRA',10],['NO CUADRA',10],['NO CUADRA',9]]) {
  test(`full cycle retains recount ${quantity} and requires its explanation before closing ${finalDecision}`,async()=>{
    const {service,put,save,closures}=fixture(),a=counted('A'),b=counted('B');
    put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[a,b]});
    service.submitInventoryForReview({inventoryId:'INV',user});
    await save('INV',a,'CUADRA'); await save('INV',b,'NO CUADRA');
    const rec=service.enableRecount({inventoryId:'INV',user}).recountInventory;
    await assert.rejects(service.finishReviewAndClose({inventoryId:'INV',user}),/No se puede cerrar/);
    await service.updateCount({inventoryId:rec.id,itemId:rec.items[0].id,stockFisico:quantity,malEstado:0,user});
    await assert.rejects(save('INV',b,'CUADRA',2),/no está habilitada/);
    service.submitInventoryForReview({inventoryId:rec.id,user});
    const before=service.getPendingJustifications(user)[0];
    assert.equal(before.status,'RECONTEO_COMPLETADO');assert.equal(before.items.length,2);
    const recounted=before.items.find(item=>item.SKU==='B');
    assert.equal(recounted.Diferencia_Final,quantity-10);assert.equal(recounted.reviewComplete,false);
    assert.equal(recounted.canJustify,true);assert.equal(before.canClose,false);
    assert.equal(before.items.find(item=>item.SKU==='A').canJustify,false);
    await assert.rejects(service.finishReviewAndClose({inventoryId:'INV',user}),/No se puede cerrar/);
    assert.equal(closures.length,0);
    await save('INV',b,finalDecision,2,'Se repitió el conteo y se documenta el resultado final.');
    const after=service.getPendingJustifications(user)[0];
    assert.equal(after.items.length,2); assert.equal(after.pendingJustificationsCount,0);assert.equal(after.canClose,true);
    assert.equal(after.items.find(item=>item.SKU==='B').justificationHistory.length,2);
    assert.equal(after.items.find(item=>item.SKU==='B').reviewStatus,finalDecision);
    await service.finishReviewAndClose({inventoryId:'INV',user});
    assert.equal(closures.length,1);assert.equal(closures[0].justifications.length,3);
    assert.equal(closures[0].inventory.items.find(item=>item.SKU==='B').Estado,'NO CUADRA');
    assert.equal(closures[0].inventory.items.find(item=>item.SKU==='B').Estado_Justificacion_2,finalDecision);
    assert.equal(closures[0].inventory.items.find(item=>item.SKU==='B').Diferencia_Final,quantity-10);
    await assert.rejects(save('INV',b,'CUADRA',2),/no está habilitada/);
  });
}

test('reopening justification cannot skip an unsigned recount and changed counts require a fresh explanation',async()=>{
  const {service,put,save}=fixture(),item=counted();
  put({id:'INV',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[item]});
  await save('INV',item,'NO CUADRA');
  const rec=service.enableRecount({inventoryId:'INV',user}).recountInventory;
  await assert.rejects(service.reopenInventory({inventoryId:'INV',user,targetPhase:'JUSTIFICACION',syncFromGAS:false}),/firmar/);
  await assert.rejects(service.reopenInventory({inventoryId:'INV',user,targetPhase:'1ER_CONTEO',syncFromGAS:false}),/conserva como historial/);
  await service.updateCount({inventoryId:rec.id,itemId:rec.items[0].id,stockFisico:10,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});
  await save('INV',item,'CUADRA',2,'Se encontró la pieza.');
  await service.reopenInventory({inventoryId:'INV',user,targetPhase:'RECONTEO_1',syncFromGAS:false});
  const task=service.getPendingJustifications(user)[0];
  assert.equal(task.status,'EN_RECONTEO');assert.equal(task.canClose,false);
  assert.equal(task.items[0].canJustify,false);
  assert.throws(()=>service.submitInventoryForReview({inventoryId:rec.id,user}),/pendientes/);
});

test('an inconsistent status cannot enable review while other quantities or the signed child recount are missing',()=>{
  const item=counted(),blank={...counted('B'),Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null};
  const initial=workflow.plan({status:'PENDIENTE_JUSTIFICACION',items:[item,blank]});
  assert.equal(initial.items[0].canJustify,false);
  const parent={status:'RECONTEO_COMPLETADO',hasRecount:true,recountItemKeys:[contract.member(item)],items:[{...item,Reconteo:10}]};
  const recount=workflow.plan(parent,{status:'EN_PROGRESO',items:[item]});
  assert.equal(recount.items[0].canJustify,false);assert.equal(recount.canClose,false);
});

test('reading the review list cannot auto-complete or save a recount',()=>{
  const {service,put,files}=fixture();
  const item={...counted(),Estado:'NO CUADRA',Fecha_Primera_Justificacion:old,Comentario_Justificacion:'Revisar',Reconteo:10,Stock_Total_Reconteo:10};
  put({id:'INV',center:'1120',status:'EN_RECONTEO',hasRecount:true,items:[item]});
  const before=JSON.stringify([...files]);service.getPendingJustifications(user);
  assert.equal(JSON.stringify([...files]),before);
});

test('zero is a recorded recount, blank is pending, and first-count quantities never complete a recount',()=>{
  assert.equal(workflow.hasCount({...counted(),Reconteo:'',Reconteo_Fisico:null,Stock_Total_Reconteo:null},1),false);
  assert.equal(workflow.hasCount({...counted(),Reconteo:0},1),true);
  assert.equal(workflow.hasCount({...counted(),Reconteo:4},2),false);
});

test('old comments and CUADRA alone do not complete a fresh or a second review',()=>{
  const item={...counted(),Estado:'CUADRA',Comentario_Justificacion:'Old',Fecha_Primera_Justificacion:old};
  assert.equal(workflow.review(item,1,[],'2021-01-01').complete,false);
  assert.equal(workflow.review(item,2).complete,false);
  assert.equal(workflow.review({...item,Comentario_Justificacion:''},1).complete,false);
});

test('Apps Script rejects missing state context, unfinished recounts and a second review without recount data',()=>{
  const {gasContext}=fixture(),item={...counted(),Estado:'NO CUADRA'};
  const payload={round:2,comentarioJustificacion:'Explanation',workflow:{version:1,round:2,countStage:1,status:'RECONTEO_COMPLETADO'}};
  assert.throws(()=>gasContext.validateJustificationStage_(item,{...payload,workflow:null}),/contexto/);
  assert.throws(()=>gasContext.validateJustificationStage_(item,{...payload,workflow:{...payload.workflow,status:'EN_RECONTEO'}}),/bloqueada/);
  assert.throws(()=>gasContext.validateJustificationStage_(item,payload),/sin el conteo/);
  assert.doesNotThrow(()=>gasContext.validateJustificationStage_({...item,Reconteo:0},payload));
  assert.throws(()=>gasContext.validateJustificationStage_({...item,Reconteo:0,Estado:'CUADRA'},payload),/NO CUADRA/);
});

function browser() {
  const elements=new Map(),messages=[],saves=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,value:'',style:{},innerHTML:'',textContent:'',options:[],
      classList:{add(){},remove(){},contains(){return false;}},reset(){},focus(){}});
    return elements.get(id);
  };
  const window={JustificationPhotoRule:require('../public/js/justificationPhotoRule'),Toast:{warning:msg=>messages.push(msg),info(){},danger:msg=>messages.push(msg),success(){}},
    ModalHelper:{open(){},close(){}},Auth:{currentUser:user},API:{saveJustification:async p=>{saves.push(p);return {};}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/views/justificationsView.js'),'utf8'),{
    window,document:{getElementById:element,querySelectorAll:()=>[]},console,setTimeout:()=>{}
  });
  window.JustificationsView.initDualScrollbars=()=>{};
  return {view:window.JustificationsView,element,messages,saves};
}

test('justifications list the newest inventory first and the oldest last',()=>{
  const {service,put}=fixture();
  const inventory=(id,createdAt)=>({id,type:'CICLICO',name:id,status:'PENDIENTE_JUSTIFICACION',center:'1120',createdAt,items:[counted(id)]});
  put(inventory('MIDDLE','2026-10-15T10:00:00.000Z'));
  put(inventory('NO-DATE',undefined));
  put(inventory('NEWEST','2026-11-02T10:00:00.000Z'));
  put(inventory('OLDEST','2026-09-01T10:00:00.000Z'));
  assert.equal(service.getPendingJustifications(user).map(task=>task.inventoryId).join(),'NEWEST,MIDDLE,OLDEST,NO-DATE');
  put({...inventory('CLOSED-NEW','2026-11-03T10:00:00.000Z'),status:'REVISADO',isFinalized:true});
  put({...inventory('CLOSED-OLD','2026-08-01T10:00:00.000Z'),status:'REVISADO',isFinalized:true});
  assert.equal(service.getPendingJustifications(user,null,{status:'ALL'}).map(task=>task.inventoryId).join(),
    'NEWEST,MIDDLE,OLDEST,NO-DATE,CLOSED-NEW,CLOSED-OLD');
});

test('the server refuses a reason that needs a photo until it comes with one',async()=>{
  const {service,put}=fixture();
  const item={...counted('A'),Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null};
  put({id:'REVIEW',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[item]});
  await service.updateCount({inventoryId:'REVIEW',itemId:item.id,stockFisico:7,malEstado:0,user:countUser});
  service.submitInventoryForReview({inventoryId:'REVIEW',user});
  const review={inventoryId:'REVIEW',sku:item.SKU,itemId:item.id,almacen:item.Almacen,location:item.Ubicacion,round:1,
    corroboracion:'CUADRA',justification:'Venta registrada',reasonType:'Venta del repuesto',user};
  await assert.rejects(service.saveJustification(review),/requiere foto/);
  await assert.rejects(service.saveJustification({...review,reasonType:undefined}),/requiere foto/);
  await service.saveJustification({...review,photoUrls:['https://drive.google.com/file/d/abc/view']});
});

test('review screen retains CUADRA history and does not count a zero-difference recount as justified',()=>{
  const {view,element}=browser();
  const inv={id:'INV',center:'1120',status:'RECONTEO_COMPLETADO',hasRecount:true,recountItemKeys:[contract.member(counted())],
    items:[{...counted(),Estado:'NO CUADRA',Fecha_Primera_Justificacion:old,Comentario_Justificacion:'Se solicita reconteo',Reconteo:10,Stock_Total_Reconteo:10,Diferencia_Final:0}]};
  const plan=workflow.plan(inv);
  view.tasks=[{...inv,inventoryId:'INV',inventoryName:'Example',...plan,items:plan.items}];
  view.expandedTaskIds.add('INV');view.renderTasks();
  let html=element('justifications-container').innerHTML;
  assert.match(html,/Se solicita reconteo/); assert.match(html,/0\/1 \(0%\)/);
  assert.doesNotMatch(html,/Cuadra \(Aprobado\)/);
  view.updateItemRowDOM('INV','A',{corroborationStatus:'CUADRA'});
  assert.equal(view.tasks[0].items.length,1);
  inv.items[0].Estado_Justificacion_2='CUADRA'; inv.items[0].Fecha_Justificacion_2='2021-01-01';
  inv.items[0].Comentario_Justificacion_2='Se halló el producto en la ubicación adicional.';
  view.tasks[0].items=workflow.plan(inv).items;view.renderTasks();
  html=element('justifications-container').innerHTML;
  assert.match(html,/Se solicita reconteo/);assert.match(html,/Se halló el producto/);
});

test('a pending recount modal asks for an actual explanation and never autofills approval',async()=>{
  const {view,element,saves,messages}=browser();
  const item={...counted(),id:'I',canJustify:true,justificationRound:2,reviewComplete:false,Reconteo:10,Stock_Total_Reconteo:10,Diferencia_Final:0};
  view.tasks=[{inventoryId:'INV',status:'RECONTEO_COMPLETADO',hasRecount:true,items:[item]}];
  view.openJustifyModalAtIndex('INV',0);
  assert.equal(view.currentIsSecondJustification,true);
  assert.equal(element('just-input-text').value,'');
  await view.saveCurrentModalJustification();
  assert.equal(saves.length,0);assert.ok(messages.some(msg=>msg.includes('Explique')));
  item.canJustify=false;view.openJustifyModalAtIndex('INV',0);
  assert.ok(messages.some(msg=>msg.includes('bloqueada')));
});

test('a blocked closure names the unmet condition instead of only pending justifications', () => {
  const justified = {...counted('A'), Estado:'NO CUADRA', Comentario_Justificacion:'Faltante confirmado',
    Fecha_Primera_Justificacion:'2020-01-02T00:00:00.000Z'};
  const uncounted = contract.normalize({id:'B', SKU:'B', Almacen:'R001', Ubicacion:'LOC', Stock_Sistema:3});
  const recountDone = {id:'INV', status:'RECONTEO_COMPLETADO', hasRecount:true, recountItemKeys:[contract.member(justified),
    JSON.stringify(['GONE','R009','LOC'])], items:[justified, uncounted]};
  const result = workflow.plan(recountDone, null, []);
  assert.equal(result.canClose, false);
  assert.ok(result.closeBlockers.some(b => /1 ítem\(s\) sin primer conteo: B \(R001\)/.test(b)));
  assert.ok(result.closeBlockers.some(b => /ya no coinciden.*GONE \/ R009 \/ LOC/.test(b)));
  assert.deepEqual(workflow.plan({...recountDone, items:[justified], recountItemKeys:[contract.member(justified)],
    status:'PENDIENTE_JUSTIFICACION'}, null, []).closeBlockers,
    ['Hay ítems marcados para reconteo, pero el reconteo no figura como completado.',
     '1 justificación(es) pendiente(s): A (R001).']);
});

test('a recount copied from the whole inventory only requires recounts for items that had a difference', () => {
  const recounted = {...counted('A'), Reconteo:10, Malestado_Reconteo:0, Fecha_Reconteo:'2020-01-03T00:00:00.000Z',
    Estado_Justificacion_2:'CUADRA', Comentario_Justificacion_2:'Reconteo cuadra',
    Fecha_Justificacion_2:'2020-01-04T00:00:00.000Z'};
  const balanced = contract.normalize({id:'B', SKU:'B', Almacen:'R001', Ubicacion:'LOC', Stock_Sistema:3,
    Stock_Buen_Estado:3, Mal_estado:0, Fecha_Ultimo_Conteo:old});
  const child = {id:'REC-INV', status:'REVISADO', items:[recounted, balanced]};
  const inv = {id:'INV', status:'RECONTEO_COMPLETADO', hasRecount:true, reopenedPhase:'JUSTIFICACION',
    items:[recounted, balanced]};
  const result = workflow.plan(inv, child, []);
  assert.equal(result.keys.size, 2);
  assert.equal(result.canClose, true, result.closeBlockers.join(' '));
  const missing = workflow.plan({...inv, items:[{...recounted, Reconteo:null, Stock_Total_Reconteo:null}, balanced]}, child, []);
  assert.equal(missing.canClose, false);
  assert.ok(missing.closeBlockers.some(b => /1 ítem\(s\) sin cantidad de reconteo 1: A \(R001\)/.test(b)));
});

async function throughFirstRecountReview(context, secondDecisions) {
  const {service,put,save}=context,items=Object.keys(secondDecisions).map(sku=>counted(sku));
  put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items});
  service.submitInventoryForReview({inventoryId:'INV',user});
  for(const item of items)await save('INV',item,'NO CUADRA');
  const rec=service.enableRecount({inventoryId:'INV',user}).recountInventory;
  for(const entry of rec.items)await service.updateCount({inventoryId:rec.id,itemId:entry.id,stockFisico:9,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});
  for(const item of items)await save('INV',item,secondDecisions[item.SKU],2,'Explicación del primer reconteo.');
  // A review stamped in the same millisecond as the next step would still count as valid for that step.
  await new Promise(resolve=>setTimeout(resolve,3));
  return {items,rec};
}

test('second recount is optional: NO CUADRA after the first recount can close or be recounted',async()=>{
  const context=fixture(),{service,closures}=context;
  await throughFirstRecountReview(context,{A:'NO CUADRA'});
  const task=service.getPendingJustifications(user)[0];
  assert.equal(task.canEnableRecount2,true);assert.equal(task.canClose,true);
  await service.finishReviewAndClose({inventoryId:'INV',user});
  assert.equal(closures.length,1);assert.equal(closures[0].inventory.items[0].Reconteo_2,null);
  assert.throws(()=>service.enableSecondRecount({inventoryId:'INV',user}),/segundo reconteo requiere/);
});

test('second recount needs a NO CUADRA from a complete review of the first recount',async()=>{
  const context=fixture(),{service}=context;
  await throughFirstRecountReview(context,{A:'CUADRA'});
  assert.equal(service.getPendingJustifications(user)[0].canEnableRecount2,false);
  assert.throws(()=>service.enableSecondRecount({inventoryId:'INV',user}),/segundo reconteo requiere/);
  assert.throws(()=>service.enableSecondRecount({inventoryId:'INV',user:{...user,role:'AUXILIAR'}}),/Solo un Administrador/);
});

test('second recount covers only NO CUADRA items and requires a new review that keeps the previous one as history',async()=>{
  const context=fixture(),{service,save,sheets,closures}=context;
  const {items:[a,b],rec}=await throughFirstRecountReview(context,{A:'CUADRA',B:'NO CUADRA'});
  const enabled=service.enableSecondRecount({inventoryId:'INV',user});
  assert.equal(enabled.recountInventoryId,rec.id);assert.equal(enabled.itemsCount,1);
  assert.throws(()=>service.enableSecondRecount({inventoryId:'INV',user}),/segundo reconteo requiere/);

  const open=service.getPendingJustifications(user)[0];
  assert.equal(open.status,'EN_RECONTEO');assert.ok(open.items.every(item=>!item.canJustify));
  await assert.rejects(save('INV',b,'CUADRA',2),/no está habilitada/);
  await assert.rejects(service.finishReviewAndClose({inventoryId:'INV',user}),/No se puede cerrar/);

  const view=await service.getInventoryById(rec.id,{...user,role:'AUXILIAR',center:'1120'});
  assert.equal(view.items.map(item=>item.SKU).join(),'B');
  assert.equal(view.items[0].Stock_Fisico,null);assert.equal(view.isBlindCount,true);

  const stored=service.getInventoryRaw(rec.id),[recA,recB]=['A','B'].map(sku=>stored.items.find(item=>item.SKU===sku));
  await assert.rejects(service.updateCount({inventoryId:rec.id,itemId:recA.id,stockFisico:7,malEstado:0,user}),/no pertenece/);
  assert.throws(()=>service.submitInventoryForReview({inventoryId:rec.id,user}),/pendientes/);
  await service.updateCount({inventoryId:rec.id,itemId:recB.id,stockFisico:7,malEstado:1,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});

  const sheet=sheets.get(contract.member(b));
  assert.equal(sheet.Stock_Total_Reconteo,9);assert.equal(sheet.Stock_Total_Reconteo_2,8);assert.equal(sheet.Stock_Total,8);
  const signed=service.getPendingJustifications(user)[0];
  assert.equal(signed.status,'RECONTEO_COMPLETADO');assert.equal(signed.canClose,false);assert.equal(signed.canEnableRecount2,false);
  assert.equal(signed.pendingJustificationsCount,1);
  const [reviewedA,pendingB]=['A','B'].map(sku=>signed.items.find(item=>item.SKU===sku));
  assert.equal(reviewedA.reviewComplete,true);assert.equal(pendingB.reviewComplete,false);assert.equal(pendingB.canJustify,true);
  assert.equal(pendingB.justificationHistory.length,2);
  assert.ok(signed.closeBlockers.some(blocker=>/justificación\(es\) pendiente\(s\): B/.test(blocker)));

  await save('INV',b,'NO CUADRA',2,'Explicación del segundo reconteo.');
  const reviewed=service.getPendingJustifications(user)[0];
  assert.equal(reviewed.canClose,true);assert.equal(reviewed.canEnableRecount2,false);
  const history=reviewed.items.find(item=>item.SKU==='B').justificationHistory;
  assert.deepEqual(history.map(entry=>[entry.round,!!entry.superseded]),[[1,false],[2,true],[2,false]]);
  assert.equal(history[1].justification,'Explicación del primer reconteo.');
  assert.equal(history[2].justification,'Explicación del segundo reconteo.');

  await service.finishReviewAndClose({inventoryId:'INV',user});
  const closed=closures[0].inventory.items.find(item=>item.SKU==='B');
  assert.equal(closed.Stock_Total_Reconteo,9);assert.equal(closed.Stock_Total_Reconteo_2,8);assert.equal(closed.Diferencia_Final_2,-2);
  assert.equal(closed.Comentario_Justificacion_2,'Explicación del segundo reconteo.');
  assert.equal(closures[0].inventory.items.find(item=>item.SKU==='A').Reconteo_2,null);
  assert.equal(closures[0].justifications.filter(entry=>entry.superseded).length,1);
  assert.equal(service.getInventoryRaw(rec.id).status,'REVISADO');
});

test('reopening the second recount keeps the reviews of items outside its list',async()=>{
  const context=fixture(),{service,save}=context;
  const {items:[,b],rec}=await throughFirstRecountReview(context,{A:'CUADRA',B:'NO CUADRA'});
  service.enableSecondRecount({inventoryId:'INV',user});
  const recB=service.getInventoryRaw(rec.id).items.find(item=>item.SKU==='B');
  await service.updateCount({inventoryId:rec.id,itemId:recB.id,stockFisico:7,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});
  await save('INV',b,'CUADRA',2,'Se encontró la diferencia.');
  await service.reopenInventory({inventoryId:'INV',user,targetPhase:'RECONTEO_2',syncFromGAS:false});
  // reopenedAt is stamped 1 ms ahead; a count in that same instant would read as older than the reopening.
  await new Promise(resolve=>setTimeout(resolve,3));
  await service.updateCount({inventoryId:rec.id,itemId:recB.id,stockFisico:8,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});
  const task=service.getPendingJustifications(user)[0];
  assert.equal(task.items.find(item=>item.SKU==='A').reviewComplete,true);
  assert.equal(task.items.find(item=>item.SKU==='B').reviewComplete,false);
  await service.reopenInventory({inventoryId:'INV',user,targetPhase:'RECONTEO_1',syncFromGAS:false});
  assert.equal(service.getInventoryRaw('INV').recount2ItemKeys,undefined);
  assert.equal(service.getInventoryRaw(rec.id).recount2ItemKeys,undefined);
});

test('second recount works on the primary record when no recount list exists',async()=>{
  const context=fixture(),{service,put,save}=context,item={...counted(),Reconteo:9,Malestado_Reconteo:0,Stock_Total_Reconteo:9,Fecha_Reconteo:old,
    Estado:'NO CUADRA',Comentario_Justificacion:'Revisar',Fecha_Primera_Justificacion:old};
  put({id:'INV',type:'CICLICO',name:'Example',status:'RECONTEO_COMPLETADO',center:'1120',hasRecount:true,
    recountItemKeys:[contract.member(item)],items:[item]});
  await save('INV',item,'NO CUADRA',2);
  const enabled=service.enableSecondRecount({inventoryId:'INV',user});
  assert.equal(enabled.recountInventoryId,'INV');
  await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:7,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:'INV',user});
  const stored=service.getInventoryRaw('INV').items[0];
  assert.equal(stored.Stock_Total_Reconteo,9);assert.equal(stored.Stock_Total_Reconteo_2,7);
  assert.equal(service.getPendingJustifications(user)[0].items[0].canJustify,true);
});

test('weekly second recount compensates against its own physical count',async()=>{
  const {service,put,save,closures}=fixture(),item={...counted(),Schema_Version:contract.weeklyVersion};
  put({id:'WEEK',type:'SEMANAL',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[item]});
  await service.updateCount({inventoryId:'WEEK',itemId:item.id,stockFisico:8,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:'WEEK',user});
  await save('WEEK',item,'NO CUADRA');
  const child=service.enableRecount({inventoryId:'WEEK',user}).recountInventory;
  await service.updateCount({inventoryId:child.id,itemId:child.items[0].id,stockFisico:9,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:child.id,user});
  await save('WEEK',item,'NO CUADRA',2);
  service.enableSecondRecount({inventoryId:'WEEK',user});
  await service.updateCount({inventoryId:child.id,itemId:child.items[0].id,stockFisico:7,malEstado:0,user:{...user,username:'third-counter'}});
  service.submitInventoryForReview({inventoryId:child.id,user});
  await save('WEEK',item,'CUADRA',2,'Se documenta el faltante final.');
  const task=service.getPendingJustifications(user)[0];
  assert.equal(task.canClose,true);
  assert.equal(task.items[0].Stock_Total_Reconteo_2,7);assert.equal(task.items[0].Cantidad_Justificada_2,3);
  assert.equal(task.items[0].Cantidad_Fisica_Final,10);
  assert.equal(service.getInventoryRaw('WEEK').items[0].counterEvidence.signed.length,3);
  await service.finishReviewAndClose({inventoryId:'WEEK',user});
  assert.equal(closures.length,1);
});

test('forced close records missing justifications in the final file and keeps the differences',async()=>{
  const {service,put,save,closures,sheets,batches}=fixture(),a=counted('A'),b=counted('B'),c=counted('C');
  put({id:'INV',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[a,b,c]});
  await save('INV',a,'CUADRA',1,'Justificación real.');
  assert.equal(service.getPendingJustifications(user)[0].canClose,false);
  assert.equal(service.getPendingJustifications(user)[0].canForceClose,true);
  await assert.rejects(service.finishReviewAndClose({inventoryId:'INV',user}),/No se puede cerrar/);
  const result=await service.forceCloseInventory({inventoryId:'INV',user});
  assert.equal(result.forcedItems.join(),'B,C');assert.equal(result.masterFailed.length,0);
  assert.equal(batches.length,1);assert.equal(batches[0].updates.length,2);
  const main=sheets.get(contract.member(b));
  assert.equal(main.Estado,'NO CUADRA');assert.equal(main.Razon,'CIERRE FORZADO');
  assert.match(main.Comentario_Justificacion,/^CIERRE FORZADO por Reviewer/);assert.equal(main.Diferencia,-2);
  assert.equal(sheets.get(contract.member(a)).Comentario_Justificacion,'Justificación real.','a real review is not rewritten');
  assert.equal(closures.length,1);
  const rows=closures[0].inventory.items,[rowA,rowB]=['A','B'].map(sku=>rows.find(item=>item.SKU===sku));
  assert.equal(rowA.Comentario_Justificacion,'Justificación real.');assert.equal(rowA.Estado,'CUADRA');
  assert.equal(rowB.Estado,'NO CUADRA');assert.equal(rowB.Razon,'CIERRE FORZADO');
  assert.match(rowB.Comentario_Justificacion,/^CIERRE FORZADO por Reviewer/);
  assert.equal(rowB.Responsable_Justificacion,'Reviewer');assert.equal(rowB.Diferencia,-2);
  assert.equal(contract.finalItem(rowB).Razon,'CIERRE FORZADO');
  assert.equal(closures[0].justifications.filter(j=>j.forced).length,2);
  const stored=service.getInventoryRaw('INV');
  assert.equal(stored.status,'REVISADO');assert.equal(stored.forcedClose.items.join(),'B,C');
  await assert.rejects(service.forceCloseInventory({inventoryId:'INV',user}),/solo omite justificaciones/);
});

test('forced close after a recount writes the second review and keeps a replaced explanation as history',async()=>{
  const context=fixture(),{service,put,save,closures,sheets}=context,a=counted('A');
  put({id:'INV',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[a]});
  await save('INV',a,'NO CUADRA',1,'Primera explicación.');
  const rec=service.enableRecount({inventoryId:'INV',user}).recountInventory;
  await service.updateCount({inventoryId:rec.id,itemId:rec.items[0].id,stockFisico:9,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});
  await save('INV',a,'NO CUADRA',2,'Explicación vieja.');
  await service.reopenInventory({inventoryId:'INV',user,targetPhase:'RECONTEO_1',syncFromGAS:false});
  const recItem=service.getInventoryRaw(rec.id).items[0];
  await new Promise(resolve=>setTimeout(resolve,5));
  await service.updateCount({inventoryId:rec.id,itemId:recItem.id,stockFisico:8,malEstado:0,user});
  service.submitInventoryForReview({inventoryId:rec.id,user});
  await service.forceCloseInventory({inventoryId:rec.id,user});
  const row=closures[0].inventory.items[0];
  assert.equal(row.Comentario_Justificacion,'Primera explicación.');
  assert.equal(row.Razon_Justificacion_2,'CIERRE FORZADO');assert.equal(row.Estado_Justificacion_2,'NO CUADRA');
  assert.equal(row.Stock_Total_Reconteo,8);
  assert.equal(closures[0].justifications.find(j=>j.superseded).justification,'Explicación vieja.');
  const main=sheets.get(contract.member(a));
  assert.equal(main.Comentario_Justificacion,'Primera explicación.');
  assert.equal(main.Razon_Justificacion_2,'CIERRE FORZADO');assert.equal(main.Stock_Total_Reconteo,8);
  assert.equal(service.getInventoryRaw(rec.id).status,'REVISADO');
});

test('forced close is refused while a count or recount is unsigned, and the route is exclusive',async()=>{
  const {service,put,save,closures}=fixture(),a=counted('A');
  put({id:'OPEN',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[a]});
  await assert.rejects(service.forceCloseInventory({inventoryId:'OPEN',user}),/solo omite justificaciones/);
  put({id:'BLANK',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',
    items:[{...counted('D'),Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null}]});
  await assert.rejects(service.forceCloseInventory({inventoryId:'BLANK',user}),/solo omite justificaciones/);
  const b=counted('B');
  put({id:'REC',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[b]});
  await save('REC',b,'NO CUADRA');
  service.enableRecount({inventoryId:'REC',user});
  await assert.rejects(service.forceCloseInventory({inventoryId:'REC',user}),/solo omite justificaciones/);
  assert.equal(closures.length,0);
  const routes=fs.readFileSync(path.join(root,'src/routes/justificationRoutes.js'),'utf8');
  assert.match(routes,/const \{[^}]*requireExactAlonso[^}]*\} = require\('\.\.\/middlewares\/authMiddleware'\)/);
  assert.match(routes,/router\.post\('\/:id\/force-close', authenticate, requireExactAlonso,/);
  const view=fs.readFileSync(path.join(root,'public/js/views/justificationsView.js'),'utf8');
  assert.match(view,/task\.canForceClose && !task\.canClose && window\.Auth\?\.isExactAlonso\?\.\(\)/);
});

test('only the exact Alonso username passes the forced close guard',()=>{
  const {requireExactAlonso}=require('../src/middlewares/authMiddleware');
  const run=user=>{
    let passed=false,status=null;
    requireExactAlonso({user},{status(code){status=code;return this;},json(){return this;}},()=>{passed=true;});
    return {passed,status};
  };
  assert.equal(run({username:'Alonso',displayName:'Alonso Rios',isSuperadmin:true}).passed,true);
  assert.equal(run({username:'alonso'}).passed,true);
  for(const user of [{username:'admin',isSuperadmin:true,role:'ADMIN'},{username:'jperez',displayName:'Juan Alonso'},
    {username:'otro',clave:'ADM'},{username:'otro',email:'alonsospro@gmail.com'},{username:'alonso2'}]){
    const result=run(user);
    assert.equal(result.passed,false,JSON.stringify(user));assert.equal(result.status,403);
  }
  assert.equal(run(null).status,401);
});

test('forced close writes the main sheet only after the final file exists',async()=>{
  const {service,put,sheets,batches,failures}=fixture(),a=counted('A');
  put({id:'INV',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[a]});
  failures.drive=true;
  await assert.rejects(service.forceCloseInventory({inventoryId:'INV',user}),/Drive no disponible/);
  assert.equal(batches.length,0);assert.equal(sheets.get(contract.member(a)).Razon,undefined);
});

test('forced close stays closed and reports what the main sheet did not take',async()=>{
  for(const [failure,expected] of [['B','B'],['network','A,B,C']]){
    const {service,put,sheets,failures}=fixture(),items=['A','B','C'].map(sku=>counted(sku));
    put({id:'INV',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items});
    failures.batch=failure;
    const result=await service.forceCloseInventory({inventoryId:'INV',user});
    assert.equal(result.masterFailed.map(entry=>entry.sku).join(),expected);
    const stored=service.getInventoryRaw('INV');
    assert.equal(stored.status,'REVISADO');assert.equal(stored.forcedClose.masterFailed.length,expected.split(',').length);
    if(failure==='B')assert.equal(sheets.get(contract.member(items[0])).Razon,'CIERRE FORZADO');
  }
});

test('forced close sends the main sheet in batches below the Apps Script limit',async()=>{
  const {service,put,batches}=fixture(),items=Array.from({length:120},(_,index)=>counted(`S${index}`));
  put({id:'INV',type:'CICLICO',name:'Example',status:'PENDIENTE_JUSTIFICACION',center:'1120',items});
  const result=await service.forceCloseInventory({inventoryId:'INV',user});
  assert.equal(batches.map(batch=>batch.updates.length).join(),'50,50,20');
  assert.equal(result.masterFailed.length,0);
});

test('weekly forced close writes its main sheet with the context its script validates',async()=>{
  const {service,put,sheets,closures,gasContext}=fixture(),item={...counted(),Schema_Version:contract.weeklyVersion};
  put({id:'WEEK',type:'SEMANAL',name:'Semanal',status:'PENDIENTE_JUSTIFICACION',center:'1120',items:[item]});
  const script=fs.readFileSync(path.join(root,'integrations/apps-script/produccion/InventoryWebhookSemanales.gs'),'utf8');
  const validate=script.slice(script.indexOf('function validateJustificationStage_'),script.indexOf('function upsertCount_'));
  vm.runInContext(validate,gasContext);
  const result=await service.forceCloseInventory({inventoryId:'WEEK',user});
  assert.equal(result.masterFailed.length,0);assert.equal(closures.length,1);
  const main=sheets.get(contract.member(item));
  assert.equal(main.Razon,'CIERRE FORZADO');assert.equal(main.Cantidad_Justificada_1,0);assert.equal(main.Stock_Sistema,10);
});

const countUser={...user,role:'ADMIN'};
const sent=(context,id)=>context.service.getInventoryRaw(id).sheetPending;

test('a batched count is confirmed without waiting for Sheets and only its latest value is sent',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,sheets,gasCalls,batches}=context,item=counted();
  put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[{...item,Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null}]});
  const first=await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:7,malEstado:0,user:countUser});
  assert.equal(first.sheetPending,true);assert.equal(first.item.Stock_Total,7);assert.equal(first.item.Diferencia,-3);
  assert.equal(gasCalls.length,0);assert.equal(batches.length,0);assert.equal(sheets.get(contract.member(item)).Stock_Total,null);
  await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:9,malEstado:1,user:countUser,locked:true});
  assert.equal(Object.keys(sent(context,'INV')).length,1);
  const blind=await service.getInventoryById('INV',{...user,role:'AUXILIAR',center:'1120'});
  assert.equal(blind.sheetPending,undefined,'pending entries carry system quantities');assert.equal(blind.sheetPendingCount,1);
  const result=await service.drainSheetCounts({inventoryId:'INV',user:countUser});
  assert.equal(result.remaining,0);assert.equal(batches.length,1);assert.equal(batches[0].updates.length,1);
  assert.equal(sheets.get(contract.member(item)).Stock_Total,10);assert.equal(sheets.get(contract.member(item)).Mal_estado,1);
  assert.equal(sent(context,'INV'),undefined);
  assert.equal(JSON.stringify(await service.drainSheetCounts({inventoryId:'INV',user:countUser})),'{"remaining":0}');
  assert.equal(batches.length,1,'nothing pending calls nothing');
});

// The same work must leave the same data in the app and in the sheet, whichever way it travels.
for (const weekly of [false,true]) {
  test(`batched counts leave the same ${weekly?'weekly':'cyclic'} data as immediate ones through both recounts`,async()=>{
    const run=async mode=>{
      const context=fixture({countSheetSync:mode}),{service,put,save,sheets}=context;
      const blank=sku=>({...counted(sku),Estado:'',Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null,...(weekly?{Schema_Version:contract.weeklyVersion}:{})});
      const items=[blank('A'),blank('B')];
      put({id:'INV',type:weekly?'SEMANAL':'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items});
      const submit=async id=>{await service.assertSheetCountsSent(id);service.submitInventoryForReview({inventoryId:id,user});};
      await service.updateCount({inventoryId:'INV',itemId:items[0].id,stockFisico:8,malEstado:1,user:countUser});
      await service.updateCount({inventoryId:'INV',itemId:items[1].id,stockFisico:10,malEstado:0,user:countUser});
      await submit('INV');
      await save('INV',items[0],'NO CUADRA',1,'Primera.');
      const rec=service.enableRecount({inventoryId:'INV',user}).recountInventory;
      await service.updateCount({inventoryId:rec.id,itemId:rec.items[0].id,stockFisico:7,malEstado:2,user:{...countUser,username:'otro',displayName:'Otro contador'}});
      await submit(rec.id);
      await save('INV',items[0],'NO CUADRA',2,'Segunda.');
      service.enableSecondRecount({inventoryId:'INV',user});
      await service.updateCount({inventoryId:rec.id,itemId:rec.items[0].id,stockFisico:6,malEstado:1,user:countUser});
      await submit(rec.id);
      const pick=item=>Object.fromEntries((weekly?contract.weeklyColumns:contract.columns)
        .filter(key=>!/Fecha|Comentario_Justificacion/.test(key)).map(key=>[key,item[key]??'']));
      return {app:service.getInventoryRaw('INV').items.map(pick),child:service.getInventoryRaw(rec.id).items.map(pick),
        sheet:items.map(item=>pick(sheets.get(contract.member(item))))};
    };
    const [immediate,batched]=[await run('inmediato'),await run('lotes')];
    const plain=value=>JSON.parse(JSON.stringify(value));
    assert.deepEqual(plain(batched.sheet),plain(immediate.sheet));
    assert.deepEqual(plain(batched.app),plain(immediate.app));
    assert.deepEqual(plain(batched.child),plain(immediate.child));
  });
}

test('a count arriving while its batch travels stays pending, and saves are not blocked meanwhile',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,batches,sheets}=context,item=counted();
  put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[item]});
  await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:5,malEstado:0,user:countUser});
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  context.holdBatches(gate);
  const draining=service.drainSheetCounts({inventoryId:'INV',user:countUser});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(await service.drainSheetCounts({inventoryId:'INV',user:countUser})),'{"remaining":1,"inProgress":true}');
  await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:6,malEstado:0,user:countUser});
  release();
  assert.equal((await draining).remaining,1,'the newer value is not marked as sent');
  context.holdBatches(null);
  assert.equal(sheets.get(contract.member(item)).Stock_Total,5);
  assert.equal((await service.drainSheetCounts({inventoryId:'INV',user:countUser})).remaining,0);
  assert.equal(sheets.get(contract.member(item)).Stock_Total,6);
  assert.equal(batches.length,2);
});

test('counts keep working with Google down, and signing waits until it received them',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,failures,sheets}=context,item=counted();
  put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[item]});
  failures.batch='network';
  await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:5,malEstado:0,user:countUser});
  const down=await service.drainSheetCounts({inventoryId:'INV',user:countUser});
  assert.equal(down.remaining,1);assert.equal(down.failed,1);
  assert.equal(service.getInventoryRaw('INV').items[0].Stock_Total,5,'the count stays saved');
  await assert.rejects(service.assertSheetCountsSent('INV'),/Google Sheets no recibió 1 conteo.*SKU|Google Sheets no recibió 1 conteo/);
  await assert.rejects(service.syncInventoryFromSheet({inventoryId:'INV',user:countUser}),/no recibió/,'reading back must not replace it');
  await assert.rejects(service.reopenInventory({inventoryId:'INV',user:countUser,targetPhase:'1ER_CONTEO'}),/no recibió/);
  failures.batch=null;
  await service.assertSheetCountsSent('INV');
  assert.equal(sheets.get(contract.member(item)).Stock_Total,5);
  assert.equal(sent(context,'INV'),undefined);
});

test('only the code Google rejects stays pending',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,failures}=context,[a,b]=[counted('A'),counted('B')];
  put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[a,b]});
  for(const item of [a,b])await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:5,malEstado:0,user:countUser});
  failures.batch='B';
  const result=await service.drainSheetCounts({inventoryId:'INV',user:countUser});
  assert.equal(result.remaining,1);
  const pending=Object.values(sent(context,'INV'));
  assert.equal(pending[0].payload.sku,'B');assert.equal(pending[0].lastError,'Ítem no encontrado');
});

test('counts with photos, sweeps and an immediate setting still wait for Google',async()=>{
  const photo=fixture({countSheetSync:'lotes'}),item=counted();
  photo.put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[item]});
  await photo.service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:5,malEstado:0,user:countUser});
  photo.failures.photo='data:image/png;base64,AA';
  const withPhoto=await photo.service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:4,malEstado:1,photoUrl:'/foto.jpg',user:countUser});
  assert.equal(withPhoto.sheetPending,false,'it also replaces the older value waiting for this item');
  assert.equal(photo.gasCalls.length,1);assert.equal(photo.sheets.get(contract.member(item)).Stock_Total,5);
  const sweep=fixture({countSheetSync:'lotes'}),sweepItem=counted();
  sweep.put({id:'SWEEP',type:'BARRIDO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[sweepItem]});
  assert.equal((await sweep.service.updateCount({inventoryId:'SWEEP',itemId:sweepItem.id,stockFisico:5,malEstado:0,user:countUser})).sheetPending,false);
  assert.equal(sweep.gasCalls.length,1);
});

test('a justification sends pending counts first, because the script reads that row',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,save,sheets}=context;
  const item={...counted(),Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null};
  put({id:'INV',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[item]});
  await service.updateCount({inventoryId:'INV',itemId:item.id,stockFisico:7,malEstado:0,user:countUser});
  service.submitInventoryForReview({inventoryId:'INV',user});
  await save('INV',item,'NO CUADRA');
  assert.equal(sheets.get(contract.member(item)).Stock_Total,7);
  assert.equal(sent(context,'INV'),undefined);
});

test('a weekly cycle reset survives being replaced by a newer count',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,batches}=context;
  const item={...counted(),Schema_Version:contract.weeklyVersion,Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null};
  put({id:'WEEK',type:'SEMANAL',name:'Semanal',status:'EN_PROGRESO',center:'1120',items:[item]});
  await service.updateCount({inventoryId:'WEEK',itemId:item.id,stockFisico:7,malEstado:0,user:countUser});
  await service.updateCount({inventoryId:'WEEK',itemId:item.id,stockFisico:8,malEstado:0,user:countUser});
  await service.drainSheetCounts({inventoryId:'WEEK',user:countUser});
  assert.equal(batches[0].updates[0].resetWeeklyCycle,true);
  assert.equal(batches[0].updates[0].stockBuenEstado,8);
});

test('the sync request waits for Google outside the write queue and the counter can sign only after it',()=>{
  const middleware=fs.readFileSync(path.join(root,'src/services/persistenceMiddleware.js'),'utf8');
  assert.match(middleware,/sync-pending/);
  const routes=fs.readFileSync(path.join(root,'src/routes/inventoryRoutes.js'),'utf8');
  assert.match(routes,/await inventoryService\.assertSheetCountsSent\(req\.params\.id\);\s*const result = inventoryService\.submitInventoryForReview/);
  assert.match(fs.readFileSync(path.join(root,'server.js'),'utf8'),/setWriteQueue\(persistence\.runExclusive\)/);
});

test('the add-location window saves an overstock location, alone or with an additional one',async()=>{
  const {service,put,sheets,gasCalls}=fixture(),item={...counted(),Schema_Version:contract.weeklyVersion};
  put({id:'OVER',type:'SEMANAL',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[item]});
  const add=fields=>service.updateCount({inventoryId:'OVER',itemId:item.id,isNewLocation:true,user,...fields});
  await add({sobrestock:'9z99999z99'});
  let stored=service.getInventoryRaw('OVER').items[0];
  assert.equal(stored.Sobrestock,'9Z99999Z99');
  assert.equal(stored.Ubicacion_1||'','','Alone it adds no additional location');
  await add({location:'extra1',sobrestock:'8z99999z99'});
  stored=service.getInventoryRaw('OVER').items[0];
  assert.equal(stored.Sobrestock,'8Z99999Z99','The column holds one value: a new one replaces it');
  assert.equal(stored.Ubicacion_1,'EXTRA1');
  assert.equal(sheets.get(contract.member(stored)).Sobrestock,'8Z99999Z99');
  assert.equal(stored.Stock_Total,8,'Quantities stay as counted');
  await add({location:'extra2'});
  assert.equal(service.getInventoryRaw('OVER').items[0].Sobrestock,'8Z99999Z99','An additional location leaves it alone');
  assert.equal('sobrestock' in gasCalls.at(-1),false);
  await assert.rejects(add({sobrestock:'EXTRA1'}),/ya está registrada/);
  await assert.rejects(add({}),/ubicación válida/);
  const full=service.getInventoryRaw('OVER').items[0];
  await add({sobrestock:'7Z99999Z99'});
  assert.equal(service.getInventoryRaw('OVER').items[0].Ubicacion_2,full.Ubicacion_2,'A full item can still take overstock');
});

test('overstock is refused on cyclic items, and a script without the change is reported',async()=>{
  const cyclic=fixture(),item=counted();
  cyclic.put({id:'CYC',type:'CICLICO',center:'1120',name:'Ciclico',status:'EN_PROGRESO',items:[item]});
  await assert.rejects(cyclic.service.updateCount({inventoryId:'CYC',itemId:item.id,isNewLocation:true,sobrestock:'9Z99999Z99',user}),/solo existe en inventarios semanales/);
  const old=fixture(),weekly={...counted(),Schema_Version:contract.weeklyVersion};
  old.put({id:'OLD',type:'SEMANAL',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[weekly]});
  old.gas.upsertCountToGAS=async(type,{sobrestock,...p})=>({item:contract.update(old.sheets.get(contract.member(p)),p)});
  await assert.rejects(old.service.updateCount({inventoryId:'OLD',itemId:weekly.id,isNewLocation:true,sobrestock:'9Z99999Z99',user}),/actualice el Apps Script/);
});

test('adding a location sends the waiting count first, so the row keeps it',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,sheets,batches}=context,item={...counted(),Schema_Version:contract.weeklyVersion};
  put({id:'WAIT',type:'SEMANAL',center:'1120',name:'Semanal',status:'EN_PROGRESO',items:[item]});
  await service.updateCount({inventoryId:'WAIT',itemId:item.id,stockFisico:6,malEstado:0,user});
  assert.equal(batches.length,0);
  await service.updateCount({inventoryId:'WAIT',itemId:item.id,isNewLocation:true,location:'EXTRA1',user});
  assert.equal(batches.length,1);
  assert.equal(service.getInventoryRaw('WAIT').items[0].Stock_Total,6);
  assert.equal(sheets.get(contract.member(item)).Stock_Total,6);
});

function addLocationView(item){
  const elements=new Map(),calls=[],toasts=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,style:{},classList:{add(){},remove(){}},addEventListener(){},focus(){}});
    return elements.get(id);
  };
  const context={
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
    setTimeout:()=>0,clearTimeout(){},console,
    window:{addEventListener(){},Auth:{currentUser:{role:'AUXILIAR'}},InventoryContract:contract,
      Toast:{success:m=>toasts.push(m),warning:m=>toasts.push(m),danger:m=>toasts.push(m),info(){}},
      API:{registerCount:async(id,payload)=>{calls.push(payload);return {};}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/views/inventoryView.js'),'utf8'),context);
  const view=context.window.InventoryView;
  view.currentInventory={id:'INV',items:[item]};view.reloadCurrentInventory=async()=>{};
  return {view,element,calls,toasts};
}

test('the overstock box appears on weekly items only and sends what was typed',async()=>{
  const weekly={id:'I',SKU:'A',Ubicacion:'LOC',Schema_Version:contract.weeklyVersion};
  const {view,element,calls,toasts}=addLocationView(weekly);
  view.openAddLocationModal('I');
  assert.equal(element('add-loc-overstock-row').style.display,'block');
  assert.equal(element('add-loc-overstock-fields').style.display,'none','Closed until the box is ticked');
  assert.equal(element('add-loc-input-location').disabled,false);
  await view.saveAddLocation();
  assert.equal(calls.length,0,'Nothing typed, nothing saved');
  element('add-loc-overstock-check').checked=true;
  await view.saveAddLocation();
  assert.equal(calls.length,0,'A ticked box needs its location');
  assert.match(toasts.at(-1),/sobrestock/);
  element('add-loc-item-id').value='I';
  element('add-loc-input-overstock').value='9z99999z99';
  await view.saveAddLocation();
  assert.equal(calls[0].sobrestock,'9Z99999Z99');
  assert.equal(calls[0].location,'');
  element('add-loc-input-location').value='extra1';
  await view.saveAddLocation();
  assert.equal(calls[1].location,'EXTRA1');
  assert.equal(calls[1].sobrestock,'9Z99999Z99');

  const cyclic=addLocationView({id:'I',SKU:'A',Ubicacion:'LOC'});
  cyclic.view.openAddLocationModal('I');
  assert.equal(cyclic.element('add-loc-overstock-row').style.display,'none');
});

test('a weekly item with both additional locations still opens the window for overstock',async()=>{
  const {view,element,calls,toasts}=addLocationView({id:'I',SKU:'A',Ubicacion:'LOC',Ubicacion_1:'E1',Ubicacion_2:'E2',Sobrestock:'9Z99999Z99',Schema_Version:contract.weeklyVersion});
  view.openAddLocationModal('I');
  assert.equal(element('add-loc-input-location').disabled,true);
  assert.equal(element('add-loc-overstock-check').checked,true);
  assert.equal(element('add-loc-overstock-fields').style.display,'block');
  assert.equal(element('add-loc-input-overstock').value,'9Z99999Z99');
  assert.match(element('add-loc-overstock-hint').textContent,/reemplaza/);
  element('add-loc-item-id').value='I';
  await view.saveAddLocation();
  assert.equal(calls.length,0,'The same value changes nothing');
  assert.match(toasts.at(-1),/Esa ya es/);
  const full=addLocationView({id:'I',SKU:'A',Ubicacion:'LOC',Ubicacion_1:'E1',Ubicacion_2:'E2'});
  full.view.openAddLocationModal('I');
  assert.match(full.toasts.at(-1),/máximo permitido/);
});

function inlineView(){
  const elements=new Map(),calls=[],timers=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},querySelector:()=>null});
    return elements.get(id);
  };
  const context={
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},createElement:()=>element('x')},
    setTimeout:(work,delay)=>{const timer={work,delay};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;},
    console,window:{addEventListener(){},Auth:{currentUser:{role:'AUXILIAR'}},Toast:{success(){},warning(){},danger(){},info(){}},
      API:{registerCount:async(id,payload,options)=>{calls.push({id,payload,options});return {};},syncPendingCounts:async(id,options)=>{calls.push({sync:id,options});return {remaining:0};}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/views/inventoryView.js'),'utf8'),context);
  const view=context.window.InventoryView;
  view.currentInventory={id:'INV',items:[{id:'I',SKU:'A'}]};
  view.updateItemTotalBadge=()=>{};view.handleDamagedInput=()=>{};
  element('input-qty-I').value='5';element('input-damaged-I').value='0';
  return {view,calls,timers,run:()=>Promise.all(timers.filter(timer=>!timer.cancelled&&!timer.done).map(timer=>{timer.done=true;return timer.work();}))};
}

test('typing then confirming saves once, and an unconfirmed value still gets saved',async()=>{
  const confirmed=inlineView();
  confirmed.view.handleInlineCountChange('I');
  assert.equal(confirmed.timers.at(-1).delay,15000);
  confirmed.view.cancelInlineSave('I');
  await confirmed.run();
  assert.equal(confirmed.calls.length,0,'confirming replaces the automatic save');

  const typed=inlineView();
  typed.view.handleInlineCountChange('I');
  typed.view.handleInlineCountChange('I');
  await typed.run();
  assert.equal(typed.calls.length,1,'several changes make one save');
  assert.equal(typed.calls[0].payload.locked,false);
});

test('leaving the count saves what was typed and sends what is pending',async()=>{
  const {view,calls}=inlineView();
  view.handleInlineCountChange('I');
  view.scheduleSheetSync('INV');
  await view.flushCountWork({keepalive:true});
  assert.equal(calls[0].payload.stockFisico,5);assert.equal(calls[0].options.keepalive,true);
  assert.equal(calls[1].sync,'INV');assert.equal(calls[1].options.keepalive,true);
  await view.flushCountWork();
  assert.equal(calls.length,2,'nothing is sent twice');
});

test('operations that continue after sending pending counts do not bring them back',async()=>{
  const context=fixture({countSheetSync:'lotes'}),{service,put,batches}=context;
  const blank=(sku)=>({...counted(sku),Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null});
  const reviewed=blank('A');
  put({id:'REVIEW',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[reviewed]});
  await service.updateCount({inventoryId:'REVIEW',itemId:reviewed.id,stockFisico:7,malEstado:0,user:countUser});
  service.submitInventoryForReview({inventoryId:'REVIEW',user});
  await context.save('REVIEW',reviewed,'CUADRA');
  assert.equal(sent(context,'REVIEW'),undefined,'after a justification');

  const closed=blank('B');
  put({id:'CLOSE',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[closed]});
  await service.updateCount({inventoryId:'CLOSE',itemId:closed.id,stockFisico:10,malEstado:0,user:countUser});
  service.submitInventoryForReview({inventoryId:'CLOSE',user});
  await service.finishReviewAndClose({inventoryId:'CLOSE',user});
  assert.equal(sent(context,'CLOSE'),undefined,'after a close');
  assert.equal(service.getInventoryRaw('CLOSE').status,'REVISADO');

  const reopened=blank('C');
  put({id:'REOPEN',type:'CICLICO',name:'Example',status:'EN_PROGRESO',center:'1120',items:[reopened]});
  await service.updateCount({inventoryId:'REOPEN',itemId:reopened.id,stockFisico:10,malEstado:0,user:countUser});
  await service.reopenInventory({inventoryId:'REOPEN',user,targetPhase:'1ER_CONTEO'});
  assert.equal(sent(context,'REOPEN'),undefined,'after a reopening');
  assert.equal(batches.length,3);
});
