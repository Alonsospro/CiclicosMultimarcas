/**
 * ============================================================================
 * BUTTON FEEDBACK • SISTEMA TACTIL DE CONFIRMACIÓN DE CLIC Y RIPPLE (NIBOL)
 * ============================================================================
 * Proporciona confirmación visual instantánea e inequívoca al hacer clic en
 * cualquier botón o control interactivo del sistema, resolviendo la falta de
 * retroalimentación y confirmando que la acción fue registrada exitosamente.
 */

(function () {
  'use strict';

  const BUTTON_SELECTOR = [
    'button',
    '.btn',
    '.dash-tab-btn',
    '.nav-item-btn',
    '.pill-btn',
    '.btn-close',
    '.close-btn',
    '.nav-icon-btn',
    '.just-view-mode-btn',
    '.just-nav-floating-btn',
    '.count-filter-btn',
    '.user-dropdown-trigger',
    '.btn-add-loc-plus',
    '[role="button"]'
  ].join(', ');

  /**
   * Dispara la animación de confirmación táctil y onda expansiva (ripple)
   * @param {HTMLElement} btn - Elemento botón clickeado
   * @param {MouseEvent|PointerEvent|TouchEvent|null} event - Evento origen
   */
  function triggerButtonFeedback(btn, event) {
    if (!btn) return;

    // No animar si el botón está deshabilitado o finalizado de solo lectura
    if (
      btn.disabled ||
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.classList.contains('disabled') ||
      btn.classList.contains('btn-finalized')
    ) {
      return;
    }

    // 1. Remover estado de presión previa y reiniciar animación pop
    btn.classList.remove('btn-active-press');
    btn.classList.remove('btn-clicked');
    
    // Forzar reflow para reiniciar la animación CSS si se clickea rápidamente de nuevo
    void btn.offsetWidth;
    btn.classList.add('btn-clicked');

    // 2. Localizar coordenadas relativas del clic
    const rect = btn.getBoundingClientRect();
    let clickX = rect.width / 2;
    let clickY = rect.height / 2;

    if (event) {
      let clientX = null;
      let clientY = null;

      if (event.clientX !== undefined && event.clientY !== undefined && (event.clientX !== 0 || event.clientY !== 0)) {
        clientX = event.clientX;
        clientY = event.clientY;
      } else if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
      } else if (event.changedTouches && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
      }

      if (clientX !== null && clientY !== null) {
        clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        clickY = Math.max(0, Math.min(rect.height, clientY - rect.top));
      }
    }

    // Asegurar posicionamiento y contención visual
    const computed = window.getComputedStyle(btn);
    if (computed.position === 'static') {
      btn.style.position = 'relative';
    }
    if (computed.overflow !== 'hidden') {
      btn.style.overflow = 'hidden';
    }

    // 3. Crear onda expansiva dinámica (Ripple)
    const maxDim = Math.max(rect.width, rect.height);
    const rippleSize = Math.max(maxDim * 2.2, 50);

    // Limpiar ondas previas del mismo botón
    const oldRipples = btn.querySelectorAll('.btn-click-ripple, .btn-click-flash');
    oldRipples.forEach((r) => r.remove());

    const ripple = document.createElement('span');
    ripple.className = 'btn-click-ripple';
    ripple.style.width = `${rippleSize}px`;
    ripple.style.height = `${rippleSize}px`;
    ripple.style.left = `${clickX}px`;
    ripple.style.top = `${clickY}px`;

    // Destello de superficie
    const flash = document.createElement('span');
    flash.className = 'btn-click-flash';

    // Inserción asíncrona no bloqueante para nunca interferir con el dispatch nativo de eventos
    requestAnimationFrame(() => {
      try {
        btn.appendChild(ripple);
        btn.appendChild(flash);
      } catch (e) {}
    });

    // 4. Limpieza programada después de terminar la animación
    setTimeout(() => {
      try {
        ripple.remove();
        flash.remove();
      } catch (e) {}
    }, 550);

    setTimeout(() => {
      try {
        btn.classList.remove('btn-clicked');
      } catch (e) {}
    }, 450);
  }

  // Captura global de PointerDown (inicia la sensación táctil inmediata)
  document.addEventListener(
    'pointerdown',
    (e) => {
      try {
        const btn = e.target.closest(BUTTON_SELECTOR);
        if (
          btn &&
          !btn.disabled &&
          btn.getAttribute('aria-disabled') !== 'true' &&
          !btn.classList.contains('disabled') &&
          !btn.classList.contains('btn-finalized')
        ) {
          btn.classList.add('btn-active-press');
        }
      } catch (err) {}
    },
    { capture: false, passive: true }
  );

  // Limpieza de PointerDown si se sale del botón o se cancela
  function clearPressState(e) {
    try {
      const btn = e.target.closest(BUTTON_SELECTOR);
      if (btn) {
        btn.classList.remove('btn-active-press');
      }
    } catch (err) {}
  }

  document.addEventListener('pointerup', clearPressState, { capture: false, passive: true });
  document.addEventListener('pointercancel', clearPressState, { capture: false, passive: true });

  // Captura global de Clic para confirmación visual sin bloquear eventos ni navegación
  document.addEventListener(
    'click',
    (e) => {
      try {
        const btn = e.target.closest(BUTTON_SELECTOR);
        if (btn) {
          triggerButtonFeedback(btn, e);
        }
      } catch (err) {}
    },
    { capture: false, passive: true }
  );

  // Soporte para activación por teclado (Enter o Espacio)
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const active = document.activeElement;
        if (active && active.matches && active.matches(BUTTON_SELECTOR)) {
          triggerButtonFeedback(active, null);
        }
      }
    },
    true
  );

  // Exponer API global para llamadas manuales si se requiere
  window.ButtonFeedback = {
    trigger: triggerButtonFeedback,
    selector: BUTTON_SELECTOR
  };
})();
