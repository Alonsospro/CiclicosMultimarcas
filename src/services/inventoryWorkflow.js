const contract = require('./inventoryContract');

const state = value => contract.identity(value).replace(/_/g, ' ');
const time = value => Date.parse(value) || 0;
const hasQuantity = value => contract.has(value) && typeof value !== 'boolean' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const isFinalized = inv => inv.isFinalized === true || ['REVISADO', 'CERRADO', 'ARCHIVADO'].includes(inv.status);
const countStage = inv => inv.phase === 'RECONTEO_2' || inv.recountRound === 2 ? 2
  : inv.isReconteo || inv.phase === 'RECONTEO' || String(inv.id).startsWith('REC-') ? 1 : 0;

function hasCount(item, stage = 0, since = null) {
  const [good, , total, , , date] = contract.stages[stage];
  const alias = stage === 0 ? item.Stock_Fisico : stage === 1 ? item.Reconteo_Fisico : undefined;
  return [item[good], item[total], alias].some(hasQuantity) && (!since || time(item[date]) >= time(since));
}

function review(item, round, records = [], since = null) {
  const second = round === 2;
  const row = {
    round,
    corroboracion: item[second ? 'Estado_Justificacion_2' : 'Estado'],
    justification: item[second ? 'Comentario_Justificacion_2' : 'Comentario_Justificacion'],
    reasonType: item[second ? 'Razon_Justificacion_2' : 'Razon'],
    reviewedBy: item[second ? 'Responsable_Justificacion_2' : 'Responsable_Justificacion'],
    reviewedAt: item[second ? 'Fecha_Justificacion_2' : 'Fecha_Primera_Justificacion'],
    photoUrl: item[second ? 'foto_justificacion_2' : 'foto_justificacion']
  };
  const matches = records.filter(j => Number(j.round || 1) === round && contract.member(j) === contract.member(item));
  const latest = [row, ...matches].sort((a, b) => time(b.reviewedAt) - time(a.reviewedAt))[0];
  const decision = state(latest.corroboracion || latest.corroboration);
  const countDate = item[contract.stages[second ? (hasCount(item, 2) ? 2 : 1) : 0][5]];
  const complete = ['CUADRA', 'NO CUADRA'].includes(decision) && !!String(latest.justification || '').trim()
    && time(latest.reviewedAt) > 0 && time(latest.reviewedAt) >= Math.max(time(since), time(countDate));
  return {...latest, round, corroboracion: decision, complete};
}

function initialDiscrepancy(item) {
  if (!hasCount(item)) return false;
  const total = contract.has(item.Stock_Total) ? Number(item.Stock_Total)
    : Number(item.Stock_Buen_Estado ?? item.Stock_Fisico) + Number(item.Mal_estado || 0);
  const system = Number(item.Stock_Sistema_Original ?? item.Stock_Sistema);
  if (system < 0 && total === 0 && Number(item.Mal_estado || 0) === 0) return false;
  return total !== system || Number(item.Mal_estado || 0) > 0;
}

// Membership is recorded when recount is enabled; a zero difference never removes a member.
function recountKeys(inv, child) {
  if (Array.isArray(inv.recountItemKeys)) return new Set(inv.recountItemKeys);
  if (child?.items?.length) return new Set(child.items.map(contract.member));
  if (!(inv.hasRecount || inv.isReconteo || inv.status === 'RECONTEO_COMPLETADO' || countStage(inv))) return new Set();
  return new Set((inv.items || []).filter(item => item.isReconteoItem || item.requiereReconteo
    || hasCount(item, 1) || hasCount(item, 2)).map(contract.member));
}

function plan(inv, child, records = []) {
  const keys = recountKeys(inv, child);
  const finalized = isFinalized(inv);
  const countComplete = (inv.items || []).length > 0 && inv.items.every(item => hasCount(item));
  const recountStage = inv.hasRecount2 || inv.recountRound === 2 ? 2 : 1;
  const members = (inv.items || []).filter(item => keys.has(contract.member(item)));
  const recountComplete = !keys.size || (inv.status === 'RECONTEO_COMPLETADO' && members.length === keys.size
    && (!child || ['RECONTEO_COMPLETADO', 'REVISADO'].includes(child.status))
    && members.every(item => hasCount(item, recountStage, inv.countNotBefore || inv.recountEnabledAt)));
  const rows = (inv.items || []).map(item => {
    const first = review(item, 1, records, inv.firstReviewNotBefore);
    const second = review(item, 2, records, inv.secondReviewNotBefore);
    const recounted = keys.has(contract.member(item));
    const round = recounted ? 2 : 1;
    const current = round === 2 ? second : first;
    const stage = round === 2 ? (inv.hasRecount2 || inv.recountRound === 2 ? 2 : 1) : 0;
    const canJustify = !finalized && countComplete && (round === 1
      ? inv.status === 'PENDIENTE_JUSTIFICACION' && !keys.size
      : inv.status === 'RECONTEO_COMPLETADO' && recountComplete) && hasCount(item, stage, round === 2 ? (inv.countNotBefore || inv.recountEnabledAt) : inv.countNotBefore);
    return {...item, justificationRound: round, requiresSecondJustification: recounted,
      canJustify, isJustified: current.complete, reviewComplete: current.complete,
      reviewStatus: current.complete ? current.corroboracion : '',
      justificationDetails: current.complete ? current : null,
      justificationHistory: [first, second].filter(r => time(r.reviewedAt)),
      needsInitialReview: initialDiscrepancy(item) || time(first.reviewedAt) > 0};
  }).filter(item => item.needsInitialReview || item.requiresSecondJustification);
  const initialPending = rows.filter(item => item.needsInitialReview && !review(item, 1, records, inv.firstReviewNotBefore).complete);
  const noCuadra = rows.filter(item => review(item, 1, records, inv.firstReviewNotBefore).corroboracion === 'NO CUADRA');
  const pending = rows.filter(item => !item.reviewComplete);
  const canClose = !finalized && ['PENDIENTE_JUSTIFICACION', 'RECONTEO_COMPLETADO'].includes(inv.status)
    && countComplete && recountComplete && !initialPending.length && !pending.length
    && noCuadra.every(item => keys.has(contract.member(item)));
  return {items: rows, keys, initialPending, noCuadra, pending, finalized, canClose,
    canEnableRecount: !finalized && inv.status === 'PENDIENTE_JUSTIFICACION' && !keys.size
      && countComplete && !initialPending.length && noCuadra.length > 0};
}

function assertJustification(inv, item, round, context, explanation) {
  if (![1, 2].includes(round)) throw new Error('Ronda de justificación inválida');
  const entry = context.items.find(it => contract.member(it) === contract.member(item));
  if (!entry || entry.justificationRound !== round || !entry.canJustify)
    throw new Error('La justificación no está habilitada: finalice y firme el conteo o reconteo correspondiente.');
  if (!String(explanation || '').trim()) throw new Error('Es obligatorio explicar el resultado, tanto CUADRA como NO CUADRA.');
}

module.exports = {hasCount, countStage, isFinalized, review, recountKeys, plan, assertJustification};
