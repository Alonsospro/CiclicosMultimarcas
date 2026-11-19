const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../src/services/reportCenterService');

const root = path.join(__dirname, '..');
const config = {
  getCenterCode: code => code, findCenter: code => ({ code, name: `Centro ${code}` }), isSameCenter: (a, b) => a === b,
  centersList: [{ code: '1160', name: 'Centro 1160' }, { code: '1120', name: 'Centro 1120' }]
};

function metricsService(inventories) {
  const module = { exports: {} };
  const mocks = {
    './metricsSourceService': { invalidate() {}, matchesId: (record, id) => record.id === id },
    './inventoryContract': require('../src/services/inventoryContract'),
    './counterReliability': require('../src/services/counterReliability'),
    './reportBreakdown': require('../src/services/reportBreakdown'),
    './storagePath': { getInventoriesDirectory: () => '/inventories', getHistoryDirectory: () => '/history', getUsersFilePath: () => '/users', readJson: () => [] },
    '../config': config,
    './auditService': { getAuditLogs: () => [] }, './gasService': {}, './snapshotService': {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/services/metricsService.js'), 'utf8'), {
    module, exports: module.exports, console, Date, Intl,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  });
  const service = module.exports;
  service.getAllInventoriesData = async () => JSON.parse(JSON.stringify(inventories));
  // Crossing the vm boundary as JSON, the same way the route receives plain objects.
  return { getDashboardMetrics: async params => JSON.parse(JSON.stringify(await service.getDashboardMetrics(params))) };
}

function memoryStorage() {
  const files = new Map();
  return {
    files,
    getDataDirectory: () => '/data',
    readJson: (file, fallback) => files.has(file) ? JSON.parse(JSON.stringify(files.get(file))) : fallback,
    writeJson: (file, value) => { files.set(file, JSON.parse(JSON.stringify(value))); return true; }
  };
}

const line = (sku, overrides = {}) => ({
  SKU: sku, Descripcion: `Producto ${sku}`, Almacen: 'RFO7', Ubicacion: 'A010101001', Clasificacion_ABC: 'A', Responsable: 'ana',
  Fecha_Ultimo_Conteo: '2026-10-05T14:00:00.000Z', Stock_Sistema: 10, Stock_Fisico: 10, Stock_Total: 10, Mal_estado: 0, Diferencia: 0, Costo_Unitario: 100, ...overrides
});
const short = (sku, physical, extra = {}) => line(sku, { Stock_Fisico: physical, Stock_Total: physical, Diferencia: physical - 10, ...extra });
const inventory = (id, center, date, items, extra = {}) => ({ id, name: id, isHistory: true, status: 'REVISADO', center, type: 'CICLICO', createdAt: date, closedAt: date, items, ...extra });

const DATA = [
  inventory('INV-1160-41', '1160', '2026-10-06T15:00:00.000Z', [line('A1'), short('B1', 8), line('C1')]),
  inventory('INV-1120-41', '1120', '2026-10-07T15:00:00.000Z', [line('A2'), line('B2')]),
  inventory('INV-1160-42', '1160', '2026-10-13T15:00:00.000Z', [line('A1'), short('B1', 9, { Comentario_Justificacion: 'Despacho no registrado', Fecha_Primera_Justificacion: '13/10/2026 10:00' }), line('D1')]),
  inventory('INV-1120-42', '1120', '2026-10-14T15:00:00.000Z', [line('A2'), line('B2'), short('E2', 11)]),
  inventory('INV-1160-45', '1160', '2026-11-03T15:00:00.000Z', [line('A1'), line('B1')]),
  inventory('INV-1160-47', '1160', '2026-11-17T15:00:00.000Z', [line('A1')], { isHistory: false, status: 'EN_PROCESO' })
];

const service = () => {
  const storage = memoryStorage();
  return { storage, reports: create({ metrics: metricsService(DATA), storage, config }) };
};

test('the catalog lists every report period with its generation status', async () => {
  const { reports } = service();
  const catalog = await reports.catalog({});
  assert.deepEqual(catalog.SEMANAL.map(item => item.ref), ['47', '45', '42', '41']);
  assert.equal(catalog.SEMANAL.find(item => item.ref === '47').status, 'EN_CURSO', 'a week with an open inventory is still in progress');
  assert.equal(catalog.SEMANAL.find(item => item.ref === '42').status, 'PENDIENTE');
  assert.deepEqual(catalog.MENSUAL.map(item => item.ref), ['2026-11', '2026-10']);
  assert.deepEqual(catalog.ANUAL.map(item => item.ref), ['2026']);
  assert.equal(catalog.INDIVIDUAL.length, 5, 'only closed inventories have an individual report');

  reports.record({ kind: 'SEMANAL', ref: '42', label: 'Semana 42', kpis: { eriUnits: 90 } }, { username: 'alonso' });
  reports.record({ kind: 'SEMANAL', ref: '42', label: 'Semana 42', kpis: { eriUnits: 91 } }, { username: 'alonso' });
  const after = await reports.catalog({});
  const week = after.SEMANAL.find(item => item.ref === '42');
  assert.equal(week.status, 'GENERADO');
  assert.equal(week.last.generations, 2);
  assert.equal(week.last.kpis.eriUnits, 91);
  assert.equal(reports.history({}).length, 1, 'regenerating replaces the entry instead of duplicating it');
  assert.equal((await reports.catalog({ center: '1120' })).SEMANAL.find(item => item.ref === '42').status, 'PENDIENTE', 'the log is kept per center');
});

test('the weekly report measures only the week, without comparing it with another one', async () => {
  const { reports } = service();
  const report = await reports.build({ kind: 'SEMANAL', ref: '42', user: { displayName: 'Alonso' } });
  assert.equal(report.label, 'Semana 42');
  assert.equal(report.kpis.inventories, 2);
  assert.equal(report.kpis.linesAudited, 6);
  assert.equal(report.kpis.discrepancies, 2);
  assert.equal(report.kpis.shortageCost, 100);
  assert.equal(report.kpis.surplusCost, 100);
  assert.equal(report.previous, undefined, 'no other week is read');
  assert.deepEqual(report.centers.map(center => center.center).sort(), ['1120', '1160']);
  assert.deepEqual(report.causes.byType.map(row => row.type).sort(), ['FALTANTE', 'SOBRANTE']);
  assert.equal(report.causes.justifiedShare, 50);
  assert.ok(report.causes.reasons.some(row => row.reason === 'DESPACHO NO REGISTRADO'));
  assert.equal(report.topDifferences.length, 2);
  assert.equal(report.generatedBy, 'Alonso');
  assert.ok(report.metrics.reportData, 'carries the metrics for the center detail sheets');
});

test('monthly and annual reports cover their own period and find recurring differences', async () => {
  const { reports } = service();
  const month = await reports.build({ kind: 'MENSUAL', ref: '2026-10' });
  assert.equal(month.label, 'Octubre 2026');
  assert.equal(month.series, undefined);
  assert.ok(month.metrics.monthTimeline, 'the month carries the data of the Métricas monthly report');
  assert.deepEqual(month.recurrent.map(row => [row.sku, row.times]), [['B1', 2]]);

  const year = await reports.build({ kind: 'ANUAL', ref: '2026' });
  assert.equal(year.series, undefined);
  assert.equal(year.kpis.inventories, 5, 'the open inventory stays out of the consolidated year');
});

test('the individual report covers one inventory', async () => {
  const { reports } = service();
  const report = await reports.build({ kind: 'INDIVIDUAL', ref: 'INV-1160-42' });
  assert.equal(report.selectedInventory.id, 'INV-1160-42');
  assert.equal(report.kpis.inventories, 1);
  await assert.rejects(reports.build({ kind: 'MENSUAL', ref: '2026-13x' }), /Mes inválido/);
  await assert.rejects(reports.build({ kind: 'MENSUAL', ref: '2025-01' }), /No hay inventarios/);
});

const documents = () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/components/managementReport.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/components/reportCenterDocument.js'), 'utf8'), context);
  return { doc: context.window.ReportCenterDocument, metrics: context.window.ManagementReport };
};

test('each report uses the Métricas model: the dashboard report, or the monthly report for a month', async () => {
  const { reports } = service();
  const { doc, metrics } = documents();
  const week = JSON.parse(JSON.stringify(await reports.build({ kind: 'SEMANAL', ref: '42' })));
  assert.equal(doc.render(week), metrics.render(week.selectedInventory || { id: 'SEMANAL-42', name: week.label, center: 'TODOS', type: 'TODOS' }, week.metrics));
  const one = JSON.parse(JSON.stringify(await reports.build({ kind: 'INDIVIDUAL', ref: 'INV-1160-42' })));
  assert.equal(doc.render(one), metrics.render(one.selectedInventory, one.metrics));
  const month = JSON.parse(JSON.stringify(await reports.build({ kind: 'MENSUAL', ref: '2026-10' })));
  const html = doc.render(month);
  assert.equal(html, metrics.renderMonthly({ month: '2026-10', type: 'TODOS', center: 'TODOS', current: month.metrics }));
  assert.match(html, /Informe mensual · Octubre 2026/);
  for (const page of [doc.render(week), html]) {
    assert.doesNotMatch(page, /rc-sheet|Comparado con|Variación/, 'no own comparison sheets');
    assert.doesNotMatch(page, /[Nn]eto|NETO|Impacto absoluto/);
  }
});

test('the Excel twin has the period figures, with shortages and surpluses apart', async () => {
  const { reports } = service();
  const { doc } = documents();
  const book = doc.workbook(JSON.parse(JSON.stringify(await reports.build({ kind: 'SEMANAL', ref: '42' }))));
  assert.deepEqual([...Object.keys(book)], ['Resumen', 'Centros', 'ABC', 'Tipos_diferencia', 'Motivos', 'Top_diferencias', 'Recurrentes', 'Auxiliares', 'Duraciones']);
  assert.equal(book.Resumen.find(row => row.Indicador === 'Faltante valorizado').Valor, 100);
  assert.equal(book.Resumen.find(row => row.Indicador === 'Sobrante valorizado').Valor, 100);
  const labels = JSON.stringify(book);
  assert.doesNotMatch(labels, /[Nn]eto|Impacto abs|Anterior|Variación/);
});
