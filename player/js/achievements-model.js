// The achievements, and which of them a player has. Loaded by the game list;
// tested on its own (tests/js/achievements_model.test.js). It draws nothing
// and reads no file: it is given the counts the player keeps and answers
// with ids.
//
// The counts ("stats") are numbers and flags about what was done with the
// player, never about what happens inside a game, so they hold for any game:
//   games            games on the list now
//   removed          a game was taken off the list
//   playedMv, playedMz   an MV game, an MZ game was played
//   seconds          played in all
//   longestSession   seconds of the longest single run of a game
//   shortSession     a game was closed within a minute of starting
//   days             different days on which something was played
//   nightSession     played between 2 and 5 in the morning
//   mostInOneGame    seconds in the game played most
//   saves            save files written
//   quickSaves       three saves within a minute
//   loadedOlderSave  a save of an earlier day was loaded
//   settingsOpened, counterShown, remapped, pointerUsed, controlsOff,
//   usedStick, usedPad, videoSeen    what was used of the player itself
//   slowSession      a run ended under 20 frames per second on average
//   crashed          a game ended with an error
//   carriedOn        a game ran without something it asked for
//   waited           a minute spent on a list with no games
//   cameBack         played again after 30 days away
//   dug, dressed, named   the achievements were found; the avatar was
//                         changed; the profile was given a name
//   notAGame         "Add a game" was pointed at something that is no game
//   early            the player was used before 2028 (see isEarly)
(function () {
  'use strict';
  var HOUR = 3600;
  function atLeast(key, amount) { return function (stats) { return (stats[key] || 0) >= amount; }; }
  function flag(key) { return function (stats) { return !!stats[key]; }; }
  function both(a, b) { return function (stats) { return !!stats[a] && !!stats[b]; }; }

  // id, name, how it is earned (shown to the user), the metal of its frame
  // (bronze: comes by itself; silver: takes some doing; gold: rare), the
  // hero it belongs to, and the test on the stats. `over` marks the two
  // that are earned from other achievements instead; a last `true` marks a
  // secret one, which shows neither its name nor how until it is earned.
  var LIST = [
    ['first-sprout', 'First Sprout', 'Add your first game', 'bronze', 'archer', atLeast('games', 1)],
    ['small-harvest', 'Small Harvest', 'Have 5 games on the list', 'silver', 'archer', atLeast('games', 5)],
    ['full-sack', 'Full Sack', 'Have 10 games on the list', 'silver', 'archer', atLeast('games', 10)],
    ['potato-farm', 'Potato Farm', 'Have 25 games on the list', 'gold', 'archer', atLeast('games', 25)],
    ['two-kinds', 'Two Kinds of Potato', 'Play an MV game and an MZ game', 'silver', 'archer', both('playedMv', 'playedMz')],
    ['peeled', 'Peeled', 'Take a game off the list', 'bronze', 'archer', flag('removed')],

    ['warm-up', 'Warm Up', 'Play for 1 hour in all', 'bronze', 'knight', atLeast('seconds', HOUR)],
    ['slow-cooked', 'Slow Cooked', 'Play for 5 hours in all', 'silver', 'knight', atLeast('seconds', 5 * HOUR)],
    ['well-done', 'Well Done', 'Play for 25 hours in all', 'silver', 'knight', atLeast('seconds', 25 * HOUR)],
    ['baked-through', 'Baked Through', 'Play for 100 hours in all', 'gold', 'knight', atLeast('seconds', 100 * HOUR)],
    ['couch-potato', 'Couch Potato', 'Play for 2 hours without stopping', 'silver', 'knight', atLeast('longestSession', 2 * HOUR)],
    ['just-a-bite', 'Just a Bite', 'Close a game within a minute of starting it', 'bronze', 'knight', flag('shortSession')],
    ['regular-customer', 'Regular Customer', 'Play on 7 different days', 'silver', 'knight', atLeast('days', 7)],
    ['midnight-snack', 'Midnight Snack', 'Play between 2 and 5 in the morning', 'silver', 'knight', flag('nightSession')],
    ['loyal-spud', 'Loyal Spud', 'Play one game for 10 hours', 'gold', 'knight', atLeast('mostInOneGame', 10 * HOUR)],

    ['dear-diary', 'Dear Diary', 'Save for the first time', 'bronze', 'knight', atLeast('saves', 1)],
    ['precious-memories', 'Precious Memories', 'Save 100 times', 'gold', 'knight', atLeast('saves', 100)],
    ['better-safe', 'Better Safe Than Sorry', 'Save 3 times within a minute', 'silver', 'knight', flag('quickSaves')],
    ['welcome-back', 'Welcome Back', 'Load a save made on an earlier day', 'silver', 'knight', flag('loadedOlderSave')],

    ['tinkerer', 'Tinkerer', 'Open the player\'s settings', 'bronze', 'wizard', flag('settingsOpened')],
    ['number-cruncher', 'Number Cruncher', 'Show the frame counter', 'bronze', 'wizard', flag('counterShown')],
    ['remapped', 'Remapped', 'Change what a button presses', 'bronze', 'wizard', flag('remapped')],
    ['point-taken', 'Point Taken', 'Use the pointer worked with the pad', 'bronze', 'wizard', flag('pointerUsed')],
    ['hands-off', 'Hands Off', 'Switch the touch controls off', 'bronze', 'wizard', flag('controlsOff')],
    ['stick-or-pad', 'Stick or Pad', 'Try both ways of moving on a touch screen', 'bronze', 'wizard', both('usedStick', 'usedPad')],
    ['movie-night', 'Movie Night', 'Watch a video inside a game', 'bronze', 'wizard', flag('videoSeen')],
    ['dressed-up', 'Dressed Up', 'Change how your potato looks', 'bronze', 'wizard', flag('dressed')],
    ['named', 'Say My Name', 'Give your profile a name', 'bronze', 'wizard', flag('named')],

    ['true-potato', 'True Potato', 'End a session under 20 frames per second', 'gold', 'party', flag('slowSession')],
    ['mashed', 'Mashed', 'Have a game end with an error', 'silver', 'party', flag('crashed')],
    ['missing-ingredients', 'Missing Ingredients', 'Play a game that lacked something and ran anyway', 'silver', 'party', flag('carriedOn')],
    ['good-company', 'Good Company', 'Wait a minute on a list with no games', 'silver', 'party', flag('waited')],
    ['wrinkled', 'Wrinkled', 'Come back after 30 days away', 'gold', 'party', flag('cameBack')],
    ['not-a-potato', 'Notato', 'That\'s not a potato. That\'s not even a game.', 'gold', 'party', flag('notAGame'), null, true],
    ['early-birdtato', 'Early Birdtato', 'Be here before 2028', 'gold', 'party', flag('early')],

    ['dug-up', 'Dug Up', 'Find the achievements', 'silver', 'wizard', flag('dug')],
    ['whole-party', 'The Whole Party', 'Earn one achievement of each hero', 'gold', 'party', null, 'heroes'],
    ['completionist', 'Completionist', 'Earn every other achievement', 'gold', 'party', null, 'all'],
  ].map(function (row) {
    return { id: row[0], name: row[1], how: row[2], metal: row[3], hero: row[4], test: row[5], over: row[6] || null, secret: !!row[7] };
  });
  var HEROES = ['knight', 'wizard', 'archer'];

  // Whether one of the two achievements earned from others is earned, given
  // the ids held so far.
  function overOthers(each, held) {
    var mine = LIST.filter(function (other) { return !other.over && held[other.id]; });
    if (each.over === 'heroes') {
      return HEROES.every(function (hero) { return mine.some(function (other) { return other.hero === hero; }); });
    }
    return LIST.every(function (other) { return other.id === each.id || held[other.id]; });
  }

  // Stats with nothing done.
  function blank() { return { games: 0, seconds: 0, longestSession: 0, days: 0, mostInOneGame: 0, saves: 0 }; }

  // The achievements held after looking at the stats: the ones held before
  // (an achievement is never lost) and the ones the stats earn. `earned`
  // and `fresh` (the new ones) are ids in the order of the list.
  function update(before, stats) {
    var held = {}, was = {};
    (before || []).forEach(function (id) { was[id] = true; });
    LIST.forEach(function (each) { if (!each.over && (was[each.id] || each.test(stats || {}))) held[each.id] = true; });
    // The whole party first: completionist counts it among the others.
    LIST.forEach(function (each) { if (each.over && (was[each.id] || overOthers(each, held))) held[each.id] = true; });
    var earned = LIST.filter(function (each) { return held[each.id]; }).map(function (each) { return each.id; });
    return { earned: earned, fresh: earned.filter(function (id) { return !was[id]; }) };
  }

  // What the list of achievements shows for one of them, given the ids
  // earned: a secret one is question marks until it is earned.
  function shown(id, earned) {
    var each = LIST.filter(function (other) { return other.id === id; })[0];
    var has = (earned || []).indexOf(id) >= 0, hidden = each.secret && !has;
    return { id: id, name: hidden ? '???' : each.name, how: hidden ? '???' : each.how, metal: each.metal, earned: has };
  }

  // The avatar is a character with one piece, or none, in each other slot.
  // The face is apart from the accessory so that a beard, glasses or
  // freckles go with a shield or a cape.
  var SLOTS = ['character', 'head', 'face', 'weapon', 'accessory'];
  // What an achievement gives the avatar: pieces for its slots.
  var PRIZES = {
    'named': [{ slot: 'head', item: 'pork-pie-hat' }, { slot: 'face', item: 'goatee' }],
    'not-a-potato': [{ slot: 'character', item: 'avocado' }],
    'early-birdtato': [{ slot: 'accessory', item: 'wings' }],
  };
  // The pieces the achievements earned have given, in the order of the list.
  function unlocked(earned) {
    return LIST.filter(function (each) { return PRIZES[each.id] && (earned || []).indexOf(each.id) >= 0; })
      .reduce(function (all, each) { return all.concat(PRIZES[each.id]); }, []);
  }

  // Whether `date` is early enough for the achievement of the first users:
  // any day before 2028, by the device's own clock.
  var EARLY_BEFORE_YEAR = 2028;
  function isEarly(date) { return date.getFullYear() < EARLY_BEFORE_YEAR; }

  globalThis.__achievements = { LIST: LIST, SLOTS: SLOTS, PRIZES: PRIZES, blank: blank, update: update, shown: shown, unlocked: unlocked, isEarly: isEarly };
})();
