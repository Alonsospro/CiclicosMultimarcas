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
  value: 0, lines: 0,
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
    addInventory({ center, centerName, id, closedAt }) {
      const entry = centerOf(center, centerName);
      entry.inventories.add(id);
      if (closedAt && (!entry.lastClosedAt || new Date(closedAt) > new Date(entry.lastClosedAt))) entry.lastClosedAt = closedAt;
    },

    addLine({ center, centerName, warehouse, abc, systemUnits, value, unitsExact1, unitsExact, diff1, diffFinal, cost1, costFinal, damageUnits, damageCost }) {
      const entry = centerOf(center, centerName);
      const groups = [entry, groupOf(entry.byWarehouse, warehouse), groupOf(entry.byClass, abc)];
      groups.forEach(group => {
        group.lines += 1;
        group.units += systemUnits;
        group.value += value;
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

    addSku({ center, centerName, warehouse, abc, exact1, exactFinal, cause, sku, descripcion, locations, units, value }) {
      const entry = centerOf(center, centerName);
      [entry, groupOf(entry.byWarehouse, warehouse), groupOf(entry.byClass, abc)].forEach(group => {
        group.skus += 1;
        if (exact1) group.skusExact1 += 1;
        if (exactFinal) group.skusExact += 1;
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

module.exports = { ERU_CAUSES, eruCause, createCollector };
