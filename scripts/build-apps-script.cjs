const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
const source = read('src/services/inventoryContract.js');
const contract = source.replace("if (typeof module !== 'undefined') module.exports = InventoryContract;", '');
let legacy = read('integrations/apps-script/InventoryWebhook.gs');
const start = legacy.indexOf('// Canonical quantities:');
const end = legacy.indexOf('const SHEET_COLUMNS =', start);
if (start < 0 || end < 0) throw new Error('No se encontró el contrato incrustado.');
legacy = legacy.slice(0, start) + contract + '\n' + legacy.slice(end);
write('integrations/apps-script/InventoryWebhook.gs', legacy);
const weekly = legacy.replace("const SHEET_LAYOUT = 'LEGACY_40';", "const SHEET_LAYOUT = 'WEEKLY_43_V1';")
  .replace(/^\/\*\*[\s\S]*?\*\//, `/**
 * SEMANALES: 43 columnas A:AQ. Generado por scripts/build-apps-script.cjs.
 * Pegar el archivo completo en el proyecto Apps Script del Sheet semanal.
 * K: stock inicial inmutable. M: total del primer conteo físico.
 * Y / AK: compensaciones firmadas, positivas para faltantes y negativas para sobrantes.
 * L: último total físico + compensaciones vigentes; no suma etapas físicas entre sí.
 * Los cíclicos conservan InventoryWebhook.gs y su formato de 40 columnas.
 */`);
write('integrations/apps-script/InventoryWebhookSemanales.gs', weekly);
write('public/js/inventoryContract.js', contract + '\nwindow.InventoryContract = InventoryContract;\n');
console.log('Contrato sincronizado: Node, navegador y Apps Scripts 40/43 columnas.');
