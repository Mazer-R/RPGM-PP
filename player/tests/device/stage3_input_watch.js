// Run next to a game (mvplayer --game <dir> --run this file) to check the
// controls. It logs every key change the player reports, so buttons pressed
// on the console show up in the log, and it logs the scene and the title
// menu's selected line once a second.
//
// With no one at the controls it also drives the game itself, through the
// same entry point the native player uses for real buttons: at the title it
// moves the cursor down and back up, confirms "new game", then keeps
// confirming for a while and reports the scenes the game went through. It
// saves a picture at the end (see stage2_title_watch.js for the format).
// Exits with 0 if the game left the title scene, 4 otherwise.
(function () {
  'use strict';
  var gl = player.gl;
  var started = performance.now();
  var lastReport = 0;
  var titleAt = 0;
  var scenes = [];
  var script = [];   // [milliseconds after the title appeared, key code]
  var RUN_MS = 45000;

  var nativeOnKey = player.onKey;
  player.onKey = function (keyCode, down) {
    console.log('watch: key ' + keyCode + (down ? ' down' : ' up'));
    nativeOnKey.call(player, keyCode, down);
  };

  function sceneName() {
    var scene = globalThis.SceneManager && SceneManager._scene;
    return scene ? scene.constructor.name : 'none';
  }
  function cursor() {
    var scene = SceneManager._scene;
    var menu = scene && scene._commandWindow;
    return menu ? ', menu line ' + menu.index() + (menu.active ? '' : ' (inactive)') : '';
  }
  function tap(at, keyCode) { script.push([at, keyCode, true], [at + 120, keyCode, false]); }

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
    var scene = sceneName();
    if (scenes[scenes.length - 1] !== scene) {
      scenes.push(scene);
      console.log('watch: scene ' + scene + ' at ' + ((now - started) / 1000).toFixed(1) + ' s');
    }
    if (now - lastReport >= 1000) {
      lastReport = now;
      console.log('watch: ' + ((now - started) / 1000).toFixed(0) + ' s, ' + scene + cursor());
    }
    if (!titleAt && scene === 'Scene_Title') {
      titleAt = now;
      tap(4000, 40);            // down: to the second line
      tap(5500, 38);            // up: back to "new game"
      tap(7000, 90);            // confirm
      for (var t = 9000; t < RUN_MS - 3000; t += 1500) tap(t, 90);  // keep confirming
      script.sort(function (a, b) { return a[0] - b[0]; });
    }
    while (titleAt && script.length && now - titleAt >= script[0][0]) {
      var step = script.shift();
      player.onKey(step[1], step[2]);
    }
    if (titleAt && now - titleAt >= 6500 && !watch.titleShot) { watch.titleShot = true; capture('mvplayer-shot-title.txt'); }
    if ((titleAt && now - titleAt >= RUN_MS) || now - started >= 100000) {
      capture('mvplayer-shot.txt');
      console.log('watch: scenes: ' + scenes.join(' > '));
      var left = scenes.indexOf('Scene_Title') >= 0 && scenes[scenes.length - 1] !== 'Scene_Title';
      return player.exit(left ? 0 : 4);
    }
  }
  requestAnimationFrame(watch);
})();
