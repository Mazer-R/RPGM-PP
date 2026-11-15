// Run next to a game (mvplayer --game <dir> --run this file) to check that a
// battle starts and runs. At the title it starts a new game without the
// title menu, waits on the first map, starts a battle against troop TROOP,
// and logs the scene, the battle phase and the frame rate once a second,
// confirming with the action key now and then. It saves pictures of the
// battle in the game's save folder (see stage2_title_watch.js for the
// format). Exits with 0 if the battle scene ran for the whole time, 4 if it
// never appeared.
(function () {
  'use strict';
  var gl = player.gl;
  var TROOP = 1;
  var RUN_MS = 50000;
  var started = performance.now();
  var stage = 'boot', stageAt = 0, lastReport = 0, frames = 0, battleFrames = 0, shots = 0;

  function sceneName() {
    var scene = globalThis.SceneManager && SceneManager._scene;
    return scene ? scene.constructor.name : 'none';
  }
  function base64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = [];
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out.push(chars[n >> 18], chars[(n >> 12) & 63], i + 1 < bytes.length ? chars[(n >> 6) & 63] : '=',
        i + 2 < bytes.length ? chars[n & 63] : '=');
    }
    return out.join('');
  }
  function capture(name) {
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    var pixels = new Uint8Array(w * h * 4);
    var bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
    var hw = w >> 1, hh = h >> 1;
    var small = new Uint8Array(hw * hh * 4);
    for (var y = 0; y < hh; y++) {
      for (var x = 0; x < hw; x++) {
        var from = ((h - 1 - y * 2) * w + x * 2) * 4, to = (y * hw + x) * 4;
        small[to] = pixels[from]; small[to + 1] = pixels[from + 1]; small[to + 2] = pixels[from + 2]; small[to + 3] = 255;
      }
    }
    player.writeSaveFile(player.gameDir + '/save/' + name, hw + '\n' + hh + '\n' + base64(small) + '\n');
  }
  function go(next, now) { stage = next; stageAt = now; console.log('battle: ' + next + ' at ' + ((now - started) / 1000).toFixed(1) + ' s'); }

  function watch(now) {
    requestAnimationFrame(watch);
    frames++;
    var scene = sceneName();
    if (scene === 'Scene_Battle') battleFrames++;
    if (now - lastReport >= 1000) {
      console.log('battle: ' + scene + ', ' + frames + ' frames' +
        (scene === 'Scene_Battle' ? ', phase ' + BattleManager._phase : ''));
      lastReport = now; frames = 0;
    }
    if (stage === 'boot' && scene === 'Scene_Title') {
      // Continue from the first save file when there is one, so the battle
      // uses a real party; otherwise start a new game.
      if (DataManager.isAnySavefileExists() && DataManager.loadGame(1)) {
        console.log('battle: loaded save file 1, map ' + $gameMap.mapId());
        $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
        $gamePlayer.requestMapReload();
      } else {
        DataManager.setupNewGame();
      }
      SceneManager.goto(Scene_Map);
      go('map', now);
    } else if (stage === 'map' && now - stageAt > 6000) {
      BattleManager.setup(TROOP, true, false);
      SceneManager.push(Scene_Battle);
      go('battle', now);
    } else if (stage === 'battle') {
      var held = now - stageAt;
      if (held > 5000 * (shots + 1) && shots < 3) { shots++; capture('mvplayer-shot-battle' + shots + '.txt'); }
      if (Math.floor(held / 1500) !== Math.floor((held - 17) / 1500) && held > 8000) {
        player.onKey(90, true);
        setTimeout(function () { player.onKey(90, false); }, 120);
      }
    }
    if (now - started >= RUN_MS) {
      console.log('battle: frames in the battle scene: ' + battleFrames);
      return player.exit(battleFrames > 0 ? 0 : 4);
    }
  }
  requestAnimationFrame(watch);
})();
