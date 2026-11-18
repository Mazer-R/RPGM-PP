// Tests for patches/idle-color-filters.js, run with Node:
//   node tests/patches/idle_color_filters.test.js
//
// RPG Maker MZ puts a colour filter on the whole scene, on the map's sprites
// and on the layer under them, and keeps all three switched on for every
// frame, also while they change nothing. Each one makes the picture be drawn
// into a texture and copied back. The patch switches a colour filter off
// while it would leave the picture as it is, and on again the moment it is
// given something to do. The tests use the engine's own lines for the
// filter, with a stand-in for PIXI's filter class.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const sandbox = { player: { patches: {}, patchStats: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // As in the engine (rmmz_core.js). PIXI.Filter is cut down to what the
  // engine's filter uses: uniforms, and the switch PIXI reads before drawing.
  vm.runInContext(`
    var PIXI = { Filter: function () { this.uniforms = {}; this.enabled = true; } };
    Array.prototype.clone = function () { return this.slice(0); };
    function ColorFilter() { this.initialize(...arguments); }
    ColorFilter.prototype = Object.create(PIXI.Filter.prototype);
    ColorFilter.prototype.constructor = ColorFilter;
    ColorFilter.prototype.initialize = function () {
      PIXI.Filter.call(this, null, '');
      this.uniforms.hue = 0;
      this.uniforms.colorTone = [0, 0, 0, 0];
      this.uniforms.blendColor = [0, 0, 0, 0];
      this.uniforms.brightness = 255;
    };
    ColorFilter.prototype.setHue = function (hue) { this.uniforms.hue = Number(hue); };
    ColorFilter.prototype.setColorTone = function (tone) {
      if (!(tone instanceof Array)) throw new Error('Argument must be an array');
      this.uniforms.colorTone = tone.clone();
    };
    ColorFilter.prototype.setBlendColor = function (color) {
      if (!(color instanceof Array)) throw new Error('Argument must be an array');
      this.uniforms.blendColor = color.clone();
    };
    ColorFilter.prototype.setBrightness = function (brightness) { this.uniforms.brightness = Number(brightness); };
  `, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'idle-color-filters.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const make = () => vm.runInContext('new ColorFilter()', sandbox);
  // Arrays are made inside the sandbox, as a game's would be: the engine
  // checks that it was given an array.
  const list = (values) => vm.runInContext(JSON.stringify(values), sandbox);
  return { sandbox, make, list, install: () => sandbox.player.patches.idleColorFilters({}) };
}

const tests = {
  'without the patch a new filter is switched on, as the engine leaves it'() {
    const { make } = setup();
    assert.strictEqual(make().enabled, true);
  },

  'a filter that changes nothing is switched off from the start'() {
    const { make, list, install } = setup();
    install();
    assert.strictEqual(make().enabled, false);
  },

  'a tone switches it on, and no tone off again'() {
    const { make, list, install } = setup();
    install();
    const filter = make();
    filter.setColorTone(list([-68, -68, 0, 68]));
    assert.strictEqual(filter.enabled, true);
    filter.setColorTone(list([0, 0, 0, 0]));
    assert.strictEqual(filter.enabled, false);
    filter.setColorTone(list([0, 0, 0, 40]));
    assert.strictEqual(filter.enabled, true, 'grey alone is a tone too');
  },

  'so does a hue, a brightness below full, or a blend colour that shows'() {
    const { make, list, install } = setup();
    install();
    const filter = make();
    filter.setHue(120);
    assert.strictEqual(filter.enabled, true);
    filter.setHue(0);
    assert.strictEqual(filter.enabled, false);
    filter.setBrightness(128);
    assert.strictEqual(filter.enabled, true);
    filter.setBrightness(255);
    assert.strictEqual(filter.enabled, false);
    filter.setBlendColor(list([255, 255, 255, 128]));
    assert.strictEqual(filter.enabled, true);
    filter.setBlendColor(list([255, 255, 255, 0]));
    assert.strictEqual(filter.enabled, false, 'a blend colour with no strength changes nothing');
  },

  'it stays on while any one of them is at work'() {
    const { make, list, install } = setup();
    install();
    const filter = make();
    filter.setBrightness(100);
    filter.setColorTone(list([10, 0, 0, 0]));
    filter.setBrightness(255);
    assert.strictEqual(filter.enabled, true);
    filter.setColorTone(list([0, 0, 0, 0]));
    assert.strictEqual(filter.enabled, false);
  },

  'what the filter is given is what the engine would have given it'() {
    const { make, list, install } = setup();
    install();
    const filter = make();
    filter.setColorTone(list([1, 2, 3, 4]));
    filter.setHue('30');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filter.uniforms)), { hue: 30, colorTone: [1, 2, 3, 4], blendColor: [0, 0, 0, 0], brightness: 255 });
    assert.throws(() => filter.setColorTone('red'), /must be an array/);
  },

  'the counters say how often a filter was switched'() {
    const { sandbox, make, list, install } = setup();
    install();
    const filter = make();
    filter.setBrightness(10);
    filter.setBrightness(20);
    filter.setBrightness(255);
    const stats = sandbox.player.patchStats.idleColorFilters;
    assert.strictEqual(stats.made, 1);
    assert.strictEqual(stats.switchedOn, 1);
    assert.strictEqual(stats.switchedOff, 1);
  },

  'an engine without this filter is left alone'() {
    const sandbox = { player: { patches: {}, patchStats: {} } };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const file = path.join(__dirname, '..', '..', 'patches', 'idle-color-filters.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    sandbox.player.patches.idleColorFilters({});
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
