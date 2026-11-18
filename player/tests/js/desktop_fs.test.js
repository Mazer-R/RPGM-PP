// Tests for the file module of js/desktop.js, run with Node:
//   node tests/js/desktop_fs.test.js
//
// A game saves through Node's `fs`. MV writes a save file and nothing more.
// MZ keeps the previous file aside while it writes the new one: it renames
// the save to a backup name, writes, and removes the backup; when the write
// fails it puts the backup back. These tests make the calls MZ makes, over a
// stand-in for the native side that keeps the files in memory and, like the
// real one, touches nothing outside the game's save folder.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME = '/games/Demo';

function desktop() {
  const files = new Map();
  const inSave = (p) => p === GAME + '/save' || p.indexOf(GAME + '/save/') === 0;
  const sandbox = {
    __browser: { missing() {} },
    window: { close() {}, innerWidth: 816, innerHeight: 624 },
    player: {
      gameDir: GAME,
      fileExists: (p) => files.has(p),
      readTextFile: (p) => (files.has(p) ? files.get(p) : null),
      writeSaveFile: (p, text) => inSave(p) && !sandbox.player.failWrites && (files.set(p, text), true),
      removeSaveFile: (p) => inSave(p) && files.delete(p),
      renameSaveFile: (from, to) => {
        if (!inSave(from) || !inSave(to) || !files.has(from)) return false;
        files.set(to, files.get(from));
        files.delete(from);
        return true;
      },
      makeSaveDir: (p) => inSave(p),
      exit() {},
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'js', 'desktop.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return { fs: sandbox.require('fs'), files, player: sandbox.player };
}

// StorageManager.saveToLocalFile of MZ, with its helpers written out.
function saveAsMz(nodeFs, filePath, data) {
  const backup = filePath + '_';
  const unlink = (p) => { if (nodeFs.existsSync(p)) nodeFs.unlinkSync(p); };
  const rename = (from, to) => { if (nodeFs.existsSync(from)) nodeFs.renameSync(from, to); };
  unlink(backup);
  rename(filePath, backup);
  try {
    nodeFs.writeFileSync(filePath, data);
    unlink(backup);
  } catch (e) {
    try {
      unlink(filePath);
      rename(backup, filePath);
    } catch (e2) {
      //
    }
    throw e;
  }
}

const SLOT = GAME + '/save/file1.rmmzsave';

const tests = {
  'a first save the way MZ makes it leaves the file and no backup'() {
    const d = desktop();
    saveAsMz(d.fs, SLOT, 'first');
    assert.strictEqual(d.fs.readFileSync(SLOT, { encoding: 'utf8' }), 'first');
    assert.strictEqual(d.fs.existsSync(SLOT + '_'), false);
  },

  'a second save to the same slot replaces the first'() {
    const d = desktop();
    saveAsMz(d.fs, SLOT, 'first');
    saveAsMz(d.fs, SLOT, 'second');
    assert.strictEqual(d.fs.readFileSync(SLOT, { encoding: 'utf8' }), 'second');
    assert.strictEqual(d.fs.existsSync(SLOT + '_'), false);
  },

  'when the write fails, the earlier save is put back'() {
    const d = desktop();
    saveAsMz(d.fs, SLOT, 'first');
    d.player.failWrites = true;
    assert.throws(() => saveAsMz(d.fs, SLOT, 'second'));
    assert.strictEqual(d.fs.readFileSync(SLOT, { encoding: 'utf8' }), 'first');
    assert.strictEqual(d.fs.existsSync(SLOT + '_'), false);
  },

  'a rename out of the save folder is refused'() {
    const d = desktop();
    saveAsMz(d.fs, SLOT, 'first');
    assert.throws(() => d.fs.renameSync(SLOT, GAME + '/data/System.json'), (e) => e.code === 'EACCES');
    assert.strictEqual(d.fs.readFileSync(SLOT, { encoding: 'utf8' }), 'first');
  },

  'renaming a file that is not there fails as Node fails'() {
    const d = desktop();
    assert.throws(() => d.fs.renameSync(GAME + '/save/none', GAME + '/save/other'), (e) => e.code === 'ENOENT');
  },

  'a path relative to the game folder names the same file'() {
    const d = desktop();
    d.fs.writeFileSync('save/config.rmmzsave', 'a');
    d.fs.renameSync('save/config.rmmzsave', 'save/config.rmmzsave_');
    assert.deepStrictEqual([...d.files.keys()], [GAME + '/save/config.rmmzsave_']);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log('ok   ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + String(error && error.message).split('\n').join('\n     '));
  }
}
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
