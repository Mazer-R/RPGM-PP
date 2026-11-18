// Which engine a game uses, and the layers the player loads for it.
//
// Every game gets the common layers: the browser and desktop-player
// stand-in as the first engine supported, RPG Maker MV, needs it. On top of
// them each engine has a profile: the list of extra pieces switched on for
// its games, loaded after the common layers, in the order given.
//
// A piece is a part of the browser (web-*.js), of the desktop player
// (nw-*.js) or of the player's duty to the script engine (engine-*.js) that
// MV never asked for. None of those knows which engine the game uses: such
// a piece is written once and any profile can list it. The few things that
// do belong to one engine are pieces named after it (mz-*.js).
//
// MV's profile is empty and a test pins it. That is deliberate: MV games are
// what already works, so nothing added for another engine can change how
// they run. A piece goes on MV's list only on purpose, after an MV game has
// been run with it.
//
// Plain functions, no files: boot.js gives them what they need.
(function () {
  'use strict';
  var COMMON = ['file-bytes.js', 'css.js', 'video.js', 'dom.js', 'canvas2d.js', 'desktop.js', 'patch-select.js'];
  var PROFILES = {
    MV: [],
    MZ: [
      'web-base64.js',    // atob, btoa: the sound decoder library, while loading
      'web-load.js',      // load event after pending work: main.js's file check
      'web-fonts.js',     // FontFace, document.fonts: the engine's fonts
      'web-storage.js',   // indexedDB is there: a start-up check
      'nw-global.js',     // the global nw: game options, developer tools
      'web-workers.js',   // Worker can be made: the sound decoder library
      'engine-tasks.js',  // V8's queued work: WebAssembly finishes compiling
      'web-media.js',     // video.play() is a promise: every key press
      'web-page.js',      // elements the page declares with an id
      'mz-files.js',      // MZ's names for encrypted images and sounds
      'mz-perf.js',       // where MZ's frames, steps and drawing are
    ],
  };

  // gameDir is the folder with the game's index.html; fileExists(path) says
  // whether a file is there. Each engine is known by its core script.
  function engineOf(gameDir, fileExists) {
    return fileExists(gameDir + '/js/rmmz_core.js') ? 'MZ' : 'MV';
  }

  function layersFor(engine, hasAudio) {
    return COMMON.concat(hasAudio ? ['audio.js'] : [], PROFILES[engine] || []);
  }

  globalThis.__engineSelect = { engineOf: engineOf, layersFor: layersFor, PROFILES: PROFILES };
})();
