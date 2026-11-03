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

function fixture() {
  const files = new Map(), sheets = new Map(), gasCalls = [], closures = [], batches = [];
  const failures = {drive:false, batch:null};
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
      if(failures.batch==='network')throw new Error('Google no respondió');
      const failedItems=[];
      p.updates.forEach((update,index)=>{
        try{
          if(failures.batch===update.sku)throw new Error('Ítem no encontrado');
          const item=sheets.get(contract.member(update));
          gasContext.validateJustificationStage_(item,update);
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
    './inventoryContract':contract,'./inventoryWorkflow':workflow,'../config':{isSameCenter:(a,b)=>a===b},
    './storagePath':store,'./auditService':new Proxy({}, {get:()=>()=>{}}),
    './gasService':gas,'./metricsService':{},'./snapshotService':{},
    './driveService':{getPhotoAsDataUri:()=>'',createFinalDriveFile:async p=>{
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
  return {service,files,sheets,gasCalls,closures,batches,failures,put,save,gasContext};
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
  const window={Toast:{warning:msg=>messages.push(msg),info(){},danger:msg=>messages.push(msg),success(){}},
    ModalHelper:{open(){},close(){}},Auth:{currentUser:user},API:{saveJustification:async p=>{saves.push(p);return {};}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/views/justificationsView.js'),'utf8'),{
    window,document:{getElementById:element,querySelectorAll:()=>[]},console,setTimeout:()=>{}
  });
  window.JustificationsView.initDualScrollbars=()=>{};
  return {view:window.JustificationsView,element,messages,saves};
}

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
