const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'public/js/inventoryGrouping.js'), 'utf8'), context);
const grouping = context.window.InventoryGrouping;
const inventory = (id, createdAt, extra = {}) => ({ id, type: id.split('-')[1], center: id.split('-')[2], status: 'EN_PROGRESO', createdAt, ...extra });
const plain = value => JSON.parse(JSON.stringify(value));

test('each month numbers its weeks from 1, whatever the termination is', () => {
  const months = grouping.group([
    inventory('INV-CICLICO-1120-1', '2026-10-05T15:00:00.000Z'), inventory('INV-CICLICO-1300-1', '2026-10-05T15:00:00.000Z'),
    inventory('INV-CICLICO-1120-2', '2026-10-12T15:00:00.000Z'),
    inventory('INV-CICLICO-1120-4', '2026-11-02T15:00:00.000Z'), inventory('INV-CICLICO-1120-5', '2026-11-09T15:00:00.000Z')
  ]);
  assert.deepEqual(plain(months.map(month => month.label)), ['Noviembre 2026', 'Octubre 2026']);
  assert.deepEqual(plain(months[0].weeks.map(week => [week.label, week.types[0].termination])), [['Semana 2', '5'], ['Semana 1', '4']]);
  assert.deepEqual(plain(months[1].weeks.map(week => [week.label, week.types[0].items.length])), [['Semana 2', 1], ['Semana 1', 2]]);
});

test('the creation month follows Bolivia and a recount stays with its inventory', () => {
  assert.equal(grouping.creationMonth('2026-11-01T02:00:00.000Z'), '2026-10');
  assert.equal(grouping.creationMonth('2026-10-01'), '2026-10');
  assert.equal(grouping.creationMonth(''), '');
  const [month] = grouping.group([
    inventory('INV-CICLICO-1120-2', '2026-10-21T15:00:00.000Z'),
    { ...inventory('REC-INV-CICLICO-1120-2', '2026-11-04T15:00:00.000Z'), type: 'CICLICO', center: '1120', creationDate: '2026-10-21T15:00:00.000Z' }
  ]);
  assert.equal(month.month, '2026-10');
  assert.equal(month.weeks.length, 1);
  assert.equal(month.weeks[0].types[0].items.length, 2);
});

test('types are numbered independently and stay apart inside a week', () => {
  const [month] = grouping.group([
    inventory('INV-CICLICO-1120-4', '2026-11-02T15:00:00.000Z'), inventory('INV-SEMANAL-1120-2', '2026-11-02T15:00:00.000Z'),
    inventory('INV-CICLICO-1120-5', '2026-11-09T15:00:00.000Z'), inventory('INV-SEMANAL-1120-3', '2026-11-09T15:00:00.000Z')
  ]);
  assert.deepEqual(plain(month.weeks.map(week => [week.label, week.types.map(section => [section.type, section.termination])])), [
    ['Semana 2', [['CICLICO', '5'], ['SEMANAL', '3']]],
    ['Semana 1', [['CICLICO', '4'], ['SEMANAL', '2']]]
  ]);
});

test('ids without a week number go last and a date is not taken as a week', () => {
  assert.equal(grouping.termination({ id: 'BULK-CICLICO-1120-2026-10-21' }), '');
  assert.equal(grouping.termination({ id: 'REC-INV-CICLICO-1120-07' }), '7');
  const [month] = grouping.group([
    { id: 'BULK-CICLICO-1120-2026-10-21', type: 'CICLICO', center: '1120', createdAt: '2026-10-21T15:00:00.000Z' },
    inventory('INV-CICLICO-1120-2', '2026-10-21T15:00:00.000Z')
  ]);
  assert.deepEqual(plain(month.weeks.map(week => week.label)), ['Semana 1', 'Sin numeración']);
});

test('summary counts states and progress of what it receives', () => {
  const summary = grouping.summarize([
    { status: 'EN_PROGRESO', counted: 40, items: 100 }, { status: 'EN_RECONTEO', counted: 0, items: 100 },
    { status: 'RECONTEO_COMPLETADO', counted: 100, items: 100 }, { status: 'REVISADO', counted: 100, items: 100 }
  ]);
  assert.deepEqual(plain(summary), { total: 4, progress: 2, review: 1, closed: 1, counted: 240, items: 400, pending: 3, percent: 60 });
});

test('dashboard labels show the week of the month and keep the termination visible', () => {
  const labels = grouping.monthWeekLabels([
    { type: 'CICLICO', groupId: '4' }, { type: 'CICLICO', groupId: '5' }, { type: 'SEMANAL', groupId: '5' }, { type: 'SEMANAL', groupId: '6' }
  ], inv => inv.groupId);
  assert.equal(labels.get('4'), 'Semana 1 (terminación 4)');
  assert.equal(labels.get('6'), 'Semana 2 (terminación 6)');
  assert.equal(labels.get('5'), 'Terminación 5', 'the same termination is a different week for each type');
});

test('the page loads the grouping before the views that use it', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('/js/inventoryGrouping.js') < html.indexOf('/js/views/inventoryView.js'));
  assert.ok(html.indexOf('/js/inventoryGrouping.js') < html.indexOf('/js/views/dashboardView.js'));
  assert.ok(html.includes('id="inventory-groups"'));
  assert.equal(html.includes('tbody-inventories'), false);
});

test('month and week cards open with one click and without the shrinking press effect', () => {
  const feedback = fs.readFileSync(path.join(root, 'public/js/components/buttonFeedback.js'), 'utf8');
  assert.match(feedback, /NO_FEEDBACK_SELECTOR = '\.inv-group-toggle'/);
  assert.equal(feedback.match(/matches\(NO_FEEDBACK_SELECTOR\)/g).length, 2);
  const view = fs.readFileSync(path.join(root, 'public/js/views/inventoryView.js'), 'utf8');
  assert.match(view, /classList\.toggle\('is-open', open\)/);
  assert.equal(view.includes('inv-group-body" hidden'), false, 'a hidden attribute would skip the animation');
});
