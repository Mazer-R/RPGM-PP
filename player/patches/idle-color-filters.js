// Patch "idleColorFilters": do not run a colour filter that changes nothing.
//
// RPG Maker MZ puts a colour filter on the whole scene (for fades), on the
// map's or the battle's sprites (for brightness and flashes) and on the
// layer under them (for the screen's tone), and a sprite gets one of its own
// the first time it is tinted. The engine keeps every one of them switched
// on for good. A filter that is switched on makes PIXI draw what it covers
// into a texture and then copy that texture back through the filter's
// shader: on a map that is three extra passes over the whole picture in
// every frame, for filters that almost always sit at "no change". On the
// handheld those passes are most of the 15 ms a frame of a light game.
//
// PIXI skips a filter whose `enabled` is false, and when none of an object's
// filters is enabled it draws the object straight to the screen. This patch
// sets `enabled` from what the filter has been told: off while its hue is 0,
// its tone all zeros, its blend colour without strength and its brightness
// full, which is exactly when its shader would give back the colour it was
// given; on as soon as any of them is otherwise. The values themselves are
// the engine's, untouched.
//
// What it cannot see: a script that writes into a filter's uniforms
// directly, without the engine's four setters. Such a filter would stay off.
// To turn the patch off for one game, name it under "off" in that game's
// save/potato-player-patches.json; for every game, remove its line from
// patches/index.json or start the player with --no-patches. Its counters are
// in player.patchStats.idleColorFilters.
player.patches.idleColorFilters = function (options) {
  var stats = { made: 0, switchedOn: 0, switchedOff: 0 };
  player.patchStats.idleColorFilters = stats;
  if (!globalThis.ColorFilter || !ColorFilter.prototype || typeof ColorFilter.prototype.setColorTone !== 'function') return;
  var proto = ColorFilter.prototype;

  function allZero(values) {
    for (var i = 0; i < values.length; i++) if (values[i]) return false;
    return true;
  }
  // Whether the filter's shader would change a colour.
  function atWork(uniforms) {
    return !!uniforms.hue || !allZero(uniforms.colorTone || []) || !!(uniforms.blendColor && uniforms.blendColor[3]) ||
      uniforms.brightness !== 255;
  }
  function settle(filter) {
    var on = atWork(filter.uniforms);
    if (on === filter.enabled) return;
    filter.enabled = on;
    if (on) stats.switchedOn++; else stats.switchedOff++;
  }

  var initialize = proto.initialize;
  proto.initialize = function () {
    initialize.apply(this, arguments);
    stats.made++;
    this.enabled = atWork(this.uniforms);
  };
  ['setHue', 'setColorTone', 'setBlendColor', 'setBrightness'].forEach(function (name) {
    var set = proto[name];
    if (typeof set !== 'function') return;
    proto[name] = function () {
      var result = set.apply(this, arguments);
      settle(this);
      return result;
    };
  });
};
