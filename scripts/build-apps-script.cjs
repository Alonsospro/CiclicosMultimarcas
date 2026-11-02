// Copies src/services/inventoryContract.js into every file that embeds it:
// the browser bundle and the Apps Scripts that share the quantity contract.
// The deployed cyclic webhook (produccion/InventoryWebhook.gs) keeps its own older contract.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
const contract = read('src/services/inventoryContract.js')
  .replace("if (typeof module !== 'undefined') module.exports = InventoryContract;", '').trimEnd() + '\n';

write('public/js/inventoryContract.js', contract + '\nwindow.InventoryContract = InventoryContract;\n');

const START = '// Canonical quantities:', END = '\n})();\n';
for (const file of ['integrations/apps-script/InventoryWebhook.gs', 'integrations/apps-script/InventoryWebhookSemanales.gs',
  'integrations/apps-script/produccion/InventoryWebhookSemanales.gs']) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const source = read(file);
  const start = source.indexOf(START), end = source.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error('No se encontró el contrato incrustado en ' + file);
  write(file, source.slice(0, start) + contract + source.slice(end + END.length));
}
console.log('Contrato sincronizado: navegador y Apps Scripts.');
