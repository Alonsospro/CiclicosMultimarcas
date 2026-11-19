// Report center: which reports are due, generated or in progress, and generation in PDF and Excel.
window.ReportsView = {
  kind: 'SEMANAL',
  catalog: null,
  report: null,
  busy: false,
  initialized: false,
  STATUS: {
    GENERADO: { label: 'Generado', cls: 'rc-status-done', icon: 'fa-circle-check' },
    PENDIENTE: { label: 'Pendiente', cls: 'rc-status-due', icon: 'fa-triangle-exclamation' },
    EN_CURSO: { label: 'En curso', cls: 'rc-status-open', icon: 'fa-hourglass-half' }
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const center = document.getElementById('rc-filter-center');
    const source = document.getElementById('dash-filter-center');
    if (center && source) center.innerHTML = source.innerHTML;
    document.querySelectorAll('.rc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.kind = tab.dataset.kind;
        this.renderTabs();
        this.renderTable();
      });
    });
    ['rc-filter-type', 'rc-filter-center'].forEach(id => document.getElementById(id)?.addEventListener('change', () => this.load()));
    document.getElementById('rc-refresh')?.addEventListener('click', () => this.load(true));
    document.getElementById('rc-table-body')?.addEventListener('click', event => {
      const button = event.target.closest('[data-generate]');
      if (button) this.generate(button.dataset.generate);
    });
    const excel = document.getElementById('btn-report-download-xlsx');
    if (excel) excel.onclick = () => this.downloadExcel();
    document.querySelectorAll('[data-close-modal="modal-metrics-report"]').forEach(button => button.addEventListener('click', () => this.toggleExcel(false)));
  },

  filters() {
    const user = window.Auth?.currentUser;
    const admin = user && (user.role === 'ADMIN' || user.isSuperadmin);
    return {
      type: document.getElementById('rc-filter-type')?.value || 'TODOS',
      center: admin ? (document.getElementById('rc-filter-center')?.value || 'TODOS') : (user?.center || 'TODOS')
    };
  },

  async load(refresh = false) {
    this.init();
    const body = document.getElementById('rc-table-body');
    if (body) body.innerHTML = '<tr><td colspan="7" class="rc-empty"><i class="fa-solid fa-spinner fa-spin"></i> Cargando periodos...</td></tr>';
    try {
      const data = await window.API.getReportCatalog({ ...this.filters(), ...(refresh ? { refresh: 1 } : {}) });
      this.catalog = data;
      this.renderTabs();
      this.renderTable();
      this.loadLog();
    } catch (err) {
      console.error('[ReportsView] Catálogo:', err);
      if (body) body.innerHTML = `<tr><td colspan="7" class="rc-empty">${this.esc(err.message || 'No se pudieron cargar los periodos.')}</td></tr>`;
    }
  },

  esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  date(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' }) : '—';
  },

  renderTabs() {
    document.querySelectorAll('.rc-tab').forEach(tab => {
      const active = tab.dataset.kind === this.kind;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      const due = (this.catalog?.[tab.dataset.kind] || []).filter(item => item.status === 'PENDIENTE').length;
      const badge = tab.querySelector('.rc-tab-badge');
      if (badge) { badge.textContent = due; badge.hidden = !due; }
    });
  },

  renderTable() {
    const body = document.getElementById('rc-table-body');
    const list = this.catalog?.[this.kind] || [];
    const counts = { GENERADO: 0, PENDIENTE: 0, EN_CURSO: 0 };
    list.forEach(item => { counts[item.status] = (counts[item.status] || 0) + 1; });
    const summary = document.getElementById('rc-summary');
    if (summary) summary.innerHTML = Object.entries(this.STATUS).map(([key, s]) => `<span class="rc-status ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${counts[key]} ${s.label.toLowerCase()}${counts[key] === 1 ? '' : 's'}</span>`).join('');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="rc-empty">No hay periodos con inventarios para estos filtros.</td></tr>';
      return;
    }
    const fmt = window.ReportCenterDocument.fmt;
    body.innerHTML = list.map(item => {
      const s = this.STATUS[item.status];
      const detail = this.kind === 'INDIVIDUAL'
        ? `${this.esc(item.center)} · ${this.esc(window.InventoryTypeLabel?.title?.(item.inventoryType) || item.inventoryType || '')} · ${fmt(item.lines, 'int')} líneas`
        : `${fmt(item.inventories, 'int')} inventarios${item.open ? ` · ${item.open} abiertos` : ''}${item.centers ? ` · ${item.centers.length} centros` : ''}`;
      const last = item.last ? `${this.date(item.last.generatedAt)}<small>${this.esc(item.last.generatedBy)}${item.last.generations > 1 ? ` · ${item.last.generations} veces` : ''}</small>` : '—';
      const action = item.status === 'GENERADO' ? 'Regenerar' : 'Generar';
      return `<tr>
        <td><strong>${this.esc(item.label)}</strong>${this.kind === 'INDIVIDUAL' ? `<small>${this.date(item.date)}</small>` : ''}</td>
        <td>${detail}</td>
        <td><span class="rc-status ${s.cls}"><i class="fa-solid ${s.icon}"></i> ${s.label}</span></td>
        <td class="rc-last">${last}</td>
        <td class="num">${item.last ? fmt(item.last.kpis?.eriUnits, 'pct') : '—'}</td>
        <td class="num">${item.last ? fmt(item.last.kpis?.absImpact, 'bs') : '—'}</td>
        <td><button type="button" class="btn ${item.status === 'GENERADO' ? 'btn-secondary' : 'btn-primary'} btn-sm" data-generate="${this.esc(item.ref)}"><i class="fa-solid fa-file-pdf"></i> ${action}</button></td>
      </tr>`;
    }).join('');
  },

  async loadLog() {
    const body = document.getElementById('rc-log-body');
    if (!body) return;
    try {
      const { log } = await window.API.getReportLog({ center: this.filters().center });
      const fmt = window.ReportCenterDocument.fmt;
      const kinds = { INDIVIDUAL: 'Individual', SEMANAL: 'Semanal', MENSUAL: 'Mensual', ANUAL: 'Anual' };
      body.innerHTML = (log || []).slice(0, 30).map(entry => `<tr>
        <td>${this.date(entry.generatedAt)}</td><td>${kinds[entry.kind] || entry.kind}</td><td>${this.esc(entry.label)}</td>
        <td>${this.esc(entry.center === 'TODOS' ? 'Todos' : entry.center)} · ${this.esc(window.ReportCenterDocument.TYPE_LABELS[entry.type] || entry.type)}</td>
        <td class="num">${fmt(entry.kpis?.eriUnits, 'pct')}</td><td class="num">${fmt(entry.kpis?.absImpact, 'bs')}</td><td>${this.esc(entry.generatedBy)}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="rc-empty">Todavía no se generó ningún informe.</td></tr>';
    } catch (err) {
      body.innerHTML = `<tr><td colspan="7" class="rc-empty">${this.esc(err.message || 'No se pudo leer el historial.')}</td></tr>`;
    }
  },

  async generate(ref) {
    if (this.busy) return;
    this.busy = true;
    const kind = this.kind;
    const endWait = window.DeerLoader?.show(kind === 'ANUAL' ? 'Preparando el informe anual, mes por mes...' : 'Preparando el informe...');
    try {
      const { report } = await window.API.buildReport({ kind, ref, ...this.filters() });
      if (!report.kpis.sourcesComplete) window.Toast?.warning('Hay archivos sin validar: quedaron fuera del cálculo.');
      this.report = report;
      this.open(report);
      await window.API.logReport({ kind: report.kind, ref: report.ref, label: report.label, type: report.type, center: report.center, kpis: report.kpis })
        .catch(err => console.warn('[ReportsView] Registro:', err));
      window.Toast?.success('Informe generado');
      this.load();
    } catch (err) {
      console.error('[ReportsView] Generar:', err);
      window.Toast?.danger(err.message || 'No se pudo generar el informe.');
    } finally {
      endWait?.();
      this.busy = false;
    }
  },

  open(report) {
    const modal = window.MetricsReportModal;
    modal.init();
    modal.currentInventory = report.selectedInventory || { id: `${report.kind}-${report.ref}`, name: report.label, center: report.center, type: report.type };
    modal.currentMetrics = report.metrics;
    modal.currentMonthly = null;
    modal.currentFileName = `${window.ReportCenterDocument.fileName(report)}.pdf`;
    window.ModalHelper?.open('modal-metrics-report');
    this.toggleExcel(true);
    const title = document.getElementById('report-modal-title');
    const subtitle = document.getElementById('report-modal-subtitle');
    if (title) title.textContent = `${window.ReportCenterDocument.KIND_LABELS[report.kind]} · ${report.label}`;
    if (subtitle) subtitle.textContent = report.previous ? `Comparado con ${report.previous.label}` : 'Sin periodo anterior para comparar';
    const container = document.getElementById('report-printable-area');
    if (!container) return;
    container.innerHTML = window.ReportCenterDocument.render(report);
    window.ManagementReport?.paginate(container);
    window.ManagementReport?.bindInteractions?.(container);
  },

  toggleExcel(visible) {
    const button = document.getElementById('btn-report-download-xlsx');
    if (button) button.hidden = !visible;
    if (!visible && window.MetricsReportModal) window.MetricsReportModal.currentFileName = null;
  },

  downloadExcel() {
    if (!this.report) return;
    if (typeof XLSX === 'undefined') {
      window.Toast?.danger('El generador de Excel no está disponible.');
      return;
    }
    const book = XLSX.utils.book_new();
    Object.entries(window.ReportCenterDocument.workbook(this.report)).forEach(([name, rows]) => {
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Sin_datos: '' }]), name.slice(0, 31));
    });
    XLSX.writeFile(book, `${window.ReportCenterDocument.fileName(this.report)}.xlsx`);
  }
};
