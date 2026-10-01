// View: Drive History
window.HistoryView = {
  init() {
    //
  },

  async loadHistory() {
    const tbody = document.getElementById('tbody-history');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando historial desde Google Drive...</td></tr>';

    try {
      const res = await window.API.getHistory();
      let list = res.history || [];

      const cacheKey = 'nibol_cached_history';
      if (list.length > 0) {
        list = list.filter(item => {
          const name = String(item.name || '').toUpperCase();
          const id = String(item.id || '').toUpperCase();
          return !name.includes('WARNES') && !id.includes('WARNES') && !id.includes('MTOG');
        });
        try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch (e) {}
      } else {
        try { localStorage.removeItem(cacheKey); } catch (e) {}
      }

      if (list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align:center; padding: 2.5rem; color: var(--text-dim);">
              <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.5;"></i>
              <p style="margin: 0; font-size: 0.95rem; font-weight: 500;">No hay inventarios finalizados en el historial aún.</p>
              <small style="color: #94a3b8; display: block; margin-top: 0.35rem;">
                Los inventarios se archivan aquí al completar la revisión formal ("Finalizar Revisión") y generar el corte en Google Drive.
              </small>
              <button class="btn btn-secondary btn-sm" onclick="window.openGasDiagnosticsModal && window.openGasDiagnosticsModal()" style="margin-top: 1rem; display: inline-flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-stethoscope" style="color: #38bdf8;"></i> Diagnosticar Conexión Google Apps Script
              </button>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = list.map(item => {
        const closedDate = new Date(item.closedAt).toLocaleString();

        return `
          <tr>
            <td>
              <strong style="color: var(--primary);"><i class="fa-solid fa-file-excel" style="color: #22c55e;"></i> ${item.fileName}</strong>
            </td>
            <td><code>${item.logicalPath || item.fileName}</code></td>
            <td><span class="badge badge-neutral">${item.type}</span></td>
            <td><span class="badge badge-info">${item.center}</span></td>
            <td><small>${item.closedBy}</small></td>
            <td><small>${closedDate}</small></td>
            <td><strong>${item.totalItems}</strong></td>
            <td>
              <div style="display: flex; gap: 0.4rem;">
                <a href="/api/history/${item.fileId}/download" class="btn btn-primary btn-sm" download title="Descargar Reporte">
                  <i class="fa-solid fa-download"></i> CSV
                </a>
                ${item.driveUrl ? `
                <a href="${item.driveUrl}" target="_blank" class="btn btn-secondary btn-sm" title="Abrir carpeta Google Drive">
                  <i class="fa-brands fa-google-drive"></i> Drive
                </a>
                ` : ''}
                ${window.Auth.hasRole(['ADMIN']) ? `
                  <button class="btn btn-warning btn-sm" onclick="window.HistoryView.reopen('${item.inventoryId}')" title="Reabrir inventario para ajustes">
                    <i class="fa-solid fa-arrow-rotate-left"></i> Reabrir
                  </button>
                ` : ''}
                ${(window.Auth.isAlonso() || window.Auth.canDeleteSnapshots()) ? `
                  <button class="btn btn-danger btn-sm" onclick="window.HistoryView.deleteSnapshot('${item.fileId}', '${(item.fileName || '').replace(/'/g, "\\'")}', '${item.inventoryId || ''}')" title="Borrar snapshot y depurar cálculos consolidados" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171;">
                    <i class="fa-solid fa-trash-can"></i> Borrar
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--danger);">Error: ${err.message}</td></tr>`;
    }
  },

  async deleteSnapshot(fileId, fileName, inventoryId) {
    if (!window.Auth.isAlonso() && !window.Auth.canDeleteSnapshots()) {
      window.Toast.danger('Acceso denegado: Requiere permisos autorizados para borrar snapshots.');
      return;
    }

    const confirmed = confirm(
      `¿Desea borrar definitivamente el snapshot "${fileName || fileId}"?\n\n` +
      `Esta acción:\n` +
      `• Eliminará el snapshot para que no aparezca en métricas ni historial.\n` +
      `• Purgará los datos de cálculo para que no genere inconsistencias en los consolidados.\n` +
      `• Excluirá permanentemente el archivo de sincronizaciones futuras.`
    );
    if (!confirmed) return;

    try {
      window.Toast.info('Borrando snapshot y depurando cálculos consolidados...');
      const res = await window.API.deleteSnapshot(fileId, {
        fileName,
        inventoryId,
        reason: 'Borrado definitivo desde el perfil de Alonso'
      });

      // Clear local caches
      try {
        localStorage.removeItem('nibol_cached_history');
      } catch (_) {}

      window.Toast.success(res.message || 'Snapshot eliminado y cálculos consolidados depurados con éxito.');

      // Refresh history list
      await this.loadHistory();

      // Refresh Dashboard metrics if available
      if (window.DashboardView && typeof window.DashboardView.loadDashboard === 'function') {
        window.DashboardView.loadDashboard(true);
      }

      // Also refresh modal if open
      if (window.SnapshotManagerModal && typeof window.SnapshotManagerModal.loadSnapshots === 'function') {
        window.SnapshotManagerModal.loadSnapshots();
      }
    } catch (err) {
      window.Toast.danger(err.message || 'Error al borrar snapshot');
    }
  },

  async reopen(inventoryId) {
    let reason = 'Reapertura controlada de inventario';
    try {
      const p = prompt('Ingrese el motivo de la reapertura controlada del inventario:', reason);
      if (p === null) return;
      if (p.trim()) reason = p.trim();
    } catch (e) {
      // In sandbox/iframe prompt might be blocked
    }

    try {
      await window.API.reopenInventory(inventoryId, { reason });
      window.Toast.success('Inventario reabierto y retornado a lista operativa.');
      window.Router.navigate('inventories');
    } catch (err) {
      window.Toast.danger(err.message || 'Error al reabrir inventario');
    }
  }
};
