// Tests for js/picker-model.js, run with Node:
//   node tests/js/picker_model.test.js
//
// The module holds what the game list decides without drawing anything: in
// which order the games are shown (the ones played last first), and what
// the "add a game" browser shows for a folder and where "up" leads.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const file = path.join(__dirname, '..', '..', 'js', 'picker-model.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const model = sandbox.__pickerModel;
const plain = (value) => JSON.parse(JSON.stringify(value));

const tests = {
  'games played before come first, the last one played on top; the rest by name'() {
    const found = [{ title: 'beta', www: '/b' }, { title: 'Alpha', www: '/a' }, { title: 'Gamma', www: '/g' }, { title: 'delta', www: '/d' }];
    const ordered = model.order(found, ['/g', '/missing', '/b']);
    assert.deepStrictEqual(plain(ordered.map((game) => game.www)), ['/g', '/b', '/a', '/d']);
    assert.deepStrictEqual(plain(ordered.map((game) => !!game.recent)), [true, true, false, false]);
  },

  'ordering the same games again gives the same list, and follows a change of what was played last'() {
    const found = [{ title: 'Alpha', www: '/a' }, { title: 'Beta', www: '/b' }, { title: 'Gamma', www: '/g' }];
    model.order(found, ['/b']);
    assert.deepStrictEqual(plain(model.order(found, ['/b']).map((game) => game.www)), ['/b', '/a', '/g']);
    const later = model.order(found, ['/g', '/b']);
    assert.deepStrictEqual(plain(later.map((game) => game.www)), ['/g', '/b', '/a']);
    assert.deepStrictEqual(plain(model.order(found, []).map((game) => !!game.recent)), [false, false, false]);
  },

  'a game found twice is shown once'() {
    const ordered = model.order([{ title: 'A', www: '/a' }, { title: 'A again', www: '/a' }], []);
    assert.strictEqual(ordered.length, 1);
  },

  'a folder shows a way up, its folders, and the files that can stand for a game'() {
    const rows = model.browse('/home/me/Games', ['Fear/', 'docs/', 'Game.exe', 'INDEX.HTML', 'package.json', 'readme.txt', 'song.ogg'], null, ['/home/me']);
    assert.deepStrictEqual(plain(rows), [
      { kind: 'up', label: '.. (up one folder)', path: '/home/me' },
      { kind: 'folder', label: 'Fear/', path: '/home/me/Games/Fear' },
      { kind: 'folder', label: 'docs/', path: '/home/me/Games/docs' },
      { kind: 'file', label: 'Game.exe', path: '/home/me/Games/Game.exe' },
      { kind: 'file', label: 'INDEX.HTML', path: '/home/me/Games/INDEX.HTML' },
      { kind: 'file', label: 'package.json', path: '/home/me/Games/package.json' },
    ]);
  },

  'in a game\'s own folder the first line adds that game'() {
    const rows = model.browse('/g/Fear', ['www/', 'Game.exe'], { title: 'Fear & Hunger', www: '/g/Fear/www' }, ['/g']);
    assert.deepStrictEqual(plain(rows[0]), { kind: 'game', label: 'Add this game: Fear & Hunger', path: '/g/Fear/www' });
    assert.strictEqual(rows[1].kind, 'up');
  },

  'the folder the browser starts from has no way up when it is the only one'() {
    const rows = model.browse('/sdcard', ['Download/'], null, ['/sdcard']);
    assert.deepStrictEqual(plain(rows.map((row) => row.kind)), ['folder']);
  },

  'with several starting folders, up from one of them leads to the list of them'() {
    const rows = model.browse('/home/me', ['Games/'], null, ['/home/me', '/']);
    assert.deepStrictEqual(plain(rows[0]), { kind: 'places', label: '.. (other places)', path: '' });
    assert.deepStrictEqual(plain(model.places(['/home/me', '/'])), [
      { kind: 'folder', label: '/home/me', path: '/home/me' },
      { kind: 'folder', label: '/', path: '/' },
    ]);
  },

  'up from a folder directly under the top of the file system leads to the top'() {
    const rows = model.browse('/mnt', ['mmc/'], null, ['/']);
    assert.strictEqual(rows[0].path, '/');
    assert.strictEqual(model.browse('/', ['mnt/'], null, ['/'])[0].path, '/mnt');
  },

  'a finger on the list is on the line drawn there, or on none'() {
    // Lines 62 high from 92 down, the list scrolled so that line 3 is on top, 7 lines in all.
    const layout = { top: 92, row: 62, first: 3, count: 7, visible: 5, left: 20, width: 560 };
    assert.strictEqual(model.lineAt(100, 93, layout), 3);
    assert.strictEqual(model.lineAt(100, 92 + 62 * 2 + 10, layout), 5);
    assert.strictEqual(model.lineAt(100, 80, layout), -1, 'above the list');
    assert.strictEqual(model.lineAt(100, 92 + 62 * 4 + 1, layout), -1, 'below the last line there is');
    assert.strictEqual(model.lineAt(10, 100, layout), -1, 'left of the list');
    assert.strictEqual(model.lineAt(600, 100, layout), -1, 'right of the list');
  },

  'dragging the list moves it by whole lines and stops at its ends'() {
    const layout = { top: 92, row: 62, first: 3, count: 12, visible: 5, left: 20, width: 560 };
    assert.strictEqual(model.dragged(layout, -62 * 2 - 5), 5, 'a finger moving up shows later lines');
    assert.strictEqual(model.dragged(layout, 62), 2);
    assert.strictEqual(model.dragged(layout, 62 * 20), 0);
    assert.strictEqual(model.dragged(layout, -62 * 20), 7, 'the last line stays at the bottom');
    assert.strictEqual(model.dragged({ top: 92, row: 62, first: 0, count: 3, visible: 5, left: 0, width: 9 }, -500), 0, 'a short list does not move');
  },

  'a touch that hardly moved is a tap; one that moved is a drag'() {
    assert.strictEqual(model.isTap(100, 200, 104, 195), true);
    assert.strictEqual(model.isTap(100, 200, 100, 230), false);
  },

  'touching a game chooses it, so that its picture shows; touching it again plays it'() {
    assert.strictEqual(model.tapOpens({ www: '/g/www', title: 'Game' }, false), false, 'the first touch only chooses');
    assert.strictEqual(model.tapOpens({ www: '/g/www', title: 'Game' }, true), true, 'a touch on the chosen game plays it');
  },

  'everything that is not a game opens at the first touch'() {
    assert.strictEqual(model.tapOpens({ add: true }, false), true);
    assert.strictEqual(model.tapOpens({ setting: true }, false), true);
    assert.strictEqual(model.tapOpens({ kind: 'folder', label: 'Games/', path: '/Games' }, false), true);
    assert.strictEqual(model.tapOpens({ kind: 'game', label: 'Add this game: X', path: '/g/www' }, false), true);
  },

  'the list is laid out for the window it is given, enlarged by whole factors on dense screens'() {
    assert.deepStrictEqual(plain(model.fit(640, 480)), { zoom: 1, width: 640, height: 480, column: 520 });
    assert.deepStrictEqual(plain(model.fit(2400, 1080)), { zoom: 2, width: 1200, height: 540, column: 600 });
    assert.deepStrictEqual(plain(model.fit(1920, 1080)), { zoom: 2, width: 960, height: 540, column: 520 });
    assert.deepStrictEqual(plain(model.fit(1224, 936)), { zoom: 1, width: 1224, height: 936, column: 612 });
  },

  'a small window gets a narrower column, never one wider than the window'() {
    assert.deepStrictEqual(plain(model.fit(400, 300)), { zoom: 1, width: 400, height: 300, column: 344 });
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
