// Authentication and Session State Manager
window.Auth = {
  currentUser: null,
  token: null,

  init() {
    this.token = localStorage.getItem(window.AppConfig.storageTokenKey);
    const storedUser = localStorage.getItem(window.AppConfig.storageUserKey);
    if (storedUser) {
      try {
        this.currentUser = JSON.parse(storedUser);
      } catch (e) {
        this.currentUser = null;
      }
    }
  },

  async checkSession() {
    if (!this.token) {
      this.logout(false);
      return false;
    }

    try {
      const res = await window.API.getMe();
      if (res && res.user) {
        this.currentUser = res.user;
        localStorage.setItem(window.AppConfig.storageUserKey, JSON.stringify(res.user));
        this.updateUI();
        return true;
      }
    } catch (e) {
      this.logout(false);
      return false;
    }
    return false;
  },

  async login(username, password) {
    const res = await window.API.login(username, password);
    this.token = res.token;
    this.currentUser = res.user;
    localStorage.setItem(window.AppConfig.storageTokenKey, res.token);
    localStorage.setItem(window.AppConfig.storageUserKey, JSON.stringify(res.user));
    this.updateUI();
    return res.user;
  },

  logout(showToast = true) {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem(window.AppConfig.storageTokenKey);
    localStorage.removeItem(window.AppConfig.storageUserKey);

    document.getElementById('main-navbar').style.display = 'none';
    window.Router.navigate('login');

    if (showToast) {
      window.Toast.info('Sesión finalizada.');
    }
  },

  updateUI() {
    if (!this.currentUser) return;

    const nav = document.getElementById('main-navbar');
    nav.style.display = 'flex';

    const centerLabel = this.currentUser.centerName
      ? `${this.currentUser.center} - ${this.currentUser.centerName}`
      : this.currentUser.center;
    const roleLabel = this.currentUser.cargo || this.currentUser.role;

    document.getElementById('nav-user-name').textContent = this.currentUser.displayName || this.currentUser.username;
    document.getElementById('nav-user-role').textContent = `${roleLabel} • ${centerLabel}`;

    const role = this.currentUser.role;
    const isSuperadmin = !!this.currentUser.isSuperadmin;
    const isAlonso = this.isAlonso();
    const canCreateInv = this.canCreateInventory();
    const isAdmin = role === 'ADMIN' || isSuperadmin;

    // Toggle role-specific navigation buttons
    document.querySelectorAll('.role-admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    document.querySelectorAll('.role-encargado-admin').forEach(el => {
      el.style.display = (isAdmin || role === 'ENCARGADO') ? '' : 'none';
    });

    document.querySelectorAll('.role-superadmin-alonso-only').forEach(el => {
      el.style.display = isAlonso ? '' : 'none';
    });

    document.querySelectorAll('.role-inventory-creator-only').forEach(el => {
      el.style.display = canCreateInv ? '' : 'none';
    });

    const invSubtitle = document.getElementById('inv-header-subtitle');
    if (invSubtitle) {
      if (role === 'AUXILIAR') {
        invSubtitle.textContent = `Inventarios asignados a su usuario (${centerLabel})`;
      } else {
        invSubtitle.textContent = 'Listado de inventarios según centro y permisos';
      }
    }

    // For Auxiliares and Encargados, lock / constrain center dropdowns to their own center
    if (!isAdmin) {
      const userCenter = this.currentUser.center;
      const centerDropdowns = ['filter-inv-center', 'filter-dash-center', 'dash-filter-center', 'filter-just-center', 'filter-assign-center', 'barrido-center-select'];
      centerDropdowns.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
          select.value = userCenter;
          select.disabled = true;
          select.title = `Bloqueado a su centro asignado (${userCenter})`;
        }
      });
    }
  },

  hasRole(allowedRoles = []) {
    if (!this.currentUser) return false;
    if (this.currentUser.isSuperadmin || this.currentUser.role === 'ADMIN') return true;
    return allowedRoles.includes(this.currentUser.role);
  },

  isAlonso() {
    if (!this.currentUser) return false;
    if (this.currentUser.isSuperadmin) return true;
    const u = String(this.currentUser.username || '').toLowerCase().trim();
    const d = String(this.currentUser.displayName || '').toLowerCase().trim();
    return u === 'alonso' || d.includes('alonso rios') || this.currentUser.clave === 'ADM';
  },

  canCreateInventory() {
    if (!this.currentUser) return false;
    if (this.isAlonso()) return true;
    const u = String(this.currentUser.username || '').toLowerCase().trim();
    const d = String(this.currentUser.displayName || '').toLowerCase().trim();
    return u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'juan_carlos' || u === 'juan.carlos' || d.includes('juan carlos') || this.currentUser.clave === 'JCS';
  },

  isSameCenter(centerA, centerB) {
    if (!centerA || !centerB) return false;
    const a = String(centerA).trim().toLowerCase();
    const b = String(centerB).trim().toLowerCase();
    if (a === 'global' || b === 'global') return true;
    if (a === b) return true;

    // Check warnes / 1120 aliases
    const isWarnesA = a === '1120' || a.includes('warnes') || a.includes('km 14') || a.includes('volvo');
    const isWarnesB = b === '1120' || b.includes('warnes') || b.includes('km 14') || b.includes('volvo');
    if (isWarnesA && isWarnesB) return true;

    // Direct code extraction or containment
    const codeA = a.match(/\b\d{4}\b/)?.[0];
    const codeB = b.match(/\b\d{4}\b/)?.[0];
    if (codeA && codeB && codeA === codeB) return true;

    return a.includes(b) || b.includes(a);
  }
};
