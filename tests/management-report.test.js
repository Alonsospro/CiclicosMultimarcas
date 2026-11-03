const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'public/js/components/managementReport.js'), 'utf8'), context);
const report = context.window.ManagementReport;

function metricsService(users = []) {
  const module = { exports: {} };
  const mocks = {
    './metricsSourceService': { invalidate() {} },
    './inventoryContract': require('../src/services/inventoryContract'),
    './counterReliability': require('../src/services/counterReliability'),
    './reportBreakdown': require('../src/services/reportBreakdown'),
    './storagePath': { getInventoriesDirectory: () => '/inventories', getHistoryDirectory: () => '/history', getUsersFilePath: () => '/users', readJson: () => users },
    '../config': {
      getCenterCode: code => code, findCenter: code => ({ code, name: `Centro ${code}` }), isSameCenter: (a, b) => a === b,
      centersList: [{ code: '1160', name: 'Centro 1160' }, { code: '1120', name: 'Centro 1120' }, { code: '5100', name: 'Centro 5100' }]
    },
    './auditService': { getAuditLogs: () => [] }, './gasService': {}, './snapshotService': {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/services/metricsService.js'), 'utf8'), {
    module, exports: module.exports, console, Date,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  });
  return module.exports;
}

const VALID = ['A010101001', 'A010101002', 'A010101003', 'A010101004'];
const line = (sku, overrides = {}) => ({
  SKU: sku, Descripcion: `Producto ${sku}`, Almacen: 'RFO7', Ubicacion: VALID[0], Clasificacion_ABC: 'A',
  Stock_Sistema: 10, Stock_Fisico: 10, Stock_Total: 10, Mal_estado: 0, Diferencia: 0, Costo_Unitario: 100, ...overrides
});
const inventory = (id, center, items, closed = '2026-10-15') => ({ id, name: id, isHistory: true, status: 'REVISADO', center, type: 'CICLICO', createdAt: closed, closedAt: closed, items });

async function load(inventories, filters = {}, users = []) {
  const service = metricsService(users);
  service.getAllInventoriesData = async () => inventories;
  // Crossing the vm boundary as JSON, the same way the browser receives the metrics.
  return JSON.parse(JSON.stringify(await service.getDashboardMetrics(filters)));
}

const mixedCenter = () => inventory('INV-1160-1', '1160', [
  line('EXACT'),
  line('SHORT', { Stock_Fisico: 7, Stock_Total: 7, Diferencia: -3, Almacen: 'RFO8', Clasificacion_ABC: 'B' }),
  line('OVER', { Stock_Fisico: 12, Stock_Total: 12, Diferencia: 2, Clasificacion_ABC: 'C', Ubicacion: 'CORTA' }),
  line('MULTI', { Ubicacion_1: VALID[1] }),
  line('NOLOC', { Ubicacion: '' }),
  line('ADDONLY', { Ubicacion: '', Ubicacion_1: VALID[2] }),
  line('BROKEN', { Mal_estado: 1, Stock_Fisico: 9, Stock_Total: 10, Costo_Unitario: 50 })
]);

test('the NIBOL compliance scale applies its exact limits', () => {
  const key = value => report.level(value).key;
  assert.equal(key(100), 'perfect');
  assert.equal(key(99.99), 'ok');
  assert.equal(key(98), 'ok');
  assert.equal(key(97.99), 'min');
  assert.equal(key(95), 'min');
  assert.equal(key(94.99), 'no');
  assert.equal(key(0), 'no');
  assert.equal(key(null), 'nil');
  assert.equal(report.level(100).label, 'Perfecto cumplimiento');
  assert.equal(report.level(98).label, 'Cumplimiento');
  assert.equal(report.level(95).label, 'Mínimo de cumplimiento');
  assert.equal(report.level(94).label, 'No cumple');
});

test('a result is the lowest of its indicators and never comes from missing data', () => {
  assert.equal(report.worst([100, 98.5, 94.9]).key, 'no');
  assert.equal(report.worst([100, 98.5, 96]).key, 'min');
  assert.equal(report.worst([100, 100, 100]).key, 'perfect');
  assert.equal(report.worst([100, null, 100]).key, 'nil');
});

test('dashboard and service use the same scale, with no leftover levels', async () => {
  const closures = [100, 99, 98, 97, 94].map((value, index) => inventory(`INV-${index}`, '1160', [
    line(`S${index}`, { Stock_Sistema: 100, Stock_Fisico: value, Stock_Total: value, Diferencia: value - 100 })
  ], `2026-10-0${index + 1}`));
  const { historicalEriTrend: trend } = await load(closures);
  assert.deepEqual(trend.series.map(point => point.evaluation.tier), ['PERFECTO', 'CUMPLIMIENTO', 'CUMPLIMIENTO', 'MINIMO', 'NO_CUMPLE']);
  assert.equal(trend.series[3].evaluation.meetsTarget, true);
  assert.equal(trend.series[4].evaluation.meetsTarget, false);
  for (const file of ['src/services/metricsService.js', 'public/js/views/dashboardView.js', 'public/index.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /OBSERVACI|Observación \(|MINIMO_ACEPTABLE|Mínimo Aceptable|Excelente \(|EXCELENTE \(|Mal \(<90|<90% Mal/);
  }
});

test('quantities by warehouse and class add up to the official totals', async () => {
  const metrics = await load([mixedCenter()]);
  const [center] = metrics.reportData.centers;
  const s = metrics.summary;
  for (const groups of [center.byWarehouse, center.byClass]) {
    const total = key => groups.reduce((sum, group) => sum + key(group), 0);
    assert.equal(total(g => g.units), s.totalAuditedSystemUnits);
    assert.equal(total(g => g.unitsExact), s.itemsCuadradosFinalUnits);
    assert.equal(total(g => g.unitsExact1), s.itemsCuadrados1erUnits);
    assert.equal(total(g => g.skus), s.totalSkusAudited);
    assert.equal(total(g => g.skusExact), s.totalSkusExactFinal);
    assert.equal(total(g => g.shortage.cost), s.faltantesFinal.cost);
    assert.equal(total(g => g.surplus.cost), s.sobrantesFinal.cost);
    assert.equal(total(g => g.shortage.units), s.faltantesFinal.units);
    assert.equal(total(g => g.surplus.units), s.sobrantesFinal.units);
  }
  assert.equal(center.value, s.totalAuditedSystemValue);
  const i = report.indicators(center);
  assert.ok(Math.abs(i.money - s.eriMonetarioFinal) < 0.01);
  assert.ok(Math.abs(i.units - s.eriItemFinal) < 0.01);
  assert.ok(Math.abs(i.codes - s.eriSkuFinal) < 0.01);
  const cells = center.crossWarehouse.flatMap(row => Object.values(row.cells));
  assert.equal(cells.reduce((sum, cell) => sum + cell.shortage, 0), s.faltantesFinal.cost);
  assert.equal(cells.reduce((sum, cell) => sum + cell.surplus, 0), s.sobrantesFinal.cost);
});

test('each code losing its location score lands in exactly one cause', async () => {
  const metrics = await load([mixedCenter()]);
  const [center] = metrics.reportData.centers;
  const { eru, issues } = center;
  assert.equal(eru.evaluated, metrics.summary.totalSkusEvaluatedForEru);
  assert.equal(eru.exact, metrics.summary.exactSkusForEru);
  const causeOf = sku => issues.find(issue => issue.sku === sku)?.cause;
  assert.equal(causeOf('EXACT'), undefined);
  assert.equal(causeOf('MULTI'), 'multiple');
  assert.equal(causeOf('OVER'), 'format');
  assert.equal(causeOf('NOLOC'), 'none');
  assert.equal(causeOf('ADDONLY'), 'additional');
  assert.equal(Object.values(eru.causes).reduce((a, b) => a + b, 0), eru.evaluated - eru.exact);
  assert.equal(issues.length, eru.evaluated - eru.exact);
  assert.deepEqual(issues.find(issue => issue.sku === 'MULTI').others, [VALID[1]]);
});

test('center first-count value uses first-count costs, not the final ones', async () => {
  const fixedInRecount = line('FIXED', { Stock_Sistema: 10, Stock_Fisico: 5, Stock_Total: 5, Diferencia: -5, Stock_Total_Reconteo: 10, Reconteo_Fisico: 10, Diferencia_Final: 0, Fecha_Reconteo: '2026-10-15' });
  const metrics = await load([inventory('INV-1160-1', '1160', [line('OK'), fixedInRecount])]);
  const stats = metrics.centerStats[0];
  assert.equal(stats.eriMonetarioFinal, 100);
  assert.equal(stats.eriMonetarioInicial, 75);
});

test('center report shows quantities and keeps shortages and surpluses apart, with no net', async () => {
  const metrics = await load([mixedCenter()], {}, [{ username: 'jefe', displayName: 'Encargado Real', role: 'ENCARGADO', center: '1160' }]);
  assert.equal(report.kind(metrics), 'centro');
  const html = report.render({ id: 'INV-1160-1', name: 'INV-1160-1' }, metrics);
  assert.match(html, /de 70 unidades/);
  assert.match(html, /de 7 códigos/);
  assert.doesNotMatch(html, /[Nn]eto\b|NETO/);
  assert.doesNotMatch(html, /Impacto total/i);
  for (const text of ['Faltantes · del primer conteo al cierre', 'Sobrantes · del primer conteo al cierre', 'Averías · se informan aparte', 'Ubicación (ERU) y causas de la baja', 'En varias ubicaciones', 'Ubicación con formato no válido', 'Sin ubicación principal', 'Solo en ubicación adicional', 'Anexo A · Faltantes', 'Anexo B · Sobrantes', 'Anexo C · Averías', 'Anexo D · Códigos en varias ubicaciones', 'Anexo E · Códigos con baja de ubicación', 'Anexo F · Cálculo y responsables', 'Plan de acción', 'Encargado Real']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(html.includes('NO CUMPLE'));
  assert.doesNotMatch(html, /Consolidado nacional/);
  assert.doesNotMatch(html, /Recontar|Para decidir/);
});

test('a surplus does not offset a shortage in the value indicator', async () => {
  const metrics = await load([inventory('INV-1160-1', '1160', [
    line('S', { Stock_Fisico: 5, Stock_Total: 5, Diferencia: -5 }),
    line('P', { Stock_Fisico: 15, Stock_Total: 15, Diferencia: 5 })
  ])]);
  assert.equal(report.indicators(metrics.reportData.centers[0]).money, 50);
});

test('source text is escaped and values just below a limit do not print as reaching it', async () => {
  const items = Array.from({ length: 2000 }, (_, index) => line(`S${index}`));
  items.push(line('<script>bad</script>', { Stock_Fisico: 9, Stock_Total: 9, Diferencia: -1, Descripcion: '<img src=x>' }));
  const metrics = await load([inventory('INV-1160-1', '1160', items)]);
  const html = report.render({ id: 'INV', name: '<b>x</b>' }, metrics);
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!html.includes('<script>bad'));
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('99,95%'), 'units are truncated, not rounded up to 100%');
  assert.equal(report.level(report.indicators(metrics.reportData.centers[0]).units).key, 'ok');
});

test('every differing line stays in the annexes, however long the list is', async () => {
  const items = Array.from({ length: 300 }, (_, index) => line(`SKU-${index}-END`, { Stock_Fisico: 9, Stock_Total: 9, Diferencia: -1 }));
  const metrics = await load([inventory('INV-1160-1', '1160', items)]);
  const annex = report.render({ id: 'INV' }, metrics).split('<b>Anexo A · Faltantes</b>')[1].split('<b>Anexo B')[0];
  items.forEach(item => assert.ok(annex.includes(`>${item.SKU}</td>`), item.SKU));
});

test('consolidated report is its own document, compares centers and lists those without closure', async () => {
  const metrics = await load([mixedCenter(), inventory('INV-1120-1', '1120', [line('OK-1')])]);
  assert.equal(report.kind(metrics), 'consolidado');
  assert.deepEqual(metrics.reportData.pendingCenters.map(center => center.code), ['5100']);
  const html = report.render({ name: 'Corte' }, metrics);
  assert.match(html, /Consolidado nacional · 3 centros/);
  assert.match(html, /1 de 3/);
  assert.ok(html.includes('Sin cierre en este corte'));
  assert.ok(html.includes('5100 - Centro 5100'));
  assert.doesNotMatch(html, /[Nn]eto\b|NETO/);
  assert.doesNotMatch(html, /Anexo [A-F]/);
  for (const text of ['Comparación entre centros', 'Faltantes y sobrantes por centro', 'Ubicación (ERU) y causas de la baja', 'Cobertura del corte']) assert.ok(html.includes(text), text);
  assert.equal(metrics.reportData.centers.every(center => center.issues.length === 0), true);
  const totalUnits = metrics.reportData.centers.reduce((sum, center) => sum + center.units, 0);
  assert.equal(totalUnits, metrics.summary.totalAuditedSystemUnits);
});

const cellsOf = row => row.split('</tr>')[0].replace(/^[^>]*>/, '').replace(/<[^>]+>/g, '|').split('|').map(cell => cell.trim()).filter(Boolean);

test('the coverage sheet shows how each center started per system and how it closed, shortages and surpluses apart', async () => {
  const differ = (sku, change, extra = {}) => line(sku, { Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change, ...extra });
  const metrics = await load([
    inventory('INV-1160-1', '1160', [differ('A', -3), differ('B', 2), line('C')]),
    inventory('INV-1120-1', '1120', [differ('D', -1)])
  ]);
  const html = report.render({ name: 'Corte' }, metrics);
  const rowOf = (text, label) => cellsOf(text.split('<tr').find(row => row.includes(`${label}<`)));
  const coverage = html.slice(html.indexOf('Cobertura del corte'), html.indexOf('Del inicio según sistema al cierre'));
  const units = (label) => rowOf(coverage, label)[1];
  assert.match(units('Inicio según sistema'), /^40 unid\. · Bs 4\.000/);
  assert.match(units('Faltantes al cierre'), /^4 unid\. · Bs 400/);
  assert.match(units('Sobrantes al cierre'), /^2 unid\. · Bs 200/);
  assert.match(units('Cierre'), /^38 unid\. · Bs 3\.800/);
  const table = html.slice(html.indexOf('Del inicio según sistema al cierre'));
  assert.deepEqual(rowOf(table, 'Centro 1160').slice(1), ['3', '30', '3.000', '3', '300', '2', '200', '29', '2.900']);
  assert.deepEqual(rowOf(table, 'Centro 1120').slice(1), ['1', '10', '1.000', '1', '100', '0', '0', '9', '900']);
  assert.deepEqual(rowOf(table, 'Total'), ['Total', '4', '40', '4.000', '4', '400', '2', '200', '38', '3.800']);
  assert.doesNotMatch(html, /[Nn]eto\b|NETO/);
});

test('the center report shows how each warehouse started per system and how it closed', async () => {
  const differ = (sku, warehouse, change) => line(sku, { Almacen: warehouse, Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change });
  const html = report.render({ name: 'Corte' }, await load([
    inventory('INV-1160-1', '1160', [differ('A', 'RFO7', -3), differ('B', 'RFO7', 2), differ('C', 'RFO8', -1)])
  ]));
  const start = html.indexOf('Del inicio según sistema al cierre · por almacén');
  assert.ok(start > 0);
  const table = html.slice(start, html.indexOf('</table>', start));
  const row = label => cellsOf(table.split('<tr').find(text => text.includes(`>${label}<`)));
  assert.deepEqual(row('RFO7'), ['RFO7', '2', '20', '2.000', '3', '300', '2', '200', '19', '1.900']);
  assert.deepEqual(row('RFO8'), ['RFO8', '1', '10', '1.000', '1', '100', '0', '0', '9', '900']);
  assert.deepEqual(row('Total'), ['Total', '3', '30', '3.000', '4', '400', '2', '200', '28', '2.800']);
  assert.doesNotMatch(html, /[Nn]eto\b|NETO/);
});

const breakdown = require('../src/services/reportBreakdown');

test('inventory duration runs from the first entry to the last one, in hours, minutes and seconds', () => {
  const row = breakdown.inventoryDuration({ id: 'INV', name: 'Cíclico', center: '1160', items: [
    { Fecha_Ultimo_Conteo: '2026-10-20T12:00:00.000Z', Fecha_Primera_Justificacion: '2026-10-20T14:15:30.000Z' },
    { Fecha_Ultimo_Conteo: '2026-10-20T13:00:00.000Z', Fecha_Primera_Justificacion: '' }
  ] }, { centerName: 'Centro 1160' });
  assert.equal(row.seconds, 8130);
  assert.equal(row.timeLabel, '2 h 15 min 30 s');
  assert.equal(row.dayLabel, 'En un solo día');
  assert.equal(row.sameDay, true);
  assert.equal(row.startLabel, '20/10/2026 08:00:00');
  assert.equal(row.endLabel, '20/10/2026 10:15:30');
  assert.equal(row.lastEntry, '1ª justificación');
});

test('inventory duration counts calendar days in Bolivia, not periods of 24 hours or UTC days', () => {
  const span = (from, to) => breakdown.inventoryDuration({ id: 'I', items: [{ Fecha_Ultimo_Conteo: from, Fecha_Justificacion_2: to }] });
  const overnight = span('2026-10-21T02:00:00.000Z', '2026-10-21T03:30:00.000Z');
  assert.equal(overnight.dayLabel, 'En un solo día', 'Both are the evening of October 20 in La Paz, across a UTC midnight only');
  const twoDays = span('2026-10-21T03:30:00.000Z', '2026-10-21T04:30:00.000Z');
  assert.equal(twoDays.timeLabel, '1 h 0 min 0 s');
  assert.equal(twoDays.dayLabel, 'En 2 días', 'Crosses midnight in La Paz after only one hour');
  const long = span('2026-10-20T12:00:00.000Z', '2026-10-22T13:01:01.000Z');
  assert.equal(long.timeLabel, '49 h 1 min 1 s');
  assert.equal(long.dayLabel, 'En 3 días');
  assert.equal(long.lastEntry, '2ª justificación');
});

test('inventory duration covers recounts, reads Sheets local dates and never invents a time', () => {
  const recounted = breakdown.inventoryDuration({ id: 'I', items: [{ Fecha_Ultimo_Conteo: '20/10/2026 08:00:00', Fecha_Reconteo: '2026-10-20T13:00:00.000Z', Fecha_Reconteo_2: '20/10/2026 10:30' }] });
  assert.equal(recounted.timeLabel, '2 h 30 min 0 s');
  assert.equal(recounted.lastEntry, 'Reconteo 2');
  const one = breakdown.inventoryDuration({ id: 'I', items: [{ Fecha_Ultimo_Conteo: '2026-10-20T12:00:00.000Z' }] });
  assert.equal(one.timeLabel, '0 h 0 min 0 s');
  assert.equal(one.dayLabel, 'En un solo día');
  for (const value of ['', null, 'Contado', '20/10/2026', '2026-10-20']) {
    const missing = breakdown.inventoryDuration({ id: 'I', items: [{ Fecha_Ultimo_Conteo: value }] });
    assert.equal(missing.available, false, String(value));
    assert.equal(missing.timeLabel, 'No disponible');
    assert.equal(missing.dayLabel, 'No disponible');
  }
  const open = breakdown.inventoryDuration({ id: 'I', items: [{ Fecha_Ultimo_Conteo: '2026-10-20T12:00:00.000Z' }] }, { finished: false });
  assert.equal(open.dayLabel, 'Sin terminar · un solo día hasta ahora');
});

test('the dashboard and both PDF reports show the same duration', async () => {
  const dated = (sku, extra) => line(sku, { Fecha_Ultimo_Conteo: '2026-10-20T12:00:00.000Z', Fecha_Primera_Justificacion: '2026-10-21T13:00:05.000Z', ...extra });
  const single = await load([inventory('INV-1160-1', '1160', [dated('A')])]);
  const center = report.render({ name: 'Corte' }, single);
  assert.match(center, /Tiempo para terminar el inventario/);
  assert.match(center, /25 h 0 min 5 s/);
  assert.match(center, /En 2 días/);

  const both = await load([inventory('INV-1160-1', '1160', [dated('A')]),
    inventory('INV-1120-1', '1120', [line('B', { Fecha_Ultimo_Conteo: '2026-10-20T12:00:00.000Z', Fecha_Primera_Justificacion: '2026-10-20T12:30:00.000Z' })]),
    inventory('INV-5100-1', '5100', [line('C')])]);
  const consolidated = report.render({ name: 'Corte' }, both);
  const sheet = consolidated.slice(consolidated.indexOf('Tiempo para terminar cada inventario'));
  assert.match(sheet, /1 en un solo día · 1 en más de un día/);
  assert.match(sheet, /25 h 0 min 5 s/);
  assert.match(sheet, /0 h 30 min 0 s/);
  assert.match(sheet, /No disponible/);

  const card = { style: {}, innerHTML: '' };
  const context = vm.createContext({ console, setTimeout: () => {}, document: { getElementById: id => id === 'dash-duration-card' ? card : null, querySelectorAll: () => [], addEventListener() {} }, window: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/views/dashboardView.js'), 'utf8'), context);
  context.window.DashboardView.renderDuration(both);
  assert.equal(card.style.display, '');
  assert.match(card.innerHTML, /25 h 0 min 5 s/);
  assert.match(card.innerHTML, /En 2 días/);
  assert.match(card.innerHTML, /0 h 30 min 0 s/);
  assert.match(card.innerHTML, /En un solo día/);
  context.window.DashboardView.renderDuration({ reportData: { centers: [] } });
  assert.equal(card.style.display, 'none');
});

test('the state of all centers is one chart: lowest indicator at the close, marked with its first count', async () => {
  const differ = (sku, change, extra = {}) => line(sku, { Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change, ...extra });
  const metrics = await load([
    inventory('INV-1160-1', '1160', [line('A'), differ('B', -2, { Reconteo: 10, Stock_Total_Reconteo: 10, Diferencia_Final: 0 })]),
    inventory('INV-1120-1', '1120', [line('C'), differ('D', -5)])
  ]);
  const html = report.render({ name: 'Corte' }, metrics);
  assert.equal(html.includes('mr-tile'), false, 'The tiles are gone');
  const columns = html.split('<div class="mr-vcol"').slice(1);
  assert.equal(columns.length, 3, 'Two centers with a close and one without');
  const worst = columns[0], best = columns[1], pending = columns[2];
  assert.match(worst, /1120/);
  assert.match(worst, /mr-vbar lvl-no" style="height:50%/);
  assert.match(worst, /mr-vfirst" style="bottom:50%/);
  assert.match(worst, /Códigos: 1 de 2/);
  assert.match(best, /1160/);
  assert.match(best, /mr-vbar lvl-perfect" style="height:100%/);
  assert.match(best, /mr-vfirst" style="bottom:90%/, 'The recount took it from the first count to the close');
  assert.match(pending, /5100/);
  assert.match(pending, /Sin cierre en este corte/);
  assert.equal(pending.split('mr-legend')[0].includes('mr-vbar'), false);
  assert.match(html, /Marca: primer conteo/);
  assert.match(html, /Menos de 95%: no cumple/);
  assert.match(html, /grid-template-columns:repeat\(3,/);
});

test('each closure keeps its three indicators, by the same rules as the selected inventory', async () => {
  const differ = (sku, change, extra = {}) => line(sku, { Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change, ...extra });
  const metrics = await load([inventory('INV-1160-1', '1160', [line('A'), differ('B', -2), differ('C', 0, { Stock_Sistema: 3, Stock_Sistema_Original: 10, Estado: 'CUADRA', Stock_Fisico: 3, Stock_Total: 3 })])]);
  const [closure] = metrics.reportData.centers[0].history;
  const center = metrics.reportData.centers[0];
  assert.equal(closure.exactUnits, center.unitsExact);
  assert.equal(closure.totalUnits, center.units);
  assert.equal(closure.exactCodes, center.skusExact);
  assert.equal(closure.totalCodes, center.skus);
  assert.equal(closure.totalValue, center.value);
  assert.equal(closure.exactValue, center.value - center.shortage.cost - center.surplus.cost);
});

test('the chart compares each center with its earlier inventories of the same type', async () => {
  const differ = (sku, change, extra = {}) => line(sku, { Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change, ...extra });
  const closed = (id, center, items, date, type = 'CICLICO') => ({ ...inventory(id, center, items, date), type, createdAt: date });
  const service = metricsService();
  const inventories = [
    closed('INV-1160-1', '1160', [differ('A', -5), differ('B', 0)], '2026-08-15'),
    closed('INV-1160-2', '1160', [differ('A', -2), differ('B', 0), differ('C', 0), differ('D', 0)], '2026-09-15'),
    closed('SEM-1160-9', '1160', [differ('Z', -9)], '2026-09-20', 'SEMANAL'),
    closed('INV-1160-3', '1160', [line('A')], '2026-10-15'),
    closed('INV-1120-1', '1120', [line('A')], '2026-10-15')
  ];
  service.getAllInventoriesData = async () => inventories;
  const metrics = JSON.parse(JSON.stringify(await service.getDashboardMetrics({ startDate: '2026-10-01', endDate: '2026-10-31' })));
  const html = report.render({ name: 'Corte' }, metrics);
  const columns = html.split('<div class="mr-vcol"').slice(1);
  const center1160 = columns.find(column => column.includes('Centro 1160'));
  const earlier = [...center1160.matchAll(/mr-vbefore" style="height:([\d.]+)%/g)].map(match => Number(match[1]));
  assert.deepEqual(earlier, [50, 75], 'Lowest indicator of each earlier cyclic closure, oldest first and without the weekly one');
  assert.match(center1160, /mr-vbar lvl-perfect" style="height:100%/);
  assert.match(center1160, /Anterior: 75,00% · Códigos/);
  const center1120 = columns.find(column => column.includes('Centro 1120'));
  assert.equal(center1120.includes('mr-vbefore'), false);
  assert.match(center1120, /Sin anterior/);
});

test('a closure read before the three indicators existed still shows its units', () => {
  const center = { name: 'C', center: '1', units: 10, unitsExact: 10, skus: 1, skusExact: 1, skusExact1: 1, unitsExact1: 10, value: 10, lines: 1,
    shortage: { lines: 0, units: 0, cost: 0 }, surplus: { lines: 0, units: 0, cost: 0 }, damage: { lines: 0, units: 0, cost: 0 },
    firstCount: { shortage: { cost: 0 }, surplus: { cost: 0 } }, eru: { evaluated: 1, exact: 1, causes: { multiple: 0, format: 0, none: 0, additional: 0 } },
    byWarehouse: [], byClass: [], crossWarehouse: [], crossClass: [], flow: { firstDifferences: 0, resolved: 0, stillShort: 0, stillSurplus: 0, appeared: 0 }, inventories: ['NEW'], issues: [],
    history: [{ id: 'OLD', type: 'CICLICO', date: '2026-09-01', eri: 92, totalUnits: 100, exactUnits: 92 }, { id: 'NEW', type: 'CICLICO', date: '2026-10-01', eri: 100, totalUnits: 10, exactUnits: 10 }] };
  const html = report.render({ name: 'Corte' }, { reportData: { centers: [center, { ...center, center: '2', name: 'D', inventories: ['OTHER'], history: [] }], pendingCenters: [] }, discrepanciesList: [], summary: {}, filters: {} });
  assert.match(html, /mr-vbefore" style="height:92%/);
  assert.match(html, /Anterior: 92,00% · Unidades/);
});

test('a partly justified shortage closes with the units explained and only the remainder as shortage', async () => {
  const metrics = await load([
    inventory('INV-1160-1', '1160', [line('A', { Stock_Fisico: 3, Stock_Total: 3, Estado: 'NO CUADRA', Diferencia: -1 })]),
    inventory('INV-1120-1', '1120', [line('B')])
  ]);
  const table = report.render({ name: 'Corte' }, metrics);
  const row = table.slice(table.indexOf('Del inicio según sistema al cierre')).split('<tr').find(text => text.includes('Centro 1160<'));
  assert.deepEqual(cellsOf(row).slice(1), ['1', '10', '1.000', '1', '100', '0', '0', '9', '900']);
});

test('a single signature is centered and several keep their columns', async () => {
  const css = fs.readFileSync(path.join(root, 'public/css/management-report.css'), 'utf8');
  assert.match(css, /\.mr-signs-single \{[^}]*justify-content: center/);
  assert.match(css, /\.mr-signs-single \.mr-sign-role \{[^}]*text-align: center/);
  const consolidated = report.render({ name: 'Corte' }, await load([inventory('INV-1160-1', '1160', [line('A')]), inventory('INV-1120-1', '1120', [line('B')])]));
  assert.equal(consolidated.match(/class="mr-signs mr-signs-single"/g).length, 1);
  const center = report.render({ name: 'Corte' }, await load([inventory('INV-1160-1', '1160', [line('A')])]));
  assert.equal(center.includes('mr-signs-single'), false);
  assert.match(center, /class="mr-signs"/);
});

test('each center shows its own share of the shortages and of the surpluses, not a running total', async () => {
  const differ = (sku, cost, change) => line(sku, { Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change, Costo_Unitario: cost });
  const metrics = await load([
    inventory('INV-1160-1', '1160', [differ('A', 600, -1), differ('D', 1, 1)]),
    inventory('INV-1120-1', '1120', [differ('B', 400, -1), differ('E', 300, 1)]),
    inventory('INV-5100-1', '5100', [differ('C', 1, -1), differ('F', 700, 1)])
  ]);
  const html = report.render({ name: 'Corte' }, metrics);
  const shares = panel => [...panel.matchAll(/<td class="num">([^<]*%)<\/td><\/tr>/g)].map(match => match[1]);
  const shortages = html.slice(html.indexOf('Faltantes: '), html.indexOf('Sobrantes: '));
  const surpluses = html.slice(html.indexOf('Sobrantes: '), html.indexOf('Faltantes (Bs) por clase'));
  assert.deepEqual(shares(shortages), ['60%', '40%', '&lt;1%']);
  assert.deepEqual(shares(surpluses), ['70%', '30%', '&lt;1%']);
  assert.doesNotMatch(html, /Acum\./);
});

test('the ranking title only counts centers that have an amount', async () => {
  const differ = (sku, change) => line(sku, { Stock_Fisico: 10 + change, Stock_Total: 10 + change, Diferencia: change });
  const titleAndBold = (html, noun, next) => {
    const panel = html.slice(html.indexOf(`${noun}: `), html.indexOf(next));
    return [panel.slice(0, panel.indexOf('<')), panel.match(/class="mr-strong"/g)?.length ?? 0];
  };
  const two = report.render({ name: 'Corte' }, await load([
    inventory('INV-1160-1', '1160', [differ('A', 1), differ('C', -1)]),
    inventory('INV-1120-1', '1120', [differ('B', 1)]),
    inventory('INV-5100-1', '5100', [line('OK')])
  ]));
  assert.deepEqual(titleAndBold(two, 'Sobrantes', 'Faltantes (Bs) por clase'), ['Sobrantes: Bs 200,00 · 2 centros concentran 100%', 2]);
  assert.deepEqual(titleAndBold(two, 'Faltantes', 'Sobrantes: '), ['Faltantes: Bs 100,00 · 1 centro concentra 100%', 1]);
  const none = report.render({ name: 'Corte' }, await load([inventory('INV-1160-1', '1160', [line('OK')]), inventory('INV-1120-1', '1120', [line('OK-2')])]));
  assert.deepEqual(titleAndBold(none, 'Sobrantes', 'Faltantes (Bs) por clase'), ['Sobrantes: Bs 0,00', 0]);
});

test('the consolidated location sheet comes right after the damage sheet', async () => {
  const html = report.render({ name: 'Corte' }, await load([mixedCenter(), inventory('INV-1120-1', '1120', [line('OK-1')])]));
  const titles = [...html.matchAll(/<header class="mr-band"><b>([^<]*)<\/b>/g)].map(match => match[1]);
  assert.equal(titles[titles.indexOf('Averías y cobertura') + 1], 'Ubicación (ERU) y causas de la baja');
  assert.ok(titles.indexOf('Mayores diferencias') < titles.indexOf('Averías y cobertura'));
});

test('a selected center reports no pending centers and history uses real quantities', async () => {
  const older = inventory('INV-1160-0', '1160', [line('A', { Stock_Sistema: 100, Stock_Fisico: 90, Stock_Total: 90, Diferencia: -10 })], '2026-09-01');
  const metrics = await load([older, mixedCenter()], { center: '1160' });
  assert.deepEqual(metrics.reportData.pendingCenters, []);
  const summed = metrics.reportData.centers[0].history;
  assert.equal(summed[0].totalUnits, 100);
  assert.equal(summed[0].exactUnits, 90);
  assert.equal(summed[0].eri, 90);
});

test('no audited data does not manufacture a result', () => {
  const html = report.render({ id: 'INV' }, { summary: {}, reportData: { centers: [], pendingCenters: [] } });
  assert.ok(html.includes('No hay datos auditados'));
  for (const text of ['100,00%', 'CUMPLE', 'PERFECTO']) assert.ok(!html.includes(text), text);
  assert.ok(report.render({ id: 'INV' }, { summary: {} }).includes('No hay datos auditados'));
});

test('the page loads the new report and no longer references the old ones', () => {
  const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(page, /managementReport\.js/);
  assert.match(page, /management-report\.css/);
  assert.doesNotMatch(page, /detailedMetricsReport|detailed-report\.css|executive-report\.css|btn-report-download-detailed-pdf|report-preview-mode/);
  assert.ok(page.indexOf('managementReport.js') < page.indexOf('metricsReportModal.js'));
});

test('each sheet carries its own styles because the PDF export clones it out of its parents', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/management-report.css'), 'utf8');
  assert.doesNotMatch(css, /\.mr-report\s+[.a-z]/);
  assert.doesNotMatch(css, /\.mr-paper\s*\{[^}]*--mr-/);
  assert.match(css, /\.mr-sheet\s*\{[^}]*--mr-navy:[^}]*font-family/);
});
test('each warehouse is scored on its own, so stock in two warehouses does not lower the location score', async () => {
  const metrics = await load([inventory('INV-1160-1', '1160', [
    line('TWO-WAREHOUSES', { Almacen: 'RFO7', Ubicacion: VALID[0] }),
    line('TWO-WAREHOUSES', { Almacen: 'RFO8', Ubicacion: VALID[1] }),
    line('SAME-WAREHOUSE', { Almacen: 'RFO7', Ubicacion: VALID[2], Ubicacion_1: VALID[3] }),
    line('ONE-BAD', { Almacen: 'RFO7', Ubicacion: VALID[3] }),
    line('ONE-BAD', { Almacen: 'RFO8', Ubicacion: 'CORTA' })
  ])]);
  const [center] = metrics.reportData.centers;
  assert.equal(center.eru.evaluated, 5);
  assert.equal(center.eru.exact, 3);
  assert.equal(center.eru.causes.multiple, 1);
  assert.equal(center.eru.causes.format, 1);
  assert.equal(metrics.summary.eruPercent, 60);
  assert.equal(metrics.summary.totalSkusEvaluatedForEru, 5);
  assert.equal(metrics.summary.totalSkusAudited, 3, 'ERI by code keeps counting codes');
  assert.deepEqual(center.issues.map(issue => [issue.sku, issue.warehouse]).sort(), [['ONE-BAD', 'RFO8'], ['SAME-WAREHOUSE', 'RFO7']]);
  const warehouse = name => center.byWarehouse.find(group => group.name === name).eru;
  assert.deepEqual([warehouse('RFO7').evaluated, warehouse('RFO7').exact], [3, 2]);
  assert.deepEqual([warehouse('RFO8').evaluated, warehouse('RFO8').exact], [2, 1]);
  const twoWarehouses = metrics.multiLocationSkus.find(sku => sku.sku === 'TWO-WAREHOUSES');
  assert.equal(twoWarehouses.eruPercent, 100);
  assert.equal(twoWarehouses.severalInWarehouse, false);
  const annex = report.render({ id: 'INV' }, metrics).split('<b>Anexo D')[1].split('<b>Anexo E')[0];
  assert.ok(annex.includes('SAME-WAREHOUSE'));
  assert.ok(!annex.includes('TWO-WAREHOUSES'));
});

test('dashboard and Excel show no net impact and no fixed fallback values', () => {
  const view = fs.readFileSync(path.join(root, 'public/js/views/dashboardView.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  for (const source of [view, page]) assert.doesNotMatch(source, /[Ii]mpacto [Nn]eto|Financiero Neto|Neto\b|finalNetImpact|NetDiffCost/);
  for (const invented of ['89.63', '99.67', '99.23', '55.25', '99.88', '21873505', '|| 299', '|| 298', '|| 130', '|| 129', "|| 1,", '95.0)', 'Warnes', 'Santa Cruz (John Deere)', "'100.0'"]) {
    assert.ok(!view.includes(invented), invented);
  }
});
test('consolidated comparison shows the previous inventory, and says so only when there is none', async () => {
  const metrics = await load([
    inventory('INV-1160-1', '1160', [line('A', { Stock_Fisico: 5, Stock_Total: 5, Diferencia: -5 }), line('B')], '2026-10-05'),
    inventory('INV-1160-2', '1160', [line('A'), line('B')], '2026-10-12'),
    inventory('INV-1120-2', '1120', [line('C')], '2026-10-12')
  ], { inventoryId: 'GRUPO:2' });
  const html = report.render({ name: 'Semana 2' }, metrics);
  assert.deepEqual(metrics.reportData.centers.map(center => center.center).sort(), ['1120', '1160']);
  assert.match(html, /75,00\s*%? → 100\s*%?|75[,.]\d* ?% → 100/);
  assert.match(html, /\+25,00 puntos/);
  assert.equal(html.split('Sin inventario anterior').length - 1, 1, 'only the center without a previous closure');
});

test('a previous inventory of another type is not used as the comparison', async () => {
  const weekly = { ...inventory('INV-SEMANAL-1160-1', '1160', [line('A')], '2026-10-05'), type: 'SEMANAL' };
  const metrics = await load([weekly, inventory('INV-1160-2', '1160', [line('A')], '2026-10-12')], { inventoryId: 'GRUPO:2' });
  const center = { ...metrics.reportData.centers[0] };
  assert.equal(center.history.length, 2);
  const consolidated = { ...metrics, reportData: { ...metrics.reportData, centers: [center, { ...center, center: '1120', name: 'Centro 1120' }] } };
  assert.ok(report.render({ name: 'Corte' }, consolidated).includes('Sin inventario anterior'));
});

const longMotive = 'ESTAS DIFERENCIAS se originaron por un error de despacho en una venta, con varias notas relacionadas y seguimiento a los clientes sin respuesta.';
const differing = (center, suffix) => inventory(`INV-${center}-1`, center, [
  line(`SHORT-${suffix}`, { Stock_Fisico: 7, Stock_Total: 7, Diferencia: -3, Comentario_Justificacion: longMotive }),
  line(`OVER-${suffix}`, { Stock_Fisico: 12, Stock_Total: 12, Diferencia: 2, Comentario_Justificacion: longMotive, Clasificacion_ABC: 'B' })
]);

test('consolidated differences read one below the other under a single title, and coverage has its own sheet', async () => {
  const html = report.render({ name: 'Consolidado Semana 1' }, await load([differing('1160', 'A'), differing('1120', 'B')]));
  assert.ok(html.includes('<b>Mayores diferencias</b>'));
  assert.equal(html.includes('Mayores diferencias y cobertura'), false);
  assert.ok(html.includes('<b>Averías y cobertura</b>'));
  const sheetOf = title => html.slice(html.indexOf(`<b>${title}</b>`), html.indexOf('</section><section class="mr-sheet"', html.indexOf(`<b>${title}</b>`)));
  const differences = sheetOf('Mayores diferencias');
  assert.ok(differences.includes('Mayores faltantes') && differences.includes('Mayores sobrantes'));
  assert.equal(differences.includes('mr-c2'), false, 'two columns made the long motives overlap');
  assert.equal(differences.match(/table data-split class="mr-diff"/g).length, 2, 'long lists continue on another sheet');
});

test('the consolidated report ends with diagnosis, conclusion and only the inventory control signature', async () => {
  const metrics = await load([differing('1160', 'A'), differing('1120', 'B')], {}, [{ username: 'jefe', displayName: 'Encargado Real', role: 'ENCARGADO', center: '1160' }]);
  const html = report.render({ name: 'Consolidado Semana 1' }, metrics);
  const closing = html.slice(html.lastIndexOf('<section class="mr-sheet"'));
  assert.ok(closing.includes('<b>Diagnóstico y recomendación</b>'));
  for (const text of ['Qué hacer, en orden', 'Regularización contable', 'Conclusión global', 'Aclarar los faltantes', 'Aclarar los sobrantes']) assert.ok(closing.includes(text), text);
  assert.doesNotMatch(closing, /[Nn]eto\b|impacto absoluto/, 'shortages and surpluses are not netted nor added');
  assert.deepEqual([...closing.matchAll(/<h4>([^<]*)<\/h4>/g)].map(match => match[1]), ['Responsable de Control de Inventarios']);
  assert.ok(closing.includes('Humberto Alonso Rios Lino'));
  assert.equal(closing.includes('Encargado Real'), false, 'center managers sign their own report, not the consolidated one');
  assert.equal(closing.match(/class="mr-sign-line"/g).length, 1);
  assert.equal(closing.includes('Gerencia'), false);
});

test('a center report closes with the names of whoever counted and of its warehouse manager', async () => {
  const counted = inventory('INV-1160-1', '1160', [
    line('A', { Responsable: 'contador', Fecha_Ultimo_Conteo: '2026-10-15', Stock_Fisico: 7, Stock_Total: 7, Diferencia: -3 }),
    line('B', { Responsable: 'segundo', Fecha_Ultimo_Conteo: '2026-10-15' })
  ]);
  const metrics = await load([counted], {}, [
    { username: 'contador', displayName: 'Contador Real', role: 'AUXILIAR', center: '1160' },
    { username: 'segundo', displayName: 'Segundo Contador', role: 'AUXILIAR', center: '1160' },
    { username: 'jefe', displayName: 'Encargado <Real>', role: 'ENCARGADO', center: '1160' },
    { username: 'otro', displayName: 'Otro Centro', role: 'ENCARGADO', center: '1120' }
  ]);
  const html = report.render({ name: 'Inventario' }, metrics);
  const closing = html.slice(html.lastIndexOf('<section class="mr-sheet"'));
  assert.ok(closing.includes('<b>Diagnóstico y recomendación</b>'), 'it is the last sheet, after the annexes');
  const role = name => closing.slice(closing.indexOf(`<h4>${name}</h4>`), closing.indexOf('</div></div></div>', closing.indexOf(`<h4>${name}</h4>`)));
  assert.ok(role('Responsable de conteo').includes('Contador Real') && role('Responsable de conteo').includes('Segundo Contador'));
  assert.ok(role('Responsable de almacén').includes('Encargado &lt;Real&gt;'));
  assert.equal(closing.includes('Otro Centro'), false);
  assert.equal(role('Auditoría · Control de Gestión').includes('Real'), false, 'whoever audits signs under the title');
  assert.equal(html.includes('Encargado del centro'), false, 'the signatures are not repeated earlier');
  const page4 = html.slice(html.indexOf('<b>Principales diferencias y plan de acción</b>'), html.indexOf('Anexo A'));
  assert.equal(page4.includes('mr-signs'), false);
  assert.equal(page4.includes('mr-c2'), false, 'long motives do not overlap in the center report either');
});

test('without differences the closing sheet says so instead of listing empty actions', async () => {
  const html = report.render({ name: 'Inventario' }, await load([inventory('INV-1160-1', '1160', [line('OK')])]));
  const closing = html.slice(html.lastIndexOf('<section class="mr-sheet"'));
  assert.ok(closing.includes('No quedan diferencias, averías ni bajas de ubicación por atender.'));
  assert.ok(closing.includes('No quedan faltantes ni sobrantes por regularizar.'));
  assert.ok(closing.includes('No quedan líneas con diferencia.'));
});
