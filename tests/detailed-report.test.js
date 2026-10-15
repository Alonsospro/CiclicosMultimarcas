const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/components/detailedMetricsReport.js'), 'utf8'), context);
const render = metrics => context.window.DetailedMetricsReport.render({ id: 'INV-1160-1', center: '1160' }, metrics);

test('report uses final differences for physical stock, separates resolved lines and escapes source text', () => {
  const html = render({ summary: { totalItemsAudited: 2, eriItemInicial: 60, eriItemFinal: 70, eriSkuFinal: 50, eriMonetarioFinal: 66 }, discrepanciesList: [
    { sku: '<script>bad</script>', stockSistema: 87, stockFisico: 99, diferencia: 12, diferenciaFinal: -59, costoDiferenciaFinal: -100254.57, almacen: 'RFO7' },
    { sku: 'RESUELTO', stockSistema: 10, stockFisico: 8, diferenciaFinal: 0, costoDiferenciaFinal: 0, estaSubsanado: true }
  ] });
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(html.includes('<td class="num">28</td>'));
  assert.ok(!html.includes('<td class="num">99</td>'));
  assert.ok(html.includes('1 líneas con faltantes'));
  assert.ok(html.includes('DETALLE COMPLEMENTARIO'));
  assert.ok(html.includes('REQUIERE SEGUIMIENTO'));
  assert.ok(html.includes('+10.00 puntos porcentuales'));
  assert.ok(!html.includes('APROBADO'));
});

test('missing metrics do not manufacture perfect accuracy or approval', () => {
  const html = render({ summary: {}, discrepanciesList: [] });
  assert.ok(html.includes('DATOS INSUFICIENTES'));
  assert.ok(html.includes('No disponible'));
  assert.ok(!html.includes('100.00%'));
  assert.ok(!html.includes('META DE EXACTITUD CUMPLIDA'));
});

test('long discrepancy lists retain all identities for measured pagination', () => {
  const list = Array.from({ length: 29 }, (_, i) => ({ sku: `SKU-${i}-END`, diferenciaFinal: -1, stockSistema: 2, costoDiferenciaFinal: -4 }));
  const html = render({ summary: { totalItemsAudited: 29 }, discrepanciesList: list });
  list.forEach(item => assert.ok(html.includes(`>${item.sku}</td>`)));
  assert.equal((html.match(/class="detail-page"/g) || []).length, 3);
  assert.equal((html.match(/ÍTEMS CRÍTICOS CON FALTANTES/g) || []).length, 1);
});

test('ERU replaces the fourth KPI and monetary cards show each category with an explicit total', () => {
  const html = render({ summary: { eruPercent: 92, exactMatchingLocations: 46, totalLocationsEvaluated: 50, faltantesFinal: { cost: 100 }, sobrantesFinal: { cost: 20 }, totalDamagedCost: 30 }, discrepanciesList: [] });
  const cards = html.slice(html.indexOf('<div class="detail-kpis">'), html.indexOf('<div class="detail-money-cards"'));
  assert.ok(cards.includes('ERU • EXACTITUD DE UBICACIÓN'));
  assert.ok(cards.includes('92.00%'));
  assert.ok(!cards.includes('IMPACTO POR FALTANTES'));
  const financial = html.slice(html.indexOf('<div class="detail-money-cards"'), html.indexOf('Alcance y lectura del informe'));
  for (const title of ['SOBRANTES', 'AVERÍAS', 'FALTANTES', 'IMPACTO TOTAL']) assert.ok(financial.includes(title));
  assert.ok(financial.includes('150,00'));
});

test('final damaged quantities override initial evidence and remain separate from surplus quantities', () => {
  const html = render({ summary: {}, discrepanciesList: [
    { sku: 'AVERIA-FINAL', descripcion: 'Pieza', almacen: 'RFO7', stockSistema: 8, diferenciaFinal: 0, malEstado: 1, malEstadoFinal: 3, costoMalEstado: 10, costoMalEstadoFinal: 30 },
    { sku: 'YA-SANO', stockSistema: 8, diferenciaFinal: 0, malEstado: 4, malEstadoFinal: 0 },
    { sku: 'SOBRA', stockSistema: 4, diferenciaFinal: 2, costoDiferenciaFinal: 20 }
  ] });
  const damage = html.slice(html.indexOf('TABLA 4'), html.indexOf('ANÁLISIS GRÁFICO'));
  assert.ok(damage.includes('AVERIA-FINAL'));
  assert.ok(!damage.includes('YA-SANO'));
  assert.ok(!damage.includes('>SOBRA</td>'));
  assert.ok(damage.includes('class="num">3</td>'));
  assert.ok(damage.includes('30,00'));
  assert.ok(html.includes('TABLA 3 • DETALLE DE SOBRANTES'));
});

test('comparison labels use actual initial/final values, deltas and severity colors', () => {
  const html = render({ summary: { eriItemInicial: 70, eriItemFinal: 98, eriSkuInicial: 96, eriSkuFinal: 92, eriMonetarioInicial: 88, eriMonetarioFinal: 88, eruPercent: 99 }, discrepanciesList: [] });
  const charts = Array.from(html.matchAll(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g), match => decodeURIComponent(match[1]));
  const chart = charts.find(svg => svg.includes('data-initial'));
  assert.ok(chart.includes('data-initial="70" data-final="98" data-level="good"'));
  assert.ok(chart.includes('data-initial="96" data-final="92" data-level="attention"'));
  assert.ok(chart.includes('data-initial="88" data-final="88" data-level="alert"'));
  assert.ok(chart.includes('+28.00 pp'));
  assert.ok(chart.includes('-4.00 pp'));
  assert.ok(chart.includes('Sin cambio: 0.00 pp'));
  assert.ok(chart.includes('data-initial="" data-final="99"'));
  assert.ok(chart.includes('N/D'));
});


test('financial chart shows full currency amounts and includes all economic categories', () => {
  const html = render({ summary: {}, discrepanciesList: [
    { sku: 'FALTA', almacen: 'A', diferenciaFinal: -1, costoDiferenciaFinal: -100254.57 },
    { sku: 'SOBRA', almacen: 'B', diferenciaFinal: 1, costoDiferenciaFinal: 312.45 },
    { sku: 'DANO', almacen: 'C', diferenciaFinal: 0, malEstadoFinal: 2, costoMalEstadoFinal: 27.89 }
  ] });
  const charts = Array.from(html.matchAll(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g), match => decodeURIComponent(match[1]));
  const chart = charts.find(svg => svg.includes('Faltante'));
  for (const text of ['100.254,57', '312,45', '27,89', 'Sobrante', 'Avería']) assert.ok(chart.includes(text));
  assert.ok(!chart.includes(' mil'));
  assert.ok(!html.includes('Impacto total ='));
});

test('signatures use actual counters and center managers while auditor name remains blank', () => {
  const html = render({ reportSignatories: { counters: ['María <Contadora>', 'Pedro'], centerManagers: ['Ana Centro'] }, summary: {}, discrepanciesList: [] });
  const signatures = html.slice(html.indexOf('class="detail-signatures"'));
  for (const name of ['María &lt;Contadora&gt;', 'Pedro', 'Ana Centro']) assert.ok(signatures.includes(name));
  assert.ok(signatures.includes('<b class="detail-signature-name">&nbsp;</b>Auditoría'));
});


test('global conclusion precedes signatures and reflects results without granting approval', () => {
  const html = render({ summary: { totalItemsAudited: 2, totalAuditedSystemUnits: 10, eriItemFinal: 85, eriSkuFinal: 90, eriMonetarioFinal: 92 }, discrepanciesList: [{ sku: 'F', diferenciaFinal: -1, costoDiferenciaFinal: -25 }] });
  const start = html.indexOf('Conclusión global del inventario del centro');
  const end = html.indexOf('class="detail-signatures"');
  assert.ok(start > 0 && start < end);
  const conclusion = html.slice(start, end);
  for (const text of ['1160', 'requiere seguimiento', '85.00%', '1 líneas con diferencias', '25,00']) assert.ok(conclusion.includes(text));
  const perfect = render({ summary: { totalItemsAudited: 1, eriItemFinal: 100, eriSkuFinal: 100, eriMonetarioFinal: 100 }, discrepanciesList: [] });
  assert.ok(perfect.includes('alcanza la referencia de exactitud'));
  assert.ok(!perfect.includes('APROBADO'));
  const missing = render({ summary: {}, discrepanciesList: [] });
  assert.ok(missing.includes('información insuficiente para emitir una conclusión global'));
});


test('distribution separates shortage surplus and damage with independent colors and counts', () => {
  const html = render({ summary: { totalItemsAudited: 4, itemsCuadradosFinal: 2 }, discrepanciesList: [
    { sku: 'F', diferenciaFinal: -1, malEstadoFinal: 2 },
    { sku: 'S', diferenciaFinal: 1 },
    { sku: 'A', diferenciaFinal: 0, malEstadoFinal: 1 }
  ] });
  const charts = Array.from(html.matchAll(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g), match => decodeURIComponent(match[1]));
  const chart = charts.find(svg => svg.includes('data-category'));
  for (const [label, count, color] of [['Faltantes', 1, '#dc2626'], ['Sobrantes', 1, '#2563eb'], ['Averías', 2, '#d97706']]) {
    const segment = chart.split(`data-category="${label}"`)[1].split('</g>')[0];
    assert.ok(segment.includes(`data-count="${count}"`));
    assert.ok(segment.includes(color));
  }
  assert.ok(html.includes('sus porcentajes no equivalen al ERI'));
});
