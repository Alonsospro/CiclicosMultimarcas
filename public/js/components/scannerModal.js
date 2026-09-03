// Camera Barcode Scanner Component
window.ScannerComponent = {
  html5QrCode: null,
  activeElementId: null,
  lastScanTime: 0,
  isScanning: false,

  playBeep() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880Hz A5
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {
      // Audio not permitted or not supported
    }
  },

  async start(elementId, onScanSuccess) {
    if (this.isScanning) {
      await this.stop();
    }

    this.activeElementId = elementId;
    const readerElement = document.getElementById(elementId);
    if (!readerElement) return;

    try {
      this.html5QrCode = new Html5Qrcode(elementId);
      this.isScanning = true;

      const qrCodeSuccessCallback = (decodedText) => {
        const now = Date.now();
        if (now - this.lastScanTime < (window.AppConfig.scanDelayMs || 1000)) {
          return; // debounce
        }
        this.lastScanTime = now;
        this.playBeep();

        if (typeof onScanSuccess === 'function') {
          onScanSuccess(decodedText);
        }
      };

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        aspectRatio: 1.777778
      };

      await this.html5QrCode.start(
        { facingMode: 'environment' },
        config,
        qrCodeSuccessCallback,
        (errorMessage) => {
          // ignore frame read failures
        }
      );
    } catch (err) {
      console.warn('[Scanner] Camera start error:', err);
      this.isScanning = false;
      window.Toast.warning('No se pudo acceder a la cámara o se rechazó el permiso.');
    }
  },

  async stop() {
    if (this.html5QrCode && this.isScanning) {
      try {
        await this.html5QrCode.stop();
        this.html5QrCode.clear();
      } catch (err) {
        console.warn('[Scanner] Error stopping scanner:', err);
      }
      this.isScanning = false;
      this.html5QrCode = null;
    }
  }
};
