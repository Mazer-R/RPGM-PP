// Tests for patches/lean-tint.js, run with Node:
//   node tests/patches/lean_tint.test.js
//
// The patch leaves out the steps of the engine's tint that change nothing.
// The tests run the tint on a small canvas that works the colours out as a
// page's canvas does (the compositing rules of the Canvas standard), once
// with a stand-in for the engine's function and once with the patch, and
// compare every pixel; they also count the fills that were asked for.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- A canvas of a few pixels. A pixel is [r, g, b, a], the colour already
// multiplied by its alpha, each from 0 to 1.
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const sat = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function clip(c) {
  const l = lum(c), n = Math.min(...c), x = Math.max(...c);
  let out = c.slice();
  if (n < 0) out = out.map((v) => l + (v - l) * l / (l - n));
  if (x > 1) out = out.map((v) => l + (v - l) * (1 - l) / (x - l));
  return out;
}
const setLum = (c, l) => { const d = l - lum(c); return clip(c.map((v) => v + d)); };
function setSat(c, s) {
  const order = [0, 1, 2].sort((p, q) => c[p] - c[q]), out = [0, 0, 0];
  const [min, mid, max] = order;
  if (c[max] > c[min]) { out[mid] = (c[mid] - c[min]) * s / (c[max] - c[min]); out[max] = s; }
  return out;
}
const blends = {
  difference: (d, s) => d.map((v, i) => Math.abs(v - s[i])),
  saturation: (d, s) => setLum(setSat(d, sat(s)), lum(d)),
};
function composite(op, d, s) {
  const ad = d[3], as = s[3];
  if (op === 'copy') return s.slice();
  if (op === 'lighter') return d.map((v, i) => Math.min(1, v + s[i]));
  if (op === 'source-atop') return [0, 1, 2].map((i) => s[i] * ad + d[i] * (1 - as)).concat(ad);
  if (op === 'destination-in') return d.map((v) => v * as);
  const plain = (p) => (p[3] ? p.slice(0, 3).map((v) => v / p[3]) : [0, 0, 0]);
  const mixed = blends[op](plain(d), plain(s));
  return [0, 1, 2].map((i) => s[i] * (1 - ad) + d[i] * (1 - as) + as * ad * mixed[i]).concat(as + ad - as * ad);
}
function parse(style) {
  if (style === 'white') return [1, 1, 1, 1];
  const m = /^rgba?\(([^)]*)\)$/.exec(style).slice(1)[0].split(',').map(Number);
  return [m[0] / 255, m[1] / 255, m[2] / 255, m.length > 3 ? m[3] : 1];
}
function canvasOf(pixels) {
  const canvas = { pixels: pixels.map((p) => p.slice()), fills: [] };
  canvas.context = {
    globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: 'white',
    fillRect() {
      const c = parse(this.fillStyle), a = c[3] * this.globalAlpha, s = [c[0] * a, c[1] * a, c[2] * a, a];
      canvas.fills.push(this.globalCompositeOperation);
      canvas.pixels = canvas.pixels.map((d) => composite(this.globalCompositeOperation, d, s));
    },
    drawImage(source) {
      canvas.pixels = canvas.pixels.map((d, i) => composite(this.globalCompositeOperation, d, source.pixels[i]));
    },
  };
  return canvas;
}

// The picture that is tinted: opaque, half see-through and empty pixels.
const PICTURE = [[0.8, 0.2, 0.1, 1], [0.1, 0.3, 0.2, 0.5], [0, 0, 0, 0], [0.02, 0.01, 0.2, 0.25], [1, 1, 1, 1], [0, 0, 0, 1]];

// A stand-in for the engine's tint: the same steps in the same order.
const ENGINE = `function(x, y, w, h) {
  var c = this._context, tone = this._colorTone, color = this._blendColor, zero = function (n) { return Math.max(0, n); };
  c.globalCompositeOperation = 'copy'; c.drawImage(this._bitmap.canvas, x, y, w, h, 0, 0, w, h);
  if (Graphics.canUseSaturationBlend()) {
    c.globalCompositeOperation = 'saturation'; c.fillStyle = 'rgba(255,255,255,' + zero(tone[3]) / 255 + ')'; c.fillRect(0, 0, w, h);
  }
  c.globalCompositeOperation = 'lighter'; c.fillStyle = Utils.rgbToCssColor(zero(tone[0]), zero(tone[1]), zero(tone[2])); c.fillRect(0, 0, w, h);
  if (Graphics.canUseDifferenceBlend()) {
    c.globalCompositeOperation = 'difference'; c.fillStyle = 'white'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter'; c.fillStyle = Utils.rgbToCssColor(zero(-tone[0]), zero(-tone[1]), zero(-tone[2])); c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'difference'; c.fillStyle = 'white'; c.fillRect(0, 0, w, h);
  }
  c.globalCompositeOperation = 'source-atop'; c.fillStyle = Utils.rgbToCssColor(zero(color[0]), zero(color[1]), zero(color[2]));
  c.globalAlpha = zero(color[3]) / 255; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'destination-in'; c.globalAlpha = 1; c.drawImage(this._bitmap.canvas, x, y, w, h, 0, 0, w, h);
}`;

// `patched`: with the patch installed. `can`: what the device's canvas can blend.
function tint(patched, tone, color, can, engineCode) {
  const sandbox = {
    player: { patches: {}, patchStats: {} },
    Graphics: { canUseSaturationBlend: () => !can || can.saturation !== false, canUseDifferenceBlend: () => !can || can.difference !== false },
    Utils: { rgbToCssColor: (r, g, b) => 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')' },
    Math: Math,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('function Sprite() {} Sprite.prototype._executeTint = ' + (engineCode || ENGINE) + ';', sandbox);
  let note;
  if (patched) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches/lean-tint.js'), 'utf8'), sandbox);
    const own = sandbox.player.patches.leanTint.codeMark;
    note = sandbox.player.patches.leanTint({ engineCode: [own(vm.runInContext('Sprite.prototype._executeTint', sandbox))] });
  }
  const target = canvasOf(PICTURE.map(() => [0, 0, 0, 0]));
  const sprite = vm.runInContext('new Sprite()', sandbox);
  Object.assign(sprite, { _context: target.context, _colorTone: tone, _blendColor: color, _bitmap: { canvas: canvasOf(PICTURE) } });
  sprite._executeTint(0, 0, 3, 2);
  return { pixels: target.pixels, fills: target.fills, note, stats: sandbox.player.patchStats.leanTint, sandbox, context: target.context };
}
function samePixels(a, b) {
  a.forEach((p, i) => p.forEach((v, c) => assert.ok(Math.abs(v - b[i][c]) < 1e-12, 'pixel ' + i + ' channel ' + c + ': ' + v + ' is not ' + b[i][c])));
}

const tests = [];
function test(name, body) { tests.push({ name, body }); }

test('a whitening flash: the same pixels with two fills instead of five', () => {
  const engine = tint(false, [0, 0, 0, 0], [255, 255, 255, 128]), lean = tint(true, [0, 0, 0, 0], [255, 255, 255, 128]);
  samePixels(lean.pixels, engine.pixels);
  assert.deepStrictEqual(engine.fills, ['saturation', 'lighter', 'difference', 'lighter', 'difference', 'source-atop']);
  assert.deepStrictEqual(lean.fills, ['lighter', 'source-atop']);
});

test('a coloured flash over a brighter tone: the same pixels, the darkening steps left out', () => {
  const tone = [68, 34, 0, 0], color = [255, 0, 60, 200];
  const engine = tint(false, tone, color), lean = tint(true, tone, color);
  samePixels(lean.pixels, engine.pixels);
  assert.deepStrictEqual(lean.fills, ['lighter', 'source-atop']);
});

test('a darker tone needs the darkening steps: all of them stay, the same pixels', () => {
  const tone = [-68, -34, 0, 0], color = [0, 0, 0, 0];
  const engine = tint(false, tone, color), lean = tint(true, tone, color);
  samePixels(lean.pixels, engine.pixels);
  assert.deepStrictEqual(lean.fills, ['lighter', 'difference', 'lighter', 'difference', 'source-atop']);
});

test('a grey tone needs the greying step: it stays, the same pixels', () => {
  const tone = [0, 0, 0, 255], color = [0, 0, 0, 0];
  const engine = tint(false, tone, color), lean = tint(true, tone, color);
  samePixels(lean.pixels, engine.pixels);
  assert.deepStrictEqual(lean.fills, ['saturation', 'lighter', 'source-atop']);
});

test('every step at once: nothing left out, the same pixels', () => {
  const tone = [-30, 40, -255, 120], color = [10, 200, 30, 90];
  const engine = tint(false, tone, color), lean = tint(true, tone, color);
  samePixels(lean.pixels, engine.pixels);
  assert.deepStrictEqual(lean.fills, engine.fills);
});

test('a canvas that cannot grey or darken: as the engine does there', () => {
  const can = { saturation: false, difference: false }, tone = [-30, 40, 0, 120], color = [10, 200, 30, 90];
  const engine = tint(false, tone, color, can), lean = tint(true, tone, color, can);
  samePixels(lean.pixels, engine.pixels);
  assert.deepStrictEqual(lean.fills, ['lighter', 'source-atop']);
});

test('the canvas is left as the engine leaves it', () => {
  const lean = tint(true, [0, 0, 0, 0], [255, 255, 255, 128]);
  assert.strictEqual(lean.context.globalAlpha, 1);
  assert.strictEqual(lean.context.globalCompositeOperation, 'destination-in');
});

test('the counters say how many tints and how many fills were left out', () => {
  const lean = tint(true, [0, 0, 0, 0], [255, 255, 255, 128]);
  assert.strictEqual(lean.stats.tints, 1);
  assert.strictEqual(lean.stats.fillsLeftOut, 4);
});

test('a tint a plugin has rewritten is left as the plugin made it', () => {
  const sandbox = { player: { patches: {}, patchStats: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('function Sprite() {} Sprite.prototype._executeTint = function () { return "the plugin\'s"; };', sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches/lean-tint.js'), 'utf8'), sandbox);
  const note = sandbox.player.patches.leanTint({});
  assert.strictEqual(vm.runInContext('new Sprite()._executeTint()', sandbox), "the plugin's");
  assert.ok(/plugin/.test(note), note);
});

test('an engine without sprites is left as it is', () => {
  const sandbox = { player: { patches: {}, patchStats: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../patches/lean-tint.js'), 'utf8'), sandbox);
  sandbox.player.patches.leanTint({});
});

let failed = 0;
for (const t of tests) {
  try { t.body(); console.log('ok   ' + t.name); } catch (error) { failed++; console.log('FAIL ' + t.name + '\n     ' + String(error.message).split('\n')[0]); }
}
console.log(failed + ' failures');
process.exit(failed ? 1 : 0);
