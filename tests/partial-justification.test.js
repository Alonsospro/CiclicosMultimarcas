const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../src/services/inventoryContract');
const workflow = require('../src/services/inventoryWorkflow');

const root = path.join(__dirname, '..');
const counted = '2026-10-20T10:00:00.000Z', reviewed = '2026-10-20T11:00:00.000Z';
const row = (extra = {}) => contract.normalize({id:'A', SKU:'A', Almacen:'R001', Ubicacion:'LOC', Stock_Sistema:10, Costo_Unitario:50,
  Stock_Buen_Estado:3, Mal_estado:0, Fecha_Ultimo_Conteo:counted, ...extra});
const weekly = (extra = {}) => row({Schema_Version:contract.weeklyVersion, ...extra});
const review = (decision, justifiedQuantity) => ({action:'saveJustification', corroboracion:decision, justifiedQuantity, round:1, fecha:reviewed,
  comentarioJustificacion:'Documentos revisados'});

for (const [label, build] of [['weekly', weekly], ['cyclic', row]]) {
  test(`${label}: justifying 6 of 7 compensates 6 and leaves 1 really missing, with its value in Bs`, () => {
    const result = contract.update(build(), review('NO CUADRA', 6));
    assert.equal(result.Estado, 'NO CUADRA');
    assert.equal(result.Cantidad_Justificada_1, 6);
    assert.equal(result.Stock_Sistema, 10, 'The system stock does not move');
    assert.equal(result.Stock_Total, 3, 'The physical count does not move');
    const detail = contract.differenceDetail(result);
    assert.equal(detail.difference, -7);
    assert.equal(detail.justified, 6);
    assert.equal(detail.remaining, -1);
    assert.equal(detail.remaining * result.Costo_Unitario, -50);
    assert.equal(contract.finalQuantity(result), 9);
  });

  test(`${label}: limits of the justified quantity`, () => {
    const none = contract.update(build(), review('NO CUADRA', 0));
    assert.equal(none.Estado, 'NO CUADRA');
    assert.equal(contract.differenceDetail(none).remaining, -7);
    assert.equal(contract.finalQuantity(none), 3);

    const whole = contract.update(build(), review('NO CUADRA', 7));
    assert.equal(whole.Estado, 'CUADRA', 'Justifying everything is CUADRA');
    assert.equal(contract.differenceDetail(whole).remaining, 0);

    assert.throws(() => contract.update(build(), review('NO CUADRA', 8)), /no puede superar la diferencia de 7/);
    assert.throws(() => contract.update(build(), review('NO CUADRA', -1)), /Cantidad inválida/);
    assert.throws(() => contract.update(build(), review('NO CUADRA', 1.5)), /Cantidad inválida/);
    assert.throws(() => contract.update(build(), review('CUADRA', 6)), /debe ser 7/);
  });

  test(`${label}: surplus follows the same rule with the opposite sign and never mixes with shortages`, () => {
    const surplus = build({Stock_Buen_Estado:13});
    const result = contract.update(surplus, review('NO CUADRA', 2));
    const detail = contract.differenceDetail(result);
    assert.equal(result.Cantidad_Justificada_1, -2);
    assert.equal(detail.difference, 3);
    assert.equal(detail.remaining, 1);
    assert.equal(contract.finalQuantity(result), 11);
    assert.throws(() => contract.update(surplus, review('NO CUADRA', 4)), /no puede superar la diferencia de 3/);
    assert.equal(contract.update(surplus, review('NO CUADRA', 3)).Estado, 'CUADRA');
  });

  test(`${label}: data saved before this change keeps its meaning`, () => {
    const noQuantity = contract.update(build(), review('NO CUADRA'));
    assert.equal(contract.differenceDetail(noQuantity).remaining, -7);
    const cuadra = contract.update(build(), review('CUADRA'));
    assert.equal(contract.differenceDetail(cuadra).remaining, 0);
    assert.equal(contract.differenceDetail(cuadra).justified, 7);
  });

  test(`${label}: a new count replaces the partial justification`, () => {
    const justified = contract.update(build(), review('NO CUADRA', 6));
    const recounted = contract.update(justified, {reconteo:5, malestadoReconteo:0, isReconteo:true, fechaReconteo:'2026-10-21T10:00:00.000Z'});
    const detail = contract.differenceDetail(recounted);
    assert.equal(detail.difference, -5);
    assert.equal(detail.remaining, -5);
    const again = contract.update(recounted, {...review('NO CUADRA', 4), round:2, fecha:'2026-10-21T11:00:00.000Z'});
    assert.equal(contract.differenceDetail(again).remaining, -1);
  });
}

test('cyclic: the 40 columns alone keep the partial result, and the justified units can be read back', () => {
  const result = contract.update(row(), review('NO CUADRA', 6));
  const exported = contract.finalItem(result);
  assert.equal(Object.keys(exported).length, 40, 'No column is added to the cyclic sheet');
  assert.equal(exported.Stock_Sistema, 10);
  assert.equal(exported.Diferencia, -1);
  assert.equal(exported.Costo_Diferencia, -50);
  const fromSheet = contract.normalize(exported);
  assert.deepEqual({...contract.differenceDetail(fromSheet)}, {stage:0, system:10, physical:3, difference:-7, justified:6, remaining:-1});
});

test('cyclic: closed rows from before this change never look like a partial justification', () => {
  const plain = contract.normalize({...row(), Estado:'NO CUADRA', Diferencia:-7});
  assert.equal(contract.differenceDetail(plain).justified, 0);
  const rewritten = contract.normalize({...row(), Stock_Sistema:3, Estado:'CUADRA', Diferencia:0});
  assert.equal(contract.differenceDetail(rewritten).remaining, 0);
  assert.equal(contract.finalQuantity(rewritten), 3);
  // A difference that does not shrink the counted one is not a compensation.
  const stale = contract.normalize({...row(), Estado:'NO CUADRA', Diferencia:-9});
  assert.equal(contract.differenceDetail(stale).justified, 0);
  const crossed = contract.normalize({...row(), Estado:'NO CUADRA', Diferencia:2});
  assert.equal(contract.differenceDetail(crossed).justified, 0);
});

test('weekly: an earlier NO CUADRA with a saved zero compensates nothing', () => {
  const legacy = weekly({Estado:'NO CUADRA', Cantidad_Justificada_1:0, Fecha_Primera_Justificacion:reviewed});
  assert.equal(contract.differenceDetail(legacy).remaining, -7);
  assert.equal(legacy.Cantidad_Fisica_Final, 3);
});

test('a partial review is complete but stays NO CUADRA, so it still goes through recount', () => {
  const item = contract.update(weekly(), review('NO CUADRA', 6));
  const done = workflow.review(item, 1);
  assert.equal(done.corroboracion, 'NO CUADRA');
  assert.equal(done.complete, true);
  assert.equal(done.justifiedQuantity, 6);
});

for (const script of ['produccion/InventoryWebhook.gs', 'produccion/InventoryWebhookSemanales.gs', 'InventoryWebhook.gs', 'InventoryWebhookSemanales.gs']) {
  test(`${script} applies the same partial justification and limits`, () => {
    const context = vm.createContext({console});
    vm.runInContext(fs.readFileSync(path.join(root, 'integrations/apps-script', script), 'utf8'), context);
    const gas = vm.runInContext('InventoryContract', context);
    const build = script.includes('Semanales') ? weekly : row;
    const result = gas.update(build(), review('NO CUADRA', 6));
    assert.equal(result.Estado, 'NO CUADRA');
    assert.equal(result.Stock_Sistema, 10);
    if (script.includes('Semanales')) assert.equal(result.Cantidad_Fisica_Final, 9);
    else {
      assert.equal(result.Diferencia, -1);
      assert.equal(result.Costo_Diferencia, -50);
    }
    assert.equal(gas.update(build(), review('NO CUADRA', 7)).Estado, 'CUADRA');
    assert.throws(() => gas.update(build(), review('NO CUADRA', 8)), /no puede superar/);
    assert.throws(() => gas.update(build(), review('CUADRA', 6)), /debe ser 7/);
    const none = gas.update(build(), review('NO CUADRA', 0));
    assert.equal(none.Estado, 'NO CUADRA');
    if (!script.includes('Semanales')) assert.equal(none.Diferencia, -7);
    const surplus = gas.update(build({Stock_Buen_Estado:13}), review('NO CUADRA', 2));
    if (!script.includes('Semanales')) assert.equal(surplus.Diferencia, 1);
    else assert.equal(surplus.Cantidad_Fisica_Final, 11);
  });
}

function loadMetrics() {
  const module = {exports:{}};
  const mocks = {
    './metricsSourceService':{invalidate() {}}, './inventoryContract':contract,
    './counterReliability':require('../src/services/counterReliability'), './reportBreakdown':require('../src/services/reportBreakdown'),
    './storagePath':{getInventoriesDirectory:() => '/inventories', getHistoryDirectory:() => '/history', getUsersFilePath:() => '/users', readJson:() => []},
    '../config':{getCenterCode:code => code, findCenter:code => ({code, name:'Centro'}), isSameCenter:(a, b) => a === b, centersList:[{code:'1160', name:'Centro'}]},
    './auditService':{getAuditLogs:() => []}, './gasService':{}, './snapshotService':{}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/services/metricsService.js'), 'utf8'), {
    module, exports:module.exports, console, Date, require:name => Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  });
  return module.exports;
}
const line = (sku, extra) => ({SKU:sku, Descripcion:sku, Almacen:'RFO7', Ubicacion:'A010101001', Clasificacion_ABC:'A', Stock_Sistema:10,
  Stock_Fisico:3, Stock_Total:3, Mal_estado:0, Costo_Unitario:100, Fecha_Ultimo_Conteo:counted, ...extra});
async function metricsOf(items) {
  const service = loadMetrics();
  service.getAllInventoriesData = async () => [{id:'INV-1160-1', name:'INV-1160-1', isHistory:true, status:'REVISADO', center:'1160', type:'CICLICO',
    createdAt:'2026-10-15', closedAt:'2026-10-15', items}];
  return JSON.parse(JSON.stringify(await service.getDashboardMetrics({})));
}
const partialRow = {Estado:'NO CUADRA', Diferencia:-1, Costo_Diferencia:-100, Comentario_Justificacion:'Seis con guía de remisión', Fecha_Primera_Justificacion:reviewed};

test('metrics of a closed cyclic file: first count keeps 7 missing and the close only the 1 that remains', async () => {
  const metrics = await metricsOf([line('PART', partialRow)]);
  assert.equal(metrics.summary.faltantesFinal.units, 1);
  assert.equal(metrics.summary.faltantesFinal.cost, 100);
  const entry = metrics.discrepanciesList[0];
  assert.equal(entry.diferencia1erConteo, -7);
  assert.equal(entry.diferenciaFinal, -1);
  assert.equal(entry.absCostoDiferenciaFinal, 100);
  assert.equal(entry.absCostoDiferencia1erConteo, 700);
  assert.equal(entry.cantidadJustificada, 6);
  assert.equal(entry.diferenciaContada, -7);
  assert.equal(entry.stockFisicoFinal, 9);
  assert.equal(entry.tipoDiscrepancia, 'FALTANTE');
  assert.equal(metrics.summary.itemsCuadradosFinalUnits, 9, 'ERI counts the 9 units explained, not 3 nor 10');
});

test('metrics of an open cyclic inventory read the same when the app kept the original stock', async () => {
  const metrics = await metricsOf([line('PART', {...partialRow, Stock_Sistema_Original:10})]);
  assert.equal(metrics.summary.faltantesFinal.units, 1);
  assert.equal(metrics.discrepanciesList[0].diferencia1erConteo, -7);
});

test('metrics of a weekly partial justification leave 1 missing', async () => {
  const item = contract.update(weekly({Costo_Unitario:100, Ubicacion:'A010101001'}), review('NO CUADRA', 6));
  const metrics = await metricsOf([item]);
  assert.equal(metrics.summary.faltantesFinal.units, 1);
  assert.equal(metrics.summary.faltantesFinal.cost, 100);
  assert.equal(metrics.discrepanciesList[0].cantidadJustificada, 6);
  assert.equal(metrics.discrepanciesList[0].diferenciaContada, -7);
});

test('shortages and surpluses stay apart: a partial surplus does not reduce a partial shortage', async () => {
  const metrics = await metricsOf([line('PART', partialRow),
    line('OVER', {Stock_Fisico:13, Stock_Total:13, Estado:'NO CUADRA', Diferencia:1, Costo_Diferencia:100})]);
  assert.equal(metrics.summary.faltantesFinal.units, 1);
  assert.equal(metrics.summary.sobrantesFinal.units, 1);
  assert.equal(metrics.discrepanciesList.find(item => item.sku === 'OVER').cantidadJustificada, 2);
});

test('metrics of earlier inventories do not change', async () => {
  const metrics = await metricsOf([
    line('NOPE', {Estado:'NO CUADRA', Diferencia:-7, Costo_Diferencia:-700}),
    line('DONE', {Stock_Sistema:3, Stock_Sistema_Original:10, Estado:'CUADRA', corroboracion:'CUADRA', Diferencia:0, Costo_Diferencia:0})
  ]);
  assert.equal(metrics.summary.faltantesFinal.units, 7);
  const nope = metrics.discrepanciesList.find(item => item.sku === 'NOPE'), done = metrics.discrepanciesList.find(item => item.sku === 'DONE');
  assert.equal(nope.diferenciaFinal, -7);
  assert.equal(nope.cantidadJustificada, 0);
  assert.equal(done.diferenciaFinal, 0);
  assert.equal(done.diferencia1erConteo, -7);
});

test('the PDF report shows the units that remain and how many of the counted ones were justified', async () => {
  const context = vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/components/managementReport.js'), 'utf8'), context);
  const metrics = await metricsOf([line('PART', partialRow)]);
  const annex = context.window.ManagementReport.render({id:'INV'}, metrics).split('<b>Anexo A · Faltantes</b>')[1].split('<b>Anexo B')[0];
  assert.match(annex, /Justificado 6 de 7\. Seis con guía de remisión/);
  assert.match(annex, /−1</);
  assert.doesNotMatch(annex, /−7</);
});

function browser() {
  const elements = new Map(), messages = [], saves = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {id, value:'', style:{}, innerHTML:'', textContent:'', options:[],
      classList:{add() {}, remove() {}, contains() { return false; }}, reset() {}, focus() {}});
    return elements.get(id);
  };
  const window = {InventoryContract:contract, Toast:{warning:msg => messages.push(msg), info() {}, danger:msg => messages.push(msg), success:msg => messages.push(msg)},
    ModalHelper:{open() {}, close() {}}, Auth:{currentUser:{role:'ADMIN'}},
    API:{saveJustification:async p => { saves.push(p); return {justification:{reviewItem:{}, reviewState:{}, corroboracion:'NO CUADRA'}}; }}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/views/justificationsView.js'), 'utf8'), {
    window, document:{getElementById:element, querySelectorAll:() => []}, console, setTimeout:() => {}
  });
  window.JustificationsView.initDualScrollbars = () => {};
  return {view:window.JustificationsView, element, messages, saves};
}

test('justification form: the manager types the quantity and sees what really remains', () => {
  const {view, element} = browser();
  const item = {...row(), canJustify:true};
  const select = element('just-select-corroboration'), input = element('just-compensation-quantity'), hint = element('just-compensation-hint');
  element('just-compensation-panel');
  view.currentIsSecondJustification = false;
  select.value = 'NO_CUADRA';
  input.value = '6';
  view.refreshCompensation(item);
  assert.equal(input.readOnly, false);
  assert.equal(element('just-compensation-panel').hidden, false);
  assert.match(hint.textContent, /Faltante contado: 7\. Justificado: 6\. Falta realmente: 1 \(Bs\. 50\.00\)/);

  input.value = '8';
  view.refreshCompensation(item);
  assert.match(hint.textContent, /de 0 a 7/);
  assert.equal(select.value, 'NO_CUADRA');

  input.value = '7';
  view.refreshCompensation(item);
  assert.equal(select.value, 'CUADRA', 'Justifying everything turns into CUADRA');
  assert.equal(input.readOnly, true);
  assert.match(hint.textContent, /Queda sin diferencia/);

  select.value = 'NO_CUADRA';
  view.refreshCompensation(item, true);
  assert.equal(input.value, '0', 'Going back to NO CUADRA justifies nothing until a quantity is typed');
  assert.match(hint.textContent, /Falta realmente: 7/);

  // The "No cuadra" button on an item already saved as partial keeps the saved quantity.
  input.value = '6';
  view.refreshCompensation(item, true);
  assert.equal(input.value, '6');
});

test('justification form: without a difference there is nothing to type', () => {
  const {view, element} = browser();
  element('just-select-corroboration').value = 'CUADRA';
  element('just-compensation-quantity');element('just-compensation-hint');
  view.currentIsSecondJustification = false;
  view.refreshCompensation({...row({Stock_Buen_Estado:10}), canJustify:true});
  assert.equal(element('just-compensation-panel').hidden, true);
});

async function saveFromForm(typed) {
  const browserView = browser(), {view, element} = browserView;
  const item = {...row(), canJustify:true};
  view.tasks = [{inventoryId:'INV', items:[item]}];
  view.currentInventoryId = 'INV';
  element('just-modal-inv-id').value = 'INV';
  element('just-modal-sku-input').value = 'A';
  element('just-modal-item-id').value = 'A';
  element('just-modal-item-idx').value = '0';
  element('just-select-reason').value = 'balanceo';
  element('just-input-text').value = 'Guía de remisión';
  element('just-select-corroboration').value = 'NO_CUADRA';
  element('just-compensation-panel').hidden = false;
  element('just-compensation-quantity').value = typed;
  element('just-photo-url').value = '';
  const saved = await view.saveCurrentModalJustification(false);
  return {...browserView, saved};
}

test('justification form sends the typed quantity and refuses more than the difference before calling the server', async () => {
  const partial = await saveFromForm('6');
  assert.equal(partial.saved, true);
  assert.equal(partial.saves[0].justifiedQuantity, '6');
  const blank = await saveFromForm('');
  assert.equal(blank.saves[0].justifiedQuantity, 0);
  const excess = await saveFromForm('8');
  assert.equal(excess.saved, false);
  assert.equal(excess.saves.length, 0);
  assert.match(excess.messages[0], /no puede superar la diferencia de 7/);
});

test('review screen shows the justified units and what really remains', () => {
  const {view, element} = browser();
  const inv = {id:'INV', center:'1120', status:'PENDIENTE_JUSTIFICACION',
    items:[contract.update(row(), review('NO CUADRA', 6))]};
  const plan = workflow.plan(inv);
  view.tasks = [{...inv, inventoryId:'INV', inventoryName:'Example', ...plan, items:plan.items}];
  view.expandedTaskIds.add('INV');
  view.renderTasks();
  const html = element('justifications-container').innerHTML;
  assert.match(html, /Falta realmente: 1/);
  assert.match(html, /Justificado 6 de 7/);
  assert.match(html, /Compensación: \+6/);
});
