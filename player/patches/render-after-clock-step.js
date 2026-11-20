// Patch "renderAfterClockStep": the picture is drawn again after the clock
// is set back during a drawing.
//
// The engine times each drawing with the clock of the wall, and skips one
// of the next frames for every 15 ms the drawing took. It draws only when
// the count of frames to skip is exactly zero. When the system sets its
// clock back while a drawing is under way, the drawing seems to have taken
// less than no time, the count becomes negative, and from then on it only
// goes further down: the game keeps running and hears its buttons, but the
// picture on the screen never changes again. A handheld that keeps its
// clock right over the network sets it every few seconds, so a game left
// on long enough meets this.
//
// With this patch a count that is below zero, or not a number, is put back
// to zero before the engine's function runs, so the next frame is drawn.
// Frames skipped for a drawing that did take long are skipped as before.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/potato-player-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counter is in player.patchStats.renderAfterClockStep.
player.patches.renderAfterClockStep = function () {
  var stats = { recovered: 0 };
  player.patchStats.renderAfterClockStep = stats;
  var Graphics = globalThis.Graphics;
  if (!Graphics || typeof Graphics.render !== 'function') return;
  var render = Graphics.render;
  Graphics.render = function () {
    if ('_skipCount' in this && !(this._skipCount >= 0)) {
      this._skipCount = 0;
      stats.recovered++;
    }
    return render.apply(this, arguments);
  };
};
