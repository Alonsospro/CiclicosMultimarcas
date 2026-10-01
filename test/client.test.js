const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');
function browser(state=new Map()) {
  const document = {body:null,getElementById:()=>null};
  const window = {document,Auth:{currentUser:{username:'tester',center:'1310'}},addEventListener(){},Toast:{warning(){},danger(){},success(){}}};
  const context = vm.createContext({window,document,localStorage:{getItem:k=>state.get(k)||null,setItem:(k,v)=>state.set(k,v),removeItem:k=>state.delete(k)},
    crypto:webcrypto, navigator:{onLine:true},setInterval(){},setTimeout,clearTimeout,console,Symbol,AbortSignal,FormData,URLSearchParams});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/countQueue.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/views/inventoryView.js'),'utf8'),context);
  window.InventoryView.currentInventory={id:'I1',items:[{id:'A',SKU:'S',Ubicacion:'L',Almacen:'W',Stock_Fisico:null,Mal_estado:0,locked:false}]};
  return {window,context,state,document};
}
const payload={itemId:'A',sku:'S',stockFisico:5,malEstado:0,locked:true};
test('offline count survives reload and retains the same operation ID',async()=>{
  const b=browser();let first;
  b.window.API={request:async(endpoint,options)=>{first=JSON.parse(options.body);throw new Error('Offline');}};
  await assert.rejects(b.window.CountQueue.send('I1',payload));
  assert.equal(b.window.CountQueue.read().length,1);
  assert.equal(b.window.InventoryView.currentInventory.items[0].Stock_Fisico,null);
  const reloaded=browser(b.state);let resent;
  reloaded.window.API={request:async(endpoint,options)=>{resent=JSON.parse(options.body);return {success:true,item:{...payload,id:'A',Stock_Fisico:5,_version:1}};}};
  reloaded.window.InventoryView.reloadCurrentInventory=async()=>{};
  await reloaded.window.CountQueue.flush();
  assert.equal(resent.operationId,first.operationId);assert.equal(reloaded.window.CountQueue.read().length,0);
  assert.equal(reloaded.window.InventoryView.currentInventory.items[0].Stock_Fisico,5);
});
test('pending operations never replay under another operator',async()=>{
  const b=browser();b.window.API={request:async()=>{throw new Error('Offline');}};
  await assert.rejects(b.window.CountQueue.send('I1',payload));
  b.window.Auth.currentUser={username:'another',center:'1310'};let calls=0;
  b.window.API.request=async()=>{calls++;};await b.window.CountQueue.flush();assert.equal(calls,0);
  b.window.Auth.currentUser={username:'tester',center:'1310'};assert.equal(b.window.CountQueue.read().length,1);
});
test('rapid double confirmation transmits one request',async()=>{
  const b=browser();let resolve,calls=0;
  b.window.API={request:()=>{calls++;return new Promise(r=>{resolve=r;});}};
  const a=b.window.CountQueue.send('I1',payload),c=b.window.CountQueue.send('I1',payload);
  assert.equal(calls,1);resolve({success:true});await Promise.all([a,c]);assert.equal(b.window.CountQueue.read().length,0);
});
test('typing keeps a draft without changing confirmed progress or scheduling a request',()=>{
  const b=browser();const view=b.window.InventoryView;
  const inputs={'input-qty-A':{value:'7'},'input-damaged-A':{value:'2'}};
  b.document.getElementById=id=>inputs[id]||null;
  view.updateItemTotalBadge=()=>{};view.handleDamagedInput=()=>{};
  let calls=0;b.window.API={registerCount:()=>calls++};
  view.handleInlineCountChange('A');
  assert.equal(calls,0);assert.equal(view.currentInventory.items[0].Stock_Fisico,null);
  assert.equal(b.window.CountQueue.draft('I1','A').stockFisico,'7');
});
test('confirm then navigate never counts a row in the next inventory',async()=>{
  const b=browser(),view=b.window.InventoryView;let finish,target;
  const input=value=>({value,style:{},setAttribute(){},disabled:false});
  const inputs={'input-qty-A':input('6'),'input-damaged-A':input('0'),'btn-count-lock-A':input('')};
  b.document.getElementById=id=>inputs[id]||null;
  b.window.API={registerCount:(id)=>{target=id;return new Promise(r=>{finish=r;});}};
  const operation=view.confirmAndLockItem('A');
  view.currentInventory={id:'I2',items:[{id:'A',Stock_Fisico:null}]};
  finish({success:true,item:{id:'A',Stock_Fisico:6,locked:true,_version:1}});await operation;
  assert.equal(target,'I1');assert.equal(view.currentInventory.items[0].Stock_Fisico,null);
});
test('conflicting count stays visible for review instead of retrying a stale value',async()=>{
  const b=browser();let calls=0;
  b.window.API={request:async()=>{calls++;throw Object.assign(new Error('Changed by another operator'),{status:409,code:'ITEM_CONFLICT'});}};
  await assert.rejects(b.window.CountQueue.send('I1',payload));await b.window.CountQueue.flush();
  assert.equal(calls,1);assert.equal(b.window.CountQueue.read()[0].state,'review');
});
test('HTTP 200 with success false is still rejected by API client',async()=>{
  const b=browser();b.window.AppConfig={apiBaseUrl:'/api',storageTokenKey:'token'};
  b.context.fetch=async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({success:false,message:'Not saved'})});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/api.js'),'utf8'),b.context);
  await assert.rejects(b.window.API.request('/inventories'),/Not saved/);
});

function photoForm(b) {
  const handlers = {};
  const inputs = {
    'btn-save-damage-photo': {addEventListener(event, callback){handlers[event]=callback;}},
    'damage-photo-item-id': {value:'A'},
    'damage-photo-url-val': {value:'https://drive.google.com/file/d/photo/view'}
  };
  b.document.getElementById = id => inputs[id] || null;
  b.window.ModalHelper = {close(){}};
  b.window.InventoryView.setupListeners();
  return handlers.click;
}
test('saving a recount photo preserves an explicit zero and uses the confirmed response',async()=>{
  const b=browser(),view=b.window.InventoryView;
  view.currentInventory.isReconteo=true;
  Object.assign(view.currentInventory.items[0],{Stock_Fisico:12,Mal_estado:3,Reconteo_Fisico:0,Reconteo_Mal_Estado:0});
  let sent;
  b.window.API={registerCount:async(id,p)=>{sent=p;return {item:{id:'A',Reconteo_Fisico:0,Reconteo_Mal_Estado:0,_version:2}};}};
  await photoForm(b)();
  assert.equal(sent.stockFisico,0);assert.equal(sent.malEstado,0);
  assert.equal(view.currentInventory.items[0]._version,2);
});
test('a damage photo cannot be confirmed before its upload finishes',async()=>{
  const b=browser();let calls=0;
  b.window.InventoryView._photoUploading={photoInput:Symbol()};
  b.window.API={registerCount:async()=>{calls++;}};
  await photoForm(b)();assert.equal(calls,0);
});
