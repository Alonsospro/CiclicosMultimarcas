// Report center documents use the same model as Métricas: the center or consolidated report of
// the dashboard, and the monthly report for months. The Excel export carries the period's figures.
(function () {
  const KIND_LABELS = { INDIVIDUAL: 'Informe individual', SEMANAL: 'Informe semanal consolidado', MENSUAL: 'Informe mensual consolidado', ANUAL: 'Informe anual' };
  const TYPE_LABELS = { TODOS: 'Todos los tipos', CICLICO: 'Cíclico', BARRIDO: 'Barrido', SEMANAL: 'Semanal', MENSUAL: 'Lubricantes' };
  // Shortages and surpluses always apart: no net and no sum of both.
  const KPI_ROWS = [
    { group: 'Alcance' },
    { key: 'inventories', label: 'Inventarios incluidos', fmt: 'int' },
    { key: 'linesPlanned', label: 'Líneas programadas', fmt: 'int' },
    { key: 'linesAudited', label: 'Líneas contadas', fmt: 'int' },
    { key: 'coverage', label: 'Avance del plan', fmt: 'pct' },
    { key: 'skus', label: 'Códigos evaluados', fmt: 'int' },
    { key: 'units', label: 'Unidades en sistema', fmt: 'int' },
    { key: 'value', label: 'Valor auditado', fmt: 'bs' },
    { group: 'Exactitud' },
    { key: 'eriUnits1', label: 'ERI unidades · 1er conteo', fmt: 'pct' },
    { key: 'eriUnits', label: 'ERI unidades · final', fmt: 'pct' },
    { key: 'eriSku1', label: 'ERI códigos · 1er conteo', fmt: 'pct' },
    { key: 'eriSku', label: 'ERI códigos · final', fmt: 'pct' },
    { key: 'eriMoney1', label: 'ERI monetario · 1er conteo', fmt: 'pct' },
    { key: 'eriMoney', label: 'ERI monetario · final', fmt: 'pct' },
    { key: 'eru', label: 'ERU ubicaciones', fmt: 'pct' },
    { group: 'Diferencias' },
    { key: 'discrepancies1', label: 'Líneas con diferencia · 1er conteo', fmt: 'int' },
    { key: 'discrepancies', label: 'Líneas con diferencia · final', fmt: 'int' },
    { key: 'resolved', label: 'Líneas subsanadas en reconteo', fmt: 'int' },
    { key: 'errorReduction', label: 'Reducción de error por reconteo', fmt: 'pct' },
    { key: 'justifiedShare', label: 'Diferencias finales justificadas', fmt: 'pct' },
    { group: 'Faltantes y sobrantes' },
    { key: 'shortageUnits', label: 'Faltante · unidades', fmt: 'int' },
    { key: 'shortageCost', label: 'Faltante valorizado', fmt: 'bs' },
    { key: 'surplusUnits', label: 'Sobrante · unidades', fmt: 'int' },
    { key: 'surplusCost', label: 'Sobrante valorizado', fmt: 'bs' },
    { key: 'damagedCost', label: 'Mal estado valorizado', fmt: 'bs' },
    { group: 'Productividad' },
    { key: 'hours', label: 'Horas de conteo (inventarios de un día)', fmt: 'dec' },
    { key: 'linesPerHour', label: 'Líneas por hora (inventarios de un día)', fmt: 'dec' }
  ];

  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const locale = (value, digits) => Number(value).toLocaleString('es-BO', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  function fmt(value, kind) {
    if (!isNum(value)) return '—';
    if (kind === 'int') return locale(Math.round(value), 0);
    if (kind === 'pct') return `${locale(value, 1)}%`;
    if (kind === 'bs') return `Bs ${locale(value, 2)}`;
    return locale(value, 1);
  }

  function fileName(report) {
    const safe = value => String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `Informe_${safe(report.kind)}_${safe(report.label)}_${safe(report.center)}_${new Date().toISOString().slice(0, 10)}`;
  }

  function render(report) {
    const metricsReport = window.ManagementReport;
    if (!metricsReport) return '<div class="mr-report"></div>';
    if (report.kind === 'MENSUAL' && metricsReport.renderMonthly) {
      return metricsReport.renderMonthly({ month: report.ref, type: report.type, center: report.center, current: report.metrics });
    }
    const inv = report.selectedInventory || { id: `${report.kind}-${report.ref}`, name: report.label, center: report.center, type: report.type };
    return metricsReport.render(inv, report.metrics);
  }

  // The period's figures for Excel: one sheet per section.
  function workbook(report) {
    const current = { ...report.kpis, justifiedShare: report.causes?.justifiedShare ?? null };
    const raw = value => isNum(value) ? Number(value) : '';
    return {
      Resumen: KPI_ROWS.filter(row => !row.group).map(row => ({ Indicador: row.label, Valor: raw(current[row.key]) })),
      Centros: report.centers.map((c, i) => ({ '#': i + 1, Centro: c.name, 'ERI unidades %': raw(c.eriUnits), 'ERI códigos %': raw(c.eriSku), 'ERI monetario %': raw(c.eriMoney), 'ERU %': raw(c.eru), 'Líneas': c.lines, 'Con diferencia': c.discrepancies, 'Faltante Bs': c.shortageCost, 'Sobrante Bs': c.surplusCost })),
      ABC: report.abc.map(row => ({ Clase: row.class, 'Líneas': row.lines, Exactas: row.exact, 'Exactitud %': raw(row.accuracy), 'Faltante Bs': row.shortageCost, 'Sobrante Bs': row.surplusCost })),
      Tipos_diferencia: report.causes.byType.map(row => ({ Tipo: row.label, 'Líneas': row.lines, Unidades: row.units, 'Monto Bs': row.cost })),
      Motivos: report.causes.reasons.map(row => ({ Motivo: row.reason, 'Líneas': row.lines, 'Monto Bs': row.cost })),
      Top_diferencias: report.topDifferences.map(row => ({ 'Código': row.sku, 'Descripción': row.description, Centro: row.center, 'Almacén': row.warehouse, 'Ubicación': row.location, ABC: row.abc, Sistema: row.system, Diferencia: row.difference, 'Monto Bs': row.cost, 'Justificación': row.justification || '' })),
      Recurrentes: report.recurrent.map(row => ({ 'Código': row.sku, 'Descripción': row.description, Inventarios: row.times, Centros: row.centers, 'Monto Bs': row.cost })),
      Auxiliares: report.workers.map(row => ({ Auxiliar: row.worker, Centro: row.center, 'Líneas': row.lines, Exactas: row.exact, 'Confiabilidad %': raw(row.accuracy), 'Primer intento %': raw(row.firstPass), Rectificaciones: row.reEdits, 'Calificación': row.rating })),
      Duraciones: report.durations.map(row => ({ Inventario: row.inventory, Centro: row.center, Inicio: row.start, 'Último registro': row.end, 'Duración': row.time, Horas: raw(row.hours), 'Observación': row.forced }))
    };
  }

  window.ReportCenterDocument = { render, workbook, fileName, fmt, KIND_LABELS, TYPE_LABELS };
})();
