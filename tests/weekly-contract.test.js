const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../src/services/inventoryContract');
const workflow = require('../src/services/inventoryWorkflow');
const root = path.join(__dirname, '..');
const t0 = '2026-10-14T10:00:00.000Z';
const t1 = '2026-10-14T11:00:00.000Z';
const t2 = '2026-10-14T12:00:00.000Z';
const t3 = '2026-10-14T13:00:00.000Z';
// ERU only accepts 10-character alphanumeric locations.
const [L1, L2, L3] = ['A010101001', 'A010101002', 'A010101003'];
const base = (overrides = {}) => contract.normalize({Schema_Version:contract.weeklyVersion, id:'ITEM',
  SKU:'SKU1', Almacen:'A', Ubicacion:L1, Stock_Sistema:10, Costo_Unitario:5,
  Stock_Buen_Estado:8, Mal_estado:0, Fecha_Ultimo_Conteo:t0, ...overrides});
const justify = (item, quantity, options = {}) => contract.update(item, {action:'saveJustification',
  corroboracion:'CUADRA', justifiedQuantity:quantity, fecha:t1, comentarioJustificacion:'Documentación verificada',
  reviewedBy:'Encargado', ...options});

test('weekly shortage compensation preserves K and M while L becomes the reconciled result without recount', () => {
  const result = justify(base(), 2);
  assert.equal(result.Stock_Sistema, 10);
  assert.equal(result.Stock_Total, 8);
  assert.equal(result.Cantidad_Justificada_1, 2);
  assert.equal(result.Cantidad_Fisica_Final, 10);
  assert.equal(result.Diferencia, -2);
  assert.equal(result.Costo_Diferencia, -10);
  assert.equal(workflow.review(result, 1).complete, true);
  assert.equal(contract.finalItem(result).Cantidad_Fisica_Final, 10);
});

test('weekly surplus records a negative compensation and ignores a supplied replacement for K', () => {
  const result = justify(base({Stock_Buen_Estado:13}), 3, {originalStockSistema:999, stockSistema:999});
  assert.equal(result.Cantidad_Justificada_1, -3);
  assert.equal(result.Stock_Sistema, 10);
  assert.equal(result.Stock_Sistema_Original, 10);
  assert.equal(result.Stock_Total, 13);
  assert.equal(result.Cantidad_Fisica_Final, 10);
  assert.equal(result.Diferencia, 3);
});

test('CUADRA requires the exact nonnegative integer magnitude; NO CUADRA removes its compensation', () => {
  for (const amount of [undefined, '', -2, 1.5, 1, 3, true, 'abc']) {
    assert.throws(() => justify(base(), amount));
  }
  const reversed = justify(justify(base(), 2), undefined, {corroboracion:'NO CUADRA', fecha:t2});
  assert.equal(reversed.Cantidad_Justificada_1, 0);
  assert.equal(reversed.Cantidad_Fisica_Final, 8);
  assert.equal(reversed.Stock_Sistema, 10);
  assert.equal(workflow.review(reversed, 1).complete, true);
});

test('a new physical observation supersedes old compensation and a second justification uses the latest stage only', () => {
  const first = justify(base(), 2);
  const recounted = contract.update(first, {isReconteo:true, reconteo:9, malestadoReconteo:0, fechaReconteo:t2});
  assert.equal(recounted.Cantidad_Justificada_1, 2, 'Keep the first review as history');
  assert.equal(recounted.Cantidad_Fisica_Final, 9, 'Do not carry compensation into a later observation');
  const second = justify(recounted, 1, {round:2, fecha:t3});
  assert.equal(second.Cantidad_Justificada_2, 1);
  assert.equal(second.Cantidad_Fisica_Final, 10);
  assert.equal(second.Stock_Total, 8);
  assert.equal(second.Stock_Total_Reconteo, 9);
  assert.equal(second.Diferencia_Final, -1);
  const twice = contract.update(second, {isReconteo2:true, reconteo2:11, malestadoReconteo2:0,
    fechaReconteo2:'2026-10-14T14:00:00.000Z'});
  assert.equal(twice.Cantidad_Fisica_Final, 11);
  const final = justify(twice, 1, {round:2, fecha:'2026-10-14T15:00:00.000Z'});
  assert.equal(final.Cantidad_Justificada_2, -1);
  assert.equal(final.Cantidad_Fisica_Final, 10);
  assert.equal(final.Stock_Total_Reconteo_2, 11);
});

test('zero recount is a physical observation, while uncounted rows have no final quantity or valid CUADRA', () => {
  const rec = contract.update(base(), {isReconteo:true, reconteo:0, malestadoReconteo:0, fechaReconteo:t2});
  assert.equal(rec.Cantidad_Fisica_Final, 0);
  assert.equal(justify(rec, 10, {round:2, fecha:t3}).Cantidad_Fisica_Final, 10);
  const empty = base({Stock_Buen_Estado:null});
  assert.equal(empty.Cantidad_Fisica_Final, null);
  assert.throws(() => justify(empty, 10), /sin conteo/);
  assert.equal(workflow.review({...base(), Estado:'CUADRA', Fecha_Primera_Justificacion:t1,
    Comentario_Justificacion:'Cuadra'}, 1).complete, false);
});

test('a fresh weekly inventory cannot inherit the previous weekly cycle recounts or compensations from Sheets',()=>{
  const previous=justify(base({Reconteo:9,Malestado_Reconteo:0,Fecha_Reconteo:t2}),1,{round:2,fecha:t3});
  const fresh=contract.update(previous,{inventoryId:'NEW-WEEK',resetWeeklyCycle:true,stockBuenEstado:7,malEstado:1,
    fechaUltimoConteo:'2026-10-15T10:00:00.000Z'});
  assert.equal(fresh.Stock_Sistema,10);
  assert.equal(fresh.Stock_Total,8);
  assert.equal(fresh.Cantidad_Fisica_Final,8);
  assert.equal(fresh.Stock_Total_Reconteo,null);
  assert.equal(fresh.Cantidad_Justificada_2,null);
  assert.equal(fresh.Estado_Justificacion_2,undefined);
  assert.throws(()=>contract.update(previous,{inventoryId:'NEW-WEEK',resetWeeklyCycle:true,isReconteo:true,reconteo:8}),/Inicio semanal/);
});

test('the weekly column map places every physical total and compensation at its agreed position', () => {
  assert.equal(contract.weeklyColumns.length, 43);
  for (const [index, field] of [[10,'Stock_Sistema'],[11,'Cantidad_Fisica_Final'],[12,'Stock_Total'],
    [24,'Cantidad_Justificada_1'],[26,'Stock_Total_Reconteo'],[36,'Cantidad_Justificada_2'],
    [38,'Stock_Total_Reconteo_2'],[42,'Costo_Diferencia_Final_2']]) {
    assert.equal(contract.weeklyColumns[index], field);
  }
});

function scriptContext(item = base()) {
  const context = vm.createContext({console, Date});
  vm.runInContext(fs.readFileSync(path.join(root,'integrations/apps-script/InventoryWebhookSemanales.gs'),'utf8'), context);
  const grid = [contract.weeklyHeaders.slice(), contract.weeklyColumns.map(key => item[key] ?? '')];
  const writes = [];
  const sheet = {
    getName:()=>'1120',getMaxColumns:()=>43,getLastRow:()=>2,getMaxRows:()=>100,
    getRange(row, column, height=1, width=1) {
      return {getDisplayValues:()=>grid.slice(row-1,row-1+height).map(r=>r.slice(column-1,column-1+width).map(String)),
        getValues:()=>grid.slice(row-1,row-1+height).map(r=>r.slice(column-1,column-1+width)),
        setValues(values){writes.push({row,column,width});values.forEach((r,i)=>r.forEach((v,j)=>{grid[row-1+i][column-1+j]=v;}));}};
    }
  };
  context.getCenterSheet_ = () => sheet;
  context.savePhotoIfAny_ = () => null;
  return {context, grid, sheet, writes};
}

test('the actual weekly Apps Script validates headers and never includes K in count or justification writes', () => {
  const {context,grid,sheet,writes} = scriptContext();
  context.validateHeaders_(sheet);
  const result = context.upsertCount_({schemaVersion:contract.weeklyVersion, action:'saveJustification',
    center:'1120',sku:'SKU1',almacen:'A',location:L1,round:1,corroboracion:'CUADRA',justifiedQuantity:2,
    fecha:t1,comentarioJustificacion:'Documento revisado',
    workflow:{version:1,status:'PENDIENTE_JUSTIFICACION',round:1,countStage:0}});
  assert.equal(result.item.Cantidad_Fisica_Final, 10);
  assert.equal(grid[1][10], 10);
  assert.equal(grid[1][11], 10);
  assert.equal(grid[1][12], 8);
  assert.equal(grid[1][24], 2);
  assert.ok(writes.every(w => !(w.column <= 11 && w.column + w.width > 11)));
  assert.throws(()=>context.upsertCount_({sku:'SKU1'}), /Actualice la appweb/);
  grid[0][11]='Total Conteo';
  assert.throws(()=>context.validateHeaders_(sheet), /columna 12/);
});

function metricsService(items) {
  const module = {exports:{}};
  const mocks = {
    './metricsSourceService':{invalidate(){}},
    './inventoryContract':contract, './counterReliability':require('../src/services/counterReliability'),
    './storagePath':{getInventoriesDirectory:()=>'/inventories',getHistoryDirectory:()=>'/history',getUsersFilePath:()=>'/users',readJson:()=>[]},
    '../config':{getCenterCode:c=>c,findCenter:c=>({code:c,name:'Centro'}),isSameCenter:(a,b)=>a===b},
    './auditService':{getAuditLogs:()=>[]},'./gasService':{},'./snapshotService':{}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/services/metricsService.js'),'utf8'), {
    module, console, Date, require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name)
  });
  module.exports.getAllInventoriesData = async()=>[{id:'WEEKLY',name:'Semanal',type:'SEMANALES',center:'1120',createdAt:t0,items}];
  return module.exports;
}

test('weekly metrics compare original M and reconciled L against fixed K, including compensation without recount', async () => {
  const item = justify(base({Ubicacion_1:L2,corroboracion:'CUADRA'}),2);
  const before = JSON.stringify(item);
  const metrics = await metricsService([item]).getDashboardMetrics({});
  assert.equal(metrics.summary.eriItemInicial,80);
  assert.equal(metrics.summary.eriItemFinal,100);
  assert.equal(metrics.summary.eriSkuInicial,0);
  assert.equal(metrics.summary.eriSkuFinal,100);
  assert.equal(metrics.summary.eriMonetarioInicial,80);
  assert.equal(metrics.summary.eriMonetarioFinal,100);
  assert.equal(metrics.summary.eruPercent,0, 'A second location disqualifies the SKU');
  assert.equal(metrics.discrepanciesList[0].stockFisicoFinal,10);
  assert.equal(metrics.discrepanciesList[0].physicalQuantityFinal,8);
  assert.equal(JSON.stringify(item),before);
});

test('weekly ERU scores only a single valid primary location, independently of quantity or CUADRA', async () => {
  const items = [base({SKU:'ONE'}),base({SKU:'TWO',Ubicacion_1:L2}),
    base({SKU:'THREE',Ubicacion_1:L2,Ubicacion_2:L3}),base({SKU:'BAD',Ubicacion:'L1'})];
  const before = await metricsService(items).getDashboardMetrics({});
  const after = await metricsService(items.map(item=>justify(item,2))).getDashboardMetrics({});
  assert.equal(before.summary.eruPercent,25);
  assert.equal(after.summary.eruPercent,25);
  assert.equal(after.summary.totalLocationsEvaluated,4);
  assert.equal(after.summary.eruModel,'SKU_LOCATION_VALIDITY');
});

test('same SKU in different warehouses cannot cancel shortages and surpluses in weekly SKU accuracy', async () => {
  const metrics = await metricsService([base(),base({Almacen:'B',Stock_Buen_Estado:12})]).getDashboardMetrics({});
  assert.equal(metrics.summary.eriSkuInicial,0);
  assert.equal(metrics.summary.eriSkuFinal,0);
  assert.equal(metrics.summary.eruPercent,100, 'Weekly SKUs are scored per warehouse');
});
