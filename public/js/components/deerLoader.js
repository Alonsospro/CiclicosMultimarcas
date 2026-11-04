// The loading animation for long waits: the John Deere deer from public/logos, leaping over a moving ground line.
// Button spinners stay as they are; this is for lists, screens and operations that take a while.
(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const mark = '<span class="deer-loader" aria-hidden="true"><span class="deer-loader-ground"></span><img class="deer-loader-deer" src="/logos/john-deere-venado.svg" alt=""></span>';
  const running = [];
  let card = null;

  function refresh() {
    if (!running.length) {
      card?.remove();
      card = null;
      return;
    }
    if (!card) {
      card = document.createElement('div');
      card.className = 'deer-loading-card';
      card.setAttribute('role', 'status');
      card.innerHTML = `${mark}<span class="deer-loading-text"></span>`;
      document.body.appendChild(card);
    }
    card.querySelector('.deer-loading-text').textContent = running[running.length - 1].text;
  }

  window.DeerLoader = {
    mark,
    // Markup for a place that is waiting for its content.
    html: text => `<div class="deer-loading" role="status">${mark}<span class="deer-loading-text">${esc(text)}</span></div>`,
    // A floating card that never blocks the screen. Returns the function that ends this wait; calling it twice is safe.
    show(text) {
      const entry = { text };
      running.push(entry);
      refresh();
      return () => {
        const index = running.indexOf(entry);
        if (index >= 0) running.splice(index, 1);
        refresh();
      };
    }
  };
})();
