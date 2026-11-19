const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/inventoryTypeLabel.js'), 'utf8'), context);
const labels = context.window.InventoryTypeLabel;

test('the monthly inventory is shown as Lubricantes while its stored type stays MENSUAL', () => {
  assert.equal(labels.label('MENSUAL'), 'LUBRICANTES');
  assert.equal(labels.label('mensual'), 'LUBRICANTES');
  assert.equal(labels.title('MENSUAL'), 'Lubricantes');
  assert.equal(labels.label('CICLICO'), 'CICLICO');
  assert.equal(labels.title('SEMANAL'), 'Semanal');
  assert.equal(labels.text('MENSUAL · 3'), 'LUBRICANTES · 3');
  assert.equal(labels.text('MENSUAL-1120-2026-11-16'), 'LUBRICANTES-1120-2026-11-16');
  assert.equal(labels.text('INV-MENSUAL-1120-3'), 'INV-MENSUAL-1120-3', 'IDs keep the stored type');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.equal((html.match(/<option value="MENSUAL">Lubricantes<\/option>/g) || []).length, 7);
  assert.equal(html.includes('>Mensual<'), false);
  assert.ok(html.indexOf('inventoryTypeLabel.js') < html.indexOf('/js/views/'), 'Loaded before the views');
});
