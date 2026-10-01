// Component: Brand Logo Rotator (NIBOL & Multimarcas Drive Logos)
// Provides seamless, fluid dual-buffer transitions and brand illumination
window.LogoRotator = {
  logos: [
    {
      id: 'nibol',
      file: 'nibol.svg',
      name: 'NIBOL S.A.',
      badge: 'MULTIMARCAS',
      tagline: 'Distribuidor Oficial & Concesionario',
      url: '/logos/nibol.svg',
      accent: '#10b981',
      glow: 'rgba(16, 185, 129, 0.38)'
    },
    {
      id: 'john-deere',
      file: 'john-deere.svg',
      name: 'John Deere',
      badge: 'JOHN DEERE',
      tagline: 'Maquinaria Agrícola & Construcción',
      url: '/logos/john-deere.svg',
      accent: '#367c2b',
      glow: 'rgba(54, 124, 43, 0.42)'
    },
    {
      id: 'volvo',
      file: 'volvo.svg',
      name: 'Volvo Construction',
      badge: 'VOLVO CE',
      tagline: 'Equipos & Maquinaria Pesada',
      url: '/logos/volvo.svg',
      accent: '#0284c7',
      glow: 'rgba(2, 132, 199, 0.42)'
    },
    {
      id: 'mack',
      file: 'mack.svg',
      name: 'Mack Trucks',
      badge: 'MACK TRUCKS',
      tagline: 'Camiones Pesados de Alto Rendimiento',
      url: '/logos/mack.svg',
      accent: '#ef4444',
      glow: 'rgba(239, 68, 68, 0.4)'
    },
    {
      id: 'foton',
      file: 'foton.svg',
      name: 'Foton Motors',
      badge: 'FOTON MOTORS',
      tagline: 'Vehículos Comerciales & Utilitarios',
      url: '/logos/foton.svg',
      accent: '#0ea5e9',
      glow: 'rgba(14, 165, 233, 0.4)'
    },
    {
      id: 'ud-trucks',
      file: 'ud-trucks.svg',
      name: 'UD Trucks',
      badge: 'UD TRUCKS',
      tagline: 'Transporte y Distribución Pesada',
      url: '/logos/ud-trucks.svg',
      accent: '#dc2626',
      glow: 'rgba(220, 38, 38, 0.4)'
    },
    {
      id: 'wirtgen',
      file: 'wirtgen.svg',
      name: 'Wirtgen Group',
      badge: 'WIRTGEN GROUP',
      tagline: 'Tecnologías de Pavimentación & Minería',
      url: '/logos/wirtgen.svg',
      accent: '#059669',
      glow: 'rgba(5, 150, 105, 0.4)'
    }
  ],

  currentIndex: 0,
  intervalId: null,
  isPaused: false,
  rotationTimeMs: 4200,

  // Dual-buffer layers state: 0 is layer-a, 1 is layer-b
  navActiveLayer: 0,
  loginActiveLayer: 0,
  isTransitioning: false,

  async init() {
    // Attempt to refresh logos list from Drive API if available, else use embedded defaults
    try {
      const res = await fetch('/api/logos');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.logos) && data.logos.length > 0) {
          // Merge remote logos with rich styling metadata
          const merged = data.logos.map(rem => {
            const existing = this.logos.find(l => l.id === rem.id || l.file === rem.file);
            return existing ? { ...existing, ...rem } : rem;
          });
          this.logos = merged;
        }
      }
    } catch (e) {
      // Standalone mode - seamlessly uses rich local SVGs
    }

    // Preload all logo images into browser cache for zero-latency transitions
    this.preloadLogos();

    // Setup interactive events on containers
    this.setupInteractivity('nav-logo-rotator');
    this.setupInteractivity('login-logo-rotator');

    // Initial render without animation
    this.applyBrand(this.currentIndex, true);

    // Start auto rotation
    this.start();
  },

  preloadLogos() {
    this.logos.forEach(logo => {
      if (logo.url) {
        const img = new Image();
        img.src = logo.url;
      }
    });
  },

  setupInteractivity(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.addEventListener('mouseenter', () => {
      this.isPaused = true;
    });

    el.addEventListener('mouseleave', () => {
      this.isPaused = false;
    });

    el.addEventListener('click', () => {
      this.triggerTactilePulse(el);
      this.next();
    });
  },

  triggerTactilePulse(container) {
    container.classList.remove('pulse-tactile');
    // Force reflow
    void container.offsetWidth;
    container.classList.add('pulse-tactile');
  },

  start() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (!this.isPaused) {
        this.next();
      }
    }, this.rotationTimeMs);
  },

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  },

  goTo(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.logos.length || targetIndex === this.currentIndex) return;
    this.currentIndex = targetIndex;
    this.applyBrand(this.currentIndex, false);
  },

  next() {
    if (this.logos.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.logos.length;
    this.applyBrand(this.currentIndex, false);
  },

  prev() {
    if (this.logos.length <= 1) return;
    this.currentIndex = (this.currentIndex - 1 + this.logos.length) % this.logos.length;
    this.applyBrand(this.currentIndex, false);
  },

  applyBrand(index, immediate = false) {
    const brand = this.logos[index];
    if (!brand) return;

    // 1. Update Navbar Brand Rotator (Dual-buffer)
    this.performDualBufferTransition(
      'nav-logo-rotator',
      'nav-logo-a',
      'nav-logo-b',
      'navActiveLayer',
      brand,
      immediate
    );

    // 2. Update Login Screen Rotator (Dual-buffer)
    this.performDualBufferTransition(
      'login-logo-rotator',
      'login-logo-a',
      'login-logo-b',
      'loginActiveLayer',
      brand,
      immediate
    );

    // 3. Update dynamic illumination variables on root or containers
    const navRotator = document.getElementById('nav-logo-rotator');
    if (navRotator) {
      navRotator.style.setProperty('--current-brand-glow', brand.glow);
      navRotator.style.setProperty('--current-brand-accent', brand.accent);
    }

    const loginRotator = document.getElementById('login-logo-rotator');
    if (loginRotator) {
      loginRotator.style.setProperty('--current-brand-glow', brand.glow);
      loginRotator.style.setProperty('--current-brand-accent', brand.accent);
    }
  },

  performDualBufferTransition(containerId, layerAId, layerBId, activeLayerKey, brand, immediate) {
    const container = document.getElementById(containerId);
    const layerA = document.getElementById(layerAId);
    const layerB = document.getElementById(layerBId);
    if (!container || !layerA || !layerB) return;

    const isCurrentA = this[activeLayerKey] === 0;
    const currentLayer = isCurrentA ? layerA : layerB;
    const nextLayer = isCurrentA ? layerB : layerA;

    // Trigger sheen wave
    if (!immediate) {
      container.classList.remove('sheen-pulse');
      void container.offsetWidth; // force reflow
      container.classList.add('sheen-pulse');
    }

    if (immediate) {
      currentLayer.src = brand.url;
      currentLayer.alt = brand.name;
      currentLayer.title = `${brand.name} - NIBOL Multimarcas`;
      currentLayer.className = currentLayer.className.replace('is-inactive', '').trim() + ' is-active';

      nextLayer.className = nextLayer.className.replace('is-active', '').trim() + ' is-inactive';
      return;
    }

    // Set next layer image
    nextLayer.src = brand.url;
    nextLayer.alt = brand.name;
    nextLayer.title = `${brand.name} - NIBOL Multimarcas`;

    // Crossfade: activate nextLayer, deactivate currentLayer
    requestAnimationFrame(() => {
      nextLayer.classList.remove('is-inactive');
      nextLayer.classList.add('is-active');

      currentLayer.classList.remove('is-active');
      currentLayer.classList.add('is-inactive');

      // Swap active layer pointer
      this[activeLayerKey] = isCurrentA ? 1 : 0;
    });
  }
};
