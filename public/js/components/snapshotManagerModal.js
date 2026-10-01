// Modal Component: Snapshot Manager (Exclusive to Alonso)
window.SnapshotManagerModal = {
  snapshots: [],

  init() {
    window.openSnapshotManagerModal = () => this.open();
  },

  open() {
    if (!window.Auth || (!window.Auth.isAlonso() && !window.Auth.canDeleteSnapshots())) {
      window.Toast.danger('Acceso denegado: Esta función requiere permisos de administración de snapshots.');
      return;
    }

    if (window.ModalHelper && typeof window.ModalHelper.open === 'function') {
      window.ModalHelper.open('modal-manage-snapshots');
    } else {
      const modal = document.getElementById('modal-manage-snapshots');
      if (modal) modal.classList.add('active');
    }

    this.loadSnapshots();
  },

  close() {
    if (window.ModalHelper && typeof window.ModalHelper.close === 'function') {
      window.ModalHelper.close('modal-manage-snapshots');
    } else {
      const modal = document.getElementById('modal-manage-snapshots');
      if (modal) modal.classList.remove('active');
    }
  },

  async loadSnapshots() {
    const tbody = document.getElementById('tbody-manage-snapshots');
    const badgeCount = document.getElementById('badge-snapshots-count');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">
          <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.25rem; margin-right: 0.5rem;"></i>
          Cargando listado de snapshots históricos...
        </td>
      </tr>
    `;

    try {
      const res = await window.API.getHistory();
      const list = res.history || [];
      this.snapshots = list;

      if (badgeCount) {
        badgeCount.textContent = `${list.length} snapshot(s)`;
      }

      if (list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">
              <i class="fa-solid fa-shield-halved" style="font-size: 2rem; color: #10b981; margin-bottom: 0.5rem; display: block; opacity: 0.8;"></i>
              <p style="margin: 0; font-size: 0.95rem; font-weight: 600; color: var(--text-main);">No existen snapshots registrados actualmente.</p>
              <small style="color: var(--text-muted); display: block; margin-top: 0.25rem;">
                Todos los snapshots previos han sido depurados o aún no se han finalizado nuevos inventarios.
              </small>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = list.map((item, idx) => {
        const closedDate = item.closedAt ? new Date(item.closedAt).toLocaleString() : 'Fecha no registrada';
        const fileIdEscaped = (item.fileId || '').replace(/'/g, "\\'");
        const fileNameEscaped = (item.fileName || '').replace(/'/g, "\\'");
        const invIdEscaped = (item.inventoryId || '').replace(/'/g, "\\'");

        return `
          <tr id="snap-row-${idx}">
            <td>
              <strong style="color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-file-excel" style="color: #22c55e;"></i>
                ${item.fileName}
              </strong>
              <small style="color: var(--text-muted); font-family: monospace; font-size: 0.72rem; display: block;">
                ID: ${item.fileId}
              </small>
            </td>
            <td><span class="badge badge-info">${item.center}</span></td>
            <td><span class="badge badge-neutral">${item.type}</span></td>
            <td><strong style="color: var(--primary);">${item.totalItems}</strong> <small style="color: var(--text-muted);">ítems</small></td>
            <td><small style="color: var(--text-muted);">${closedDate}</small></td>
            <td style="text-align: right;">
              <button type="button" class="btn btn-danger btn-sm"
                onclick="window.SnapshotManagerModal.deleteSnapshot('${fileIdEscaped}', '${fileNameEscaped}', '${invIdEscaped}')"
                title="Eliminar snapshot y depurar datos de cálculo (Exclusivo Alonso)"
                style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.5); color: #f87171; padding: 0.35rem 0.65rem;">
                <i class="fa-solid fa-trash-can"></i> Borrar
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding: 2rem; color: var(--danger);">
            <i class="fa-solid fa-circle-exclamation" style="margin-right: 0.4rem;"></i>
            Error al consultar snapshots: ${err.message}
          </td>
        </tr>
      `;
    }
  },

  async deleteSnapshot(fileId, fileName, inventoryId) {
    if (!window.Auth || (!window.Auth.isAlonso() && !window.Auth.canDeleteSnapshots())) {
      window.Toast.danger('Acceso denegado: Requiere permisos autorizados para borrar snapshots.');
      return;
    }

    const confirmed = confirm(
      `¿Está completamente seguro de eliminar el snapshot "${fileName || fileId}"?\n\n` +
      `Consecuencias inmediatas:\n` +
      `1. Se borrará definitivamente del historial y de Google Drive Store.\n` +
      `2. No volverá a aparecer en las métricas ni en las consultas de inventarios.\n` +
      `3. Se eliminarán los datos de cálculo para que no genere distorsiones al ver los consolidados.\n` +
      `4. Las métricas del dashboard se recalcularán de forma limpia e instantánea.`
    );
    if (!confirmed) return;

    try {
      window.Toast.info('Eliminando snapshot y depurando cálculos consolidados...');
      
      const res = await window.API.deleteSnapshot(fileId, {
        fileName,
        inventoryId,
        reason: 'Borrado definitivo desde el panel de administración'
      });

      // Clear local storage cache
      try {
        localStorage.removeItem('nibol_cached_history');
      } catch (_) {}

      window.Toast.success(res.message || 'Snapshot eliminado y cálculos consolidados depurados exitosamente.');

      // Refresh modal table
      await this.loadSnapshots();

      // Refresh History View if available
      if (window.HistoryView && typeof window.HistoryView.loadHistory === 'function') {
        window.HistoryView.loadHistory();
      }

      // Refresh Dashboard metrics if available
      if (window.DashboardView && typeof window.DashboardView.loadDashboard === 'function') {
        window.DashboardView.loadDashboard(true);
      }
    } catch (err) {
      console.error('[SnapshotManagerModal] Error deleting snapshot:', err);
      window.Toast.danger(err.message || 'Error al eliminar snapshot');
    }
  },

  async purgeAndRecalculate() {
    if (!window.Auth || (!window.Auth.isAlonso() && !window.Auth.canDeleteSnapshots())) {
      window.Toast.danger('Acceso denegado: Requiere permisos de administración de snapshots para ejecutar esta depuración.');
      return;
    }

    const btn = document.getElementById('btn-purge-recalc-snapshots');
    if (btn) btn.disabled = true;

    try {
      window.Toast.info('Depurando caché de cálculos y recalculando métricas consolidadas...');
      
      await window.API.recalculateDashboardMetrics({
        type: 'TODOS',
        center: 'TODOS',
        inventoryId: 'TODOS',
        period: 'TODO'
      });

      // Clear local cache
      try {
        localStorage.removeItem('nibol_cached_history');
      } catch (_) {}

      window.Toast.success('Consolidados recalculados y métricas depuradas con éxito.');
      await this.loadSnapshots();

      if (window.HistoryView && typeof window.HistoryView.loadHistory === 'function') {
        window.HistoryView.loadHistory();
      }
      if (window.DashboardView && typeof window.DashboardView.loadDashboard === 'function') {
        window.DashboardView.loadDashboard(true);
      }
    } catch (err) {
      window.Toast.danger('Error al recalcular consolidados: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.SnapshotManagerModal.init();
});
