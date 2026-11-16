const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(window) {
  const context = vm.createContext({ window, document: { addEventListener() {}, getElementById: () => null }, navigator: {}, setTimeout, Date });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/components/scannerModal.js'), 'utf8'), context);
  return context.window.ScannerComponent;
}

test('the browser detector is used only when it reads our codes; ZXing covers the rest', async () => {
  class Zxing { constructor(options) { this.options = options; } }
  class Native { constructor(options) { this.options = options; } static async getSupportedFormats() { return ['code_128', 'qr_code', 'ean_13']; } }
  const withNative = await load({ BarcodeDetector: Native, BarcodeDetectionAPI: { BarcodeDetector: Zxing } }).createDetector();
  assert.equal(withNative.engine, 'nativo');
  assert.equal(withNative.detector.options.formats.join(), 'code_128,ean_13,qr_code');

  class Poor { static async getSupportedFormats() { return ['qr_code']; } }
  const poor = await load({ BarcodeDetector: Poor, BarcodeDetectionAPI: { BarcodeDetector: Zxing } }).createDetector();
  assert.equal(poor.engine, 'zxing', 'A browser that cannot read Code 128 falls back to ZXing');

  const polyfilled = await load({ BarcodeDetector: Zxing, BarcodeDetectionAPI: { BarcodeDetector: Zxing } }).createDetector();
  assert.equal(polyfilled.engine, 'zxing');
  assert.ok(polyfilled.detector.options.formats.includes('qr_code'));

  await assert.rejects(load({}).createDetector(), /no se pudo cargar/);
});

test('a code still in front of the camera is read once, and a different one waits for the scan delay', () => {
  const scanner = load({ AppConfig: { scanDelayMs: 1000 } });
  scanner.playBeep = () => {};
  const reads = [];
  let now = 10000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    scanner.accept('A', code => reads.push(code));
    now += 300; scanner.accept('A', code => reads.push(code));
    now += 300; scanner.accept('B', code => reads.push(code));
    now += 800; scanner.accept('B', code => reads.push(code));
    now += 3000; scanner.accept('B', code => reads.push(code));
  } finally { Date.now = realNow; }
  assert.equal(reads.join(), 'A,B,B');
});
