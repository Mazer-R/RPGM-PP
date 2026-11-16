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
// The events whose name contains one of the `names` texts are run once
// every `every` steps instead (each on a different step, so they do not all
// land on the same one). What they keep in sync is then at most `every`
// steps late: with every = 6, a tenth of a second.
//
// Only events that are pure checks should be listed. An event that counts
// steps or waits a number of frames would run slower than the game intends.
//
// Options: { names: ["text", ...], every: N }
//
// It never edits game files. To turn it off, remove it from the game's entry
// in patches/index.json, or start the player with --no-patches. Its counters
// are in player.patchStats.commonEventThrottle.
player.patches.commonEventThrottle = function (options) {
  var names = (options && options.names) || [];
  var every = Math.max(1, Number(options && options.every) || 6);
  var stats = { every: every, events: 0, run: 0, skipped: 0 };
  player.patchStats.commonEventThrottle = stats;
  if (!globalThis.Game_CommonEvent || !names.length || every < 2) return;

  // Decided once per common event id: 0 = not throttled, else its turn + 1.
  var turns = {};
  function turnOf(commonEvent) {
    var id = commonEvent._commonEventId;
    if (turns[id] === undefined) {
      var data = commonEvent.event();
      var listed = data && names.some(function (text) { return String(data.name).indexOf(text) >= 0; });
      turns[id] = listed ? (stats.events++ % every) + 1 : 0;
    }
    return turns[id];
  }

  var step = 0;
  var updateScene = SceneManager.updateScene;
  SceneManager.updateScene = function () {
    step++;
    return updateScene.apply(this, arguments);
  };
  var update = Game_CommonEvent.prototype.update;
  Game_CommonEvent.prototype.update = function () {
    var turn = turnOf(this);
    if (turn && step % every !== turn - 1) { stats.skipped++; return; }
    if (turn) stats.run++;
    return update.apply(this, arguments);
  };
};
