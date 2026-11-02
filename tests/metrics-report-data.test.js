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
