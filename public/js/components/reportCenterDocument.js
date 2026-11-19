// Printable sheets of the report center: executive summary with comparison, centers and trend,
// differences and causes, productivity. The center detail sheets come from ManagementReport.
(function () {
  const KIND_LABELS = { INDIVIDUAL: 'Informe individual', SEMANAL: 'Informe semanal consolidado', MENSUAL: 'Informe mensual consolidado', ANUAL: 'Informe anual' };
  const TYPE_LABELS = { TODOS: 'Todos los tipos', CICLICO: 'Cíclico', BARRIDO: 'Barrido', SEMANAL: 'Semanal', MENSUAL: 'Lubricantes' };
  const SERIES_LABELS = { MENSUAL: 'Evolución por semana del mes', ANUAL: 'Evolución mensual del año' };
  const KPI_ROWS = [
    { group: 'Alcance' },
    { key: 'inventories', label: 'Inventarios incluidos', fmt: 'int' },
    { key: 'linesPlanned', label: 'Líneas programadas', fmt: 'int' },
    { key: 'linesAudited', label: 'Líneas contadas', fmt: 'int', better: 'up' },
    { key: 'coverage', label: 'Avance del plan', fmt: 'pct', better: 'up' },
    { key: 'skus', label: 'Códigos evaluados', fmt: 'int' },
    { key: 'units', label: 'Unidades en sistema', fmt: 'int' },
    { key: 'value', label: 'Valor auditado', fmt: 'bs' },
    { group: 'Exactitud' },
    { key: 'eriUnits1', label: 'ERI unidades · 1er conteo', fmt: 'pct', better: 'up' },
    { key: 'eriUnits', label: 'ERI unidades · final', fmt: 'pct', better: 'up' },
    { key: 'eriSku1', label: 'ERI códigos · 1er conteo', fmt: 'pct', better: 'up' },
    { key: 'eriSku', label: 'ERI códigos · final', fmt: 'pct', better: 'up' },
    { key: 'eriMoney1', label: 'ERI monetario · 1er conteo', fmt: 'pct', better: 'up' },
    { key: 'eriMoney', label: 'ERI monetario · final', fmt: 'pct', better: 'up' },
    { key: 'eru', label: 'ERU ubicaciones', fmt: 'pct', better: 'up' },
    { group: 'Diferencias' },
    { key: 'discrepancies1', label: 'Líneas con diferencia · 1er conteo', fmt: 'int', better: 'down' },
    { key: 'discrepancies', label: 'Líneas con diferencia · final', fmt: 'int', better: 'down' },
    { key: 'resolved', label: 'Líneas subsanadas en reconteo', fmt: 'int', better: 'up' },
    { key: 'errorReduction', label: 'Reducción de error por reconteo', fmt: 'pct', better: 'up' },
    { key: 'justifiedShare', label: 'Diferencias finales justificadas', fmt: 'pct', better: 'up' },
    { group: 'Impacto económico' },
    { key: 'shortageUnits', label: 'Faltante · unidades', fmt: 'int', better: 'down' },
    { key: 'shortageCost', label: 'Faltante valorizado', fmt: 'bs', better: 'down' },
    { key: 'surplusUnits', label: 'Sobrante · unidades', fmt: 'int', better: 'down' },
    { key: 'surplusCost', label: 'Sobrante valorizado', fmt: 'bs', better: 'down' },
    { key: 'netImpact', label: 'Impacto neto (sobrante − faltante)', fmt: 'bs' },
    { key: 'absImpact', label: 'Impacto absoluto', fmt: 'bs', better: 'down' },
    { key: 'impact1', label: 'Impacto absoluto · 1er conteo', fmt: 'bs', better: 'down' },
    { key: 'impactShare', label: 'Impacto sobre valor auditado', fmt: 'pct2', better: 'down' },
    { key: 'damagedCost', label: 'Mal estado valorizado', fmt: 'bs', better: 'down' },
    { group: 'Productividad' },
    { key: 'hours', label: 'Horas de conteo (inventarios de un día)', fmt: 'dec' },
    { key: 'linesPerHour', label: 'Líneas por hora (inventarios de un día)', fmt: 'dec', better: 'up' }
  ];
  const CARDS = [
    { key: 'eriUnits', label: 'ERI unidades', fmt: 'pct', better: 'up', level: true },
    { key: 'eriSku', label: 'ERI códigos', fmt: 'pct', better: 'up', level: true },
    { key: 'eriMoney', label: 'ERI monetario', fmt: 'pct', better: 'up', level: true },
    { key: 'eru', label: 'ERU ubicaciones', fmt: 'pct', better: 'up', level: true },
    { key: 'absImpact', label: 'Impacto absoluto', fmt: 'bs', better: 'down' },
    { key: 'netImpact', label: 'Impacto neto', fmt: 'bs' },
    { key: 'discrepancies', label: 'Líneas con diferencia', fmt: 'int', better: 'down' },
    { key: 'coverage', label: 'Avance del plan', fmt: 'pct', better: 'up' }
  ];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const n = value => isNum(value) ? Number(value) : 0;
  const locale = (value, digits) => Number(value).toLocaleString('es-BO', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  function fmt(value, kind) {
    if (!isNum(value)) return '—';
    if (kind === 'int') return locale(Math.round(value), 0);
    if (kind === 'pct') return `${locale(value, 1)}%`;
    if (kind === 'pct2') return `${locale(value, 2)}%`;
    if (kind === 'bs') return `Bs ${locale(value, 2)}`;
    return locale(value, 1);
  }
  function delta(current, previous, kind, better) {
    if (!isNum(current) || !isNum(previous)) return { text: '—', cls: 'rc-flat' };
    const diff = Number(current) - Number(previous);
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    const size = Math.abs(diff);
    const text = kind === 'pct' || kind === 'pct2' ? `${sign}${locale(size, kind === 'pct2' ? 2 : 1)} pp`
      : kind === 'bs' ? `${sign}Bs ${locale(size, 2)}` : kind === 'int' ? `${sign}${locale(Math.round(size), 0)}` : `${sign}${locale(size, 1)}`;
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '=';
    const cls = !better || Math.abs(diff) < 1e-9 ? 'rc-flat' : (diff > 0) === (better === 'up') ? 'rc-good' : 'rc-bad';
    return { text: `${arrow} ${text}`, cls };
  }
  const level = value => window.ManagementReport?.level ? window.ManagementReport.level(isNum(value) ? Number(value) : null) : null;
  const chip = lvl => lvl ? `<span class="mr-chip lvl-${lvl.key}">${lvl.icon} ${esc(lvl.label.toUpperCase())}</span>` : '';
  const bar = (value, max, size, color) => {
    const width = max > 0 && isNum(value) ? Math.max(value > 0 ? 2 : 0, Number(value) / max * size) : 0;
    return `<i style="display:inline-block;height:10px;width:${width.toFixed(1)}px;background:${color};border-radius:0 3px 3px 0;vertical-align:-1px;margin-right:6px"></i>`;
  };
  const eriBar = value => isNum(value) ? `${bar(Math.max(0, Number(value) - 80), 20, 90, '#2a78d6')}${fmt(value, 'pct')}` : '—';
  const sheet = (title, subtitle, right, body, footer) => `<section class="mr-sheet rc-sheet" aria-label="${esc(title)}"><header class="mr-band"><b>${esc(title)}<small>${esc(subtitle)}</small></b><span>${esc(right)}</span></header><div class="mr-body">${body}</div><footer class="mr-foot"><span>${esc(footer)}</span><span class="mr-page-no"></span></footer></section>`;
  const block = (title, table, note) => `<div class="rc-block"><h3>${esc(title)}</h3>${table}${note ? `<p class="mr-hint">${esc(note)}</p>` : ''}</div>`;
  const table = (head, rows, empty, foot) => rows.length
    ? `<table data-split><thead><tr>${head.map(([label, cls]) => `<th class="${cls || ''}">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${foot || ''}</table>`
    : `<p class="mr-more">${esc(empty)}</p>`;
  const td = (value, cls) => `<td class="${cls || ''}">${value}</td>`;

  function values(report) {
    return { ...report.kpis, justifiedShare: report.causes?.justifiedShare ?? null };
  }

  function summarySheet(report, head) {
    const current = values(report);
    const prev = report.previous?.kpis || null;
    const cards = CARDS.map(card => {
      const d = prev ? delta(current[card.key], prev[card.key], card.fmt, card.better) : null;
      return `<div class="mr-kpi rc-kpi"><div class="mr-kpi-top"><span>${esc(card.label)}</span>${card.level ? chip(level(current[card.key])) : ''}</div><strong>${fmt(current[card.key], card.fmt)}</strong>${prev ? `<span class="rc-delta ${d.cls}">${d.text} <small>vs ${esc(fmt(prev[card.key], card.fmt))}</small></span>` : '<span class="rc-delta rc-flat">Sin periodo anterior</span>'}</div>`;
    }).join('');
    const rows = KPI_ROWS.map(row => {
      if (row.group) return `<tr class="rc-group-row"><td colspan="4">${esc(row.group)}</td></tr>`;
      const d = prev ? delta(current[row.key], prev[row.key], row.fmt, row.better) : { text: '—', cls: 'rc-flat' };
      return `<tr>${td(esc(row.label))}${td(fmt(current[row.key], row.fmt), 'num')}${td(prev ? fmt(prev[row.key], row.fmt) : '—', 'num')}${td(d.text, `num ${d.cls}`)}</tr>`;
    });
    // Two balanced columns, always cut at the start of a group.
    const cut = rows.map((row, i) => row.includes('rc-group-row') ? i : -1).filter(i => i > 0)
      .reduce((best, i) => Math.max(i, rows.length - i) < Math.max(best, rows.length - best) ? i : best, rows.length);
    const kpiTable = list => `<table data-split class="rc-kpi-table"><thead><tr><th>Indicador</th><th class="num">Actual</th><th class="num">${esc(report.previous ? report.previous.label : 'Anterior')}</th><th class="num">Variación</th></tr></thead><tbody>${list.join('')}</tbody></table>`;
    const warn = report.sourceIssues ? `<p class="rc-warn">${report.sourceIssues} archivo(s) sin validar quedaron fuera del cálculo. Revíselos en Métricas antes de distribuir el informe.</p>` : '';
    const body = `${warn}<div class="mr-row mr-c4 rc-cards">${cards}</div><div class="mr-row mr-c2 rc-kpi-cols"><div>${kpiTable(rows.slice(0, cut))}</div><div>${kpiTable(rows.slice(cut))}</div></div>`;
    return sheet(head.title, head.subtitle, head.right, body, head.footer);
  }

  function centersSheet(report, head) {
    const centerRows = report.centers.map((c, i) => `<tr>${td(i + 1, 'num')}${td(esc(c.name))}${td(eriBar(c.eriUnits))}${td(fmt(c.eriSku, 'pct'), 'num')}${td(fmt(c.eriMoney, 'pct'), 'num')}${td(fmt(c.eru, 'pct'), 'num')}${td(fmt(c.lines, 'int'), 'num')}${td(fmt(c.discrepancies, 'int'), 'num')}${td(fmt(c.shortageCost, 'bs'), 'num')}${td(fmt(c.surplusCost, 'bs'), 'num')}${td(fmt(c.absImpact, 'bs'), 'num')}</tr>`);
    const centers = block('Ranking de centros por ERI de unidades', table([['#', 'num'], ['Centro'], ['ERI unidades'], ['ERI códigos', 'num'], ['ERI monetario', 'num'], ['ERU', 'num'], ['Líneas', 'num'], ['Con diferencia', 'num'], ['Faltante', 'num'], ['Sobrante', 'num'], ['Impacto abs.', 'num']], centerRows, 'Sin centros con datos.'), 'La barra del ERI parte en 80%: cada tramo visible es la distancia sobre ese piso.');
    let trend = '';
    if (SERIES_LABELS[report.kind]) {
      const maxImpact = Math.max(0, ...report.series.map(row => n(row.absImpact)));
      const seriesRows = report.series.map(row => `<tr>${td(esc(row.label))}${td(fmt(row.inventories, 'int'), 'num')}${td(eriBar(row.eriUnits))}${td(fmt(row.eriMoney, 'pct'), 'num')}${td(fmt(row.eru, 'pct'), 'num')}${td(fmt(row.discrepancies, 'int'), 'num')}${td(fmt(row.shortageCost, 'bs'), 'num')}${td(fmt(row.surplusCost, 'bs'), 'num')}${td(`${bar(row.absImpact, maxImpact, 90, '#c9373f')}${fmt(row.absImpact, 'bs')}`)}</tr>`);
      trend = block(SERIES_LABELS[report.kind], table([['Periodo'], ['Inventarios', 'num'], ['ERI unidades'], ['ERI monetario', 'num'], ['ERU', 'num'], ['Con diferencia', 'num'], ['Faltante', 'num'], ['Sobrante', 'num'], ['Impacto absoluto']], seriesRows, 'Sin periodos con inventarios cerrados.'));
    }
    const abcRows = report.abc.map(row => `<tr>${td(`Clase ${row.class}`)}${td(fmt(row.lines, 'int'), 'num')}${td(fmt(row.exact, 'int'), 'num')}${td(fmt(row.accuracy, 'pct'), 'num')}${td(fmt(row.shortageCost, 'bs'), 'num')}${td(fmt(row.surplusCost, 'bs'), 'num')}${td(fmt(row.absImpact, 'bs'), 'num')}</tr>`);
    const abc = block('Exactitud por clase ABC', table([['Clase'], ['Líneas', 'num'], ['Exactas', 'num'], ['Exactitud', 'num'], ['Faltante', 'num'], ['Sobrante', 'num'], ['Impacto abs.', 'num']], abcRows, 'Sin clasificación ABC.'));
    return sheet('Centros y evolución', head.subtitle, head.right, `${trend}${centers}${abc}`, head.footer);
  }

  function differencesSheet(report, head) {
    const totalCost = report.causes.byType.reduce((sum, row) => sum + n(row.cost), 0);
    const typeRows = report.causes.byType.map(row => `<tr>${td(esc(row.label))}${td(fmt(row.lines, 'int'), 'num')}${td(fmt(row.units, 'int'), 'num')}${td(fmt(row.cost, 'bs'), 'num')}${td(`${bar(row.cost, totalCost, 120, '#17305f')}${fmt(totalCost > 0 ? row.cost / totalCost * 100 : null, 'pct')}`)}</tr>`);
    const reasonRows = report.causes.reasons.map(row => `<tr>${td(esc(row.reason), 'mr-wrap')}${td(fmt(row.lines, 'int'), 'num')}${td(fmt(row.cost, 'bs'), 'num')}</tr>`);
    const topRows = report.topDifferences.map(row => `<tr>${td(esc(row.sku), 'mr-nowrap')}${td(esc(row.description), 'mr-wrap')}${td(esc(row.center))}${td(esc(row.location))}${td(esc(row.abc))}${td(fmt(row.system, 'int'), 'num')}${td(fmt(row.difference, 'int'), 'num')}${td(fmt(row.cost, 'bs'), 'num')}${td(esc(row.justification || 'Sin justificación'), 'mr-wrap')}</tr>`);
    const recurrentRows = report.recurrent.map(row => `<tr>${td(esc(row.sku), 'mr-nowrap')}${td(esc(row.description), 'mr-wrap')}${td(fmt(row.times, 'int'), 'num')}${td(esc(row.centers), 'mr-wrap')}${td(fmt(row.cost, 'bs'), 'num')}</tr>`);
    const body = `<div class="mr-row mr-c2">${block('Diferencias por tipo', table([['Tipo'], ['Líneas', 'num'], ['Unidades', 'num'], ['Monto', 'num'], ['Participación']], typeRows, 'Sin diferencias en el periodo.'))}${block('Motivos registrados en las diferencias finales', table([['Motivo'], ['Líneas', 'num'], ['Monto', 'num']], reasonRows, 'Sin diferencias finales.'))}</div>`
      + block('Top 15 diferencias finales por monto', table([['Código'], ['Descripción'], ['Centro'], ['Ubicación'], ['ABC'], ['Sistema', 'num'], ['Diferencia', 'num'], ['Monto', 'num'], ['Justificación']], topRows, 'Sin diferencias finales.'))
      + block('Códigos con diferencia recurrente', table([['Código'], ['Descripción'], ['Inventarios', 'num'], ['Centros'], ['Monto acumulado', 'num']], recurrentRows, 'Ningún código repitió diferencia en más de un inventario del periodo.'));
    return sheet('Diferencias y causas', head.subtitle, head.right, body, head.footer);
  }

  function productivitySheet(report, head) {
    const workerRows = report.workers.map(row => `<tr>${td(esc(row.worker))}${td(esc(row.center))}${td(fmt(row.lines, 'int'), 'num')}${td(fmt(row.exact, 'int'), 'num')}${td(fmt(row.accuracy, 'pct'), 'num')}${td(fmt(row.firstPass, 'pct'), 'num')}${td(fmt(row.reEdits, 'int'), 'num')}${td(esc(row.rating))}</tr>`);
    const durationRows = report.durations.map(row => `<tr>${td(esc(row.inventory), 'mr-wrap')}${td(esc(row.center))}${td(esc(row.start))}${td(esc(row.end))}${td(esc(row.time))}${td(esc(row.forced || '—'), 'mr-wrap')}</tr>`);
    const body = block('Desempeño por auxiliar', table([['Auxiliar'], ['Centro'], ['Líneas', 'num'], ['Exactas', 'num'], ['Confiabilidad', 'num'], ['Al primer intento', 'num'], ['Rectificaciones', 'num'], ['Calificación']], workerRows, 'Sin conteos registrados por auxiliar.'))
      + block('Duración de cada inventario', table([['Inventario'], ['Centro'], ['Inicio'], ['Último registro'], ['Duración'], ['Observación']], durationRows, 'Sin registros de tiempo.'));
    return sheet('Productividad del conteo', head.subtitle, head.right, body, head.footer);
  }

  function headOf(report) {
    const date = new Date(report.generatedAt);
    const stamp = Number.isFinite(date.getTime()) ? date.toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' }) : '';
    return {
      title: `${KIND_LABELS[report.kind]} · ${report.label}`,
      subtitle: `${report.centerName} · ${TYPE_LABELS[report.type] || report.type}`,
      right: `Generado ${stamp}${report.generatedBy ? ` por ${report.generatedBy}` : ''}`,
      footer: report.previous ? `Fuente: archivos finales validados · Comparado con ${report.previous.label}` : 'Fuente: archivos finales validados · Sin periodo anterior comparable'
    };
  }

  function fileName(report) {
    const safe = value => String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `Informe_${safe(report.kind)}_${safe(report.label)}_${safe(report.center)}_${new Date().toISOString().slice(0, 10)}`;
  }

  function render(report) {
    const head = headOf(report);
    const own = [summarySheet(report, head), centersSheet(report, head), differencesSheet(report, head), productivitySheet(report, head)].join('');
    const inv = report.selectedInventory || { id: `${report.kind}-${report.ref}`, name: report.label, center: report.center, type: report.type };
    const detail = window.ManagementReport?.render ? window.ManagementReport.render(inv, report.metrics) : '<div class="mr-report"></div>';
    return detail.includes('<div class="mr-report">') ? detail.replace('<div class="mr-report">', `<div class="mr-report">${own}`) : `<div class="mr-report">${own}</div>`;
  }

  // Same figures for Excel: one sheet per section.
  function workbook(report) {
    const current = values(report), prev = report.previous?.kpis || {};
    const raw = value => isNum(value) ? Number(value) : '';
    const summary = KPI_ROWS.filter(row => !row.group).map(row => ({
      Indicador: row.label, Actual: raw(current[row.key]), [report.previous?.label || 'Anterior']: raw(prev[row.key]),
      'Variación': isNum(current[row.key]) && isNum(prev[row.key]) ? Number(current[row.key]) - Number(prev[row.key]) : ''
    }));
    return {
      Resumen: summary,
      Centros: report.centers.map((c, i) => ({ '#': i + 1, Centro: c.name, 'ERI unidades %': raw(c.eriUnits), 'ERI códigos %': raw(c.eriSku), 'ERI monetario %': raw(c.eriMoney), 'ERU %': raw(c.eru), 'Líneas': c.lines, 'Con diferencia': c.discrepancies, 'Faltante Bs': c.shortageCost, 'Sobrante Bs': c.surplusCost, 'Impacto abs Bs': c.absImpact })),
      Evolucion: report.series.map(row => ({ Periodo: row.label, Inventarios: row.inventories, 'ERI unidades %': raw(row.eriUnits), 'ERI monetario %': raw(row.eriMoney), 'ERU %': raw(row.eru), 'Con diferencia': row.discrepancies, 'Faltante Bs': row.shortageCost, 'Sobrante Bs': row.surplusCost, 'Impacto abs Bs': row.absImpact })),
      ABC: report.abc.map(row => ({ Clase: row.class, 'Líneas': row.lines, Exactas: row.exact, 'Exactitud %': raw(row.accuracy), 'Faltante Bs': row.shortageCost, 'Sobrante Bs': row.surplusCost, 'Impacto abs Bs': row.absImpact })),
      Tipos_diferencia: report.causes.byType.map(row => ({ Tipo: row.label, 'Líneas': row.lines, Unidades: row.units, 'Monto Bs': row.cost })),
      Motivos: report.causes.reasons.map(row => ({ Motivo: row.reason, 'Líneas': row.lines, 'Monto Bs': row.cost })),
      Top_diferencias: report.topDifferences.map(row => ({ 'Código': row.sku, 'Descripción': row.description, Centro: row.center, 'Almacén': row.warehouse, 'Ubicación': row.location, ABC: row.abc, Sistema: row.system, Diferencia: row.difference, 'Monto Bs': row.cost, 'Justificación': row.justification })),
      Recurrentes: report.recurrent.map(row => ({ 'Código': row.sku, 'Descripción': row.description, Inventarios: row.times, Centros: row.centers, 'Monto Bs': row.cost })),
      Auxiliares: report.workers.map(row => ({ Auxiliar: row.worker, Centro: row.center, 'Líneas': row.lines, Exactas: row.exact, 'Confiabilidad %': raw(row.accuracy), 'Primer intento %': raw(row.firstPass), Rectificaciones: row.reEdits, 'Calificación': row.rating })),
      Duraciones: report.durations.map(row => ({ Inventario: row.inventory, Centro: row.center, Inicio: row.start, 'Último registro': row.end, 'Duración': row.time, Horas: raw(row.hours), 'Observación': row.forced }))
    };
  }

  window.ReportCenterDocument = { render, workbook, fileName, fmt, delta, KIND_LABELS, TYPE_LABELS };
})();
