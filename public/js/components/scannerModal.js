// Camera barcode and QR scanner.
// Uses the browser's own detector where it reads our formats (Android Chrome), and ZXing-C++ compiled to
// WebAssembly everywhere else (iPhone, desktop). Both come through the Barcode Detection API, so the reading
// loop is the same. The library registers window.BarcodeDetectionAPI.BarcodeDetector (ZXing) and only fills
// window.BarcodeDetector where the browser has none.
window.ScannerComponent = {
  // The codes used on labels and shelves. Fewer formats means faster reads and fewer false positives.
  FORMATS: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code', 'data_matrix'],
  stream: null,
  video: null,
  detector: null,
  engine: null,
  activeElementId: null,
  isScanning: false,
  loopId: 0,
  lastScanTime: 0,
  lastCode: '',
  lastCodeSeenAt: 0,
  torchOn: false,

  playBeep() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (_) {
      // Audio not permitted or not supported
    }
    try { navigator.vibrate?.(60); } catch (_) {}
  },

  // The browser's own detector when it reads at least the codes we use; ZXing otherwise.
  async createDetector() {
    const zxing = window.BarcodeDetectionAPI?.BarcodeDetector;
    const native = window.BarcodeDetector && window.BarcodeDetector !== zxing ? window.BarcodeDetector : null;
    if (native) {
      try {
        const supported = await native.getSupportedFormats();
        const formats = this.FORMATS.filter(format => supported.includes(format));
        if (formats.includes('code_128') && formats.includes('qr_code')) {
          return { detector: new native({ formats }), engine: 'nativo' };
        }
      } catch (_) { /* falls back to ZXing */ }
    }
    if (zxing) return { detector: new zxing({ formats: this.FORMATS }), engine: 'zxing' };
    throw new Error('El lector de códigos no se pudo cargar. Revise la conexión y recargue la página.');
  },

  ensureStyles() {
    if (document.getElementById('scanner-component-styles')) return;
    const style = document.createElement('style');
    style.id = 'scanner-component-styles';
    style.textContent = `
      .scanner-stage { position: relative; width: 100%; height: 100%; }
      .scanner-stage video { width: 100%; height: 100%; object-fit: cover; display: block; background: #020617; }
      .scanner-torch { position: absolute; top: 8px; right: 8px; z-index: 12; border: 0; border-radius: 999px;
        width: 40px; height: 40px; background: rgba(2, 6, 23, 0.72); color: #fff; font-size: 1rem; cursor: pointer; }
      .scanner-torch.is-on { background: #facc15; color: #0f172a; }
      .scanner-engine { position: absolute; left: 8px; bottom: 6px; z-index: 12; font-size: 0.68rem; color: rgba(255,255,255,0.75);
        background: rgba(2, 6, 23, 0.55); padding: 1px 6px; border-radius: 4px; pointer-events: none; }`;
    document.head.appendChild(style);
  },

  // Returns true when the camera is reading; false when it could not start.
  async start(elementId, onScanSuccess) {
    if (this.isScanning) await this.stop();
    const readerElement = document.getElementById(elementId);
    if (!readerElement) return false;
    this.activeElementId = elementId;
    this.ensureStyles();

    try {
      const { detector, engine } = await this.createDetector();
      this.detector = detector;
      this.engine = engine;
      // ZXing downloads its engine on the first read; start it while the camera turns on.
      if (engine === 'zxing' && typeof ImageData === 'function') detector.detect(new ImageData(1, 1)).catch(() => {});
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Este navegador no permite usar la cámara.'), { name: 'NotSupportedError' });
      // The native detector copes with full HD; ZXing reads 720p faster with the same results on labels.
      const size = engine === 'nativo' ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, ...size } });
      const track = this.stream.getVideoTracks()[0];
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (_) {}

      readerElement.innerHTML = '';
      const stage = document.createElement('div');
      stage.className = 'scanner-stage';
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.autoplay = true;
      video.srcObject = this.stream;
      stage.appendChild(video);

      const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
      if (capabilities.torch) {
        const torch = document.createElement('button');
        torch.type = 'button';
        torch.className = 'scanner-torch';
        torch.title = 'Linterna';
        torch.innerHTML = '<i class="fa-solid fa-lightbulb"></i>';
        torch.onclick = () => this.toggleTorch(torch);
        stage.appendChild(torch);
      }
      const badge = document.createElement('span');
      badge.className = 'scanner-engine';
      badge.textContent = engine === 'nativo' ? 'Lector del equipo' : 'Lector ZXing';
      stage.appendChild(badge);
      readerElement.appendChild(stage);

      await video.play().catch(() => {});
      this.video = video;
      this.torchOn = false;
      this.isScanning = true;
      this.loop(onScanSuccess);
      return true;
    } catch (err) {
      console.warn('[Scanner] Camera start error:', err);
      await this.stop();
      const message = err?.name === 'NotAllowedError' ? 'Se rechazó el permiso de la cámara. Habilítelo en el navegador para escanear.'
        : err?.name === 'NotFoundError' ? 'No se encontró una cámara en este equipo.'
        : err?.name === 'NotReadableError' ? 'La cámara está en uso por otra aplicación.'
        : (err?.message || 'No se pudo acceder a la cámara.');
      window.Toast?.warning(message);
      return false;
    }
  },

  // One detection at a time: the next frame is read only after the previous one finished.
  loop(onScanSuccess) {
    const id = ++this.loopId;
    const pause = this.engine === 'nativo' ? 0 : 60;
    const tick = async () => {
      if (!this.isScanning || id !== this.loopId) return;
      const video = this.video;
      if (video && video.readyState >= 2 && video.videoWidth) {
        try {
          const codes = await this.detector.detect(video);
          const code = codes.find(found => String(found.rawValue || '').trim());
          if (code) this.accept(String(code.rawValue).trim(), onScanSuccess);
        } catch (_) { /* a frame that cannot be read is skipped */ }
      }
      if (!this.isScanning || id !== this.loopId) return;
      setTimeout(() => {
        if (video?.requestVideoFrameCallback) video.requestVideoFrameCallback(() => tick());
        else requestAnimationFrame(() => tick());
      }, pause);
    };
    tick();
  },

  // The same code still in front of the camera is read once; another code waits for the usual delay.
  accept(code, onScanSuccess) {
    const now = Date.now();
    const sameCode = code === this.lastCode;
    const seenRecently = now - this.lastCodeSeenAt < 1500;
    this.lastCodeSeenAt = now;
    if (sameCode && seenRecently) return;
    if (now - this.lastScanTime < (window.AppConfig?.scanDelayMs || 1000)) return;
    this.lastCode = code;
    this.lastScanTime = now;
    this.playBeep();
    if (typeof onScanSuccess === 'function') onScanSuccess(code);
  },

  async toggleTorch(button) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !this.torchOn }] });
      this.torchOn = !this.torchOn;
      button?.classList.toggle('is-on', this.torchOn);
    } catch (_) {
      window.Toast?.info('Este equipo no permite encender la linterna desde el navegador.');
    }
  },

  async stop() {
    this.loopId++;
    this.isScanning = false;
    try { this.stream?.getTracks().forEach(track => track.stop()); } catch (_) {}
    if (this.video) { try { this.video.srcObject = null; } catch (_) {} }
    const readerElement = this.activeElementId && document.getElementById(this.activeElementId);
    if (readerElement) readerElement.innerHTML = '';
    this.stream = null;
    this.video = null;
    this.torchOn = false;
    this.lastCode = '';
  }
};

// Closing the scanner window turns the camera off as well.
document.addEventListener('click', event => {
  const close = event.target.closest?.('[data-close-modal="modal-camera-scanner"]');
  if (close && window.ScannerComponent.activeElementId === 'general-reader') window.ScannerComponent.stop();
});
