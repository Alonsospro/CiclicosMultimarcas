const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function photoView() {
  const elements = new Map(), uploads = [], errors = [], warnings = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', style: {}, listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      classList: {names: new Set(), add(name) { this.names.add(name); }, remove(name) { this.names.delete(name); }},
      contains: () => false
    });
    return elements.get(id);
  };
  const context = {
    document: {getElementById: element, querySelectorAll: () => []},
    window: {
      addEventListener() {}, Auth: {currentUser: {center: '1340'}},
      Toast: {info() {}, success() {}, danger: message => errors.push(message), warning: message => warnings.push(message)},
      API: {uploadPhoto: async (file, metadata) => { uploads.push(metadata); return {}; }}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/views/justificationsView.js'), 'utf8'), context);
  const view = context.window.JustificationsView;
  view.compressImage = async file => file;
  view.setupListeners();
  return {view, element, uploads, errors, warnings};
}

for (const round of [1, 2]) {
  test(`justification round ${round} uploads the selected item when SKUs repeat`, async () => {
    const {view, element, uploads, errors} = photoView();
    view.tasks = [{inventoryId: 'INV-CICLICO-1340-1', center: '1340', type: 'CICLICO', items: [
      {id: 'ITEM-1', SKU: 'SKU-1', Almacen: 'R001'},
      {id: 'ITEM-2', SKU: 'SKU-1', Almacen: 'R002'},
      {id: 'ITEM-3', SKU: 'SKU-1', Almacen: 'R002'}
    ]}];
    element('just-modal-inv-id').value = 'INV-CICLICO-1340-1';
    element('just-modal-sku-input').value = 'SKU-1';
    element('just-modal-almacen-input').value = 'R002';
    element('just-modal-item-id').value = 'ITEM-3';
    element('just-modal-is-second-just').value = String(round === 2);
    await element('input-just-photo-file').listeners.change({target: {files: [{name: 'photo.jpg', type: 'image/jpeg', size: 1024}]}});
    assert.deepEqual(errors, []);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].sku, 'SKU-1');
    assert.equal(uploads[0].almacen, 'R002');
    assert.equal(uploads[0].itemId, 'ITEM-3');
    assert.equal(uploads[0].inventoryId, 'INV-CICLICO-1340-1');
    assert.equal(uploads[0].round, round);
  });
}

const photo = name => ({name, type: 'image/jpeg', size: 1024});
const dropEvent = files => {
  const event = {dataTransfer: {types: ['Files'], files}, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}};
  return event;
};

test('dropped photos upload like selected ones and skip files that are not images', async () => {
  const {element, uploads, errors, warnings} = photoView();
  element('just-modal-sku-input').value = 'SKU-1';
  element('just-modal-item-id').value = 'ITEM-3';
  const zone = element('zone-just-photo');
  const over = dropEvent([]);
  zone.listeners.dragover(over);
  assert.equal(over.prevented, true);
  assert.equal(zone.classList.names.has('is-dragging'), true);
  const drop = dropEvent([photo('a.jpg'), {name: 'nota.pdf', type: 'application/pdf', size: 10}, photo('b.jpg')]);
  await zone.listeners.drop(drop);
  assert.equal(drop.prevented, true);
  assert.equal(zone.classList.names.has('is-dragging'), false);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].itemId, 'ITEM-3');
  assert.deepEqual([uploads[0].evidenceIndex, uploads[1].evidenceIndex], [0, 1]);
  assert.equal(warnings.length, 1);
  assert.deepEqual(errors, []);
});

test('dragging text is left alone, and a file dropped beside the zone does not leave the page', () => {
  const {element} = photoView();
  const text = {dataTransfer: {types: ['text/plain']}, prevented: false, preventDefault() { this.prevented = true; }};
  element('zone-just-photo').listeners.dragover(text);
  assert.equal(text.prevented, false);
  const beside = dropEvent([photo('a.jpg')]);
  element('modal-justification').listeners.drop(beside);
  assert.equal(beside.prevented, true);
});

test('photos dropped during an upload wait, so none replaces the ones being saved', async () => {
  const {view, element, uploads, warnings} = photoView();
  let release;
  const finished = new Promise(resolve => { release = resolve; });
  view.compressImage = async file => { await finished; return file; };
  const first = element('zone-just-photo').listeners.drop(dropEvent([photo('a.jpg')]));
  await element('zone-just-photo').listeners.drop(dropEvent([photo('b.jpg')]));
  assert.equal(warnings.length, 1);
  release();
  await first;
  assert.equal(uploads.length, 1);
  await element('zone-just-photo').listeners.drop(dropEvent([photo('c.jpg')]));
  assert.equal(uploads.length, 2);
});
