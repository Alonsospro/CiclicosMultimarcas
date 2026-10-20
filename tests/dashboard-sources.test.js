const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('invalid sources hide previous cards and retain an actionable link to their final copy', () => {
  const elements=new Map();
  const element=()=>({style:{},children:[],appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:element},window:{}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/views/dashboardView.js'),'utf8'),context);
  const view=context.window.DashboardView;
  const results=element(),panel=element(),print=element();
  elements.set('dash-metrics-results',results);elements.set('dash-source-validation',panel);
  elements.set('btn-dash-print-report',print);
  view.currentData={summary:{totalItemsAudited:124}};view.setMetricsPending();
  assert.equal(view.currentData,null);assert.equal(results.style.display,'none');assert.equal(print.disabled,true);
  const url='https://docs.google.com/spreadsheets/d/final_5100/edit#gid=123';
  view.renderSourceValidation({metricsValid:false,metricsComplete:false,sourceDiagnostics:[{
    center:'5100',status:'inconsistent',issues:['Costo_Unitario inválido'],spreadsheetUrl:url
  }]});
  assert.equal(results.style.display,'none');assert.equal(print.disabled,true);
  const descendants=node=>[node,...(node.children||[]).flatMap(descendants)];
  assert.equal(descendants(panel).find(child=>child.href)?.href,url);
  assert.ok(descendants(panel).some(child=>child.textContent?.includes('Costo_Unitario inválido')));
  assert.equal(panel.children[1].open,false,'Source diagnostics are collapsed by default');
  assert.equal(panel.children[1].children[1].className,'dashboard-sources__list');
  view.renderSourceValidation({metricsValid:true,metricsComplete:true,sourceDiagnostics:[]});
  assert.equal(results.style.display,'');assert.equal(print.disabled,false);
});

test('large source lists remain collapsed and history errors are not counted as excluded inventories',()=>{
  const elements=new Map();
  const element=()=>({style:{},children:[],appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:element},window:{}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/views/dashboardView.js'),'utf8'),context);
  const panel=element(),results=element();elements.set('dash-source-validation',panel);elements.set('dash-metrics-results',results);
  context.window.DashboardView.renderSourceValidation({metricsValid:true,metricsComplete:false,sourceDiagnostics:[
    ...Array.from({length:15},(_,i)=>({center:'5100',status:i<2?'valid':'inconsistent',issues:['Revisar']})),
    ...Array.from({length:3},()=>({kind:'discovery',status:'unavailable',issues:['No se pudo leer el historial']}))
  ]});
  assert.equal(panel.children.length,2);assert.equal(panel.children[1].open,false);
  assert.match(panel.children[0].textContent,/2 inventarios disponibles/);
  assert.match(panel.children[0].textContent,/13 por revisar/);
  assert.match(panel.children[0].textContent,/3 consultas pendientes/);
  assert.equal(results.style.display,'');
});
