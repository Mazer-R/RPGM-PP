// Tests for the browser pieces a game's profile can switch on (js/web-*.js,
// js/nw-global.js, js/engine-tasks.js), run with Node:
//   node tests/js/web_pieces.test.js
//
// Each piece is a part of the browser, or of the desktop player, that the
// first engine supported (RPG Maker MV) never asked for. None of them knows
// which engine the game uses; RPG Maker MZ was the first to need them.
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

const tests = {
  'the load event waits for what the page had already asked for'() {
    const order = [], tasks = [];
    const browser = { later: (fn) => tasks.push(fn), fireLoad: () => order.push('load') };
    load('web-load.js', { __browser: browser, document: {} });
    browser.later(() => order.push('file answer'));
    browser.fireLoad();
    assert.deepStrictEqual(order, [], 'nothing fires at once');
    while (tasks.length) tasks.shift()();
    assert.deepStrictEqual(order, ['file answer', 'load']);
  },

  async 'a font is loaded through FontFace, from the file its url() names'() {
    const asked = [];
    const browser = { later() {}, fireLoad() {}, registerFont: (family, url) => { asked.push([family, url]); return url !== 'fonts/missing.woff'; } };
    const page = load('web-fonts.js', { __browser: browser, document: {} });
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

  'the engine\'s check for IndexedDB passes'() {
    const page = load('web-storage.js', { __browser: { later() {}, fireLoad() {} }, document: {} });
    assert.ok(page.indexedDB);
  },

  'the desktop player\'s object is the global nw, started without options'() {
    const gui = { Window: { get: () => 'the window' }, App: { quit() {} } };
    const page = load('nw-global.js', { __browser: { later() {}, fireLoad() {} }, document: {}, require: (name) => (name === 'nw.gui' ? gui : null) });
    assert.strictEqual(page.nw.Window.get(), 'the window');
    assert.deepStrictEqual(plain(page.nw.App.argv), []);
    assert.strictEqual(typeof page.nw.App.quit, 'function', 'what the desktop layer already offers is kept');
  },

  'a Worker can be made, as the sound decoder library does while loading, and never runs'() {
    const page = load('web-workers.js', { __browser: { later() {}, fireLoad() {} }, document: {} });
    const worker = new page.Worker('js/libs/vorbisdecoder.js');
    let heard = 0;
    worker.addEventListener('message', () => heard++);
    worker.onmessage = () => heard++;
    worker.postMessage({ id: 1 }, []);
    worker.terminate();
    assert.strictEqual(heard, 0);
  },

  'a page\'s own Worker is left alone'() {
    const theirs = function () {};
    const page = load('web-workers.js', { __browser: { later() {}, fireLoad() {} }, document: {}, Worker: theirs });
    assert.strictEqual(page.Worker, theirs);
  },

  'the engine\'s queued work is run once every frame'() {
    let ran = 0;
    const frames = [];
    const page = load('engine-tasks.js', {
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

  async 'playing a video element gives a promise, as the engine expects on every key press'() {
    const played = [];
    const browser = { later() {}, fireLoad() {}, makeVideo: (video) => { video.play = function () { played.push(this); }; return video; } };
    load('web-media.js', { __browser: browser, document: {} });
    const video = browser.makeVideo({ tag: 'video' });
    const result = video.play();
    assert.strictEqual(typeof result.catch, 'function');
    await result;
    assert.deepStrictEqual(played, [video], 'the player\'s own play still runs, on the element');
  },

  async 'a video that cannot be played gives a promise that fails, not an error thrown'() {
    const browser = { later() {}, fireLoad() {}, makeVideo: (video) => { video.play = () => { throw new Error('no'); }; return video; } };
    load('web-media.js', { __browser: browser, document: {} });
    const video = browser.makeVideo({});
    await assert.rejects(() => video.play(), /no/);
  },


  'MZ\'s encrypted files are known by the underscore the engine adds to their names'() {
    const browser = { later() {}, fireLoad() {}, startOnlyFiles: /\.rpgmvp$/i, soundFiles: /\.(ogg|m4a|rpgmvo)$/i };
    load('mz-files.js', { __browser: browser, document: {} });
    assert.ok(browser.startOnlyFiles.test('/game/img/system/Window.png_'), 'an encrypted image');
    assert.ok(!browser.startOnlyFiles.test('/game/img/system/Window.png'), 'a plain image is read whole, as before');
    assert.ok(browser.soundFiles.test('/game/audio/se/Cursor1.ogg_'), 'an encrypted sound');
    assert.ok(browser.soundFiles.test('/game/audio/bgm/Theme.ogg'), 'a plain sound');
    assert.ok(browser.soundFiles.test('/game/audio/bgm/Theme.m4a_'));
    assert.ok(!browser.soundFiles.test('/game/data/System.json'));
  },

  'elements the page itself declares with an id can be found, as a script expects'() {
    const made = [];
    const body = { appendChild: (element) => made.push(element) };
    const document = { body, createElement: (tag) => ({ tag }) };
    const html = '<html><head><title>x</title></head>\n<canvas id="refresher" style="width:100%"></div>\n' +
      '<body style="background-color: black"><div id=\'note\'></div><p>no id</p><script id="s" src="js/main.js"></script></body></html>';
    load('web-page.js', { __browser: { later() {}, fireLoad() {} }, document,
      player: { gameDir: '/g', readTextFile: (file) => (file === '/g/index.html' ? html : null) } });
    assert.deepStrictEqual(plain(made), [{ tag: 'canvas', id: 'refresher' }, { tag: 'div', id: 'note' }]);
  },

  'a page that cannot be read declares nothing'() {
    const made = [];
    load('web-page.js', { __browser: {}, document: { body: { appendChild: (e) => made.push(e) }, createElement: (tag) => ({ tag }) },
      player: { gameDir: '/g', readTextFile: () => null } });
    assert.deepStrictEqual(made, []);
  },

  'MZ\'s frame, logic step and drawing are told to the performance meter'() {
    const browser = { later() {}, fireLoad() {} };
    const seen = [];
    const app = { render() { seen.push('render'); return 'drawn'; } };
    const page = load('mz-perf.js', {
      __browser: browser, document: {}, performance: { now: () => 1234 },
      SceneManager: { _scene: { constructor: { name: 'Scene_Map' } }, updateScene() { seen.push('update'); return 'updated'; } },
      Graphics: { _app: null, _onTick(delta) { seen.push('tick ' + delta); this.SM.updateScene(); this.SM.updateScene(); if (this._app) this._app.render(); } },
    });
    page.Graphics.SM = page.SceneManager;
    const meter = {
      frame: (now, scene) => seen.push('frame ' + now + ' ' + scene),
      step: (fn, self, args) => { seen.push('step'); return fn.apply(self, args); },
      draw: (fn, self, args) => { seen.push('draw'); return fn.apply(self, args); },
    };
    assert.strictEqual(typeof browser.hookPerformance, 'function');
    browser.hookPerformance(meter);

    page.Graphics._onTick(1);
    assert.deepStrictEqual(seen, ['frame 1234 Scene_Map', 'tick 1', 'step', 'update', 'step', 'update'], 'before the engine has made its drawing surface');
    seen.length = 0;
    page.Graphics._app = app;
    page.Graphics._onTick(2);
    page.Graphics._onTick(1);
    assert.deepStrictEqual(seen, ['frame 1234 Scene_Map', 'tick 2', 'step', 'update', 'step', 'update', 'draw', 'render',
      'frame 1234 Scene_Map', 'tick 1', 'step', 'update', 'step', 'update', 'draw', 'render'], 'drawing is measured once per frame, not wrapped twice');
    assert.strictEqual(app.render(), 'drawn');
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
