// Patch "preloadOnce": ask for an event's images only the first time the
// event's command list is started.
//
// Whenever an event or common event starts, the engine walks its whole
// command list to request, ahead of time, every image the commands will
// show. A parallel event starts again each time it reaches its end, which
// for short ones is every logic step, so the same list is walked and the
// same images requested sixty times a second. With dozens of parallel
// common events active this was about a tenth of all script time on the
// handheld.
//
// A command list is fixed game data, so one walk per list is enough. If the
// engine later drops one of those images from its cache, the command that
// shows it loads it again at that moment, as it would for any image.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters
// are in player.patchStats.preloadOnce.
player.patches.preloadOnce = function (options) {
  var stats = { walked: 0, skipped: 0 };
  player.patchStats.preloadOnce = stats;
  if (!globalThis.Game_Interpreter || typeof Game_Interpreter.requestImages !== 'function') return;
  var seen = new WeakSet();
  var requestImages = Game_Interpreter.requestImages;
  Game_Interpreter.requestImages = function (list, commonList) {
    // Calls with a second argument are the engine's own recursion into
    // common events; they belong to a walk that is already allowed.
    if (list && !commonList) {
      if (seen.has(list)) { stats.skipped++; return; }
      seen.add(list);
      stats.walked++;
    }
    return requestImages.apply(this, arguments);
  };
};
