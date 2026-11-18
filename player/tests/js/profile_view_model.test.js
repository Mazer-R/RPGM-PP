// Tests for js/profile-view-model.js, run with Node:
//   node tests/js/profile_view_model.test.js
//
// The module holds what the profile screen decides without drawing: how
// digging at the ground opens the achievements, how the achievements are
// laid out in a grid and how the choice moves over it.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const file = path.join(__dirname, '..', '..', 'js', 'profile-view-model.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const model = sandbox.__profileView;
const plain = (value) => JSON.parse(JSON.stringify(value));
const strikes = (...times) => times.reduce((state, at) => model.dig(state, at), model.undug());

const tests = {
  'five strikes at the ground, one after another, open the achievements'() {
    assert.strictEqual(strikes(0, 500, 1000, 1500).open, false);
    assert.strictEqual(strikes(0, 500, 1000, 1500).depth, 4);
    assert.strictEqual(strikes(0, 500, 1000, 1500, 2000).open, true);
  },

  'a pause of three seconds lets the earth settle: the digging starts again'() {
    const state = strikes(0, 500, 1000, 4000);
    assert.strictEqual(state.depth, 1);
    assert.strictEqual(strikes(0, 500, 1000, 3999).depth, 4);
  },

  'the hole is as deep as the strikes so far, and closes by itself'() {
    const state = strikes(0, 500);
    assert.strictEqual(model.depthAt(state, 600), 2);
    assert.strictEqual(model.depthAt(state, 3499), 2);
    assert.strictEqual(model.depthAt(state, 3500), 0);
    assert.strictEqual(model.depthAt(model.undug(), 100), 0);
  },

  'twenty touches at the sky, or ten presses to the sides, call the saucer; fewer do not'() {
    const knocks = (n, how) => Array.from({ length: n }, (_, i) => i * 300).reduce((state, at) => model.knock(state, at, how), model.unknocked());
    assert.strictEqual(knocks(19, 'touch').open, false);
    assert.strictEqual(knocks(19, 'touch').depth, 19);
    assert.strictEqual(knocks(20, 'touch').open, true);
    assert.strictEqual(knocks(9, 'keys').open, false);
    assert.strictEqual(knocks(10, 'keys').open, true);
    // a pause of three seconds, and the count starts again
    assert.strictEqual(model.knock(knocks(9, 'keys'), 9 * 300 + 3000, 'keys').open, false);
    assert.strictEqual(model.knock(knocks(9, 'keys'), 9 * 300 + 3000, 'keys').depth, 1);
  },

  'the saucer crosses the window in three seconds and is gone'() {
    assert.strictEqual(model.saucerAt(0, 640), null);
    const start = model.saucerAt(1000, 640, 1000), middle = model.saucerAt(2500, 640, 1000), end = model.saucerAt(3999, 640, 1000);
    assert.ok(start.x < 0 && middle.x > 250 && middle.x < 390 && end.x > 640, [start.x, middle.x, end.x].join(' '));
    assert.strictEqual(model.saucerAt(4000, 640, 1000), null);
    assert.strictEqual(model.saucerAt(500, 640, 1000), null);
  },

  'achievements are told one at a time: each comes down, stays and goes back up'() {
    assert.strictEqual(model.toast(0, 0, 2), null);                  // nothing was started
    const coming = model.toast(1150, 1000, 2), there = model.toast(2000, 1000, 2), going = model.toast(4050, 1000, 2);
    assert.strictEqual(coming.index, 0);
    assert.ok(coming.shown > 0.4 && coming.shown < 0.6, String(coming.shown));
    assert.strictEqual(there.shown, 1);
    assert.ok(going.shown > 0.4 && going.shown < 0.6, String(going.shown));
    // the second one follows the first
    assert.strictEqual(model.toast(1000 + 3200, 1000, 2).index, 1);
    assert.strictEqual(model.toast(1000 + 3200 + 1500, 1000, 2).shown, 1);
    // and after the last there is none
    assert.strictEqual(model.toast(1000 + 6400, 1000, 2), null);
    assert.strictEqual(model.toast(900, 1000, 2), null);
  },

  'the grid has as many columns as fit and shows whole rows'() {
    assert.deepStrictEqual(plain(model.grid(640, 480, 38)), { columns: 5, rows: 8, shown: 3, cell: 96, gap: 8, left: 64, top: 96 });
    const upright = model.grid(540, 1200, 38);
    assert.strictEqual(upright.columns, 4);
    assert.strictEqual(upright.shown, 10);
    const wide = model.grid(1200, 540, 38);
    assert.strictEqual(wide.columns, 11);
    assert.strictEqual(wide.rows, 4);
    assert.strictEqual(wide.shown, 3);
  },

  'a very small window still shows two columns and one row'() {
    const tiny = model.grid(200, 200, 38);
    assert.strictEqual(tiny.columns, 2);
    assert.strictEqual(tiny.shown, 1);
  },

  'the choice moves over the grid and stops at its edges'() {
    // 5 columns, 38 achievements: the last row has three.
    assert.strictEqual(model.step(0, 'right', 5, 38), 1);
    assert.strictEqual(model.step(0, 'left', 5, 38), 0);
    assert.strictEqual(model.step(4, 'right', 5, 38), 5);
    assert.strictEqual(model.step(0, 'down', 5, 38), 5);
    assert.strictEqual(model.step(3, 'up', 5, 38), 3);
    assert.strictEqual(model.step(37, 'right', 5, 38), 37);
    assert.strictEqual(model.step(34, 'down', 5, 38), 37);
    assert.strictEqual(model.step(32, 'down', 5, 38), 37);
    assert.strictEqual(model.step(37, 'down', 5, 38), 37);
    assert.strictEqual(model.step(37, 'up', 5, 38), 32);
  },

  'the rows shown follow the choice'() {
    assert.strictEqual(model.firstRow(0, 0, 5, 3), 0);
    assert.strictEqual(model.firstRow(0, 14, 5, 3), 0);
    assert.strictEqual(model.firstRow(0, 15, 5, 3), 1);
    assert.strictEqual(model.firstRow(4, 7, 5, 3), 1);
    assert.strictEqual(model.firstRow(2, 12, 5, 3), 2);
  },

  'a touch finds the achievement under it, or none'() {
    const grid = model.grid(640, 480, 38);
    assert.strictEqual(model.cellAt(64, 96, grid, 0, 38), 0);
    assert.strictEqual(model.cellAt(64 + 104, 96 + 104, grid, 0, 38), 6);
    assert.strictEqual(model.cellAt(64 + 104, 96 + 104, grid, 2, 38), 16);
    assert.strictEqual(model.cellAt(64 + 100, 96, grid, 0, 38), -1);   // in the gap
    assert.strictEqual(model.cellAt(10, 96, grid, 0, 38), -1);
    assert.strictEqual(model.cellAt(64 + 4 * 104, 96 + 2 * 104, grid, 5, 38), -1);   // past the last one
    assert.strictEqual(model.cellAt(64, 96 + 3 * 104, grid, 0, 38), -1);   // under the rows shown
  },

  'time played is said in hours and minutes'() {
    assert.strictEqual(model.played(0), 'not yet');
    assert.strictEqual(model.played(59), 'under a minute');
    assert.strictEqual(model.played(60), '1 min');
    assert.strictEqual(model.played(3599), '59 min');
    assert.strictEqual(model.played(3600), '1 h');
    assert.strictEqual(model.played(3 * 3600 + 20 * 60), '3 h 20 min');
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
