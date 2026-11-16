// Starts a game. The native player runs this file when it is given --game.
//
// It loads the layers that stand in for the browser and for the desktop
// player (NW.js), then loads the game's own scripts in the order its
// index.html lists them, and finally fires the page's "load" event, which is
// what starts the engine.
(function () {
  'use strict';
  var layers = ['file-bytes.js', 'css.js', 'dom.js', 'canvas2d.js', 'desktop.js', 'patch-select.js'];
  if (player.audio) layers.push('audio.js');
  for (var i = 0; i < layers.length; i++) {
    if (!player.loadScript(player.playerDir + '/js/' + layers[i])) {
      console.error('boot: cannot load ' + layers[i]);
      return player.exit(2);
    }
  }
  var browser = globalThis.__browser;

  // Patches are JavaScript files in the player's patches/ folder that change
  // how a game runs, without touching its files. index.json lists them, each
  // with what it depends on (the engine, a plugin, one game); patch-select.js
  // decides which of them this game gets. Each patch file adds an install
  // function to player.patches. They are installed when the engine has
  // finished booting, just before the first real scene.
  // Every ten seconds of play, one log line says how the game ran: where
  // (scene and map), frames shown, logic steps per frame, and the average
  // time of a logic step and of a drawing step, with the slowest frame. It
  // costs two clock readings per step, and lets a slow stretch of real play
  // be understood afterwards from the log alone.
  //
  // When a period ran below SLOW_FPS, the next period is also sampled with
  // the engine's profiler, and the functions where the scripts spent most
  // time are logged. This happens at most MAX_PROFILES times per run.
  function installPerformanceLog() {
    if (!globalThis.SceneManager || !SceneManager.updateScene || !SceneManager.renderScene) return;
    var PERIOD_MS = 10000, SLOW_FPS = 22, MAX_PROFILES = 4;
    var profiling = false, profiles = 0;
    var since = performance.now(), frames = 0, steps = 0, logic = 0, draw = 0, worst = 0, frameStart = 0, lastFrameEnd = 0;
    var updateScene = SceneManager.updateScene, renderScene = SceneManager.renderScene, updateMain = SceneManager.updateMain;
    SceneManager.updateScene = function () {
      var before = performance.now();
      try { return updateScene.apply(this, arguments); }
      finally { logic += performance.now() - before; steps++; }
    };
    SceneManager.renderScene = function () {
      var before = performance.now();
      try { return renderScene.apply(this, arguments); }
      finally { draw += performance.now() - before; }
    };
    SceneManager.updateMain = function () {
      var now = performance.now();
      if (lastFrameEnd) worst = Math.max(worst, now - lastFrameEnd);
      lastFrameEnd = now;
      frames++;
      if (now - since >= PERIOD_MS) {
        var scene = this._scene ? this._scene.constructor.name : 'none';
        var where = scene + (globalThis.$gameMap && /Map/.test(scene) ? ' map ' + $gameMap.mapId() + ' (' + $gameMap.events().length + ' events)' : '');
        console.info('perf: ' + where + ': ' + (frames * 1000 / (now - since)).toFixed(0) + ' frames per second, ' +
          (steps / frames).toFixed(1) + ' steps per frame, logic ' + (logic / Math.max(1, steps)).toFixed(1) + ' ms per step, draw ' +
          (draw / frames).toFixed(1) + ' ms per frame, slowest frame ' + worst.toFixed(0) + ' ms');
        if (profiling) {
          profiling = false;
          console.info('perf: where the scripts spent their own time in that period (share of samples):');
          player.stopProfile(28).forEach(function (line) { console.info('perf:   ' + line); });
        } else if (player.startProfile && profiles < MAX_PROFILES && frames * 1000 / (now - since) < SLOW_FPS && /Map|Battle/.test(scene)) {
          profiling = true; profiles++;
          player.startProfile();
        }
        since = now; frames = 0; steps = 0; logic = 0; draw = 0; worst = 0;
      }
      return updateMain.apply(this, arguments);
    };
  }

  // What the game switched off: <game>/save/mvplayer-patches.json, written by
  // hand, of the form { "off": ["framePacing"] }.
  function switchedOff() {
    var text = player.readTextFile(player.gameDir + '/save/mvplayer-patches.json');
    if (text === null) return [];
    try {
      var off = JSON.parse(text).off;
      return Array.isArray(off) ? off.map(String) : [];
    } catch (error) {
      console.warn('patches: save/mvplayer-patches.json is not valid: ' + error);
      return [];
    }
  }
  function selectPatches() {
    if (player.noPatches) return console.info('patches: switched off'), [];
    var text = player.readTextFile(player.playerDir + '/patches/index.json');
    if (text === null) return [];
    var game = {
      title: document.title,
      engine: globalThis.Utils && Utils.RPGMAKER_NAME,
      plugins: (globalThis.$plugins || []).filter(function (p) { return p.status; }).map(function (p) { return p.name; }),
    };
    var result = globalThis.__patchSelect.select(JSON.parse(text), game, switchedOff());
    result.notes.forEach(function (note) { console.info('patches: ' + note); });
    return result.selected;
  }
  function installPatches() {
    player.patches = {};
    player.patchStats = {};
    player.patchTools = globalThis.__patchSelect;
    var selected;
    try { selected = selectPatches(); }
    catch (error) { return console.error('patches: index.json: ' + error); }
    if (!selected.length) return console.info('patches: none for "' + document.title + '"');
    if (!globalThis.Scene_Boot) return;
    var start = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function () {
      selected.forEach(function (rule) {
        try {
          if (!player.loadScript(player.playerDir + '/patches/' + rule.file)) throw new Error('cannot load ' + rule.file);
          // A patch that held back, wholly or in part, says why.
          var heldBack = player.patches[rule.patch](rule.options || {});
          console.info('patches: installed ' + rule.patch + ' ' + JSON.stringify(rule.options || {}) +
            (heldBack ? ' (' + heldBack + ')' : ''));
        } catch (error) {
          console.error('patches: ' + rule.patch + ' not installed: ' + (error && error.stack ? error.stack : error));
        }
      });
      return start.apply(this, arguments);
    };
  }

  var html = player.readTextFile(player.gameDir + '/index.html');
  if (html === null) {
    console.error('boot: no index.html in ' + player.gameDir);
    return player.exit(2);
  }
  var title = /<title>([^<]*)<\/title>/.exec(html);
  if (title) {
    document.title = title[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  // Fonts the page declares, e.g. GameFont in fonts/gamefont.css.
  var sheet = /<link[^>]+href="([^"]+\.css)"/.exec(html);
  if (sheet) browser.registerFontsFromCss(sheet[1]);

  // Libraries replaced by inert stand-ins instead of being loaded: an
  // on-screen frame counter built from page elements, and a video helper for
  // phones.
  var skipped = ['fpsmeter.js', 'iphone-inline-video.browser.js'];
  var pattern = /<script[^>]+src="([^"]+)"/g;
  var match;
  var count = 0;
  while ((match = pattern.exec(html))) {
    var source = match[1];
    if (skipped.some(function (name) { return source.slice(-name.length) === name; })) continue;
    if (!browser.runScript(source)) {
      console.error('boot: script failed: ' + source);
      return player.exit(2);
    }
    count++;
  }
  console.info('boot: ' + count + ' scripts loaded from index.html');
  installPatches();
  installPerformanceLog();

  // The engine catches its own errors and shows them on the page. Record the
  // full error in the log as well, and stop: the on-screen error display
  // belongs to a later stage.
  if (globalThis.SceneManager && typeof SceneManager.catchException === 'function') {
    var catchException = SceneManager.catchException;
    SceneManager.catchException = function (error) {
      console.error('game error: ' + (error && error.stack ? error.stack : error));
      catchException.apply(this, arguments);
      player.exit(3);
    };
  }
  browser.fireLoad();
})();
