// Patch "equipCache": work out an actor's list of equipment once, and keep
// it until some piece of equipment changes.
//
// The engine builds the list again on every question about it: each "is the
// actor wearing X" condition of an event, and each look at the actor's
// traits (and so each parameter), walks the actor's slots and looks every
// item up. Games that keep checking equipment in parallel events ask
// thousands of times a second, and nearly always nothing has changed.
//
// Every way of changing a slot goes through one of three functions of the
// slot (Game_Item: initialize, setObject, setEquip). Each of them moves a
// counter on; a remembered list is used only while the counter, the actor's
// array of slots and its length are what they were when the list was made.
// The caller gets a copy, as it always did, so it may change it freely.
// Nothing is kept inside the actor: save files are unchanged.
//
// It wraps whatever equips() the game has at the time (a plugin's, if a
// plugin replaced the engine's), and never edits game files. To turn it off
// for one game, name it under "off" in that game's
// save/mvplayer-patches.json; for every game, remove its line from
// patches/index.json or start the player with --no-patches. Its counters
// are in player.patchStats.equipCache.
player.patches.equipCache = function () {
  var stats = { built: 0, remembered: 0, changes: 0 };
  player.patchStats.equipCache = stats;
  if (!globalThis.Game_Item || !globalThis.Game_Actor || typeof Game_Actor.prototype.equips !== 'function') return 'no actors';

  // Moved on by every change to any slot of anybody.
  var version = 0;
  ['initialize', 'setObject', 'setEquip'].forEach(function (name) {
    var original = Game_Item.prototype[name];
    if (typeof original !== 'function') return;
    Game_Item.prototype[name] = function () {
      version++;
      stats.changes++;
      return original.apply(this, arguments);
    };
  });

  var remembered = new WeakMap();
  var equips = Game_Actor.prototype.equips;
  Game_Actor.prototype.equips = function () {
    var slots = this._equips;
    var known = remembered.get(this);
    if (known && known.version === version && known.slots === slots && known.length === slots.length) {
      stats.remembered++;
      return known.list.slice();
    }
    // Slots made while the list is worked out move the counter too.
    var list = equips.apply(this, arguments);
    stats.built++;
    remembered.set(this, { version: version, slots: this._equips, length: this._equips ? this._equips.length : 0, list: list.slice() });
    return list;
  };
};
