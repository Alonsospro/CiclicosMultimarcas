const test = require('node:test');
const assert = require('node:assert/strict');
const metricsSourceService = require('../src/services/metricsSourceService');
const metricsService = require('../src/services/metricsService');

test('getInventoryIdentifier extracts trailing number suffix from various inventory codings', () => {
  const getIdentifier = metricsSourceService.getInventoryIdentifier;
  assert.equal(getIdentifier('INV-CICLICO-1340-1'), '1');
  assert.equal(getIdentifier('INV-CICLICO-1120-1'), '1');
  assert.equal(getIdentifier('INV-CICLICO-1300-2'), '2');
  assert.equal(getIdentifier('INV-CICLICO-1340-2'), '2');
  assert.equal(getIdentifier('INV-SEMANAL-1120-1'), '1');
  assert.equal(getIdentifier({ id: 'INV-CICLICO-1340-1.json' }), '1');
  assert.equal(getIdentifier({ name: 'INV-CICLICO-1340-1_FINAL_20261025.xlsx' }), '1');
});

test('getDashboardMetrics groups inventories sharing the same terminal identifier when selecting period or week', async () => {
  const item1 = { SKU: 'SKU-001', Stock_Sistema: 10, Stock_Fisico: 10, Stock_Total: 10, Diferencia: 0, Costo_Unitario: 10, Ubicacion: 'A1', Almacen: 'R1' };
  const item2 = { SKU: 'SKU-002', Stock_Sistema: 20, Stock_Fisico: 20, Stock_Total: 20, Diferencia: 0, Costo_Unitario: 5, Ubicacion: 'B1', Almacen: 'R1' };
  const item3 = { SKU: 'SKU-003', Stock_Sistema: 15, Stock_Fisico: 15, Stock_Total: 15, Diferencia: 0, Costo_Unitario: 8, Ubicacion: 'C1', Almacen: 'R1' };

  const testInventories = [
    { id: 'INV-CICLICO-1340-1', center: '1340', type: 'CICLICO', items: [item1], createdAt: '2026-10-20T10:00:00.000Z' },
    { id: 'INV-CICLICO-1120-1', center: '1120', type: 'CICLICO', items: [item2], createdAt: '2026-11-03T11:00:00.000Z' },
    { id: 'INV-CICLICO-1340-2', center: '1340', type: 'CICLICO', items: [item3], createdAt: '2026-10-21T10:00:00.000Z' }
  ];

  const origGetAll = metricsService.getAllInventoriesData;
  metricsService.getAllInventoriesData = async () => testInventories;

  try {
    // 1. Consolidated metrics for the period returns inventoryGroups grouped by suffix
    const allMetrics = await metricsService.getDashboardMetrics({
      inventoryId: 'TODOS',
      period: 'SEMANA_ESPECIFICA'
    });

    assert.ok(Array.isArray(allMetrics.inventoryGroups), 'inventoryGroups must be an array');
    assert.equal(allMetrics.inventoryGroups.length, 2, 'Should have 2 groups: Group 1 and Group 2');
    assert.ok(allMetrics.earliestInventoryDate, 'Must return earliestInventoryDate');

    const group1 = allMetrics.inventoryGroups.find(g => g.groupId === '1');
    const group2 = allMetrics.inventoryGroups.find(g => g.groupId === '2');

    assert.ok(group1, 'Group 1 (-1) must exist');
    assert.equal(group1.inventoryCount, 2, 'Group 1 has 2 inventories (1340-1 and 1120-1)');
    assert.deepEqual(group1.centers, ['1120', '1340']);
    assert.equal(group1.inventories[0].groupId, '1');
    assert.ok(group1.metrics, 'Group 1 must contain calculated metrics');
    assert.equal(group1.metrics.eriItemFinal, 100);
    assert.equal(group1.metrics.discrepanciasFinal, 0);

    assert.ok(group2, 'Group 2 (-2) must exist');
    assert.equal(group2.inventoryCount, 1, 'Group 2 has 1 inventory (1340-2)');
    assert.deepEqual(group2.centers, ['1340']);
    assert.equal(group2.inventories[0].groupId, '2');
    assert.ok(group2.metrics, 'Group 2 must contain calculated metrics');

    // 2. Querying metrics specifically for Group 1 (GRUPO:1)
    const group1Metrics = await metricsService.getDashboardMetrics({
      inventoryId: 'GRUPO:1',
      period: 'SEMANA_ESPECIFICA'
    });

    assert.equal(group1Metrics.summary.totalInventories, 2, 'Group 1 consolidated must evaluate only the 2 inventories ending in -1');
    assert.ok(group1Metrics.selectedInventory, 'Group 1 must return a selectedInventory object');
    assert.equal(group1Metrics.selectedInventory.isGroup, true);
    assert.equal(group1Metrics.selectedInventory.groupId, '1');
    assert.equal(group1Metrics.selectedInventory.inventoryCount, 2);

    // 3. Querying metrics specifically for Group 2 (GRUPO:2)
    const group2Metrics = await metricsService.getDashboardMetrics({
      inventoryId: 'GRUPO:2',
      period: 'SEMANA_ESPECIFICA'
    });

    assert.equal(group2Metrics.summary.totalInventories, 1, 'Group 2 consolidated must evaluate only inventory ending in -2');
    assert.equal(group2Metrics.selectedInventory.groupId, '2');

    // 4. Inventory numbering groups remain together across different recorded dates.
    const dateRangeGroup1 = await metricsService.getDashboardMetrics({
      inventoryId: 'GRUPO:1',
      period: 'SEMANA_ESPECIFICA',
      startDate: '2026-10-19',
      endDate: '2026-10-25'
    });
    assert.equal(dateRangeGroup1.summary.totalInventories, 2, 'Both inventories with suffix -1 stay together despite different recorded dates');
    assert.ok(dateRangeGroup1.availableInventories.some(inv => inv.id === 'INV-CICLICO-1120-1' && inv.createdAt.startsWith('2026-11-03')),
      'Recorded inventory date remains available as metadata');
  } finally {
    metricsService.getAllInventoriesData = origGetAll;
  }
});
