const contract = require('./inventoryContract');

const state = value => contract.identity(value).replace(/_/g, ' ');
function time(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;

  // Sheets returns dates in the spreadsheet locale (es_BO: d/M/yyyy).
  // Date.parse interprets slash dates as US month/day and rejects dates such
  // as 13/10/2026, making valid counts appear older than countNotBefore.
  const localDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localDate) {
    const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', secondText = '0'] = localDate;
    const day = Number(dayText), month = Number(monthText), year = Number(yearText);
    const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day ||
        hour > 23 || minute > 59 || second > 59) return 0;
    return parsed.getTime();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
const hasQuantity = value => contract.has(value) && typeof value !== 'boolean' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const isFinalized = inv => inv.isFinalized === true || ['REVISADO', 'CERRADO', 'ARCHIVADO'].includes(inv.status);
const countStage = inv => inv.phase === 'RECONTEO_2' || inv.recountRound === 2 ? 2
  : inv.isReconteo || inv.phase === 'RECONTEO' || String(inv.id).startsWith('REC-') ? 1 : 0;

function hasCount(item, stage = 0, since = null) {
  const [good, , total, , , date] = contract.stages[stage];
  const alias = stage === 0 ? item.Stock_Fisico : stage === 1 ? item.Reconteo_Fisico : undefined;
  const itemDate = item[date] || (stage > 0 ? (item.Fecha_Ultimo_Conteo || item.modificationHistory?.slice(-1)[0]?.timestamp) : null);
  const hasQty = [item[good], item[total], alias].some(hasQuantity) || (stage === 1 && item.Estado_Reconteo === 'Recontado');
  if (!hasQty) return false;
  if (!since) return true;
  const t = time(itemDate);
  return t > 0 && t >= time(since);
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
    photoUrl: item[second ? 'foto_justificacion_2' : 'foto_justificacion'],
    photoUrls: item[second ? 'fotos_justificacion_2' : 'fotos_justificacion'] || [],
    justifiedQuantity: item[second ? 'Cantidad_Justificada_2' : 'Cantidad_Justificada_1']
  };
  const matches = records.filter(j => Number(j.round || 1) === round && contract.member(j) === contract.member(item));
  const latest = [row, ...matches].sort((a, b) => time(b.reviewedAt) - time(a.reviewedAt))[0];
  const decision = state(latest.corroboracion || latest.corroboration);
  const countDate = item[contract.stages[second ? (hasCount(item, 2) ? 2 : 1) : 0][5]];
  let complete = ['CUADRA', 'NO CUADRA'].includes(decision) && !!String(latest.justification || '').trim()
    && time(latest.reviewedAt) > 0 && time(latest.reviewedAt) >= Math.max(time(since), time(countDate) - 3600000);
  if (contract.isWeekly(item) && decision === 'CUADRA') {
    // Validate this review against its own physical stage, including when a later stage exists.
    const stage = second ? (hasCount(item, 2) ? 2 : 1) : 0;
    const physical = item[contract.stages[stage][2]];
    complete = complete && contract.has(latest.justifiedQuantity)
      && Number.isSafeInteger(Number(latest.justifiedQuantity))
      && contract.has(physical) && Number(physical) + Number(latest.justifiedQuantity) === Number(item.Stock_Sistema);
  }
  return {...latest, round, corroboracion: decision, complete};
}

function initialDiscrepancy(item) {
  if (!hasCount(item)) return false;
  const total = contract.has(item.Stock_Total) ? Number(item.Stock_Total)
    : Number(item.Stock_Buen_Estado ?? item.Stock_Fisico) + Number(item.Mal_estado || 0);
  const system = Number(contract.isWeekly(item) ? item.Stock_Sistema : (item.Stock_Sistema_Original ?? item.Stock_Sistema));
  if (!contract.isWeekly(item) && system < 0 && total === 0 && Number(item.Mal_estado || 0) === 0) return false;
  return total !== system || Number(item.Mal_estado || 0) > 0;
}

// Membership is recorded when recount is enabled; a zero difference never removes a member.
function recountKeys(inv, child) {
  if (Array.isArray(inv.recountItemKeys) && inv.recountItemKeys.length) return new Set(inv.recountItemKeys);
  if (child?.items?.length) return new Set(child.items.map(contract.member));
  if (!(inv.hasRecount || inv.isReconteo || inv.status === 'RECONTEO_COMPLETADO' || countStage(inv))) return new Set();
  // Count fields describe observations, not recount membership. Inferring membership
  // from them can incorrectly pull every counted item into second justification.
  return new Set((inv.items || []).filter(item => item.isReconteoItem || item.requiereReconteo)
    .map(contract.member));
}

function plan(inv, child, records = []) {
  const keys = recountKeys(inv, child);
  const finalized = isFinalized(inv);
  const countComplete = (inv.items || []).length > 0 && inv.items.every(item => hasCount(item));
  const recountStage = inv.hasRecount2 || inv.recountRound === 2 ? 2 : 1;
  const members = (inv.items || []).filter(item => keys.has(contract.member(item)));
  const childFinished = !child || ['RECONTEO_COMPLETADO', 'REVISADO'].includes(child.status);
  const isReconteoStage = inv.status === 'RECONTEO_COMPLETADO';
  const recountComplete = !keys.size || (isReconteoStage && members.length === keys.size
    && childFinished
    && members.every(item => hasCount(item, recountStage, childFinished ? null : (inv.countNotBefore || inv.recountEnabledAt))));
  const reopeningJustification = inv.reopenedPhase === 'JUSTIFICACION';
  const rows = (inv.items || []).map(item => {
    const first = review(item, 1, records, inv.firstReviewNotBefore);
    const second = review(item, 2, records, inv.secondReviewNotBefore);
    const recounted = keys.has(contract.member(item));
    // Reopening the justification phase always targets the second justification fields.
    const round = reopeningJustification ? 2 : (recounted ? 2 : 1);
    const current = round === 2 ? second : first;
    const stage = reopeningJustification
      ? (recounted ? recountStage : 0)
      : (round === 2 ? recountStage : 0);
    const canJustify = !finalized && (reopeningJustification
      ? ['PENDIENTE_JUSTIFICACION', 'RECONTEO_COMPLETADO'].includes(inv.status)
      : countComplete && (round === 1
        ? inv.status === 'PENDIENTE_JUSTIFICACION' && !keys.size
        : inv.status === 'RECONTEO_COMPLETADO' && recountComplete)
        && hasCount(item, stage, stage ? (inv.countNotBefore || inv.recountEnabledAt) : inv.countNotBefore));
    return {...item, justificationRound: round, requiresSecondJustification: recounted,
      canJustify, isJustified: current.complete, reviewComplete: current.complete,
      // Keep imported decisions visible in the review form even when they are
      // incomplete; closure still depends on reviewComplete below.
      reviewStatus: current.corroboracion,
      justificationDetails: current.corroboracion ? current : null,
      justificationHistory: [first, second].filter(r => time(r.reviewedAt)),
      // A historical review date alone must not turn an already balanced item
      // into a current discrepancy. Keep prior NO CUADRA decisions visible so
      // their recount workflow can continue, while suppressing resolved CUADRA rows.
      needsInitialReview: initialDiscrepancy(item) ||
        (first.corroboracion === 'NO CUADRA' && time(first.reviewedAt) > 0)};
  }).filter(item => item.needsInitialReview || item.requiresSecondJustification);
  const initialPending = rows.filter(item => item.needsInitialReview && !review(item, 1, records, inv.firstReviewNotBefore).complete);
  const noCuadra = rows.filter(item => review(item, 1, records, inv.firstReviewNotBefore).corroboracion === 'NO CUADRA');
  const pending = rows.filter(item => !item.reviewComplete);
  const canClose = !finalized && ['PENDIENTE_JUSTIFICACION', 'RECONTEO_COMPLETADO'].includes(inv.status)
    && countComplete && recountComplete && !pending.length
    && (reopeningJustification || isReconteoStage || (!initialPending.length
      && noCuadra.every(item => keys.has(contract.member(item)))));
  return {items: rows, keys, initialPending, noCuadra, pending, finalized, canClose,
    canEnableRecount: !finalized && inv.status === 'PENDIENTE_JUSTIFICACION' && !keys.size
      && countComplete && !initialPending.length && noCuadra.length > 0};
}

function assertJustification(inv, item, round, context, explanation) {
  if (![1, 2].includes(round)) throw new Error('Ronda de justificación inválida');
  const skuMatches = (a, b) => {
    const normA = contract.identity(a);
    const normB = contract.identity(b);
    if (normA === normB) return true;
    return normA.replace(/^JD[_-]?/i, '') === normB.replace(/^JD[_-]?/i, '');
  };
  const entry = context.items.find(it => (item.id && it.id === item.id) ||
    contract.member(it) === contract.member(item) ||
    (skuMatches(it.SKU, item.SKU) && contract.identity(it.Almacen) === contract.identity(item.Almacen)) ||
    skuMatches(it.SKU, item.SKU));
  const isReopenedJust = inv.reopenedPhase === 'JUSTIFICACION';
  if (!entry || (!isReopenedJust && entry.justificationRound !== round) || !entry.canJustify)
    throw new Error('La justificación no está habilitada: finalice y firme el conteo o reconteo correspondiente.');
  if (!String(explanation || '').trim()) throw new Error('Es obligatorio explicar el resultado, tanto CUADRA como NO CUADRA.');
}

module.exports = {hasCount, countStage, isFinalized, review, recountKeys, plan, assertJustification};
