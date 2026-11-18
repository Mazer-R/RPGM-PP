// Tests for js/base64.js, run with Node:
//   node tests/js/base64.test.js
//
// The module gives scripts the browser's atob and btoa. RPG Maker MZ's sound
// decoder library carries its WebAssembly code as base64 text and calls atob
// while it loads.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'js', 'base64.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox;
}

const tests = {
  'atob gives back the bytes, one character each'() {
    const { atob } = setup();
    assert.strictEqual(atob('aGVsbG8='), 'hello');
    assert.strictEqual(atob('AP+A'), '\u0000ÿ\u0080');
    assert.strictEqual(atob(''), '');
  },

  'atob takes text without its padding and with white space in it'() {
    const { atob } = setup();
    assert.strictEqual(atob('aGVsbG8'), 'hello');
    assert.strictEqual(atob('aGVs\nbG8=\n'), 'hello');
  },

  'atob refuses text that is not base64'() {
    const { atob } = setup();
    assert.throws(() => atob('a*b='), /not correctly encoded/);
    assert.throws(() => atob('a'), /not correctly encoded/);
  },

  'btoa is the reverse, for every byte'() {
    const { atob, btoa } = setup();
    let all = '';
    for (let i = 0; i < 256; i++) all += String.fromCharCode(i);
    assert.strictEqual(btoa('hello'), 'aGVsbG8=');
    assert.strictEqual(btoa('hi'), 'aGk=');
    assert.strictEqual(atob(btoa(all)), all);
    assert.strictEqual(btoa(all), Buffer.from(all, 'latin1').toString('base64'));
  },

  'btoa refuses characters that are not single bytes'() {
    const { btoa } = setup();
    assert.throws(() => btoa('Ā'), /outside of the Latin1 range/);
  },

  'a game\'s own atob or btoa is left alone'() {
    const sandbox = { atob: () => 'theirs' };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const file = path.join(__dirname, '..', '..', 'js', 'base64.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    assert.strictEqual(sandbox.atob('aGk='), 'theirs');
    assert.strictEqual(sandbox.btoa('hi'), 'aGk=');
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
