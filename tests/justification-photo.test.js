const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function photoView() {
  const elements = new Map(), uploads = [], errors = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', style: {}, listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; }
    });
    return elements.get(id);
  };
  const context = {
    document: {getElementById: element, querySelectorAll: () => []},
    window: {
      addEventListener() {}, Auth: {currentUser: {center: '1340'}},
      Toast: {info() {}, success() {}, danger: message => errors.push(message)},
      API: {uploadPhoto: async (file, metadata) => { uploads.push(metadata); return {}; }}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/views/justificationsView.js'), 'utf8'), context);
  const view = context.window.JustificationsView;
  view.compressImage = async file => file;
  view.setupListeners();
  return {view, element, uploads, errors};
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
