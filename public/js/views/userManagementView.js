// View: User Management (Admin / Superadmin Alonso)
window.UserManagementView = {
  users: [],
  centersList: [
    { code: '1120', name: 'Volvo - Km 14' },
    { code: '1160', name: 'Av. Banzer 3er anillo' },
    { code: '1180', name: 'Foton - Km 10' },
    { code: '1300', name: 'John Deere - Km 10' },
    { code: '1310', name: 'Sucursal Montero' },
    { code: '1340', name: 'Sucursal Cuatro Cañadas' },
    { code: '1700', name: 'Av. Grigota 3er anillo' },
    { code: '1800', name: 'Express San Julián' },
    { code: '1820', name: 'Express San Pedro' },
    { code: '2100', name: 'Sucursal El Alto, La Paz' },
    { code: '2150', name: 'Centro Foton El Alto, La Paz' },
    { code: '3100', name: 'Sucursal Cochabamba' },
    { code: '3200', name: 'Centro Foton Blanco Galindo' },
    { code: '5100', name: 'Sucursal Tarija' }
  ],

  init() {
    this.setupListeners();
  },

  setupListeners() {
    // Open create user modal
    document.getElementById('btn-open-create-user-modal')?.addEventListener('click', () => {
      document.getElementById('form-user-crud').reset();
      document.getElementById('user-form-id').value = '';
      document.getElementById('user-form-username').disabled = false;
      document.getElementById('user-form-pass').required = true;

      const isEncargado = window.Auth.currentUser?.role === 'ENCARGADO';
      const roleSelect = document.getElementById('user-form-role');
      const centerSelect = document.getElementById('user-form-center');

      if (isEncargado) {
        if (roleSelect) {
          roleSelect.value = 'AUXILIAR';
          roleSelect.disabled = true;
        }
        if (centerSelect) {
          centerSelect.value = window.Auth.currentUser.center;
          centerSelect.disabled = true;
        }
      } else {
        if (roleSelect) roleSelect.disabled = false;
        if (centerSelect) centerSelect.disabled = false;
      }

      window.ModalHelper.open('modal-user-form');
    });

    // Submit user form (Create/Basic Update)
    document.getElementById('form-user-crud')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('user-form-id').value;
      const username = document.getElementById('user-form-username').value.trim();
      const displayName = document.getElementById('user-form-display').value.trim();
      const password = document.getElementById('user-form-pass').value;
      const isEncargado = window.Auth.currentUser?.role === 'ENCARGADO';
      const role = isEncargado ? 'AUXILIAR' : document.getElementById('user-form-role').value;
      const center = isEncargado ? window.Auth.currentUser.center : document.getElementById('user-form-center').value;

      try {
        if (id) {
          // Update
          await window.API.updateUser(id, { displayName, password, role, center });
          window.Toast.success('Usuario actualizado correctamente.');
        } else {
          // Create
          await window.API.createUser({ username, displayName, password, role, center });
          window.Toast.success('Usuario creado con éxito.');
        }

        window.ModalHelper.close('modal-user-form');
        this.loadUsers();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar usuario');
      }
    });

    // Submit Permissions Form
    document.getElementById('form-user-permissions')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('perm-user-id').value;
      if (!userId) return;

      const createInventory = document.getElementById('perm-create-inv')?.checked || false;
      const deleteSnapshots = document.getElementById('perm-delete-snapshots')?.checked || false;
      const manageUsers = document.getElementById('perm-manage-users')?.checked || false;
      const exportReports = document.getElementById('perm-export-reports')?.checked || false;
      const recalculateMetrics = document.getElementById('perm-recalc-metrics')?.checked || false;
      const manageJustifications = document.getElementById('perm-manage-just')?.checked || false;

      const isGlobal = document.getElementById('perm-center-global')?.checked || false;
      let allowedCenters = [];
      if (isGlobal) {
        allowedCenters = ['GLOBAL'];
      } else {
        const checkedCenters = document.querySelectorAll('.perm-center-chip-checkbox:checked');
        allowedCenters = Array.from(checkedCenters).map(cb => cb.value);
        if (allowedCenters.length === 0) allowedCenters = ['GLOBAL'];
      }

      const permissions = {
        createInventory,
        deleteSnapshots,
        manageUsers,
        exportReports,
        recalculateMetrics,
        manageJustifications,
        viewAllCenters: isGlobal
      };

      const btn = document.getElementById('btn-save-user-permissions');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
      }

      try {
        await window.API.updateUser(userId, {
          permissions,
          allowedCenters
        });

        window.Toast.success('Accesos y privilegios actualizados correctamente.');
        window.ModalHelper.close('modal-user-permissions');
        await this.loadUsers();

        // If the current user edited their own permissions, update auth session
        if (window.Auth?.currentUser?.id === userId) {
          window.Auth.currentUser.permissions = permissions;
          window.Auth.currentUser.allowedCenters = allowedCenters;
          window.Auth.updateUIForRole();
        }
      } catch (err) {
        console.error('[UserManagementView] Error saving permissions:', err);
        window.Toast.danger(err.message || 'Error al guardar accesos');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar Accesos y Privilegios';
        }
      }
    });

    // Toggle global center checkbox
    document.getElementById('perm-center-global')?.addEventListener('change', (e) => {
      const isGlobal = e.target.checked;
      const chipCheckboxes = document.querySelectorAll('.perm-center-chip-checkbox');
      chipCheckboxes.forEach(cb => {
        cb.disabled = isGlobal;
        if (isGlobal) cb.checked = true;
      });
    });
  },

  async loadUsers() {
    const tbody = document.getElementById('tbody-users');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando usuarios...</td></tr>';

    try {
      const res = await window.API.getUsers();
      this.users = res.users || [];

      tbody.innerHTML = this.users.map(u => {
        const isSuperadmin = u.username.toUpperCase() === 'ALONSO' || u.isSuperadmin;
        const centerDesc = u.centerName && u.centerName !== u.center ? `${u.center} - ${u.centerName}` : (u.center || 'GLOBAL');
        const isTargetAdmin = ['jcarlos', 'juancarlos', 'absael'].includes(String(u.username || '').toLowerCase()) || u.role === 'ADMIN';

        // Badges de permisos activos
        const perms = u.permissions || {};
        const isGlobal = (u.allowedCenters || []).includes('GLOBAL') || perms.viewAllCenters;

        let permBadgesHtml = '';
        if (isSuperadmin) {
          permBadgesHtml = '<span class="badge badge-warning" style="font-size: 0.72rem;"><i class="fa-solid fa-shield-halved"></i> Superadmin Total</span>';
        } else {
          const badges = [];
          if (perms.createInventory !== false) {
            badges.push('<span class="badge badge-success" style="font-size: 0.7rem;" title="Crear / Aperturar Inventarios"><i class="fa-solid fa-plus-circle"></i> Crear Inv</span>');
          }
          if (perms.deleteSnapshots) {
            badges.push('<span class="badge badge-danger" style="font-size: 0.7rem;" title="Eliminar / Depurar Snapshots"><i class="fa-solid fa-trash-can"></i> Snapshots</span>');
          }
          if (perms.manageUsers) {
            badges.push('<span class="badge badge-info" style="font-size: 0.7rem;" title="Gestión de Usuarios"><i class="fa-solid fa-users-gear"></i> Usuarios</span>');
          }
          if (perms.exportReports !== false && (u.role === 'ADMIN' || u.role === 'ENCARGADO')) {
            badges.push('<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.7rem;" title="Reportes PDF y Excel"><i class="fa-solid fa-file-pdf"></i> Reportes</span>');
          }
          if (isGlobal) {
            badges.push('<span class="badge badge-neutral" style="font-size: 0.7rem;" title="Acceso Global"><i class="fa-solid fa-globe"></i> Global</span>');
          } else if (Array.isArray(u.allowedCenters) && u.allowedCenters.length > 0) {
            badges.push(`<span class="badge badge-neutral" style="font-size: 0.7rem;">${u.allowedCenters.length} Centros</span>`);
          }

          permBadgesHtml = badges.length > 0
            ? `<div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">${badges.join('')}</div>`
            : '<span style="font-size: 0.75rem; color: var(--text-dim);">Estándar de rol</span>';
        }

        return `
          <tr>
            <td>
              <strong style="color: var(--primary);">${u.username}</strong>
              ${isSuperadmin ? '<span class="badge badge-warning" style="font-size: 0.68rem; margin-left: 0.3rem;">Superadmin</span>' : ''}
              ${isTargetAdmin && !isSuperadmin ? '<span class="badge badge-primary" style="font-size: 0.68rem; margin-left: 0.3rem;">Admin</span>' : ''}
            </td>
            <td>${u.displayName || u.username}</td>
            <td><span class="badge badge-neutral">${u.cargo || u.role}</span></td>
            <td><span class="badge badge-info">${centerDesc}</span></td>
            <td>${permBadgesHtml}</td>
            <td><span class="badge ${u.active !== false ? 'badge-success' : 'badge-danger'}">${u.active !== false ? 'Activo' : 'Inactivo'}</span></td>
            <td>
              <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
                ${(!isSuperadmin || window.Auth?.isAlonso() || window.Auth?.canManageUsers()) ? `
                  <button class="btn btn-primary btn-sm" onclick="window.UserManagementView.openPermissionsModal('${u.id}')" title="Configurar Accesos y Privilegios" style="padding: 0.25rem 0.55rem; font-size: 0.75rem; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8;">
                    <i class="fa-solid fa-user-shield"></i> Accesos
                  </button>
                ` : ''}
                <button class="btn btn-secondary btn-sm" onclick="window.UserManagementView.editUser('${u.id}')" title="Editar Perfil" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;">
                  <i class="fa-solid fa-pen"></i>
                </button>
                ${!isSuperadmin ? `
                  <button class="btn btn-danger btn-sm" onclick="window.UserManagementView.deleteUser('${u.id}', '${u.username}')" title="Eliminar Usuario" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--danger);">Error: ${err.message}</td></tr>`;
    }
  },

  openPermissionsModal(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) {
      window.Toast?.danger('Usuario no encontrado');
      return;
    }

    const perms = user.permissions || {};
    const isAlonsoSuper = user.isSuperadmin || user.username.toLowerCase() === 'alonso';
    const isTargetAdmin = ['jcarlos', 'juancarlos', 'absael'].includes(String(user.username || '').toLowerCase()) || user.role === 'ADMIN';

    document.getElementById('perm-user-id').value = user.id;
    document.getElementById('perm-user-display').textContent = `${user.displayName || user.username} (${user.username})`;
    document.getElementById('perm-user-login-badge').textContent = `Login: ${user.username} • Cargo: ${user.cargo || user.role}`;
    document.getElementById('perm-user-role-badge').textContent = isTargetAdmin ? 'ADMINISTRADOR' : user.role;
    document.getElementById('perm-user-center-badge').textContent = `Centro: ${user.center || 'GLOBAL'}`;

    // Subtitle
    const sub = document.getElementById('perm-modal-subtitle');
    if (sub) {
      if (isTargetAdmin) {
        sub.innerHTML = `Configuración de accesos y privilegios para el <strong style="color: #38bdf8;">Administrador Corporativo</strong> ${user.displayName || user.username}`;
      } else {
        sub.textContent = `Configuración de privilegios para ${user.displayName || user.username} (${user.cargo || user.role})`;
      }
    }

    // Set permission checkboxes
    const chkCreate = document.getElementById('perm-create-inv');
    if (chkCreate) chkCreate.checked = perms.createInventory !== false;

    const chkSnap = document.getElementById('perm-delete-snapshots');
    if (chkSnap) chkSnap.checked = isAlonsoSuper || perms.deleteSnapshots === true || (isTargetAdmin && perms.deleteSnapshots !== false);

    const chkUsers = document.getElementById('perm-manage-users');
    if (chkUsers) chkUsers.checked = isAlonsoSuper || perms.manageUsers === true || (isTargetAdmin && perms.manageUsers !== false);

    const chkReports = document.getElementById('perm-export-reports');
    if (chkReports) chkReports.checked = perms.exportReports !== false;

    const chkRecalc = document.getElementById('perm-recalc-metrics');
    if (chkRecalc) chkRecalc.checked = perms.recalculateMetrics !== false;

    const chkJust = document.getElementById('perm-manage-just');
    if (chkJust) chkJust.checked = perms.manageJustifications !== false;

    // Centers scope
    const allowed = Array.isArray(user.allowedCenters) && user.allowedCenters.length > 0
      ? user.allowedCenters
      : [user.center || 'GLOBAL'];
    const isGlobal = allowed.includes('GLOBAL') || user.center === 'GLOBAL' || perms.viewAllCenters;

    const chkGlobal = document.getElementById('perm-center-global');
    if (chkGlobal) chkGlobal.checked = isGlobal;

    // Render center selector chips
    const centersContainer = document.getElementById('perm-centers-selector-area');
    if (centersContainer) {
      centersContainer.innerHTML = this.centersList.map(c => {
        const isChecked = isGlobal || allowed.includes(c.code);
        return `
          <label style="display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(15, 23, 42, 0.6); padding: 0.3rem 0.55rem; border-radius: 4px; border: 1px solid var(--border-glass); font-size: 0.75rem; color: var(--text-main); cursor: pointer;">
            <input type="checkbox" class="perm-center-chip-checkbox" value="${c.code}" ${isChecked ? 'checked' : ''} ${isGlobal ? 'disabled' : ''}>
            <span><strong>${c.code}</strong> - ${c.name}</span>
          </label>
        `;
      }).join('');
    }

    window.ModalHelper.open('modal-user-permissions');
  },

  editUser(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    const isEncargado = window.Auth.currentUser?.role === 'ENCARGADO';
    const roleSelect = document.getElementById('user-form-role');
    const centerSelect = document.getElementById('user-form-center');

    document.getElementById('user-form-id').value = user.id;
    document.getElementById('user-form-username').value = user.username;
    document.getElementById('user-form-username').disabled = true;
    document.getElementById('user-form-display').value = user.displayName || user.username;
    document.getElementById('user-form-pass').value = '';
    document.getElementById('user-form-pass').required = false;
    
    if (roleSelect) {
      roleSelect.value = user.role;
      roleSelect.disabled = isEncargado;
    }
    if (centerSelect) {
      centerSelect.value = user.center;
      centerSelect.disabled = isEncargado;
    }

    window.ModalHelper.open('modal-user-form');
  },

  async deleteUser(userId, username) {
    if (!confirm(`¿Está seguro de eliminar al usuario '${username}'?`)) return;

    try {
      await window.API.deleteUser(userId);
      window.Toast.success(`Usuario '${username}' eliminado`);
      this.loadUsers();
    } catch (err) {
      window.Toast.danger(err.message || 'Error eliminando usuario');
    }
  }
};
