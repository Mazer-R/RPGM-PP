// Patch "commonEventThrottle": run some of the game's parallel common events
// less often than every logic step.
//
// A parallel common event runs again on every logic step while its switch is
// on. Some games use long ones as "keep this in sync" checks: Fear & Hunger
// has seven "outfit change" events of about 1,900 commands each that compare
// the party's equipment and set each character's picture, sixty times a
// second. On the handheld these alone were most of the cost of the game's
// parallel events.
//
// Which events are run once every `every` steps instead (each on a
// different step, so they do not all land on the same one):
//
//   - By itself, any event that is a pure check and is seen to cost at least
//     `minMs` milliseconds per step, averaged over 120 steps. A pure check
//     has nothing in it but conditions on the game's state, jumps, comments
//     and fixed assignments: switches, self switches, variables set (not
//     random, not from a script; added to only after the event itself has
//     set them afresh), skills learnt or forgotten.
//     Run less often, such an event ends in the same state, at most `every`
//     steps late: with every = 6, a tenth of a second. An event that waits,
//     counts, reads a button or the timer, shows, plays or moves anything,
//     calls an event that is not itself a pure check, or runs a script or a
//     plugin command is not one:
//     it would behave differently, so it is never chosen. The time is
//     measured where the game runs, so a machine fast enough for the event
//     leaves it as the game made it.
//   - The events whose name contains one of the `names` texts, from the
//     start and whatever is in them. Only events known to be checks in
//     effect should be named. `names` is a list, for any game, or lists by
//     game title: { "Game Title": ["text", ...] }.
//
// Options: { every: N, minMs: T (none: named events only), names: ... }
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters
// are in player.patchStats.commonEventThrottle.
player.patches.commonEventThrottle = function (options) {
  options = options || {};
  var names = options.names || [];
  if (!Array.isArray(names)) names = names[globalThis.document ? document.title : ''] || [];
  var every = Math.max(1, Number(options.every) || 6);
  var minMs = Number(options.minMs) > 0 ? Number(options.minMs) : 0;
  var WINDOW = 120;
  var stats = { every: every, named: 0, pure: 0, slowedByCost: 0, run: 0, skipped: 0 };
  player.patchStats.commonEventThrottle = stats;
  if (!globalThis.Game_CommonEvent || (!names.length && !minMs) || every < 2) return;

  // --- Is the event a pure check? ------------------------------------------
  // Commands that only look, jump or end: comments, conditions and their
  // branches, loops, exit, labels.
  var HARMLESS = { 0: 1, 108: 1, 408: 1, 411: 1, 412: 1, 112: 1, 113: 1, 413: 1, 115: 1, 118: 1, 119: 1 };
  // Conditions on the timer (3), a button (11) or a script (12) are not
  // checks of the game's state.
  var CONDITIONS = { 0: 1, 1: 1, 2: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 13: 1 };
  // A call of another common event is as harmless as that event is. `path`
  // holds the ids being looked into: an event that reaches itself is not
  // taken for a check.
  // `resets` holds the variables the list has set to a constant so far, at
  // its top level (so on every run), or is null when the list jumps about.
  function harmless(command, path, resets) {
    var code = command.code, parameters = command.parameters || [];
    if (HARMLESS[code]) return true;
    if (code === 117) {
      var id = parameters[0], called = globalThis.$dataCommonEvents && $dataCommonEvents[id];
      if (!called || path.indexOf(id) >= 0) return false;
      return pure(called.list, path.concat(id));
    }
    if (code === 111) return !!CONDITIONS[parameters[0]];
    // Switches and self switches are only ever set; skills learnt or forgotten.
    if (code === 121 || code === 123 || code === 318) return true;
    // A variable, from a constant (0), a variable (1) or game data (3): set
    // (operation 0), or changed after the list itself has set it afresh,
    // which is counting from nothing on every run (how many are in the
    // party), not counting runs.
    if (code === 122) {
      if (parameters[3] !== 0 && parameters[3] !== 1 && parameters[3] !== 3) return false;
      var range = parameters[0] + '-' + parameters[1];
      if (parameters[2] !== 0) return !!resets && resets[range] === true;
      if (resets && command.indent === 0 && parameters[3] === 0) resets[range] = true;
      return true;
    }
    return false;
  }
  function pure(list, path) {
    if (!Array.isArray(list) || !list.length) return false;
    var jumps = list.some(function (command) { return command.code === 119; });
    var resets = jumps ? null : {};
    return list.every(function (command) { return harmless(command, path, resets); });
  }

  // --- What is known of each common event, by id ---------------------------
  // turn: 0 = runs on every step, else which of the `every` steps it runs on,
  // plus one. timed: a pure check not yet slowed down.
  var known = {}, slowed = 0;
  function slow(entry) { entry.turn = (slowed++ % every) + 1; entry.timed = false; }
  function entryOf(commonEvent) {
    var id = commonEvent._commonEventId;
    var entry = known[id];
    if (!entry) {
      entry = known[id] = { turn: 0, timed: false, offered: 0, ms: 0, seen: 0 };
      var data = commonEvent.event();
      if (data && names.some(function (text) { return String(data.name).indexOf(text) >= 0; })) {
        stats.named++;
        slow(entry);
      } else if (minMs && data && pure(data.list, [id])) {
        stats.pure++;
        entry.timed = true;
      }
    }
    return entry;
  }

  // Each slowed event counts the steps it is offered itself. Counting the
  // steps the engine asks for instead would go wrong when another patch
  // (framePacing) drops some of them: the steps that really run would then
  // skip some turns for good, and the events with those turns would never run.
  var update = Game_CommonEvent.prototype.update;
  Game_CommonEvent.prototype.update = function () {
    var entry = entryOf(this);
    if (entry.turn) {
      if (entry.offered++ % every !== entry.turn - 1) { stats.skipped++; return; }
      stats.run++;
      return update.apply(this, arguments);
    }
    if (!entry.timed) return update.apply(this, arguments);
    var before = performance.now();
    try { return update.apply(this, arguments); }
    finally {
      entry.ms += performance.now() - before;
      if (++entry.seen === WINDOW) {
        if (entry.ms / WINDOW >= minMs) { stats.slowedByCost++; slow(entry); }
        entry.ms = 0; entry.seen = 0;
      }
    }
  };
};
