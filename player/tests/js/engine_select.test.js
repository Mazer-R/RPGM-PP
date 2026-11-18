// Tests for js/engine-select.js, run with Node:
//   node tests/js/engine_select.test.js
//
// A game is either RPG Maker MV or MZ. The player tells which from the
// game's files. Every game gets the common layers; on top of them each
// engine has a profile, the list of extra browser pieces switched on for
// it. MV's profile is empty, so what is added for another engine cannot
// change how an MV game runs until a piece is put on MV's list on purpose.
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

  'an MZ game gets MV\'s layers and then the pieces of its profile'() {
    const layers = plain(select().layersFor('MZ', true));
    assert.deepStrictEqual(layers.slice(0, MV_LAYERS.length + 1), MV_LAYERS.concat('audio.js'));
    assert.deepStrictEqual(layers.slice(MV_LAYERS.length + 1), plain(select().PROFILES.MZ));
    assert.ok(select().PROFILES.MZ.length > 0);
  },

  'MV\'s profile switches no piece on'() {
    assert.deepStrictEqual(plain(select().PROFILES.MV), []);
  },

  'every piece of every profile is a file of the player, and none is one of the common layers'() {
    const { PROFILES } = select();
    Object.keys(PROFILES).forEach((engine) => plain(PROFILES[engine]).forEach((piece) => {
      assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'js', piece)), engine + ': ' + piece + ' does not exist');
      assert.ok(!MV_LAYERS.includes(piece) && piece !== 'audio.js', piece + ' is a common layer');
    }));
  },

  'no piece is left out of every profile'() {
    const used = new Set([].concat(...Object.values(plain(select().PROFILES))));
    const pieces = fs.readdirSync(path.join(__dirname, '..', '..', 'js'))
      .filter((file) => /^(web-.*|nw-.*|engine-tasks|mz-.*)\.js$/.test(file));
    pieces.forEach((piece) => assert.ok(used.has(piece), piece + ' is in no profile'));
  },

};

let failed = 0;
(async () => {
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log('ok   ' + name);
    } catch (error) {
      failed++;
      console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     '));
    }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
