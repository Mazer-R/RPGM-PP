// Patch "eventCulling": on maps with very many events, only visit the map
// events and event sprites that currently matter, and do less work for the
// rest.
//
//   1. Events and their sprites further than `margin` tiles from the screen
//      are not updated, except those that must run anywhere: an event whose
//      page runs by itself (parallel or autorun), one that is starting,
//      locked or on a forced route, and one that moves by itself, for as
//      far as the engine lets such an event move (half a screen beyond the
//      screen's edges).
//   2. Lazy page refresh. Whenever a switch or variable changes, the engine
//      re-evaluates the page conditions of every event on the map. Here,
//      far-away events only note that they are stale and are re-evaluated
//      when they come near. Events with a parallel or autorun page are never
//      deferred, because such a page must be able to start anywhere.
//   3. Lighting throttle. The TerraxLighting plugin rebuilds its darkness
//      mask on every logic step. Option `lightEvery: N` rebuilds it every
//      Nth step.
//
// Options: { margin: tiles, lazyRefresh: true|false, lightEvery: 1|2|3... }
//
// What the patch knows of an event is kept beside the event, not in it: the
// engine saves everything an event holds, and a save file must be what the
// game alone would write.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters
// are in player.patchStats.eventCulling.
player.patches.eventCulling = function (options) {
  options = options || {};
  // This patch replaces the map's event update outright. If a plugin has
  // already rewritten it, the plugin's version stays and nothing is installed.
  if (!player.patchTools.sameCode(Game_Map.prototype.updateEvents,
      'function() { this.events().forEach(function(event) { event.update(); });' +
      ' this._commonEvents.forEach(function(event) { event.update(); }); }')) {
    return 'not installed: the map\'s event update is not the engine\'s own';
  }
  var margin = Number(options.margin) >= 0 ? Number(options.margin) : 4;
  var lazyRefresh = options.lazyRefresh !== false;
  var lightEvery = Math.max(1, Number(options.lightEvery) || 1);
  var REFRESH_EVERY = 10; // logic steps between rebuilds of the active lists
  var stats = {
    refreshes: 0, activeEvents: 0, totalEvents: 0, attachedSprites: 0,
    pageRefreshesRun: 0, pageRefreshesDeferred: 0, lightUpdatesRun: 0, lightUpdatesSkipped: 0,
    lazyRefresh: lazyRefresh, lightEvery: lightEvery
  };
  player.patchStats.eventCulling = stats;

  var activeEvents = [];
  var stepsUntilRefresh = 0;
  var lastMapId = -1;

  function isNearScreen(character) {
    var tilesWide = Graphics.width / $gameMap.tileWidth();
    var tilesHigh = Graphics.height / $gameMap.tileHeight();
    var x = $gameMap.adjustX(character._realX);
    var y = $gameMap.adjustY(character._realY);
    return x >= -margin && x <= tilesWide + margin &&
           y >= -margin && y <= tilesHigh + margin;
  }

  // The engine starts an autorun event (trigger 3) and runs a parallel one
  // (4) from the event's own update, wherever the event is.
  function mustAlwaysRun(event) {
    return event._trigger === 3 || event._trigger === 4 || event._starting || event._locked ||
           event.isMoveRouteForcing() || (event._moveType !== 0 && event.isNearTheScreen());
  }

  // Per event: `far` (not visited now), `stale` (a page re-evaluation was
  // put off), `selfStarting` (some page runs by itself; worked out once).
  var notes = new WeakMap();
  function noteOf(event) {
    var note = notes.get(event);
    if (!note) notes.set(event, note = { far: false, stale: false, selfStarting: undefined });
    return note;
  }

  function refreshSprites() {
    var scene = SceneManager._scene;
    var spriteset = scene && scene._spriteset;
    if (!spriteset || !spriteset._characterSprites || !spriteset._tilemap) return;
    var tilemap = spriteset._tilemap;
    var attached = 0;
    var sprites = spriteset._characterSprites;
    for (var i = 0; i < sprites.length; i++) {
      var sprite = sprites[i];
      var character = sprite._character;
      if (!(character instanceof Game_Event)) { attached++; continue; }
      var near = isNearScreen(character);
      if (near && sprite.parent !== tilemap) {
        tilemap.addChild(sprite);
      } else if (!near && sprite.parent === tilemap) {
        tilemap.removeChild(sprite);
      }
      if (near) attached++;
    }
    stats.attachedSprites = attached;
  }

  // True when any page of the event runs by itself (autorun or parallel).
  function hasSelfStartingPage(event) {
    var note = noteOf(event);
    if (note.selfStarting === undefined) {
      var data = event.event();
      note.selfStarting = !!data && data.pages.some(function (page) {
        return page.trigger === 3 || page.trigger === 4;
      });
    }
    return note.selfStarting;
  }

  var refreshPage = Game_Event.prototype.refresh;
  if (lazyRefresh) {
    Game_Event.prototype.refresh = function () {
      if (noteOf(this).far && !hasSelfStartingPage(this)) {
        noteOf(this).stale = true;
        stats.pageRefreshesDeferred++;
        return;
      }
      stats.pageRefreshesRun++;
      refreshPage.call(this);
    };
  }

  // The lighting plugin keeps its mask class private; reach it through the
  // live sprite set the first time one exists.
  function installLightThrottle() {
    var scene = SceneManager._scene;
    var mask = scene && scene._spriteset && scene._spriteset._lightmask;
    if (!mask) return;
    var proto = Object.getPrototypeOf(mask);
    if (proto.__mvpThrottled || typeof proto._updateMask !== 'function') return;
    var updateMask = proto._updateMask;
    var calls = 0;
    proto._updateMask = function () {
      if (calls++ % lightEvery !== 0) { stats.lightUpdatesSkipped++; return; }
      stats.lightUpdatesRun++;
      return updateMask.apply(this, arguments);
    };
    proto.__mvpThrottled = true;
  }

  function refresh(map) {
    if (lightEvery > 1) installLightThrottle();
    var events = map.events();
    activeEvents = [];
    for (var i = 0; i < events.length; i++) {
      var event = events[i], note = noteOf(event);
      if (mustAlwaysRun(event) || isNearScreen(event)) {
        activeEvents.push(event);
        note.far = false;
        if (note.stale) {
          // Catch up on the page re-evaluation it skipped while far away.
          note.stale = false;
          refreshPage.call(event);
          stats.pageRefreshesRun++;
        }
      } else {
        note.far = true;
      }
    }
    refreshSprites();
    stats.refreshes++;
    stats.activeEvents = activeEvents.length;
    stats.totalEvents = events.length;
  }

  Game_Map.prototype.updateEvents = function () {
    if (stepsUntilRefresh <= 0 || lastMapId !== this.mapId()) {
      refresh(this);
      stepsUntilRefresh = REFRESH_EVERY;
      lastMapId = this.mapId();
    }
    stepsUntilRefresh--;
    for (var i = 0; i < activeEvents.length; i++) {
      activeEvents[i].update();
    }
    this._commonEvents.forEach(function (commonEvent) {
      commonEvent.update();
    });
  };
};
