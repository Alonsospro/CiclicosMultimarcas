const path = require('path');

// Report center: individual, weekly, monthly and annual reports built from the same
// metrics the dashboard uses, each compared with the previous equivalent period.
const KINDS = ['INDIVIDUAL', 'SEMANAL', 'MENSUAL', 'ANUAL'];
const LOG_LIMIT = 500;
const CAUSE_LABELS = { FALTANTE: 'Faltante', SOBRANTE: 'Sobrante', SUBSANADO: 'Subsanado en reconteo', AVERIA_DANADO: 'Mal estado' };
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const monthFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit' });
const monthOf = value => {
  if (/^\d{4}-\d{2}/.test(String(value ?? ''))) return String(value).slice(0, 7);
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? monthFormat.format(date) : '';
};
const shiftMonth = (month, delta) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
};
const monthLabel = month => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 2) => Math.round(num(value) * 10 ** digits) / 10 ** digits;
const ratio = (part, whole) => whole > 0 ? round(part / whole * 100, 1) : null;
const isClosed = inv => !!inv.isHistory || ['REVISADO', 'FINALIZADO', 'COMPLETO', 'CERRADO', 'ARCHIVADO'].includes(String(inv.status || '').toUpperCase());

function kpis(metrics) {
  const s = metrics?.summary || {};
  // Productivity only from inventories counted within one day: a span of several days is calendar time, not work.
  const lines = new Map((metrics?.availableInventories || []).map(inv => [inv.id, num(inv.totalItems)]));
  const oneDay = (metrics?.reportData?.centers || []).flatMap(center => center.durations || []).filter(row => row.available && row.sameDay);
  const hours = oneDay.reduce((total, row) => total + num(row.seconds), 0) / 3600;
  const oneDayLines = oneDay.reduce((total, row) => total + (lines.get(row.inventoryId) || 0), 0);
  const linesAudited = num(s.totalItemsAudited);
  const value = num(s.totalAuditedSystemValue);
  const absImpact = num(s.impactoFinancieroFinalAbsoluto);
  return {
    inventories: num(s.totalInventories),
    linesPlanned: num(s.totalItemsPlanned),
    linesAudited,
    coverage: ratio(linesAudited, num(s.totalItemsPlanned)),
    skus: num(s.totalSkusAudited),
    units: num(s.totalAuditedSystemUnits),
    value: round(value),
    eriUnits1: s.eriItemInicial ?? null,
    eriUnits: s.eriItemFinal ?? null,
    eriSku1: s.eriSkuInicial ?? null,
    eriSku: s.eriSkuFinal ?? null,
    eriMoney1: s.eriMonetarioInicial ?? null,
    eriMoney: s.eriMonetarioFinal ?? null,
    eru: s.eruPercent ?? null,
    discrepancies1: num(s.discrepancias1er),
    discrepancies: num(s.discrepanciasFinal),
    resolved: num(s.subsanadosCount),
    errorReduction: s.reduccionErrorPercent ?? null,
    shortageUnits: num(s.faltantesFinal?.units),
    shortageCost: round(s.faltantesFinal?.cost),
    surplusUnits: num(s.sobrantesFinal?.units),
    surplusCost: round(s.sobrantesFinal?.cost),
    netImpact: round(s.impactoFinancieroFinal),
    absImpact: round(absImpact),
    impact1: round(s.impactoFinanciero1erAbsoluto),
    impactShare: value > 0 ? round(absImpact / value * 100, 2) : null,
    damagedCost: round(s.damagedCost),
    hours: round(hours, 1),
    linesPerHour: hours > 0 && oneDayLines > 0 ? round(oneDayLines / hours, 1) : null,
    sourcesComplete: metrics?.metricsComplete !== false
  };
}

function centers(metrics) {
  return (metrics?.centerStats || []).map(center => ({
    center: center.center,
    name: center.centerName || center.center,
    lines: num(center.totalAudited),
    eriUnits: center.eriItemFinal ?? null,
    eriSku: center.eriSkuFinal ?? null,
    eriMoney: center.eriMonetarioFinal ?? null,
    eru: center.eru ?? null,
    discrepancies: num(center.discrepancies),
    shortageCost: round(center.deficitCost),
    surplusCost: round(center.surplusCost),
    absImpact: round(center.diffCost)
  })).sort((a, b) => num(b.eriUnits) - num(a.eriUnits) || a.absImpact - b.absImpact);
}

function causes(list) {
  const byType = {};
  const reasons = {};
  let finalCount = 0, justified = 0;
  list.forEach(row => {
    const type = row.tipoDiscrepancia;
    if (!CAUSE_LABELS[type]) return;
    const entry = byType[type] = byType[type] || { type, label: CAUSE_LABELS[type], lines: 0, units: 0, cost: 0 };
    entry.lines += 1;
    entry.units += Math.abs(num(type === 'SUBSANADO' ? row.diferencia1erConteo : type === 'AVERIA_DANADO' ? row.malEstado : row.diferenciaFinal));
    entry.cost += type === 'SUBSANADO' ? num(row.absCostoDiferencia1erConteo) : type === 'AVERIA_DANADO' ? num(row.costoMalEstado) : num(row.absCostoDiferenciaFinal);
    if (!row.esDiscrepanciaFinal) return;
    finalCount += 1;
    const text = String(row.justificacion || '').trim();
    const key = text ? text.replace(/\s+/g, ' ').slice(0, 70).toUpperCase() : 'SIN JUSTIFICACIÓN';
    if (text) justified += 1;
    const reason = reasons[key] = reasons[key] || { reason: key, lines: 0, cost: 0 };
    reason.lines += 1;
    reason.cost += num(row.absCostoDiferenciaFinal);
  });
  return {
    byType: Object.values(byType).map(entry => ({ ...entry, cost: round(entry.cost) })).sort((a, b) => b.cost - a.cost),
    reasons: Object.values(reasons).map(entry => ({ ...entry, cost: round(entry.cost) })).sort((a, b) => b.cost - a.cost).slice(0, 10),
    justifiedShare: ratio(justified, finalCount)
  };
}

function topDifferences(list) {
  return list.filter(row => row.esDiscrepanciaFinal).sort((a, b) => num(b.absCostoDiferenciaFinal) - num(a.absCostoDiferenciaFinal)).slice(0, 15)
    .map(row => ({ sku: row.sku, description: row.descripcion, center: row.centerName || row.center, warehouse: row.almacen, location: row.ubicacion,
      abc: row.abc, system: num(row.stockSistema), difference: num(row.diferenciaFinal), cost: round(row.costoDiferenciaFinal), justification: row.justificacion || '' }));
}

function recurrent(list) {
  const bySku = new Map();
  list.filter(row => row.esDiscrepanciaFinal).forEach(row => {
    const entry = bySku.get(row.sku) || { sku: row.sku, description: row.descripcion, inventories: new Set(), centers: new Set(), cost: 0 };
    entry.inventories.add(row.inventoryId);
    entry.centers.add(row.centerName || row.center);
    entry.cost += num(row.absCostoDiferenciaFinal);
    bySku.set(row.sku, entry);
  });
  return [...bySku.values()].filter(entry => entry.inventories.size > 1)
    .map(entry => ({ sku: entry.sku, description: entry.description, times: entry.inventories.size, centers: [...entry.centers].join(', '), cost: round(entry.cost) }))
    .sort((a, b) => b.times - a.times || b.cost - a.cost).slice(0, 15);
}

function workers(metrics) {
  return (metrics?.workerStats || []).filter(worker => num(worker.totalCounted) > 0).map(worker => ({
    worker: worker.worker, center: worker.center, lines: num(worker.totalCounted), exact: num(worker.exactCounted),
    accuracy: worker.effectiveAccuracy ?? null, firstPass: worker.firstPassRate ?? null, reEdits: num(worker.reEditCount), rating: worker.rating || ''
  }));
}

function durations(metrics) {
  return (metrics?.reportData?.centers || []).flatMap(center => (center.durations || []).map(row => ({
    inventory: row.inventoryName, center: center.name || center.center, available: !!row.available,
    start: row.startLabel, end: row.endLabel, time: row.timeLabel, hours: row.available ? round(num(row.seconds) / 3600, 2) : null, forced: row.forcedLabel || ''
  })));
}

function abc(metrics) {
  return ['A', 'B', 'C'].map(key => {
    const row = metrics?.abcBreakdown?.[key] || {};
    return { class: key, lines: num(row.total), exact: num(row.exact), accuracy: row.accuracy !== undefined ? Number(row.accuracy) : null,
      shortageCost: round(row.deficitCost), surplusCost: round(row.surplusCost), absImpact: round(row.diffCost) };
  });
}

function create({ metrics, storage, config }) {
  const logPath = () => path.join(storage.getDataDirectory(), 'reports', 'log.json');
  const readLog = () => {
    const list = storage.readJson(logPath(), []);
    return Array.isArray(list) ? list : [];
  };
  const keyOf = entry => [entry.kind, entry.ref, entry.type || 'TODOS', entry.center || 'TODOS'].join('|');
  const metricsFor = params => metrics.getDashboardMetrics({ type: 'TODOS', center: 'TODOS', inventoryId: 'TODOS', period: 'TODO', ...params });

  async function catalog({ type = 'TODOS', center = 'TODOS', refresh = false } = {}) {
    const base = await metricsFor({ type, center, forceRefresh: refresh });
    const inventories = (base.availableInventories || []).filter(inv => !String(inv.id || '').startsWith('REC-'));
    const nowMonth = monthOf(new Date());
    const months = new Map(), years = new Map();
    inventories.forEach(inv => {
      const month = monthOf(inv.createdAt);
      if (!month) return;
      const entry = months.get(month) || { ref: month, label: monthLabel(month), inventories: 0, open: 0 };
      entry.inventories += 1;
      if (!isClosed(inv)) entry.open += 1;
      months.set(month, entry);
      const year = month.slice(0, 4);
      const yearEntry = years.get(year) || { ref: year, label: `Año ${year}`, inventories: 0, open: 0 };
      yearEntry.inventories += 1;
      if (!isClosed(inv)) yearEntry.open += 1;
      years.set(year, yearEntry);
    });
    const log = readLog();
    const generated = new Map(log.filter(entry => (entry.type || 'TODOS') === type && (entry.center || 'TODOS') === center).map(entry => [`${entry.kind}|${entry.ref}`, entry]));
    const withStatus = (kind, list, finished) => list.map(item => {
      const last = generated.get(`${kind}|${item.ref}`);
      return { ...item, kind, status: last ? 'GENERADO' : finished(item) ? 'PENDIENTE' : 'EN_CURSO', last: last || null };
    });
    return {
      type, center,
      INDIVIDUAL: withStatus('INDIVIDUAL', inventories.filter(isClosed).map(inv => ({ ref: inv.id, label: inv.name || inv.id, center: inv.center, date: inv.createdAt,
        inventoryType: inv.type, lines: num(inv.totalItems) })), () => true),
      SEMANAL: withStatus('SEMANAL', (base.inventoryGroups || []).filter(group => group.suffix).map(group => ({ ref: String(group.suffix), label: group.label,
        inventories: group.inventoryCount, open: group.inventories.filter(inv => !isClosed(inv)).length, centers: group.centers }))
        .sort((a, b) => Number(b.ref) - Number(a.ref)), item => item.open === 0),
      MENSUAL: withStatus('MENSUAL', [...months.values()].sort((a, b) => b.ref.localeCompare(a.ref)), item => item.ref < nowMonth),
      ANUAL: withStatus('ANUAL', [...years.values()].sort((a, b) => b.ref.localeCompare(a.ref)), item => item.ref < nowMonth.slice(0, 4))
    };
  }

  async function periodMetrics(kind, ref, filters) {
    if (kind === 'INDIVIDUAL') return metricsFor({ ...filters, inventoryId: ref });
    if (kind === 'SEMANAL') return metricsFor({ ...filters, inventoryId: `GRUPO:${ref}` });
    if (kind === 'MENSUAL') return metricsFor({ ...filters, period: 'MES_ESPECIFICO', month: ref });
    return metricsFor({ ...filters, period: 'PERSONALIZADO', startDate: `${ref}-01-01`, endDate: `${ref}-12-31` });
  }

  async function previousOf(kind, ref, filters, current) {
    if (kind === 'INDIVIDUAL') {
      const self = (current.availableInventories || []).find(inv => inv.id === ref);
      if (!self) return null;
      const earlier = (current.availableInventories || []).filter(inv => inv.id !== ref && isClosed(inv) && !String(inv.id).startsWith('REC-') &&
        inv.center === self.center && inv.type === self.type && (Date.parse(inv.createdAt) || 0) < (Date.parse(self.createdAt) || 0))
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))[0];
      return earlier ? { ref: earlier.id, label: earlier.name || earlier.id } : null;
    }
    if (kind === 'SEMANAL') {
      const all = await metricsFor(filters);
      const prior = (all.inventoryGroups || []).map(group => Number(group.suffix)).filter(n => Number.isFinite(n) && n < Number(ref)).sort((a, b) => b - a)[0];
      return prior === undefined ? null : { ref: String(prior), label: `Semana ${prior}` };
    }
    if (kind === 'MENSUAL') {
      const month = shiftMonth(ref, -1);
      return { ref: month, label: monthLabel(month) };
    }
    return { ref: String(Number(ref) - 1), label: `Año ${Number(ref) - 1}` };
  }

  async function series(kind, ref, filters, current) {
    if (kind === 'MENSUAL') {
      return (current.inventoryGroups || []).filter(group => group.suffix).map(group => ({
        label: group.label, inventories: group.inventoryCount, eriUnits: group.metrics?.eriItemFinal ?? null, eriSku: null,
        eriMoney: group.metrics?.eriMonetarioFinal ?? null, eru: group.metrics?.eruPercent ?? null,
        discrepancies: num(group.metrics?.discrepanciasFinal), absImpact: round(group.metrics?.totalFinalDiffCost),
        shortageCost: round(group.metrics?.faltantesCost), surplusCost: round(group.metrics?.sobrantesCost)
      }));
    }
    if (kind !== 'ANUAL') return [];
    const rows = [];
    for (let month = 1; month <= 12; month += 1) {
      const key = `${ref}-${String(month).padStart(2, '0')}`;
      if (key > monthOf(new Date())) break;
      const data = await metricsFor({ ...filters, period: 'MES_ESPECIFICO', month: key });
      const k = kpis(data);
      if (!k.inventories) continue;
      rows.push({ label: MONTHS[month - 1], month: key, inventories: k.inventories, eriUnits: k.eriUnits, eriSku: k.eriSku, eriMoney: k.eriMoney, eru: k.eru,
        discrepancies: k.discrepancies, absImpact: k.absImpact, shortageCost: k.shortageCost, surplusCost: k.surplusCost, netImpact: k.netImpact });
    }
    return rows;
  }

  async function build({ kind, ref, type = 'TODOS', center = 'TODOS', user } = {}) {
    if (!KINDS.includes(kind)) throw Object.assign(new Error('Tipo de informe inválido.'), { status: 400 });
    if (!ref) throw Object.assign(new Error('Indique el periodo del informe.'), { status: 400 });
    if (kind === 'MENSUAL' && !/^\d{4}-\d{2}$/.test(ref)) throw Object.assign(new Error('Mes inválido: use AAAA-MM.'), { status: 400 });
    if (kind === 'ANUAL' && !/^\d{4}$/.test(ref)) throw Object.assign(new Error('Año inválido: use AAAA.'), { status: 400 });
    if (kind === 'SEMANAL' && !/^\d+$/.test(ref)) throw Object.assign(new Error('Semana inválida.'), { status: 400 });
    const filters = { type, center };
    const current = await periodMetrics(kind, ref, filters);
    if (!num(current.summary?.totalInventories)) throw Object.assign(new Error('No hay inventarios cerrados y validados para este periodo.'), { status: 404 });
    const prior = await previousOf(kind, ref, filters, current);
    let previous = null;
    if (prior) {
      const data = await periodMetrics(kind, prior.ref, filters).catch(() => null);
      if (data && num(data.summary?.totalInventories)) previous = { ...prior, kpis: kpis(data) };
    }
    const list = current.discrepanciesList || [];
    const label = kind === 'INDIVIDUAL' ? (current.selectedInventory?.name || ref)
      : kind === 'SEMANAL' ? `Semana ${Number(ref)}` : kind === 'MENSUAL' ? monthLabel(ref) : `Año ${ref}`;
    const centerName = center === 'TODOS' ? 'Todos los centros' : (config.findCenter(center) ? `${config.findCenter(center).code} - ${config.findCenter(center).name}` : center);
    return {
      kind, ref, label, type, center, centerName,
      generatedAt: new Date().toISOString(),
      generatedBy: user?.displayName || user?.name || user?.username || '',
      kpis: kpis(current),
      previous,
      centers: centers(current),
      series: await series(kind, ref, filters, current),
      abc: abc(current),
      causes: causes(list),
      topDifferences: topDifferences(list),
      recurrent: recurrent(list),
      workers: workers(current),
      durations: durations(current),
      sourceIssues: (current.sourceDiagnostics || []).filter(row => row.status && row.status !== 'valid').length,
      selectedInventory: current.selectedInventory || null,
      metrics: current
    };
  }

  function record(entry, user) {
    if (!KINDS.includes(entry?.kind) || !entry.ref) throw Object.assign(new Error('Registro de informe inválido.'), { status: 400 });
    const clean = {
      kind: entry.kind, ref: String(entry.ref), label: String(entry.label || entry.ref).slice(0, 120),
      type: entry.type || 'TODOS', center: entry.center || 'TODOS',
      kpis: entry.kpis && typeof entry.kpis === 'object' ? entry.kpis : {},
      generatedAt: new Date().toISOString(),
      generatedBy: user?.displayName || user?.name || user?.username || ''
    };
    const list = readLog();
    const previous = list.find(item => keyOf(item) === keyOf(clean));
    clean.generations = (previous?.generations || 0) + 1;
    const next = [clean, ...list.filter(item => keyOf(item) !== keyOf(clean))].slice(0, LOG_LIMIT);
    storage.writeJson(logPath(), next);
    return clean;
  }

  function history({ center } = {}) {
    return readLog().filter(entry => !center || center === 'TODOS' || entry.center === center);
  }

  return { catalog, build, record, history, kpis };
}

module.exports = { create, KINDS, kpis };
