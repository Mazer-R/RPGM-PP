// Patch "idleToneFilter": the screen's tone filter is off while there is no
// tone.
//
// The engine draws everything under the windows (the map or the battle's
// field, its characters and pictures) through a filter that gives the
// screen its tone: the dusk of an evening, the red of a blow. The filter is
// on all the time, so with no tone at all the whole picture is still drawn
// to a picture of its own and copied from there, unchanged. That is one
// more picture the size of the game's for the graphics processor in every
// frame; on a handheld's, measured in a battle that waits for a command,
// the difference between 35 and 41 frames per second.
//
// With this patch the filter is switched off whenever the tone is nothing
// (red, green, blue and grey all at zero) and on again as soon as it is
// something. With the filter off the picture is drawn straight to where it
// was going to be copied, which is the same picture.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/potato-player-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters are in player.patchStats.idleToneFilter.
player.patches.idleToneFilter = function () {
  var stats = { switchedOff: 0, switchedOn: 0 };
  player.patchStats.idleToneFilter = stats;
  var Base = globalThis.Spriteset_Base;
  if (!Base) return;

  function match(spriteset) {
    var filter = spriteset._toneFilter, tone = spriteset._tone;
    if (!filter || !tone) return;
    var wanted = !!(tone[0] || tone[1] || tone[2] || tone[3]);
    if (filter.enabled === wanted) return;
    filter.enabled = wanted;
    if (wanted) stats.switchedOn++; else stats.switchedOff++;
  }
  // When the filter is made, and each time the engine sets it.
  ['createWebGLToneChanger', 'updateWebGLToneChanger'].forEach(function (name) {
    var own = Base.prototype[name];
    if (typeof own !== 'function') return;
    Base.prototype[name] = function () {
      var result = own.apply(this, arguments);
      match(this);
      return result;
    };
  });
};
