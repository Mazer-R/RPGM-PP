// Run next to a game (potato-player --game <dir> --run this file) to measure the
// game while the player character moves, which is what real play does and a
// character standing still does not exercise: the map scrolls, events come
// into range, and step-driven game logic runs.
//
// It continues from a save file (WALK_SAVE, default 1; else a new game), goes
// to map WALK_MAP at (X, Y) or, with WALK_MAP = 0, stays where the save is, and
// then walks wherever the way is open, re-deciding every half second, for
// WALK_MS. The player's own performance line (see boot.js)
// reports every ten seconds (and profiles a slow period by itself); at the end
// this logs how far the character got, the logic step split into its main
// parts, and the patches' counters. Exits with 0.
(function () {
  'use strict';
  // SAVE: the save file to continue from. MAP 0 stays where that save is.
  var SAVE = globalThis.WALK_SAVE || 1, MAP = globalThis.WALK_MAP === undefined ? 1 : globalThis.WALK_MAP, X = 25, Y = 68;
  var SETTLE_MS = 8000, WALK_MS = 40000;
  // Arrow key codes, and the engine's direction number for each.
  var KEYS = [37, 38, 39, 40], DIRECTION_OF = { 37: 4, 38: 8, 39: 6, 40: 2 }, facing = 0, blocked = 0;
  var stopProfile = null;
  var stage = 'boot', at = 0, held = 0, nextTurn = 0, turn = 0, steps = 0, t = {}, startX = 0, startY = 0, moved = 0, lastX = -1, lastY = -1;

  // Only steps on the map count: a battle the walk runs into is another matter.
  function measuring() { return stage === 'walk' && SceneManager._scene instanceof Scene_Map; }
  function wrap(owner, name, label) {
    if (!owner || typeof owner[name] !== 'function') return;
    var original = owner[name];
    t[label] = 0;
    owner[name] = function () {
      var before = performance.now();
      try { return original.apply(this, arguments); }
      finally { if (measuring()) t[label] += performance.now() - before; }
    };
  }
  function install() {
    wrap(SceneManager, 'updateScene', 'step total');
    wrap(Scene_Map.prototype, 'updateMain', '  game objects (scene.updateMain)');
    wrap(Game_Map.prototype, 'update', '    map.update');
    wrap(Game_Map.prototype, 'updateEvents', '      map.updateEvents');
    wrap(Game_Map.prototype, 'refreshIfNeeded', '      map.refreshIfNeeded');
    wrap(Game_Map.prototype, 'updateInterpreter', '      map.updateInterpreter');
    wrap(Game_Player.prototype, 'update', '    player.update');
    wrap(Scene_Map.prototype, 'updateChildren', '  sprites and windows (scene.updateChildren)');
    wrap(Spriteset_Map.prototype, 'update', '    spriteset.update');
    wrap(Tilemap.prototype, 'update', '      tilemap.update (all children)');
    wrap(Sprite_Character.prototype, 'update', '        character sprites');
    wrap(Window_Base.prototype, 'update', '    windows');
    wrap(Game_Interpreter.prototype, 'update', '  (all event interpreters, wherever called)');
    wrap(Game_CommonEvent.prototype, 'update', '  (common events, wherever called)');
    var updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () { var counted = measuring(); updateScene.apply(this, arguments); if (counted) steps++; };
  }
  function scene() { var s = SceneManager._scene; return s ? s.constructor.name : ''; }
  function release() { if (held) { player.onKey(held, false); held = 0; } }

  function watch(now) {
    requestAnimationFrame(watch);
    if (stage === 'boot' && scene() === 'Scene_Title') {
      install();
      if (!(DataManager.isAnySavefileExists() && DataManager.loadGame(SAVE))) DataManager.setupNewGame();
      if (MAP) {
        $gamePlayer.reserveTransfer(MAP, X, Y, 2, 0);
      } else {
        // As the engine's own "continue" does: reload the map the save is on.
        $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
        $gamePlayer.requestMapReload();
      }
      SceneManager.goto(Scene_Map);
      stage = 'settle'; at = now;
    } else if (stage === 'settle' && now - at > SETTLE_MS) {
      stage = 'walk'; at = now; startX = $gamePlayer.x; startY = $gamePlayer.y;
      // With WALK_PROFILE set, the whole walk is sampled; the player's own
      // profiling of slow periods is switched off so the two do not collide.
      if (globalThis.WALK_PROFILE && player.startProfile) {
        stopProfile = player.stopProfile;
        player.startProfile();
        player.startProfile = undefined;
      }
      console.log('walk: starting on map ' + $gameMap.mapId() + ' at ' + startX + ',' + startY);
    } else if (stage === 'walk') {
      if ($gamePlayer.x !== lastX || $gamePlayer.y !== lastY) { moved++; lastX = $gamePlayer.x; lastY = $gamePlayer.y; }
      if (now >= nextTurn) {
        release();
        if (!$gamePlayer.canMove()) {
          // An event or a message holds the character: confirm, as a person would.
          blocked++;
          held = 90;
        } else {
          // Keep going the same way while the way is open, else take the
          // first open direction, so the character really covers ground.
          var ways = [KEYS[facing], KEYS[(facing + 1) % 4], KEYS[(facing + 3) % 4], KEYS[(facing + 2) % 4]];
          var open = ways.filter(function (key) { return $gamePlayer.canPass($gamePlayer.x, $gamePlayer.y, DIRECTION_OF[key]); });
          held = open.length ? open[turn % 5 === 4 && open.length > 1 ? 1 : 0] : KEYS[facing];
          facing = KEYS.indexOf(held);
        }
        turn++;
        player.onKey(held, true);
        nextTurn = now + 500;
      }
      if (now - at > WALK_MS) {
        release();
        console.log('walk: map ' + $gameMap.mapId() + ', scene ' + scene() + ', ' + moved + ' tiles walked (' + blocked + ' half-seconds held by events), now at ' + $gamePlayer.x + ',' + $gamePlayer.y +
          ', ' + steps + ' logic steps on the map; ms per step:');
        Object.keys(t).forEach(function (k) { console.log('walk: ' + (t[k] / Math.max(1, steps)).toFixed(2) + '  ' + k); });
        console.log('walk: patch counters ' + JSON.stringify(player.patchStats || {}));
        if (stopProfile) {
          console.log('walk: where the scripts spent their own time (share of samples):');
          stopProfile.call(player, 40).forEach(function (line) { console.log('walk:   ' + line); });
        }
        player.exit(0);
      }
    }
  }
  requestAnimationFrame(watch);
})();
