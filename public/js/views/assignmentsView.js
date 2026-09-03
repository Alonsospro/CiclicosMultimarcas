// View: Assignments & Reassignments
window.AssignmentsView = {
  currentInventory: null,

  init() {
    this.setupListeners();
  },

  setupListeners() {
    document.getElementById('select-assign-inv')?.addEventListener('change', async (e) => {
      const invId = e.target.value;
      if (invId) {
        await this.loadInventoryItems(invId);
      }
    });

    document.getElementById('chk-select-all-assign')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.chk-assign-item').forEach(chk => {
        chk.checked = checked;
      });
    });

    document.getElementById('btn-execute-reassign')?.addEventListener('click', async () => {
      await this.executeReassignment();
    });
  },

  async loadView() {
    const invSelect = document.getElementById('select-assign-inv');
    const auxSelect = document.getElementById('select-assign-aux');
    if (!invSelect || !auxSelect) return;

    invSelect.innerHTML = '<option value="">Cargando inventarios...</option>';
    auxSelect.innerHTML = '<option value="">Cargando auxiliares...</option>';

    try {
      const [invRes, usersRes] = await Promise.all([
        window.API.getInventories({ center: window.Auth.currentUser?.center }),
        window.API.getUsers()
      ]);

      const inventories = (invRes.inventories || []).filter(i => i.status === 'EN_PROGRESO');
      if (inventories.length === 0) {
        invSelect.innerHTML = '<option value="">No hay inventarios en progreso</option>';
      } else {
        invSelect.innerHTML = '<option value="">-- Seleccionar Inventario --</option>' +
          inventories.map(i => `<option value="${i.id}">${i.name} (${i.center})</option>`).join('');
      }

      const auxiliars = (usersRes.users || []).filter(u => u.role === 'AUXILIAR');
      auxSelect.innerHTML = auxiliars.map(u => `<option value="${u.username}">${u.displayName || u.username}</option>`).join('');

      document.getElementById('tbody-assignments').innerHTML =
        '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-dim);">Seleccione un inventario para ver los ítems y responsables.</td></tr>';
    } catch (err) {
      window.Toast.danger(err.message || 'Error cargando datos de asignación');
    }
  },

  async loadInventoryItems(invId) {
    const tbody = document.getElementById('tbody-assignments');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando ítems...</td></tr>';

    try {
      const res = await window.API.getInventoryById(invId);
      this.currentInventory = res.inventory;

      tbody.innerHTML = this.currentInventory.items.map(item => {
        return `
          <tr>
            <td><input type="checkbox" class="chk-assign-item" value="${item.id}"></td>
            <td><strong style="color: var(--primary);">${item.SKU}</strong></td>
            <td>${item.Descripcion}</td>
            <td><span class="badge badge-info">${item.Ubicacion || '-'}</span></td>
            <td><span class="badge badge-neutral">${item.Clasificacion_ABC || 'C'}</span></td>
            <td><strong style="color: var(--warning);">${item.Responsable || 'Sin Asignar'}</strong></td>
            <td><span class="badge badge-neutral">${item.Estado || 'Pendiente'}</span></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--danger);">Error: ${err.message}</td></tr>`;
    }
  },

  async executeReassignment() {
    if (!this.currentInventory) {
      window.Toast.warning('Seleccione un inventario primero.');
      return;
    }

    const selectedCheckboxes = document.querySelectorAll('.chk-assign-item:checked');
    const itemIds = Array.from(selectedCheckboxes).map(chk => chk.value);
    const toUser = document.getElementById('select-assign-aux').value;

    if (itemIds.length === 0) {
      window.Toast.warning('Debe seleccionar al menos un ítem para reasignar.');
      return;
    }

    if (!toUser) {
      window.Toast.warning('Seleccione el auxiliar de destino.');
      return;
    }

    try {
      const res = await window.API.reassignTasks(this.currentInventory.id, {
        itemIds,
        toUser,
        reason: 'Reasignación de carga operativa'
      });

      window.Toast.success(`Se reasignaron ${res.count} ítems a ${toUser} sin duplicar pendientes.`);
      await this.loadInventoryItems(this.currentInventory.id);
    } catch (err) {
      window.Toast.danger(err.message || 'Error al reasignar tareas');
    }
  }
};
