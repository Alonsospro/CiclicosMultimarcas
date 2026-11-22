const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
// Line endings vary with the checkout (CRLF on Windows), so they are compared normalized.
const read = file => fs.readFileSync(file, 'utf8').replace(/
/g, '
');

test('the password generator page is built from its template with the server bcryptjs', () => {
  const template = read(path.join(root, 'tools/generador-contrasenas.template.html'));
  const bcrypt = read(require.resolve('bcryptjs/dist/bcrypt.min.js')).trim();
  const page = read(path.join(root, 'tools/generador-contrasenas.html'));
  assert.equal(page, template.replace('/*BCRYPTJS*/', () => bcrypt), 'Run node scripts/build-password-tool.cjs');
  assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+href=|fetch\(/, 'The page loads nothing from the network');
});
