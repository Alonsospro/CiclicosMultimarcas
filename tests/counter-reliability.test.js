const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const contract = require('../src/services/inventoryContract');
const reliability = require('../src/services/counterReliability');
const counter = {id: 'counter-1', username: 'uno', displayName: 'Ana', role: 'AUXILIAR'};
const reviewer = {id: 'reviewer', username: 'encargado', displayName: 'Encargado', role: 'ENCARGADO'};
function fixture(good = 8, bad = 1) {
  const item = contract.normalize({id: 'row1', SKU: 'SKU', Almacen: 'A', Ubicacion: 'LOC',
    Stock_Sistema: 100, Stock_Buen_Estado: good, Mal_estado: bad, Fecha_Ultimo_Conteo: '2026-10-15T12:00:00Z'});
  const inv = {id: 'INV-SEMANAL-1120-1', type: 'SEMANAL', center: '1120', status: 'EN_PROGRESO', items: [item]};
  return {inv, item};
}
function signed(inv, item, stage = 0, user = counter) {
  reliability.recordCount(inv, item, stage, user);
  reliability.sign(inv, [item], stage, user);
  inv.status = stage ? 'RECONTEO_COMPLETADO' : 'PENDIENTE_JUSTIFICACION';
}
function verify(inv, item, good, bad, user = reviewer, extra = {}) {
  const input = {requestId: randomUUID(), revision: reliability.state(inv, item).revision,
    good, bad, comparable: true, physicallyChecked: true, reason: 'Se verificó físicamente sin movimientos.', ...extra};
  return {result: reliability.verify(inv, item, input, user), input};
}
test('missing evidence is unavailable, an unsigned authored count is pending, never zero or 100%', () => {
  const {inv, item} = fixture();
  let summary = reliability.summarize([inv]);
  assert.equal(summary.unavailable, 1); assert.equal(summary.reliability, null);
  reliability.recordCount(inv, item, 0, counter);
  summary = reliability.summarize([inv]);
  assert.equal(summary.workers[0].pending, 1); assert.equal(summary.workers[0].reliability, null);
  assert.throws(() => verify(inv, item, 8, 1), /Sin evidencia|Pendiente/);
});
test('physically correct counts are accurate regardless of system stock or CUADRA', () => {
  const {inv, item} = fixture(); signed(inv, item);
  verify(inv, item, 8, 1);
  Object.assign(item, contract.update(item, {isCuadra: true}));
  const worker = reliability.summarize([inv]).workers[0];
  assert.equal(worker.reliability, 100); assert.equal(worker.coverage, 100);
  assert.equal(item.Stock_Sistema, 9);
});
test('equal totals with wrong condition are classification errors, including multiple locations', () => {
  const {inv, item} = fixture(); item.Ubicacion_1 = 'TWO'; item.Ubicacion_2 = 'THREE';
  signed(inv, item); verify(inv, item, 9, 0);
  const w = reliability.summarize([inv]).workers[0];
  assert.equal(w.reliability, 0); assert.equal(w.totalAccuracy, 100);
  assert.equal(w.goodAccuracy, 0); assert.equal(w.badAccuracy, 0);
});
test('zero is a verified physical quantity', () => {
  const {inv, item} = fixture(0, 0); signed(inv, item); verify(inv, item, 0, 0);
  assert.equal(reliability.summarize([inv]).reliability, 100);
});
test('recounts have their own authors; equal positive recounts do not penalize initial counter', () => {
  const {inv, item} = fixture(8, 0); signed(inv, item);
  Object.assign(item, contract.update(item, {isReconteo: true, reconteo: 8, malestadoReconteo: 0}));
  signed(inv, item, 1, reviewer); verify(inv, item, 8, 0);
  const summary = reliability.summarize([inv, {...inv, id: 'REC-'+inv.id, isReconteo: true}]);
  assert.equal(summary.counted, 2); assert.equal(summary.verified, 2);
  assert.ok(summary.workers.every(w => w.reliability === 100));
  assert.equal(summary.workers.find(w => w.worker === 'Encargado').selfVerified, 1);
});
test('edits before signing are not rectifications; after signing preserve the first observation', () => {
  const {inv, item} = fixture(4, 0);
  reliability.recordCount(inv, item, 0, counter);
  Object.assign(item, contract.update(item, {stockBuenEstado: 5, malEstado: 0}));
  signed(inv, item); verify(inv, item, 5, 0);
  assert.equal(item.counterEvidence.corrections.length, 0);
  inv.status = 'EN_PROGRESO'; reliability.invalidate(inv, [item]);
  Object.assign(item, contract.update(item, {stockBuenEstado: 6, malEstado: 0}));
  reliability.recordCount(inv, item, 0, counter, 'Se corrigió una pieza omitida.');
  reliability.sign(inv, [item], 0, counter); inv.status = 'PENDIENTE_JUSTIFICACION';
  assert.equal(reliability.summarize([inv]).verified, 0);
  verify(inv, item, 6, 0);
  const w = reliability.summarize([inv]).workers[0];
  assert.equal(w.counted, 1); assert.equal(w.reliability, 0); assert.equal(w.corrected, 1);
  assert.equal(w.records[0].initial.total, 5);
  assert.equal(item.counterEvidence.signed.length, 2);
  assert.equal(item.counterEvidence.verifications.length, 2);
});
test('SKU and display names do not combine different authors or warehouse records', () => {
  const {inv, item} = fixture(2, 0); signed(inv, item); verify(inv, item, 2, 0);
  const other = {...contract.normalize(item), id: 'other', Almacen: 'B'};
  delete other.counterEvidence; inv.items.push(other);
  signed(inv, other, 0, {...counter, id: 'counter-2'}); verify(inv, other, 3, 0);
  const summary = reliability.summarize([inv]);
  assert.equal(summary.workers.length, 2); assert.equal(summary.reliability, 50);
});
test('stale submissions and altered retries fail; identical retries are idempotent', () => {
  const {inv, item} = fixture(); signed(inv, item);
  const {input, result} = verify(inv, item, 8, 1);
  assert.deepEqual(reliability.verify(inv, item, input, reviewer), result);
  assert.equal(item.counterEvidence.verifications.length, 1);
  assert.throws(() => reliability.verify(inv, item, {...input, good: 10}, reviewer), /otros datos/);
  assert.throws(() => reliability.verify(inv, item, {...input, requestId: randomUUID()}, reviewer), /cambió/);
});
test('stock movements suspend evaluation and retain previous confirmations', () => {
  const {inv, item} = fixture(); signed(inv, item); verify(inv, item, 8, 1);
  verify(inv, item, null, null, reviewer, {comparable: false});
  const w = reliability.summarize([inv]).workers[0];
  assert.equal(w.reliability, null); assert.equal(w.coverage, 0); assert.equal(w.records[0].status, 'No comparable');
  assert.equal(item.counterEvidence.verifications.length, 2);
});
test('invalid quantities and missing physical attestation cannot become evidence', () => {
  const {inv, item} = fixture(); signed(inv, item);
  for (const good of ['', null, true, -1, 2.5, 'invalid']) assert.throws(() => verify(inv, item, good, 0));
  assert.throws(() => verify(inv, item, 8, 1, reviewer, {physicallyChecked: false}), /física/);
  assert.equal(item.counterEvidence.verifications.length, 0);
});
test('only weekly inventories are enabled and Sheet refresh preserves evidence by full member identity', () => {
  const {inv, item} = fixture(); inv.type = 'CICLICO';
  reliability.recordCount(inv, item, 0, counter); assert.equal(item.counterEvidence, undefined);
  inv.type = 'SEMANALES'; signed(inv, item); verify(inv, item, 8, 1);
  const merged = reliability.preserve([{...item, counterEvidence: {forged: true}}, {...item, Almacen: 'B'}], [item]);
  assert.deepEqual(merged[0].counterEvidence, item.counterEvidence);
  assert.equal(merged[1].counterEvidence, undefined);
  merged[0].Stock_Buen_Estado = 4; merged[0].Stock_Total = 5;
  assert.equal(reliability.summarize([{...inv, items: merged}]).verified, 0);
});
