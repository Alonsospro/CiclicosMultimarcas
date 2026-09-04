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
      await this.executeReassignment(false);
    });

    document.getElementById('btn-assign-all-to-aux')?.addEventListener('click', async () => {
      await this.executeReassignment(true);
    });
  },

  async loadView() {
    const invSelect = document.getElementById('select-assign-inv');
    const auxSelect = document.getElementById('select-assign-aux');
    const badgeEl = document.getElementById('assign-scope-badge');
    if (!invSelect || !auxSelect) return;

    invSelect.innerHTML = '<option value="">Cargando inventarios...</option>';
    auxSelect.innerHTML = '<option value="">Cargando auxiliares...</option>';

    try {
      const isAdm = window.Auth.hasRole(['ADMIN']);
      const currentUser = window.Auth.currentUser;

      if (badgeEl) {
        if (isAdm) {
          badgeEl.className = 'alert alert-warning';
          badgeEl.style.display = 'flex';
          badgeEl.innerHTML = `<i class="fa-solid fa-crown" style="color: #f59e0b; font-size: 1.15rem; margin-top: 0.15rem;"></i> <div><strong style="color: #f59e0b;">Modo Administrador Global:</strong> Tiene permisos para asignar cualquier inventario activo a cualquier auxiliar de cualquier centro operativo de NIBOL.</div>`;
        } else {
          const cName = currentUser?.centerName ? `${currentUser.center} - ${currentUser.centerName}` : (currentUser?.center || 'su centro');
          badgeEl.className = 'alert alert-info';
          badgeEl.style.display = 'flex';
          badgeEl.innerHTML = `<i class="fa-solid fa-building-user" style="color: #38bdf8; font-size: 1.15rem; margin-top: 0.15rem;"></i> <div><strong style="color: #38bdf8;">Modo Encargado (${cName}):</strong> Visualiza y puede reasignar únicamente inventarios y auxiliares pertenecientes a su centro operativo.</div>`;
        }
      }

      const [invRes, usersRes] = await Promise.all([
        window.API.getInventories({ center: isAdm ? 'TODOS' : currentUser?.center }),
        window.API.getUsers()
      ]);

      let inventories = (invRes.inventories || []).filter(i => i.status === 'EN_PROGRESO');
      if (!isAdm && currentUser?.center) {
        inventories = inventories.filter(i => window.Auth.isSameCenter(i.center, currentUser.center));
      }

      if (inventories.length === 0) {
        invSelect.innerHTML = '<option value="">No hay inventarios en progreso disponibles</option>';
      } else {
        invSelect.innerHTML = '<option value="">-- Seleccionar Inventario --</option>' +
          inventories.map(i => `<option value="${i.id}">${i.name} [Centro: ${i.center}]</option>`).join('');
      }

      let auxiliars = (usersRes.users || []).filter(u => u.role === 'AUXILIAR');
      if (!isAdm && currentUser?.center) {
        auxiliars = auxiliars.filter(u => window.Auth.isSameCenter(u.center, currentUser.center));
      }

      if (auxiliars.length === 0) {
        const cDesc = currentUser?.centerName || currentUser?.center || 'su centro';
        auxSelect.innerHTML = `<option value="">No hay auxiliares registrados en ${cDesc}</option>`;
      } else {
        auxSelect.innerHTML = '<option value="">-- Seleccionar Auxiliar Responsable --</option>' +
          auxiliars.map(u => `<option value="${u.username}">${u.displayName || u.username} (${u.centerName || u.center || 'Sin Centro'})</option>`).join('');
      }

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

  async executeReassignment(assignAll = false) {
    if (!this.currentInventory) {
      window.Toast.warning('Seleccione un inventario primero.');
      return;
    }

    const toUser = document.getElementById('select-assign-aux').value;
    if (!toUser) {
      window.Toast.warning('Seleccione el auxiliar de destino.');
      return;
    }

    let itemIds = [];
    if (!assignAll) {
      const selectedCheckboxes = document.querySelectorAll('.chk-assign-item:checked');
      itemIds = Array.from(selectedCheckboxes).map(chk => chk.value);
      if (itemIds.length === 0) {
        window.Toast.warning('Debe seleccionar al menos un ítem con la casilla o hacer clic en "Asignar Todo el Inventario".');
        return;
      }
    }

    try {
      const res = await window.API.reassignTasks(this.currentInventory.id, {
        itemIds: assignAll ? 'ALL' : itemIds,
        assignAll,
        toUser,
        reason: 'Reasignación de carga operativa'
      });

      const countMsg = assignAll ? 'todo el inventario' : `${res.count} ítems`;
      window.Toast.success(`¡Se asignó exitosamente ${countMsg} al auxiliar ${res.targetDisplayName || toUser}! Ya está disponible en su perfil.`);
      await this.loadInventoryItems(this.currentInventory.id);
    } catch (err) {
      window.Toast.danger(err.message || 'Error al reasignar tareas');
    }
  }
};
