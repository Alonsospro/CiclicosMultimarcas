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

test('long discrepancy lists retain all identities in bounded page groups', () => {
  const list = Array.from({ length: 29 }, (_, i) => ({ sku: `SKU-${i}-END`, diferenciaFinal: -1, stockSistema: 2, costoDiferenciaFinal: -4 }));
  const html = render({ summary: { totalItemsAudited: 29 }, discrepanciesList: list });
  list.forEach(item => assert.ok(html.includes(`>${item.sku}</td>`)));
  assert.equal((html.match(/class="detail-page"/g) || []).length, 7);
});
