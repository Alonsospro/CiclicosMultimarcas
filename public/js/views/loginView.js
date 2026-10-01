// View: Login
window.LoginView = {
  init() {
    const form = document.getElementById('form-login');
    if (!form) return;

    // Password visibility toggle
    const toggleBtn = document.getElementById('btn-toggle-password');
    const passwordInput = document.getElementById('login-password');
    const toggleIcon = document.getElementById('icon-toggle-password');

    if (toggleBtn && passwordInput && toggleIcon) {
      toggleBtn.addEventListener('click', () => {
        const isPassword = passwordInput.getAttribute('type') === 'password';
        passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
        toggleIcon.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const submitBtn = document.getElementById('btn-login-submit');

      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value.trim() : '';

      if (!username || !password) {
        window.Toast.warning('Por favor ingrese usuario y contraseña');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';

      try {
        const user = await window.Auth.login(username, password);
        window.Toast.success(`Bienvenido/a, ${user.displayName || user.username}`);
        form.reset();
        if (toggleIcon) toggleIcon.className = 'fa-solid fa-eye';
        if (passwordInput) passwordInput.setAttribute('type', 'password');
        window.Router.navigate('inventories');
        window.updateGasHealthStatus?.(false);
      } catch (err) {
        window.Toast.danger(err.message || 'Error en autenticación');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Iniciar Sesión';
      }
    });
  }
};
