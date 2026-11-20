// Patch "eventLookup": find the events at a map position without going
// through every event of the map.
//
// "Which events are on this square?" is the question behind every check of
// whether a character can move. The engine answers it by building a list of
// all the map's events and asking each one. On a map with hundreds of events
// where enemies chase the player, working out routes, it is asked a great
// many times per logic step, and was the largest single cost found in real
// play on the handheld.
//
// Here the map's events are kept sorted by the square they stand on, so the
// question looks at that square only. The answers are the engine's own: the
// same events, in the same order, each still asked through its own methods.
//
// How the sorting stays right:
//   - every engine function that changes a character's position is followed,
//     and the event is moved to its new square at that moment;
//   - at every logic step each event's square is checked against its
//     position, which catches a position changed any other way, one step
//     late at most;
//   - if any event of the map answers "are you at x, y?" with code that is
//     not the engine's own (a plugin for events larger than one square, for
//     instance), the sorting is not used for that map and every event is
//     asked, as the engine would.
//
// It never edits game files. To turn it off for one game, name it under
// "off" in that game's save/potato-player-patches.json; for every game, remove
// its line from patches/index.json or start the player with --no-patches.
// Its counters are in player.patchStats.eventLookup.
player.patches.eventLookup = function (options) {
  var stats = { lookups: 0, lookupsThroughEveryEvent: 0, rebuilds: 0, eventsMoved: 0, eventsFoundMoved: 0 };
  player.patchStats.eventLookup = stats;
  if (!globalThis.Game_Map || !globalThis.Game_CharacterBase || !globalThis.Game_Event) return 'not installed: no map engine';
  var sameCode = player.patchTools.sameCode;
  var base = Game_CharacterBase.prototype;

  // The engine's own position checks. The sorting is only trusted for
  // events that still use exactly these.
  var enginePos = base.pos, enginePosNt = base.posNt;
  var positionsAreTheEngines =
    sameCode(enginePos, 'function(x, y) { return this._x === x && this._y === y; }') &&
    sameCode(enginePosNt, 'function(x, y) { // No through\n return this.pos(x, y) && !this.isThrough(); }');

  // --- The events of one map, by square ----------------------------------------
  var sorted = {
    map: null, events: null, count: 0,
    usable: false,
    squares: new Map(),   // square -> events standing there, in map order
    squareOf: [],         // by event id: the square the event is filed under
    checkedThisStep: false,
  };
  function square(x, y) { return y * 65536 + x; }

  function file(event, key) {
    var list = sorted.squares.get(key);
    if (!list) { sorted.squares.set(key, [event]); return; }
    // Kept in map order, which is the order of the ids.
    var at = list.length;
    while (at > 0 && list[at - 1]._eventId > event._eventId) at--;
    list.splice(at, 0, event);
  }
  function unfile(event, key) {
    var list = sorted.squares.get(key);
    if (!list) return;
    var at = list.indexOf(event);
    if (at >= 0) list.splice(at, 1);
    if (!list.length) sorted.squares.delete(key);
  }
  function rebuild(map) {
    stats.rebuilds++;
    var all = map._events;
    sorted.map = map;
    sorted.events = all;
    sorted.count = all.length;
    sorted.squares = new Map();
    sorted.squareOf = [];
    sorted.checkedThisStep = true;
    sorted.usable = positionsAreTheEngines;
    for (var i = 0; i < all.length && sorted.usable; i++) {
      var event = all[i];
      if (!event) continue;
      if (event.pos !== enginePos || event.posNt !== enginePosNt || event._eventId !== i) {
        sorted.usable = false;
        break;
      }
      var key = square(event._x, event._y);
      sorted.squareOf[i] = key;
      file(event, key);
    }
  }
  // Makes sure every event is filed under the square it stands on.
  function recheck() {
    var all = sorted.events;
    for (var i = 0; i < all.length; i++) {
      var event = all[i];
      if (!event) continue;
      var key = square(event._x, event._y);
      if (sorted.squareOf[i] !== key) {
        stats.eventsFoundMoved++;
        unfile(event, sorted.squareOf[i]);
        sorted.squareOf[i] = key;
        file(event, key);
      }
    }
    sorted.checkedThisStep = true;
  }
  function ready(map) {
    if (sorted.map !== map || sorted.events !== map._events || sorted.count !== map._events.length) rebuild(map);
    else if (sorted.usable && !sorted.checkedThisStep) recheck();
    return sorted.usable;
  }

  // An event of the sorted map has just been moved by the engine.
  function moved(character) {
    var id = character._eventId;
    if (!sorted.usable || id === undefined || sorted.events[id] !== character) return;
    var key = square(character._x, character._y);
    if (sorted.squareOf[id] === key) return;
    stats.eventsMoved++;
    unfile(character, sorted.squareOf[id]);
    sorted.squareOf[id] = key;
    file(character, key);
  }
  ['setPosition', 'copyPosition', 'moveStraight', 'moveDiagonally', 'jump', 'updateJump'].forEach(function (name) {
    var original = base[name];
    if (typeof original !== 'function') return;
    base[name] = function () {
      var result = original.apply(this, arguments);
      moved(this);
      return result;
    };
  });
  if (globalThis.SceneManager && typeof SceneManager.updateScene === 'function') {
    var updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {
      sorted.checkedThisStep = false;
      return updateScene.apply(this, arguments);
    };
  }

  // --- The lookups ------------------------------------------------------------------
  function lookup(map, x, y, blockingOnly) {
    stats.lookups++;
    var all = map._events, found = [], i, event;
    if (ready(map)) {
      var here = sorted.squares.get(square(x, y));
      if (!here) return found;
      for (i = 0; i < here.length; i++) {
        event = here[i];
        // Still an event of the map, and still there by its own account.
        if (all[event._eventId] !== event) continue;
        if (blockingOnly ? event.posNt(x, y) : event.pos(x, y)) found.push(event);
      }
      return found;
    }
    stats.lookupsThroughEveryEvent++;
    for (i = 0; i < all.length; i++) {
      event = all[i];
      if (event && (blockingOnly ? event.posNt(x, y) : event.pos(x, y))) found.push(event);
    }
    return found;
  }

  // Each lookup is replaced only if it is still the engine's own code.
  var left = [];
  function replace(name, engineCode, lean) {
    if (sameCode(Game_Map.prototype[name], engineCode)) Game_Map.prototype[name] = lean;
    else left.push(name);
  }
  replace('eventsXy', 'function(x, y) { return this.events().filter(function(event) { return event.pos(x, y); }); }',
    function (x, y) { return lookup(this, x, y, false); });
  replace('eventsXyNt', 'function(x, y) { return this.events().filter(function(event) { return event.posNt(x, y); }); }',
    function (x, y) { return lookup(this, x, y, true); });
  if (left.length) return 'left as a plugin made them: ' + left.join(', ');
};
