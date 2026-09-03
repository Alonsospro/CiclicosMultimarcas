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
    if (viewName === 'justifications' && !window.Auth.hasRole(['ADMIN'])) {
      window.Toast.warning('Acceso exclusivo para administradores');
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
  } else {
    window.Router.navigate('login');
  }
});
