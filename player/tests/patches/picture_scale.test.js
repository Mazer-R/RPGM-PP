// Tests for patches/picture-scale.js, run with Node:
//   node tests/patches/picture_scale.test.js
//
// The patch marks the pictures a game shows whole, so that the player sends
// them to the graphics memory at the size the screen can show. The tests
// give it a Bitmap that loads as the engines' do (an image first, a canvas
// only when the picture is changed) and check what is marked, and with what.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// `screen`: [width, height] of the device, or null for a player that cannot say.
function setup(options, screen, more) {
  const made = { canvases: 0, loads: 0 };
  function Bitmap(url) { this._url = url; this._image = { name: 'image' }; }
  Bitmap.prototype._onLoad = function () { made.loads++; return 'loaded'; };
  Bitmap.prototype._createCanvas = function () { made.canvases++; this.__canvas = { name: 'canvas' }; };
  // As MV 1.6 has it: asking for the canvas makes one.
  Object.defineProperty(Bitmap.prototype, '_canvas', {
    get() { if (!this.__canvas) this._createCanvas(); return this.__canvas; }, configurable: true,
  });
  const sandbox = Object.assign({
    player: { patches: {}, patchStats: {}, gl: screen ? { screenSize: () => screen } : {} },
    console: { log() {}, warn() {} },
    Graphics: { width: 816, height: 624 },
    Bitmap: Bitmap,
  }, more || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches/picture-scale.js'), 'utf8'), sandbox);
  sandbox.player.patches.pictureScale(options || {});
  return {
    sandbox, made,
    load(url) { const bitmap = new sandbox.Bitmap(url); bitmap.result = bitmap._onLoad(); return bitmap; },
  };
}

const tests = [];
function test(name, body) { tests.push({ name, body }); }
const near = (got, wanted) => assert.ok(Math.abs(got - wanted) < 1e-9, got + ' is not ' + wanted);

test('on a screen smaller than the game, a picture is marked with what the screen shows of it', () => {
  const game = setup({}, [640, 480]);
  const bitmap = game.load('img/pictures/Scene_01.png');
  near(bitmap._image.__uploadScale, 480 / 624);
  assert.strictEqual(bitmap.result, 'loaded');
  assert.strictEqual(game.made.loads, 1);
});

test('what is drawn in parts is left alone', () => {
  const game = setup({}, [640, 480]);
  ['img/characters/Actor1.png', 'img/tilesets/World_A1.png', 'img/system/Window.png', 'img/faces/Actor1.png'].forEach((url) => {
    assert.strictEqual(game.load(url)._image.__uploadScale, undefined, url);
  });
});

test('marking a picture makes no canvas for it', () => {
  const game = setup({}, [640, 480]);
  game.load('img/pictures/Scene_01.png');
  assert.strictEqual(game.made.canvases, 0);
});

test('a canvas made for the picture later is marked too', () => {
  const game = setup({}, [640, 480]);
  const bitmap = game.load('img/pictures/Scene_01.png');
  near(bitmap._canvas.__uploadScale, 480 / 624);
});

test('a canvas the picture already has is marked', () => {
  const game = setup({}, [640, 480]);
  const bitmap = new game.sandbox.Bitmap('img/pictures/Scene_01.png');
  bitmap._createCanvas();
  bitmap._onLoad();
  near(bitmap.__canvas.__uploadScale, 480 / 624);
});

test('a canvas of something drawn in parts is not marked', () => {
  const game = setup({}, [640, 480]);
  assert.strictEqual(game.load('img/characters/Actor1.png')._canvas.__uploadScale, undefined);
});

test('a canvas the bitmap owns outright, as in older engines, is marked', () => {
  const game = setup({}, [640, 480]);
  const bitmap = new game.sandbox.Bitmap('img/pictures/Scene_01.png');
  Object.defineProperty(bitmap, '_canvas', { value: { name: 'own' }, writable: true });
  bitmap._onLoad();
  near(bitmap._canvas.__uploadScale, 480 / 624);
});

test('on a screen as large as the game nothing is marked', () => {
  const game = setup({}, [1080, 2160]);
  assert.strictEqual(game.load('img/pictures/Scene_01.png')._image.__uploadScale, undefined);
});

test('a screen only a little smaller is not worth it', () => {
  const game = setup({}, [800, 612]);
  assert.strictEqual(game.load('img/pictures/Scene_01.png')._image.__uploadScale, undefined);
});

test('in a window that can change size nothing is marked', () => {
  const game = setup({}, [640, 480]);
  game.sandbox.player.screenResizable = true;
  assert.strictEqual(game.load('img/pictures/Scene_01.png')._image.__uploadScale, undefined);
});

test('a player that cannot say the size of its screen marks nothing', () => {
  const game = setup({}, null);
  assert.strictEqual(game.load('img/pictures/Scene_01.png')._image.__uploadScale, undefined);
});

test('a picture is never asked for at under half its size', () => {
  const game = setup({}, [240, 180]);
  near(game.load('img/pictures/Scene_01.png')._image.__uploadScale, 0.5);
});

test('the folders are an option, and a name written for a web address is understood', () => {
  const game = setup({ folders: ['img/my pictures/'] }, [640, 480]);
  near(game.load('img/my%20pictures/A.png')._image.__uploadScale, 480 / 624);
  assert.strictEqual(game.load('img/pictures/A.png')._image.__uploadScale, undefined);
});

test('the counters say the scale and how many pictures were marked', () => {
  const game = setup({}, [640, 480]);
  game.load('img/pictures/A.png'); game.load('img/pictures/B.png'); game.load('img/characters/C.png');
  const stats = game.sandbox.player.patchStats.pictureScale;
  near(stats.scale, 480 / 624);
  assert.strictEqual(stats.marked, 2);
});

test('an engine without the pieces the patch needs is left as it is', () => {
  const game = setup({}, [640, 480], { Bitmap: undefined });
  assert.ok(game.sandbox.player.patchStats.pictureScale);
});

let failed = 0;
for (const t of tests) {
  try { t.body(); console.log('ok   ' + t.name); } catch (error) { failed++; console.log('FAIL ' + t.name + '\n     ' + error.message); }
}
console.log(failed + ' failures');
process.exit(failed ? 1 : 0);
