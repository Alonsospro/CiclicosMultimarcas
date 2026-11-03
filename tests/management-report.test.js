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
