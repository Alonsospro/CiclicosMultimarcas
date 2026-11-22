const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('the password generator page is built from its template with the server bcryptjs', () => {
  const template = fs.readFileSync(path.join(root, 'tools/generador-contrasenas.template.html'), 'utf8');
  const bcrypt = fs.readFileSync(require.resolve('bcryptjs/dist/bcrypt.min.js'), 'utf8').trim();
  const page = fs.readFileSync(path.join(root, 'tools/generador-contrasenas.html'), 'utf8');
  assert.equal(page, template.replace('/*BCRYPTJS*/', () => bcrypt), 'Run node scripts/build-password-tool.cjs');
  assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+href=|fetch\(/, 'The page loads nothing from the network');
});
