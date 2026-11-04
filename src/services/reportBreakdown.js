// Collects, per center, the quantities the management PDF reports show:
// totals by warehouse and ABC class, shortages and surpluses kept apart, and why
// each code loses its location score (ERU).
const ERU_CAUSES = ['multiple', 'format', 'none', 'additional'];

const amount = () => ({ lines: 0, units: 0, cost: 0 });
const causeCounts = () => Object.fromEntries(ERU_CAUSES.map(cause => [cause, 0]));
const emptyGroup = name => ({
  name,
  skus: 0, skusExact1: 0, skusExact: 0,
  units: 0, unitsExact1: 0, unitsExact: 0,
  value: 0, valueExact1: 0, valueExact: 0, lines: 0,
  shortage: amount(), surplus: amount(), damage: amount(),
  eru: { evaluated: 0, exact: 0, causes: causeCounts() }
});
const roundMoney = value => Math.round(value * 100) / 100;
const add = (target, units, cost) => {
  target.lines += 1;
  target.units += units;
  target.cost += cost;
};
const finishAmount = value => ({ ...value, cost: roundMoney(value.cost) });
const finishGroup = group => ({
  ...group,
  value: roundMoney(group.value),
  valueExact1: roundMoney(group.valueExact1),
  valueExact: roundMoney(group.valueExact),
  shortage: finishAmount(group.shortage),
  surplus: finishAmount(group.surplus),
  damage: finishAmount(group.damage)
});

// Each code that loses its score lands in exactly one cause. `locations` are the
// code's distinct locations; the score itself stays with the metrics service.
function eruCause(locations, isValidLocation) {
  if (locations.length > 1) return 'multiple';
  const only = locations[0];
  if (!only || !String(only.ubicacion || '').trim() || only.ubicacion === 'SIN_UBICACION') return 'none';
  if (!only.isPrimary) return 'additional';
  return isValidLocation(only.ubicacion) ? null : 'format';
}

// Bolivia has one fixed offset and no daylight saving time.
const LA_PAZ_OFFSET = 4 * 3600000;
const ENTRIES = [['Fecha_Ultimo_Conteo', 'Conteo'], ['Fecha_Primera_Justificacion', '1ª justificación'], ['Fecha_Reconteo', 'Reconteo 1'],
  ['Fecha_Justificacion_2', '2ª justificación'], ['Fecha_Reconteo_2', 'Reconteo 2']];
const pad = value => String(value).padStart(2, '0');

// A moment needs its time of day: a bare date cannot give hours, minutes or seconds.
function entryTime(value) {
  if (typeof value?.getTime === 'function') return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  const text = String(value ?? '').trim();
  // Sheets in es_BO emits d/M/yyyy HH:mm in local time.
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (local) return Date.UTC(+local[3], local[2] - 1, +local[1], +local[4], +local[5], +(local[6] || 0)) + LA_PAZ_OFFSET;
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
const localDate = time => new Date(time - LA_PAZ_OFFSET);
const localLabel = time => {
  const d = localDate(time);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const localDay = time => Math.floor((time - LA_PAZ_OFFSET) / 86400000);

// From the first entry to the last one: counts, recounts and justifications. The labels live here
// so the dashboard and the PDF report say exactly the same thing.
function inventoryDuration(inventory, { centerName = '', finished = true } = {}) {
  // The final file keeps this reason on every row whose justification was skipped by a forced close.
  const isForced = item => [item.Razon, item.Razon_Justificacion_2].some(reason => String(reason ?? '').trim().toUpperCase() === 'CIERRE FORZADO');
  const forcedLines = (inventory.items || []).filter(isForced).length;
  const base = { inventoryId: inventory.id, inventoryName: inventory.name || inventory.id, center: inventory.center, centerName, finished,
    forcedLines, forcedLabel: forcedLines ? `Cierre forzado: ${forcedLines} ${forcedLines === 1 ? 'ítem' : 'ítems'} sin justificar` : '' };
  let first = 0, last = 0, lastEntry = '';
  (inventory.items || []).forEach(item => ENTRIES.forEach(([field, label]) => {
    const time = entryTime(item[field]);
    if (!time) return;
    if (!first || time < first) first = time;
    if (time > last) { last = time; lastEntry = label; }
  }));
  if (!first) return { ...base, available: false, startLabel: 'No disponible', endLabel: 'No disponible', lastEntry: '', timeLabel: 'No disponible', dayLabel: 'No disponible' };
  const seconds = Math.round((last - first) / 1000), days = localDay(last) - localDay(first) + 1;
  const span = days === 1 ? 'un solo día' : `${days} días`;
  return { ...base, available: true, startedAt: new Date(first).toISOString(), finishedAt: new Date(last).toISOString(),
    startLabel: localLabel(first), endLabel: localLabel(last), lastEntry, seconds, days, sameDay: days === 1,
    timeLabel: `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min ${seconds % 60} s`,
    dayLabel: finished ? `En ${span}` : `Sin terminar · ${span} hasta ahora` };
}

function createCollector() {
  const centers = new Map();
  const centerOf = (code, name) => {
    if (!centers.has(code)) {
      centers.set(code, {
        ...emptyGroup(name || code),
        center: code,
        byWarehouse: new Map(),
        byClass: new Map(),
        crossWarehouse: new Map(),
        crossClass: new Map(),
        firstCount: { shortage: amount(), surplus: amount() },
        flow: { firstDifferences: 0, resolved: 0, stillShort: 0, stillSurplus: 0, appeared: 0 },
        inventories: new Set(),
        durations: new Map(),
        lastClosedAt: null,
        issues: []
      });
    }
    return centers.get(code);
  };
  const groupOf = (map, name) => {
    const key = String(name || 'Sin almacén');
    if (!map.has(key)) map.set(key, emptyGroup(key));
    return map.get(key);
  };
  const cellOf = (map, row, column) => {
    const rowKey = String(row || 'Sin almacén');
    if (!map.has(rowKey)) map.set(rowKey, {});
    const cells = map.get(rowKey);
    if (!cells[column]) cells[column] = { shortage: 0, surplus: 0 };
    return cells[column];
  };

  return {
    addInventory({ center, centerName, id, closedAt, duration }) {
      const entry = centerOf(center, centerName);
      entry.inventories.add(id);
      if (duration) entry.durations.set(id, duration);
      if (closedAt && (!entry.lastClosedAt || new Date(closedAt) > new Date(entry.lastClosedAt))) entry.lastClosedAt = closedAt;
    },

    addLine({ center, centerName, warehouse, abc, systemUnits, value, valueExact1 = 0, valueExact = 0, unitsExact1, unitsExact, diff1, diffFinal, cost1, costFinal, damageUnits, damageCost }) {
      const entry = centerOf(center, centerName);
      const groups = [entry, groupOf(entry.byWarehouse, warehouse), groupOf(entry.byClass, abc)];
      groups.forEach(group => {
        group.lines += 1;
        group.units += systemUnits;
        group.value += value;
        group.valueExact1 += valueExact1;
        group.valueExact += valueExact;
        group.unitsExact1 += unitsExact1;
        group.unitsExact += unitsExact;
        if (diffFinal < 0) add(group.shortage, Math.abs(diffFinal), costFinal);
        if (diffFinal > 0) add(group.surplus, diffFinal, costFinal);
        if (damageUnits > 0) add(group.damage, damageUnits, damageCost);
      });
      if (diffFinal !== 0) {
        const side = diffFinal < 0 ? 'shortage' : 'surplus';
        cellOf(entry.crossWarehouse, warehouse, abc)[side] += costFinal;
        cellOf(entry.crossClass, abc, abc)[side] += costFinal;
      }
      if (diff1 < 0) add(entry.firstCount.shortage, Math.abs(diff1), cost1);
      if (diff1 > 0) add(entry.firstCount.surplus, diff1, cost1);
      if (diff1 !== 0) {
        entry.flow.firstDifferences += 1;
        if (diffFinal === 0) entry.flow.resolved += 1;
        else if (diffFinal < 0) entry.flow.stillShort += 1;
        else entry.flow.stillSurplus += 1;
      } else if (diffFinal !== 0) {
        entry.flow.appeared += 1;
      }
    },

    addSku({ center, centerName, warehouse, abc, exact1, exactFinal }) {
      const entry = centerOf(center, centerName);
      [entry, groupOf(entry.byWarehouse, warehouse), groupOf(entry.byClass, abc)].forEach(group => {
        group.skus += 1;
        if (exact1) group.skusExact1 += 1;
        if (exactFinal) group.skusExact += 1;
      });
    },

    // One result per code and warehouse.
    addLocationResult({ center, centerName, warehouse, abc, cause, sku, descripcion, locations, units, value }) {
      const entry = centerOf(center, centerName);
      [entry, groupOf(entry.byWarehouse, warehouse), groupOf(entry.byClass, abc)].forEach(group => {
        group.eru.evaluated += 1;
        if (cause) group.eru.causes[cause] += 1;
        else group.eru.exact += 1;
      });
      if (cause) {
        const primary = locations.find(location => location.isPrimary);
        entry.issues.push({
          sku, descripcion, abc, cause, units,
          warehouse: warehouse || '',
          value: roundMoney(value),
          primary: primary && primary.ubicacion !== 'SIN_UBICACION' ? primary.ubicacion : '',
          others: locations.filter(location => location !== primary && location.ubicacion !== 'SIN_UBICACION').map(location => location.ubicacion)
        });
      }
    },

    // Code lists are only printed by the single center report.
    build({ history = {}, allCenters = [] } = {}) {
      const includeIssues = centers.size <= 1;
      const list = [...centers.values()].map(entry => {
        const cross = map => [...map.entries()].map(([name, cells]) => ({
          name,
          cells: Object.fromEntries(Object.entries(cells).map(([column, cell]) => [column, {
            shortage: roundMoney(cell.shortage), surplus: roundMoney(cell.surplus)
          }]))
        })).sort((a, b) => a.name.localeCompare(b.name));
        const sortedGroups = map => [...map.values()].map(finishGroup).sort((a, b) => a.name.localeCompare(b.name));
        return {
          ...finishGroup(entry),
          byWarehouse: sortedGroups(entry.byWarehouse),
          byClass: sortedGroups(entry.byClass),
          crossWarehouse: cross(entry.crossWarehouse),
          crossClass: cross(entry.crossClass),
          firstCount: { shortage: finishAmount(entry.firstCount.shortage), surplus: finishAmount(entry.firstCount.surplus) },
          inventories: [...entry.inventories],
          durations: [...entry.durations.values()].sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || ''))),
          history: history[entry.center] || [],
          issues: includeIssues ? entry.issues.sort((a, b) => b.value - a.value) : []
        };
      });
      const seen = new Set(list.map(entry => entry.center));
      return {
        centers: list,
        pendingCenters: allCenters.filter(center => !seen.has(center.code)).map(center => ({ code: center.code, name: center.name }))
      };
    }
  };
}

module.exports = { ERU_CAUSES, eruCause, createCollector, inventoryDuration };
