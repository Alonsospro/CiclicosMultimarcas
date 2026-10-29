window.ProgressView = {
  groups: [],
  discoveryIssues: [],
  loading: false,

  init() {
    document.getElementById('progress-filter-type')?.addEventListener('change', () => this.render());
    document.getElementById('progress-filter-center')?.addEventListener('change', () => this.render());
    document.getElementById('progress-search')?.addEventListener('input', () => this.render());
    document.getElementById('progress-refresh')?.addEventListener('click', () => this.load(true));
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  },

  formatDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-BO', {dateStyle:'medium', timeZone:'America/La_Paz'}).format(new Date(value));
  },

  async load(refresh = false) {
    if (this.loading) return;
    this.loading = true;
    const groupsNode = document.getElementById('progress-groups');
    const refreshButton = document.getElementById('progress-refresh');
    if (groupsNode) groupsNode.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Actualizando el avance de inventarios...</p></div>';
    if (refreshButton) refreshButton.disabled = true;
    try {
      const response = await window.API.getInventoryTracking({type:'TODOS', center:'TODOS', ...(refresh ? {refresh:'true'} : {})});
      this.groups = response.groups || [];
      this.discoveryIssues = response.discoveryIssues || [];
      this.populateCenters();
      this.render();
    } catch (error) {
      if (groupsNode) groupsNode.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>No se pudo cargar el seguimiento.</p><small>${this.escape(error.message)}</small></div>`;
      const summary = document.getElementById('progress-summary');
      if (summary) summary.replaceChildren();
    } finally {
      this.loading = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  },

  populateCenters() {
    const select = document.getElementById('progress-filter-center');
    if (!select) return;
    const previous = select.value;
    const centers = [...new Set(this.groups.flatMap(group => group.inventories.map(inventory => inventory.center)).filter(Boolean))].sort();
    select.replaceChildren(new Option('Todos los centros', 'TODOS'), ...centers.map(center => new Option(`Centro ${center}`, center)));
    select.value = centers.includes(previous) ? previous : 'TODOS';
  },

  render() {
    const host = document.getElementById('progress-groups');
    const summary = document.getElementById('progress-summary');
    if (!host || !summary) return;
    const type = document.getElementById('progress-filter-type')?.value || 'TODOS';
    const center = document.getElementById('progress-filter-center')?.value || 'TODOS';
    const query = (document.getElementById('progress-search')?.value || '').trim().toLocaleLowerCase('es');
    const filtered = this.groups.map(group => ({
      ...group,
      inventories:group.inventories.filter(inventory => (type === 'TODOS' || inventory.type === type)
        && (center === 'TODOS' || inventory.center === center)
        && (!query || `${group.label} ${inventory.name} ${inventory.id} ${inventory.center} ${inventory.state} ${inventory.stageLabel}`.toLocaleLowerCase('es').includes(query)))
    })).filter(group => group.inventories.length);
    const inventories = filtered.flatMap(group => group.inventories);
    const open = inventories.filter(inventory => inventory.state === 'ABIERTO').length;
    const finished = inventories.length - open;
    const metric = (label, value, icon, tone) => `<article class="progress-kpi ${tone}"><i class="fa-solid ${icon}"></i><div><strong>${value}</strong><span>${label}</span></div></article>`;
    summary.innerHTML = `${metric('Lanzamientos', inventories.length, 'fa-layer-group', 'is-blue')}${metric('Abiertos', open, 'fa-clock', 'is-amber')}${metric('Finalizados', finished, 'fa-circle-check', 'is-green')}${metric('Grupos por terminación', filtered.length, 'fa-object-group', 'is-violet')}${this.discoveryIssues.length ? `<p class="progress-source-warning"><i class="fa-solid fa-triangle-exclamation"></i> No se pudo consultar el historial de ${this.discoveryIssues.length} tipo(s) de inventario; esos lanzamientos podrían no aparecer.</p>` : ''}`;

    if (!inventories.length) {
      host.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>No hay lanzamientos que coincidan con estos filtros.</p></div>';
      return;
    }

    host.innerHTML = filtered.map(group => {
      const rows = group.inventories.map(inventory => {
        const progress = inventory.progress || {completed:0,total:0,pending:0,percent:0};
        const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
        const closed = inventory.state === 'FINALIZADO';
        const validation = inventory.sourceStatus === 'valid' ? '' : `<small class="progress-validation">Fuente: ${this.escape(inventory.sourceStatus)}</small>`;
        const issue = (inventory.sourceIssues || []).length ? `<small class="progress-validation">${this.escape(inventory.sourceIssues[0])}</small>` : '';
        return `<tr>
          <td><strong>${this.escape(inventory.name)}</strong><small>${this.escape(inventory.id)}</small></td>
          <td>${this.escape(inventory.center)}</td>
          <td><span class="progress-state ${closed ? 'is-closed' : 'is-open'}">${closed ? 'Finalizado' : 'Abierto'}</span><small>${this.escape(inventory.status.replace(/_/g, ' '))}</small></td>
          <td><strong>${this.escape(inventory.stageLabel)}</strong>${validation}${issue}</td>
          <td><div class="progress-meter"><span style="width:${percent}%"></span></div><small>${progress.completed} de ${progress.total} · ${percent}%${progress.pending ? ` · ${progress.pending} pendiente(s)` : ''}</small></td>
          <td>${inventory.launchCount > 1 ? `<span class="progress-history-count"><i class="fa-solid fa-clock-rotate-left"></i> ${inventory.launchCount} lanzamientos</span><small>Estado más reciente</small>` : '<span class="progress-history-count is-single">1 lanzamiento</span>'}</td>
          <td>${this.formatDate(inventory.createdAt)}</td>
        </tr>`;
      }).join('');
      return `<article class="progress-group"><header><div><span class="progress-group-type">${this.escape(group.type)}</span><h3>${this.escape(group.label)}</h3><small>Terminación ${this.escape(group.suffix || 'sin numeración')} · ${group.inventories.length} inventario(s)</small></div><div class="progress-group-counts"><span class="progress-state is-open">${group.inventories.filter(item => item.state === 'ABIERTO').length} abiertos</span><span class="progress-state is-closed">${group.inventories.filter(item => item.state === 'FINALIZADO').length} finalizados</span></div></header><div class="table-responsive"><table class="data-table progress-table"><thead><tr><th>Inventario</th><th>Centro</th><th>Estado</th><th>Etapa actual</th><th>Avance de etapa</th><th>Historial</th><th>Lanzado</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
    }).join('');
  }
};
