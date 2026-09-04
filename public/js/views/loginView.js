// View: Login
window.LoginView = {
  init() {
    const form = document.getElementById('form-login');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const submitBtn = document.getElementById('btn-login-submit');

      const username = usernameInput.value.trim();
      const password = passwordInput.value;

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
