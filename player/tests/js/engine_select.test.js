// Tests for js/engine-select.js and js/mz.js, run with Node:
//   node tests/js/engine_select.test.js
//
// A game is either RPG Maker MV or MZ. The player tells which from the
// game's files and loads a different set of layers for each, so that what
// is done for MZ cannot change how an MV game runs.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(file, sandbox) {
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const full = path.join(__dirname, '..', '..', 'js', file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: full });
  return sandbox;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const select = () => load('engine-select.js', {}).__engineSelect;
const filesOf = (...files) => (file) => files.includes(file);

// The layers an MV game was given before MZ existed here, in their order.
const MV_LAYERS = ['file-bytes.js', 'css.js', 'video.js', 'dom.js', 'canvas2d.js', 'desktop.js', 'patch-select.js'];

const tests = {
  'a game with MV\'s core script is MV'() {
    assert.strictEqual(select().engineOf('/g/www', filesOf('/g/www/js/rpg_core.js')), 'MV');
  },

  'a game with MZ\'s core script is MZ'() {
    assert.strictEqual(select().engineOf('/g', filesOf('/g/js/rmmz_core.js')), 'MZ');
  },

  'a game with neither is treated as MV, as before'() {
    assert.strictEqual(select().engineOf('/g/www', filesOf()), 'MV');
  },

  'an MV game gets exactly the layers it always had'() {
    assert.deepStrictEqual(plain(select().layersFor('MV', false)), MV_LAYERS);
    assert.deepStrictEqual(plain(select().layersFor('MV', true)), MV_LAYERS.concat('audio.js'));
  },

  'an MZ game gets the same layers and then its own, last'() {
    const layers = plain(select().layersFor('MZ', true));
    assert.deepStrictEqual(layers.slice(0, MV_LAYERS.length + 1), MV_LAYERS.concat('audio.js'));
    const own = layers.slice(MV_LAYERS.length + 1);
    assert.ok(own.length > 0 && own[own.length - 1] === 'mz.js', 'mz.js is loaded last');
    own.forEach((layer) => assert.ok(!MV_LAYERS.includes(layer), layer + ' is not one of MV\'s'));
  },

  'under MZ the load event waits for what the page had already asked for'() {
    const order = [], tasks = [];
    const browser = { later: (fn) => tasks.push(fn), fireLoad: () => order.push('load') };
    load('mz.js', { __browser: browser });
    browser.later(() => order.push('file answer'));
    browser.fireLoad();
    assert.deepStrictEqual(order, [], 'nothing fires at once');
    while (tasks.length) tasks.shift()();
    assert.deepStrictEqual(order, ['file answer', 'load']);
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
