// Tests for patches/render-after-clock-step.js, run with Node:
//   node tests/patches/render_after_clock_step.test.js
//
// The engine times each drawing with the clock of the wall and skips as many
// of the next frames as the drawing took too long. The tests give the patch
// the engine's own function with a clock they can set back in the middle of
// a drawing, and check that the picture is drawn again afterwards.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The engine's function as it is in 1.6, and a renderer that counts.
function engine() {
  const sandbox = { player: { patches: {}, patchStats: {} }, console: { log() {}, warn() {} }, clock: [] };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`
    var now = 1000;
    var Graphics = { _skipCount: 0, _maxSkip: 3, _rendered: false, frameCount: 0, drawn: 0 };
    Graphics._renderer = { render: function () { Graphics.drawn++; now += clock.length ? clock.shift() : 1; } };
    Graphics.render = function (stage) {
      if (this._skipCount === 0) {
        var startTime = now;
        if (stage) this._renderer.render(stage);
        var elapsed = now - startTime;
        this._skipCount = Math.min(Math.floor(elapsed / 15), this._maxSkip);
        this._rendered = true;
      } else {
        this._skipCount--;
        this._rendered = false;
      }
      this.frameCount++;
    };
  `, sandbox);
  return sandbox;
}
function install(sandbox) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches/render-after-clock-step.js'), 'utf8'), sandbox);
  sandbox.player.patches.renderAfterClockStep({});
  return sandbox.player.patchStats.renderAfterClockStep;
}
function frames(sandbox, count) {
  for (let i = 0; i < count; i++) sandbox.Graphics.render({});
  return sandbox.Graphics.drawn;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('the engine alone never draws again once the clock is set back during a drawing', () => {
  const sandbox = engine();
  sandbox.clock.push(-40);
  assert.strictEqual(frames(sandbox, 100), 1);
});

test('with the patch the next frame is drawn, and it is counted', () => {
  const sandbox = engine();
  const stats = install(sandbox);
  sandbox.clock.push(-40);
  assert.strictEqual(frames(sandbox, 100), 100);
  assert.strictEqual(stats.recovered, 1);
});

test('a drawing that took long still has its frames skipped', () => {
  const sandbox = engine();
  const stats = install(sandbox);
  sandbox.clock.push(31);                       // two frames' worth: skip two
  assert.strictEqual(frames(sandbox, 3), 1);
  assert.strictEqual(frames(sandbox, 1), 2);
  assert.strictEqual(stats.recovered, 0);
});

test('a skip count that is not a number is put right too', () => {
  const sandbox = engine();
  const stats = install(sandbox);
  sandbox.Graphics._skipCount = NaN;
  assert.strictEqual(frames(sandbox, 2), 2);
  assert.strictEqual(stats.recovered, 1);
});

test('an engine with no such function is left alone', () => {
  const sandbox = { player: { patches: {}, patchStats: {} }, console: { log() {}, warn() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  install(sandbox);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message); }
}
console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
