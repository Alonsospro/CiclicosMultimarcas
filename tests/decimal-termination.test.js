const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeTermination } = require('../src/services/inventoryTermination');
const metricsSourceService = require('../src/services/metricsSourceService');
const metricsService = require('../src/services/metricsService');

const root = path.join(__dirname, '..');
const browser = file => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return context.window;
};
const plain = value => JSON.parse(JSON.stringify(value));

test('a termination has one written form per number', () => {
  assert.equal(normalizeTermination(null), null);
  assert.equal(normalizeTermination(''), null);
  assert.equal(normalizeTermination('4'), '4');
  assert.equal(normalizeTermination(4.5), '4.5');
  assert.equal(normalizeTermination('4.50'), '4.5');
  assert.equal(normalizeTermination('4,7'), '4.7');
  assert.equal(normalizeTermination('04'), '4');
  for (const bad of ['0', '0.5', '10000', '4.555', '4.', '.5', '-4', 'abc', '1e2', '4 5'])
    assert.throws(() => normalizeTermination(bad), /terminación/, bad);
});

test('the identifier of a decimal ending is read from ids, final files and names', () => {
  const read = metricsSourceService.getInventoryIdentifier;
  assert.equal(read('INV-CICLICO-1120-4.5'), '4.5');
  assert.equal(read({ id: 'INV-CICLICO-1120-4.5.json' }), '4.5');
  assert.equal(read({ name: 'INV-CICLICO-1120-4.5_FINAL_20261120.xlsx' }), '4.5');
  assert.equal(read('REC-INV-SEMANAL-1300-12.25'), '12.25');
  assert.equal(read('INV-CICLICO-1120-7'), '7');
  const dashboard = browser('public/js/views/dashboardView.js').DashboardView;
  assert.equal(dashboard.getInventoryIdentifier('INV-CICLICO-1120-4.5'), '4.5');
  assert.equal(dashboard.getInventoryWeekLabel('4.5'), 'Semana 4.5');
  assert.equal(dashboard.getInventoryWeekLabel('abc'), 'Sin numeración');
});

test('inventories ending in 4.5 sit between 4 and 5 in the monthly weeks', () => {
  const grouping = browser('public/js/inventoryGrouping.js').InventoryGrouping;
  const inv = (id, day) => ({ id, type: 'CICLICO', center: id.split('-')[2], status: 'EN_PROGRESO', createdAt: `2026-11-${day}T15:00:00.000Z` });
  // 10 would come before 4.5 as text; the number decides the week.
  const [month] = grouping.group([inv('INV-CICLICO-1120-10', '20'), inv('INV-CICLICO-1120-5', '18'), inv('INV-CICLICO-1120-4.5', '19'),
    inv('INV-CICLICO-1160-4.5', '19'), inv('INV-CICLICO-1120-4', '16')]);
  assert.deepEqual(plain(month.weeks.map(week => [week.label, week.types[0].termination, week.types[0].items.length])),
    [['Semana 4', '10', 1], ['Semana 3', '5', 1], ['Semana 2', '4.5', 2], ['Semana 1', '4', 1]]);
  const labels = grouping.monthWeekLabels([inv('INV-CICLICO-1120-4', '16'), inv('INV-CICLICO-1120-4.5', '19')], i => i.id.split('-').pop());
  assert.equal(labels.get('4.5'), 'Semana 2 (terminación 4.5)');
});

test('metrics group a decimal ending, filter it with GRUPO and order it numerically', async () => {
  const item = { SKU: 'S1', Stock_Sistema: 10, Stock_Fisico: 10, Stock_Total: 10, Diferencia: 0, Costo_Unitario: 1, Ubicacion: 'A', Almacen: 'R1' };
  const closed = (id, createdAt) => ({ id, isHistory: true, status: 'REVISADO', center: id.split('-')[2], type: 'CICLICO', items: [item], createdAt });
  const inventories = [closed('INV-CICLICO-1120-5', '2026-11-18T10:00:00.000Z'), closed('INV-CICLICO-1120-10', '2026-11-20T10:00:00.000Z'),
    closed('INV-CICLICO-1120-4.5', '2026-11-17T10:00:00.000Z'), closed('INV-CICLICO-1160-4.5', '2026-11-17T10:00:00.000Z'),
    closed('INV-CICLICO-1120-4', '2026-11-16T10:00:00.000Z')];
  const original = metricsService.getAllInventoriesData;
  metricsService.getAllInventoriesData = async () => inventories;
  try {
    const all = await metricsService.getDashboardMetrics({ inventoryId: 'TODOS', period: 'SEMANA_ESPECIFICA' });
    const order = all.inventoryGroups.map(group => group.suffix);
    assert.deepEqual([...order].sort((a, b) => Number(a) - Number(b)), ['4', '4.5', '5', '10']);
    const at = suffix => order.indexOf(suffix);
    assert.ok((at('4') < at('4.5') && at('4.5') < at('5') && at('5') < at('10'))
      || (at('4') > at('4.5') && at('4.5') > at('5') && at('5') > at('10')), 'numeric order: ' + order.join(','));
    const half = all.inventoryGroups.find(group => group.suffix === '4.5');
    assert.equal(half.label, 'Semana 4.5');
    assert.equal(half.count ?? half.inventories?.length ?? half.items?.length, 2);
    const selected = await metricsService.getDashboardMetrics({ inventoryId: 'GRUPO:4.5', period: 'SEMANA_ESPECIFICA' });
    assert.equal(selected.selectedInventory.groupId, '4.5');
    assert.deepEqual(plain(selected.selectedInventory.inventories.map(inv => inv.id)).sort(), ['INV-CICLICO-1120-4.5', 'INV-CICLICO-1160-4.5']);
    assert.equal(selected.summary.totalInventories, 2);
  } finally {
    metricsService.getAllInventoriesData = original;
  }
});

test('the previous closure of 5 is 4.5 even when 4.5 was closed later', () => {
  const closure = (number, date) => ({ type: 'CICLICO', number, date });
  const list = [closure('5', '2026-11-18'), closure('4', '2026-11-16'), closure('4.5', '2026-11-25'), closure('10', '2026-11-20')];
  assert.deepEqual(list.sort(metricsSourceService.closureOrder).map(item => item.number), ['4', '4.5', '5', '10']);
});
