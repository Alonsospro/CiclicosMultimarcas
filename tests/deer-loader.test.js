const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loader(elements = {}) {
  const body = [];
  const makeScreen = () => {
    const text = {textContent:''}, hide = {addEventListener(event, handler) { this.click = handler; }};
    const screen = {className:'', innerHTML:'', text, hide, setAttribute() {},
      querySelector:selector => selector === '.deer-loading-text' ? text : hide,
      remove() { body.splice(body.indexOf(screen), 1); }};
    return screen;
  };
  const window = {};
  vm.runInNewContext(read('public/js/components/deerLoader.js'), {window,
    document:{createElement:makeScreen, getElementById:id => elements[id], body:{appendChild:node => body.push(node)}}});
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

test('the loading screen stays until every wait ends, and ending one twice changes nothing', () => {
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

test('a wait that never ends can be hidden, and the next wait shows the screen again', () => {
  const {DeerLoader, body} = loader();
  const end = DeerLoader.show('Leyendo');
  body[0].hide.click();
  assert.equal(body.length, 0);
  const other = DeerLoader.show('Otra espera');
  assert.equal(body.length, 0, 'still hidden while the stuck wait is running');
  end();
  other();
  DeerLoader.show('Nueva');
  assert.equal(body.length, 1);
});

test('a tracked load ends the screen when it finishes or fails, and skips a view that is not on screen', async () => {
  const {DeerLoader, body} = loader({shown:{offsetParent:{}}, hidden:{offsetParent:null}});
  let during = null;
  const view = {
    value:7,
    async ok() { during = body.length; return this.value; },
    async bad() { during = body.length; throw new Error('sin red'); },
    async quiet() { during = body.length; }
  };
  DeerLoader.track(view, 'ok', 'Cargando', 'shown');
  DeerLoader.track(view, 'bad', 'Cargando', 'shown');
  DeerLoader.track(view, 'quiet', 'Cargando', 'hidden');
  assert.equal(await view.ok(), 7);
  assert.equal(during, 1);
  assert.equal(body.length, 0);
  await assert.rejects(view.bad(), /sin red/);
  assert.equal(during, 1);
  assert.equal(body.length, 0);
  await view.quiet();
  assert.equal(during, 0);
});

test('the page loads the loader before the views and respects reduced motion', () => {
  const page = read('public/index.html');
  assert.ok(page.indexOf('/js/components/deerLoader.js') > 0);
  assert.ok(page.indexOf('/js/components/deerLoader.js') < page.indexOf('/js/views/inventoryView.js'));
  assert.ok(page.includes('/css/deer-loader.css'));
  const css = read('public/css/deer-loader.css');
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.match(css, /\.deer-loading-screen[\s\S]*position: fixed[\s\S]*inset: 0/);
  assert.match(css, /backdrop-filter: blur/);
});
