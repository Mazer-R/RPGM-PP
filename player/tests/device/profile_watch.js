// Run next to a game (potato-player --game <dir> --run this file) to see where
// the time of a frame goes. It starts a new game by confirming at the title
// and keeps confirming, and once a second logs, for the scene on screen:
// frames shown, and the average milliseconds per frame spent in the engine's
// logic step, in its drawing step, inside native canvas calls (with the
// costliest function) and inside texture uploads. Exits with 0 after RUN_MS.
(function () {
  'use strict';
  var RUN_MS = 60000;
  var started = performance.now();
  var titleAt = 0;
  var nextTap = 0;
  var bucket = null;
  function fresh() { return { at: performance.now(), frames: 0, logic: 0, steps: 0, draw: 0, canvas: 0, upload: 0, uploads: 0, byName: {} }; }

  function timeCalls(object, names, record) {
    names.forEach(function (name) {
      var native = object[name];
      if (typeof native !== 'function') return;
      object[name] = function () {
        var before = performance.now();
        try { return native.apply(this, arguments); }
        finally { if (bucket) record(name, performance.now() - before); }
      };
    });
  }
  timeCalls(player.canvas, Object.keys(player.canvas), function (name, ms) {
    bucket.canvas += ms;
    bucket.byName[name] = (bucket.byName[name] || 0) + ms;
  });
  timeCalls(player.gl, ['texImage2D', 'texSubImage2D'], function (name, ms) { bucket.upload += ms; bucket.uploads++; });
  timeCalls(SceneManager, ['updateScene'], function (name, ms) { bucket.logic += ms; bucket.steps++; });
  timeCalls(SceneManager, ['renderScene'], function (name, ms) { bucket.draw += ms; });

  function sceneName() {
    var scene = SceneManager._scene;
    return scene ? scene.constructor.name : 'none';
  }
  function report() {
    var b = bucket, n = Math.max(1, b.frames);
    var top = Object.keys(b.byName).sort(function (x, y) { return b.byName[y] - b.byName[x]; })[0];
    var map = sceneName().indexOf('Map') >= 0 && globalThis.$gameMap ? ' map ' + $gameMap.mapId() + ' events ' + $gameMap.events().length : '';
    console.log('profile: ' + sceneName() + map + ': ' + b.frames + ' frames, per frame: logic ' + (b.logic / n).toFixed(1) +
      ' ms (' + (b.steps / n).toFixed(1) + ' steps), draw ' + (b.draw / n).toFixed(1) + ' ms, canvas ' + (b.canvas / n).toFixed(1) +
      ' ms' + (top ? ' (most: ' + top + ' ' + (b.byName[top] / n).toFixed(1) + ')' : '') + ', uploads ' + (b.upload / n).toFixed(1) +
      ' ms in ' + (b.uploads / n).toFixed(1));
  }

  function watch(now) {
    requestAnimationFrame(watch);
    if (!bucket) bucket = fresh();
    bucket.frames++;
    if (now - bucket.at >= 1000) { report(); bucket = fresh(); }
    if (!titleAt && sceneName() === 'Scene_Title') { titleAt = now; nextTap = now + 3000; }
    // Leave the name entry screen through its own confirm action.
    if (titleAt && now >= nextTap) {
      nextTap = now + 1200;
      if (sceneName() === 'Scene_Name' && SceneManager._scene._inputWindow) {
        SceneManager._scene._inputWindow.onNameOk();
      } else {
        player.onKey(90, true);
        setTimeout(function () { player.onKey(90, false); }, 120);
      }
    }
    if (now - started >= RUN_MS) {
      console.log('profile: patch counters ' + JSON.stringify(player.patchStats || {}));
      return player.exit(0);
    }
  }
  requestAnimationFrame(watch);
})();
