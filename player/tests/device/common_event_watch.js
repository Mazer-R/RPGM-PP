// Run next to a game (mvplayer --game <dir> --run this file) to see what each
// of the game's parallel common events costs: the candidates for the
// "commonEventThrottle" patch.
//
// It continues from save file EVENTS_SAVE (default 1; else a new game) and
// stays where the save is, standing still. After SETTLE_MS it times every
// common event's update for STEPS logic steps on the map, counting the
// commands each one runs, and logs the costliest twenty: id, name, length
// of its command list, time and commands per logic step, and whether it
// ever waits (an event that waits counts time and must not be slowed down).
// Exits with 0.
(function () {
  'use strict';
  var SAVE = globalThis.EVENTS_SAVE || 1, SETTLE_MS = 8000, STEPS = globalThis.EVENTS_STEPS || 900;
  var stage = 'boot', at = 0, steps = 0, total = 0, byId = {}, running = null;

  function counting() { return stage === 'count' && SceneManager._scene instanceof Scene_Map; }
  function entry(id) { return byId[id] || (byId[id] = { ms: 0, commands: 0, waits: 0, runs: 0 }); }
  function install() {
    var update = Game_CommonEvent.prototype.update;
    Game_CommonEvent.prototype.update = function () {
      if (!counting() || !this._interpreter) return update.apply(this, arguments);
      var mine = running = entry(this._commonEventId), before = performance.now();
      try { return update.apply(this, arguments); }
      finally {
        var took = performance.now() - before;
        mine.ms += took; mine.runs++; total += took; running = null;
      }
    };
    var executeCommand = Game_Interpreter.prototype.executeCommand;
    Game_Interpreter.prototype.executeCommand = function () {
      if (running) running.commands++;
      return executeCommand.apply(this, arguments);
    };
    var wait = Game_Interpreter.prototype.wait;
    Game_Interpreter.prototype.wait = function () {
      if (running) running.waits++;
      return wait.apply(this, arguments);
    };
    var updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () { var counted = counting(); updateScene.apply(this, arguments); if (counted) steps++; };
  }
  function scene() { var s = globalThis.SceneManager && SceneManager._scene; return s ? s.constructor.name : ''; }

  function watch(now) {
    requestAnimationFrame(watch);
    if (stage === 'boot' && scene() === 'Scene_Title') {
      install();
      if (DataManager.isAnySavefileExists() && DataManager.loadGame(SAVE)) {
        // As the engine's own "continue" does: reload the map the save is on.
        $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
        $gamePlayer.requestMapReload();
      } else {
        DataManager.setupNewGame();
      }
      SceneManager.goto(Scene_Map);
      stage = 'settle'; at = now;
    } else if (stage === 'settle' && now - at > SETTLE_MS) {
      stage = 'count';
    } else if (stage === 'count' && steps >= STEPS) {
      stage = 'done';
      var ids = Object.keys(byId).sort(function (a, b) { return byId[b].ms - byId[a].ms; });
      console.log('events: map ' + $gameMap.mapId() + ', ' + steps + ' logic steps, ' + ids.length + ' parallel common events running, ' +
        (total / steps).toFixed(2) + ' ms per step in all');
      ids.slice(0, 20).forEach(function (id) {
        var e = byId[id], data = $dataCommonEvents[id] || {};
        console.log('events: ' + (e.ms / steps).toFixed(2) + ' ms, ' + (e.commands / steps).toFixed(0) + ' commands per step, ' +
          (e.waits ? e.waits + ' waits' : 'never waits') + ': #' + id + ' "' + data.name + '" (' + (data.list ? data.list.length : 0) + ' commands long)');
      });
      player.exit(0);
    }
  }
  requestAnimationFrame(watch);
})();
