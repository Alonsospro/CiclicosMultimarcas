// Main Application Router and Initializer
window.Router = {
  currentView: 'login',

  navigate(viewName, params = {}) {
    // Check authentication requirement
    if (viewName !== 'login' && !window.Auth.currentUser) {
      this.navigate('login');
      return;
    }

    // Role protection
    if (window.Auth.currentUser?.role === 'AUXILIAR' && !['inventories', 'count', 'barrido', 'login'].includes(viewName)) {
      window.Toast.warning('Acceso restringido: Solo puede visualizar sus inventarios asignados.');
      this.navigate('inventories');
      return;
    }

    if (viewName === 'justifications' && !window.Auth.hasRole(['ADMIN'])) {
      window.Toast.warning('Acceso exclusivo para administradores');
      return;
    }

    if (viewName === 'history' && !window.Auth.hasRole(['ADMIN', 'ENCARGADO'])) {
      window.Toast.warning('Acceso exclusivo para encargados y administradores');
      return;
    }

    if (viewName === 'dashboard' && !window.Auth.hasRole(['ADMIN', 'ENCARGADO'])) {
      window.Toast.warning('Acceso exclusivo para encargados y administradores');
      return;
    }

    if (viewName === 'users' && !window.Auth.isAlonso()) {
      window.Toast.warning('Acceso exclusivo para el superadministrador Alonso');
      return;
    }

    if (viewName === 'assignments' && !window.Auth.hasRole(['ADMIN', 'ENCARGADO'])) {
      window.Toast.warning('Acceso para encargados y administradores');
      return;
    }

    // Hide all view containers
    document.querySelectorAll('.view-container').forEach(v => {
      v.classList.remove('active');
    });

    // Show target view
    const targetElement = document.getElementById(`view-${viewName}`);
    if (targetElement) {
      targetElement.classList.add('active');
      this.currentView = viewName;
      try {
        localStorage.setItem('nibol_active_view', viewName);
      } catch (e) {}
    }

    // Update active nav button
    document.querySelectorAll('.nav-item-btn').forEach(btn => {
      if (btn.getAttribute('data-view') === viewName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Trigger view-specific loaders
    switch (viewName) {
      case 'inventories':
        window.InventoryView.loadInventories();
        break;
      case 'barrido':
        window.BarridoView.resetBarridoForm();
        break;
      case 'assignments':
        window.AssignmentsView.loadView();
        break;
      case 'justifications':
        window.JustificationsView.loadJustifications();
        break;
      case 'history':
        window.HistoryView.loadHistory();
        break;
      case 'dashboard':
        window.DashboardView.loadDashboard();
        break;
      case 'users':
        window.UserManagementView.loadUsers();
        break;
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Toast and Modals
  window.Toast.init();
  window.ModalHelper.init();

  // Initialize Views
  window.LoginView.init();
  window.InventoryView.init();
  window.BarridoView.init();
  window.AssignmentsView.init();
  window.JustificationsView.init();
  window.HistoryView.init();
  window.DashboardView.init();
  window.UserManagementView.init();

  // Theme Initializer
  const savedTheme = localStorage.getItem(window.AppConfig.storageThemeKey) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const themeBtn = document.getElementById('btn-toggle-theme');
  if (themeBtn) {
    themeBtn.innerHTML = savedTheme === 'dark' ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(window.AppConfig.storageThemeKey, next);
      themeBtn.innerHTML = next === 'dark' ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
    });
  }

  // Navigation Links click events
  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = btn.getAttribute('data-view');
      if (view) {
        window.Router.navigate(view);
      }
    });
  });

  // Logout button
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('nibol_active_view');
      localStorage.removeItem('nibol_active_inv_id');
    } catch (e) {}
    window.Auth.logout(true);
  });

  // GAS Health Monitor & Diagnostics Console
  let lastDiagnosticReport = null;

  window.openGasDiagnosticsModal = async function() {
    const modal = document.getElementById('modal-gas-diagnostics');
    const loading = document.getElementById('gas-diag-loading');
    const content = document.getElementById('gas-diag-content');
    if (!modal) return;

    modal.classList.add('active');
    if (loading) {
      loading.style.display = 'flex';
      loading.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 2.2rem; color: #38bdf8;"></i>
        <p style="color: #cbd5e1; font-weight: 500;">Ejecutando diagnóstico integral contra todos los endpoints (.env)...</p>
        <small style="color: #94a3b8;">Verificando Cíclicos, Barrido, Mensuales, Semanales, hojas de cálculo y Drive...</small>
      `;
    }
    if (content) content.style.display = 'none';

    try {
      const report = await window.API.getGasDiagnostics();
      lastDiagnosticReport = report;

      // Detailed logging directly to the administrator browser console
      console.group('🔍 [NIBOL] DIAGNÓSTICO GOOGLE APPS SCRIPT Y DETECCIÓN DE INVENTARIOS');
      console.info('⏰ Fecha y hora:', report.timestamp);
      console.info('⏱️ Tiempo de ejecución:', `${report.executionTimeMs}ms`);
      console.table(report.endpoints.map(e => ({
        Servicio: e.name,
        Variable: e.envVar,
        Ping: e.ping.ok ? `OK (${e.ping.latencyMs}ms)` : `ERROR: ${e.ping.error}`,
        Items_Sheets: e.totalItemsFound,
        Contados_Sheets: e.totalCountedItemsFound,
        Historial_Drive: e.getHistoryTest.recordsCount
      })));

      if (Array.isArray(report.rootCauses) && report.rootCauses.length) {
        console.warn('Causas raíz identificadas para no detección de inventarios:');
        report.rootCauses.forEach(rc => {
          console.warn(`[${rc.severidad}] ${rc.titulo}: ${rc.descripcion}`);
        });
      }

      if (Array.isArray(report.localInventories) && report.localInventories.length) {
        console.info('Inventarios locales en almacenamiento:', report.localInventories);
      }
      console.groupEnd();

      // Render KPIs
      const kpiEndpoints = document.getElementById('diag-kpi-endpoints');
      const kpiSheets = document.getElementById('diag-kpi-sheets');
      const kpiCounted = document.getElementById('diag-kpi-counted');
      const kpiHistory = document.getElementById('diag-kpi-history');

      if (kpiEndpoints) {
        kpiEndpoints.textContent = `${report.summary.onlineEndpoints} / ${report.summary.totalEndpoints}`;
        kpiEndpoints.style.color = report.allEndpointsOnline ? '#22c55e' : '#eab308';
      }
      if (kpiSheets) kpiSheets.textContent = `${report.summary.totalItemsInSheets} ítems`;
      if (kpiCounted) kpiCounted.textContent = `${report.summary.totalCountedInSheets} contados`;
      if (kpiHistory) kpiHistory.textContent = `${report.summary.remoteHistoryCount} Drive / ${report.summary.localHistoryCount} local`;

      // Render Root Causes
      const rootCausesContainer = document.getElementById('diag-root-causes');
      if (rootCausesContainer) {
        if (!report.rootCauses || report.rootCauses.length === 0) {
          rootCausesContainer.innerHTML = '<div style="color: #22c55e;"><i class="fa-solid fa-circle-check"></i> Todos los sistemas se encuentran operando con normalidad.</div>';
        } else {
          rootCausesContainer.innerHTML = report.rootCauses.map(rc => {
            const color = rc.severidad === 'ALTA' ? '#ef4444' : (rc.severidad === 'MEDIA' ? '#f59e0b' : '#38bdf8');
            return `
              <div style="background: rgba(15, 23, 42, 0.7); padding: 0.75rem; border-radius: 6px; border-left: 3px solid ${color};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                  <strong style="color: ${color}; font-size: 0.88rem;">${rc.titulo}</strong>
                  <span class="badge" style="font-size: 0.68rem; background: ${color}20; color: ${color}; border: 1px solid ${color}40;">${rc.severidad}</span>
                </div>
                <p style="margin: 0; color: #cbd5e1; font-size: 0.82rem;">${rc.descripcion}</p>
              </div>
            `;
          }).join('');
        }
      }

      // Render Endpoints Table
      const tbody = document.getElementById('diag-endpoints-tbody');
      if (tbody && Array.isArray(report.endpoints)) {
        tbody.innerHTML = report.endpoints.map(ep => {
          const pingBadge = ep.ping.ok
            ? `<span class="badge" style="background: rgba(34,197,94,0.2); color: #22c55e; border: 1px solid rgba(34,197,94,0.4);">Online (${ep.ping.latencyMs}ms)</span>`
            : `<span class="badge" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4);">Error</span>`;

          const sheetsBreakdown = Object.entries(ep.getProductsTest || {}).map(([c, d]) => {
            return `<code>${c}:</code> <b>${d.totalItems}</b> <small style="color: #94a3b8;">(${d.countedItems} cont.)</small>`;
          }).join(' | ');

          const driveBadge = ep.getHistoryTest.ok
            ? `<span class="badge" style="background: rgba(56,189,248,0.2); color: #38bdf8;">${ep.getHistoryTest.recordsCount} archivos</span>`
            : `<span class="badge badge-neutral" style="font-size: 0.75rem;">${ep.getHistoryTest.error || '0'}</span>`;

          return `
            <tr>
              <td>
                <strong style="color: #f8fafc;">${ep.name}</strong><br/>
                <code style="font-size: 0.72rem; color: #94a3b8;">${ep.envVar}</code>
              </td>
              <td>${pingBadge}</td>
              <td>${sheetsBreakdown || '<span style="color: #94a3b8;">Sin datos</span>'}</td>
              <td>${driveBadge}</td>
            </tr>
          `;
        }).join('');
      }

      // Render Monospace Terminal Log
      const termLog = document.getElementById('diag-terminal-log');
      if (termLog) {
        termLog.textContent = report.formattedLog || 'Diagnóstico completado.';
      }

      if (loading) loading.style.display = 'none';
      if (content) content.style.display = 'flex';
    } catch (err) {
      if (loading) {
        loading.innerHTML = `
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.2rem; color: #ef4444;"></i>
          <p style="color: #ef4444; font-weight: 600;">Error al ejecutar el diagnóstico: ${err.message}</p>
          <button class="btn btn-secondary btn-sm" onclick="window.openGasDiagnosticsModal()">Reintentar</button>
        `;
      }
    }
  };

  window.updateGasHealthStatus = async function(showToast = false) {
    const btn = document.getElementById('btn-gas-health');
    const icon = document.getElementById('gas-status-icon');
    const text = document.getElementById('gas-status-text');
    if (!btn || !icon || !text) return;

    if (showToast) {
      icon.className = 'fa-solid fa-spinner fa-spin';
      text.textContent = 'Verificando...';
    }

    try {
      const health = await window.API.checkGasHealth();
      icon.className = 'fa-solid fa-cloud';
      if (health && health.allOnline) {
        icon.style.color = 'var(--success, #16a34a)';
        text.textContent = 'Apps Script Conectado';
        const latencyInfo = health.results.map(r => `${r.name}: ${r.latencyMs}ms`).join(' | ');
        btn.title = `Google Apps Script Activo (${latencyInfo}) - Clic para abrir consola de diagnóstico`;
        if (showToast) {
          window.Toast.success(`Conexión con Google Apps Script activa (${health.results.map(r => r.name).join(', ')})`);
        }
      } else {
        icon.style.color = '#eab308';
        text.textContent = 'Apps Script Parcial';
        if (showToast) {
          window.Toast.warning('Algunos servicios de Google Apps Script no respondieron al ping');
        }
      }
    } catch (err) {
      icon.className = 'fa-solid fa-cloud';
      icon.style.color = 'var(--danger, #ef4444)';
      text.textContent = 'Sin conexión GAS';
      if (showToast) {
        window.Toast.warning('Aviso de conexión con Apps Script: ' + err.message);
      }
    }
  };

  // Button triggers for Diagnostic Console
  document.getElementById('btn-gas-health')?.addEventListener('click', () => {
    window.openGasDiagnosticsModal();
  });

  document.getElementById('btn-open-gas-diagnostics')?.addEventListener('click', () => {
    window.openGasDiagnosticsModal();
  });

  document.getElementById('btn-rerun-gas-diagnostics')?.addEventListener('click', () => {
    window.openGasDiagnosticsModal();
  });

  document.getElementById('btn-copy-diag-log')?.addEventListener('click', async () => {
    if (lastDiagnosticReport && lastDiagnosticReport.formattedLog) {
      try {
        await navigator.clipboard.writeText(lastDiagnosticReport.formattedLog);
        window.Toast.success('Log de diagnóstico copiado al portapapeles');
      } catch (e) {
        window.Toast.info('Log listo para seleccionar y copiar');
      }
    }
  });

  // Check Active Session on Page Refresh and restore view/session
  window.Auth.init();
  const hasSession = await window.Auth.checkSession();
  if (hasSession) {
    const savedView = localStorage.getItem('nibol_active_view') || 'inventories';
    const activeInvId = localStorage.getItem('nibol_active_inv_id');
    if (savedView === 'count' && activeInvId) {
      window.InventoryView.openInventory(activeInvId);
    } else {
      window.Router.navigate(savedView);
    }
    // Update Apps Script health status in the background
    window.updateGasHealthStatus(false);
  } else {
    window.Router.navigate('login');
  }
});
