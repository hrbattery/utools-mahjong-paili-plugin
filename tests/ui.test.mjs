import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

const page = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const asset = page.match(/src="([^"]+\.js)"/)[1];
const bundle = readFileSync(new URL(`../dist/${asset}`, import.meta.url), 'utf8');

/** Run the actual production bundle against a DOM fixture, not a real uTools host. */
function mount(host, pixels) {
  const recognizedImages = [];
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://prototype.test/', runScripts: 'outside-only' });
  dom.window.WebAssembly = WebAssembly;
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.utools = host;
  dom.window.Image = class {
    naturalWidth = pixels?.width ?? 800;
    naturalHeight = pixels?.height ?? 100;
    async decode() {}
  };
  dom.window.HTMLCanvasElement.prototype.getContext = () => {
    let source;
    return {
      clearRect() {}, drawImage(image) { source = image.src; }, fillRect() {}, strokeRect() {},
      getImageData() { recognizedImages.push(source); return pixels; },
    };
  };
  dom.window.eval(bundle);
  const query = (selector) => dom.window.document.querySelector(selector);
  const enter = (selector, value) => {
    query(selector).value = value;
    query(selector).dispatchEvent(new dom.window.Event('input'));
  };
  return { dom, query, enter, recognizedImages };
}

/** Hold image decoding to exercise out-of-order loads and edits before recognition starts. */
function deferImageDecoding(dom) {
  const pending = [];
  dom.window.Image = class extends dom.window.Image {
    decode() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
  };
  return pending;
}

/** Paste through the production FileReader path; only decoding/canvas pixels are mocked. */
function pasteImage(dom) {
  const event = new dom.window.Event('paste');
  event.clipboardData = { items: [{ type: 'image/png', getAsFile: () => new dom.window.File(['fixture'], 'hand.png', { type: 'image/png' }) }] };
  dom.window.document.dispatchEvent(event);
}

/** A real two-tile raster makes the local UI test exercise the actual embedded matching library. */
async function localPixels(tiles = ['0s', '5s']) {
  const { data, info } = await sharp({ create: { width: 184, height: 153, channels: 4, background: '#20394f' } })
    .composite(tiles.map((tile, i) => ({ input: new URL(`../assets/recognition-templates/majsoul-standard/${tile}.png`, import.meta.url).pathname, left: 12 + i * 80, top: 12 })))
    .raw().toBuffer({ resolveWithObject: true });
  return { ...info, data };
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
  let modelRequests = 0;
  return {
    api: {
      allAiModels: async () => {
        modelRequests++;
        return [{ id: 'text-only', label: 'text' }, { id: 'vision-test', label: 'test', vision: true }];
      },
      onPluginEnter: (callback) => { onEnter = callback; },
      ai: (options) => { lastOptions = options; return new Promise((resolve) => { resolveAi = resolve; }); },
      screenCapture() {},
      copyText() {},
      shellOpenExternal() {},
    },
    image: (payload = 'data:image/png;base64,c3ludGhldGlj') => onEnter({ type: 'img', payload }),
    text: (payload) => onEnter({ type: 'regex', payload }),
    resolve: (content) => resolveAi({ content }),
    options: () => lastOptions,
    modelRequests: () => modelRequests,
  };
}

test('production bundle loads inline WASM and all local tile faces without host APIs', async () => {
  const { dom, query, enter } = mount();
  try {
    dom.reconfigure({ url: new URL('../dist/index.html', import.meta.url).href });
    const faces = [...dom.window.document.querySelectorAll('#palette img')];
    assert.equal(faces.length, 37);
    assert.equal(new Set(faces.map((face) => face.src)).size, 37);
    for (const face of faces) {
      assert.match(face.src, /^file:/);
      assert.equal((await sharp(new URL(face.src).pathname).metadata()).format, 'svg');
    }
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
    query('#auto-sort').click();
    enter('#hand-text', '123m45p11z1s');
    await until(() => query('.metrics'));
    assert.equal(query('#tile-editor').open, false);
    query('[data-index="0"] img').click();
    assert.equal(query('#tile-editor').open, true);
    query('[data-pick="9m"] img').click();
    assert.equal(query('#hand-text').value, '923m45p11z1s');
    assert.equal(query('#hand [data-index="0"]').title, '9万 · 9m');
    enter('#hand-text', '8z');
    assert.equal(query('.metrics'), null);
    assert.match(query('.input-error').textContent, /字牌/);
    assert.equal(query('#tenhou').disabled, true);
  } finally { dom.window.close(); }
});

/** Preserve typing order until commit and never replace an invalid draft when toggling. */
test('automatic sorting waits for text commit, toggles immediately and preserves invalid input', async () => {
  const { dom, query, enter } = mount();
  try {
    assert.equal(query('#auto-sort').getAttribute('aria-pressed'), 'true');
    assert.equal(query('#auto-sort').textContent, '自动理牌：开');
    enter('#hand-text', '9s21m05p5m1z');
    await until(() => query('.metrics'));
    assert.equal(query('#hand-text').value, '9s21m05p5m1z');
    query('#hand-text').dispatchEvent(new dom.window.Event('change'));
    assert.equal(query('#hand-text').value, '125m05p9s1z');
    query('#auto-sort').click();
    assert.equal(query('#auto-sort').getAttribute('aria-pressed'), 'false');
    assert.equal(query('#auto-sort').textContent, '自动理牌：关');
    enter('#hand-text', '9s21m05p5m1z');
    query('#hand-text').dispatchEvent(new dom.window.Event('change'));
    assert.equal(query('#hand-text').value, '9s21m05p5m1z');
    query('#auto-sort').click();
    assert.equal(query('#hand-text').value, '125m05p9s1z');
    enter('#hand-text', '8z');
    query('#auto-sort').click();
    query('#auto-sort').click();
    query('#hand-text').dispatchEvent(new dom.window.Event('change'));
    assert.equal(query('#hand-text').value, '8z');
    assert.match(query('.input-error').textContent, /字牌/);
  } finally { dom.window.close(); }
});

test('automatic sorting applies to point replacement, addition and deletion', async () => {
  const { dom, query, enter } = mount();
  try {
    enter('#hand-text', '123m45p1s11z');
    await until(() => query('.metrics'));
    query('#hand [data-index="0"]').click();
    query('#palette [data-pick="9m"]').click();
    assert.equal(query('#hand-text').value, '239m45p1s11z');
    query('#palette [data-pick="8m"]').click();
    assert.equal(query('#hand-text').value, '2389m45p1s11z');
    query('#hand [data-index="0"]').click();
    query('#delete-tile').click();
    assert.equal(query('#hand-text').value, '389m45p1s11z');
    query('#auto-sort').click();
    query('#hand [data-index="0"]').click();
    query('#palette [data-pick="9s"]').click();
    assert.equal(query('#hand-text').value, '9s89m45p1s11z');
  } finally { dom.window.close(); }
});

test('discard, draw, automatic sorting toggle and undo preserve simulation state', async () => {
  const { dom, query, enter } = mount();
  try {
    enter('#hand-text', '123m45p1s11z');
    await until(() => query('.metrics'));
    query('[data-discard="0"] img').click();
    const afterDiscard = query('#hand-text').value;
    const known = query('#simulation').textContent;
    assert.equal(query('#tile-count').textContent, '7 张');
    query('#auto-sort').click();
    query('#auto-sort').click();
    assert.equal(query('#simulation').textContent, known);
    query('[data-draw] img').click();
    assert.equal(query('#tile-count').textContent, '8 张');
    query('#undo').click();
    assert.equal(query('#tile-count').textContent, '7 张');
    query('#undo').click();
    assert.equal(query('#hand-text').value, '123m45p1s11z');
    assert.equal(query('#simulation').textContent, '');
    assert.equal(query('#undo').disabled, true);
    assert.notEqual(afterDiscard, '123m45p1s11z');
  } finally { dom.window.close(); }
});

test('recognition and uTools text entry respect the automatic sorting switch', async () => {
  const host = mockHost();
  const { dom, query } = mount(host.api, await localPixels(['5s', '1m']));
  try {
    host.image();
    await until(() => query('#hand-text').value === '1m5s');
    query('#auto-sort').click();
    host.image();
    await until(() => query('#hand-text').value === '5s1m');
    query('#auto-sort').click();
    assert.equal(query('#hand-text').value, '1m5s');
    host.text('9s21m');
    assert.equal(query('#hand-text').value, '12m9s');
    query('#auto-sort').click();
    host.text('9s21m');
    assert.equal(query('#hand-text').value, '9s21m');
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
    // Exercise the retained online implementation explicitly; its controls are hidden in the product.
    query('#refresh-models').click();
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
    query('#refresh-models').click();
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
    query('#refresh-models').click();
    enter('#hand-text', '12m');
    host.image();
    await until(() => !query('#recognize').disabled);
    query('#recognize').click();
    host.image();
    host.resolve('{"tiles":["1p","2p"],"notes":""}');
    await until(() => !query('#recognize-local').disabled);
    assert.equal(query('#hand-text').value, '12m');
  } finally { dom.window.close(); }
});

test('pasting automatically recognizes locally without uTools, clicks or network requests', async () => {
  const { dom, query } = mount(undefined, await localPixels());
  try {
    dom.window.fetch = () => { assert.fail('Local recognition must not fetch'); };
    pasteImage(dom);
    await until(() => query('#recognition-status').textContent.includes('本地匹配 2 张'));
    assert.equal(query('#hand-text').value, '05s');
    assert.equal(query('#hand').children.length, 2);
    assert.equal(query('#recognize-local').disabled, false);
    assert.equal(query('#recognize').disabled, true);
  } finally { dom.window.close(); }
});

test('online controls stay hidden without model discovery and manual edits cancel local recognition', async () => {
  const host = mockHost();
  const { dom, query, enter } = mount(host.api, await localPixels());
  try {
    for (const selector of ['#model', '#refresh-models', '#recognize']) assert.equal(query(selector).hidden, true);
    assert.equal(query('#recognize-local').hidden, false);
    assert.doesNotMatch(query('.source-panel .hint').textContent, /在线|模型/);
    host.image();
    // Let decoding finish, before the matcher resumes its per-tile timer.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(query('#recognition-status').textContent, /正在本地匹配/);
    enter('#hand-text', '12m');
    await until(() => query('#recognition-status').textContent.includes('未覆盖'));
    assert.equal(query('#hand-text').value, '12m');
    assert.equal(host.options(), undefined);
    assert.equal(host.modelRequests(), 0);
    assert.equal(query('#recognize-local').disabled, false);
  } finally { dom.window.close(); }
});

test('changing the image cancels a pending local result', async () => {
  const host = mockHost();
  const { dom, query, enter, recognizedImages } = mount(host.api, await localPixels());
  try {
    enter('#hand-text', '12m');
    host.image('first');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(query('#recognition-status').textContent, /正在本地匹配/);
    const pending = deferImageDecoding(dom);
    host.image('second');
    assert.equal(query('#recognize-local').disabled, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(query('#hand-text').value, '12m');
    assert.match(query('#recognition-status').textContent, /正在读取图片/);
    pending[0].resolve();
    await until(() => query('#recognition-status').textContent.includes('本地匹配 2 张'));
    assert.deepEqual(recognizedImages, ['first', 'second']);
    assert.equal(query('#hand-text').value, '05s');
    assert.equal(host.modelRequests(), 0);
    assert.equal(host.options(), undefined);
    assert.equal(query('#recognize-local').disabled, false);
  } finally { dom.window.close(); }
});

test('manual edits while a pasted file is being read suppress automatic recognition', async () => {
  const { dom, query, enter, recognizedImages } = mount(undefined, await localPixels());
  try {
    pasteImage(dom);
    assert.equal(query('#recognize-local').disabled, true);
    enter('#hand-text', '12m');
    await until(() => query('#recognition-status').textContent.includes('加载期间手牌已被编辑'));
    assert.equal(query('#hand-text').value, '12m');
    assert.deepEqual(recognizedImages, []);
    // An explicit retry is still available after cancelling the automatic run.
    query('#recognize-local').click();
    await until(() => query('#hand-text').value === '05s');
  } finally { dom.window.close(); }
});

test('manual edits while a uTools image decodes are preserved', async () => {
  const host = mockHost();
  const { dom, query, enter, recognizedImages } = mount(host.api, await localPixels());
  try {
    const pending = deferImageDecoding(dom);
    host.image();
    enter('#hand-text', '12m');
    pending[0].resolve();
    await until(() => !query('#recognize-local').disabled);
    assert.equal(query('#hand-text').value, '12m');
    assert.match(query('#recognition-status').textContent, /未覆盖/);
    assert.deepEqual(recognizedImages, []);
  } finally { dom.window.close(); }
});

test('out-of-order pasted file reads and stale errors cannot replace the newest image', async () => {
  const { dom, query, recognizedImages } = mount(undefined, await localPixels());
  try {
    const readers = [];
    dom.window.FileReader = class { readAsDataURL() { readers.push(this); } };
    pasteImage(dom);
    pasteImage(dom);
    pasteImage(dom);
    readers[2].result = 'newest';
    readers[2].onload();
    await until(() => query('#recognition-status').textContent.includes('本地匹配 2 张'));
    const status = query('#recognition-status').textContent;
    readers[0].result = 'older';
    readers[0].onload();
    readers[1].onerror();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(recognizedImages, ['newest']);
    assert.equal(query('#recognition-status').textContent, status);
    assert.equal(query('#hand-text').value, '05s');
  } finally { dom.window.close(); }
});

test('only the newest decoded image is recognized and decode failures allow another paste', async () => {
  const host = mockHost();
  const { dom, query, recognizedImages } = mount(host.api, await localPixels());
  try {
    const pending = deferImageDecoding(dom);
    host.image('broken');
    pending[0].reject(new Error('bad image'));
    await until(() => query('#recognition-status').textContent.includes('图片加载失败'));
    assert.equal(query('#recognize-local').disabled, true);
    host.image('older');
    host.image('newest');
    pending[2].resolve();
    await until(() => query('#recognition-status').textContent.includes('本地匹配 2 张'));
    const status = query('#recognition-status').textContent;
    pending[1].resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(recognizedImages, ['newest']);
    assert.equal(query('#recognition-status').textContent, status);
    assert.equal(query('#hand-text').value, '05s');
    assert.equal(query('#recognize-local').disabled, false);
  } finally { dom.window.close(); }
});
