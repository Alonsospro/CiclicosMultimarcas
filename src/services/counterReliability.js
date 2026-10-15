const {randomUUID, createHash} = require('crypto');
const contract = require('./inventoryContract');

const enabled = inv => ['SEMANAL', 'SEMANALES'].includes(contract.identity(inv.type));
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actor = user => ({key: String(user.id || user.username || '').toLowerCase().trim(),
  username: String(user.username || ''), name: String(user.displayName || user.username || '')});
const evidence = item => item.counterEvidence?.version === 1 ? item.counterEvidence : null;
const quantities = (item, stage) => {
  const [good, bad, total, , , date] = contract.stages[stage];
  if (!contract.has(item[good]) || !contract.has(item[total])) return null;
  return {good: Number(item[good]), bad: Number(item[bad] || 0), total: Number(item[total]), at: item[date] || null};
};
const sameQuantity = (a, b) => !!a && !!b && a.good === b.good && a.bad === b.bad && a.total === b.total;

// Server-owned evidence is independent of the editable Sheet stock and justification.
function recordCount(inv, item, stage, user, reason = '') {
  if (!enabled(inv)) return;
  const who = actor(user), value = quantities(item, stage);
  if (!who.key || !value) throw new Error('No se pudo registrar la autoría del conteo.');
  const e = evidence(item) || {version: 1, drafts: {}, signed: [], corrections: [], verifications: []};
  const previous = e.drafts[stage];
  if (e.signed.some(s => s.stage === stage) && !sameQuantity(previous, value)) {
    e.corrections.push({id: randomUUID(), stage, actor: who, previous: previous || null,
      next: value, reason: String(reason || '').slice(0, 1000), at: new Date().toISOString()});
  }
  e.drafts[stage] = {id: randomUUID(), stage, actor: who, ...value};
  e.pending = true;
  item.counterEvidence = e;
}

function sign(inv, items, stage, user) {
  if (!enabled(inv)) return;
  for (const item of items) {
    const e = evidence(item), draft = e?.drafts[stage];
    // Imported rows and historical assignments are not proof of who counted.
    if (!draft || !sameQuantity(draft, quantities(item, stage))) continue;
    if (!e.signed.some(s => s.draftId === draft.id)) e.signed.push({
      ...clone(draft), id: randomUUID(), draftId: draft.id,
      signedAt: new Date().toISOString(), signedBy: actor(user)
    });
    e.pending = false;
  }
}

function invalidate(inv, items) {
  if (!enabled(inv)) return;
  items.forEach(item => { if (evidence(item)) item.counterEvidence.pending = true; });
}

function state(inv, item) {
  const e = evidence(item);
  const stages = [0, 1, 2].filter(stage => quantities(item, stage));
  const stage = stages.at(-1);
  const latest = e?.signed.filter(s => s.stage === stage).at(-1);
  const closedStage = !['EN_PROGRESO', 'EN_RECONTEO', 'SUSPENDIDO'].includes(inv.status);
  const ready = !!(enabled(inv) && closedStage && !e?.pending && latest &&
    latest.draftId === e.drafts[stage]?.id && sameQuantity(latest, quantities(item, stage)));
  const basis = hash([inv.id, contract.member(item), stages.map(s => [s, quantities(item, s)]),
    e?.signed.map(s => s.id), e?.drafts, e?.pending || false, ready]);
  const verification = e?.verifications.at(-1);
  const current = ready && verification?.basis === basis ? verification : null;
  return {ready, basis, revision: hash([basis, verification?.id]), current,
    reason: ready ? '' : !e?.signed.length ? 'Sin evidencia evaluable de autoría y firma'
      : 'Pendiente de finalizar y firmar la etapa, o de revisar cambios de cantidades'};
}

function verify(inv, item, input, user) {
  const e = evidence(item), s = state(inv, item);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(String(input.requestId || ''))) throw new Error('Identificador de verificación inválido.');
  const who = actor(user);
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw new Error('Explique la comprobación física (5 a 1000 caracteres).');
  if (typeof input.comparable !== 'boolean') throw new Error('Indique si las cantidades son comparables, sin movimientos intermedios.');
  let observed = null;
  if (input.comparable) {
    if (input.physicallyChecked !== true) throw new Error('Debe confirmar que realizó la comprobación física.');
    if (!contract.has(input.good) || !contract.has(input.bad)) throw new Error('Ingrese buen estado y mal estado, incluido cero.');
    const good = contract.quantity(input.good, 'buen estado'), bad = contract.quantity(input.bad, 'mal estado');
    observed = {good, bad, total: contract.quantity(good + bad, 'total verificado')};
  }
  const requestHash = hash([who.key, input.revision, input.comparable, observed, reason]);
  const prior = e?.verifications.find(v => v.id === input.requestId);
  if (prior) {
    if (prior.requestHash !== requestHash) throw new Error('La solicitud ya se utilizó con otros datos.');
    return prior;
  }
  if (!s.ready) throw new Error(s.reason);
  if (input.revision !== s.revision) throw new Error('El registro cambió. Actualice la lista antes de verificar.');
  const verification = {id: input.requestId, requestHash, basis: s.basis, actor: who,
    observed, comparable: input.comparable, reason, at: new Date().toISOString()};
  e.verifications.push(verification);
  return verification;
}

function reviewRows(inv) {
  return inv.items.map(item => {
    const s = state(inv, item), e = evidence(item);
    return {itemId: item.id, sku: item.SKU, warehouse: item.Almacen, location: item.Ubicacion,
      description: item.Descripcion, ready: s.ready, revision: s.revision, reason: s.reason,
      signed: e?.signed || [], corrections: e?.corrections || [], verification: s.current,
      verificationHistory: e?.verifications || []};
  });
}

function summarize(inventories) {
  const weekly = inventories.filter(inv => enabled(inv) && !inv.isReconteo && !inv.parentInventoryId && !String(inv.id).startsWith('REC-'));
  const workers = new Map();
  let unavailable = 0;
  for (const inv of weekly) for (const item of inv.items || []) {
    const e = evidence(item), s = state(inv, item);
    const stages = new Set([0, 1, 2].filter(stage => quantities(item, stage) || e?.drafts[stage] || e?.signed.some(s => s.stage === stage)));
    // A stage is one observation even if reopened or signed again.
    for (const stage of stages) {
      const first = e?.signed.find(record => record.stage === stage);
      const draft = e?.drafts[stage];
      const author = first?.actor || draft?.actor;
      if (!author?.key) { unavailable++; continue; }
      const key = JSON.stringify([author.key, inv.center]);
      if (!workers.has(key)) workers.set(key, {key, worker: author.name, center: inv.center,
        counted: 0, verified: 0, correct: 0, goodCorrect: 0, badCorrect: 0, totalCorrect: 0,
        selfVerified: 0, corrected: 0, records: []});
      const w = workers.get(key);
      w.counted++;
      const verification = first && s.current?.comparable ? s.current : null;
      const correct = verification ? sameQuantity(first, verification.observed) : null;
      const self = !!verification && verification.actor.key === author.key;
      if (verification) {
        w.verified++; w.correct += Number(correct); w.selfVerified += Number(self);
        w.goodCorrect += Number(first.good === verification.observed.good);
        w.badCorrect += Number(first.bad === verification.observed.bad);
        w.totalCorrect += Number(first.total === verification.observed.total);
      }
      const corrections = e?.corrections.filter(c => c.stage === stage) || [];
      if (corrections.length) w.corrected++;
      w.records.push({inventoryId: inv.id, sku: item.SKU, warehouse: item.Almacen, location: item.Ubicacion,
        stage, initial: first || null, verification, correct, selfVerified: self, corrections,
        status: verification ? correct ? 'Correcto' : 'Diferencia confirmada'
          : s.current && !s.current.comparable ? 'No comparable' : first ? 'Pendiente de verificación' : 'Pendiente de firma'});
    }
  }
  const percentage = (n, d) => d ? n / d * 100 : null;
  const results = [...workers.values()].map(w => ({...w, pending: w.counted - w.verified,
    reliability: percentage(w.correct, w.verified), coverage: percentage(w.verified, w.counted),
    goodAccuracy: percentage(w.goodCorrect, w.verified), badAccuracy: percentage(w.badCorrect, w.verified),
    totalAccuracy: percentage(w.totalCorrect, w.verified)})).sort((a, b) => a.worker.localeCompare(b.worker) || String(a.center).localeCompare(String(b.center)));
  const total = results.reduce((t, w) => ({counted: t.counted + w.counted, verified: t.verified + w.verified,
    correct: t.correct + w.correct}), {counted: 0, verified: 0, correct: 0});
  return {version: 1, workers: results, unavailable, ...total, reliability: percentage(total.correct, total.verified),
    coverage: percentage(total.verified, total.counted), inventories: weekly.map(inv => ({id: inv.id,
      name: inv.name || inv.id, center: inv.center, readOnly: !!inv.isHistory}))};
}

function preserve(rows, previous) {
  const byMember = new Map((previous || []).map(item => [contract.member(item), item]));
  return rows.map(row => {
    const old = byMember.get(contract.member(row));
    const copy = {...row};
    delete copy.counterEvidence;
    if (old?.counterEvidence) copy.counterEvidence = clone(old.counterEvidence);
    if (old?.id) copy.id = old.id;
    return copy;
  });
}

module.exports = {enabled, recordCount, sign, invalidate, state, verify, reviewRows, summarize, preserve, clone};
