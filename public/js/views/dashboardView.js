// View: Executive Dashboard & Advanced ERU Metrics
window.DashboardView = {
  chartAccuracyDonut: null,
  chartDiscrepanciesBar: null,
  chartAbc: null,
  chartCenters: null,
  currentData: null,
  currentDiscFilter: 'ALL',

  init() {
    this.setupListeners();
  },

  setupListeners() {
    // Filter controls
    document.getElementById('dash-filter-period')?.addEventListener('change', (e) => {
      const isCustom = e.target.value === 'PERSONALIZADO';
      const customBox = document.getElementById('dash-custom-dates-box');
      if (customBox) customBox.style.display = isCustom ? 'inline-flex' : 'none';
      // Reset inventory selector to TODOS when period changes
      const invSelect = document.getElementById('dash-filter-inventory');
      if (invSelect) invSelect.value = 'TODOS';
      this.loadDashboard();
    });

    document.getElementById('dash-filter-start-date')?.addEventListener('change', () => this.loadDashboard());
    document.getElementById('dash-filter-end-date')?.addEventListener('change', () => this.loadDashboard());

    document.getElementById('dash-filter-type')?.addEventListener('change', () => {
      const invSelect = document.getElementById('dash-filter-inventory');
      if (invSelect) invSelect.value = 'TODOS';
      this.loadDashboard();
    });

    document.getElementById('dash-filter-center')?.addEventListener('change', () => {
      const invSelect = document.getElementById('dash-filter-inventory');
      if (invSelect) invSelect.value = 'TODOS';
      this.loadDashboard();
    });

    document.getElementById('dash-filter-inventory')?.addEventListener('change', () => this.loadDashboard());
    document.getElementById('btn-dash-refresh')?.addEventListener('click', () => this.loadDashboard());
    
    document.getElementById('btn-dash-clear-inventory')?.addEventListener('click', () => {
      const invSelect = document.getElementById('dash-filter-inventory');
      if (invSelect) {
        invSelect.value = 'TODOS';
        this.loadDashboard();
      }
    });

    // Tabs navigation
    document.querySelectorAll('.dash-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-dash-tab');
        this.switchTab(targetTab);
      });
    });

    // Worker search filter
    document.getElementById('input-search-worker')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      this.filterWorkersTable(q);
    });

    // Discrepancy pill filters
    document.querySelectorAll('.pill-btn[data-disc-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn[data-disc-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentDiscFilter = btn.getAttribute('data-disc-filter') || 'ALL';
        this.renderDiscrepancies(this.currentData?.discrepanciesList || [], this.currentDiscFilter);
      });
    });

    // CSV Export
    document.getElementById('btn-export-discrepancies-csv')?.addEventListener('click', () => {
      this.exportDiscrepanciesCSV();
    });
  },

  switchTab(tabId) {
    document.querySelectorAll('.dash-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-dash-tab') === tabId);
    });

    document.querySelectorAll('.dash-tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });

    // Trigger chart resize when switching to overview tab
    if (tabId === 'tab-overview') {
      setTimeout(() => {
        this.chartAccuracyDonut?.resize();
        this.chartDiscrepanciesBar?.resize();
        this.chartAbc?.resize();
        this.chartCenters?.resize();
      }, 50);
    }
  },

  async loadDashboard() {
    const user = window.Auth?.currentUser;
    const isAdmin = user && (user.role === 'ADMIN' || user.isSuperadmin);
    const period = document.getElementById('dash-filter-period')?.value || 'TODO';
    const startDate = document.getElementById('dash-filter-start-date')?.value || '';
    const endDate = document.getElementById('dash-filter-end-date')?.value || '';
    const type = document.getElementById('dash-filter-type')?.value || 'TODOS';
    const center = isAdmin
      ? (document.getElementById('dash-filter-center')?.value || 'TODOS')
      : (user?.center || '1120');
    const inventoryId = document.getElementById('dash-filter-inventory')?.value || 'TODOS';

    try {
      const params = {
        type,
        center,
        inventoryId,
        period
      };
      if (period === 'PERSONALIZADO') {
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
      }

      const auditParams = {
        center,
        limit: 100
      };
      if (inventoryId && inventoryId !== 'TODOS') {
        auditParams.inventoryId = inventoryId;
      }

      const [metricsRes, auditRes] = await Promise.all([
        window.API.getDashboardMetrics(params),
        window.API.getAuditLogs(auditParams)
      ]);

      this.currentData = metricsRes;
      this.currentData.auditLogs = auditRes.logs || [];

      // Update Inventory dropdown options dynamically
      this.updateInventoryDropdown(metricsRes.availableInventories || [], metricsRes.filters?.inventoryId);

      // Update Context Banner
      this.renderContextBanner(metricsRes.selectedInventory, metricsRes.filters);

      this.renderKPIs(metricsRes.summary, metricsRes.workerStats || []);
      this.renderCharts(metricsRes);
      this.renderWorkersRanking(metricsRes.workerStats || []);
      this.renderMultiLocations(metricsRes.multiLocationSkus || []);
      this.renderDiscrepancies(metricsRes.discrepanciesList || [], this.currentDiscFilter);
      this.renderAuditLogs(auditRes.logs || []);
    } catch (err) {
      window.Toast.danger(err.message || 'Error cargando datos del Dashboard');
    }
  },

  updateInventoryDropdown(availableInventories = [], selectedId = 'TODOS') {
    const select = document.getElementById('dash-filter-inventory');
    if (!select) return;

    const currentVal = selectedId || select.value || 'TODOS';
    let html = `<option value="TODOS">📊 Consolidado (${availableInventories.length} inventario${availableInventories.length === 1 ? '' : 's'})</option>`;

    availableInventories.forEach(inv => {
      const dateStr = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const tag = inv.isHistory ? ' [Cerrado]' : (inv.status === 'REVISADO' ? ' [Revisado]' : '');
      html += `<option value="${inv.id}">[${inv.center}] ${inv.name || inv.id} - ${dateStr}${tag}</option>`;
    });

    select.innerHTML = html;
    if (availableInventories.some(inv => inv.id === currentVal) || currentVal === 'TODOS') {
      select.value = currentVal;
    } else {
      select.value = 'TODOS';
    }
  },

  renderContextBanner(selectedInventory, filters) {
    const banner = document.getElementById('dash-inventory-context-banner');
    const titleEl = document.getElementById('dash-banner-inventory-title');
    const metaEl = document.getElementById('dash-banner-inventory-meta');
    if (!banner) return;

    if (selectedInventory) {
      banner.style.display = 'flex';
      const dateStr = selectedInventory.createdAt ? new Date(selectedInventory.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      if (titleEl) {
        titleEl.textContent = `[${selectedInventory.center}] ${selectedInventory.name || selectedInventory.id}`;
      }
      if (metaEl) {
        metaEl.textContent = `Tipo: ${selectedInventory.type} | Creado: ${dateStr} | Total Ítems: ${selectedInventory.totalItems || 0} | Estado: ${selectedInventory.status || 'En Proceso'}`;
      }
    } else {
      banner.style.display = 'none';
    }
  },

  renderKPIs(summary, workerStats = []) {
    if (!summary) return;

    const totalAudited = summary.totalItemsAudited || 0;
    const eriVal = totalAudited > 0 ? (summary.eriPercent !== undefined && summary.eriPercent !== null ? Number(summary.eriPercent) : 0) : 0;
    const eruVal = (summary.totalLocationsEvaluated || 0) > 0 ? (summary.eruPercent !== undefined && summary.eruPercent !== null ? Number(summary.eruPercent) : 0) : 0;

    // 1. ERI (Exactitud de Registro)
    const elEri = document.getElementById('stat-eri');
    if (elEri) elEri.textContent = `${eriVal.toFixed(1)}%`;
    const elEriDetail = document.getElementById('stat-eri-detail');
    if (elEriDetail) {
      elEriDetail.textContent = `${summary.totalExactItems || 0} exactos de ${totalAudited} auditados`;
    }

    // 2. ERU (Exactitud de Ubicación)
    const elEru = document.getElementById('stat-eru');
    if (elEru) elEru.textContent = `${eruVal.toFixed(1)}%`;
    const elEruDetail = document.getElementById('stat-eru-detail');
    if (elEruDetail) {
      elEruDetail.textContent = `${summary.totalLocationsEvaluated || 0} ubicaciones evaluadas`;
    }
    const elEruBadge = document.getElementById('stat-eru-multiloc-badge');
    if (elEruBadge) {
      const multiCount = summary.multiLocation?.totalMultiLocSkus || summary.multiLocationCount || 0;
      elEruBadge.textContent = multiCount > 0 ? `${multiCount} multi-racks` : 'Ubic. Estándar';
    }

    // 3. Ítems Cuadrados
    const elSqCount = document.getElementById('stat-squared-count');
    if (elSqCount) elSqCount.textContent = (summary.totalExactItems || 0).toLocaleString();
    const elSqDetail = document.getElementById('stat-squared-detail');
    if (elSqDetail) {
      const exactPct = totalAudited > 0 ? (summary.exactItemsPercent !== undefined ? Number(summary.exactItemsPercent) : 0) : 0;
      elSqDetail.textContent = `${exactPct.toFixed(1)}% de concordancia`;
    }
    const elSqVal = document.getElementById('stat-squared-val-badge');
    if (elSqVal) {
      elSqVal.textContent = `$${(summary.exactItemsTotalValue || summary.exactItemsValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }

    // 4. Discrepancias Totales (Sobrantes & Faltantes)
    const elDiscCount = document.getElementById('stat-discrepancies-count');
    if (elDiscCount) elDiscCount.textContent = (summary.totalDiscrepancies || 0).toLocaleString();

    const sobrantes = summary.discrepancias?.sobrantes || { units: summary.sobrantesUnits || 0, cost: summary.sobrantesCost || 0, itemsCount: summary.sobrantesItemsCount || 0 };
    const faltantes = summary.discrepancias?.faltantes || { units: summary.faltantesUnits || 0, cost: summary.faltantesCost || 0, itemsCount: summary.faltantesItemsCount || 0 };

    const elSobVal = document.getElementById('stat-sobrantes-val');
    if (elSobVal) {
      elSobVal.textContent = `+${sobrantes.units} uds (+$${(sobrantes.cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`;
    }
    const elFalVal = document.getElementById('stat-faltantes-val');
    if (elFalVal) {
      elFalVal.textContent = `-${faltantes.units} uds (-$${(faltantes.cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`;
    }

    // 5. Impacto Financiero
    const fin = summary.impactoFinanciero || {};
    const elDiffCost = document.getElementById('stat-diff-cost');
    if (elDiffCost) {
      const absCost = fin.totalAbsoluteDiffCost !== undefined ? fin.totalAbsoluteDiffCost : (summary.totalAbsoluteDiffCost || 0);
      elDiffCost.textContent = `$${absCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
    const elNetCost = document.getElementById('stat-net-diff-cost');
    if (elNetCost) {
      const net = fin.totalNetDiffCost !== undefined ? fin.totalNetDiffCost : (summary.totalNetDiffCost || 0);
      const sign = net > 0 ? '+' : '';
      elNetCost.textContent = `Neto: ${sign}$${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
    const elDamCost = document.getElementById('stat-damaged-cost-badge');
    if (elDamCost) {
      const damCost = fin.damagedCost !== undefined ? fin.damagedCost : (summary.totalDamagedCost || summary.damagedCost || 0);
      elDamCost.textContent = `Averías: $${damCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }

    // 6. Rendimiento de Contadores
    const elWorkerAcc = document.getElementById('stat-worker-accuracy');
    const elWorkerEdits = document.getElementById('stat-worker-edits-total');
    const elWorkerRating = document.getElementById('stat-worker-rating-badge');

    if (workerStats.length > 0) {
      const avgEff = workerStats.reduce((acc, w) => acc + (w.effectiveAccuracy !== undefined && w.effectiveAccuracy !== null ? Number(w.effectiveAccuracy) : 0), 0) / workerStats.length;
      const totalEdits = workerStats.reduce((acc, w) => acc + (w.reEditCount || 0), 0);

      if (elWorkerAcc) elWorkerAcc.textContent = `${avgEff.toFixed(1)}%`;
      if (elWorkerEdits) {
        elWorkerEdits.textContent = `${totalEdits} ${totalEdits === 1 ? 're-edición' : 're-ediciones'} en el mismo ítem`;
      }
      if (elWorkerRating) {
        if (avgEff >= 95) {
          elWorkerRating.className = 'badge badge-success';
          elWorkerRating.textContent = 'Excelente';
        } else if (avgEff >= 88) {
          elWorkerRating.className = 'badge badge-info';
          elWorkerRating.textContent = 'Bueno';
        } else if (avgEff >= 75) {
          elWorkerRating.className = 'badge badge-warning';
          elWorkerRating.textContent = 'Regular';
        } else {
          elWorkerRating.className = 'badge badge-danger';
          elWorkerRating.textContent = 'Requiere Revisión';
        }
      }
    } else {
      if (elWorkerAcc) elWorkerAcc.textContent = '0.0%';
      if (elWorkerEdits) elWorkerEdits.textContent = '0 re-ediciones registradas';
      if (elWorkerRating) {
        elWorkerRating.className = 'badge badge-reedit zero';
        elWorkerRating.textContent = 'Sin Conteos';
      }
    }
  },

  renderCharts(data) {
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js no está disponible.');
      return;
    }

    const summary = data.summary || {};
    const abc = data.abcBreakdown || {};
    const centerStats = data.centerStats || [];
    const disc = summary.discrepancias || {};

    const sobrantesCount = disc.sobrantes?.itemsCount || 0;
    const faltantesCount = disc.faltantes?.itemsCount || 0;
    const exactCount = summary.totalExactItems || 0;
    const damagedCount = summary.totalDamagedItems > 0 ? 1 : 0;

    // 1. Donut Chart: ERI vs ERU vs Cuadrados vs Discrepancias
    const canvasDonut = document.getElementById('chart-accuracy-donut');
    if (canvasDonut) {
      if (this.chartAccuracyDonut) this.chartAccuracyDonut.destroy();
      const existing = Chart.getChart(canvasDonut);
      if (existing) existing.destroy();

      const ctxDonut = canvasDonut.getContext('2d');
      this.chartAccuracyDonut = new Chart(ctxDonut, {
        type: 'doughnut',
        data: {
          labels: ['Ítems Cuadrados', 'Sobrantes (+)', 'Faltantes (-)', 'Averías / Dañados'],
          datasets: [
            {
              data: [
                exactCount,
                sobrantesCount,
                faltantesCount,
                damagedCount
              ],
              backgroundColor: ['#10b981', '#38bdf8', '#ef4444', '#f59e0b'],
              borderColor: '#1e293b',
              borderWidth: 2,
              hoverOffset: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94a3b8', font: { size: 11, family: 'Inter' } }
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const val = context.raw || 0;
                  const total = (context.dataset.data || []).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                  return ` ${context.label}: ${val} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    // 2. Bar Chart: Discrepancies Distribution
    const canvasBar = document.getElementById('chart-discrepancies-bar');
    if (canvasBar) {
      if (this.chartDiscrepanciesBar) this.chartDiscrepanciesBar.destroy();
      const existing = Chart.getChart(canvasBar);
      if (existing) existing.destroy();

      const ctxBar = canvasBar.getContext('2d');
      this.chartDiscrepanciesBar = new Chart(ctxBar, {
        type: 'bar',
        data: {
          labels: ['Cuadrados (Exactos)', 'Sobrantes (+)', 'Faltantes (-)', 'Averías'],
          datasets: [
            {
              label: 'Cantidad de Ítems',
              data: [exactCount, sobrantesCount, faltantesCount, summary.totalDamagedItems || 0],
              backgroundColor: ['#10b981', '#38bdf8', '#ef4444', '#f59e0b'],
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#94a3b8' }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8' }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    // 3. ABC Financial Impact Chart
    const canvasAbc = document.getElementById('chart-abc');
    if (canvasAbc) {
      if (this.chartAbc) this.chartAbc.destroy();
      const existing = Chart.getChart(canvasAbc);
      if (existing) existing.destroy();

      const ctxAbc = canvasAbc.getContext('2d');
      this.chartAbc = new Chart(ctxAbc, {
        type: 'bar',
        data: {
          labels: ['Categoría A', 'Categoría B', 'Categoría C'],
          datasets: [
            {
              label: 'Costo Sobrante (+$)',
              data: [
                abc.A?.surplusCost || 0,
                abc.B?.surplusCost || 0,
                abc.C?.surplusCost || 0
              ],
              backgroundColor: '#38bdf8',
              borderRadius: 6
            },
            {
              label: 'Costo Faltante (-$)',
              data: [
                abc.A?.deficitCost || 0,
                abc.B?.deficitCost || 0,
                abc.C?.deficitCost || 0
              ],
              backgroundColor: '#ef4444',
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: {
                color: '#94a3b8',
                callback: (v) => `$${v}`
              }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8' }
            }
          },
          plugins: {
            legend: {
              position: 'top',
              labels: { color: '#94a3b8', font: { size: 11 } }
            }
          }
        }
      });
    }

    // 4. Centers Performance Chart (ERI vs ERU)
    const canvasCenters = document.getElementById('chart-centers');
    if (canvasCenters) {
      if (this.chartCenters) this.chartCenters.destroy();
      const existing = Chart.getChart(canvasCenters);
      if (existing) existing.destroy();

      const labels = centerStats.map(c => c.centerName || c.center);
      const eriData = centerStats.map(c => parseFloat(c.eri !== undefined ? c.eri : (c.accuracy || 0)));
      const eruData = centerStats.map(c => parseFloat(c.eru !== undefined ? c.eru : 0));

      const ctxCenters = canvasCenters.getContext('2d');
      this.chartCenters = new Chart(ctxCenters, {
        type: 'bar',
        data: {
          labels: labels.length > 0 ? labels : ['Warnes', 'Av. Banzer', 'Montero'],
          datasets: [
            {
              label: 'ERI % (Registro)',
              data: eriData.length > 0 ? eriData : [0, 0, 0],
              backgroundColor: '#10b981',
              borderRadius: 6
            },
            {
              label: 'ERU % (Ubicación)',
              data: eruData.length > 0 ? eruData : [0, 0, 0],
              backgroundColor: '#38bdf8',
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#94a3b8', callback: (v) => `${v}%` }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8', font: { size: 10 } }
            }
          },
          plugins: {
            legend: {
              position: 'top',
              labels: { color: '#94a3b8', font: { size: 11 } }
            }
          }
        }
      });
    }
  },

  renderWorkersRanking(workers = []) {
    const tbody = document.getElementById('tbody-workers-ranking');
    if (!tbody) return;

    if (workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 1.5rem; color: var(--text-dim);">No hay registros de contadores en el período seleccionado.</td></tr>';
      return;
    }

    tbody.innerHTML = workers.map((w, index) => {
      let medal = `<span style="color: var(--text-dim); font-weight: 700;">#${index + 1}</span>`;
      if (index === 0) medal = '<span style="font-size: 1.2rem;">🥇</span>';
      else if (index === 1) medal = '<span style="font-size: 1.2rem;">🥈</span>';
      else if (index === 2) medal = '<span style="font-size: 1.2rem;">🥉</span>';

      const reEditsBadge = w.reEditCount === 0
        ? '<span class="badge badge-reedit zero" style="background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3);"><i class="fa-solid fa-check-double"></i> 0 (Sin modificaciones)</span>'
        : `<span class="badge badge-reedit" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);"><i class="fa-solid fa-pen-to-square"></i> ${w.reEditCount} ${w.reEditCount === 1 ? 'modificación' : 'modificaciones'}</span>`;

      return `
        <tr data-worker-row="${w.worker.toLowerCase()}">
          <td>
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              ${medal}
              <div>
                <strong style="color: var(--text-main); font-size: 0.95rem;">${w.worker}</strong>
                <div style="font-size: 0.75rem; color: var(--text-dim);">${w.reEditedItemsCount || 0} ítems modificados</div>
              </div>
            </div>
          </td>
          <td><span class="badge badge-neutral">${w.center}</span></td>
          <td style="text-align: center; font-weight: 700; font-family: var(--font-mono);">${w.totalCounted}</td>
          <td style="text-align: center; color: #38bdf8; font-weight: 700; font-family: var(--font-mono);" title="Conteo certero sin requerir correcciones posteriores">${w.firstPassCounted || w.totalCounted} <small style="color: var(--text-dim);">(${(w.firstPassRate || 100).toFixed(1)}%)</small></td>
          <td style="text-align: center; color: #22c55e; font-weight: 700; font-family: var(--font-mono);">${w.exactCounted}</td>
          <td style="text-align: center;">${reEditsBadge}</td>
          <td style="text-align: center; font-family: var(--font-mono); font-weight: 600; color: ${w.reEditRate > 15 ? 'var(--danger)' : (w.reEditRate > 5 ? 'var(--warning)' : 'var(--text-muted)')};">${(w.reEditRate || 0).toFixed(1)}%</td>
          <td style="text-align: center; font-family: var(--font-mono); font-weight: 600; color: var(--text-muted);">${(w.rawAccuracy || 100).toFixed(1)}%</td>
          <td style="text-align: center; font-family: var(--font-mono); font-weight: 800; color: var(--primary); font-size: 1.05rem;">
            ${(w.effectiveAccuracy || 100).toFixed(1)}%
          </td>
          <td>
            <span class="badge ${w.ratingClass || 'badge-success'}" title="${w.ratingDescription || ''}">
              ${w.rating || '🏆 Sobresaliente'}
            </span>
          </td>
          <td style="text-align: center;">
            <button class="btn btn-secondary btn-sm" onclick="window.DashboardView.openWorkerModal('${w.worker}')" title="Ver historial de conteos y rectificaciones">
              <i class="fa-solid fa-eye"></i> Detalle
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  filterWorkersTable(query) {
    const rows = document.querySelectorAll('#tbody-workers-ranking tr[data-worker-row]');
    rows.forEach(row => {
      const workerText = row.getAttribute('data-worker-row') || '';
      row.style.display = (!query || workerText.includes(query)) ? '' : 'none';
    });
  },

  openWorkerModal(workerName) {
    const worker = (this.currentData?.workerStats || []).find(w => w.worker === workerName);
    if (!worker) {
      window.Toast.warning('Información del contador no encontrada');
      return;
    }

    document.getElementById('worker-modal-name').textContent = worker.worker;
    document.getElementById('worker-modal-center').textContent = `Centro: ${worker.center}`;
    document.getElementById('worker-modal-effective-acc').textContent = `${(worker.effectiveAccuracy || 100).toFixed(1)}%`;
    
    const elRating = document.getElementById('worker-modal-rating-badge');
    if (elRating) {
      elRating.className = `badge ${worker.ratingClass || 'badge-success'}`;
      elRating.textContent = worker.rating || '🏆 Sobresaliente';
    }

    document.getElementById('worker-modal-total-counted').textContent = worker.totalCounted || 0;
    const elFirstPass = document.getElementById('worker-modal-first-pass');
    if (elFirstPass) {
      elFirstPass.textContent = `${worker.firstPassCounted || worker.totalCounted} (${(worker.firstPassRate || 100).toFixed(1)}%)`;
    }
    document.getElementById('worker-modal-exact-counted').textContent = worker.exactCounted || 0;
    document.getElementById('worker-modal-reedits-count').textContent = `${worker.reEditCount || 0} (${(worker.reEditRate || 0).toFixed(1)}%)`;

    const tbody = document.getElementById('tbody-worker-reedits-log');
    if (tbody) {
      const logs = worker.reEditHistory || [];
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1.25rem; color: var(--text-dim);">Este contador no registra solicitudes de modificación ni rectificaciones sobre conteos previos (Conteo 100% limpio al primer intento).</td></tr>';
      } else {
        tbody.innerHTML = logs.map(l => {
          const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString() : '-';
          return `
            <tr>
              <td><small style="color: var(--text-dim);">${timeStr}</small></td>
              <td><code style="color: var(--primary); font-weight: 700;">${l.sku || '-'}</code></td>
              <td><span class="badge badge-neutral">${l.location || '-'}</span></td>
              <td style="text-align: center; color: var(--text-muted); font-weight: 600;">${l.previousQty !== null ? l.previousQty : '-'}</td>
              <td style="text-align: center; font-weight: 700; color: #22c55e;">${l.newQty}</td>
              <td><small style="color: var(--text-main);">${l.reason || 'Modificación solicitada por contador'}</small></td>
            </tr>
          `;
        }).join('');
      }
    }

    document.getElementById('modal-worker-history')?.classList.add('active');
  },

  renderMultiLocations(multiLocs = []) {
    const tbody = document.getElementById('tbody-multi-locations');
    if (!tbody) return;

    if (multiLocs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 1.5rem; color: var(--text-dim);">No se detectaron ítems en múltiples ubicaciones en los inventarios evaluados.</td></tr>';
      return;
    }

    tbody.innerHTML = multiLocs.map(item => {
      const locPills = (item.locations || []).map(l => {
        const isExtra = l.isAdditionalLocation;
        const diff = l.diferencia;
        let diffBadge = '';
        if (diff !== null && diff !== undefined) {
          if (diff === 0) diffBadge = '<span class="badge badge-exacto" style="font-size: 0.65rem;">Exacto</span>';
          else if (diff > 0) diffBadge = `<span class="badge badge-sobrante" style="font-size: 0.65rem;">+${diff}</span>`;
          else diffBadge = `<span class="badge badge-faltante" style="font-size: 0.65rem;">${diff}</span>`;
        }

        return `
          <div style="background: var(--bg-input); padding: 0.35rem 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--border-glass); margin-bottom: 0.25rem; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
            <span><i class="fa-solid fa-location-dot" style="color: ${isExtra ? '#f59e0b' : '#38bdf8'};"></i> <strong>${l.ubicacion}</strong> ${isExtra ? '<small style="color: #f59e0b;">(Extra)</small>' : ''}</span>
            <span>Sis: ${l.stockSistema} | Fís: ${l.stockFisico !== null ? l.stockFisico : '-'} ${diffBadge}</span>
          </div>
        `;
      }).join('');

      const statusBadge = item.allLocationsExact
        ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> ERU 100%</span>'
        : (item.status === 'CON_DIFERENCIAS'
          ? '<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Discrepancia</span>'
          : '<span class="badge badge-neutral">En Conteo</span>');

      return `
        <tr>
          <td><strong style="color: var(--primary); font-family: var(--font-mono);">${item.sku}</strong></td>
          <td><span style="font-size: 0.85rem;">${item.descripcion}</span></td>
          <td><span class="badge badge-neutral">${item.categoria} (${item.abc})</span></td>
          <td><span class="badge badge-info">${item.center}</span></td>
          <td style="text-align: center;"><span class="badge badge-warning">${item.locationsCount} racks</span></td>
          <td style="min-width: 240px;">${locPills}</td>
          <td style="text-align: center; font-weight: 700;">${item.totalStockSistema}</td>
          <td style="text-align: center; font-weight: 700; color: var(--text-main);">${item.totalStockFisico !== null ? item.totalStockFisico : '-'}</td>
          <td style="text-align: center;">${statusBadge}</td>
        </tr>
      `;
    }).join('');
  },

  renderDiscrepancies(discrepancies = [], filter = 'ALL') {
    const tbody = document.getElementById('tbody-discrepancies-detail');
    if (!tbody) return;

    let filtered = discrepancies;
    if (filter === 'SOBRANTE') filtered = discrepancies.filter(d => d.tipoDiscrepancia === 'SOBRANTE');
    else if (filter === 'FALTANTE') filtered = discrepancies.filter(d => d.tipoDiscrepancia === 'FALTANTE');
    else if (filter === 'AVERIA') filtered = discrepancies.filter(d => d.malEstado > 0);

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 1.5rem; color: var(--text-dim);">No se registran discrepancias con el filtro seleccionado (Todo concuerda).</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const diff = item.diferencia;
      const diffBadge = diff > 0
        ? `<span class="badge badge-sobrante" style="font-weight: 700;">+${diff}</span>`
        : `<span class="badge badge-faltante" style="font-weight: 700;">${diff}</span>`;

      const impactClass = item.costoDiferencia > 0 ? 'color: #38bdf8;' : (item.costoDiferencia < 0 ? 'color: #ef4444;' : '');
      const sign = item.costoDiferencia > 0 ? '+' : '';

      return `
        <tr>
          <td><strong style="color: var(--primary); font-family: var(--font-mono); font-size: 0.9rem;">${item.sku}</strong></td>
          <td><span style="font-size: 0.85rem;">${item.descripcion || '-'}</span></td>
          <td><span class="badge badge-neutral">${item.center}</span></td>
          <td><span class="badge badge-info"><i class="fa-solid fa-location-dot"></i> ${item.ubicacion}</span></td>
          <td><span class="badge badge-neutral">${item.abc}</span></td>
          <td style="text-align: center;">${item.stockSistema}</td>
          <td style="text-align: center; font-weight: 700;">${item.stockFisico}</td>
          <td style="text-align: center;">${diffBadge}</td>
          <td style="text-align: right; font-family: var(--font-mono);">$${(item.costoUnitario || 0).toFixed(2)}</td>
          <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; ${impactClass}">
            ${sign}$${Math.abs(item.costoDiferencia || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </td>
          <td><small style="color: var(--text-dim);">${item.responsable || 'Sin asignar'}</small></td>
        </tr>
      `;
    }).join('');
  },

  exportDiscrepanciesCSV() {
    const list = this.currentData?.discrepanciesList || [];
    if (list.length === 0) {
      window.Toast.info('No hay datos de discrepancias para exportar');
      return;
    }

    const headers = ['SKU', 'Descripcion', 'Centro', 'Ubicacion', 'Clasificacion_ABC', 'Stock_Sistema', 'Stock_Fisico', 'Diferencia', 'Costo_Unitario', 'Costo_Diferencia', 'Mal_Estado', 'Tipo_Discrepancia', 'Responsable', 'Fecha_Conteo'];
    
    const rows = list.map(item => [
      `"${item.sku || ''}"`,
      `"${(item.descripcion || '').replace(/"/g, '""')}"`,
      `"${item.center || ''}"`,
      `"${item.ubicacion || ''}"`,
      `"${item.abc || ''}"`,
      item.stockSistema,
      item.stockFisico,
      item.diferencia,
      item.costoUnitario,
      item.costoDiferencia,
      item.malEstado || 0,
      `"${item.tipoDiscrepancia || ''}"`,
      `"${item.responsable || ''}"`,
      `"${item.fechaConteo || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `discrepancias_inventario_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.Toast.success('Archivo CSV de discrepancias exportado exitosamente');
  },

  renderAuditLogs(logs = []) {
    const tbody = document.getElementById('tbody-audit-logs');
    if (!tbody) return;

    const elBadge = document.getElementById('badge-audit-count');
    if (elBadge) elBadge.textContent = `${logs.length} eventos registrados`;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 1.5rem; color: var(--text-dim);">No hay registros de auditoría recientes.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
      return `
        <tr>
          <td><small style="color: var(--text-dim);">${timeStr}</small></td>
          <td><span class="badge badge-info">${log.action}</span></td>
          <td><strong>${log.user}</strong></td>
          <td><span class="badge badge-neutral">${log.center}</span></td>
          <td><code>${log.sku || log.targetId || '-'}</code></td>
          <td><small>${log.details || log.reason || (log.previousQty !== null ? `Prev: ${log.previousQty} -> Nuevo: ${log.newQty}` : '')}</small></td>
        </tr>
      `;
    }).join('');
  }
};
