const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboardCode = fs.readFileSync(path.join(__dirname, '../public/js/views/dashboardView.js'), 'utf8');
const reportCode = fs.readFileSync(path.join(__dirname, '../public/js/components/metricsReportModal.js'), 'utf8');

function fixture() {
  const warnings = [], reports = [], elements = new Map();
  const context = vm.createContext({
    console, setTimeout: () => {},
    document: {
      getElementById: id => elements.get(id) || null,
      querySelectorAll: () => []
    },
    window: {
      Toast: { warning: message => warnings.push(message), danger: () => {}, success: () => {} },
      MetricsReportModal: { openReportWithData: (...args) => reports.push(args) }
    }
  });
  vm.runInContext(dashboardCode, context);
  return { context, view: context.window.DashboardView, warnings, reports, elements };
}

function metrics() {
  return {
    summary: { totalItemsAudited: 12, totalLocationsEvaluated: 10, exactMatchingLocations: 9, eruPercent: 90 },
    filters: { center: 'TODOS', type: 'BARRIDO', period: 'PERSONALIZADO', startDate: '2026-10-01', endDate: '2026-10-08' },
    metricsComplete: true, metricsValid: true,
    discrepanciesList: [{ sku: 'SKU-1', diferenciaFinal: -2 }]
  };
}

test('dashboard prints a frozen snapshot of current consolidated metrics without fetching', () => {
  const f = fixture();
  f.context.window.API = new Proxy({}, { get() { throw new Error('Printing must not request data'); } });
  f.view.currentData = metrics();
  f.view.printReport();
  assert.equal(f.reports.length, 1);
  const [inventory, snapshot] = f.reports[0];
  assert.equal(inventory.center, 'TODOS');
  assert.equal(inventory.type, 'BARRIDO');
  assert.equal(snapshot.filters.startDate, '2026-10-01');
  f.view.currentData.summary.totalItemsAudited = 99;
  f.view.currentData.discrepanciesList[0].sku = 'CHANGED';
  assert.equal(snapshot.summary.totalItemsAudited, 12);
  assert.equal(snapshot.discrepanciesList[0].sku, 'SKU-1');
});

test('individual inventory identity and current metrics are preserved', () => {
  const f = fixture();
  f.view.currentData = metrics();
  f.view.currentData.selectedInventory = { id: 'INV-123', name: 'October', center: '1120', type: 'CICLICO' };
  f.view.printReport();
  assert.equal(f.reports[0][0].id, 'INV-123');
  assert.equal(f.reports[0][1].summary.totalItemsAudited, 12);
});

test('missing, loading, failed, incomplete and invalid metrics do not open a report', () => {
  for (const state of [
    { currentData: null },
    { currentData: metrics(), isLoadingMetrics: true },
    { currentData: metrics(), metricsLoadFailed: true },
    { currentData: { ...metrics(), metricsComplete: false } },
    { currentData: { ...metrics(), metricsValid: false } }
  ]) {
    const f = fixture();
    Object.assign(f.view, state);
    f.view.printReport();
    assert.equal(f.reports.length, 0);
    assert.equal(f.warnings.length, 1);
  }
});

test('empty but valid metrics can print and missing report module is handled', () => {
  const f = fixture();
  f.view.currentData = { summary: { totalItemsAudited: 0 }, metricsComplete: true };
  f.view.printReport();
  assert.equal(f.reports.length, 1);
  f.context.window.MetricsReportModal = undefined;
  assert.doesNotThrow(() => f.view.printReport());
  assert.equal(f.warnings.length, 1);
});

test('each dashboard button opens the report once, even after listener setup repeats', () => {
  const f = fixture();
  for (const id of ['btn-dash-print-report', 'btn-dash-banner-print-report']) {
    f.elements.set(id, {});
  }
  f.view.setupListeners();
  f.view.setupListeners();
  const handlers = [...f.elements.values()].map(button => button.onclick);
  vm.runInContext(reportCode, f.context);
  f.context.window.MetricsReportModal.setupListeners();
  assert.deepEqual([...f.elements.values()].map(button => button.onclick), handlers);
  f.view.printReport = () => f.reports.push('opened');
  let prevented = 0;
  for (const button of f.elements.values()) button.onclick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
  assert.equal(f.reports.length, 2);
});

test('a superseded request cannot allow printing while the latest metrics are loading', async () => {
  const f = fixture();
  const pending = [];
  f.context.window.API = {
    getDashboardMetrics: () => new Promise(resolve => pending.push(resolve)),
    getAuditLogs: async () => ({ logs: [] })
  };
  for (const name of ['updateInventoryDropdown', 'renderContextBanner', 'renderKPIs', 'renderCharts',
    'renderWorkersRanking', 'renderMultiLocations', 'renderDiscrepancies', 'renderAuditLogs', 'renderSourceValidation']) {
    f.view[name] = () => {};
  }
  f.view.currentData = metrics();
  const older = f.view.loadDashboard();
  const latest = f.view.loadDashboard();
  pending[0](metrics());
  await older;
  assert.equal(f.view.isLoadingMetrics, true);
  f.view.printReport();
  assert.equal(f.reports.length, 0);
  pending[1](metrics());
  await latest;
  assert.equal(f.view.isLoadingMetrics, false);
  f.view.printReport();
  assert.equal(f.reports.length, 1);
});

test('a failed refresh blocks the old snapshot until a successful reload', async () => {
  const f = fixture();
  f.view.currentData = metrics();
  f.context.window.API = {
    getDashboardMetrics: async () => { throw new Error('offline'); },
    getAuditLogs: async () => ({ logs: [] })
  };
  await f.view.loadDashboard();
  assert.equal(f.view.isLoadingMetrics, false);
  assert.equal(f.view.metricsLoadFailed, true);
  f.view.printReport();
  assert.equal(f.reports.length, 0);
});

test('printable report includes escaped filter context, ERU and discrepancy data', () => {
  const f = fixture(), area = { innerHTML: '' };
  f.elements.set('report-printable-area', area);
  vm.runInContext(reportCode, f.context);
  const data = metrics();
  data.filters.center = '<script>alert(1)</script>';
  f.context.window.MetricsReportModal.buildReportDOM({ name: 'Consolidado' }, data);
  assert.match(area.innerHTML, /2026-10-01/);
  assert.match(area.innerHTML, /2026-10-08/);
  assert.match(area.innerHTML, /BARRIDO/);
  assert.match(area.innerHTML, /90\.00%/);
  assert.match(area.innerHTML, /SKU-1/);
  assert.match(area.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(area.innerHTML, /<script>/);
});
