// Administrative report built exclusively from the frozen dashboard snapshot.
window.DetailedMetricsReport = {
  render(inv, metrics) {
    const s = metrics.summary || {}, f = metrics.filters || {};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const number = (...values) => {
      for (const value of values) if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
      return null;
    };
    const fmt = value => value === null ? 'No disponible' : value.toLocaleString('es-BO', { maximumFractionDigits: 2 });
    const money = value => value === null ? 'No disponible' : `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const pct = value => value === null ? 'No disponible' : `${value.toFixed(2)}%`;
    const diff = item => number(item.diferenciaFinal, item.diferencia);
    const cost = item => number(item.costoDiferenciaFinal, item.costoDiferencia);
    const rows = (metrics.discrepanciesList || []).filter(item => item && typeof item === 'object');
    const shortages = rows.filter(item => diff(item) < 0).sort((a, b) => Math.abs(cost(b) || 0) - Math.abs(cost(a) || 0));
    const surpluses = rows.filter(item => diff(item) > 0);
    const resolved = rows.filter(item => item.estaSubsanado && diff(item) === 0);
    const damaged = rows.filter(item => number(item.malEstado) > 0);
    const pending = rows.filter(item => diff(item) !== null && diff(item) !== 0);
    const lines = number(s.totalItemsAudited), units = number(s.totalAuditedSystemUnits, s.eriItems?.unitsTotal);
    const skus = number(s.totalSkusAudited), value = number(s.totalAuditedSystemValue, s.eriMonetario?.totalSystemValue);
    const indicators = [
      ['ERI CANTIDAD DE ÍTEMS (PRINCIPAL)', number(s.eriItemInicial, s.eriItems?.inicial), number(s.eriItemFinal, s.eriItems?.final, s.eriPercent), `${fmt(number(s.itemsCuadradosFinalUnits, s.eriItems?.unitsExactFinal))} de ${fmt(units)} existencias conformes`],
      ['ERI DE SKU (CÓDIGOS)', number(s.eriSkuInicial, s.eriSku?.inicial), number(s.eriSkuFinal, s.eriSku?.final), `${fmt(number(s.totalSkusExactFinal, s.eriSku?.exactFinal))} de ${fmt(skus)} códigos exactos`],
      ['ERI MONETARIO (VALOR)', number(s.eriMonetarioInicial, s.eriMonetario?.inicial), number(s.eriMonetarioFinal, s.eriMonetario?.final), `Valor patrimonial auditado: ${money(value)}`]
    ];
    const sum = (list, getter) => list.reduce((total, item) => total + (getter(item) || 0), 0);
    const deficit = number(s.faltantesFinal?.cost) ?? Math.abs(sum(shortages, cost));
    const surplus = number(s.sobrantesFinal?.cost) ?? sum(surpluses, cost);
    const impact = number(s.impactoFinancieroFinal, s.impactoFinanciero?.finalAbsoluteDiffCost) ?? sum(pending, item => Math.abs(cost(item) || 0));
    const center = f.center || inv.center || 'TODOS';
    const warehouses = [...new Set(rows.map(item => item.almacen).filter(Boolean))].join(', ') || 'No especificados';
    const period = f.startDate || f.endDate ? `${f.startDate || 'Inicio'} a ${f.endDate || 'Actualidad'}` : (f.period === 'TODO' || !f.period ? 'Todo el histórico' : f.period);
    const issued = new Date().toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'long' });
    const pctLines = count => lines > 0 ? `${(count / lines * 100).toFixed(1)}%` : 'No disponible';
    const table = (headers, body, widths = []) => `<table>${widths.length ? `<colgroup>${widths.map(width => `<col style="width:${width}%">`).join('')}</colgroup>` : ''}<thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
    const title = (text, critical = false) => `<h2${critical ? ' class="critical"' : ''}>${text}</h2>`;
    const fullData = lines !== null && lines > 0 && indicators.every(item => item[2] !== null);
    const meets = fullData && indicators.every(item => item[2] >= 95);
    const assessment = !fullData ? 'DATOS INSUFICIENTES' : meets ? 'META DE EXACTITUD CUMPLIDA' : 'REQUIERE SEGUIMIENTO';
    const frame = (heading, content) => `<section class="detail-page">${heading}${content}</section>`;
    const page1 = frame(`<header class="detail-header"><span class="detail-logo">NIBOL</span><div><h1>INFORME ADMINISTRATIVO • CONTROL DE INVENTARIO<br>${esc(f.type || inv.type || 'CÍCLICO')}</h1><p>NIBOL MULTIMARCAS • CENTRO ${esc(center)} | AUDITORÍA Y GESTIÓN DE STOCK</p></div></header>`, `
      <div class="detail-meta"><span><b>Documento:</b><br>${esc(inv.id || 'CONSOLIDADO')}</span><span><b>Centro:</b><br>${esc(center)}</span><span><b>Emisión:</b><br>${esc(issued)}</span><span><b>Alcance:</b><br>${fmt(units)} existencias<br>${fmt(lines)} líneas / ${fmt(skus)} SKU</span><span><b>Evaluación:</b><br><strong class="${meets ? 'green' : 'red'}">${assessment}</strong></span></div>
      <div class="detail-callout"><h3>Resumen Gerencial de Auditoría • Los 3 ERI Oficiales</h3><p>La auditoría evaluó <b>${fmt(units)} existencias de sistema (${fmt(lines)} líneas y ${fmt(skus)} códigos SKU)</b>. El ERI principal pasó de <b>${pct(indicators[0][1])}</b> a <b>${pct(indicators[0][2])}</b>; el ERI de SKU alcanzó <b>${pct(indicators[1][2])}</b> y el ERI monetario <b>${pct(indicators[2][2])}</b>, sobre un valor patrimonial de <b>${money(value)}</b>. Se registran <b>${shortages.length} líneas con faltantes</b> por ${money(deficit)} y <b>${surpluses.length} con sobrantes</b> por ${money(surplus)}. El impacto absoluto de diferencias es ${money(impact)}.</p><p class="detail-note">Almacenes identificados en las discrepancias: ${esc(warehouses)}. Período: ${esc(period)}. ${esc(inv.name || '')}</p></div>
      <div class="detail-kpis">${indicators.map((item, i) => `<article class="tone-${i}"><h3>${item[0]}</h3><strong>${pct(item[2])}</strong><b>Inicial: ${pct(item[1])}<br>Final: ${pct(item[2])}</b><p>${item[3]}</p></article>`).join('')}<article class="tone-3"><h3>IMPACTO POR FALTANTES</h3><strong>(${money(deficit)})</strong><b>${shortages.length} líneas con faltante</b><p>Sujeto a validación y autorización de regularización contable.</p></article></div>
      <div class="detail-callout"><h3>Alcance y lectura del informe</h3><p>El ERI de cantidad compara existencias; el ERI de SKU compara códigos y el ERI monetario compara el valor patrimonial. Sus denominadores son diferentes. Las diferencias se toman de la última etapa disponible del conteo. La evaluación usa la referencia de 95% del modelo; este documento no acredita una aprobación administrativa.</p></div>`);
    const exactFinal = number(s.itemsCuadradosFinal, s.eriItems?.linesExactFinal);
    const exactInitial = number(s.itemsCuadrados1erConteo, s.eriItems?.linesExactInicial);
    const operational = [
      ['Conforme en el primer conteo', fmt(exactInitial), exactInitial === null ? 'No disponible' : pctLines(exactInitial), 'Inicial', 'Validar trazabilidad del primer conteo', money(0)],
      ['Regularizado tras conteo / justificación', fmt(number(s.subsanadosCount) ?? resolved.length), pctLines(number(s.subsanadosCount) ?? resolved.length), 'Cuadrado', 'Conservar respaldo de la conciliación', money(0)],
      ['Faltante en la última etapa', shortages.length, pctLines(shortages.length), 'Pendiente', 'Verificar causa y solicitar ajuste autorizado', `(${money(deficit)})`],
      ['Sobrante en la última etapa', surpluses.length, pctLines(surpluses.length), 'Pendiente', 'Conciliar ingresos y traspasos', money(surplus)],
      ['Mal estado (puede coexistir con diferencias)', damaged.length, pctLines(damaged.length), 'Revisar', 'Segregar y gestionar baja / garantía', money(number(s.totalDamagedCost, s.impactoFinanciero?.finalDamagedCost))]
    ];
    const reconciliation = title('TABLA 1 • RESUMEN OPERATIVO DE CONCILIACIÓN') + table(['ESTADO / RESULTADO', 'LÍNEAS', '% TOTAL', 'ESTADO', 'ACCIÓN RECOMENDADA', 'IMPACTO (Bs)'], operational.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join(''), [27, 8, 10, 11, 27, 17]) + `<p class="detail-note">${fmt(exactFinal)} líneas conformes al cierre. Las averías y las etapas de conciliación pueden solaparse; no se suman como categorías excluyentes.</p>`;
    const batches = list => list.length ? Array.from({ length: Math.ceil(list.length / 7) }, (_, i) => list.slice(i * 7, i * 7 + 7)) : [[]];
    const itemTable = (list, shortage) => table(['SKU', 'DESCRIPCIÓN', 'ALMACÉN / UBIC.', 'STOCK SIST.', 'FÍSICO FINAL', 'DIF. FINAL', 'IMPACTO (Bs)', 'ACCIÓN PROPUESTA'], list.map(item => {
      const stock = number(item.stockSistema), difference = diff(item);
      const physical = stock === null || difference === null ? null : stock + difference;
      return `<tr><td class="sku">${esc(item.sku)}</td><td>${esc(item.descripcion)}</td><td>${esc(item.almacen || 'No disponible')}<br><small>${esc(item.ubicacion || '')} • ${esc(item.center || center)}</small></td><td class="num">${fmt(stock)}</td><td class="num">${fmt(physical)}</td><td class="num ${shortage ? 'red' : ''}">${fmt(difference)}</td><td class="num ${shortage ? 'red' : ''}">${money(cost(item))}</td><td>${shortage ? 'Validar baja / ajuste contable' : item.estaSubsanado ? 'Conservar evidencia de conciliación' : difference > 0 ? 'Conciliar ingreso / traspaso' : 'Revisar evidencia de avería'}</td></tr>`;
    }).join('') || '<tr><td colspan="8">Sin faltantes en la última etapa disponible.</td></tr>', [15, 20, 14, 7, 7, 7, 14, 16]);
    const pages = [page1];
    batches(shortages).forEach((batch, i) => pages.push(frame('', `${i === 0 ? reconciliation : ''}${title(`TABLA 2 • ÍTEMS CRÍTICOS CON FALTANTES${i ? ' (CONTINUACIÓN)' : ''}`, true)}${itemTable(batch, true)}${i === batches(shortages).length - 1 ? `<div class="detail-total">TOTAL FALTANTES: ${shortages.length} líneas • ${fmt(Math.abs(sum(shortages, diff)))} unidades • (${money(deficit)})</div><div class="detail-advice"><b>Recomendación administrativa:</b> validar documentación y evidencias; remitir a la autoridad responsable la solicitud de ajuste por ${money(deficit)}. La autorización de baja debe registrarse por separado.</div>` : ''}`)));
    const other = rows.filter(item => !(diff(item) < 0));
    if (other.length) batches(other).forEach((batch, i) => pages.push(frame(title(`DETALLE COMPLEMENTARIO • SOBRANTES, CONCILIACIONES Y AVERÍAS${i ? ' (CONTINUACIÓN)' : ''}`), itemTable(batch, false))));
    const svgImage = svg => `<img class="detail-chart" alt="Gráfico de resultados" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
    const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="190" viewBox="0 0 260 190"><rect width="260" height="190" fill="white"/>${body}</svg>`;
    const finalCount = exactFinal ?? Math.max(0, (lines || 0) - pending.length), pendingCount = pending.length;
    const denominator = finalCount + pendingCount;
    const ratio = denominator > 0 ? finalCount / denominator : 0;
    const donut = denominator > 0 ? svgImage(svg(`<circle cx="130" cy="85" r="58" fill="none" stroke="#dc2626" stroke-width="25"/><circle cx="130" cy="85" r="58" fill="none" stroke="#059669" stroke-width="25" stroke-dasharray="${ratio * 364.425} 364.425" transform="rotate(-90 130 85)"/><text x="130" y="84" text-anchor="middle" font-family="Arial" font-size="23" fill="#183554">${(ratio * 100).toFixed(1)}%</text><text x="130" y="102" text-anchor="middle" font-family="Arial" font-size="10">líneas conformes</text><text x="12" y="170" font-family="Arial" font-size="10" fill="#059669">Conformes: ${finalCount}</text><text x="140" y="170" font-family="Arial" font-size="10" fill="#dc2626">Diferencias: ${pendingCount}</text>`)) : '<p>Sin base auditada para representar.</p>';
    const top = shortages.slice(0, 5), maxCost = Math.max(1, ...top.map(item => Math.abs(cost(item) || 0)));
    const bars = top.length ? svgImage(svg(top.map((item, i) => `<text x="5" y="${i * 33 + 17}" font-family="Arial" font-size="9">${esc(String(item.sku || '').slice(0, 22))}</text><rect x="5" y="${i * 33 + 21}" width="${Math.abs(cost(item) || 0) / maxCost * 168}" height="8" fill="#dc2626"/><text x="178" y="${i * 33 + 29}" font-family="Arial" font-size="8">${(Math.abs(cost(item) || 0) / 1000).toFixed(1)} mil</text>`).join(''))) : '<p>Sin faltantes para representar.</p>';
    const eriBars = svgImage(svg(indicators.map((item, i) => `<text x="5" y="${i * 55 + 17}" font-family="Arial" font-size="11">${['Cantidad', 'SKU', 'Monetario'][i]}</text><rect x="5" y="${i * 55 + 22}" width="${Math.min(100, Math.max(0, item[1] || 0)) * 1.8}" height="9" fill="#94a3b8"/><rect x="5" y="${i * 55 + 34}" width="${Math.min(100, Math.max(0, item[2] || 0)) * 1.8}" height="9" fill="#059669"/><text x="192" y="${i * 55 + 42}" font-family="Arial" font-size="9">${pct(item[2])}</text>`).join('') + '<text x="5" y="184" font-family="Arial" font-size="10">Gris: inicial • Verde: final</text>'));
    const strongest = top[0];
    const change = indicators[0][1] === null || indicators[0][2] === null ? null : indicators[0][2] - indicators[0][1];
    const recommendations = [
      pending.length ? `Conciliar ${pending.length} líneas con diferencias mediante reconteo dirigido, revisión de documentos y aprobación del ajuste.` : 'Conservar la evidencia de conteo y conciliación de las líneas conformes.',
      shortages.length ? `Priorizar los ${shortages.length} faltantes por ${money(deficit)}, empezando por los de mayor impacto patrimonial.` : 'Mantener controles periódicos para detectar faltantes oportunamente.',
      ...(surpluses.length ? [`Revisar ingresos y traspasos asociados a las ${surpluses.length} líneas con sobrantes por ${money(surplus)}.`] : []),
      ...(damaged.length ? [`Identificar y segregar las averías en ${damaged.length} líneas; validar garantía o baja autorizada.`] : []),
      ...(number(s.eruPercent) !== null && number(s.eruPercent) < 95 ? [`Revisar señalización y asignación de racks: el ERU informado es ${pct(number(s.eruPercent))}.`] : []),
      'Asignar responsables y fechas para las acciones; documentar su seguimiento antes del cierre administrativo.'
    ];
    pages.push(frame(title('ANÁLISIS GRÁFICO OPERATIVO Y FINANCIERO DE AUDITORÍA'), `
      <div class="detail-graphs"><article><h3 class="blue">1. Distribución del inventario</h3>${donut}<div class="detail-explanation green"><b>Explicación administrativa</b><p>${fmt(exactFinal)} líneas conformes y ${pending.length} líneas con diferencias. La gráfica compara líneas de registro; el ERI principal mostrado en portada usa existencias y puede tener otro porcentaje.</p></div></article><article><h3 class="red">2. Impacto financiero por SKU</h3>${bars}<div class="detail-explanation red"><b>Explicación administrativa</b><p>${strongest ? `El mayor faltante corresponde a ${esc(strongest.sku)} (${esc(strongest.almacen || '')}) por ${money(Math.abs(cost(strongest) || 0))}. Priorizar la validación de esa evidencia y su trazabilidad.` : 'No se identifican faltantes con impacto económico en el detalle disponible.'} La gráfica muestra hasta cinco líneas de mayor impacto.</p></div></article><article><h3 class="green">3. Evolución comparativa de ERI</h3>${eriBars}<div class="detail-explanation blue"><b>Explicación administrativa</b><p>El ERI principal varió ${change === null ? 'sin datos comparables' : `${change >= 0 ? '+' : ''}${change.toFixed(2)} puntos porcentuales`}. ${!fullData ? 'Falta una base completa para emitir evaluación.' : meets ? 'Los tres indicadores alcanzan la referencia de 95%.' : 'Uno o más indicadores quedan por debajo de la referencia de 95%; se requiere seguimiento.'}</p></div></article></div>
      <div class="detail-callout"><h3>Diagnóstico técnico, plan de acción operativo y recomendación de cierre</h3><div class="detail-diagnosis"><article><b>1. Diagnóstico de confiabilidad</b><p>ERI principal: ${pct(indicators[0][2])}. ERI de SKU: ${pct(indicators[1][2])}. ERI monetario: ${pct(indicators[2][2])}. ${assessment}. La base de evaluación corresponde al período y filtros indicados.</p></article><article><b>2. Medidas correctivas en almacén</b><ol>${recommendations.map(text => `<li>${text}</li>`).join('')}</ol></article><article><b>3. Regularización contable</b><p>Faltantes: ${money(deficit)}. Sobrantes: ${money(surplus)}. Impacto neto de diferencias: ${money(surplus - deficit)}; impacto absoluto: ${money(impact)}.</p><p>${pending.length ? 'Solicitar validación y autorización del ajuste al responsable de Finanzas y Control de Gestión. El informe no sustituye ese trámite.' : 'Verificar el respaldo documental y la aprobación formal de cierre.'}</p></article></div></div>
      <div class="detail-signatures"><span>Responsable de conteo<br><small>Nombre / firma / fecha</small></span><span>Encargado de almacén<br><small>Nombre / firma / fecha</small></span><span>Auditoría / Control de gestión<br><small>Nombre / firma / fecha</small></span></div>`));
    return `<style>@media print { @page { size:A4 portrait; margin:10mm; } }</style><div class="detail-report">${pages.map((page, i) => page.replace('</section>', `<footer> NIBOL MULTIMARCAS • ${esc(inv.id || 'CONSOLIDADO')}<span>${i + 1} / ${pages.length}</span></footer></section>`)).join('')}</div>`;
  }
};
