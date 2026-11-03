// Management reports built only from the frozen dashboard snapshot:
// one document per center and a separate consolidated document.
// Charts are plain HTML boxes because the PDF export cannot read CSS inside SVG.
(function () {
  const LEVELS = {
    perfect: { key: 'perfect', icon: '★', label: 'Perfecto cumplimiento', rank: 3 },
    ok: { key: 'ok', icon: '✓', label: 'Cumplimiento', rank: 2 },
    min: { key: 'min', icon: '▲', label: 'Mínimo de cumplimiento', rank: 1 },
    no: { key: 'no', icon: '✕', label: 'No cumple', rank: 0 }
  };
  const NO_DATA = { key: 'nil', icon: '–', label: 'Sin datos', rank: -1 };
  const CAUSES = {
    multiple: { label: 'En varias ubicaciones', rule: 'Dentro de un mismo almacén, el código aparece en más de una ubicación.', color: '#203f83' },
    format: { label: 'Ubicación con formato no válido', rule: 'La ubicación no tiene los 10 caracteres de letras y números.', color: '#2a78d6' },
    none: { label: 'Sin ubicación principal', rule: 'El código no tiene ninguna ubicación registrada.', color: '#eda100' },
    additional: { label: 'Solo en ubicación adicional', rule: 'Tiene una sola ubicación, pero no es la principal.', color: '#8a93a3' }
  };
  const CAUSE_KEYS = Object.keys(CAUSES);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const qty = value => Math.round(num(value)).toLocaleString('es-BO');
  const decimal = value => num(value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bs = value => `Bs ${decimal(value)}`;
  // Truncated so a value below a threshold never prints as if it had reached it.
  const pct = value => value === null ? 'No disponible' : `${(Math.floor(value * 100) / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const ratio = (part, whole) => whole > 0 ? Math.min(100, Math.max(0, part / whole * 100)) : null;
  const level = value => value === null || value === undefined ? NO_DATA
    : value >= 100 ? LEVELS.perfect : value >= 98 ? LEVELS.ok : value >= 95 ? LEVELS.min : LEVELS.no;
  const worst = values => values.some(value => value === null) ? NO_DATA
    : values.map(level).sort((a, b) => a.rank - b.rank)[0];
  const chip = lvl => `<span class="mr-chip lvl-${lvl.key}">${lvl.icon} ${esc(lvl.label.toUpperCase())}</span>`;
  const width = (value, max, size) => max > 0 ? Math.max(value > 0 ? 2 : 0, value / max * size) : 0;
  const hbar = (value, max, size, color, label) => `<div class="mr-ibar"><i style="width:${width(value, max, size)}px;background:${color}"></i>${label}</div>`;
  const RED = '#c9373f', BLUE = '#2a78d6', AMBER = '#eda100', GRAY = '#b7c0ce', NAVY = '#17305f';
  const sum = (list, getter) => list.reduce((total, item) => total + num(getter(item)), 0);

  // A center's numbers, always derived from its quantities.
  function indicators(group) {
    const value = num(group.value), short = num(group.shortage?.cost), surplus = num(group.surplus?.cost);
    const first = group.firstCount ? num(group.firstCount.shortage?.cost) + num(group.firstCount.surplus?.cost) : null;
    const valueExact = Math.max(0, value - short - surplus);
    const valueExact1 = first === null ? null : Math.max(0, value - first);
    return {
      units: ratio(group.unitsExact, group.units), units1: ratio(group.unitsExact1, group.units),
      codes: ratio(group.skusExact, group.skus), codes1: ratio(group.skusExact1, group.skus),
      money: ratio(valueExact, value), money1: valueExact1 === null ? null : ratio(valueExact1, value),
      eru: ratio(group.eru?.exact, group.eru?.evaluated),
      valueExact, valueExact1
    };
  }
  const result = group => { const i = indicators(group); return worst([i.units, i.codes, i.money]); };

  const bullet = (first, last) => {
    const pos = value => Math.max(0, Math.min(100, (value - 80) * 5));
    return `<div class="mr-bullet"><i class="first" style="width:${pos(first)}%"></i><i class="last" style="width:${pos(last)}%"></i><u style="left:75%"></u><u style="left:90%"></u></div>`;
  };
  const kpi = ({ label, value, status, pair, line, sub, cls }) => `<div class="mr-kpi ${cls || `top-${status?.key || 'nil'}`}"><div class="mr-kpi-top"><span>${esc(label)}</span>${status ? chip(status) : ''}</div><strong>${value}</strong><span class="mr-qty">${line}</span>${pair && pair[1] !== null ? bullet(pair[0] ?? pair[1], pair[1]) : ''}<small>${sub}</small></div>`;

  // Squarified treemap: each block's area is its share of the amount.
  function treemap(items, W, H) {
    const positive = items.filter(item => item.value > 0).sort((a, b) => b.value - a.value);
    if (!positive.length) return '<p class="mr-more">Sin montos en este inventario.</p>';
    const out = [];
    let x = 0, y = 0, w = W, h = H, rest = positive, left = sum(positive, item => item.value);
    const worstAspect = (row, side, area) => {
      const s = sum(row, item => item.value) * area;
      return Math.max(...row.map(item => Math.max((side * side * item.value * area) / (s * s), (s * s) / (side * side * item.value * area))));
    };
    while (rest.length) {
      const area = (w * h) / left, side = Math.min(w, h);
      const row = [rest[0]];
      let i = 1;
      while (i < rest.length && worstAspect([...row, rest[i]], side, area) <= worstAspect(row, side, area)) row.push(rest[i++]);
      const rowSum = sum(row, item => item.value), thick = rowSum * area / side;
      let offset = 0;
      row.forEach(item => {
        const length = item.value * area / thick;
        out.push(w >= h ? { ...item, x, y: y + offset, w: thick, h: length } : { ...item, x: x + offset, y, w: length, h: thick });
        offset += length;
      });
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      left -= rowSum;
      rest = rest.slice(row.length);
    }
    return `<div class="mr-tree" style="height:${H}px">${out.map(b => `<div style="left:${b.x / W * 100}%;top:${b.y}px;width:calc(${b.w / W * 100}% - 2px);height:${Math.max(b.h - 2, 1)}px;background:${b.color}">${b.w > 62 && b.h > 30 ? `<b>${esc(b.label)}</b><br>${qty(b.value)}` : ''}</div>`).join('')}</div>`;
  }

  const shade = (value, max, hue) => {
    const t = max > 0 ? Math.sqrt(value / max) : 0, mix = (a, b) => Math.round(a + (b - a) * t);
    const stops = hue === 'blue' ? [[234, 28], [242, 90], [252, 170]] : [[252, 170], [236, 32], [236, 44]];
    return `background:rgb(${mix(...stops[0])},${mix(...stops[1])},${mix(...stops[2])});color:${t > .55 ? '#fff' : '#172033'}`;
  };
  // Rows hold money per class; only classes that exist become columns.
  function heat(rows, side, hue, firstHeader) {
    const classes = [...new Set(rows.flatMap(row => Object.keys(row.cells)))].sort();
    if (!classes.length) return '<p class="mr-more">Sin montos para mostrar.</p>';
    const cell = (row, name) => num(row.cells[name]?.[side]);
    const max = Math.max(...rows.flatMap(row => classes.map(name => cell(row, name))));
    return `<table class="mr-heat"><thead><tr><th>${esc(firstHeader)}</th>${classes.map(name => `<th>Clase ${esc(name)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${rows.map(row => `<tr><th>${esc(row.name)}</th>${classes.map(name => `<td style="${shade(cell(row, name), max, hue)}">${qty(cell(row, name))}</td>`).join('')}<td class="num mr-strong">${qty(sum(classes, name => cell(row, name)))}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th>${classes.map(name => `<td class="mr-center">${qty(sum(rows, row => cell(row, name)))}</td>`).join('')}<td class="num">${qty(sum(rows, row => sum(classes, name => cell(row, name))))}</td></tr></tfoot></table>`;
  }

  const causeLegend = `<div class="mr-legend">${CAUSE_KEYS.map(key => `<span><i style="background:${CAUSES[key].color}"></i>${esc(CAUSES[key].label)}</span>`).join('')}</div>`;
  const stack = (causes, max, size) => {
    const total = sum(CAUSE_KEYS, key => causes[key]);
    return `<div class="mr-stack" style="width:${width(total, max, size)}px">${CAUSE_KEYS.filter(key => causes[key] > 0).map(key => `<i style="flex:${causes[key]} 1 0;background:${CAUSES[key].color}"></i>`).join('')}</div>`;
  };
  function causeTable(eru) {
    const loss = sum(CAUSE_KEYS, key => eru.causes[key]), max = Math.max(...CAUSE_KEYS.map(key => eru.causes[key]));
    const points = value => (eru.evaluated > 0 ? value / eru.evaluated * 100 : 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = CAUSE_KEYS.slice().sort((a, b) => eru.causes[b] - eru.causes[a]).map(key => `<tr><td class="mr-strong mr-nowrap">${esc(CAUSES[key].label)}</td><td>${esc(CAUSES[key].rule)}</td><td>${hbar(eru.causes[key], max, 170, CAUSES[key].color, qty(eru.causes[key]))}</td><td class="num">${loss ? Math.round(eru.causes[key] / loss * 100) : 0}%</td><td class="num">− ${points(eru.causes[key])}</td></tr>`).join('');
    return `<table><thead><tr><th>Causa</th><th>Qué significa</th><th>Afectados</th><th class="num">% de la baja</th><th class="num">Puntos que resta</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total con baja (código por almacén)</td><td>${qty(loss)} de ${qty(eru.evaluated)}</td><td class="num">${loss ? '100' : '0'}%</td><td class="num">− ${points(loss)}</td></tr></tfoot></table>`;
  }

  const scaleLegend = `<div class="mr-legend">${Object.values(LEVELS).slice().reverse().map(lvl => `<span><i class="lvl-${lvl.key}"></i>${lvl.key === 'no' ? 'Menos de 95%: no cumple' : lvl.key === 'min' ? '95% a menos de 98%: mínimo' : lvl.key === 'ok' ? '98% o más: cumplimiento' : '100%: perfecto'}</span>`).join('')}</div>`;

  const sheet = (title, right, body, footer, label) => `<section class="mr-sheet" aria-label="${esc(label || title)}"><header class="mr-band"><b>${esc(title)}</b><span>${right}</span></header><div class="mr-body">${body}</div><footer class="mr-foot"><span>${footer}</span><span class="mr-page-no"></span></footer></section>`;
  const panel = (title, content, cls = '') => `<section class="mr-panel ${cls}"><h3>${esc(title)}</h3>${content}</section>`;

  const differences = list => {
    const final = item => num(item.diferenciaFinal ?? item.diferencia);
    const cost = item => Math.abs(num(item.costoDiferenciaFinal ?? item.costoDiferencia));
    return {
      final, cost,
      shortages: list.filter(item => final(item) < 0).sort((a, b) => cost(b) - cost(a)),
      surpluses: list.filter(item => final(item) > 0).sort((a, b) => cost(b) - cost(a)),
      damaged: list.filter(item => num(item.malEstadoFinal ?? item.malEstado) > 0).sort((a, b) => num(b.costoMalEstadoFinal) - num(a.costoMalEstadoFinal))
    };
  };
  const physical = (item, final) => item.stockFisicoFinal ?? (item.stockSistema === undefined ? null : num(item.stockSistema) + final(item));
  const justification = item => item.justificacion || item.comentarioJustificacion || item.Comentario_Justificacion || item.Razon || item.Comentario || 'Sin justificación registrada';

  function moneyPanel(title, first, close, unit, value, color) {
    const firstCost = num(first.cost), closeCost = num(close.cost), resolved = Math.max(0, firstCost - closeCost);
    const max = Math.max(firstCost, closeCost, 1);
    return panel(title, `<table class="mr-flat"><tbody><tr><td>Primer conteo</td><td>${hbar(firstCost, max, 150, color, qty(firstCost))}</td></tr><tr><td>Resuelto</td><td>${hbar(resolved, max, 150, GRAY, qty(resolved))}</td></tr><tr class="mr-strong"><td>Cierre</td><td>${hbar(closeCost, max, 150, color, qty(closeCost))}</td></tr></tbody></table><div class="mr-figure"><b>${bs(closeCost)}</b><span>${qty(close.lines)} ${unit} · ${qty(close.units)} unidades · ${value > 0 ? pct(closeCost / value * 100) : 'No disponible'} del valor</span></div>`);
  }
  function breakdownTable(first, groups, total) {
    const maxS = Math.max(...groups.map(g => g.shortage.cost), 1), maxP = Math.max(...groups.map(g => g.surplus.cost), 1);
    const row = g => { const i = indicators(g); return `<td class="num">${qty(g.skusExact)} / ${qty(g.skus)}</td><td class="num">${pct(i.codes)}</td><td class="num">${qty(g.unitsExact)} / ${qty(g.units)}</td><td class="num">${pct(i.units)}</td><td class="num">${qty(g.shortage.lines)}</td><td class="num">${qty(g.shortage.units)}</td>`; };
    return `<table data-split><thead><tr><th></th><th class="mr-group" colspan="2">Códigos correctos</th><th class="mr-group" colspan="2">Unidades correctas</th><th class="mr-group" colspan="3">Faltantes</th><th class="mr-group" colspan="3">Sobrantes</th><th></th></tr><tr><th>${esc(first)}</th><th class="num">Cant.</th><th class="num">%</th><th class="num">Cant.</th><th class="num">%</th><th class="num">Líneas</th><th class="num">Unid.</th><th>Bs</th><th class="num">Líneas</th><th class="num">Unid.</th><th>Bs</th><th class="num">Averías Bs</th></tr></thead><tbody>${groups.map(g => `<tr><td class="mr-strong">${esc(g.name)}</td>${row(g)}<td>${hbar(g.shortage.cost, maxS, 75, RED, qty(g.shortage.cost))}</td><td class="num">${qty(g.surplus.lines)}</td><td class="num">${qty(g.surplus.units)}</td><td>${hbar(g.surplus.cost, maxP, 60, BLUE, qty(g.surplus.cost))}</td><td class="num">${qty(g.damage.cost)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td>${row(total)}<td>${qty(total.shortage.cost)}</td><td class="num">${qty(total.surplus.lines)}</td><td class="num">${qty(total.surplus.units)}</td><td>${qty(total.surplus.cost)}</td><td class="num">${qty(total.damage.cost)}</td></tr></tfoot></table>`;
  }
  function eruGroups(first, groups) {
    const lossOf = g => sum(CAUSE_KEYS, key => g.eru.causes[key]);
    const max = Math.max(...groups.map(lossOf), 1);
    return `<table data-split><thead><tr><th>${esc(first)}</th><th class="num">Correctos</th><th class="num">%</th><th class="num">Con baja</th><th>Causas</th></tr></thead><tbody>${groups.map(g => `<tr><td class="mr-strong">${esc(g.name)}</td><td class="num">${qty(g.eru.exact)} / ${qty(g.eru.evaluated)}</td><td class="num">${pct(ratio(g.eru.exact, g.eru.evaluated))}</td><td class="num">${qty(lossOf(g))}</td><td class="mr-wide">${stack(g.eru.causes, max, 175)}</td></tr>`).join('')}</tbody></table>`;
  }
  const topTable = (list, helpers, color, total, sign) => {
    const max = Math.max(...list.map(helpers.cost), 1);
    let running = 0;
    return `<table data-split class="mr-diff"><thead><tr><th>Código</th><th>Alm.</th><th class="num">Sist.</th><th class="num">Físico</th><th class="num">Dif.</th><th>Bs</th><th class="num">Acum.</th><th>Motivo</th></tr></thead><tbody>${list.map(item => {
      running += helpers.cost(item);
      return `<tr><td>${esc(item.sku)}</td><td>${esc(item.almacen)}</td><td class="num">${qty(item.stockSistema)}</td><td class="num">${qty(physical(item, helpers.final))}</td><td class="num">${sign}${qty(Math.abs(helpers.final(item)))}</td><td>${hbar(helpers.cost(item), max, 58, color, qty(helpers.cost(item)))}</td><td class="num">${total ? Math.round(running / total * 100) : 0}%</td><td>${esc(justification(item))}</td></tr>`;
    }).join('') || '<tr><td colspan="8">Sin registros.</td></tr>'}</tbody></table>`;
  };
  const annexTable = (list, helpers, color, sign, emptyText) => {
    const max = Math.max(...list.map(helpers.cost), 1);
    return `<table data-split><thead><tr><th>Código</th><th>Descripción</th><th>Clase</th><th>Almacén · ubicación</th><th class="num">Sistema</th><th class="num">Físico</th><th class="num">Dif.</th><th>Bs</th><th>Justificación</th></tr></thead><tbody>${list.map(item => `<tr><td>${esc(item.sku)}</td><td>${esc(item.descripcion)}</td><td>${esc(item.abc)}</td><td>${esc(item.almacen)} · ${esc(item.ubicacion)}</td><td class="num">${qty(item.stockSistema)}</td><td class="num">${qty(physical(item, helpers.final))}</td><td class="num">${sign}${qty(Math.abs(helpers.final(item)))}</td><td>${hbar(helpers.cost(item), max, 70, color, decimal(helpers.cost(item)))}</td><td>${esc(justification(item))}</td></tr>`).join('') || `<tr><td colspan="9">${esc(emptyText)}</td></tr>`}</tbody></table>`;
  };

  // Each role signs on its own line. A role without known names keeps one blank line and its title.
  function signatures(roles) {
    return `<div class="mr-signs">${roles.map(([role, names]) => `<div class="mr-sign-role"><h4>${esc(role)}</h4><div class="mr-sign-lines">${(names.length ? names : ['']).map(name => `<div class="mr-sign-line"><i></i><span>${name ? esc(name) : '&nbsp;'}</span></div>`).join('')}</div></div>`).join('')}</div>`;
  }

  const unitsOf = amount => `${qty(amount.units)} ${amount.units === 1 ? 'unidad' : 'unidades'}`;
  const linesOf = amount => `${qty(amount.lines)} ${amount.lines === 1 ? 'línea' : 'líneas'}`;
  const differencesText = group => [
    group.shortage.lines ? `faltantes por ${bs(group.shortage.cost)} (${linesOf(group.shortage)}, ${unitsOf(group.shortage)})` : '',
    group.surplus.lines ? `sobrantes por ${bs(group.surplus.cost)} (${linesOf(group.surplus)}, ${unitsOf(group.surplus)})` : ''
  ].filter(Boolean).join(' y ');

  // Closing sheet of both documents. Shortages and surpluses stay apart: none offsets the other.
  function closingSheet({ right, footer, group, overall, helpers, extraActions = [], conclusion, roles }) {
    const i = indicators(group);
    const rows = [
      ['Unidades correctas', 'Unidades conformes frente a las del sistema', i.units, `${qty(group.unitsExact)} de ${qty(group.units)}`],
      ['Códigos correctos', 'Códigos sin diferencia frente a los revisados', i.codes, `${qty(group.skusExact)} de ${qty(group.skus)}`],
      ['Valor correcto', 'Valor sin faltantes ni sobrantes frente al del sistema', i.money, `${bs(i.valueExact)} de ${bs(group.value)}`]
    ];
    const lowest = rows.slice().sort((a, b) => num(a[2]) - num(b[2]))[0];
    const eruLoss = group.eru.evaluated - group.eru.exact;
    const concentration = (list, total) => {
      const top = list.slice(0, 3);
      const part = sum(top, helpers.cost);
      return top.length && total > 0 ? ` Empezar por ${top.map(item => esc(item.sku)).join(', ')}, que suman ${Math.round(part / total * 100)}% del monto.` : '';
    };
    const actions = [
      group.shortage.lines && ['Aclarar los faltantes', `Revisar documentos, recontar lo necesario y tramitar el ajuste que corresponda.${concentration(helpers.shortages, group.shortage.cost)}`, `${linesOf(group.shortage)} · ${unitsOf(group.shortage)}`, bs(group.shortage.cost)],
      group.surplus.lines && ['Aclarar los sobrantes', `Revisar ingresos, traspasos y despachos relacionados.${concentration(helpers.surpluses, group.surplus.cost)}`, `${linesOf(group.surplus)} · ${unitsOf(group.surplus)}`, bs(group.surplus.cost)],
      group.damage.lines && ['Separar las averías', 'Identificarlas físicamente y validar garantía o baja autorizada.', `${linesOf(group.damage)} · ${unitsOf(group.damage)}`, bs(group.damage.cost)],
      eruLoss > 0 && ['Ordenar las ubicaciones', 'Unificar códigos en varias ubicaciones y corregir las que faltan o no son válidas.', `${qty(eruLoss)} ${eruLoss === 1 ? 'código' : 'códigos'} por almacén`, '—'],
      ...extraActions
    ].filter(Boolean);
    return sheet('Diagnóstico y recomendación', right, `
      <div class="mr-row mr-c13-wide">
        ${panel('Dónde estamos', `<p class="mr-lead">${chip(overall)}</p><p class="mr-text">El resultado lo fija el indicador más bajo: <b>${esc(lowest[0].toLowerCase())}</b>, con ${pct(lowest[2])}.</p><p class="mr-more">Ubicación (ERU): ${pct(i.eru)}. Se informa y no cuenta para el resultado.</p>`)}
        ${panel('Indicadores al cierre', `<table><thead><tr><th>Indicador</th><th>Qué mide</th><th class="num">Resultado</th><th class="num">Cantidad</th><th>Nivel</th></tr></thead><tbody>${rows.map(([name, meaning, value, amount]) => `<tr><td class="mr-strong">${name}</td><td>${meaning}</td><td class="num mr-strong">${pct(value)}</td><td class="num">${amount}</td><td>${chip(level(value))}</td></tr>`).join('')}</tbody></table>`)}
      </div>
      ${panel('Qué hacer, en orden', `<table data-split class="mr-actions"><thead><tr><th class="num">#</th><th>Acción</th><th>Cómo</th><th>Alcance</th><th class="num">Monto</th></tr></thead><tbody>${actions.map(([what, how, reach, amount], index) => `<tr><td class="num">${index + 1}</td><td class="mr-strong mr-nowrap">${what}</td><td>${how}</td><td class="mr-nowrap">${reach}</td><td class="num mr-strong">${amount}</td></tr>`).join('') || '<tr><td colspan="5">No quedan diferencias, averías ni bajas de ubicación por atender.</td></tr>'}</tbody></table><p class="mr-more">Asignar responsable y fecha a cada acción, y dejar constancia antes del cierre administrativo.</p>`, 'mr-plain')}
      <div class="mr-row mr-c2">
        ${panel('Regularización contable', `<p class="mr-text">${differencesText(group) ? `Pendiente de regularizar: ${differencesText(group)}. Se tramitan por separado porque ninguno compensa al otro.` : 'No quedan faltantes ni sobrantes por regularizar.'}</p><p class="mr-more">Finanzas y Control de Gestión deben validar y autorizar el ajuste. Este informe no sustituye ese trámite.</p>`)}
        ${panel('Conclusión global', `<p class="mr-text">${conclusion}</p>`)}
      </div>
      ${signatures(roles)}`, footer);
  }

  function renderCenter(inv, metrics, c) {
    const s = metrics.summary || {};
    const i = indicators(c), overall = result(c);
    const list = (metrics.discrepanciesList || []).filter(item => item && typeof item === 'object');
    const helpers = differences(list);
    const name = c.name || c.center;
    const closedAt = c.lastClosedAt ? new Date(c.lastClosedAt).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' }) : 'Sin fecha';
    const title = `${name} · ${inv?.name || 'Inventario'}`;
    const right = `${chip(overall)}`;
    const small = `${esc(name)} · ${esc(inv?.name || inv?.id || '')}`;

    const page1 = sheet(title, `Cierre ${esc(closedAt)} &nbsp; ${right}`, `
      <div class="mr-row mr-c4">
        ${kpi({ label: 'Unidades correctas', value: pct(i.units), status: level(i.units), pair: [i.units1, i.units], line: `${qty(c.unitsExact)} de ${qty(c.units)} unidades`, sub: `Primer conteo: ${qty(c.unitsExact1)} (${pct(i.units1)})` })}
        ${kpi({ label: 'Códigos correctos', value: pct(i.codes), status: level(i.codes), pair: [i.codes1, i.codes], line: `${qty(c.skusExact)} de ${qty(c.skus)} códigos`, sub: `Primer conteo: ${qty(c.skusExact1)} (${pct(i.codes1)})` })}
        ${kpi({ label: 'Valor correcto', value: pct(i.money), status: level(i.money), pair: [i.money1, i.money], line: `${bs(i.valueExact)} de ${bs(c.value)}`, sub: `Primer conteo: ${bs(i.valueExact1)} (${pct(i.money1)})` })}
        ${kpi({ label: 'Ubicación correcta (ERU)', value: pct(i.eru), line: `${qty(c.eru.exact)} de ${qty(c.eru.evaluated)} códigos por almacén`, sub: `${qty(c.eru.evaluated - c.eru.exact)} códigos con baja · detalle en su página · no cuenta para el resultado`, cls: 'top-info' })}
      </div>
      <div class="mr-row mr-c3">
        ${moneyPanel('Faltantes · del primer conteo al cierre', c.firstCount.shortage, c.shortage, 'líneas', c.value, RED)}
        ${moneyPanel('Sobrantes · del primer conteo al cierre', c.firstCount.surplus, c.surplus, 'líneas', c.value, BLUE)}
        ${panel('Averías · se informan aparte', `<table class="mr-flat"><tbody>${c.byWarehouse.map(g => `<tr><td class="mr-strong">${esc(g.name)}</td><td>${hbar(g.damage.cost, Math.max(...c.byWarehouse.map(w => w.damage.cost), 1), 95, AMBER, bs(g.damage.cost))}</td><td class="num">${qty(g.damage.lines)} lín. · ${qty(g.damage.units)} unid.</td></tr>`).join('')}</tbody></table><div class="mr-figure"><b>${bs(c.damage.cost)}</b><span>${qty(c.damage.lines)} líneas · ${qty(c.damage.units)} unidades</span></div>`)}
      </div>
      <div class="mr-row mr-c2">
        ${panel('Unidades correctas en los últimos inventarios de este centro', historyTable(c, inv))}
        ${panel(`Qué pasó con las ${qty(c.flow.firstDifferences)} diferencias del primer conteo`, flowTable(c))}
      </div>
      <div class="mr-row mr-c2">
        ${panel('Faltantes por código · cada bloque es su peso en Bs', treemap(codeBlocks(helpers.shortages, helpers.cost, c.shortage.cost, RED), 500, 104))}
        ${panel('Sobrantes por código · cada bloque es su peso en Bs', treemap(codeBlocks(helpers.surpluses, helpers.cost, c.surplus.cost, BLUE), 500, 104))}
      </div>`, 'Barra oscura: cierre · Barra clara: primer conteo · Marcas: 95% y 98%. El resultado es el nivel más bajo de unidades, códigos y valor.', 'Resumen del centro');

    const page2 = sheet('Dónde está el problema', small, `
      ${panel('Por almacén', breakdownTable('Almacén', c.byWarehouse, c), 'mr-plain')}
      ${panel('Por clase ABC', breakdownTable('Clase', c.byClass, c), 'mr-plain')}
      <div class="mr-row mr-c2">
        ${panel('Faltantes (Bs) por almacén y clase', heat(c.crossWarehouse, 'shortage', 'red', 'Almacén'))}
        ${panel('Sobrantes (Bs) por almacén y clase', heat(c.crossWarehouse, 'surplus', 'blue', 'Almacén'))}
      </div>`, 'Faltantes y sobrantes se muestran por separado; ninguno compensa al otro. Las líneas son registros de conteo.');

    const page3 = sheet('Ubicación (ERU) y causas de la baja', small, `
      <div class="mr-row mr-c13">
        ${kpi({ label: 'Ubicación correcta (ERU)', value: pct(i.eru), line: `${qty(c.eru.exact)} de ${qty(c.eru.evaluated)} códigos por almacén`, sub: 'No cuenta para el resultado de cumplimiento', cls: 'top-info' })}
        ${panel('Causas de la baja', causeTable(c.eru))}
      </div>
      <div class="mr-row mr-c2">
        ${panel('Por almacén', `${eruGroups('Almacén', c.byWarehouse)}${causeLegend}`)}
        ${panel('Por clase ABC', eruGroups('Clase', c.byClass))}
      </div>
      ${panel('Códigos con mayor valor entre los que tienen baja · lista completa en el Anexo E', issueTable(c.issues.slice(0, 5)), 'mr-plain')}`, 'Cada almacén se evalúa por separado y cada código por almacén entra en una sola causa. Las causas describen el dato registrado.');

    const plan = [
      ['Regularizar faltantes principales', helpers.shortages.slice(0, 5), helpers.cost, ''],
      ['Revisar documentos de otros faltantes', helpers.shortages.slice(5), helpers.cost, ''],
      ['Revisar ingresos y traspasos de sobrantes', helpers.surpluses, helpers.cost, BLUE],
      ['Separar averías y validar garantía o baja', helpers.damaged, item => num(item.costoMalEstadoFinal), AMBER]
    ].filter(row => row[1].length);
    const planMax = Math.max(...plan.map(row => sum(row[1], row[2])), 1);
    const locationRows = [['Unificar códigos en varias ubicaciones', c.eru.causes.multiple], ['Corregir ubicaciones no válidas o faltantes', c.eru.causes.format + c.eru.causes.none + c.eru.causes.additional]].filter(row => row[1] > 0);
    const managers = metrics.reportSignatories?.centerManagers || [];
    const counters = metrics.reportSignatories?.counters || [];
    const page4 = sheet('Principales diferencias y plan de acción', small, `
      ${panel(`Principales faltantes · ${Math.min(6, helpers.shortages.length)} de ${helpers.shortages.length} líneas`, topTable(helpers.shortages.slice(0, 6), helpers, RED, c.shortage.cost, '−'), 'mr-plain')}
      ${panel(`Principales sobrantes · ${Math.min(6, helpers.surpluses.length)} de ${helpers.surpluses.length} líneas`, topTable(helpers.surpluses.slice(0, 6), helpers, BLUE, c.surplus.cost, '+'), 'mr-plain')}
      ${panel('Plan de acción', `<table><thead><tr><th>Acción</th><th class="num">Líneas / códigos</th><th>Monto</th><th>Responsable</th><th>Fecha</th></tr></thead><tbody>${plan.map(([label, rows, cost, color]) => `<tr><td>${esc(label)}</td><td class="num">${qty(rows.length)}</td><td>${hbar(sum(rows, cost), planMax, 170, color || RED, bs(sum(rows, cost)))}</td><td class="mr-blank"></td><td class="mr-blank-s"></td></tr>`).join('')}${locationRows.map(([label, count]) => `<tr><td>${esc(label)}</td><td class="num">${qty(count)}</td><td>—</td><td class="mr-blank"></td><td class="mr-blank-s"></td></tr>`).join('')}${plan.length || locationRows.length ? '' : '<tr><td colspan="5">Sin acciones pendientes.</td></tr>'}</tbody></table>`, 'mr-plain')}
      `, 'Este documento no reemplaza la autorización formal de un ajuste contable.');

    const annexes = [
      sheet(`Anexo A · Faltantes`, `${qty(c.shortage.lines)} líneas · ${qty(c.shortage.units)} unidades · ${bs(c.shortage.cost)}`, annexTable(helpers.shortages, helpers, RED, '−', 'Sin faltantes.'), small),
      sheet(`Anexo B · Sobrantes`, `${qty(c.surplus.lines)} líneas · ${qty(c.surplus.units)} unidades · ${bs(c.surplus.cost)}`, annexTable(helpers.surpluses, helpers, BLUE, '+', 'Sin sobrantes.'), small),
      sheet(`Anexo C · Averías`, `${qty(c.damage.lines)} líneas · ${qty(c.damage.units)} unidades · ${bs(c.damage.cost)}`, `<table data-split><thead><tr><th>Código</th><th>Descripción</th><th>Clase</th><th>Almacén · ubicación</th><th class="num">Unidades</th><th>Valor Bs</th><th>Acción</th></tr></thead><tbody>${helpers.damaged.map(item => `<tr><td>${esc(item.sku)}</td><td>${esc(item.descripcion)}</td><td>${esc(item.abc)}</td><td>${esc(item.almacen)} · ${esc(item.ubicacion)}</td><td class="num">${qty(item.malEstadoFinal ?? item.malEstado)}</td><td>${hbar(num(item.costoMalEstadoFinal), Math.max(...helpers.damaged.map(d => num(d.costoMalEstadoFinal)), 1), 80, AMBER, decimal(item.costoMalEstadoFinal))}</td><td>Validar garantía o baja</td></tr>`).join('') || '<tr><td colspan="7">Sin averías.</td></tr>'}</tbody></table>`, small),
      sheet(`Anexo D · Códigos en varias ubicaciones`, `${qty((metrics.multiLocationSkus || []).filter(sku => sku.severalInWarehouse).length)} códigos en un mismo almacén`, multiLocationTable((metrics.multiLocationSkus || []).filter(sku => sku.severalInWarehouse)), small),
      sheet(`Anexo E · Códigos con baja de ubicación`, `${qty(c.issues.length)} códigos`, issueTable(c.issues), small),
      sheet('Anexo F · Cálculo y responsables', 'Referencia', `<table class="mr-defs"><tbody>
        <tr><th>Unidades correctas<small>ERI de cantidad</small></th><td>Unidades conformes ÷ unidades del sistema.</td></tr>
        <tr><th>Códigos correctos<small>ERI de SKU</small></th><td>Códigos sin diferencia ÷ códigos revisados.</td></tr>
        <tr><th>Valor correcto<small>ERI monetario</small></th><td>(Valor del sistema − faltantes − sobrantes) ÷ valor del sistema. Un sobrante no compensa un faltante.</td></tr>
        <tr><th>Ubicación correcta<small>ERU</small></th><td>Cada almacén se evalúa por separado: códigos con una sola ubicación en ese almacén, que es la principal y tiene 10 caracteres ÷ códigos evaluados por almacén. No cuenta para el resultado.</td></tr>
        <tr><th>Escala NIBOL Multimarcas</th><td>100%: perfecto cumplimiento · 98% o más: cumplimiento · 95% a menos de 98%: mínimo de cumplimiento · menos de 95%: no cumple.</td></tr>
        <tr><th>Resultado del informe</th><td>El nivel más bajo entre unidades, códigos y valor.</td></tr>
        <tr><th>Responsables de conteo</th><td>${counters.map(esc).join(', ') || 'No registrados'}</td></tr>
        <tr><th>Inventarios incluidos</th><td>${c.inventories.map(esc).join(', ')}</td></tr>
        <tr><th>Alcance</th><td>${qty(s.totalItemsAudited)} líneas revisadas.</td></tr>
      </tbody></table>${scaleLegend}`, small)
    ];
    const differing = c.shortage.lines + c.surplus.lines;
    const conclusion = `El inventario de ${esc(name)} revisó ${qty(s.totalItemsAudited)} líneas y ${qty(c.units)} unidades del sistema, con resultado <b>${esc(overall.label.toLowerCase())}</b>. Al cierre, la exactitud es ${pct(i.units)} en unidades, ${pct(i.codes)} en códigos y ${pct(i.money)} en valor; la ubicación es ${pct(i.eru)}. ${differing ? `Quedan ${qty(differing)} ${differing === 1 ? 'línea' : 'líneas'} con diferencia: ${differencesText(c)}.` : 'No quedan líneas con diferencia.'}${c.damage.lines ? ` Las averías suman ${bs(c.damage.cost)} (${linesOf(c.damage)}).` : ''} Corresponde dar seguimiento a lo pendiente, conservar la evidencia y obtener las autorizaciones de ajuste antes del cierre administrativo.`;
    const closing = closingSheet({ right: small, footer: 'Este documento no reemplaza la autorización formal de un ajuste contable.', group: c, overall, helpers, conclusion,
      roles: [['Responsable de conteo', counters], ['Responsable de almacén', managers], ['Auditoría · Control de Gestión', []]] });
    return [page1, page2, page3, page4, ...annexes, closing].join('');
  }

  function historyTable(c, inv) {
    const history = c.history || [];
    if (!history.length) return '<p class="mr-more">Sin inventarios cerrados en los datos cargados.</p>';
    const rows = history.map((closure, index) => {
      const value = ratio(closure.exactUnits, closure.totalUnits) ?? num(closure.eri);
      const last = index === history.length - 1;
      return `<tr class="${last ? 'mr-strong' : ''}"><td>${esc(closure.name || closure.id)}</td><td>${esc(new Date(closure.date).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' }))}</td><td class="num">${qty(closure.exactUnits)}</td><td class="num">${qty(closure.totalUnits)}</td><td><div class="mr-ibar"><span class="mr-track"><i style="width:${Math.max(0, (value - 80) * 5)}%;background:${last ? NAVY : GRAY}"></i><u></u></span>${pct(value)}</div></td></tr>`;
    }).join('');
    const note = history.length === 1 ? '<p class="mr-more">Este centro no tiene un inventario anterior con el que comparar.</p>' : '<p class="mr-more">La barra muestra el porcentaje; la marca oscura es el 95%.</p>';
    return `<table><thead><tr><th>Inventario</th><th>Cierre</th><th class="num">Correctas</th><th class="num">De</th><th>Porcentaje</th></tr></thead><tbody>${rows}</tbody></table>${note}`;
  }
  function flowTable(c) {
    const f = c.flow, total = f.firstDifferences;
    const rows = [['Resueltas en reconteo', f.resolved, GRAY], ['Siguen en faltante', f.stillShort, RED], ['Siguen en sobrante', f.stillSurplus, BLUE]];
    const max = Math.max(...rows.map(row => row[1]), 1);
    return `<table><thead><tr><th>Resultado</th><th>Líneas</th><th class="num">% de ${qty(total)}</th></tr></thead><tbody>${rows.map(([label, value, color]) => `<tr><td>${label}</td><td>${hbar(value, max, 165, color, qty(value))}</td><td class="num">${total ? Math.round(value / total * 100) : 0}%</td></tr>`).join('')}</tbody><tfoot><tr><td>Primer conteo</td><td>${qty(total)} · ${qty(c.firstCount.shortage.lines)} faltantes y ${qty(c.firstCount.surplus.lines)} sobrantes</td><td class="num">${total ? '100' : '0'}%</td></tr></tfoot></table>${f.appeared ? `<p class="mr-more">Además, ${qty(f.appeared)} líneas sin diferencia en el primer conteo la tuvieron al cierre.</p>` : ''}`;
  }
  const codeBlocks = (list, cost, total, color) => {
    const top = list.slice(0, 5).map(item => ({ label: item.sku, value: cost(item), color }));
    const rest = Math.max(0, num(total) - sum(top, item => item.value));
    if (rest > 0.005 && list.length > 5) top.push({ label: `${qty(list.length - 5)} líneas más`, value: rest, color: '#6f7888' });
    return top;
  };
  function issueTable(issues) {
    const swatch = cause => `<i class="mr-swatch" style="background:${CAUSES[cause]?.color}"></i>`;
    return `<table data-split><thead><tr><th>Código</th><th>Descripción</th><th>Clase</th><th>Almacén</th><th>Ubicación principal</th><th>Otras ubicaciones</th><th>Causa</th><th class="num">Unid. sistema</th><th class="num">Valor Bs</th></tr></thead><tbody>${issues.map(item => `<tr><td>${esc(item.sku)}</td><td>${esc(item.descripcion)}</td><td>${esc(item.abc)}</td><td>${esc(item.warehouse)}</td><td>${esc(item.primary || 'Sin registrar')}</td><td>${esc(item.others.join(' · ') || '—')}</td><td>${swatch(item.cause)}${esc(CAUSES[item.cause]?.label)}</td><td class="num">${qty(item.units)}</td><td class="num">${decimal(item.value)}</td></tr>`).join('') || '<tr><td colspan="9">Sin códigos con baja.</td></tr>'}</tbody></table>`;
  }
  function multiLocationTable(list) {
    const rows = list.flatMap(sku => (sku.locations || []).map(location => `<tr><td>${esc(sku.sku)}</td><td>${esc(sku.descripcion)}</td><td>${esc(location.almacen)}</td><td>${esc(location.ubicacion)}${location.isAdditionalLocation ? ' (adicional)' : ''}</td><td class="num">${qty(location.stockSistema)}</td><td class="num">${qty(location.diffFinal ?? location.diferencia)}</td></tr>`)).join('');
    return `<table data-split><thead><tr><th>Código</th><th>Descripción</th><th>Almacén</th><th>Ubicación</th><th class="num">Sistema</th><th class="num">Dif. final</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Sin códigos en varias ubicaciones.</td></tr>'}</tbody></table>`;
  }

  function renderConsolidated(inv, metrics, data) {
    const centers = data.centers.map(c => ({ ...c, i: indicators(c), lvl: result(c) }));
    const pending = data.pendingCenters || [];
    const total = {
      units: sum(centers, c => c.units), unitsExact: sum(centers, c => c.unitsExact), unitsExact1: sum(centers, c => c.unitsExact1),
      skus: sum(centers, c => c.skus), skusExact: sum(centers, c => c.skusExact), skusExact1: sum(centers, c => c.skusExact1),
      value: sum(centers, c => c.value),
      shortage: { lines: sum(centers, c => c.shortage.lines), units: sum(centers, c => c.shortage.units), cost: sum(centers, c => c.shortage.cost) },
      surplus: { lines: sum(centers, c => c.surplus.lines), units: sum(centers, c => c.surplus.units), cost: sum(centers, c => c.surplus.cost) },
      damage: { lines: sum(centers, c => c.damage.lines), units: sum(centers, c => c.damage.units), cost: sum(centers, c => c.damage.cost) },
      firstCount: { shortage: { cost: sum(centers, c => c.firstCount.shortage.cost) }, surplus: { cost: sum(centers, c => c.firstCount.surplus.cost) } },
      eru: { evaluated: sum(centers, c => c.eru.evaluated), exact: sum(centers, c => c.eru.exact), causes: Object.fromEntries(CAUSE_KEYS.map(key => [key, sum(centers, c => c.eru.causes[key])])) }
    };
    const i = indicators(total);
    const count = key => centers.filter(c => c.lvl.key === key).length;
    const lowest = c => [['Unidades', c.i.units, `${qty(c.unitsExact)} de ${qty(c.units)}`], ['Códigos', c.i.codes, `${qty(c.skusExact)} de ${qty(c.skus)}`], ['Valor', c.i.money, `Bs ${qty(c.i.valueExact)} de ${qty(c.value)}`]].sort((a, b) => num(a[1]) - num(b[1]))[0];
    const byWorst = centers.slice().sort((a, b) => num(lowest(a)[1]) - num(lowest(b)[1]));
    const met = count('perfect') + count('ok') + count('min');
    const known = centers.length + pending.length;
    const levelsLine = `${count('perfect')} perfecto · ${count('ok')} cumplimiento · ${count('min')} mínimo · ${count('no')} no cumple${pending.length ? ` · ${pending.length} sin cierre` : ''}`;
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const [reportYear, reportMonth] = String(metrics.filters?.month || '').split('-');
    const period = reportMonth ? `Inventarios creados en ${monthNames[Number(reportMonth) - 1]} ${esc(reportYear)}` : metrics.filters?.startDate || metrics.filters?.endDate ? `${esc(metrics.filters.startDate || 'Inicio')} a ${esc(metrics.filters.endDate || 'Actualidad')}` : esc(inv?.name || 'Todo el histórico');

    const page1 = sheet(`Consolidado nacional · ${known} centros`, period, `
      <div class="mr-row mr-c4">
        <div class="mr-kpi top-${count('no') ? 'no' : 'ok'}"><div class="mr-kpi-top"><span>Centros que alcanzan al menos el mínimo</span></div><strong>${met} de ${known}</strong><span class="mr-qty">${levelsLine}</span><small>El nivel de cada centro es el más bajo de unidades, códigos y valor</small></div>
        ${kpi({ label: 'Unidades correctas', value: pct(i.units), status: level(i.units), pair: [i.units1, i.units], line: `${qty(total.unitsExact)} de ${qty(total.units)} unidades`, sub: `Primer conteo: ${qty(total.unitsExact1)} (${pct(i.units1)})` })}
        ${kpi({ label: 'Códigos correctos', value: pct(i.codes), status: level(i.codes), pair: [i.codes1, i.codes], line: `${qty(total.skusExact)} de ${qty(total.skus)} códigos`, sub: `Primer conteo: ${qty(total.skusExact1)} (${pct(i.codes1)})` })}
        ${kpi({ label: 'Valor correcto', value: pct(i.money), status: level(i.money), pair: [i.money1, i.money], line: `${bs(i.valueExact)} de ${bs(total.value)}`, sub: `Primer conteo: ${pct(i.money1)}` })}
      </div>
      <div class="mr-row mr-c4">
        ${kpi({ label: 'Faltantes', value: bs(total.shortage.cost), line: `${qty(total.shortage.lines)} líneas · ${qty(total.shortage.units)} unidades`, sub: `${total.value > 0 ? pct(total.shortage.cost / total.value * 100) : 'No disponible'} del valor revisado`, cls: 'top-short' })}
        ${kpi({ label: 'Sobrantes', value: bs(total.surplus.cost), line: `${qty(total.surplus.lines)} líneas · ${qty(total.surplus.units)} unidades`, sub: `${total.value > 0 ? pct(total.surplus.cost / total.value * 100) : 'No disponible'} del valor revisado`, cls: 'top-surplus' })}
        ${kpi({ label: 'Averías', value: bs(total.damage.cost), line: `${qty(total.damage.lines)} líneas · ${qty(total.damage.units)} unidades`, sub: 'Se informan aparte', cls: 'top-damage' })}
        ${kpi({ label: 'Ubicación correcta (ERU)', value: pct(i.eru), line: `${qty(total.eru.exact)} de ${qty(total.eru.evaluated)} códigos por almacén`, sub: 'No cuenta para el resultado', cls: 'top-info' })}
      </div>
      ${panel(`Estado por centro · ${levelsLine}`, `<div class="mr-tiles">${byWorst.map(c => { const low = lowest(c); return `<div class="mr-tile lvl-${c.lvl.key}"><b>${esc(c.name)}</b><strong>${c.lvl.icon} ${pct(low[1])}</strong><small>${esc(c.lvl.label)}<br>${low[0]}: ${low[2]}</small></div>`; }).join('')}${pending.map(c => `<div class="mr-tile lvl-nil"><b>${esc(c.code)} - ${esc(c.name)}</b><strong>–</strong><small>Sin cierre en este corte</small></div>`).join('')}</div>${scaleLegend}`)}`, 'Totales calculados sumando las bases de cada centro. Barra oscura: cierre · Barra clara: primer conteo · Marcas: 95% y 98%.', 'Resumen consolidado');

    const kMoney = value => value >= 1e6 ? `${(value / 1e6).toLocaleString('es-BO', { maximumFractionDigits: 2 })} M` : qty(value);
    const cell = (value, quantity) => `<td class="mr-cell lvl-${level(value).key}">${pct(value)}<small>${quantity}</small></td>`;
    const previous = c => {
      const history = c.history || [];
      const prior = history.slice(0, -1).reverse().find(closure => closure.type === history[history.length - 1].type);
      if (!prior) return '<span class="mr-more">Sin inventario anterior</span>';
      const before = ratio(prior.exactUnits, prior.totalUnits) ?? num(prior.eri), now = c.i.units, delta = now - before;
      return `${pct(before)} → ${pct(now)}<br><span class="mr-more">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} puntos</span>`;
    };
    const money2 = (label, a) => `${bs(a.cost)}<br><span class="mr-more">${qty(a.lines)} lín. · ${qty(a.units)} u.</span>`;
    const page2 = sheet('Comparación entre centros', 'Peor resultado primero', `<table class="mr-score" data-split><thead><tr><th>Centro</th><th>Resultado</th><th class="mr-center">Unidades</th><th class="mr-center">Códigos</th><th class="mr-center">Valor (Bs)</th><th class="mr-center">Ubicación</th><th class="num">Faltantes</th><th class="num">Sobrantes</th><th class="num">Averías</th><th class="num">Unidades: inventario anterior → este</th></tr></thead><tbody>${byWorst.map(c => `<tr><td class="mr-strong">${esc(c.name)}</td><td>${chip(c.lvl)}</td>${cell(c.i.units, `${qty(c.unitsExact)}/${qty(c.units)}`)}${cell(c.i.codes, `${qty(c.skusExact)}/${qty(c.skus)}`)}${cell(c.i.money, `${kMoney(c.i.valueExact)}/${kMoney(c.value)}`)}${cell(c.i.eru, `${qty(c.eru.exact)}/${qty(c.eru.evaluated)}`)}<td class="num">${money2('', c.shortage)}</td><td class="num">${money2('', c.surplus)}</td><td class="num">${money2('', c.damage)}</td><td class="num">${previous(c)}</td></tr>`).join('')}${pending.map(c => `<tr><td class="mr-strong">${esc(c.code)} - ${esc(c.name)}</td><td>${chip({ key: 'nil', icon: '–', label: 'Sin cierre' })}</td><td colspan="4" class="mr-center mr-more">Sin cierre en este corte</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td></tr>`).join('')}</tbody><tfoot><tr><td>Consolidado (${centers.length} centros)</td><td>${chip(worst([i.units, i.codes, i.money]))}</td>${[[i.units, `${qty(total.unitsExact)}/${qty(total.units)}`], [i.codes, `${qty(total.skusExact)}/${qty(total.skus)}`], [i.money, `${kMoney(i.valueExact)}/${kMoney(total.value)}`], [i.eru, `${qty(total.eru.exact)}/${qty(total.eru.evaluated)}`]].map(([value, quantity]) => `<td class="mr-center">${pct(value)}<br><span class="mr-more">${quantity}</span></td>`).join('')}<td class="num">${bs(total.shortage.cost)}</td><td class="num">${bs(total.surplus.cost)}</td><td class="num">${bs(total.damage.cost)}</td><td></td></tr></tfoot></table>${scaleLegend}`, 'Ubicación se informa y no cuenta para el resultado. Última columna: unidades correctas del inventario anterior del centro y de este.');

    const ranked = (side, color, noun) => {
      const rows = centers.slice().sort((a, b) => b[side].cost - a[side].cost);
      const top = sum(rows.slice(0, 3), c => c[side].cost), all = total[side].cost;
      let running = 0;
      return panel(`${noun}: ${bs(all)} · 3 centros concentran ${all ? Math.round(top / all * 100) : 0}%`, `<table data-split><thead><tr><th>Centro</th><th>Bs</th><th class="num">Líneas</th><th class="num">Unid.</th><th class="num">Acum.</th></tr></thead><tbody>${rows.map((c, index) => { running += c[side].cost; return `<tr><td class="${index < 3 ? 'mr-strong' : ''}">${esc(c.center)}</td><td>${hbar(c[side].cost, Math.max(rows[0][side].cost, 1), 215, index < 3 ? color : GRAY, qty(c[side].cost))}</td><td class="num">${qty(c[side].lines)}</td><td class="num">${qty(c[side].units)}</td><td class="num">${all ? Math.round(running / all * 100) : 0}%</td></tr>`; }).join('')}</tbody></table>`);
    };
    const classRows = side => centers.slice().sort((a, b) => b[side].cost - a[side].cost).slice(0, 5).map(c => ({ name: c.name, cells: Object.fromEntries(c.byClass.map(g => [g.name, { [side]: g[side].cost }])) }));
    const page3 = sheet('Faltantes y sobrantes por centro', 'Se muestran por separado', `
      <div class="mr-row mr-c2">${ranked('shortage', RED, 'Faltantes')}${ranked('surplus', BLUE, 'Sobrantes')}</div>
      <div class="mr-row mr-c2">
        ${panel('Faltantes (Bs) por clase · 5 centros con más faltante', heat(classRows('shortage'), 'shortage', 'red', 'Centro'))}
        ${panel('Sobrantes (Bs) por clase · 5 centros con más sobrante', heat(classRows('surplus'), 'surplus', 'blue', 'Centro'))}
      </div>`, 'Las líneas son registros de conteo. Ningún monto compensa a otro.');

    const eruRows = centers.slice().sort((a, b) => num(a.i.eru) - num(b.i.eru));
    const lossOf = c => sum(CAUSE_KEYS, key => c.eru.causes[key]);
    const maxLoss = Math.max(...eruRows.map(lossOf), 1);
    const page4 = sheet('Ubicación (ERU) y causas de la baja', 'Todos los centros', `
      <div class="mr-row mr-c13">
        ${kpi({ label: 'Ubicación correcta (ERU)', value: pct(i.eru), line: `${qty(total.eru.exact)} de ${qty(total.eru.evaluated)} códigos por almacén`, sub: 'No cuenta para el resultado de cumplimiento', cls: 'top-info' })}
        ${panel('Causas de la baja · todos los centros', causeTable(total.eru))}
      </div>
      ${panel('Por centro · peor ubicación primero', `<table data-split><thead><tr><th>Centro</th><th class="num">Correctos</th><th class="num">%</th><th class="num">Con baja</th><th>Causas</th>${CAUSE_KEYS.map(key => `<th class="num">${esc({ multiple: 'Varias ubic.', format: 'Formato', none: 'Sin ubic.', additional: 'Solo adic.' }[key])}</th>`).join('')}</tr></thead><tbody>${eruRows.map(c => `<tr><td class="mr-strong">${esc(c.name)}</td><td class="num">${qty(c.eru.exact)} / ${qty(c.eru.evaluated)}</td><td class="num">${pct(c.i.eru)}</td><td class="num">${qty(lossOf(c))}</td><td class="mr-wide">${stack(c.eru.causes, maxLoss, 230)}</td>${CAUSE_KEYS.map(key => `<td class="num">${qty(c.eru.causes[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>${causeLegend}`, 'mr-plain')}`, 'Cada almacén se evalúa por separado y cada código por almacén entra en una sola causa. La lista está en el informe de cada centro.');

    const helpers = differences((metrics.discrepanciesList || []).filter(item => item && typeof item === 'object'));
    const globalTable = (rows, color, sign, all) => `<table data-split class="mr-diff"><thead><tr><th>Centro</th><th>Código</th><th>Clase</th><th class="num">Unid.</th><th>Bs</th><th class="num">% del total</th><th>Motivo</th></tr></thead><tbody>${rows.map(item => `<tr><td>${esc(item.center)}</td><td>${esc(item.sku)}</td><td>${esc(item.abc)}</td><td class="num">${sign}${qty(Math.abs(helpers.final(item)))}</td><td>${hbar(helpers.cost(item), Math.max(helpers.cost(rows[0]), 1), 90, color, qty(helpers.cost(item)))}</td><td class="num">${all ? pct(helpers.cost(item) / all * 100) : '—'}</td><td>${esc(justification(item))}</td></tr>`).join('') || '<tr><td colspan="7">Sin registros.</td></tr>'}</tbody></table>`;
    const damageRows = centers.slice().sort((a, b) => b.damage.cost - a.damage.cost);
    const page5 = sheet('Mayores diferencias', period, `
      ${panel('Mayores faltantes de todos los centros', globalTable(helpers.shortages.slice(0, 8), RED, '−', total.shortage.cost), 'mr-plain')}
      ${panel('Mayores sobrantes de todos los centros', globalTable(helpers.surpluses.slice(0, 8), BLUE, '+', total.surplus.cost), 'mr-plain')}`, 'Faltantes y sobrantes se muestran por separado; ninguno compensa al otro.');
    const page6 = sheet('Averías y cobertura', period, `
      <div class="mr-row mr-c2">
        ${panel(`Averías por centro · ${bs(total.damage.cost)} · ${qty(total.damage.lines)} líneas`, `<table class="mr-flat"><tbody>${damageRows.slice(0, 6).map(c => `<tr><td>${esc(c.name)}</td><td>${hbar(c.damage.cost, Math.max(damageRows[0].damage.cost, 1), 110, AMBER, bs(c.damage.cost))}</td><td class="num">${qty(c.damage.lines)} lín.</td></tr>`).join('')}</tbody></table>${damageRows.length > 6 ? `<p class="mr-more">${damageRows.length - 6} centros más · ${bs(sum(damageRows.slice(6), c => c.damage.cost))}</p>` : ''}`)}
        ${panel('Cobertura del corte', `<table class="mr-flat"><tbody><tr><td>Centros con cierre</td><td class="num mr-strong">${centers.length} de ${known}</td></tr><tr><td>Sin cierre</td><td class="num mr-strong mr-wrap">${pending.map(c => `${esc(c.code)} ${esc(c.name)}`).join(', ') || 'Ninguno'}</td></tr><tr><td>Inventarios incluidos</td><td class="num mr-strong">${qty(sum(centers, c => c.inventories.length))}</td></tr><tr><td>Centros con más de un inventario</td><td class="num mr-strong mr-wrap">${centers.filter(c => c.inventories.length > 1).map(c => `${esc(c.center)} (${c.inventories.length})`).join(', ') || 'Ninguno'}</td></tr><tr><td>Códigos revisados</td><td class="num mr-strong">${qty(total.skus)}</td></tr><tr><td>Valor revisado</td><td class="num mr-strong">${bs(total.value)}</td></tr></tbody></table>`)}
      </div>`, 'El corte es el filtro elegido en el dashboard. Cada centro tiene su informe aparte.');
    const overall = worst([i.units, i.codes, i.money]);
    const belowMinimum = centers.filter(c => c.lvl.key === 'no').map(c => esc(c.name));
    const differing = total.shortage.lines + total.surplus.lines;
    const scope = period ? ` (${period})` : '';
    const conclusion = `El consolidado de ${known} centros${scope} revisó ${qty(metrics.summary?.totalItemsAudited ?? total.skus)} líneas y ${qty(total.units)} unidades del sistema, con resultado <b>${esc(overall.label.toLowerCase())}</b>. ${met} de ${known} centros alcanzan al menos el mínimo${pending.length ? ` y ${pending.length} no ${pending.length === 1 ? 'tiene' : 'tienen'} cierre en este corte` : ''}. Al cierre, la exactitud es ${pct(i.units)} en unidades, ${pct(i.codes)} en códigos y ${pct(i.money)} en valor; la ubicación es ${pct(i.eru)}. ${differing ? `Quedan ${qty(differing)} ${differing === 1 ? 'línea' : 'líneas'} con diferencia: ${differencesText(total)}.` : 'No quedan líneas con diferencia.'}${total.damage.lines ? ` Las averías suman ${bs(total.damage.cost)} (${linesOf(total.damage)}).` : ''} Corresponde dar seguimiento a lo pendiente, conservar la evidencia y obtener las autorizaciones de ajuste antes del cierre administrativo.`;
    const closing = closingSheet({ right: period, footer: 'Este documento no reemplaza la autorización formal de un ajuste contable. Cada centro firma además su propio informe.', group: total, overall, helpers, conclusion,
      extraActions: [
        belowMinimum.length && ['Atender los centros que no cumplen', `Priorizar el seguimiento en ${belowMinimum.join(', ')}.`, `${belowMinimum.length} ${belowMinimum.length === 1 ? 'centro' : 'centros'}`, '—'],
        pending.length && ['Completar los cierres pendientes', `Falta el cierre de ${pending.map(c => `${esc(c.code)} ${esc(c.name)}`).join(', ')}.`, `${pending.length} ${pending.length === 1 ? 'centro' : 'centros'}`, '—']
      ],
      roles: [['Responsable de conteo', []], ['Responsable de almacén', []], ['Auditoría · Control de Gestión', []]] });
    return [page1, page2, page3, page4, page5, page6, closing].join('');
  }

  window.ManagementReport = {
    level,
    worst,
    indicators,
    kind(metrics) {
      return (metrics?.reportData?.centers || []).length > 1 ? 'consolidado' : 'centro';
    },
    render(inv, metrics) {
      const data = metrics?.reportData;
      const pageRule = '<style>@media print { @page { size: A4 landscape; margin: 0; } }</style>';
      if (!data?.centers?.length) {
        return `${pageRule}<div class="mr-report">${sheet('Informe de inventario', '', '<p class="mr-empty">No hay datos auditados para este filtro.</p>', 'Datos insuficientes para evaluar el cumplimiento.')}</div>`;
      }
      const html = data.centers.length > 1 ? renderConsolidated(inv, metrics, data) : renderCenter(inv, metrics, data.centers[0]);
      return `${pageRule}<div class="mr-report">${html}</div>`;
    },
    // Moves what does not fit into continuation sheets, splitting long tables by rows.
    paginate(container) {
      const report = container?.querySelector?.('.mr-report');
      if (!report) return;
      const continuation = source => {
        const next = source.cloneNode(true);
        next.querySelector('.mr-body').replaceChildren();
        source.after(next);
        return next;
      };
      const splitTable = (block, table, limit) => {
        const rows = Array.from(table.tBodies[0]?.rows || []);
        const footHeight = table.tFoot ? table.tFoot.getBoundingClientRect().height : 0;
        const index = rows.findIndex(row => row.getBoundingClientRect().bottom + footHeight > limit);
        if (index <= 0) return null;
        const rest = block.cloneNode(true);
        const restTable = rest.matches('table[data-split]') ? rest : rest.querySelector('table[data-split]');
        Array.from(restTable.tBodies[0].rows).slice(0, index).forEach(row => row.remove());
        rows.slice(index).forEach(row => row.remove());
        table.tFoot?.remove();
        const heading = rest.querySelector?.('h3');
        if (heading) heading.textContent += ' (continuación)';
        return rest;
      };
      let sheet = report.querySelector('.mr-sheet');
      while (sheet) {
        const body = sheet.querySelector('.mr-body');
        const limit = body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom || 0);
        const children = Array.from(body.children);
        const index = children.findIndex(child => child.getBoundingClientRect().bottom > limit + 0.5);
        if (index >= 0) {
          const child = children[index];
          const table = child.matches('table[data-split]') ? child : child.querySelector('table[data-split]');
          const rest = table ? splitTable(child, table, limit) : null;
          const movable = children.slice(rest ? index + 1 : index);
          if (rest || index > 0) {
            const next = continuation(sheet);
            const nextBody = next.querySelector('.mr-body');
            if (rest) nextBody.appendChild(rest);
            movable.forEach(node => nextBody.appendChild(node));
          }
        }
        sheet = sheet.nextElementSibling;
      }
      const sheets = Array.from(report.querySelectorAll('.mr-sheet'));
      sheets.forEach((page, i) => { page.querySelector('.mr-page-no').textContent = `${i + 1} / ${sheets.length}`; });
    }
  };
})();
