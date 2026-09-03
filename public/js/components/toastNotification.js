// Toast Notification Component
window.Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
  },

  show(message, type = 'info', duration = 3500) {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
      <i class="fa-solid ${icon}" style="font-size: 1.2rem;"></i>
      <div style="flex: 1; font-size: 0.9rem; line-height: 1.3;">${message}</div>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg, dur) { this.show(msg, 'success', dur); },
  danger(msg, dur) { this.show(msg, 'danger', dur); },
  warning(msg, dur) { this.show(msg, 'warning', dur); },
  info(msg, dur) { this.show(msg, 'info', dur); }
};
