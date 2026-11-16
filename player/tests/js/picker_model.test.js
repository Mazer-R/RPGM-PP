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
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
