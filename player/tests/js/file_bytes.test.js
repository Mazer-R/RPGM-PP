// Tests for js/file-bytes.js, run with Node:
//   node tests/js/file_bytes.test.js
//
// The module lets a block of bytes stand for a file, so that the engine can
// be given only the start of a large file and native code can still be told
// which file was meant. The tests go through the steps the engine takes with
// an "encrypted" file: check the marker, cut it off, unscramble what follows.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const heads = [];
  const sandbox = { player: { fileHead: (file, skip, bytes) => heads.push({ file, skip, bytes: Array.from(new Uint8Array(bytes)) }) } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'js', 'file-bytes.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  // Blocks of bytes are made inside the sandbox, as a game's would be.
  const block = (values) => vm.runInContext('new Uint8Array(' + JSON.stringify(values) + ').buffer', sandbox);
  return { browser: sandbox.__browser, heads, block };
}

// What the engine does to the bytes of an encrypted file: the first 16 bytes
// are a marker; the next 16 are the file's own, each XORed with a key byte.
function engineDecrypt(bytes, key) {
  const cut = bytes.slice(16, bytes.byteLength);
  const view = new Uint8Array(cut);
  for (let i = 0; i < 16; i++) view[i] ^= key[i];
  return cut;
}
const range = (from, count) => Array.from({ length: count }, (_, i) => (from + i) & 255);

const tests = {
  'bytes that came from nowhere stand for no file'() {
    const t = setup();
    assert.strictEqual(t.browser.fileBehind(t.block([1, 2, 3])), null);
    assert.deepStrictEqual(t.heads, []);
  },
  'bytes handed out for a file stand for it, and nothing is registered for an untouched file'() {
    const t = setup();
    const bytes = t.browser.bytesStandFor(t.block(range(0, 40)), '/game/audio/se/Door.ogg');
    assert.strictEqual(t.browser.fileBehind(bytes), '/game/audio/se/Door.ogg');
    assert.deepStrictEqual(t.heads, []);
  },
  'after the engine unscrambles an encrypted file, native code is told its true first bytes'() {
    const t = setup();
    const key = range(100, 16);
    const trueStart = range(1, 16);
    const onDisk = range(200, 16).concat(trueStart.map((b, i) => b ^ key[i]), range(50, 68));
    const given = t.browser.bytesStandFor(t.block(onDisk), '/game/img/system/Window.rpgmvp');
    const decrypted = engineDecrypt(given, key);
    assert.strictEqual(t.browser.fileBehind(decrypted), '/game/img/system/Window.rpgmvp');
    assert.strictEqual(t.heads.length, 1);
    assert.strictEqual(t.heads[0].file, '/game/img/system/Window.rpgmvp');
    assert.strictEqual(t.heads[0].skip, 16);
    assert.deepStrictEqual(t.heads[0].bytes.slice(0, 16), trueStart);
    // Bytes past the scrambled part are the file's own, unchanged.
    assert.deepStrictEqual(t.heads[0].bytes.slice(16), range(50, 48));
    assert.strictEqual(t.heads[0].bytes.length, 64);
  },
  'a short block registers only the bytes it has'() {
    const t = setup();
    const given = t.browser.bytesStandFor(t.block(range(0, 40)), '/game/a.rpgmvp');
    t.browser.fileBehind(engineDecrypt(given, range(0, 16)));
    assert.strictEqual(t.heads[0].bytes.length, 24);
  },
  'cutting twice adds up, and a cut counted from the end is understood'() {
    const t = setup();
    const given = t.browser.bytesStandFor(t.block(range(0, 100)), '/game/a.rpgmvp');
    t.browser.fileBehind(given.slice(10).slice(6));
    assert.strictEqual(t.heads[0].skip, 16);
    t.browser.fileBehind(given.slice(-30));
    assert.strictEqual(t.heads[1].skip, 70);
  },
  'cutting still gives the bytes asked for'() {
    const t = setup();
    const given = t.browser.bytesStandFor(t.block(range(0, 10)), '/game/a.bin');
    assert.deepStrictEqual(Array.from(new Uint8Array(given.slice(2, 5))), [2, 3, 4]);
    assert.deepStrictEqual(Array.from(new Uint8Array(t.block([7, 8, 9]).slice(1))), [8, 9]);
  },
  'a typed view over such bytes stands for the same file'() {
    const t = setup();
    const given = t.browser.bytesStandFor(t.block(range(0, 100)), '/game/a.rpgmvp');
    const cut = given.slice(16);
    assert.strictEqual(t.browser.fileBehind(new Uint8Array(cut)), '/game/a.rpgmvp');
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message); }
}
console.log(failed ? failed + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(failed ? 1 : 0);
