// Tests for patches/window-clip.js, run with Node:
//   node tests/patches/window_clip.test.js
//
// RPG Maker MZ keeps a window's contents inside the window with a filter,
// which makes every open window be drawn into a texture and copied back in
// every frame. The patch clips with a rectangle instead. The tests use the
// engine's own lines for a window's client area, with stand-ins for PIXI's
// classes that record what they are told; that the picture is the same is
// checked on the real engine, with captures.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const sandbox = { player: { patches: {}, patchStats: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`
    var PIXI = {
      filters: { AlphaFilter: function () { this.isAlphaFilter = true; } },
      Graphics: function () { this.drawn = []; this.isGraphics = true; },
    };
    PIXI.Graphics.prototype.clear = function () { this.drawn = []; return this; };
    PIXI.Graphics.prototype.beginFill = function () { return this; };
    PIXI.Graphics.prototype.endFill = function () { return this; };
    PIXI.Graphics.prototype.drawRect = function (x, y, w, h) { this.drawn.push([x, y, w, h]); return this; };
    function Rectangle() { this.x = this.y = this.width = this.height = 0; }
    function Point(x, y) { this.x = x; this.y = y; }
    function Sprite() { this.children = []; this.filters = null; this.mask = null; this.worldTransform = { apply: function (p) { return p; } }; }
    Sprite.prototype.move = function (x, y) { this.x = x; this.y = y; };
    Sprite.prototype.addChild = function (child) { this.children.push(child); return child; };
    // As in the engine (rmmz_core.js).
    function Window() { this.children = []; this._padding = 12; this._width = 240; this._height = 120; this.origin = new Point(0, 0); this._createClientArea(); }
    Window.prototype.addChild = function (child) { this.children.push(child); return child; };
    Object.defineProperty(Window.prototype, 'innerWidth', { get: function () { return Math.max(0, this._width - this._padding * 2); } });
    Object.defineProperty(Window.prototype, 'innerHeight', { get: function () { return Math.max(0, this._height - this._padding * 2); } });
    Window.prototype._createClientArea = function () {
      this._clientArea = new Sprite();
      this._clientArea.filters = [new PIXI.filters.AlphaFilter()];
      this._clientArea.filterArea = new Rectangle();
      this._clientArea.move(this._padding, this._padding);
      this.addChild(this._clientArea);
    };
    Window.prototype._updateFilterArea = function () {
      const pos = this._clientArea.worldTransform.apply(new Point(0, 0));
      const filterArea = this._clientArea.filterArea;
      filterArea.x = pos.x + this.origin.x;
      filterArea.y = pos.y + this.origin.y;
      filterArea.width = this.innerWidth;
      filterArea.height = this.innerHeight;
    };
    var Graphics = { _app: null, _createPixiApp: function () { this._app = { renderer: { mask: { enableScissor: false } } }; } };
  `, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'window-clip.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return { sandbox, make: () => vm.runInContext('new Window()', sandbox), install: () => sandbox.player.patches.windowClip({}) };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

const tests = {
  'without the patch a window clips its contents with a filter'() {
    const { make } = setup();
    const window = make();
    assert.strictEqual(window._clientArea.filters.length, 1);
    assert.strictEqual(window._clientArea.mask, null);
  },

  'with it the contents have no filter, and a rectangle of the window as their mask'() {
    const { make, install } = setup();
    install();
    const window = make();
    assert.strictEqual(window._clientArea.filters, null);
    assert.ok(window._clientArea.mask && window._clientArea.mask.isGraphics);
    assert.ok(window.children.includes(window._clientArea.mask), 'the rectangle moves with the window');
  },

  'the rectangle is the window without its padding'() {
    const { make, install } = setup();
    install();
    const window = make();
    window._updateFilterArea();
    assert.deepStrictEqual(plain(window._clientArea.mask.drawn), [[12, 12, 216, 96]]);
    assert.strictEqual(window._clientArea.filterArea.width, 216, 'the engine\'s own bookkeeping still runs');
  },

  'it follows the window when its size or padding changes, and is not redrawn otherwise'() {
    const { make, install } = setup();
    install();
    const window = make();
    window._updateFilterArea();
    const clip = window._clientArea.mask;
    let cleared = 0;
    const clear = clip.clear;
    clip.clear = function () { cleared++; return clear.call(this); };
    window._updateFilterArea();
    window._updateFilterArea();
    assert.strictEqual(cleared, 0, 'nothing changed');
    window._width = 400;
    window._padding = 8;
    window._updateFilterArea();
    assert.strictEqual(cleared, 1);
    assert.deepStrictEqual(plain(clip.drawn), [[8, 8, 384, 104]]);
  },

  'a window scrolled by its origin is still clipped to the same rectangle'() {
    const { make, install } = setup();
    install();
    const window = make();
    window.origin.y = 48;
    window._updateFilterArea();
    assert.deepStrictEqual(plain(window._clientArea.mask.drawn), [[12, 12, 216, 96]]);
  },

  'the renderer is told to clip rectangles with a scissor, which the window layer\'s own stencil does not disturb'() {
    const { sandbox, install } = setup();
    install();
    sandbox.Graphics._createPixiApp();
    assert.strictEqual(sandbox.Graphics._app.renderer.mask.enableScissor, true);
  },

  'the counters say how many windows were made'() {
    const { sandbox, make, install } = setup();
    install();
    make(); make();
    assert.strictEqual(sandbox.player.patchStats.windowClip.windows, 2);
  },

  'an engine without such windows is left alone'() {
    const sandbox = { player: { patches: {}, patchStats: {} } };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const file = path.join(__dirname, '..', '..', 'patches', 'window-clip.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    sandbox.player.patches.windowClip({});
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try {
    test();
    console.log('ok   ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     '));
  }
}
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
