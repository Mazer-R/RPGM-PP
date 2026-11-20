// Run next to a game (potato-player --game <dir> --run this file) to see what the
// event interpreter does in a logic step: which commands run and how often,
// how much skipping of branches there is, how many scripts are evaluated,
// and (from the engine's sampling profiler) where the time goes.
//
// It continues from save file CENSUS_SAVE (default 1; else a new game) and
// stays where the save is. After SETTLE_MS it counts for STEPS logic steps
// on the map, then logs the totals per step and exits with 0.
(function () {
  'use strict';
  var SAVE = globalThis.CENSUS_SAVE || 1, SETTLE_MS = 8000, STEPS = 600;
  var stage = 'boot', at = 0, steps = 0;
  var byCode = {}, commands = 0, skips = 0, skipped = 0, updates = 0, setups = 0, scripts = 0, scriptConditions = 0, maxPerStep = 0, thisStep = 0;

  function counting() { return stage === 'count' && SceneManager._scene instanceof Scene_Map; }
  function install() {
    var proto = Game_Interpreter.prototype;
    var executeCommand = proto.executeCommand;
    proto.executeCommand = function () {
      if (counting()) {
        var command = this._list && this._list[this._index];
        if (command) {
          commands++; thisStep++;
          byCode[command.code] = (byCode[command.code] || 0) + 1;
          if (command.code === 355) scripts++;
          if (command.code === 111 && command.parameters[0] === 12) scriptConditions++;
          if (command.code === 122 && command.parameters[3] === 4) scripts++;
        }
      }
      return executeCommand.apply(this, arguments);
    };
    var skipBranch = proto.skipBranch;
    proto.skipBranch = function () {
      var before = this._index;
      var result = skipBranch.apply(this, arguments);
      if (counting()) { skips++; skipped += this._index - before; }
      return result;
    };
    var update = proto.update;
    proto.update = function () { if (counting()) updates++; return update.apply(this, arguments); };
    var setup = proto.setup;
    proto.setup = function () { if (counting()) setups++; return setup.apply(this, arguments); };
    var updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {
      var counted = counting();
      thisStep = 0;
      updateScene.apply(this, arguments);
      if (counted) { steps++; maxPerStep = Math.max(maxPerStep, thisStep); }
    };
  }
  function scene() { var s = SceneManager._scene; return s ? s.constructor.name : ''; }
  var NAMES = { 111: 'if', 411: 'else', 412: 'end if', 0: 'end of block', 121: 'set switch', 122: 'set variable', 123: 'set self switch',
    355: 'script', 655: 'script line', 356: 'plugin command', 117: 'call common event', 230: 'wait', 108: 'comment', 408: 'comment line',
    112: 'loop', 413: 'repeat', 113: 'break', 115: 'exit event', 118: 'label', 119: 'jump to label', 231: 'show picture', 235: 'erase picture',
    205: 'move route', 505: 'move route line', 322: 'change actor images', 319: 'change equipment', 313: 'change state', 221: 'fade out', 250: 'play sound' };

  function watch(now) {
    requestAnimationFrame(watch);
    if (stage === 'boot' && scene() === 'Scene_Title') {
      install();
      if (!(DataManager.isAnySavefileExists() && DataManager.loadGame(SAVE))) DataManager.setupNewGame();
      else { $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y); $gamePlayer.requestMapReload(); }
      SceneManager.goto(Scene_Map);
      stage = 'settle'; at = now;
    } else if (stage === 'settle' && now - at > SETTLE_MS) {
      stage = 'count';
      if (player.startProfile) player.startProfile();
    } else if (stage === 'count' && steps >= STEPS) {
      stage = 'done';
      var per = function (n) { return (n / steps).toFixed(1); };
      console.log('census: map ' + $gameMap.mapId() + ', ' + $gameMap.events().length + ' events, ' + steps + ' logic steps');
      console.log('census: per step: ' + per(commands) + ' commands run (most in one step: ' + maxPerStep + '), ' + per(updates) +
        ' interpreter updates, ' + per(setups) + ' event starts, ' + per(skips) + ' branch skips passing over ' + per(skipped) +
        ' commands, ' + per(scripts) + ' scripts evaluated, ' + per(scriptConditions) + ' script conditions');
      Object.keys(byCode).sort(function (a, b) { return byCode[b] - byCode[a]; }).slice(0, 14).forEach(function (code) {
        console.log('census:   ' + per(byCode[code]) + '  ' + code + ' ' + (NAMES[code] || ''));
      });
      console.log('census: patch counters ' + JSON.stringify(player.patchStats || {}));
      if (player.stopProfile) {
        console.log('census: where the scripts spent their own time (share of samples):');
        player.stopProfile(40).forEach(function (line) { console.log('census:   ' + line); });
      }
      player.exit(0);
    }
  }
  requestAnimationFrame(watch);
})();
