// Which engine a game uses, and the layers the player loads for it.
//
// RPG Maker MV and MZ games are run by separate sets of layers so that what
// is done for one cannot change how the other runs. An MV game gets the
// layers below and nothing else. An MZ game gets the same ones and then its
// own, which are loaded last and may replace parts of the earlier ones;
// everything that only MZ needs lives in those.
//
// Plain functions, no files: boot.js gives them what they need.
(function () {
  'use strict';
  var COMMON = ['file-bytes.js', 'css.js', 'video.js', 'dom.js', 'canvas2d.js', 'desktop.js', 'patch-select.js'];
  var ONLY = { MZ: ['base64.js', 'mz.js'] };

  // gameDir is the folder with the game's index.html; fileExists(path) says
  // whether a file is there. Each engine is known by its core script.
  function engineOf(gameDir, fileExists) {
    return fileExists(gameDir + '/js/rmmz_core.js') ? 'MZ' : 'MV';
  }

  function layersFor(engine, hasAudio) {
    return COMMON.concat(hasAudio ? ['audio.js'] : [], ONLY[engine] || []);
  }

  globalThis.__engineSelect = { engineOf: engineOf, layersFor: layersFor };
})();
