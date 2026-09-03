// Modal Helper Component
window.ModalHelper = {
  open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  },

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  },

  init() {
    // Setup modal close listeners
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        const modalId = closeBtn.getAttribute('data-close-modal');
        this.close(modalId);
      } else if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
      }
    });
  }
};
