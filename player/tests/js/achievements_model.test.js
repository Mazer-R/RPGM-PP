// Tests for js/achievements-model.js, run with Node:
//   node tests/js/achievements_model.test.js
//
// The module holds the achievements and decides which ones a player has,
// from the counts the player keeps (games on the list, seconds played, saves
// written and so on). It draws nothing and reads no file.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const file = path.join(__dirname, '..', '..', 'js', 'achievements-model.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const model = sandbox.__achievements;
const plain = (value) => JSON.parse(JSON.stringify(value));
const HOUR = 3600;
const ids = (stats, before) => plain(model.update(before || [], stats).earned);

const tests = {
  'someone who has done nothing has no achievement'() {
    assert.deepStrictEqual(ids({}), []);
    assert.deepStrictEqual(ids(model.blank()), []);
  },

  'games on the list earn the collection, one step at a time'() {
    assert.deepStrictEqual(ids({ games: 1 }), ['first-sprout']);
    assert.deepStrictEqual(ids({ games: 5 }), ['first-sprout', 'small-harvest']);
    assert.deepStrictEqual(ids({ games: 10 }), ['first-sprout', 'small-harvest', 'full-sack']);
    assert.deepStrictEqual(ids({ games: 25 }), ['first-sprout', 'small-harvest', 'full-sack', 'potato-farm']);
  },

  'hours played earn their four steps, and not a second early'() {
    assert.deepStrictEqual(ids({ seconds: HOUR - 1 }), []);
    assert.deepStrictEqual(ids({ seconds: HOUR }), ['warm-up']);
    assert.deepStrictEqual(ids({ seconds: 5 * HOUR }), ['warm-up', 'slow-cooked']);
    assert.deepStrictEqual(ids({ seconds: 25 * HOUR }), ['warm-up', 'slow-cooked', 'well-done']);
    assert.deepStrictEqual(ids({ seconds: 100 * HOUR }), ['warm-up', 'slow-cooked', 'well-done', 'baked-through']);
  },

  'an achievement once earned is kept when the count goes back down'() {
    assert.deepStrictEqual(ids({ games: 0 }, ['first-sprout']), ['first-sprout']);
  },

  'update says which ones are new, in the order of the list'() {
    const result = model.update(['first-sprout'], { games: 5, saves: 1 });
    assert.deepStrictEqual(plain(result.fresh), ['small-harvest', 'dear-diary']);
    assert.deepStrictEqual(plain(result.earned), ['first-sprout', 'small-harvest', 'dear-diary']);
    assert.deepStrictEqual(plain(model.update(result.earned, { games: 5, saves: 1 }).fresh), []);
  },

  'an achievement the list no longer has is dropped from what was earned'() {
    assert.deepStrictEqual(ids({}, ['gone-in-a-later-version', 'first-sprout']), ['first-sprout']);
  },

  'both engines played is one achievement, one engine is none'() {
    assert.deepStrictEqual(ids({ playedMv: true }), []);
    assert.deepStrictEqual(ids({ playedMv: true, playedMz: true }), ['two-kinds']);
  },

  'the whole party needs one achievement of each of the three heroes'() {
    // warm-up is the knight's, tinkerer the wizard's, first-sprout the archer's.
    assert.deepStrictEqual(ids({ seconds: HOUR, settingsOpened: true }), ['warm-up', 'tinkerer']);
    assert.deepStrictEqual(ids({ seconds: HOUR, settingsOpened: true, games: 1 }), ['first-sprout', 'warm-up', 'tinkerer', 'whole-party']);
  },

  'completionist is earned with every other achievement, and only then'() {
    const others = model.LIST.filter((each) => each.id !== 'completionist').map((each) => each.id);
    assert.ok(!ids({}, others.slice(1)).includes('completionist'));
    assert.ok(ids({}, others).includes('completionist'));
  },

  'every achievement has a name, a way to earn it, a metal and a hero, and no id twice'() {
    const seen = new Set();
    for (const each of model.LIST) {
      assert.ok(/^[a-z-]+$/.test(each.id), each.id);
      assert.ok(!seen.has(each.id), 'twice: ' + each.id);
      seen.add(each.id);
      assert.ok(each.name && each.how, each.id);
      assert.ok(['bronze', 'silver', 'gold'].includes(each.metal), each.id);
      assert.ok(['knight', 'wizard', 'archer', 'party'].includes(each.hero), each.id);
    }
    assert.strictEqual(model.LIST.length, 39);
  },

  'a secret achievement does not say how it is earned until it is'() {
    const secret = model.LIST.filter((each) => each.secret).map((each) => each.id);
    assert.deepStrictEqual(plain(secret), ['not-a-potato', 'aliens']);
    assert.strictEqual(model.shown('not-a-potato', []).how, '???');
    assert.strictEqual(model.shown('not-a-potato', []).name, '???');
    assert.strictEqual(model.shown('not-a-potato', ['not-a-potato']).name, 'Notato');
    assert.strictEqual(model.shown('warm-up', []).name, 'Warm Up');
  },

  'some achievements give the avatar something: a hat and a goatee for the name, a character for the secret'() {
    assert.deepStrictEqual(plain(model.unlocked([])), []);
    assert.deepStrictEqual(plain(model.unlocked(['warm-up'])), []);
    assert.deepStrictEqual(plain(model.unlocked(['named', 'not-a-potato'])),
      [{ slot: 'head', item: 'pork-pie-hat' }, { slot: 'face', item: 'goatee' }, { slot: 'character', item: 'avocado' }]);
    for (const [id, pieces] of Object.entries(model.PRIZES)) {
      assert.ok(model.LIST.some((each) => each.id === id), id);
      for (const piece of pieces) assert.ok(plain(model.SLOTS).includes(piece.slot), id + ': ' + piece.slot);
    }
    assert.deepStrictEqual(plain(model.SLOTS), ['character', 'clothes', 'head', 'face', 'weapon', 'accessory', 'companion']);
  },

  'whoever uses the player before 2028 is early, and gets wings for it'() {
    assert.strictEqual(model.isEarly(new Date(2026, 10, 18)), true);
    assert.strictEqual(model.isEarly(new Date(2027, 11, 31, 23, 59)), true);
    assert.strictEqual(model.isEarly(new Date(2028, 0, 1)), false);
    assert.deepStrictEqual(plain(model.unlocked(['early-birdtato'])),
      [{ slot: 'accessory', item: 'wings' }, { slot: 'companion', item: 'potato-chick' }]);
    assert.deepStrictEqual(plain(model.unlocked(['first-sprout'])), [{ slot: 'companion', item: 'sprout-pot' }]);
    assert.deepStrictEqual(plain(model.unlocked(['dressed-up'])), [{ slot: 'clothes', item: 'tuxedo' }]);
    assert.deepStrictEqual(plain(model.unlocked(['dug-up'])), [{ slot: 'weapon', item: 'shovel' }]);
    assert.deepStrictEqual(plain(model.unlocked(['two-kinds'])), [{ slot: 'companion', item: 'little-fry' }]);
    assert.deepStrictEqual(plain(model.unlocked(['regular-customer'])), [{ slot: 'weapon', item: 'beer-mug' }]);
    assert.deepStrictEqual(plain(model.unlocked(['wrinkled'])), [{ slot: 'companion', item: 'little-wizard' }]);
    assert.deepStrictEqual(plain(model.unlocked(['peeled'])), [{ slot: 'head', item: 'peeled-top' }]);
    assert.deepStrictEqual(plain(model.unlocked(['aliens'])), [{ slot: 'head', item: 'tinfoil-hat' }, { slot: 'companion', item: 'little-alien' }]);
    assert.deepStrictEqual(plain(model.unlocked(['dear-diary', 'precious-memories', 'better-safe'])),
      [{ slot: 'weapon', item: 'quill' }, { slot: 'face', item: 'scholar-glasses' }, { slot: 'accessory', item: 'two-shields' }]);
    assert.deepStrictEqual(plain(model.unlocked(['midnight-snack'])), [{ slot: 'clothes', item: 'pyjamas' }, { slot: 'head', item: 'nightcap' }]);
    assert.deepStrictEqual(plain(model.unlocked(['movie-night'])), [{ slot: 'weapon', item: 'popcorn-bucket' }, { slot: 'head', item: 'popcorn-bucket-hat' }]);
    assert.deepStrictEqual(plain(model.unlocked(['true-potato'])), [{ slot: 'head', item: 'crown' }, { slot: 'weapon', item: 'sceptre' }]);
    assert.deepStrictEqual(plain(model.unlocked(['mashed', 'loyal-spud', 'completionist'])),
      [{ slot: 'accessory', item: 'heart' }, { slot: 'weapon', item: 'spoon' }, { slot: 'character', item: 'golden-potato' }]);
    assert.deepStrictEqual(plain(model.unlocked(['number-cruncher'])), [{ slot: 'head', item: 'white-wig' }]);
    assert.deepStrictEqual(plain(model.unlocked(['good-company'])), [{ slot: 'companion', item: 'little-knight' }]);
  },

  'the avatar starts dressed in a burlap sack, and with nothing in the other slots'() {
    assert.deepStrictEqual(plain(model.DRESSED), { clothes: 'burlap-sack' });
    for (const slot of Object.keys(model.DRESSED)) assert.ok(plain(model.SLOTS).includes(slot), slot);
  },

  'achievements are worth points by their metal: bronze one, silver two, gold four'() {
    assert.strictEqual(model.points([]), 0);
    assert.strictEqual(model.points(['warm-up']), 1);            // bronze
    assert.strictEqual(model.points(['warm-up', 'slow-cooked']), 3);   // and a silver
    assert.strictEqual(model.points(['warm-up', 'slow-cooked', 'baked-through']), 7);   // and a gold
    assert.strictEqual(model.points(['gone-in-a-later-version']), 0);
    assert.strictEqual(model.points(model.LIST.map((each) => each.id)), 87);
  },

  'twenty points from other achievements earn Sweet Spot, which gives the sweet potato'() {
    // four golds and a silver make 18
    const eighteen = ['potato-farm', 'baked-through', 'wrinkled', 'whole-party', 'slow-cooked'];
    assert.strictEqual(model.points(eighteen), 18);
    assert.ok(!ids({}, eighteen).includes('sweet-spot'));
    const twenty = ids({}, eighteen.concat(['well-done']));
    assert.ok(twenty.includes('sweet-spot'));
    assert.deepStrictEqual(plain(model.update(eighteen, { seconds: 25 * HOUR }).fresh), ['warm-up', 'well-done', 'sweet-spot']);
    assert.deepStrictEqual(plain(model.unlocked(['sweet-spot'])), [{ slot: 'character', item: 'sweet-potato' }]);
    // its own points do not count towards itself
    assert.ok(!ids({}, ['potato-farm', 'baked-through', 'wrinkled', 'whole-party', 'sweet-spot'].slice(0, 4)).includes('sweet-spot'));
  },

  'each flag or count earns its own achievement and no other'() {
    const single = {
      removed: 'peeled', longestSession: 'couch-potato', shortSession: 'just-a-bite', days: 'regular-customer',
      nightSession: 'midnight-snack', mostInOneGame: 'loyal-spud', saves: 'dear-diary', quickSaves: 'better-safe',
      loadedOlderSave: 'welcome-back', settingsOpened: 'tinkerer', counterShown: 'number-cruncher', remapped: 'remapped',
      pointerUsed: 'point-taken', controlsOff: 'hands-off', videoSeen: 'movie-night', slowSession: 'true-potato',
      crashed: 'mashed', carriedOn: 'missing-ingredients', waited: 'good-company', cameBack: 'wrinkled',
      dug: 'dug-up', dressed: 'dressed-up', named: 'named', notAGame: 'not-a-potato', early: 'early-birdtato', aliens: 'aliens',
    };
    const enough = { longestSession: 2 * HOUR, days: 7, mostInOneGame: 10 * HOUR, saves: 1 };
    for (const [key, id] of Object.entries(single)) {
      assert.deepStrictEqual(ids({ [key]: enough[key] || true }), [id], key);
    }
    assert.deepStrictEqual(ids({ saves: 100 }), ['dear-diary', 'precious-memories']);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
