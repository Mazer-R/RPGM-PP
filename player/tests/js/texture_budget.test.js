// Tests for patches/texture-budget.js, run with Node:
//   node tests/js/texture_budget.test.js
//
// The patch keeps the memory the textures take under a budget, by having
// the engine's own texture collector drop the ones not drawn for the
// longest. The tests give it a renderer with a collector that works like
// PIXI's (a texture is dropped once it has not been touched for more than
// `maxIdle` frames) and textures of a known size, and check what is left.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MB = 1024 * 1024;

// `textures`: [{ name, bytes, touched }]; `now` is the collector's frame count.
function setup(options, textures, now, meminfo) {
  const live = textures.slice();
  const gc = {
    count: now, maxIdle: 3600, runs: [],
    run() {
      this.runs.push(this.maxIdle);
      for (let i = live.length - 1; i >= 0; i--) if (this.count - live[i].touched > this.maxIdle) live.splice(i, 1);
    },
  };
  const gl = { textureBytes: () => live.reduce((sum, t) => sum + t.bytes, 0) };
  const updates = { count: 0, engine() { this.count++; } };
  const sandbox = {
    player: { patches: {}, patchStats: {}, readTextFile: (file) => (file === '/proc/meminfo' && meminfo) || '' },
    console: { log() {}, warn() {} },
    Graphics: { _renderer: { gl: gl, textureGC: gc } },
    SceneManager: { updateMain() { updates.engine(); } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches/texture-budget.js'), 'utf8'), sandbox);
  sandbox.player.patches.textureBudget(options);
  return {
    sandbox, gc, gl, live, updates,
    frames(n) { for (let i = 0; i < n; i++) sandbox.SceneManager.updateMain(); },
    names() { return live.map((t) => t.name).join(' '); },
    stats: sandbox.player.patchStats.textureBudget,
  };
}

function test(name, body) {
  try { body(); console.log('ok   ' + name); } catch (error) { console.log('FAIL ' + name + '\n' + error.stack); process.exitCode = 1; }
}

test('under the budget nothing is dropped and the collector is left alone', () => {
  const game = setup({ megabytes: 100, every: 1 }, [{ name: 'a', bytes: 40 * MB, touched: 0 }, { name: 'b', bytes: 40 * MB, touched: 990 }], 1000);
  game.frames(5);
  assert.strictEqual(game.names(), 'a b');
  assert.deepStrictEqual(game.gc.runs, []);
});

test('over the budget the textures idle the longest go first, and only as many as needed', () => {
  const game = setup({ megabytes: 100, every: 1 }, [
    { name: 'old', bytes: 40 * MB, touched: 0 },        // idle 5000 frames
    { name: 'middle', bytes: 40 * MB, touched: 4000 },  // idle 1000
    { name: 'recent', bytes: 40 * MB, touched: 4990 },  // idle 10
  ], 5000);
  game.frames(1);
  assert.strictEqual(game.names(), 'middle recent');
});

test('it goes on to textures idle a shorter time when that is not enough', () => {
  const game = setup({ megabytes: 50, every: 1 }, [
    { name: 'old', bytes: 40 * MB, touched: 0 },
    { name: 'middle', bytes: 40 * MB, touched: 4000 },
    { name: 'recent', bytes: 40 * MB, touched: 4990 },
  ], 5000);
  game.frames(1);
  assert.strictEqual(game.names(), 'recent');
});

test('what is being drawn now is never dropped, whatever the budget', () => {
  const game = setup({ megabytes: 10, every: 1 }, [{ name: 'shown', bytes: 40 * MB, touched: 5000 }, { name: 'also', bytes: 40 * MB, touched: 4999 }], 5000);
  game.frames(3);
  assert.strictEqual(game.names(), 'shown also');
});

test('the collector keeps its own patience afterwards', () => {
  const game = setup({ megabytes: 50, every: 1 }, [{ name: 'old', bytes: 80 * MB, touched: 0 }], 5000);
  game.frames(1);
  assert.strictEqual(game.gc.maxIdle, 3600);
  assert.strictEqual(game.names(), '');
});

test('it looks only every so many frames', () => {
  const game = setup({ megabytes: 50, every: 30 }, [{ name: 'old', bytes: 80 * MB, touched: 0 }], 5000);
  game.frames(29);
  assert.strictEqual(game.names(), 'old');
  game.frames(1);
  assert.strictEqual(game.names(), '');
});

test('the engine\'s own update still runs, once a frame', () => {
  const game = setup({ megabytes: 50, every: 1 }, [], 0);
  game.frames(3);
  assert.strictEqual(game.stats.checks, 3);
  assert.strictEqual(game.updates.count, 3);
});

test('without a size given, the budget is a share of the device\'s memory, within limits', () => {
  const small = setup({ share: 0.25, least: 96, most: 512 }, [], 0, 'MemTotal:         996352 kB\nMemFree: 1 kB\n');
  assert.strictEqual(small.stats.megabytes, 243);
  const tiny = setup({ share: 0.25, least: 96, most: 512 }, [], 0, 'MemTotal:         262144 kB\n');
  assert.strictEqual(tiny.stats.megabytes, 96);
  const large = setup({ share: 0.25, least: 96, most: 512 }, [], 0, 'MemTotal:        8000000 kB\n');
  assert.strictEqual(large.stats.megabytes, 512);
  const unknown = setup({ share: 0.25, least: 96, most: 512 }, [], 0, '');
  assert.strictEqual(unknown.stats.megabytes, 256);
});

test('a renderer that cannot say how much its textures take is left alone', () => {
  const game = setup({ megabytes: 1, every: 1 }, [{ name: 'a', bytes: 40 * MB, touched: 0 }], 5000);
  delete game.gl.textureBytes;
  game.frames(3);
  assert.strictEqual(game.names(), 'a');
});

test('MZ keeps its renderer in another place', () => {
  const game = setup({ megabytes: 50, every: 1 }, [{ name: 'old', bytes: 80 * MB, touched: 0 }], 5000);
  const renderer = game.sandbox.Graphics._renderer;
  delete game.sandbox.Graphics._renderer;
  game.sandbox.Graphics._app = { renderer: renderer };
  game.frames(1);
  assert.strictEqual(game.names(), '');
});
