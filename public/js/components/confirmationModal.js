// Modal Helper Component
window.ModalHelper = {
  open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
    }
  },

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      if (!document.querySelector('.modal-overlay.active')) {
        document.body.classList.remove('modal-open');
      }
    }
  },

  closeAll() {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    document.body.classList.remove('modal-open');
  },

  init() {
    const handleClose = (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        e.preventDefault();
        const modalId = closeBtn.getAttribute('data-close-modal');
        if (modalId) {
          this.close(modalId);
        } else {
          const parentModal = closeBtn.closest('.modal-overlay');
          if (parentModal) parentModal.classList.remove('active');
        }
      } else if (e.target.classList && e.target.classList.contains('modal-overlay')) {
        e.preventDefault();
        e.target.classList.remove('active');
        if (!document.querySelector('.modal-overlay.active')) {
          document.body.classList.remove('modal-open');
        }
      }
    };

    document.addEventListener('click', handleClose);
    document.addEventListener('touchend', handleClose, { passive: false });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAll();
      }
    });
  }
};

