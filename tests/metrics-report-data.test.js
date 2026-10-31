const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('report exposes damage identified only in a recount and preserves the initial/final quantities', async () => {
  const module = { exports: {} };
  const mocks = {
    './metricsSourceService':{invalidate(){}},
    './inventoryContract':require('../src/services/inventoryContract'),
    './counterReliability':require('../src/services/counterReliability'),
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
