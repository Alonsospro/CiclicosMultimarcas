// Builds tools/generador-contrasenas.html: a standalone page (works offline, opened from disk)
// with the same bcryptjs the server uses inlined, so its hashes match the appweb login.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'tools/generador-contrasenas.template.html'), 'utf8');
const bcrypt = fs.readFileSync(require.resolve('bcryptjs/dist/bcrypt.min.js'), 'utf8').trim();
if (!template.includes('/*BCRYPTJS*/')) throw new Error('Falta el marcador /*BCRYPTJS*/ en la plantilla');
fs.writeFileSync(path.join(root, 'tools/generador-contrasenas.html'), template.replace('/*BCRYPTJS*/', () => bcrypt));
console.log('Generador escrito en tools/generador-contrasenas.html');
