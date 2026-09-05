const test = require('node:test');
const assert = require('node:assert');
const gasService = require('../src/services/gasService');

test('runGasDiagnostics structure and execution', async (t) => {
  const report = await gasService.runGasDiagnostics({ verbose: false });

  assert.ok(report, 'Diagnostic report should be returned');
  assert.strictEqual(report.success, true, 'Report success should be true');
  assert.ok(typeof report.summary === 'object', 'Summary should be an object');
  assert.strictEqual(report.summary.totalEndpoints, 4, 'Should test 4 GAS endpoints');
  assert.ok(Array.isArray(report.endpoints), 'Endpoints should be an array');
  assert.strictEqual(report.endpoints.length, 4, 'Should have 4 endpoint entries');
  assert.ok(Array.isArray(report.rootCauses), 'Root causes should be an array');
  assert.ok(typeof report.formattedLog === 'string', 'Formatted log should be a string');
  assert.ok(report.formattedLog.includes('INTEGRACIÓN GOOGLE APPS SCRIPT Y DETECCIÓN DE INVENTARIOS'), 'Log should contain header');
});
