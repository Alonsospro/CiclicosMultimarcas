// Administrative report built exclusively from the frozen dashboard snapshot.
window.DetailedMetricsReport = {
  // Match the actual A4 printable area (210 x 297 mm, 6 mm margins).
  exportWidth: 198 * 96 / 25.4,
  paginate(container) {
    const report = container.querySelector('.detail-report');
    if (!report) return;
    const width = report.getBoundingClientRect().width;
    if (!width) return;
    const maxHeight = width * 285 / 198 - 24;
    // Always reflow the original content when preview/export widths differ.
    if (!report.paginationSource) report.paginationSource = Array.from(report.children).map(node => node.cloneNode(true));
    else report.replaceChildren(...report.paginationSource.map(node => node.cloneNode(true)));
    const original = Array.from(report.querySelectorAll('.detail-page'));
    const documentLabel = original[0]?.querySelector('footer')?.firstChild?.textContent || 'NIBOL MULTIMARCAS';
    const output = [];
    const createPage = () => {
      const page = document.createElement('section');
      page.className = 'detail-page';
      const footer = document.createElement('footer');
      footer.appendChild(document.createTextNode(documentLabel));
      footer.appendChild(document.createElement('span'));
      page.appendChild(footer);
      report.appendChild(page);
      output.push(page);
      return page;
    };
    for (const source of original) {
      let page = createPage();
      const children = Array.from(source.children).filter(child => child.tagName !== 'FOOTER');
      const insert = node => page.insertBefore(node, page.lastElementChild);
      const fits = () => page.getBoundingClientRect().height <= maxHeight;
      const hasContent = () => page.children.length > 1;
      const nextPage = () => { if (hasContent()) page = createPage(); };
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const heading = child.tagName === 'H2' && children[index + 1]?.tagName === 'TABLE' ? child : null;
        const sourceTable = heading ? children[++index] : child.tagName === 'TABLE' ? child : null;
        if (!sourceTable) {
          // Keep titles with the content they introduce.
          const block = document.createElement('div');
          block.className = 'detail-content-block';
          block.appendChild(child);
          if (child.tagName === 'H2' && children[index + 1]) block.appendChild(children[++index]);
          insert(block);
          if (!fits() && page.children.length > 2) {
            block.remove(); nextPage(); insert(block);
          }
          continue;
        }
        const tail = [];
        while (children[index + 1]?.matches('.detail-total, .detail-advice, .detail-note')) tail.push(children[++index]);
        const block = document.createElement('div');
        block.className = 'detail-table-block';
        if (heading) block.appendChild(heading);
        block.appendChild(sourceTable);
        tail.forEach(node => block.appendChild(node));
        insert(block);
        if (fits()) continue;
        block.remove();
        // Prefer a complete table on a fresh page when it fits there.
        nextPage(); insert(block);
        if (fits()) continue;
        block.remove();
        const rows = Array.from(sourceTable.querySelectorAll('tbody > tr'));
        let segment, table;
        const startSegment = continued => {
          segment = document.createElement('div');
          segment.className = 'detail-table-block';
          if (heading) {
            const label = heading.cloneNode(true);
            if (continued) label.textContent += ' (CONTINUACIÓN)';
            segment.appendChild(label);
          }
          table = sourceTable.cloneNode(true);
          table.querySelector('tbody').replaceChildren();
          segment.appendChild(table); insert(segment);
        };
        startSegment(false);
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          const body = table.querySelector('tbody');
          body.appendChild(row);
          const last = rowIndex === rows.length - 1;
          if (last) tail.forEach(node => segment.appendChild(node));
          if (fits()) continue;
          row.remove();
          if (last) tail.forEach(node => node.remove());
          // Leave at least the last row with its totals and recommendations.
          if (!body.children.length) segment.remove();
          nextPage(); startSegment(true);
          table.querySelector('tbody').appendChild(row);
          if (last) tail.forEach(node => segment.appendChild(node));
          // Exceptionally long descriptions may need explicit continuation rows.
          // Split text rather than clipping or shrinking the entire table.
          while (!fits()) {
            if (last) tail.forEach(node => node.remove());
            if (fits()) { nextPage(); tail.forEach(insert); break; }
            const cells = Array.from(row.cells);
            const parts = cells.map(cell => cell.textContent.split(/\s+/).filter(Boolean));
            const longest = Math.max(...parts.map(words => words.length));
            if (longest < 2) throw new Error('Una fila del informe excede el espacio imprimible. Revise el contenido.');
            let low = 1, high = longest - 1, best = 0;
            const apply = limit => cells.forEach((cell, i) => { cell.textContent = parts[i].slice(0, limit).join(' '); });
            while (low <= high) {
              const mid = Math.floor((low + high) / 2); apply(mid);
              if (fits()) { best = mid; low = mid + 1; } else high = mid - 1;
            }
            if (!best) throw new Error('No se pudo ajustar una fila al área imprimible del informe.');
            apply(best);
            const continuation = row.cloneNode(true);
            Array.from(continuation.cells).forEach((cell, i) => {
              cell.textContent = parts[i].slice(best).join(' ');
              if (!cell.textContent && i === 0) cell.textContent = `${cells[0].textContent} (continuación)`;
            });
            nextPage(); startSegment(true);
            table.querySelector('tbody').appendChild(continuation);
            // Process the remaining text through the same pagination path.
            rows.splice(rowIndex + 1, 0, continuation);
            if (last) tail.forEach(node => node.remove());
            break;
          }
        }
      }
      source.remove();
    }
    const pages = output.filter(page => {
      if (page.children.length > 1) return true;
      page.remove();
      return false;
    });
    pages.forEach((page, i) => { page.querySelector('footer span').textContent = `${i + 1} / ${pages.length}`; });
  },
  reconciliationRows(summary) {
    const numeric = (...values) => {
      for (const value of values) if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) return Number(value);
      return 0;
    };
    const count = value => Math.max(0, Math.round(numeric(value)));
    const percent = value => Math.min(100, Math.max(0, value)).toFixed(2);
    const units = count(numeric(summary.totalAuditedSystemUnits, summary.totalItemsAuditedUnits, summary.eriItems?.unitsTotal, summary.totalItemsAudited));
    const skus = count(summary.totalSkusAudited ?? summary.totalItemsAudited);
    const initial = count(numeric(summary.itemsCuadrados1erConteo, summary.totalSkusExactFirstCount));
    const final = count(numeric(summary.itemsCuadradosFinal, summary.totalSkusExactFinal));
    const unitInitial = Math.min(units, count(numeric(summary.itemsCuadrados1erUnits, summary.eriItems?.unitsExactInicial, summary.totalAuditedSystemUnits !== undefined && summary.eriItemInicial !== undefined ? units * Number(summary.eriItemInicial) / 100 : undefined)));
    const unitFinal = Math.min(units, count(numeric(summary.itemsCuadradosFinalUnits, summary.eriItems?.unitsExactFinal, summary.totalAuditedSystemUnits !== undefined && summary.eriItemFinal !== undefined ? units * Number(summary.eriItemFinal) / 100 : undefined)));
    const initialEri = percent(numeric(summary.eriItemInicial, summary.itemsCuadrados1erPercent, units > 0 ? unitInitial / units * 100 : 0));
    const finalEri = percent(numeric(summary.eriItemFinal, summary.itemsCuadradosFinalPercent, summary.eriPercent, units > 0 ? unitFinal / units * 100 : 0));
    const initialDiff = count(numeric(summary.discrepancias1erConteo, Math.max(0, skus - initial)));
    const finalDiff = count(numeric(summary.discrepanciasFinal, Math.max(0, skus - final)));
    return [['Existencias auditadas', units, 'Unidades en alcance'], ['SKU auditados', skus, 'Códigos revisados'], ['Registros conformes · inicial', initial, `${initialEri}% de exactitud`], ['Registros con diferencia · inicial', initialDiff, 'Revisados en conciliación'], ['Registros conformes · final', final, `${finalEri}% de exactitud`], ['Registros pendientes · final', finalDiff, finalDiff ? 'Requieren regularización' : 'Sin pendientes']];
  },
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
    const damagedQty = item => number(item.malEstadoFinal, item.malEstado);
    const damagedValue = item => number(item.costoMalEstadoFinal, item.costoMalEstado) ?? (damagedQty(item) !== null && number(item.costoUnitario) !== null ? damagedQty(item) * number(item.costoUnitario) : null);
    const damaged = rows.filter(item => damagedQty(item) > 0);
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
    const damagedCost = number(s.totalDamagedCost, s.impactoFinanciero?.finalDamagedCost, s.impactoFinanciero?.damagedCost) ?? sum(damaged, damagedValue);
    const totalImpact = deficit + surplus + damagedCost;
    const eru = number(s.eruPercent) ?? (number(s.totalLocationsEvaluated) > 0 && number(s.exactMatchingLocations) !== null ? s.exactMatchingLocations / s.totalLocationsEvaluated * 100 : null);
    const eruInitial = number(s.eruInicial, s.eruFirstCountPercent);
    const level = value => value === null ? 'unknown' : value >= 95 ? 'good' : value >= 90 ? 'attention' : 'alert';
    const center = f.center || inv.center || 'TODOS';
    const warehouses = [...new Set(rows.map(item => item.almacen).filter(Boolean))].join(', ') || 'No especificados';
    const period = f.startDate || f.endDate ? `${f.startDate || 'Inicio'} a ${f.endDate || 'Actualidad'}` : (f.period === 'TODO' || !f.period ? 'Todo el histórico' : f.period);
    const issued = new Date().toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'long' });
    const table = (headers, body, widths = []) => `<table>${widths.length ? `<colgroup>${widths.map(width => `<col style="width:${width}%">`).join('')}</colgroup>` : ''}<thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
    const title = (text, critical = false) => `<h2${critical ? ' class="critical"' : ''}>${text}</h2>`;
    const fullData = lines !== null && lines > 0 && indicators.every(item => item[2] !== null);
    const meets = fullData && indicators.every(item => item[2] >= 95);
    const assessment = !fullData ? 'DATOS INSUFICIENTES' : meets ? 'META DE EXACTITUD CUMPLIDA' : 'REQUIERE SEGUIMIENTO';
    const frame = (heading, content) => `<section class="detail-page">${heading}${content}</section>`;
    const page1 = frame(`<header class="detail-header"><span class="detail-logo">NIBOL</span><div><h1>INFORME ADMINISTRATIVO • CONTROL DE INVENTARIO<br>${esc(f.type || inv.type || 'CÍCLICO')}</h1><p>NIBOL MULTIMARCAS • CENTRO ${esc(center)} | AUDITORÍA Y GESTIÓN DE STOCK</p></div></header>`, `
      <div class="detail-meta"><span><b>Documento:</b><br>${esc(inv.id || 'CONSOLIDADO')}</span><span><b>Centro:</b><br>${esc(center)}</span><span><b>Emisión:</b><br>${esc(issued)}</span><span><b>Alcance:</b><br>${fmt(units)} existencias<br>${fmt(lines)} líneas / ${fmt(skus)} SKU</span><span><b>Evaluación:</b><br><strong class="${meets ? 'green' : 'red'}">${assessment}</strong></span></div>
      <div class="detail-callout"><h3>Resumen Gerencial de Auditoría • Los 3 ERI Oficiales</h3><p>La auditoría evaluó <b>${fmt(units)} existencias de sistema (${fmt(lines)} líneas y ${fmt(skus)} códigos SKU)</b>. El ERI principal pasó de <b>${pct(indicators[0][1])}</b> a <b>${pct(indicators[0][2])}</b>; el ERI de SKU alcanzó <b>${pct(indicators[1][2])}</b> y el ERI monetario <b>${pct(indicators[2][2])}</b>, sobre un valor patrimonial de <b>${money(value)}</b>. Se registran <b>${shortages.length} líneas con faltantes</b> por ${money(deficit)} y <b>${surpluses.length} con sobrantes</b> por ${money(surplus)}. El impacto absoluto de diferencias es ${money(impact)}.</p><p class="detail-note">Almacenes identificados en las discrepancias: ${esc(warehouses)}. Período: ${esc(period)}. ${esc(inv.name || '')}</p></div>
      <div class="detail-kpis">${indicators.map((item, i) => `<article class="tone-${i}"><h3>${item[0]}</h3><strong>${pct(item[2])}</strong><b>Inicial: ${pct(item[1])}<br>Final: ${pct(item[2])}</b><p>${item[3]}</p></article>`).join('')}<article class="tone-eru"><h3>ERU • EXACTITUD DE UBICACIÓN</h3><strong>${pct(eru)}</strong><b>${s.eruModel === 'LOCATION_CONCENTRATION' ? 'Promedio de concentración por SKU/almacén' : 'Ubicaciones conformes'}</b><p>${s.eruModel === 'LOCATION_CONCENTRATION' ? `${fmt(number(s.totalLocationsEvaluated))} SKU/almacén evaluados · 100% ÷ ubicaciones` : `${fmt(number(s.exactMatchingLocations))} de ${fmt(number(s.totalLocationsEvaluated))} ubicaciones evaluadas`}</p></article></div>
      <div class="detail-money-cards" aria-label="Impactos monetarios"><article><span>SOBRANTES</span><strong>${money(surplus)}</strong></article><article><span>AVERÍAS</span><strong>${money(damagedCost)}</strong></article><article><span>FALTANTES</span><strong>${money(deficit)}</strong></article><article><span>IMPACTO TOTAL</span><strong>${money(totalImpact)}</strong></article></div>
      <div class="detail-callout"><h3>Alcance y lectura del informe</h3><p>El ERI de cantidad compara existencias; el ERI de SKU compara códigos y el ERI monetario compara el valor patrimonial. Sus denominadores son diferentes. Las diferencias se toman de la última etapa disponible del conteo. La evaluación usa la referencia de 95% del modelo; este documento no acredita una aprobación administrativa.</p></div>`);
    const exactFinal = number(s.itemsCuadradosFinal, s.eriItems?.linesExactFinal);
    const operational = this.reconciliationRows(s);
    const reconciliation = `<article class="detail-reconciliation">${title('RESUMEN OPERATIVO DE CONCILIACIÓN')}${table(['Resultado', 'Cantidad', 'Estado'], operational.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join(''), [46, 15, 39])}<div class="detail-reconciliation-impact"><span>Impacto financiero · primer conteo</span><strong>${money(Math.abs(number(s.impactoFinanciero1er, s.impactoFinanciero?.initialAbsoluteDiffCost) ?? 0))}</strong></div><div class="detail-reconciliation-impact"><span>Impacto financiero · cierre final</span><strong>${money(impact)}</strong></div></article>`;
    const batches = list => [list];
    const itemTable = (list, shortage) => table(['SKU', 'DESCRIPCIÓN', 'ALMACÉN / UBIC.', 'STOCK SIST.', 'FÍSICO FINAL', 'DIF. FINAL', 'IMPACTO (Bs)', 'ACCIÓN PROPUESTA'], list.map(item => {
      const stock = number(item.stockSistema), difference = diff(item);
      const physical = number(item.stockFisicoFinal) ?? (stock === null || difference === null ? null : stock + difference);
      return `<tr><td class="sku">${esc(item.sku)}</td><td>${esc(item.descripcion)}</td><td>${esc(item.almacen || 'No disponible')}<br><small>${esc(item.ubicacion || '')} • ${esc(item.center || center)}</small></td><td class="num">${fmt(stock)}</td><td class="num">${fmt(physical)}</td><td class="num ${shortage ? 'red' : ''}">${fmt(difference)}</td><td class="num ${shortage ? 'red' : ''}">${money(cost(item))}</td><td>${shortage ? 'Validar baja / ajuste contable' : item.estaSubsanado ? 'Conservar evidencia de conciliación' : difference > 0 ? 'Conciliar ingreso / traspaso' : 'Revisar evidencia de avería'}</td></tr>`;
    }).join('') || '<tr><td colspan="8">Sin faltantes en la última etapa disponible.</td></tr>', [15, 20, 14, 7, 7, 7, 14, 16]);
    const pages = [page1];
    batches(shortages).forEach((batch, i) => pages.push(frame('', `${i === 0 ? reconciliation : ''}${title(`TABLA 2 • ÍTEMS CRÍTICOS CON FALTANTES${i ? ' (CONTINUACIÓN)' : ''}`, true)}${itemTable(batch, true)}${i === batches(shortages).length - 1 ? `<div class="detail-total">TOTAL FALTANTES: ${shortages.length} líneas • ${fmt(Math.abs(sum(shortages, diff)))} unidades • (${money(deficit)})</div><div class="detail-advice"><b>Recomendación administrativa:</b> validar documentación y evidencias; remitir a la autoridad responsable la solicitud de ajuste por ${money(deficit)}. La autorización de baja debe registrarse por separado.</div>` : ''}`)));
    const surplusTable = list => list.length ? itemTable(list, false) : table(['SKU', 'Descripción', 'Unidades sobrantes', 'Impacto (Bs)'], '<tr><td colspan="4">Sin sobrantes en la última etapa disponible.</td></tr>');
    const damagedTable = list => table(['SKU', 'DESCRIPCIÓN', 'ALMACÉN / UBIC.', 'UNIDADES EN AVERÍA', 'VALOR AVERÍA (Bs)', 'ACCIÓN PROPUESTA'], list.map(item => `<tr><td class="sku">${esc(item.sku)}</td><td>${esc(item.descripcion)}</td><td>${esc(item.almacen || 'No disponible')}<br>${esc(item.ubicacion || '')} • ${esc(item.center || center)}</td><td class="num">${fmt(damagedQty(item))}</td><td class="num red">${money(damagedValue(item))}</td><td>Segregar y validar garantía / baja autorizada</td></tr>`).join('') || '<tr><td colspan="6">Sin averías registradas en la última etapa disponible.</td></tr>', [18, 24, 18, 11, 14, 15]);
    batches(surpluses).forEach((batch, i) => pages.push(frame(title(`TABLA 3 • DETALLE DE SOBRANTES${i ? ' (CONTINUACIÓN)' : ''}`), `${surplusTable(batch)}${i === batches(surpluses).length - 1 ? `<div class="detail-total">TOTAL SOBRANTES: ${surpluses.length} líneas • ${fmt(sum(surpluses, diff))} unidades • ${money(surplus)}</div>` : ''}`)));
    batches(damaged).forEach((batch, i) => pages.push(frame(title(`TABLA 4 • DETALLE DE AVERÍAS${i ? ' (CONTINUACIÓN)' : ''}`), `${damagedTable(batch)}${i === batches(damaged).length - 1 ? `<div class="detail-total">TOTAL AVERÍAS: ${damaged.length} líneas • ${fmt(sum(damaged, damagedQty))} unidades • ${money(damagedCost)}</div><p class="detail-note">Una avería puede coexistir con un faltante o sobrante; no se suman los registros como categorías excluyentes.</p>` : ''}`)));
    if (resolved.length) batches(resolved).forEach((batch, i) => pages.push(frame(title(`DETALLE COMPLEMENTARIO • CONCILIACIONES${i ? ' (CONTINUACIÓN)' : ''}`), itemTable(batch, false))));
    const svgImage = svg => `<img class="detail-chart" alt="Gráfico de resultados" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
    const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="190" viewBox="0 0 260 190"><rect width="260" height="190" fill="white"/>${body}</svg>`;
    // Pie sectors describe category occurrences: damage may coexist with a quantity result.
    const finalCount = exactFinal ?? (lines === null ? null : Math.max(0, lines - pending.length));
    const distribution = [
      { label: 'Conformes en cantidad', count: finalCount, color: '#059669' },
      { label: 'Faltantes', count: shortages.length, color: '#dc2626' },
      { label: 'Sobrantes', count: surpluses.length, color: '#2563eb' },
      { label: 'Averías', count: damaged.length, color: '#d97706' }
    ];
    const categoryTotal = distribution.reduce((total, entry) => total + (entry.count || 0), 0);
    let angle = -Math.PI / 2;
    const sectors = distribution.map(entry => {
      if (!entry.count) return '';
      const sweep = entry.count / categoryTotal * Math.PI * 2;
      const end = angle + sweep;
      const shape = entry.count === categoryTotal
        ? `<circle cx="150" cy="85" r="72" fill="${entry.color}"/>`
        : `<path d="M150 85 L${150 + 72 * Math.cos(angle)} ${85 + 72 * Math.sin(angle)} A72 72 0 ${sweep > Math.PI ? 1 : 0} 1 ${150 + 72 * Math.cos(end)} ${85 + 72 * Math.sin(end)} Z" fill="${entry.color}" stroke="white" stroke-width="1"/>`;
      angle = end;
      return `<g data-category="${entry.label}" data-count="${entry.count}">${shape}</g>`;
    }).join('');
    const donut = lines > 0 && categoryTotal > 0 ? svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="280" viewBox="0 0 300 280"><rect width="300" height="280" fill="white"/>${sectors}${distribution.map((entry, i) => `<rect x="5" y="${175 + i * 23}" width="9" height="9" fill="${entry.color}"/><text x="20" y="${184 + i * 23}" font-family="Arial" font-size="11" fill="${entry.color}">${entry.label}: ${entry.count === null ? 'N/D' : `${fmt(entry.count)} · ${pct(entry.count / categoryTotal * 100)}`}</text>`).join('')}<text x="5" y="278" font-family="Arial" font-size="10" fill="#64748b">Porcentajes sobre ${fmt(categoryTotal)} resultados por categoría</text></svg>`).replace('class="detail-chart"', 'class="detail-chart detail-chart-distribution"') : '<p>Sin base auditada para representar.</p>';
    // Keep each economic category visible, even when shortages dominate the ranking.
    const economicGroups = [
      { label: 'Faltante', color: '#dc2626', items: shortages, amount: item => Math.abs(cost(item) || 0) },
      { label: 'Sobrante', color: '#2563eb', items: surpluses, amount: item => Math.abs(cost(item) || 0) },
      { label: 'Avería', color: '#d97706', items: damaged, amount: item => Math.abs(damagedValue(item) || 0) }
    ];
    const top = economicGroups.flatMap(group => group.items.map(item => ({ item, label: group.label, color: group.color, amount: group.amount(item) })).sort((a, b) => b.amount - a.amount).slice(0, 3));
    const maxCost = Math.max(1, ...top.map(entry => entry.amount));
    const bars = top.length ? svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${top.length * 51 + 8}" viewBox="0 0 300 ${top.length * 51 + 8}"><rect width="300" height="${top.length * 51 + 8}" fill="white"/>${top.map((entry, i) => `<text x="5" y="${i * 51 + 13}" font-family="Arial" font-size="11">${esc(entry.label)} · ${esc(entry.item.sku)} · ${esc(entry.item.almacen || '')}</text><rect x="5" y="${i * 51 + 20}" width="${entry.amount / maxCost * 285}" height="8" fill="${entry.color}"/><text x="5" y="${i * 51 + 43}" font-family="Arial" font-size="12" fill="${entry.color}">${money(entry.amount)}</text>`).join('')}</svg>`).replace('class="detail-chart"', 'class="detail-chart detail-chart-financial"') : '<p>Sin impactos económicos para representar.</p>';
    const comparison = [...indicators, ['ERU', eruInitial, eru]];
    const colors = { good: '#059669', attention: '#d97706', alert: '#dc2626', unknown: '#64748b' };
    const eriBars = svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="white"/>${comparison.map((item, i) => {
      const delta = item[1] === null || item[2] === null ? null : item[2] - item[1];
      const label = delta === null ? 'Sin base comparable' : delta === 0 ? 'Sin cambio: 0.00 pp' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} pp`;
      return `<g data-initial="${item[1] ?? ''}" data-final="${item[2] ?? ''}" data-level="${level(item[2])}"><text x="4" y="${i * 67 + 12}" font-family="Arial" font-size="12" fill="#334155">${['Cantidad', 'SKU', 'Monetario', 'ERU'][i]} • ${label}</text>${[item[1], item[2]].map((value, stage) => `<text x="4" y="${i * 67 + 28 + stage * 17}" font-family="Arial" font-size="11">${stage ? 'Final' : 'Inicial'}</text><rect x="48" y="${i * 67 + 19 + stage * 17}" width="${value === null ? 0 : Math.min(100, Math.max(0, value)) * 1.72}" height="10" fill="${stage ? colors[level(value)] : '#94a3b8'}"/><text x="225" y="${i * 67 + 28 + stage * 17}" font-family="Arial" font-size="12" fill="${stage ? colors[level(value)] : '#64748b'}">${value === null ? 'N/D' : pct(value)}</text>`).join('')}</g>`;
    }).join('')}<text x="4" y="284" font-family="Arial" font-size="9">Gris: conteo inicial • Color: conteo final</text><text x="4" y="297" font-family="Arial" font-size="9">Verde ≥95% • Naranja 90-94.99% • Rojo &lt;90%</text></svg>`).replace('class="detail-chart"', 'class="detail-chart detail-chart-comparison"');
    const strongest = [...top].sort((a, b) => b.amount - a.amount)[0];
    const signatures = metrics.reportSignatories || {};
    const countNames = (signatures.counters || []).map(esc).join('<br>');
    const managerNames = (signatures.centerManagers || []).map(esc).join('<br>');
    const change = indicators[0][1] === null || indicators[0][2] === null ? null : indicators[0][2] - indicators[0][1];
    const recommendations = [
      pending.length ? `Conciliar ${pending.length} líneas con diferencias mediante reconteo dirigido, revisión de documentos y aprobación del ajuste.` : 'Conservar la evidencia de conteo y conciliación de las líneas conformes.',
      shortages.length ? `Priorizar los ${shortages.length} faltantes por ${money(deficit)}, empezando por los de mayor impacto patrimonial.` : 'Mantener controles periódicos para detectar faltantes oportunamente.',
      ...(surpluses.length ? [`Revisar ingresos y traspasos asociados a las ${surpluses.length} líneas con sobrantes por ${money(surplus)}.`] : []),
      ...(damaged.length ? [`Identificar y segregar las averías en ${damaged.length} líneas; validar garantía o baja autorizada.`] : []),
      ...(number(s.eruPercent) !== null && number(s.eruPercent) < 95 ? [`Revisar señalización y asignación de racks: el ERU informado es ${pct(number(s.eruPercent))}.`] : []),
      'Asignar responsables y fechas para las acciones; documentar su seguimiento antes del cierre administrativo.'
    ];
    const conclusion = !fullData
      ? `El inventario del centro ${esc(center)} presenta información insuficiente para emitir una conclusión global de exactitud. Se requiere completar la base auditada y los indicadores finales antes de validar su resultado. Los impactos económicos disponibles se detallan en este informe.`
      : `El inventario del centro ${esc(center)}, con ${fmt(lines)} líneas y ${fmt(units)} existencias auditadas, ${meets ? 'alcanza la referencia de exactitud del 95% en los tres ERI' : 'requiere seguimiento al presentar uno o más ERI inferiores al 95%'}. La exactitud final es ${pct(indicators[0][2])} en cantidad, ${pct(indicators[1][2])} en SKU y ${pct(indicators[2][2])} en valor${eru === null ? '' : `; la exactitud de ubicación (ERU) es ${pct(eru)}`}. ${pending.length ? `Permanecen ${pending.length} líneas con diferencias que requieren conciliación o regularización documentada.` : 'Las líneas auditadas no presentan diferencias de cantidad pendientes.'} El impacto económico identificado comprende faltantes por ${money(deficit)}, sobrantes por ${money(surplus)} y averías por ${money(damagedCost)}, con un impacto absoluto total de ${money(totalImpact)}. ${pending.length || damagedCost > 0 ? 'Corresponde dar seguimiento a las diferencias y averías, conservar las evidencias y obtener las autorizaciones de ajuste que procedan antes del cierre administrativo.' : 'Corresponde conservar las evidencias y formalizar la validación administrativa del cierre.'}`;
    pages.push(frame(title('ANÁLISIS GRÁFICO OPERATIVO Y FINANCIERO DE AUDITORÍA'), `
      <div class="detail-graphs"><article><h3 class="blue">1. Distribución del inventario</h3>${donut}<div class="detail-explanation green"><b>Explicación administrativa</b><p>${fmt(finalCount)} líneas conformes en cantidad, ${shortages.length} con faltantes, ${surpluses.length} con sobrantes y ${damaged.length} con averías. Base auditada: ${fmt(lines)} líneas. Una avería puede coexistir con una diferencia o con un conteo exacto. El pastel representa ${fmt(categoryTotal)} resultados por categoría; sus porcentajes no equivalen al ERI ni a líneas únicas.</p></div></article><article><h3 class="red">2. Impacto financiero por SKU</h3>${bars}<div class="detail-explanation red"><b>Explicación administrativa</b><p>${strongest ? `El mayor impacto representado corresponde a ${esc(strongest.item.sku)} (${esc(strongest.item.almacen || '')}) por ${money(strongest.amount)} (${esc(strongest.label)}). Priorizar la validación de esa evidencia y su trazabilidad.` : 'No se identifican impactos económicos en el detalle disponible.'} La gráfica muestra hasta tres registros de mayor impacto por categoría: faltantes, sobrantes y averías. Los importes se muestran completos en bolivianos y centavos.</p></div></article><article><h3 class="green">3. Evolución comparativa de ERI</h3>${eriBars}<div class="detail-explanation blue"><b>Explicación administrativa</b><p>El ERI principal varió ${change === null ? 'sin datos comparables' : `${change >= 0 ? '+' : ''}${change.toFixed(2)} puntos porcentuales`}. ${!fullData ? 'Falta una base completa para emitir evaluación.' : meets ? 'Los tres indicadores alcanzan la referencia de 95%.' : 'Uno o más indicadores quedan por debajo de la referencia de 95%; se requiere seguimiento.'}</p></div></article></div>
      <div class="detail-callout"><h3>Diagnóstico técnico, plan de acción operativo y recomendación de cierre</h3><div class="detail-diagnosis"><article><b>1. Diagnóstico de confiabilidad</b><p>ERI principal: ${pct(indicators[0][2])}. ERI de SKU: ${pct(indicators[1][2])}. ERI monetario: ${pct(indicators[2][2])}. ${assessment}. La base de evaluación corresponde al período y filtros indicados.</p></article><article><b>2. Medidas correctivas en almacén</b><ol>${recommendations.map(text => `<li>${text}</li>`).join('')}</ol></article><article><b>3. Regularización contable</b><p>Faltantes: ${money(deficit)}. Sobrantes: ${money(surplus)}. Impacto neto de diferencias: ${money(surplus - deficit)}; impacto absoluto: ${money(impact)}.</p><p>${pending.length ? 'Solicitar validación y autorización del ajuste al responsable de Finanzas y Control de Gestión. El informe no sustituye ese trámite.' : 'Verificar el respaldo documental y la aprobación formal de cierre.'}</p></article></div></div>
      <div class="detail-closing"><div class="detail-callout detail-conclusion"><h3>Conclusión global del inventario del centro</h3><p>${conclusion}</p></div>
      <div class="detail-signatures"><span><b class="detail-signature-name">${countNames || '&nbsp;'}</b>Responsables de conteo<br><small>Firma / fecha</small></span><span><b class="detail-signature-name">${managerNames || '&nbsp;'}</b>Encargado del centro<br><small>Firma / fecha</small></span><span><b class="detail-signature-name">&nbsp;</b>Auditoría / Control de gestión<br><small>Nombre / firma / fecha</small></span></div></div>`));
    // Let measured pagination fill the operations pages before moving to charts.
    const chartPage = pages.pop();
    const operations = pages.splice(1).map(page => page.replace(/^<section class="detail-page">/, '').replace(/<\/section>$/, '')).join('');
    pages.push(frame('', operations), chartPage);
    return `<style>@media print { @page { size:A4 portrait; margin:6mm; } }</style><div class="detail-report">${pages.map((page, i) => page.replace('</section>', `<footer> NIBOL MULTIMARCAS • ${esc(inv.id || 'CONSOLIDADO')}<span>${i + 1} / ${pages.length}</span></footer></section>`)).join('')}</div>`;
  }
};
