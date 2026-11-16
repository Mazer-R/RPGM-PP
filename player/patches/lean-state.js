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
// 2. Lookups that list every event first. To find the events at a position,
//    or whether any event is starting, the engine first builds a list of all
//    the map's events and then filters it, each with a function call per
//    event. Characters ask "is that square blocked?" all the time, so on a
//    map with hundreds of events these lists are built many times per step.
//    Here the same answers come from one plain loop over the map's events.
//    Each event is still asked through its own methods, in the same order.
//
// The answers are the engine's own in every case; only the work differs.
//
// It never edits game files. To turn it off, remove it from the game's entry
// in patches/index.json, or start the player with --no-patches. Its counters
// are in player.patchStats.leanState.
player.patches.leanState = function (options) {
  var stats = { writesThatChangedNothing: 0, writesThatChanged: 0 };
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
  Game_Map.prototype.eventsXy = function (x, y) {
    var all = this._events, found = [];
    for (var i = 0; i < all.length; i++) {
      var event = all[i];
      if (event && event.pos(x, y)) found.push(event);
    }
    return found;
  };
  Game_Map.prototype.eventsXyNt = function (x, y) {
    var all = this._events, found = [];
    for (var i = 0; i < all.length; i++) {
      var event = all[i];
      if (event && event.posNt(x, y)) found.push(event);
    }
    return found;
  };
  Game_Map.prototype.isAnyEventStarting = function () {
    var all = this._events;
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].isStarting()) return true;
    }
    return false;
  };
};
