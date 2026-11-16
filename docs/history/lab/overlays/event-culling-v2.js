// Experimental overlay, second version: keep lists of the map events and
// event sprites that currently matter, and only visit those each step.
//
// The first version still called a function on every event and every sprite
// to decide to skip it. This one rebuilds the "active" lists every few steps
// and, in between, never touches the far-away ones:
//   - Game_Map.updateEvents walks only the active events.
//   - Sprites of far-away events are removed from the tilemap, so neither the
//     per-step update nor the scene traversal visits them. They are put back
//     when their event comes near the screen again.
//
// Events that must keep running wherever they are stay active: parallel
// command lists, events that are starting or locked, forced move routes.
// Their sprites are still detached while off-screen.
//
// Like the first version, it changes nothing until
// window.__installEventCulling(margin) is called and never edits game files.
window.__installEventCulling = function (margin) {
  var REFRESH_EVERY = 10; // logic steps between rebuilds of the active lists
  var stats = { refreshes: 0, activeEvents: 0, totalEvents: 0, attachedSprites: 0 };
  window.__eventCullingStats = stats;

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

  function mustAlwaysRun(event) {
    return event._trigger === 4 || event._starting || event._locked ||
           event.isMoveRouteForcing();
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

  function refresh(map) {
    var events = map.events();
    activeEvents = [];
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (mustAlwaysRun(event) || isNearScreen(event)) activeEvents.push(event);
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
