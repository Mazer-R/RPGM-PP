// Run next to a game (potato-player --game <dir> --run this file) to check that
// the game reaches its title screen. Once a second it logs the scene the
// engine is in. Some seconds after the title scene appears it reads the
// picture back, logs how much of it is lit, saves it as text in the game's
// save folder (potato-player-shot.txt: width, height, then base64 RGBA rows at
// half size) so it can be turned into an image on another machine, and
// exits with 0. It exits with 4 if the title is not reached in time.
(function () {
  'use strict';
  var gl = player.gl;
  var TITLE_HOLD_MS = 6000;
  var GIVE_UP_MS = 100000;
  var started = performance.now();
  var lastReport = 0;
  var titleAt = 0;
  var frames = 0;
  var titleFrame = 0;

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

  function capture() {
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    var pixels = new Uint8Array(w * h * 4);
    var bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
    var lit = 0;
    for (var i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++;
    console.log('watch: picture ' + w + 'x' + h + ', lit fraction ' + (lit / (w * h)).toFixed(3));
    // Half size, top row first (OpenGL rows start at the bottom).
    var hw = w >> 1, hh = h >> 1;
    var small = new Uint8Array(hw * hh * 4);
    for (var y = 0; y < hh; y++) {
      for (var x = 0; x < hw; x++) {
        var from = ((h - 1 - y * 2) * w + x * 2) * 4, to = (y * hw + x) * 4;
        small[to] = pixels[from]; small[to + 1] = pixels[from + 1]; small[to + 2] = pixels[from + 2]; small[to + 3] = 255;
      }
    }
    var saved = player.writeSaveFile(player.gameDir + '/save/potato-player-shot.txt', hw + '\n' + hh + '\n' + base64(small) + '\n');
    console.log('watch: picture saved: ' + saved);
  }

  function watch(now) {
    requestAnimationFrame(watch);
    frames++;
    if (now - lastReport >= 1000) {
      lastReport = now;
      console.log('watch: ' + ((now - started) / 1000).toFixed(0) + ' s, frame ' + frames + ', scene ' + sceneName());
    }
    if (!titleAt && sceneName() === 'Scene_Title') { titleAt = now; titleFrame = frames; }
    if (titleAt && now - titleAt >= TITLE_HOLD_MS) {
      console.log('watch: title scene at ' + ((titleAt - started) / 1000).toFixed(1) + ' s, then ' +
        ((frames - titleFrame) * 1000 / (now - titleAt)).toFixed(1) + ' frames per second');
      capture();
      return player.exit(0);
    }
    if (now - started >= GIVE_UP_MS) {
      console.error('watch: the title scene was not reached');
      capture();
      return player.exit(4);
    }
  }
  requestAnimationFrame(watch);
})();
