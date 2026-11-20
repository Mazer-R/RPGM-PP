// Run next to a game (potato-player --game <dir> --run this file) to visit a list
// of maps one after another and see whether each one loads and how it runs.
// The list is the global MAP_TOUR, an array of {id, x, y}, which must be
// defined before this file runs (the caller prepends it). The tour starts
// from save file 1 when there is one, otherwise from a new game.
//
// For each map it logs when the transfer is asked for (so a map that never
// finishes loading is the last one named), how long the map took to appear,
// and then once a second the frame rate and where each frame's time went.
// Memory held by canvases, images and textures is logged at each transfer. Exits with 0 at the end.
(function () {
  'use strict';
  var STAY_MS = 12000;
  var tour = globalThis.MAP_TOUR || [];
  var next = 0, stage = 'boot', askedAt = 0, arrivedAt = 0, lastReport = 0, frames = 0, work = 0;

  function sceneName() {
    var scene = globalThis.SceneManager && SceneManager._scene;
    return scene ? scene.constructor.name : 'none';
  }
  function memory() {
    return (player.canvas.bytesInUse() / 1048576).toFixed(0) + ' MB in canvases and images, ' +
      (player.gl.textureBytes() / 1048576).toFixed(0) + ' MB in textures';
  }
  function ask(now) {
    if (next >= tour.length) { console.log('tour: finished, ' + memory()); return player.exit(0); }
    var stop = tour[next++];
    console.log('tour: asking for map ' + stop.id + ' (' + memory() + ')');
    $gamePlayer.reserveTransfer(stop.id, stop.x, stop.y, 2, 0);
    if (sceneName() !== 'Scene_Map') SceneManager.goto(Scene_Map);
    stage = 'loading'; askedAt = now;
  }

  // Time per frame, split into the engine's logic steps, its drawing step,
  // and (inside those) native canvas calls and texture uploads.
  var t = { logic: 0, steps: 0, draw: 0, canvas: 0, upload: 0, byName: {} };
  function timeCalls(object, names, record) {
    names.forEach(function (name) {
      var native = object[name];
      if (typeof native !== 'function') return;
      object[name] = function () {
        var before = performance.now();
        try { return native.apply(this, arguments); }
        finally { record(name, performance.now() - before); }
      };
    });
  }
  timeCalls(SceneManager, ['updateScene'], function (name, ms) { t.logic += ms; t.steps++; });
  timeCalls(SceneManager, ['renderScene'], function (name, ms) { t.draw += ms; });
  timeCalls(player.canvas, Object.keys(player.canvas).filter(function (k) { return k !== 'bytesInUse'; }), function (name, ms) {
    t.canvas += ms; t.byName[name] = (t.byName[name] || 0) + ms;
  });
  timeCalls(player.gl, ['texImage2D', 'texSubImage2D'], function (name, ms) { t.upload += ms; });
  function split(n) {
    var top = Object.keys(t.byName).sort(function (a, b) { return t.byName[b] - t.byName[a]; })[0];
    var text = 'logic ' + (t.logic / n).toFixed(1) + ' ms in ' + (t.steps / n).toFixed(1) + ' steps, draw ' + (t.draw / n).toFixed(1) +
      ' ms, canvas ' + (t.canvas / n).toFixed(1) + ' ms' + (top ? ' (' + top + ')' : '') + ', uploads ' + (t.upload / n).toFixed(1) + ' ms';
    t = { logic: 0, steps: 0, draw: 0, canvas: 0, upload: 0, byName: {} };
    return text;
  }

  function watch(now) {
    requestAnimationFrame(watch);
    frames++;
    var scene = sceneName();
    if (stage === 'boot' && scene === 'Scene_Title') {
      if (DataManager.isAnySavefileExists() && DataManager.loadGame(1)) console.log('tour: loaded save file 1');
      else DataManager.setupNewGame();
      SceneManager.goto(Scene_Map);
      stage = 'settle'; arrivedAt = now;
    } else if (stage === 'settle' && scene === 'Scene_Map' && now - arrivedAt > 4000) {
      ask(now);
    } else if (stage === 'loading' && scene === 'Scene_Map' && SceneManager._scene.isActive && SceneManager._scene.isActive() &&
               $gameMap.mapId() === tour[next - 1].id && !$gamePlayer.isTransferring()) {
      console.log('tour: map ' + $gameMap.mapId() + ' appeared after ' + ((now - askedAt) / 1000).toFixed(1) + ' s, ' +
        $gameMap.events().length + ' events, ' + memory());
      stage = 'staying'; arrivedAt = now; lastReport = now; frames = 0; split(1);
    } else if (stage === 'loading' && now - askedAt > 60000) {
      console.error('tour: map ' + tour[next - 1].id + ' did not appear in 60 s (scene ' + scene + ')');
      ask(now);
    } else if (stage === 'staying') {
      if (now - lastReport >= 1000) {
        console.log('tour: map ' + $gameMap.mapId() + ': ' + frames + ' frames, per frame: ' + split(Math.max(1, frames)));
        lastReport = now; frames = 0;
      }
      if (now - arrivedAt > STAY_MS) ask(now);
    }
  }
  requestAnimationFrame(watch);
})();
