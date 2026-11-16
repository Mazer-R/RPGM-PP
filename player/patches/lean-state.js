// Patch "leanState": stop two kinds of repeated work in the engine that cost
// nothing on a desktop and a lot on a handheld.
//
// 1. Writes that change nothing. Every write to a switch, a variable or a
//    self switch makes the engine re-evaluate the page conditions of the
//    map's events on the next logic step, even when the value written is the
//    one already there. Games with parallel events that keep setting the
//    same switches cause that re-evaluation on every step. Here a write
//    that changes nothing asks for nothing.
//
// 2. One question asked over and over. "Is any event starting?" is asked
//    many times per step, in some games once per event, and answered each
//    time by going through every event. Here it is answered once and the
//    answer kept until an event starts or stops starting.
//
// The answers are the engine's own in every case; only the work differs.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters
// are in player.patchStats.leanState.
player.patches.leanState = function (options) {
  var stats = { writesThatChangedNothing: 0, writesThatChanged: 0, startingAsked: 0, startingWorkedOut: 0 };
  player.patchStats.leanState = stats;

  // --- 1. Writes that change nothing -----------------------------------------
  // The stored value is compared before and after the engine's own write, so
  // the engine's rules (range checks, rounding of numbers) stay the engine's.
  // A value that is an object may have been changed in place, so it always
  // counts as a change.
  function onlyWhenChanged(owner, read) {
    if (!owner || typeof owner.prototype.setValue !== 'function') return;
    var setValue = owner.prototype.setValue;
    var onChange = owner.prototype.onChange;
    owner.prototype.setValue = function (key, value) {
      var before = read(this, key);
      var changed = false;
      // While the engine writes, its change notice is only noted.
      this.onChange = function () { changed = true; };
      try { setValue.apply(this, arguments); }
      finally { delete this.onChange; }
      if (!changed) return;
      var after = read(this, key);
      if (after === before && (after === null || typeof after !== 'object')) {
        stats.writesThatChangedNothing++;
        return;
      }
      stats.writesThatChanged++;
      (this.onChange || onChange).call(this);
    };
  }
  onlyWhenChanged(globalThis.Game_Switches, function (self, id) { return !!self._data[id]; });
  onlyWhenChanged(globalThis.Game_Variables, function (self, id) { return self._data[id] === undefined ? 0 : self._data[id]; });
  onlyWhenChanged(globalThis.Game_SelfSwitches, function (self, key) { return !!self._data[key]; });

  // --- 2. Lookups without a list of every event -------------------------------
  if (!globalThis.Game_Map) return;
  // The question is replaced only if it is still the engine's own code. One
  // that a plugin has rewritten stays as the plugin made it.
  var sameCode = player.patchTools.sameCode;
  var left = [];
  // "Is any event starting?" is asked by the engine and, in games with the
  // usual movement plugins, once per event per step, each time by going
  // through every event of the map. The answer only changes when an event
  // starts or stops starting, so it is worked out once and kept until then.
  // It is also dropped at every logic step, in case something changed the
  // events without going through the engine's own functions.
  var starting = { map: null, events: null, known: false, value: false };
  function forgetStarting() { starting.known = false; }
  function anyEventStarting() {
    stats.startingAsked++;
    if (starting.known && starting.map === this && starting.events === this._events) return starting.value;
    stats.startingWorkedOut++;
    var all = this._events, value = false;
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].isStarting()) { value = true; break; }
    }
    starting.map = this;
    starting.events = this._events;
    starting.value = value;
    starting.known = true;
    return value;
  }
  function forgetAfter(owner, name) {
    if (!owner || typeof owner.prototype[name] !== 'function') return;
    var original = owner.prototype[name];
    owner.prototype[name] = function () {
      forgetStarting();
      return original.apply(this, arguments);
    };
  }
  var sharesAnswer = false;
  if (sameCode(Game_Map.prototype.isAnyEventStarting,
      'function() { return this.events().some(function(event) { return event.isStarting(); }); }')) {
    Game_Map.prototype.isAnyEventStarting = anyEventStarting;
    sharesAnswer = true;
  } else {
    left.push('isAnyEventStarting');
  }
  // The copy of the same question that a widely used movement plugin adds.
  if (sameCode(Game_Map.prototype.isAnyEventStartingQuick,
      'function() { var max = this._events.length; for (var i = 0; i < max; ++i) { var ev = this._events[i];' +
      ' if (ev && ev.isStarting()) return true; } return false; }')) {
    Game_Map.prototype.isAnyEventStartingQuick = anyEventStarting;
    sharesAnswer = true;
  }
  if (sharesAnswer) {
    forgetAfter(globalThis.Game_Event, 'start');
    forgetAfter(globalThis.Game_Event, 'clearStartingFlag');
    if (globalThis.SceneManager && typeof SceneManager.updateScene === 'function') {
      var updateScene = SceneManager.updateScene;
      SceneManager.updateScene = function () {
        forgetStarting();
        return updateScene.apply(this, arguments);
      };
    }
  }
  if (left.length) return 'left as a plugin made them: ' + left.join(', ');
};
