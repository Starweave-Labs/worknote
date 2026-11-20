import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { File } from 'node:buffer';

const source = await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8');
const inboxSource = await readFile(new URL('../client/src/pages/InboxPage.tsx', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function worker({ beforePut = async () => {}, failKey } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const deleted = [];
  const caches = {
    async keys() { return [...stores.keys()]; },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(key, response) {
          await beforePut(key);
          if (key === failKey) throw new Error('cache write failed');
          entries.set(key, new Response(await response.arrayBuffer(), { headers: response.headers }));
        },
        async match(key) { return entries.get(key)?.clone(); },
      };
    },
    async delete(name) {
      deleted.push(name);
      return stores.delete(name);
    },
  };
  runInNewContext(source, {
    self: { addEventListener(type, fn) { handlers.set(type, fn); } },
    caches, crypto: webcrypto, URL, Response,
    console: { error() {} },
  });
  function dispatch(request) {
    let response;
    handlers.get('fetch')({
      request,
      respondWith(value) { response = Promise.resolve(value); },
      waitUntil() {},
    });
    return response;
  }
  return { stores, deleted, caches, dispatch };
}

function request(images = [new Uint8Array([0, 255, 1, 128])]) {
  const form = new FormData();
  form.set('title', '分享标题');
  form.set('text', '分享原文');
  for (const image of images) form.append('images', new Blob([image], { type: 'image/png' }), 'original.png');
  return new Request('https://worknote.example/share-target', { method: 'POST', body: form });
}

test('303 waits for every delayed cache write and exposes complete original data', async () => {
  const gates = new Map(['meta', 'img-0', 'count'].map((key) => [key, { entered: deferred(), finish: deferred() }]));
  const sw = worker({ beforePut: async (key) => {
    const gate = gates.get(key);
    gate.entered.resolve();
    await gate.finish.promise;
  } });
  let settled = false;
  const response = sw.dispatch(request()).then((value) => { settled = true; return value; });
  for (const [key, gate] of gates) {
    await gate.entered.promise;
    assert.equal(settled, false, `must not redirect before ${key} is stored`);
    gate.finish.resolve();
  }
  const result = await response;
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), 'https://worknote.example/inbox?shared=1');
  assert.equal(sw.stores.size, 1);
  const cache = await sw.caches.open([...sw.stores.keys()][0]);
  assert.deepEqual(await (await cache.match('meta')).json(), { title: '分享标题', text: '分享原文' });
  assert.equal(await (await cache.match('count')).text(), '1');
  const image = await cache.match('img-0');
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array([0, 255, 1, 128]));
  assert.deepEqual(sw.deleted, []);
});

for (const key of ['meta', 'img-0', 'count']) {
  test(`failure writing ${key} rolls back the share and returns a visible error`, async () => {
    const sw = worker({ failKey: key });
    const response = await sw.dispatch(request());
    assert.equal(response.status, 500);
    assert.equal(response.headers.has('location'), false);
    assert.match(response.headers.get('content-type'), /text\/plain; charset=utf-8/);
    assert.match(await response.text(), /分享失败.*重试/);
    assert.equal(sw.stores.size, 0);
    assert.equal(sw.deleted.length, 1);
  });
}

test('text-only sharing succeeds with count zero', async () => {
  const sw = worker();
  assert.equal((await sw.dispatch(request([]))).status, 303);
  const cache = await sw.caches.open([...sw.stores.keys()][0]);
  assert.equal(await (await cache.match('count')).text(), '0');
});

test('sharing preserves the six-image limit and skips images over 8 MiB', async () => {
  const sw = worker();
  const images = [new Uint8Array(8 * 1024 * 1024 + 1), ...Array.from({ length: 7 }, (_, i) => new Uint8Array([i]))];
  assert.equal((await sw.dispatch(request(images))).status, 303);
  const cache = await sw.caches.open([...sw.stores.keys()][0]);
  assert.equal(await (await cache.match('count')).text(), '6');
  assert.equal(await cache.match('img-6'), undefined);
  for (let i = 0; i < 6; i++) {
    assert.deepEqual(new Uint8Array(await (await cache.match(`img-${i}`)).arrayBuffer()), new Uint8Array([i]));
  }
});

test('concurrent shares receive separate caches', async () => {
  const sw = worker();
  const responses = await Promise.all([sw.dispatch(request()), sw.dispatch(request())]);
  assert.deepEqual(responses.map((res) => res.status), [303, 303]);
  assert.equal(sw.stores.size, 2);
});

// Run the actual cache-consumption effect with mocked React setters, without
// importing React or starting a browser/service worker. Strip its one TS cast.
async function consume(caches, addFiles = async () => {}) {
  const start = inboxSource.indexOf('    (async () => {');
  const end = inboxSource.indexOf('\n    // eslint-disable-next-line', start);
  assert.ok(start >= 0 && end > start);
  const effect = inboxSource.slice(start, end).replace(/ as \{ title\?: string; text\?: string \}/g, '').replace('const files: File[]', 'const files');
  const state = { text: '', errors: [], history: [] };
  const window = { caches, history: { replaceState(...args) { state.history.push(args); } } };
  await runInNewContext(effect, {
    window, caches, File,
    picker: { addFiles },
    setText(update) { state.text = update(state.text); },
    setSaveErr(message) { state.errors.push(message); },
  });
  return state;
}

test('Inbox retains incomplete metadata and image caches for retry', async () => {
  for (const missing of ['meta', 'count', 'img-0']) {
    const sw = worker();
    const cache = await sw.caches.open('share-target-incomplete');
    if (missing !== 'meta') await cache.put('meta', Response.json({ text: '保留原文' }));
    if (missing !== 'count') await cache.put('count', new Response('1'));
    if (missing !== 'img-0') await cache.put('img-0', new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }));
    const state = await consume(sw.caches);
    assert.equal(state.text, '');
    assert.equal(state.errors.length, 1);
    assert.equal(state.history.length, 0);
    assert.equal(sw.stores.size, 1);
    assert.deepEqual(sw.deleted, []);
  }
});

test('Inbox deletes complete caches only after image consumption succeeds', async () => {
  const sw = worker();
  await sw.dispatch(request());
  const gate = deferred();
  const entered = deferred();
  const consumption = consume(sw.caches, async (files) => {
    assert.equal(files.length, 1);
    assert.deepEqual(new Uint8Array(await files[0].arrayBuffer()), new Uint8Array([0, 255, 1, 128]));
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  assert.equal(sw.stores.size, 1);
  gate.resolve();
  const state = await consumption;
  assert.equal(state.text, '分享原文\n分享标题');
  assert.equal(state.errors.length, 0);
  assert.equal(state.history.length, 1);
  assert.equal(sw.stores.size, 0);
});

test('Inbox retains cache when image consumption fails', async () => {
  const sw = worker();
  await sw.dispatch(request());
  const state = await consume(sw.caches, async () => { throw new Error('read failed'); });
  assert.equal(state.errors.length, 1);
  assert.equal(state.text, '');
  assert.equal(sw.stores.size, 1);
  assert.deepEqual(sw.deleted, []);
});
