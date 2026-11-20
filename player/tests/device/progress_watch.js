// Run next to a game (potato-player --game <dir> --run this file) to see where a
// new game stops making progress. It confirms at the title and keeps
// confirming, and once a second logs what the engine is doing: the scene and
// map, whether images are still loading, the event command being run, any
// message on screen, and the frame rate. It saves a picture every SHOT_MS
// (potato-player-shot-<n>.txt in the game's save folder; see
// title_watch.js for the format). Exits with 0 after RUN_MS.
(function () {
  'use strict';
  var gl = player.gl;
  var RUN_MS = 100000, SHOT_MS = 15000;
  var started = performance.now();
  var titleAt = 0, nextTap = 0, lastReport = 0, frames = 0, shots = 0, lastLine = '';

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

  function state() {
    var parts = [sceneName()];
    try {
      if (globalThis.$gameMap && sceneName().indexOf('Map') >= 0) {
        parts.push('map ' + $gameMap.mapId());
        var interpreter = $gameMap._interpreter;
        if (interpreter && interpreter.isRunning()) {
          var deepest = interpreter;
          while (deepest._childInterpreter && deepest._childInterpreter.isRunning()) deepest = deepest._childInterpreter;
          var command = deepest._list && deepest._list[deepest._index];
          parts.push('event ' + interpreter._eventId + ' command ' + deepest._index + ' code ' + (command ? command.code : '-') +
            (deepest._waitMode ? ' waiting for ' + deepest._waitMode : '') + (deepest._waitCount ? ' wait ' + deepest._waitCount : ''));
        }
        if ($gamePlayer.isTransferring()) parts.push('transferring');
        if ($gameMessage.isBusy()) parts.push('message "' + String($gameMessage.allText()).replace(/\s+/g, ' ').slice(0, 40) + '"');
      }
      if (!ImageManager.isReady()) parts.push('images loading');
      if (globalThis.Graphics && Graphics._loadingCount > 0) parts.push('loading screen ' + Graphics._loadingCount);
      if (SceneManager._scene && SceneManager._scene.isBusy && SceneManager._scene.isBusy()) parts.push('scene busy');
      if (SceneManager._stopped) parts.push('engine stopped');
    } catch (error) { parts.push('state error: ' + error); }
    return parts.join(', ');
  }

  function watch(now) {
    requestAnimationFrame(watch);
    frames++;
    if (now - lastReport >= 1000) {
      var line = state();
      console.log('progress: ' + ((now - started) / 1000).toFixed(0) + ' s, ' + frames + ' frames, ' + line);
      lastReport = now; frames = 0; lastLine = line;
    }
    if (!titleAt && sceneName() === 'Scene_Title') { titleAt = now; nextTap = now + 3000; }
    if (titleAt && now >= nextTap) {
      nextTap = now + 1200;
      if (sceneName() === 'Scene_Name' && SceneManager._scene._inputWindow && SceneManager._scene._inputWindow.onNameOk) {
        SceneManager._scene._inputWindow.onNameOk();
      } else {
        player.onKey(90, true);
        setTimeout(function () { player.onKey(90, false); }, 120);
      }
    }
    if (now - started >= SHOT_MS * (shots + 1)) { shots++; capture('potato-player-shot-' + shots + '.txt'); }
    if (now - started >= RUN_MS) return player.exit(0);
  }
  requestAnimationFrame(watch);
})();
