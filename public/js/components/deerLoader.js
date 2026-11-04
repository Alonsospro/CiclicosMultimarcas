// The loading screen for long waits: the John Deere deer from public/logos, leaping in the center over a blurred page.
// Button spinners stay as they are; this is for lists, screens and operations that take a while.
(function () {
  const mark = '<span class="deer-loader" aria-hidden="true"><span class="deer-loader-ground"></span><img class="deer-loader-deer" src="/logos/john-deere-venado.svg" alt=""></span>';
  const running = [];
  let screen = null;
  let dismissed = false;

  function refresh() {
    if (!running.length) dismissed = false;
    if (!running.length || dismissed) {
      screen?.remove();
      screen = null;
      return;
    }
    if (!screen) {
      screen = document.createElement('div');
      screen.className = 'deer-loading-screen';
      screen.setAttribute('role', 'status');
      screen.innerHTML = `${mark}<span class="deer-loading-text"></span><button type="button" class="deer-loading-hide">Seguir trabajando mientras termina</button>`;
      // The page stays locked during a wait, so a request that never answers must not trap the user.
      screen.querySelector('.deer-loading-hide').addEventListener('click', () => {
        dismissed = true;
        refresh();
      });
      document.body.appendChild(screen);
    }
    screen.querySelector('.deer-loading-text').textContent = running[running.length - 1].text;
  }

  function show(text) {
    const entry = { text };
    running.push(entry);
    refresh();
    // Ends this wait; calling it twice is safe.
    return () => {
      const index = running.indexOf(entry);
      if (index >= 0) running.splice(index, 1);
      refresh();
    };
  }

  window.DeerLoader = {
    mark,
    show,
    // Shows the screen for as long as a view's load runs, only if that view is on screen.
    track(owner, method, text, targetId) {
      const load = owner[method];
      owner[method] = async function (...args) {
        const end = document.getElementById(targetId)?.offsetParent ? show(text) : null;
        try {
          return await load.apply(this, args);
        } finally {
          end?.();
        }
      };
    }
  };
})();
