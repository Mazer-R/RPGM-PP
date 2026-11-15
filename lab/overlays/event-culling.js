// Experimental overlay: skip per-frame work for map events that are far
// from the screen. Loaded by the lab server next to the game; it changes
// nothing until window.__installEventCulling(margin) is called, and it never
// touches the game's files.
//
// Two pieces of per-event work are skipped:
//   1. Game_Event.update (movement, animation, page logic) for events more
//      than `margin` tiles outside the visible screen.
//   2. Sprite_Character.update for the sprites of those same events.
//
// Events that must keep running wherever they are stay active: events with a
// parallel command list, events that are starting or locked, and events
// whose movement is being driven by a forced move route.
window.__installEventCulling = function (margin) {
  var stats = { updated: 0, skipped: 0, spritesSkipped: 0 };
  window.__eventCullingStats = stats;

  function isNearScreen(character) {
    var tilesWide = Graphics.width / $gameMap.tileWidth();
    var tilesHigh = Graphics.height / $gameMap.tileHeight();
    // adjustX/adjustY give the position relative to the screen's top-left
    // corner in tiles, and already handle looping maps.
    var x = $gameMap.adjustX(character._realX);
    var y = $gameMap.adjustY(character._realY);
    return x >= -margin && x <= tilesWide + margin &&
           y >= -margin && y <= tilesHigh + margin;
  }

  function mustAlwaysRun(event) {
    return event._trigger === 4 || event._starting || event._locked ||
           event.isMoveRouteForcing();
  }

  Game_Map.prototype.updateEvents = function () {
    var events = this.events();
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (mustAlwaysRun(event) || isNearScreen(event)) {
        event.update();
        stats.updated++;
      } else {
        stats.skipped++;
      }
    }
    this._commonEvents.forEach(function (commonEvent) {
      commonEvent.update();
    });
  };

  var updateSprite = Sprite_Character.prototype.update;
  Sprite_Character.prototype.update = function () {
    var character = this._character;
    if (character instanceof Game_Event && !isNearScreen(character)) {
      this.visible = false;
      stats.spritesSkipped++;
      return;
    }
    updateSprite.call(this);
  };
};
