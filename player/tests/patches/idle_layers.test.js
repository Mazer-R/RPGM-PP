// Tests for patches/idle-tone-filter.js and patches/idle-battle-layers.js,
// run with Node:
//   node tests/patches/idle_layers.test.js
//
// Both leave out a whole-screen layer that changes nothing in the picture.
// The tests give each a stand-in for the part of the engine it touches and
// check when the layer is on and when it is off.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(file, more) {
  const sandbox = Object.assign({ player: { patches: {}, patchStats: {} }, console: { log() {}, warn() {} } }, more || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}
function install(sandbox, file, name, options) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches', file), 'utf8'), sandbox);
  return sandbox.player.patches[name](options || {});
}

// --- The tone filter -------------------------------------------------------
// As the engine has it: the filter is made once, switched on, and set again
// only when the screen's tone changes.
function toneEngine() {
  const sandbox = load();
  vm.runInContext(`
    function Spriteset_Base() { this._tone = [0, 0, 0, 0]; this.createWebGLToneChanger(); }
    Spriteset_Base.prototype.createWebGLToneChanger = function () {
      this._toneFilter = { enabled: true, set: [], reset: function () {}, adjustTone: function (r, g, b) { this.set.push([r, g, b]); }, adjustSaturation: function () {} };
      this._baseSprite = { filters: [this._toneFilter] };
    };
    Spriteset_Base.prototype.updateWebGLToneChanger = function () {
      var tone = this._tone;
      this._toneFilter.reset(); this._toneFilter.adjustTone(tone[0], tone[1], tone[2]); this._toneFilter.adjustSaturation(-tone[3]);
    };
    Spriteset_Base.prototype.setTone = function (tone) { this._tone = tone; this.updateWebGLToneChanger(); };
  `, sandbox);
  return sandbox;
}

const tests = [];
function test(name, body) { tests.push({ name, body }); }

test('tone filter: off from the start when the screen has no tone', () => {
  const sandbox = toneEngine();
  install(sandbox, 'idle-tone-filter.js', 'idleToneFilter');
  const set = vm.runInContext('new Spriteset_Base()', sandbox);
  assert.strictEqual(set._toneFilter.enabled, false);
});

test('tone filter: on while the screen has a tone, off again after', () => {
  const sandbox = toneEngine();
  install(sandbox, 'idle-tone-filter.js', 'idleToneFilter');
  const set = vm.runInContext('new Spriteset_Base()', sandbox);
  set.setTone([-68, 0, 0, 0]); assert.strictEqual(set._toneFilter.enabled, true);
  assert.strictEqual(JSON.stringify(set._toneFilter.set[0]), '[-68,0,0]');
  set.setTone([0, 0, 0, 255]); assert.strictEqual(set._toneFilter.enabled, true);
  set.setTone([0, 0, 0, 0]); assert.strictEqual(set._toneFilter.enabled, false);
  assert.strictEqual(sandbox.player.patchStats.idleToneFilter.switchedOff, 2);
});

test('tone filter: an engine that draws on a canvas, with no filter, is left as it is', () => {
  const sandbox = load();
  vm.runInContext('function Spriteset_Base() { this._tone = [0, 0, 0, 0]; } Spriteset_Base.prototype.createWebGLToneChanger = function () {}; Spriteset_Base.prototype.updateWebGLToneChanger = function () {};', sandbox);
  install(sandbox, 'idle-tone-filter.js', 'idleToneFilter');
  const set = vm.runInContext('var s = new Spriteset_Base(); s.createWebGLToneChanger(); s.updateWebGLToneChanger(); s', sandbox);
  assert.strictEqual(set._toneFilter, undefined);
  install(load(), 'idle-tone-filter.js', 'idleToneFilter');
});

// --- The snapshot behind the battle's backgrounds --------------------------
// `backs`: [{ alpha: [..16x16 alphas or one number], visible, opacity, ready, bounds }]
function battle(backs, screen) {
  const sandbox = load();
  sandbox.Graphics = { width: (screen || [816, 624])[0], height: (screen || [816, 624])[1] };
  sandbox.samples = 0;
  sandbox.document = {
    createElement() {
      let drawn = null;
      return { width: 0, height: 0, getContext() { return {
        clearRect() {},
        drawImage(source) { drawn = source; },
        getImageData(x, y, w, h) {
          sandbox.samples++;
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Array.isArray(drawn.alpha) ? drawn.alpha[i % drawn.alpha.length] : drawn.alpha;
          return { data };
        },
      }; } };
    },
  };
  vm.runInContext('function Spriteset_Battle() {} Spriteset_Battle.prototype.update = function () { this.updates = (this.updates || 0) + 1; };', sandbox);
  install(sandbox, 'idle-battle-layers.js', 'idleBattleLayers');
  const set = vm.runInContext('new Spriteset_Battle()', sandbox);
  set._backgroundSprite = { visible: true };
  // A picture the engine made itself, not loaded from a file: `alpha` of every pixel.
  const made = (alpha) => ({ _url: '', width: 8, height: 6, isReady: () => true, __canvas: { getContext: () => ({ getImageData: (x, y, w, h) => {
    sandbox.scans = (sandbox.scans || 0) + 1;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Array.isArray(alpha) ? alpha[i % alpha.length] : alpha;
    return { data };
  } }) } });
  const sprite = (b) => b && {
    visible: b.visible !== false, opacity: b.opacity === undefined ? 255 : b.opacity,
    bitmap: b.none ? null : (b.made !== undefined ? made(b.made) : { _url: 'img/battlebacks1/Floor.png', width: 1000, height: 740, isReady: () => b.ready !== false, _image: { alpha: b.alpha === undefined ? 255 : b.alpha } }),
    getBounds: () => b.bounds || { x: -32, y: -32, width: 880, height: 688 },
  };
  set._back1Sprite = sprite(backs[0]); set._back2Sprite = sprite(backs[1]);
  return { sandbox, set, stats: () => sandbox.player.patchStats.idleBattleLayers };
}

test('snapshot: hidden behind a solid background that covers the screen', () => {
  const b = battle([{ alpha: 255 }, { alpha: 0 }]);
  b.set.update();
  assert.strictEqual(b.set._backgroundSprite.visible, false);
  assert.strictEqual(b.set.updates, 1);
});

test('snapshot: the second background alone is enough', () => {
  const b = battle([{ none: true }, { alpha: 255 }]);
  b.set.update();
  assert.strictEqual(b.set._backgroundSprite.visible, false);
});

test('snapshot: shown when the backgrounds let it through', () => {
  [[{ alpha: 254 }, { alpha: 0 }], [{ alpha: [255, 255, 0, 255] }, null], [{ none: true }, { none: true }]].forEach((backs) => {
    const b = battle(backs);
    b.set.update();
    assert.strictEqual(b.set._backgroundSprite.visible, true, JSON.stringify(backs));
  });
});

test('snapshot: shown when the solid background is hidden, faded, not loaded or does not cover the screen', () => {
  [{ visible: false }, { opacity: 200 }, { ready: false }, { bounds: { x: 10, y: -32, width: 880, height: 688 } }, { bounds: { x: -32, y: -32, width: 800, height: 688 } }].forEach((back) => {
    const b = battle([back, null]);
    b.set.update();
    assert.strictEqual(b.set._backgroundSprite.visible, true, JSON.stringify(back));
  });
});

test('snapshot: comes back when the background stops covering it', () => {
  const b = battle([{ alpha: 255 }, null]);
  b.set.update(); assert.strictEqual(b.set._backgroundSprite.visible, false);
  b.set._back1Sprite.opacity = 128;
  b.set.update(); assert.strictEqual(b.set._backgroundSprite.visible, true);
  b.set._back1Sprite.opacity = 255;
  b.set.update(); assert.strictEqual(b.set._backgroundSprite.visible, false);
});

test('snapshot: a background is looked at once, not at every frame', () => {
  const b = battle([{ alpha: 255 }, { alpha: 255 }]);
  for (let i = 0; i < 50; i++) b.set.update();
  assert.ok(b.sandbox.samples <= 2, 'looked at ' + b.sandbox.samples + ' times');
});

test('snapshot: a snapshot the game itself hid is not shown by the patch', () => {
  const b = battle([{ alpha: 0 }, null]);
  b.set._backgroundSprite.visible = false;
  b.set.update();
  assert.strictEqual(b.set._backgroundSprite.visible, false);
});

test('backgrounds: an empty one the engine made is not drawn, and the picture of the map stays', () => {
  const b = battle([{ made: 0 }, { made: 0 }]);
  b.set.update();
  assert.strictEqual(b.set._back1Sprite.visible, false);
  assert.strictEqual(b.set._back2Sprite.visible, false);
  assert.strictEqual(b.set._backgroundSprite.visible, true);
  assert.strictEqual(b.stats().emptyHidden, 2);
});

test('backgrounds: one with anything in it is drawn', () => {
  const b = battle([{ made: [0, 0, 0, 1] }, { alpha: 0 }]);
  b.set.update();
  assert.strictEqual(b.set._back1Sprite.visible, true);
  assert.strictEqual(b.set._back2Sprite.visible, true, 'a see-through picture from a file is not looked into');
});

test('backgrounds: drawn again when the game gives the sprite a picture', () => {
  const b = battle([{ made: 0 }, null]);
  b.set.update(); assert.strictEqual(b.set._back1Sprite.visible, false);
  b.set._back1Sprite.bitmap = { _url: 'img/battlebacks1/Floor.png', width: 1000, height: 740, isReady: () => true, _image: { alpha: 255 } };
  b.set.update();
  assert.strictEqual(b.set._back1Sprite.visible, true);
  b.set.update();
  assert.strictEqual(b.set._backgroundSprite.visible, false, 'and now it covers the picture of the map');
});

test('backgrounds: an empty one is looked through once, and one the game hid stays hidden', () => {
  const b = battle([{ made: 0 }, { made: [0, 9], visible: false }]);
  for (let i = 0; i < 30; i++) b.set.update();
  assert.ok(b.sandbox.scans <= 2, 'looked through ' + b.sandbox.scans + ' times');
  assert.strictEqual(b.set._back2Sprite.visible, false);
});

test('snapshot: a battle without the usual sprites is left as it is', () => {
  const b = battle([null, null]);
  b.set._backgroundSprite = undefined;
  b.set.update();
  assert.strictEqual(b.set.updates, 1);
});

let failed = 0;
for (const t of tests) {
  try { t.body(); console.log('ok   ' + t.name); } catch (error) { failed++; console.log('FAIL ' + t.name + '\n     ' + String(error.message).split('\n')[0]); }
}
console.log(failed + ' failures');
process.exit(failed ? 1 : 0);
