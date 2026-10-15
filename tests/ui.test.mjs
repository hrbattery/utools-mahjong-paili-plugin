import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const page = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const asset = page.match(/src="([^"]+\.js)"/)[1];
const bundle = readFileSync(new URL(`../dist/${asset}`, import.meta.url), 'utf8');

/** Run the actual production bundle against a DOM fixture, not a real uTools host. */
function mount(host) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://prototype.test/', runScripts: 'outside-only' });
  dom.window.WebAssembly = WebAssembly;
  dom.window.utools = host;
  dom.window.Image = class {
    naturalWidth = 800;
    naturalHeight = 100;
    async decode() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {}, fillRect() {}, strokeRect() {} });
  dom.window.eval(bundle);
  const query = (selector) => dom.window.document.querySelector(selector);
  const enter = (selector, value) => {
    query(selector).value = value;
    query(selector).dispatchEvent(new dom.window.Event('input'));
  };
  return { dom, query, enter };
}

/** Wait for asynchronous engine/model initialization, bounded to two seconds. */
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('DOM state did not settle');
}

/** A synthetic uTools bridge exercises request sequencing without network access. */
function mockHost() {
  let onEnter;
  let resolveAi;
  let lastOptions;
  return {
    api: {
      allAiModels: async () => [{ id: 'text-only', label: 'text' }, { id: 'vision-test', label: 'test', vision: true }],
      onPluginEnter: (callback) => { onEnter = callback; },
      ai: (options) => { lastOptions = options; return new Promise((resolve) => { resolveAi = resolve; }); },
      screenCapture() {},
      copyText() {},
      shellOpenExternal() {},
    },
    image: () => onEnter({ type: 'img', payload: 'data:image/png;base64,c3ludGhldGlj' }),
    resolve: (content) => resolveAi({ content }),
    options: () => lastOptions,
  };
}

test('production bundle loads the inline WASM without fetch or host APIs', async () => {
  const { dom, query, enter } = mount();
  try {
    enter('#hand-text', '13m123456p11s1z');
    await until(() => query('.metrics'));
    assert.equal(query('#tile-count').textContent, '11 张');
    assert.match(query('#calculation-note').textContent, /仅按手牌扣减.*1 组/);
    assert.equal(query('#capture').disabled, true);
    assert.equal(query('#recognize').disabled, true);
    assert.ok(query('[data-discard]'));
  } finally { dom.window.close(); }
});

test('text and point replacement are synchronized; invalid text clears stale results', async () => {
  const { dom, query, enter } = mount();
  try {
    enter('#hand-text', '123m45p11z1s');
    await until(() => query('.metrics'));
    assert.equal(query('#tile-editor').open, false);
    query('[data-index="0"]').click();
    assert.equal(query('#tile-editor').open, true);
    query('[data-pick="9m"]').click();
    assert.equal(query('#hand-text').value, '923m45p11z1s');
    assert.equal(query('#hand [data-index="0"]').title, '9万 · 9m');
    enter('#hand-text', '8z');
    assert.equal(query('.metrics'), null);
    assert.match(query('.input-error').textContent, /字牌/);
    assert.equal(query('#tenhou').disabled, true);
  } finally { dom.window.close(); }
});

test('discard, draw, sort and undo preserve simulation state', async () => {
  const { dom, query, enter } = mount();
  try {
    enter('#hand-text', '123m45p11z1s');
    await until(() => query('.metrics'));
    query('[data-discard="0"]').click();
    const afterDiscard = query('#hand-text').value;
    const known = query('#simulation').textContent;
    assert.equal(query('#tile-count').textContent, '7 张');
    query('#sort').click();
    assert.equal(query('#simulation').textContent, known);
    query('[data-draw]').click();
    assert.equal(query('#tile-count').textContent, '8 张');
    query('#undo').click();
    assert.equal(query('#tile-count').textContent, '7 张');
    query('#undo').click();
    assert.equal(query('#hand-text').value, '123m45p11z1s');
    assert.equal(query('#simulation').textContent, '');
    assert.equal(query('#undo').disabled, true);
    assert.notEqual(afterDiscard, '123m45p11z1s');
  } finally { dom.window.close(); }
});

test('known meld editing recalculates and invalid melds remove previous results', async () => {
  const { dom, query, enter } = mount();
  try {
    enter('#hand-text', '13m123456p11s1z');
    await until(() => query('.metrics'));
    enter('#meld-text', '2222m');
    assert.match(query('#calculation-note').textContent, /已扣除填入的吃碰杠/);
    assert.equal(query('.metrics strong').textContent, '1 向听');
    enter('#meld-text', '124m');
    assert.equal(query('.metrics'), null);
    assert.match(query('.input-error').textContent, /不是合法/);
  } finally { dom.window.close(); }
});

test('mock vision output preserves unknown positions until point correction', async () => {
  const host = mockHost();
  const { dom, query } = mount(host.api);
  try {
    host.image();
    await until(() => !query('#recognize').disabled);
    assert.equal(query('#model').options.length, 1);
    query('#recognize').click();
    assert.equal(host.options().messages[0].content[1].image_url.url, 'data:image/png;base64,c3ludGhldGlj');
    host.resolve('{"tiles":["1m",null],"notes":"第二张不清楚"}');
    await until(() => query('.unknown'));
    assert.equal(query('.metrics'), null);
    query('[data-index="1"]').click();
    query('[data-pick="2m"]').click();
    assert.equal(query('#hand-text').value, '12m');
    await until(() => query('.metrics'));
  } finally { dom.window.close(); }
});

test('late recognition never overwrites a manual text correction', async () => {
  const host = mockHost();
  const { dom, query, enter } = mount(host.api);
  try {
    host.image();
    await until(() => !query('#recognize').disabled);
    query('#recognize').click();
    enter('#hand-text', '12m');
    host.resolve('{"tiles":["1p","2p"],"notes":""}');
    await until(() => query('#recognition-status').textContent.includes('未覆盖'));
    assert.equal(query('#hand-text').value, '12m');
  } finally { dom.window.close(); }
});

test('a response for an older screenshot is ignored', async () => {
  const host = mockHost();
  const { dom, query, enter } = mount(host.api);
  try {
    enter('#hand-text', '12m');
    host.image();
    await until(() => !query('#recognize').disabled);
    query('#recognize').click();
    host.image();
    host.resolve('{"tiles":["1p","2p"],"notes":""}');
    await until(() => query('#recognition-status').textContent.includes('图片已就绪'));
    assert.equal(query('#hand-text').value, '12m');
  } finally { dom.window.close(); }
});
