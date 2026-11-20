// Run next to a game (potato-player --game <dir> --run this file) to record what
// the game shows without touching the controls. Every time the scene changes
// it logs the scene's name, and it saves a picture two seconds into each new
// scene (potato-player-shot-<n>-<scene>.txt in the game's save folder; see
// title_watch.js for the format), for the first SHOTS scenes. Once a
// second it logs the frame rate. Exits with 0 after RUN_MS.
(function () {
  'use strict';
  var gl = player.gl;
  var RUN_MS = 45000, SHOTS = 6;
  var started = performance.now();
  var current = '', since = 0, shots = 0, shotTaken = true, frames = 0, lastReport = 0;

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

  function watch(now) {
    requestAnimationFrame(watch);
    frames++;
    var scene = sceneName();
    if (scene !== current) {
      current = scene; since = now; shotTaken = shots >= SHOTS;
      console.log('screens: scene ' + scene + ' at ' + ((now - started) / 1000).toFixed(1) + ' s' +
        (scene.indexOf('Map') >= 0 && globalThis.$gameMap ? ', map ' + $gameMap.mapId() : ''));
    }
    if (!shotTaken && now - since >= 2000) {
      shotTaken = true; shots++;
      capture('potato-player-shot-' + shots + '-' + scene + '.txt');
    }
    if (now - lastReport >= 1000) { console.log('screens: ' + scene + ', ' + frames + ' frames'); lastReport = now; frames = 0; }
    if (now - started >= RUN_MS) return player.exit(0);
  }
  requestAnimationFrame(watch);
})();
