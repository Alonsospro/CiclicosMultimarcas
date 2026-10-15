// Weekly reliability is based on signed counts and an explicit physical review.
window.CounterReliabilityPanel = {
  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  },
  percent(value) { return value == null ? 'Sin evaluación' : `${Number(value).toFixed(1)}%`; },
  quantity(value) { return value ? `B/E ${value.good} · M/E ${value.bad} · Total ${value.total}` : 'Sin firma'; },
  labelTables(host) {
    host.querySelectorAll('table').forEach(table => {
      const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent);
      table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((td, index) => { td.dataset.label = labels[index] || ''; }));
    });
  },
  render(data, legacyWorkers = []) {
    this.data = data;
    const host = document.getElementById('weekly-counter-reliability');
    if (!host) return;
    host.hidden = !data?.inventories?.length;
    document.getElementById('legacy-worker-ranking').hidden = !!data?.inventories?.length && !legacyWorkers.length;
    if (host.hidden) return;
    const e = value => this.escape(value);
    host.innerHTML = `<div class="card-header"><div><h3 class="card-title">Confiabilidad verificada · Semanales</h3>
      <p>Compara cada primer conteo firmado con la comprobación física. Cuadrar una justificación no mejora esta calificación.</p></div></div>
      <div class="reliability-content"><div class="reliability-summary">
      <div><strong>${this.percent(data.reliability)}</strong><span>${data.correct} correctos de ${data.verified} verificados</span></div>
      <div><strong>${this.percent(data.coverage)}</strong><span>Cobertura: ${data.verified} de ${data.counted} registros con autoría</span></div>
      <div><strong>${data.unavailable}</strong><span>Registros históricos sin evidencia evaluable</span></div></div>
      <p>Cada etapa cuenta una vez. Una diferencia de clasificación B/E–M/E también es un error, aunque el total coincida. Compare siempre el tamaño de la muestra y su cobertura.</p>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Contador / Centro</th><th>Firmados y en curso</th><th>Verificados / Correctos</th><th>Cobertura</th><th>Confiabilidad</th><th>Autoverificados</th><th>Rectificados tras firma</th><th>Detalle</th></tr></thead><tbody>
      ${data.workers.map((w, index) => `<tr><td>${e(w.worker)}<br><small>${e(w.center)}</small></td><td>${w.counted}</td>
      <td>${w.verified} / ${w.correct}</td><td>${this.percent(w.coverage)}</td><td><strong>${this.percent(w.reliability)}</strong><br><small>${w.pending} pendientes</small></td>
      <td>${w.selfVerified}</td><td>${w.corrected}</td><td><button class="btn btn-secondary btn-sm" data-reliability-worker="${index}" ${w.records.length ? '' : 'disabled'}>Ver evidencia</button></td></tr>`).join('') || '<tr><td colspan="8">Aún no hay conteos registrados con la nueva evaluación.</td></tr>'}
      </tbody></table></div>
      <div class="reliability-actions"><label for="physical-review-inventory">Comprobar físicamente</label>
      <select id="physical-review-inventory" class="form-input">${data.inventories.filter(inv => !inv.readOnly).map(inv => `<option value="${e(inv.id)}">${e(inv.name)} · ${e(inv.center)}</option>`).join('')}</select>
      <button class="btn btn-primary" id="open-physical-review">Revisar registros</button></div></div>`;
    this.labelTables(host);
    host.querySelectorAll('[data-reliability-worker]').forEach(button => button.addEventListener('click', () => this.showWorker(data.workers[Number(button.dataset.reliabilityWorker)])));
    const user = window.Auth?.currentUser;
    host.querySelector('.reliability-actions').hidden = !(user?.isSuperadmin || ['ADMIN', 'ENCARGADO'].includes(user?.role)) || !data.inventories.some(inv => !inv.readOnly);
    host.querySelector('#open-physical-review').addEventListener('click', () => this.openReview(host.querySelector('select').value));
    // Do not average incompatible models in the headline KPI.
    document.getElementById('stat-worker-accuracy').textContent = legacyWorkers.length ? 'Por modelo' : this.percent(data.reliability);
    document.getElementById('stat-worker-edits-total').textContent = `${data.verified} verificaciones semanales`;
    document.getElementById('stat-worker-rating-badge').textContent = legacyWorkers.length ? 'Ver detalle' : `Cobertura ${this.percent(data.coverage)}`;
  },
  dialog(title, body) {
    document.getElementById('counter-evidence-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'counter-evidence-dialog';
    dialog.className = 'counter-evidence-dialog';
    dialog.innerHTML = `<div class="reliability-dialog-heading"><h3>${this.escape(title)}</h3><button type="button" class="btn btn-secondary" data-close>Cerrar</button></div>${body}`;
    dialog.setAttribute('aria-label', title);
    this.labelTables(dialog);
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
    return dialog;
  },
  showWorker(worker) {
    const e = value => this.escape(value);
    this.dialog(`${worker.worker} · Centro ${worker.center}`, `<p>Exactitud B/E: ${this.percent(worker.goodAccuracy)} · M/E: ${this.percent(worker.badAccuracy)} · Total: ${this.percent(worker.totalAccuracy)}</p>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Inventario / SKU / Almacén</th><th>Etapa / Primer firmado</th><th>Comprobación física</th><th>Resultado</th></tr></thead><tbody>
      ${worker.records.map(record => `<tr><td>${e(record.inventoryId)}<br>${e(record.sku)} · ${e(record.warehouse)}<br>${e(record.location)}</td>
      <td>${record.stage ? `Reconteo ${record.stage}` : 'Conteo inicial'}<br>${e(this.quantity(record.initial))}<br><small>${e(record.initial?.signedAt || '')}</small></td>
      <td>${record.verification ? `${e(this.quantity(record.verification.observed))}<br>${e(record.verification.actor.name)}${record.selfVerified ? ' · Autoverificación' : ''}<br>${e(record.verification.reason)}` : 'Pendiente'}
      </td><td>${e(record.status)}<br>${record.corrections.length} rectificaciones tras firma</td></tr>`).join('')}
      </tbody></table></div>`);
  },
  async openReview(inventoryId) {
    if (!inventoryId) return;
    const dialog = this.dialog('Comprobación física del inventario semanal', '<p role="status">Cargando registros…</p>');
    try {
      const result = await window.API.request(`/inventories/${encodeURIComponent(inventoryId)}/physical-reviews`);
      if (!dialog.isConnected) return;
      const e = value => this.escape(value);
      const body = document.createElement('div');
      body.innerHTML = `<p>Seleccione también productos que cuadraron con el sistema. La muestra no debe limitarse a diferencias. Esta comprobación no cambia las cantidades del inventario.</p>
      <label>Buscar SKU, almacén o descripción<input class="form-input" type="search" data-review-search></label>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Producto / Almacén</th><th>Estado de la evidencia</th><th>Comprobación</th></tr></thead><tbody>
      ${result.rows.map((row, index) => `<tr data-review-row="${index}"><td>${e(row.sku)} · ${e(row.warehouse)}<br>${e(row.description)}<br><small>${e(row.location)}</small></td>
        <td>${e(row.ready ? row.verification ? row.verification.comparable ? 'Verificado' : 'No comparable' : 'Pendiente de verificación' : row.reason)}</td>
        <td><button class="btn btn-secondary btn-sm" data-review-item="${index}" ${row.ready ? '' : 'disabled'}>${row.verification ? 'Revisar / Rectificar' : 'Verificar'}</button></td></tr>`).join('')}
      </tbody></table></div>`;
      dialog.querySelector('[role="status"]').replaceWith(body);
      this.labelTables(body);
      body.querySelector('[data-review-search]').addEventListener('input', event => {
        const query = event.target.value.toLowerCase().trim();
        body.querySelectorAll('[data-review-row]').forEach(tr => { tr.hidden = !tr.textContent.toLowerCase().includes(query); });
      });
      body.querySelectorAll('[data-review-item]').forEach(button => button.addEventListener('click', () => this.editReview(inventoryId, result.rows[Number(button.dataset.reviewItem)])));
    } catch (error) {
      if (dialog.isConnected) dialog.querySelector('[role="status"]').textContent = error.message;
    }
  },
  editReview(inventoryId, row) {
    const e = value => this.escape(value);
    const dialog = this.dialog(`${row.sku} · Almacén ${row.warehouse}`, `<p>${e(row.description)} · ${e(row.location)}</p>
      <form data-physical-form><p>Registre las cantidades que comprobó físicamente. Se permite verificar su propio conteo y quedará identificado.</p>
      <label>Comparabilidad<select class="form-input" name="comparable"><option value="true">Sin movimientos: comparable con los conteos firmados</option><option value="false">Hubo movimientos o evidencia insuficiente: no comparable</option></select></label>
      <div data-observation class="reliability-summary"><label>Buen estado<input class="form-input" type="number" min="0" step="1" name="good" required></label>
      <label>Mal estado<input class="form-input" type="number" min="0" step="1" name="bad" required></label></div>
      <label>Explicación de la comprobación<textarea class="form-input" name="reason" minlength="5" maxlength="1000" rows="3" required></textarea></label>
      <label data-physical-check><input type="checkbox" name="physicallyChecked" required> Confirmo que comprobé físicamente estas cantidades.</label>
      <p role="status" data-review-message></p><button class="btn btn-primary" type="submit">Guardar comprobación</button>
      <button class="btn btn-secondary" type="button" data-back>Volver a registros</button></form>
      <details><summary>Conteos firmados e historial de verificaciones</summary>
      ${row.signed.map(s => `<p>${s.stage ? `Reconteo ${s.stage}` : 'Conteo inicial'} · ${e(s.actor.name)}: ${e(this.quantity(s))} · ${e(s.signedAt)}</p>`).join('')}
      ${row.verificationHistory.map(v => `<p>${e(v.at)} · ${e(v.actor.name)} · ${v.comparable ? e(this.quantity(v.observed)) : 'No comparable'}<br>${e(v.reason)}</p>`).join('') || '<p>Sin verificaciones previas.</p>'}</details>`);
    const form = dialog.querySelector('form');
    form.querySelector('[data-back]').addEventListener('click', () => this.openReview(inventoryId));
    form.elements.comparable.addEventListener('change', () => {
      const comparable = form.elements.comparable.value === 'true';
      form.querySelector('[data-observation]').hidden = !comparable;
      form.querySelector('[data-physical-check]').hidden = !comparable;
      for (const name of ['good', 'bad', 'physicallyChecked']) form.elements[name].required = comparable;
    });
    let submission = null;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = {itemId: row.itemId, revision: row.revision, comparable: form.elements.comparable.value === 'true',
        good: form.elements.good.value, bad: form.elements.bad.value, physicallyChecked: form.elements.physicallyChecked.checked, reason: form.elements.reason.value};
      const fingerprint = JSON.stringify(data);
      if (!submission || submission.fingerprint !== fingerprint) submission = {fingerprint, id: crypto.randomUUID()};
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      form.querySelector('[data-review-message]').textContent = 'Guardando comprobación…';
      try {
        await window.API.request(`/inventories/${encodeURIComponent(inventoryId)}/physical-reviews`, {method: 'POST', body: JSON.stringify({...data, requestId: submission.id})});
        window.Toast?.success('Comprobación física guardada.');
        await window.DashboardView.loadDashboard(true);
        if (dialog.isConnected) await this.openReview(inventoryId);
      } catch (error) {
        if (dialog.isConnected) { form.querySelector('[data-review-message]').textContent = error.message; button.disabled = false; }
      }
    });
  }
};
