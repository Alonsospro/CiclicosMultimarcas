const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loader() {
  const body = [];
  const makeCard = () => {
    const text = {textContent:''};
    const card = {className:'', innerHTML:'', setAttribute() {}, querySelector:() => text, text, remove() { body.splice(body.indexOf(card), 1); }};
    return card;
  };
  const window = {};
  vm.runInNewContext(read('public/js/components/deerLoader.js'), {window, document:{createElement:makeCard, body:{appendChild:node => body.push(node)}}});
  return {DeerLoader:window.DeerLoader, body};
}

test('the deer comes from the logo and has no text or badge of its own', () => {
  const svg = read('public/logos/john-deere-venado.svg');
  assert.equal(svg.match(/<path/g).length, 1);
  assert.doesNotMatch(svg, /<text|<image|<polygon/);
  const outline = read('public/logos/john-deere.svg').replace(/\s+/g, '');
  const deer = svg.match(/ d="([^"]*)"/)[1];
  assert.ok(outline.includes(deer.slice(0, 200)));
});

test('the waiting markup escapes its text and carries the deer', () => {
  const {DeerLoader} = loader();
  const html = DeerLoader.html('Cargando <b>');
  assert.match(html, /Cargando &lt;b&gt;/);
  assert.match(html, /john-deere-venado\.svg/);
  assert.match(html, /aria-hidden="true"/);
});

test('the floating card stays until every wait ends, and ending one twice changes nothing', () => {
  const {DeerLoader, body} = loader();
  const endFirst = DeerLoader.show('Generando PDF');
  const endSecond = DeerLoader.show('Generando Excel');
  assert.equal(body.length, 1);
  assert.equal(body[0].text.textContent, 'Generando Excel');
  endSecond();
  endSecond();
  assert.equal(body.length, 1);
  assert.equal(body[0].text.textContent, 'Generando PDF');
  endFirst();
  assert.equal(body.length, 0);
});

test('the page loads the loader before the views and respects reduced motion', () => {
  const page = read('public/index.html');
  assert.ok(page.indexOf('/js/components/deerLoader.js') > 0);
  assert.ok(page.indexOf('/js/components/deerLoader.js') < page.indexOf('/js/views/inventoryView.js'));
  assert.ok(page.includes('/css/deer-loader.css'));
  assert.match(read('public/css/deer-loader.css'), /prefers-reduced-motion: reduce[\s\S]*animation: none/);
});
