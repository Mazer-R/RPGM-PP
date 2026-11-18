// The avatar: the user's potato, a character with a piece, or none, in each
// of its slots. This file holds every piece there is and decides which
// ones a user has and what the avatar wears. It draws nothing. Loaded by
// the game list after js/achievements-model.js, which says which
// achievement gives which piece; tested in tests/js/avatar_model.test.js.
(function () {
  'use strict';
  var achievements = globalThis.__achievements;

  // What each slot is called on the screen.
  var LABELS = { character: 'Potato', clothes: 'Clothes', head: 'Head', face: 'Face', weapon: 'Hand', accessory: 'Extra', companion: 'Companion' };

  // Every piece, by slot, in the order they are offered. `base` marks the
  // ones everybody has from the start; the others are given by an
  // achievement (PRIZES in js/achievements-model.js). An empty id is the
  // slot left empty, where that is allowed.
  function base(id, name) { return { id: id, name: name, base: true }; }
  function prize(id, name) { return { id: id, name: name, base: false }; }
  var CATALOGUE = {
    character: [base('potato', 'Potato'), base('wrinkled', 'Wrinkled potato'), base('fry', 'French fry'), base('chip', 'Potato chip'),
      prize('sweet-potato', 'Sweet potato'), prize('avocado', 'Weird Potato'), prize('golden-potato', 'Golden potato')],
    clothes: [base('burlap-sack', 'Burlap sack'), prize('pyjamas', 'Pyjamas'), prize('tuxedo', 'Tuxedo')],
    head: [base('', 'None'), base('helmet', 'Helmet'), base('wizard-hat', 'Wizard hat'), base('hood', 'Hood'),
      prize('peeled-top', 'Peeled'), prize('pork-pie-hat', 'Pork pie hat'), prize('white-wig', 'White wig'), prize('nightcap', 'Nightcap'),
      prize('popcorn-bucket-hat', 'Popcorn bucket'), prize('crown', 'Crown'), prize('tinfoil-hat', 'Tinfoil hat')],
    face: [base('', 'None'), prize('goatee', 'Goatee'), prize('scholar-glasses', 'Scholar\'s glasses')],
    weapon: [base('', 'None'), base('sword', 'Sword'), base('staff', 'Staff'), base('bow', 'Bow'),
      prize('quill', 'Quill'), prize('beer-mug', 'Beer mug'), prize('popcorn-bucket', 'Popcorn bucket'), prize('sceptre', 'Sceptre'),
      prize('spoon', 'Spoon'), prize('shovel', 'Shovel')],
    accessory: [base('', 'None'), base('shield', 'Shield'), base('cape', 'Cape'), base('quiver', 'Quiver'),
      prize('wings', 'Wings'), prize('two-shields', 'Two shields'), prize('heart', 'Heart'),
      prize('perfectly-normal-scarf', 'Perfectly Normal Scarf')],
    companion: [base('', 'Nobody'), prize('sprout-pot', 'Sprout in a pot'), prize('little-fry', 'Little fry'),
      prize('little-knight', 'Little knight'), prize('potato-chick', 'Potato chick'), prize('little-alien', 'Little alien'),
      prize('little-wizard', 'Little wizard')],
  };

  // The pieces of a slot a user has, given the achievements earned: the
  // starting ones and the ones given, in the catalogue's order.
  function owned(slot, earned) {
    var given = {};
    achievements.unlocked(earned).forEach(function (piece) { if (piece.slot === slot) given[piece.item] = true; });
    return CATALOGUE[slot].filter(function (piece) { return piece.base || given[piece.id]; });
  }
  // What a slot holds when nothing has been chosen for it.
  function starting(slot) { return achievements.DRESSED[slot] || CATALOGUE[slot][0].id; }

  // The avatar as it is to be shown: every slot filled in, and any piece
  // the user does not have (or that no longer exists) put back to the
  // starting one.
  function dressed(avatar, earned) {
    var whole = {};
    achievements.SLOTS.forEach(function (slot) {
      var has = owned(slot, earned).some(function (piece) { return piece.id === avatar[slot]; });
      whole[slot] = has ? avatar[slot] : starting(slot);
    });
    return whole;
  }

  // The piece after (`by` 1) or before (-1) the one a slot holds, among the
  // ones the user has, going round at the ends.
  function next(current, slot, by, earned) {
    var mine = owned(slot, earned), at = -1;
    mine.forEach(function (piece, i) { if (piece.id === current) at = i; });
    if (at < 0) return mine[by > 0 ? Math.min(1, mine.length - 1) : mine.length - 1].id;
    return mine[(at + by + mine.length) % mine.length].id;
  }

  function nameOf(slot, id) {
    var found = CATALOGUE[slot].filter(function (piece) { return piece.id === id; })[0];
    return found ? found.name : '';
  }

  // --- The name -----------------------------------------------------------------
  // Typed on a small board of letters, which works with a pad and with a
  // finger alike: the letters, then a space, deleting and being done.
  var LONGEST_NAME = 12;
  var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['-', 'space', 'del', 'ok']);
  function typed(name, key) {
    if (key === 'del') return name.slice(0, -1);
    if (key === 'ok') return name;
    return name.length >= LONGEST_NAME ? name : name + (key === 'space' ? ' ' : key);
  }
  function tidyName(name) { return String(name || '').slice(0, LONGEST_NAME).trim(); }

  globalThis.__avatar = { LABELS: LABELS, CATALOGUE: CATALOGUE, owned: owned, dressed: dressed, next: next, nameOf: nameOf,
    KEYS: KEYS, typed: typed, tidyName: tidyName, LONGEST_NAME: LONGEST_NAME };
})();
