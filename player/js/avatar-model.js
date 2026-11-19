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

  // --- Drawing it ----------------------------------------------------------------
  // Each character has a sheet of pictures (js/avatar-<character>.png): its
  // body, itself wearing each piece with the body taken away, and, for a
  // piece on the head or the body, what that piece hides of the body
  // (`<piece>-erase`), so that the body does not show beside a hat narrower
  // than its head. The avatar is those pictures put down one over another.
  // `has(name)` says whether the sheet has a picture; a piece without one
  // is left out. Each layer is the picture's name and whether it is taken
  // away from what is there instead of put over it.
  var BEHIND = { cape: true, wings: true };
  function layers(wearing, has) {
    var list = [{ name: 'base', erase: false }];
    function put(name, erase) { if (name && has(name)) list.push({ name: name, erase: !!erase }); }
    function hides(piece) { if (piece && has(piece)) put(piece + '-erase', true); }
    var behind = BEHIND[wearing.accessory];
    hides(wearing.clothes);
    hides(wearing.head);
    if (behind) put(wearing.accessory);
    put(wearing.clothes);
    put(wearing.face);
    put(wearing.head);
    if (!behind) put(wearing.accessory);
    put(wearing.weapon);
    return list;
  }
  // Where a picture is on a sheet: the pictures are cells of one size, in
  // rows of `columns`, in the order of `names`. Null if it is not there.
  function cellOf(sheet, names, name) {
    var at = names.indexOf(name);
    if (at < 0) return null;
    return { x: (at % sheet.columns) * sheet.cell[0], y: Math.floor(at / sheet.columns) * sheet.cell[1], w: sheet.cell[0], h: sheet.cell[1] };
  }

  // --- The name -----------------------------------------------------------------
  // Typed on a board of letters laid out like a keyboard, so that each
  // letter is where the hand expects it; it works with a pad and with a
  // finger alike. The board is ten keys across; `span` is how many of them
  // a key takes and `start` where it begins.
  var LONGEST_NAME = 12;
  var BOARD = ['QWERTYUIOP'.split(''), 'ASDFGHJKLÑ'.split(''), 'ZXCVBNM-'.split('').concat([['del', 2]]), [['space', 7], ['ok', 3]]]
    .map(function (row) {
      var start = 0;
      return row.map(function (each) {
        var key = { key: each[0].length > 1 ? each[0] : each, start: start, span: each[0].length > 1 ? each[1] : 1 };
        start += key.span;
        return key;
      });
    });
  function boardKey(at) { return BOARD[at.row][at.index].key; }
  // The key at `across` (in keys from the left, with fractions) of a row,
  // or null outside the board.
  function boardAt(row, across) {
    if (row < 0 || row >= BOARD.length || across < 0) return null;
    for (var i = 0; i < BOARD[row].length; i++) {
      if (across < BOARD[row][i].start + BOARD[row][i].span) return { row: row, index: i };
    }
    return null;
  }
  // Where the choice goes from `at` towards 'left', 'right', 'up' or
  // 'down'. Up and down go to the key over or under the middle of this one.
  function boardStep(at, direction) {
    var row = BOARD[at.row], key = row[at.index];
    if (direction === 'left') return { row: at.row, index: Math.max(0, at.index - 1) };
    if (direction === 'right') return { row: at.row, index: Math.min(row.length - 1, at.index + 1) };
    var to = at.row + (direction === 'up' ? -1 : 1);
    return boardAt(to, key.start + (key.span - 1) / 2) || at;
  }
  function typed(name, key) {
    if (key === 'del') return name.slice(0, -1);
    if (key === 'ok') return name;
    return name.length >= LONGEST_NAME ? name : name + (key === 'space' ? ' ' : key);
  }
  function tidyName(name) { return String(name || '').slice(0, LONGEST_NAME).trim(); }

  globalThis.__avatar = { LABELS: LABELS, CATALOGUE: CATALOGUE, owned: owned, dressed: dressed, next: next, nameOf: nameOf, layers: layers, cellOf: cellOf,
    BOARD: BOARD, boardKey: boardKey, boardAt: boardAt, boardStep: boardStep, typed: typed, tidyName: tidyName, LONGEST_NAME: LONGEST_NAME };
})();
