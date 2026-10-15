const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../src/services/inventoryContract');
const workflow = require('../src/services/inventoryWorkflow');
const root = path.join(__dirname, '..');
const user = {role:'ADMIN', username:'reviewer', displayName:'Reviewer'};
const old = '2020-01-01T00:00:00.000Z';
const counted = (sku = 'A', warehouse = 'R001') => contract.normalize({id:sku+warehouse, SKU:sku, Almacen:warehouse,
  Ubicacion:'LOC', Stock_Sistema:10, Costo_Unitario:5, Stock_Buen_Estado:8, Mal_estado:0, Fecha_Ultimo_Conteo:old});

function fixture() {
  const files = new Map(), sheets = new Map(), gasCalls = [], closures = [];
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
    upsertCountToGAS:async(type,p)=>{
      const updated=contract.update(sheets.get(contract.member(p)),p);
      sheets.set(contract.member(p),updated); gasCalls.push(p); return {item:updated};
    }
  };
  const mocks = {
    './inventoryContract':contract,'./inventoryWorkflow':workflow,'../config':{isSameCenter:(a,b)=>a===b},
    './storagePath':store,'./auditService':new Proxy({}, {get:()=>()=>{}}),
    './gasService':gas,'./metricsService':{},'./snapshotService':{},
    './driveService':{getPhotoAsDataUri:()=>'',createFinalDriveFile:async p=>{
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
  const save = (invId,item,decision,round=1,text='Se verificaron las existencias y documentos.')=>service.saveJustification({
    inventoryId:invId,sku:item.SKU,itemId:item.id,almacen:item.Almacen,location:item.Ubicacion,
    round,corroboracion:decision,reasonType:'balanceo',justification:text,user
  });
  return {service,files,sheets,gasCalls,closures,put,save,gasContext};
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
