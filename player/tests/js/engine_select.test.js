// Tests for js/engine-select.js and js/mz.js, run with Node:
//   node tests/js/engine_select.test.js
//
// A game is either RPG Maker MV or MZ. The player tells which from the
// game's files and loads a different set of layers for each, so that what
// is done for MZ cannot change how an MV game runs.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(file, sandbox) {
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const full = path.join(__dirname, '..', '..', 'js', file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
  return sandbox;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const select = () => load('engine-select.js', {}).__engineSelect;
const filesOf = (...files) => (file) => files.includes(file);

// The layers an MV game was given before MZ existed here, in their order.
const MV_LAYERS = ['file-bytes.js', 'css.js', 'video.js', 'dom.js', 'canvas2d.js', 'desktop.js', 'patch-select.js'];

const tests = {
  'a game with MV\'s core script is MV'() {
    assert.strictEqual(select().engineOf('/g/www', filesOf('/g/www/js/rpg_core.js')), 'MV');
  },

  'a game with MZ\'s core script is MZ'() {
    assert.strictEqual(select().engineOf('/g', filesOf('/g/js/rmmz_core.js')), 'MZ');
  },

  'a game with neither is treated as MV, as before'() {
    assert.strictEqual(select().engineOf('/g/www', filesOf()), 'MV');
  },

  'an MV game gets exactly the layers it always had'() {
    assert.deepStrictEqual(plain(select().layersFor('MV', false)), MV_LAYERS);
    assert.deepStrictEqual(plain(select().layersFor('MV', true)), MV_LAYERS.concat('audio.js'));
  },

  'an MZ game gets the same layers and then its own, last'() {
    const layers = plain(select().layersFor('MZ', true));
    assert.deepStrictEqual(layers.slice(0, MV_LAYERS.length + 1), MV_LAYERS.concat('audio.js'));
    const own = layers.slice(MV_LAYERS.length + 1);
    assert.ok(own.length > 0 && own[own.length - 1] === 'mz.js', 'mz.js is loaded last');
    own.forEach((layer) => assert.ok(!MV_LAYERS.includes(layer), layer + ' is not one of MV\'s'));
  },

  'under MZ the load event waits for what the page had already asked for'() {
    const order = [], tasks = [];
    const browser = { later: (fn) => tasks.push(fn), fireLoad: () => order.push('load') };
    load('mz.js', { __browser: browser, document: {} });
    browser.later(() => order.push('file answer'));
    browser.fireLoad();
    assert.deepStrictEqual(order, [], 'nothing fires at once');
    while (tasks.length) tasks.shift()();
    assert.deepStrictEqual(order, ['file answer', 'load']);
  },

  async 'under MZ a font is loaded through FontFace, from the file its url() names'() {
    const asked = [];
    const browser = { later() {}, fireLoad() {}, registerFont: (family, url) => { asked.push([family, url]); return url !== 'fonts/missing.woff'; } };
    const page = load('mz.js', { __browser: browser, document: {} });
    assert.ok(page.document.fonts && page.document.fonts.ready, 'the engine checks for document.fonts.ready');
    await page.document.fonts.ready;

    const font = new page.FontFace('rmmz-mainfont', 'url(fonts/mplus-1m-regular.woff)');
    assert.strictEqual(font.status, 'unloaded');
    assert.strictEqual(await font.load(), font);
    assert.strictEqual(font.status, 'loaded');
    assert.deepStrictEqual(asked, [['rmmz-mainfont', 'fonts/mplus-1m-regular.woff']]);
    page.document.fonts.add(font);
    assert.strictEqual(page.document.fonts.check('20px rmmz-mainfont'), true);

    const quoted = new page.FontFace('other', 'url("fonts/missing.woff")');
    await assert.rejects(() => quoted.load());
    assert.strictEqual(quoted.status, 'error');
    assert.deepStrictEqual(asked[1], ['other', 'fonts/missing.woff']);
  },

  'under MZ the engine\'s check for IndexedDB passes'() {
    const page = load('mz.js', { __browser: { later() {}, fireLoad() {} }, document: {} });
    assert.ok(page.indexedDB);
  },

  'under MZ the desktop player\'s object is the global nw, started without options'() {
    const gui = { Window: { get: () => 'the window' }, App: { quit() {} } };
    const page = load('mz.js', { __browser: { later() {}, fireLoad() {} }, document: {}, require: (name) => (name === 'nw.gui' ? gui : null) });
    assert.strictEqual(page.nw.Window.get(), 'the window');
    assert.deepStrictEqual(plain(page.nw.App.argv), []);
    assert.strictEqual(typeof page.nw.App.quit, 'function', 'what the desktop layer already offers is kept');
  },

  'under MZ a Worker can be made, as the sound decoder library does while loading, and never runs'() {
    const page = load('mz.js', { __browser: { later() {}, fireLoad() {} }, document: {} });
    const worker = new page.Worker('js/libs/vorbisdecoder.js');
    let heard = 0;
    worker.addEventListener('message', () => heard++);
    worker.onmessage = () => heard++;
    worker.postMessage({ id: 1 }, []);
    worker.terminate();
    assert.strictEqual(heard, 0);
  },

  'under MZ a page\'s own Worker is left alone'() {
    const theirs = function () {};
    const page = load('mz.js', { __browser: { later() {}, fireLoad() {} }, document: {}, Worker: theirs });
    assert.strictEqual(page.Worker, theirs);
  },

  'under MZ the engine\'s queued work is run once every frame'() {
    let ran = 0;
    const frames = [];
    const page = load('mz.js', {
      __browser: { later() {}, fireLoad() {} }, document: {},
      player: { runEngineTasks: () => { ran++; return 0; } },
      requestAnimationFrame: (fn) => frames.push(fn),
    });
    assert.ok(page);
    assert.strictEqual(frames.length, 1, 'asked for the next frame');
    frames.shift()(16);
    frames.shift()(32);
    assert.strictEqual(ran, 2);
    assert.strictEqual(frames.length, 1, 'and for the one after');
  },

  async 'under MZ playing a video element gives a promise, as the engine expects on every key press'() {
    const played = [];
    const browser = { later() {}, fireLoad() {}, makeVideo: (video) => { video.play = function () { played.push(this); }; return video; } };
    load('mz.js', { __browser: browser, document: {} });
    const video = browser.makeVideo({ tag: 'video' });
    const result = video.play();
    assert.strictEqual(typeof result.catch, 'function');
    await result;
    assert.deepStrictEqual(played, [video], 'the player\'s own play still runs, on the element');
  },

  async 'under MZ a video that cannot be played gives a promise that fails, not an error thrown'() {
    const browser = { later() {}, fireLoad() {}, makeVideo: (video) => { video.play = () => { throw new Error('no'); }; return video; } };
    load('mz.js', { __browser: browser, document: {} });
    const video = browser.makeVideo({});
    await assert.rejects(() => video.play(), /no/);
  },
};

let failed = 0;
(async () => {
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log('ok   ' + name);
    } catch (error) {
      failed++;
      console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     '));
    }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
