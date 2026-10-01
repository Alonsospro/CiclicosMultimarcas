const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname,'..');
let checked = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','data','.git'].includes(entry.name)) continue;
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|gs)$/.test(entry.name)) { new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});checked++; }
  }
}
walk(root);
const html = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
for (const match of html.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^"]*)?"/g)) {
  if (/^https?:/.test(match[1])) continue;
  if (!fs.existsSync(path.join(root,'public',match[1]))) throw new Error('Missing client script: '+match[1]);
}
console.log(`Sintaxis y referencias locales verificadas: ${checked} archivos.`);
