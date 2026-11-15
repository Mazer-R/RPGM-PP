// Starts a game. The native player runs this file when it is given --game.
//
// It loads the layers that stand in for the browser and for the desktop
// player (NW.js), then loads the game's own scripts in the order its
// index.html lists them, and finally fires the page's "load" event, which is
// what starts the engine.
(function () {
  'use strict';
  var layers = ['css.js', 'dom.js', 'canvas2d.js', 'desktop.js'];
  for (var i = 0; i < layers.length; i++) {
    if (!player.loadScript(player.playerDir + '/js/' + layers[i])) {
      console.error('boot: cannot load ' + layers[i]);
      return player.exit(2);
    }
  }
  var browser = globalThis.__browser;

  // Patches are JavaScript files in the player's patches/ folder that change
  // how one particular game runs, without touching its files. index.json
  // says which patches belong to which game; a game is recognised by its
  // title, its engine and the plugins it has switched on. Each patch file
  // adds an install function to player.patches. They are installed when the
  // engine has finished booting, just before the first real scene.
  function selectPatches() {
    if (player.noPatches) return console.info('patches: switched off'), [];
    var text = player.readTextFile(player.playerDir + '/patches/index.json');
    if (text === null) return [];
    var active = (globalThis.$plugins || []).filter(function (p) { return p.status; }).map(function (p) { return p.name; });
    var selected = [];
    JSON.parse(text).forEach(function (entry) {
      var m = entry.match || {};
      if (m.title && m.title !== document.title) return;
      if (m.engine && !(globalThis.Utils && Utils.RPGMAKER_NAME === m.engine)) return;
      if ((m.plugins || []).some(function (name) { return active.indexOf(name) < 0; })) return;
      console.info('patches: this game is "' + entry.game + '"');
      selected = selected.concat(entry.patches || []);
    });
    return selected;
  }
  function installPatches() {
    player.patches = {};
    player.patchStats = {};
    var selected;
    try { selected = selectPatches(); }
    catch (error) { return console.error('patches: index.json: ' + error); }
    if (!selected.length) return console.info('patches: none for "' + document.title + '"');
    if (!globalThis.Scene_Boot) return;
    var start = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function () {
      selected.forEach(function (patch) {
        try {
          if (!player.loadScript(player.playerDir + '/patches/' + patch.file)) throw new Error('cannot load ' + patch.file);
          player.patches[patch.name](patch.options || {});
          console.info('patches: installed ' + patch.name + ' ' + JSON.stringify(patch.options || {}));
        } catch (error) {
          console.error('patches: ' + patch.name + ' not installed: ' + (error && error.stack ? error.stack : error));
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
