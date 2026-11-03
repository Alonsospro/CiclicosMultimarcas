// Groups inventories by the month they were created in and, inside it, by week.
// Each month shows its weeks from 1: the number comes from the inventory's own termination,
// taken per type because cyclic and weekly inventories are numbered independently.
window.InventoryGrouping = (() => {
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit' });
  const REVIEW = ['PENDIENTE_JUSTIFICACION', 'RECONTEO_COMPLETADO', 'FIRMADO'];
  const CLOSED = ['REVISADO', 'CERRADO', 'FINALIZADO'];

  // Calendar month in Bolivia, the same rule the server uses for the metrics.
  function creationMonth(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return String(value).slice(0, 7);
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? monthFormat.format(date) : '';
  }

  function monthLabel(month) {
    const [year, number] = String(month || '').split('-');
    return number ? `${MONTHS[Number(number) - 1]} ${year}` : 'Sin fecha de creación';
  }

  // Older ids end in a date (BULK-...-2026-10-21), which is not a week number.
  function termination(inventory) {
    const match = String(inventory?.id ?? '').match(/^(?:REC-)?INV-.*-(\d+)$/);
    return match ? String(Number(match[1])) : '';
  }

  // Position of each termination inside its type, within the inventories of one month.
  function weekNumbers(list, terminationOf = termination) {
    const byType = new Map();
    list.forEach(inventory => {
      const value = terminationOf(inventory);
      if (!value) return;
      if (!byType.has(inventory.type)) byType.set(inventory.type, new Set());
      byType.get(inventory.type).add(value);
    });
    const numbers = new Map();
    byType.forEach((values, type) => {
      [...values].sort((a, b) => Number(a) - Number(b)).forEach((value, index) => numbers.set(`${type}|${value}`, index + 1));
    });
    return numbers;
  }

  function group(list) {
    const months = new Map();
    list.forEach(inventory => {
      const month = creationMonth(inventory.creationDate || inventory.createdAt);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(inventory);
    });
    return [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, inventories]) => {
      const numbers = weekNumbers(inventories);
      const weeks = new Map();
      inventories.forEach(inventory => {
        const value = termination(inventory);
        const number = value ? numbers.get(`${inventory.type}|${value}`) : 0;
        if (!weeks.has(number)) weeks.set(number, new Map());
        const types = weeks.get(number);
        if (!types.has(inventory.type)) types.set(inventory.type, {type: inventory.type, termination: value, items: []});
        types.get(inventory.type).items.push(inventory);
      });
      return {
        month,
        label: monthLabel(month),
        weeks: [...weeks.entries()]
          // Newest week first, with inventories that have no number at the end.
          .sort(([a], [b]) => (b || -Infinity) - (a || -Infinity))
          .map(([number, types]) => ({
            key: `${month}|${number || 'sin-numero'}`,
            number,
            label: number ? `Semana ${number}` : 'Sin numeración',
            types: [...types.values()].sort((a, b) => String(a.type).localeCompare(String(b.type))).map(section => ({
              ...section,
              items: section.items.sort((a, b) => String(a.center).localeCompare(String(b.center)) || String(a.id).localeCompare(String(b.id)))
            }))
          }))
      };
    });
  }

  function stateOf(status) {
    const clean = String(status || '').toUpperCase();
    return CLOSED.includes(clean) ? 'closed' : REVIEW.includes(clean) ? 'review' : 'progress';
  }

  function summarize(rows) {
    const summary = {total: rows.length, progress: 0, review: 0, closed: 0, counted: 0, items: 0};
    rows.forEach(row => {
      summary[stateOf(row.status)]++;
      summary.counted += Number(row.counted) || 0;
      summary.items += Number(row.items) || 0;
    });
    summary.pending = summary.progress + summary.review;
    summary.percent = summary.items ? Math.round(summary.counted / summary.items * 100) : 0;
    return summary;
  }

  // Labels for the dashboard while a month is selected. Its filter works by termination, so one
  // termination that means different weeks for two types keeps its plain name.
  function monthWeekLabels(list, terminationOf) {
    const numbers = weekNumbers(list, terminationOf);
    const weeks = new Map();
    numbers.forEach((number, key) => {
      const value = key.slice(key.lastIndexOf('|') + 1);
      if (!weeks.has(value)) weeks.set(value, new Set());
      weeks.get(value).add(number);
    });
    return new Map([...weeks.entries()].map(([value, found]) => [value,
      found.size === 1 ? `Semana ${[...found][0]} (terminación ${value})` : `Terminación ${value}`]));
  }

  return {creationMonth, monthLabel, termination, weekNumbers, group, stateOf, summarize, monthWeekLabels};
})();
