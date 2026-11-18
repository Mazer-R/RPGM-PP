// Tests for js/avatar-model.js, run with Node:
//   node tests/js/avatar_model.test.js
//
// The avatar is a character with a piece, or none, in each of its slots.
// The module holds every piece there is, says which ones a user has (the
// ones everybody starts with and the ones the achievements gave) and moves
// the choice of a slot from one piece to the next.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const name of ['achievements-model.js', 'avatar-model.js']) {
  const file = path.join(__dirname, '..', '..', 'js', name);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}
const model = sandbox.__avatar, achievements = sandbox.__achievements;
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (slot, earned) => plain(model.owned(slot, earned || [])).map((piece) => piece.id);

const tests = {
  'everybody starts with four characters, a sack, and three pieces for the head, the hand and the back'() {
    assert.deepStrictEqual(ids('character'), ['potato', 'wrinkled', 'fry', 'chip']);
    assert.deepStrictEqual(ids('clothes'), ['burlap-sack']);
    assert.deepStrictEqual(ids('head'), ['', 'helmet', 'wizard-hat', 'hood']);
    assert.deepStrictEqual(ids('face'), ['']);
    assert.deepStrictEqual(ids('weapon'), ['', 'sword', 'staff', 'bow']);
    assert.deepStrictEqual(ids('accessory'), ['', 'shield', 'cape', 'quiver']);
    assert.deepStrictEqual(ids('companion'), ['']);
  },

  'an achievement adds its pieces to the ones a user has'() {
    assert.deepStrictEqual(ids('head', ['named']), ['', 'helmet', 'wizard-hat', 'hood', 'pork-pie-hat']);
    assert.deepStrictEqual(ids('face', ['named']), ['', 'goatee']);
    assert.deepStrictEqual(ids('character', ['sweet-spot', 'not-a-potato']), ['potato', 'wrinkled', 'fry', 'chip', 'sweet-potato', 'avocado']);
    assert.deepStrictEqual(ids('companion', ['good-company', 'first-sprout']), ['', 'sprout-pot', 'little-knight']);
  },

  'every piece an achievement gives is in the catalogue, in the slot it is given for, with a name'() {
    for (const [id, pieces] of Object.entries(achievements.PRIZES)) {
      for (const piece of pieces) {
        const found = model.CATALOGUE[piece.slot].filter((each) => each.id === piece.item);
        assert.strictEqual(found.length, 1, id + ' gives ' + piece.item);
        assert.ok(!found[0].base, piece.item + ' is given, so it is not a starting piece');
      }
    }
    for (const slot of achievements.SLOTS) {
      for (const piece of model.CATALOGUE[slot]) assert.ok(piece.name, slot + ' ' + piece.id);
    }
    assert.deepStrictEqual(Object.keys(model.CATALOGUE), plain(achievements.SLOTS));
  },

  'every piece that is not a starting one is given by some achievement'() {
    const given = new Set(Object.values(achievements.PRIZES).flat().map((piece) => piece.slot + ':' + piece.item));
    for (const slot of achievements.SLOTS) {
      for (const piece of model.CATALOGUE[slot]) if (!piece.base) assert.ok(given.has(slot + ':' + piece.id), slot + ' ' + piece.id);
    }
  },

  'a new avatar is the plain potato in its sack, with nothing else'() {
    assert.deepStrictEqual(plain(model.dressed({}, [])),
      { character: 'potato', clothes: 'burlap-sack', head: '', face: '', weapon: '', accessory: '', companion: '' });
  },

  'a piece the user does not have, or that does not exist, is put back to the starting one'() {
    const avatar = model.dressed({ character: 'avocado', head: 'crown', weapon: 'sword', face: 'no-such-thing' }, []);
    assert.strictEqual(avatar.character, 'potato');
    assert.strictEqual(avatar.head, '');
    assert.strictEqual(avatar.weapon, 'sword');
    assert.strictEqual(avatar.face, '');
    assert.strictEqual(model.dressed({ character: 'avocado' }, ['not-a-potato']).character, 'avocado');
  },

  'the choice of a slot goes to the next piece the user has, and round'() {
    assert.strictEqual(model.next('', 'head', 1, []), 'helmet');
    assert.strictEqual(model.next('hood', 'head', 1, []), '');
    assert.strictEqual(model.next('', 'head', -1, []), 'hood');
    assert.strictEqual(model.next('hood', 'head', 1, ['named']), 'pork-pie-hat');
    assert.strictEqual(model.next('burlap-sack', 'clothes', 1, []), 'burlap-sack');
    assert.strictEqual(model.next('gone', 'head', 1, []), 'helmet');
  },

  'a slot and a piece have names to show'() {
    assert.strictEqual(model.nameOf('head', ''), 'None');
    assert.strictEqual(model.nameOf('companion', ''), 'Nobody');
    assert.strictEqual(model.nameOf('head', 'wizard-hat'), 'Wizard hat');
    assert.strictEqual(model.nameOf('accessory', 'perfectly-normal-scarf'), 'Perfectly Normal Scarf');
    assert.strictEqual(model.nameOf('character', 'avocado'), 'Weird Potato');
    assert.deepStrictEqual(plain(model.LABELS),
      { character: 'Potato', clothes: 'Clothes', head: 'Head', face: 'Face', weapon: 'Hand', accessory: 'Extra', companion: 'Companion' });
  },

  'a name is kept short and tidy'() {
    assert.strictEqual(model.tidyName('  Manel  '), 'Manel');
    assert.strictEqual(model.tidyName('A VERY LONG NAME INDEED'), 'A VERY LONG');
    assert.strictEqual(model.tidyName('   '), '');
    assert.strictEqual(model.typed('MAN', 'E'), 'MANE');
    assert.strictEqual(model.typed('MAN', 'del'), 'MA');
    assert.strictEqual(model.typed('', 'del'), '');
    assert.strictEqual(model.typed('ABCDEFGHIJKL', 'M'), 'ABCDEFGHIJKL');
    assert.strictEqual(model.typed('MAN', 'space'), 'MAN ');
    assert.strictEqual(model.KEYS.length, 30);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
