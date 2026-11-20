// Run next to a game (potato-player --game <dir> --run this file) to find what
// makes single frames slow: the short stops a player feels every few
// seconds while the average frame rate looks fine.
//
// It continues from save file HITCH_SAVE (default 1; else a new game) and
// stays where the save is, standing still or, with HITCH_WALK set, walking
// wherever the way is open. After SETTLE_MS it watches for
// HITCH_MS (default 45 seconds) and logs every frame that took more than
// HITCH_OVER_MS (default 60): when, how long, and how that time divides
// into the logic steps, the drawing, and the rest (waiting for the screen,
// the engine's own housekeeping such as memory collection, other programs).
// For the logic it names what stood out in that frame: a refresh of the
// whole map, the slowest single step, the time in sprites and windows, the
// slowest event command, common event and map event. It also names
// the three calls into the player itself that took longest in that frame
// (reading a file, decoding a picture or a sound, sending a texture to the
// GPU), with the file or size they were given, and how long the engine
// stopped the scripts to collect memory. Exits with 0.
(function () {
  'use strict';
  var SAVE = globalThis.HITCH_SAVE || 1, SETTLE_MS = 8000, WATCH_MS = globalThis.HITCH_MS || 45000, OVER_MS = globalThis.HITCH_OVER_MS || 60;
  var stage = 'boot', at = 0, last = 0, frames = 0, slow = 0;
  var f = null;
  // Calls into the native player: every function of player, player.canvas
  // and player.audio, and the few of player.gl that move much data.
  var GL_HEAVY = ['texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'bufferData', 'compileShader', 'linkProgram', 'readPixels', 'generateMipmap'];
  function describe(value) {
    if (typeof value === 'string') return value.split('/').slice(-2).join('/');
    if (typeof value === 'number') return String(value);
    if (value && value.byteLength !== undefined) return value.byteLength + ' bytes';
    return value && value.width ? value.width + 'x' + value.height : typeof value;
  }
  function watchNative(owner, label, only) {
    if (!owner) return;
    (only || Object.keys(owner)).forEach(function (name) {
      var original = owner[name];
      if (typeof original !== 'function' || /^(on[A-Z]|startProfile|stopProfile|exit|print)/.test(name)) return;
      try {
        owner[name] = function () {
          if (!f) return original.apply(this, arguments);
          var before = performance.now();
          try { return original.apply(this, arguments); }
          finally {
            var ms = performance.now() - before;
            f.native += ms;
            if (ms >= 2) f.calls.push({ ms: ms, what: label + name + '(' + Array.prototype.slice.call(arguments, 0, 9).map(describe).join(', ') + ')' });
          }
        };
      } catch (error) { /* a function that cannot be replaced is not watched */ }
    });
  }
  function pauses() { return player.memoryPauses ? player.memoryPauses() : [0, 0, 0, 0]; }
  function fresh() { return { memory: pauses(), native: 0, calls: [], logic: 0, steps: 0, draw: 0, refresh: 0, refreshes: 0, common: 0, commonName: '', event: 0, eventName: '', saves: 0, sprites: 0, command: 0, commandName: '', step: 0 }; }
  function timed(owner, name, done) {
    if (!owner || typeof owner[name] !== 'function') return;
    var original = owner[name];
    owner[name] = function () {
      if (!f) return original.apply(this, arguments);
      var before = performance.now();
      try { return original.apply(this, arguments); }
      finally { done.call(this, performance.now() - before); }
    };
  }
  function install() {
    timed(SceneManager, 'updateScene', function (ms) { f.logic += ms; f.steps++; });
    timed(SceneManager, 'renderScene', function (ms) { f.draw += ms; });
    timed(Game_Map.prototype, 'refresh', function (ms) { f.refresh += ms; f.refreshes++; });
    timed(Game_CommonEvent.prototype, 'update', function (ms) {
      if (ms > f.common) { f.common = ms; var data = this.event(); f.commonName = '#' + this._commonEventId + ' "' + (data && data.name) + '"'; }
    });
    timed(Game_Event.prototype, 'update', function (ms) {
      if (ms > f.event) { f.event = ms; var data = this.event(); f.eventName = '#' + this._eventId + ' "' + (data && data.name) + '"'; }
    });
    timed(DataManager, 'saveGame', function () { f.saves++; });
    timed(SceneManager, 'updateScene', function (ms) { if (ms > f.step) f.step = ms; });
    timed(Scene_Map.prototype, 'updateChildren', function (ms) { f.sprites += ms; });
    // The slowest single event command: its code, its first parameter, and
    // whose list it is in.
    var executeCommand = Game_Interpreter.prototype.executeCommand;
    Game_Interpreter.prototype.executeCommand = function () {
      if (!f) return executeCommand.apply(this, arguments);
      var command = this._list && this._list[this._index], before = performance.now();
      try { return executeCommand.apply(this, arguments); }
      finally {
        var ms = performance.now() - before;
        if (command && ms > f.command) {
          f.command = ms;
          f.commandName = 'code ' + command.code + ' (' + String(command.parameters && command.parameters[0]).slice(0, 60) + ') of ' +
            (this._eventId ? 'map event #' + this._eventId : 'a common event');
        }
      }
    };
    watchNative(player, 'player.');
    watchNative(player.canvas, 'canvas.');
    watchNative(player.audio, 'audio.');
    watchNative(player.video, 'video.');
    watchNative(player.gl, 'gl.', GL_HEAVY);
  }
  // Walking, as tests/device/walk_watch.js does: the same way while it is
  // open, else the first open one, re-decided every half second.
  var KEYS = [37, 38, 39, 40], DIRECTION_OF = { 37: 4, 38: 8, 39: 6, 40: 2 }, facing = 0, held = 0, nextTurn = 0, turn = 0;
  function walk(now) {
    if (now < nextTurn) return;
    if (held) player.onKey(held, false);
    if (!$gamePlayer.canMove()) {
      held = 90;  // an event or a message holds the character: confirm
    } else {
      var ways = [KEYS[facing], KEYS[(facing + 1) % 4], KEYS[(facing + 3) % 4], KEYS[(facing + 2) % 4]];
      var open = ways.filter(function (key) { return $gamePlayer.canPass($gamePlayer.x, $gamePlayer.y, DIRECTION_OF[key]); });
      held = open.length ? open[turn % 5 === 4 && open.length > 1 ? 1 : 0] : KEYS[facing];
      facing = KEYS.indexOf(held);
    }
    turn++;
    player.onKey(held, true);
    nextTurn = now + 500;
  }
  function scene() { var s = globalThis.SceneManager && SceneManager._scene; return s ? s.constructor.name : ''; }

  function watch(now) {
    requestAnimationFrame(watch);
    if (stage === 'boot' && scene() === 'Scene_Title') {
      install();
      if (DataManager.isAnySavefileExists() && DataManager.loadGame(SAVE)) {
        $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
        $gamePlayer.requestMapReload();
      } else {
        DataManager.setupNewGame();
      }
      SceneManager.goto(Scene_Map);
      stage = 'settle'; at = now;
    } else if (stage === 'settle' && now - at > SETTLE_MS) {
      stage = 'watch'; at = last = now; f = fresh();
      console.log('hitch: watching map ' + $gameMap.mapId() + ' for frames over ' + OVER_MS + ' ms');
    } else if (stage === 'watch') {
      if (globalThis.HITCH_WALK && scene() === 'Scene_Map') walk(now);
      // This callback runs at the start of a frame: `f` holds the frame before.
      var took = now - last;
      last = now; frames++;
      if (took > OVER_MS) {
        slow++;
        console.log('hitch: at ' + ((now - at) / 1000).toFixed(1) + ' s a frame of ' + took.toFixed(0) + ' ms: logic ' + f.logic.toFixed(0) + ' ms in ' + f.steps +
          ' steps, drawing ' + f.draw.toFixed(0) + ' ms, the rest ' + (took - f.logic - f.draw).toFixed(0) + ' ms; ' +
          (f.refreshes ? 'map refreshed ' + f.refreshes + ' times in ' + f.refresh.toFixed(0) + ' ms; ' : '') +
          'slowest step ' + f.step.toFixed(0) + ' ms, sprites and windows ' + f.sprites.toFixed(0) + ' ms, slowest command ' + f.command.toFixed(0) + ' ms ' + f.commandName + '; ' +
          'slowest common event ' + f.common.toFixed(1) + ' ms ' + f.commonName + ', slowest map event ' + f.event.toFixed(1) + ' ms ' + f.eventName +
          (f.saves ? '; the game saved' : '') + '; memory collection ' + (pauses()[1] - f.memory[1]).toFixed(0) + ' ms in ' +
          (pauses()[0] - f.memory[0]) + ' pauses (' + (pauses()[2] - f.memory[2]) + ' full)' + '; native calls ' + f.native.toFixed(0) + ' ms' +
          f.calls.sort(function (a, b) { return b.ms - a.ms; }).slice(0, 3).map(function (c) { return ', ' + c.ms.toFixed(0) + ' ms ' + c.what; }).join(''));
      }
      f = fresh();
      if (now - at > WATCH_MS) {
        console.log('hitch: memory collection since the start: ' + pauses()[0] + ' pauses, ' + pauses()[1].toFixed(0) + ' ms; of them ' +
          pauses()[2] + ' full, ' + pauses()[3].toFixed(0) + ' ms');
        console.log('hitch: ' + slow + ' frames over ' + OVER_MS + ' ms out of ' + frames + ' in ' + ((now - at) / 1000).toFixed(0) + ' s');
        player.exit(0);
      }
    }
  }
  requestAnimationFrame(watch);
})();
