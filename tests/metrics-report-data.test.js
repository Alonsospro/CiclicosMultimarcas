const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMetricsService() {
  const module = { exports: {} };
  const mocks = {
    './metricsSourceService': { invalidate() {} },
    './inventoryContract': require('../src/services/inventoryContract'),
    './counterReliability': require('../src/services/counterReliability'),'./reportBreakdown':require('../src/services/reportBreakdown'),
    './storagePath': { getInventoriesDirectory: () => '/inventories', getHistoryDirectory: () => '/history', getUsersFilePath: () => '/users', readJson: () => [] },
    '../config': { getCenterCode: code => code, findCenter: code => ({ code, name: 'Centro' }), isSameCenter: (a, b) => a === b },
    './auditService': { getAuditLogs: () => [] }, './gasService': {}, './snapshotService': {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/metricsService.js'), 'utf8'), {
    module, exports: module.exports, console, Date,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  });
  return module.exports;
}

const closedInventory = (id, createdAt) => ({
  id, isHistory: true, status: 'REVISADO', center: '1160', type: 'CICLICO', createdAt,
  items: [{ SKU: `SKU-${id}`, Stock_Sistema: 10, Stock_Fisico: 10, Stock_Total: 10, Mal_estado: 0, Diferencia: 0, Costo_Unitario: 5, Ubicacion: 'A1', Almacen: 'RFO7' }]
});

test('ERI trend contains only real closed inventories, never fixed filler values', async () => {
  const service = loadMetricsService();
  service.getAllInventoriesData = async () => [closedInventory('INV-1160-1', '2026-10-01'), closedInventory('INV-1160-2', '2026-10-15')];
  const { historicalEriTrend: trend } = await service.getDashboardMetrics({});
  assert.deepEqual(Array.from(trend.series, point => point.id), ['INV-1160-1', 'INV-1160-2']);
  assert.equal(trend.data.length, 2);
  assert.equal(trend.labels.length, 2);
  assert.equal(trend.delta, trend.latestEri - trend.previousEri);
  assert.equal(trend.trendStatus, 'ESTABLE');
});

test('ERI trend reports no comparison with one closure and no values without closures', async () => {
  const service = loadMetricsService();
  service.getAllInventoriesData = async () => [closedInventory('INV-1160-1', '2026-10-01')];
  const single = (await service.getDashboardMetrics({})).historicalEriTrend;
  assert.equal(single.data.length, 1);
  assert.equal(single.previousEri, null);
  assert.equal(single.delta, null);
  assert.equal(single.trendStatus, 'SIN_COMPARACION');

  const empty = loadMetricsService();
  empty.getAllInventoriesData = async () => [{ ...closedInventory('INV-1160-2', '2026-10-15'), isHistory: false, status: 'EN_PROCESO' }];
  const none = (await empty.getDashboardMetrics({})).historicalEriTrend;
  assert.equal(none.data.length, 0);
  assert.equal(none.latestEri, null);
  assert.equal(none.latestEvaluation, null);
  assert.equal(none.average, null);
});

test('dashboard code keeps no invented trend history', () => {
  for (const file of ['../src/services/metricsService.js', '../public/js/views/dashboardView.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /defaultBaselines|INV-CIC-1300|Cíclico Jul-26/);
  }
});

test('report exposes damage identified only in a recount and preserves the initial/final quantities', async () => {
  const module = { exports: {} };
  const mocks = {
    './metricsSourceService':{invalidate(){}},
    './inventoryContract':require('../src/services/inventoryContract'),
    './counterReliability':require('../src/services/counterReliability'),'./reportBreakdown':require('../src/services/reportBreakdown'),
    './storagePath': { getInventoriesDirectory: () => '/inventories', getHistoryDirectory: () => '/history', getUsersFilePath: () => '/users', readJson: () => [{ username: 'contador', displayName: 'Contador Real', role: 'AUXILIAR', center: '1160' }, { username: 'jefe', displayName: 'Encargado Real', role: 'ENCARGADO', center: '1160' }, { username: 'otro', displayName: 'Otro Centro', role: 'ENCARGADO', center: '1120' }] },
    '../config': { getCenterCode: code => code, findCenter: code => ({ code, name: 'Centro' }), isSameCenter: (a, b) => a === b },
    './auditService': { getAuditLogs: () => [] }, './gasService': {}, './snapshotService': {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/metricsService.js'), 'utf8'), {
    module, exports: module.exports, console, Date,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  });
  const service = module.exports;
  const item = { SKU: 'FINAL-DAMAGE', Responsable: 'contador', Fecha_Ultimo_Conteo: '2026-10-15', Stock_Sistema: 10, Stock_Fisico: 10, Stock_Total: 10, Mal_estado: 0, Diferencia: 0, Costo_Unitario: 5, Reconteo_2: 7, Malestado_Reconteo_2: 3, Stock_Total_Reconteo_2: 10, Diferencia_Final_2: 0, Ubicacion: 'A1', Almacen: 'RFO7' };
  service.getAllInventoriesData = async () => [{ id: 'INV-1160-1', isHistory: true, status: 'REVISADO', center: '1160', type: 'CICLICO', items: [item], createdAt: '2026-10-15' }];
  const before = JSON.stringify(item);
  const metrics = await service.getDashboardMetrics({});
  assert.equal(JSON.stringify(metrics.reportSignatories), JSON.stringify({ counters: ['Contador Real'], centerManagers: ['Encargado Real'] }));
  const result = metrics.discrepanciesList.find(row => row.sku === item.SKU);
  assert.ok(result, 'Avería hallada en reconteo debe aparecer en el informe');
  assert.equal(result.stockFisico, 10);
  assert.equal(result.stockFisicoFinal, 10);
  assert.equal(result.malEstado, 0);
  assert.equal(result.malEstadoFinal, 3);
  assert.equal(result.costoMalEstadoFinal, 15);
  assert.equal(metrics.summary.totalDamagedCost, 15);
  assert.equal(before, JSON.stringify(item));
});

test('report motive is the latest justification written, in whichever round it exists', async () => {
  const shortage = (SKU, fields) => ({ SKU, Stock_Sistema: 2, Stock_Fisico: 1, Stock_Total: 1, Mal_estado: 0, Diferencia: -1, Costo_Unitario: 5, Ubicacion: 'A1', Almacen: 'RVO0', ...fields });
  const service = loadMetricsService();
  service.getAllInventoriesData = async () => [{ id: 'INV-1120-1', isHistory: true, status: 'REVISADO', center: '1120', type: 'CICLICO', createdAt: '2026-10-14', items: [
    shortage('ONLY-SECOND', { Razon_Justificacion_2: 'otro', Comentario_Justificacion_2: 'Texto de la segunda', Fecha_Justificacion_2: '31/10/2026 9:34:53' }),
    shortage('ONLY-FIRST', { Razon: 'otro', Comentario_Justificacion: 'Texto de la primera', Fecha_Primera_Justificacion: '14/10/2026 12:00:00', Razon_Justificacion_2: 'balanceo' }),
    shortage('BOTH', { Comentario_Justificacion: 'Primera', Fecha_Primera_Justificacion: '13/10/2026 12:00:00', Comentario_Justificacion_2: 'Segunda', Fecha_Justificacion_2: '02/11/2026 8:00:00' }),
    shortage('FIRST-IS-NEWER', { Comentario_Justificacion: 'Reabierta', Fecha_Primera_Justificacion: '13/11/2026 12:00:00', Comentario_Justificacion_2: 'Anterior', Fecha_Justificacion_2: '02/11/2026 8:00:00' }),
    shortage('BLANK-SECOND', { Comentario_Justificacion: 'Primera válida', Fecha_Primera_Justificacion: '13/10/2026 12:00:00', Comentario_Justificacion_2: '   ', Fecha_Justificacion_2: '14/10/2026 8:00:00' }),
    shortage('ONLY-REASON', { Razon_Justificacion_2: 'balanceo' }),
    shortage('NOTHING', {})
  ] }];
  const { discrepanciesList: list } = await service.getDashboardMetrics({});
  const motive = sku => list.find(row => row.sku === sku).justificacion;
  assert.equal(motive('ONLY-SECOND'), 'Texto de la segunda');
  assert.equal(motive('ONLY-FIRST'), 'Texto de la primera');
  assert.equal(motive('BOTH'), 'Segunda');
  assert.equal(motive('FIRST-IS-NEWER'), 'Reabierta');
  assert.equal(motive('BLANK-SECOND'), 'Primera válida');
  assert.equal(motive('ONLY-REASON'), 'balanceo');
  assert.equal(motive('NOTHING'), '');
});

test('the second justification headers of a closed sheet reach the report fields', () => {
  const { normalizeItem } = require('../src/services/inventorySheetModel');
  const item = normalizeItem({ SKU: 'VO_85022358', Almacen: 'RVO0', Ubicacion: '2A05043A00', Stock_Sistema: '2', Costo_Unitario: '5', 'STOCK TOTAL': '1', 'stock B/E': '1', 'stock M/E': '0', 'RazónJUSTIFICACION 2': 'otro', 'Comentario JustificaciON 2': 'Texto real', 'FECHA JUSTIFICACION 2': '31/10/2026 9:34:53' });
  assert.equal(item.Comentario_Justificacion_2, 'Texto real');
  assert.equal(item.Razon_Justificacion_2, 'otro');
  assert.equal(item.Fecha_Justificacion_2, '31/10/2026 9:34:53');
});
