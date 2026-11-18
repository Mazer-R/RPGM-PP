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
    const page = load('web-fonts.js', { __browser: browser, document: {}, console: { warn() {}, info() {} },
      player: { gameDir: '/g', listDir: () => [], fileExists: () => false } });
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
    await quoted.load();
    assert.deepStrictEqual(asked[1], ['other', 'fonts/missing.woff'], 'the file named between quotes is the one asked for');
  },

  async 'a font that cannot be loaded is replaced by another of the game\'s, and the game goes on'() {
    const asked = [], said = [];
    const works = (url) => url === 'fonts/second.ttf';
    const browser = { later() {}, fireLoad() {}, registerFont: (family, url) => { asked.push(family + ' <- ' + url); return works(url); } };
    const page = load('web-fonts.js', { __browser: browser, document: {}, console: { warn: (text) => said.push(text), info() {} },
      player: { gameDir: '/g', listDir: (dir) => (dir === '/g/fonts' ? ['broken.woff2', 'notes.txt', 'second.ttf', 'third.otf'] : []), fileExists: () => false } });
    const font = new page.FontFace('game-main', 'url(fonts/broken.woff2)');
    assert.strictEqual(await font.load(), font);
    assert.strictEqual(font.status, 'loaded');
    assert.deepStrictEqual(asked, ['game-main <- fonts/broken.woff2', 'game-main <- fonts/second.ttf'], 'the failed file is not tried twice, and files that are not fonts are passed over');
    assert.ok(said.some((text) => /broken\.woff2/.test(text) && /second\.ttf/.test(text)), said.join(' | '));
  },

  async 'with none of the game\'s fonts usable, one of the system\'s is taken'() {
    const asked = [];
    const browser = { later() {}, fireLoad() {}, registerFont: (family, url) => { asked.push(url); return url === '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; } };
    const page = load('web-fonts.js', { __browser: browser, document: {}, console: { warn() {}, info() {} },
      player: { gameDir: '/g', listDir: () => ['broken.woff2'], fileExists: (file) => file === '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' } });
    const font = new page.FontFace('game-main', 'url(fonts/broken.woff2)');
    await font.load();
    assert.strictEqual(font.status, 'loaded');
    assert.strictEqual(asked[asked.length - 1], '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  },

  async 'with no font at all the game still goes on, and the log says its text will not show'() {
    const said = [];
    const browser = { later() {}, fireLoad() {}, registerFont: () => false };
    const page = load('web-fonts.js', { __browser: browser, document: {}, console: { warn: (text) => said.push(text), info() {} },
      player: { gameDir: '/g', listDir: () => [], fileExists: () => false } });
    const font = new page.FontFace('game-main', 'url(fonts/broken.woff2)');
    await font.load();
    assert.strictEqual(font.status, 'loaded');
    assert.ok(said.some((text) => /no font/.test(text)), said.join(' | '));
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

  'the desktop player\'s window accepts any call it does not know, and says so once'() {
    const moveTo = () => 'the player\'s own';
    const win = { moveTo, isFullscreen: true };
    const gui = { Window: { get: () => win }, App: { argv: [] }, Screen: { Init() {}, screens: [] }, Shell: {} };
    const missing = [];
    const page = load('nw-lenient.js', { __browser: { missing: (what) => missing.push(what) }, document: { title: 'A Game' }, innerWidth: 1280, innerHeight: 720,
      nw: gui, require: (name) => (name === 'nw.gui' ? gui : null) });
    const shown = page.nw.Window.get();
    // What a plugin that sets the game's resolution does, and a call nobody listed.
    shown.setResizable(false);
    shown.setMinimumSize(816, 624);
    shown.setPosition('center');
    shown.somethingNobodyThoughtOf(1, 2, 3);
    shown.setResizable(true);
    assert.deepStrictEqual(missing.filter((what) => /setResizable/.test(what)).length, 1, 'said once');
    assert.ok(missing.some((what) => /nw\.Window\.somethingNobodyThoughtOf/.test(what)), missing.join('; '));
    assert.strictEqual(shown.moveTo, moveTo, 'what the player already answers is left as it is');
    assert.strictEqual(shown.moveTo(), 'the player\'s own');
  },

  'what the window is, as opposed to what it does, has real values'() {
    const gui = { Window: { get: () => ({ isFullscreen: true }) }, App: {}, Screen: { screens: [] }, Shell: {} };
    const page = load('nw-lenient.js', { __browser: { missing() {} }, document: { title: 'A Game' }, innerWidth: 1280, innerHeight: 720,
      nw: gui, require: (name) => (name === 'nw.gui' ? gui : null) });
    const shown = page.nw.Window.get();
    assert.strictEqual(shown.isFullscreen, true);
    assert.strictEqual(shown.isKioskMode, false);
    assert.strictEqual(shown.isAlwaysOnTop, false);
    assert.strictEqual(shown.isTransparent, false);
    assert.strictEqual(shown.zoomLevel, 0);
    assert.strictEqual(shown.title, 'A Game');
    shown.title = 'Renamed';
    assert.strictEqual(page.document.title, 'Renamed');
  },

  async 'calls into parts of the desktop player that are not there are accepted to any depth'() {
    const gui = { Window: { get: () => ({}) }, App: { argv: [] }, Screen: { screens: [] }, Shell: {} };
    const missing = [];
    const page = load('nw-lenient.js', { __browser: { missing: (what) => missing.push(what) }, document: {}, innerWidth: 800, innerHeight: 600,
      nw: gui, require: (name) => (name === 'nw.gui' ? gui : null) });
    const nw = page.nw;
    nw.Window.get().cookies.getAll({}, () => {});
    nw.App.setProxyConfig('x');
    nw.Shell.openItem('/tmp/x');
    nw.Screen.chooseDesktopMedia(['screen'], () => {});
    nw.Clipboard.get().set('text', 'text');
    nw.Window.open('other.html', {}, () => {});
    assert.deepStrictEqual(plain(nw.App.argv), [], 'what is there is still itself');
    assert.ok(missing.some((what) => /nw\.Clipboard/.test(what)));
    // Something that is not there can be waited for and written out without harm.
    assert.strictEqual(await Promise.resolve(nw.Window.get().whatever).then(() => 'went on'), 'went on');
    assert.strictEqual(typeof ('' + nw.Window.get().whatever), 'string');
  },

  'the desktop player\'s list of screens holds the one the game is shown on'() {
    const gui = { Window: { get: () => ({}) }, App: {}, Screen: { Init() {}, screens: [] }, Shell: {} };
    const page = load('nw-lenient.js', { __browser: { missing() {} }, document: {}, innerWidth: 1280, innerHeight: 720,
      nw: gui, require: (name) => (name === 'nw.gui' ? gui : null) });
    const screens = page.nw.Screen.screens;
    assert.strictEqual(screens.length, 1);
    assert.deepStrictEqual(plain(screens[0].bounds), { x: 0, y: 0, width: 1280, height: 720 });
    assert.deepStrictEqual(plain(screens[0].work_area), { x: 0, y: 0, width: 1280, height: 720 });
    assert.strictEqual(screens[0].scaleFactor, 1);
  },

  'without the desktop player\'s interface the piece does nothing'() {
    load('nw-lenient.js', { __browser: {}, document: {} });
    load('nw-lenient.js', { __browser: {}, document: {}, require: () => null });
  },

  async 'fetch reads one of the game\'s own files, as text, as data or as bytes'() {
    const files = { '/g/data/Words.json': '{"hello":"hola"}', '/g/data/list.csv': 'a,b\nc,d' };
    const page = load('web-fetch.js', {
      __browser: { gamePath: (url) => '/g/' + String(url).split('?')[0].replace(/^\.?\//, '') },
      player: {
        fileExists: (file) => file in files,
        readTextFile: (file) => (file in files ? files[file] : null),
        readFileBytes: (file) => (file in files ? new TextEncoder().encode(files[file]).buffer : null),
      },
    });
    const response = await page.fetch('data/Words.json?v=3');
    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('Content-Type'), 'application/json');
    assert.deepStrictEqual(plain(await response.json()), { hello: 'hola' });
    assert.strictEqual(await (await page.fetch('./data/list.csv')).text(), 'a,b\nc,d');
    const bytes = await (await page.fetch({ url: 'data/list.csv' })).arrayBuffer();
    assert.strictEqual(bytes.byteLength, 7);
    assert.strictEqual(await (await page.fetch('data/list.csv')).clone().text(), 'a,b\nc,d');
  },

  async 'fetch of a file that is not there fails, as it does for a page opened from disk'() {
    const page = load('web-fetch.js', { __browser: { gamePath: (url) => '/g/' + url }, player: { fileExists: () => false, readTextFile: () => null, readFileBytes: () => null } });
    await assert.rejects(() => page.fetch('data/Nothing.json'), /Failed to fetch/);
  },

  async 'fetch does not reach the network'() {
    const asked = [];
    const page = load('web-fetch.js', { __browser: { gamePath: (url) => '/g/' + url }, player: { fileExists: (file) => { asked.push(file); return true; }, readTextFile: () => 'x', readFileBytes: () => null } });
    await assert.rejects(() => page.fetch('https://example.com/scores.json'), /Failed to fetch/);
    await assert.rejects(() => page.fetch('//example.com/x'), /Failed to fetch/);
    assert.deepStrictEqual(asked, [], 'no file was looked for');
  },

  'a page that already has fetch keeps its own'() {
    const theirs = () => 'theirs';
    const page = load('web-fetch.js', { __browser: {}, player: {}, fetch: theirs });
    assert.strictEqual(page.fetch, theirs);
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
