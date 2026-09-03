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
        try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch (e) {}
      } else {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) list = parsed;
          }
        } catch (e) {}
      }

      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--text-dim);">No hay inventarios finalizados en el historial aún.</td></tr>';
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
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--danger);">Error: ${err.message}</td></tr>`;
    }
  },

  async reopen(inventoryId) {
    const reason = prompt('Ingrese el motivo de la reapertura controlada del inventario:');
    if (!reason) return;

    try {
      await window.API.reopenInventory(inventoryId, { reason });
      window.Toast.success('Inventario reabierto y retornado a lista operativa.');
      window.Router.navigate('inventories');
    } catch (err) {
      window.Toast.danger(err.message || 'Error al reabrir inventario');
    }
  }
};
