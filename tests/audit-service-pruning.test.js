const test = require('node:test');
const assert = require('node:assert/strict');
const auditService = require('../src/services/auditService');

test('auditService sanitizes large payloads', () => {
  const hugeDetails = 'X'.repeat(5000);
  const hugeReason = 'Y'.repeat(2000);
  const sanitized = auditService._sanitizeEntry({
    action: 'TEST_LARGE_ACTION',
    details: hugeDetails,
    reason: hugeReason,
    user: 'testuser',
    center: '1120'
  });

  assert.ok(sanitized);
  assert.ok(sanitized.details.length <= 1020);
  assert.ok(sanitized.details.includes('[truncado]'));
  assert.ok(sanitized.reason.length <= 520);
  assert.ok(sanitized.reason.includes('[truncado]'));
});

test('auditService prunes older entries below size limits and preserves latest', () => {
  const dummyLogs = Array.from({ length: 600 }, (_, i) => ({
    id: 'LOG-' + i,
    timestamp: new Date().toISOString(),
    action: 'COUNT_REGISTERED',
    details: 'Some item count logged for SKU-' + i,
    user: 'auditor'
  }));

  const pruned = auditService._pruneLogs(dummyLogs, 400, 350000);
  assert.ok(pruned.length <= 400);
  const bytes = Buffer.byteLength(JSON.stringify(pruned), 'utf8');
  assert.ok(bytes <= 350000);
  assert.equal(pruned[pruned.length - 1].id, 'LOG-599');
});
