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
  assert.equal(panel.children.find(child=>child.href)?.href,url);
  assert.ok(panel.children.some(child=>child.textContent?.includes('Costo_Unitario inválido')));
  view.renderSourceValidation({metricsValid:true,metricsComplete:true,sourceDiagnostics:[]});
  assert.equal(results.style.display,'');assert.equal(print.disabled,false);
});
