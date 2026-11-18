// What only RPG Maker MZ games need. Loaded after every other layer, and
// only for an MZ game (see engine-select.js): nothing here runs for MV.
(function () {
  'use strict';
  var browser = globalThis.__browser;

  // The page's load event, which starts the engine, comes after what the
  // page's scripts had already asked for, as in a browser. MZ's main.js
  // reads a file while the scripts load and refuses to start ("Your browser
  // does not allow to read local files") if the answer has not arrived by
  // the time of the load event.
  var fireLoad = browser.fireLoad;
  browser.fireLoad = function () { browser.later(fireLoad); };
})();

// --- Fonts -------------------------------------------------------------------
// MZ loads its fonts through the browser's font loading interface: it makes
// a FontFace from a family name and "url(fonts/file.woff)", waits for its
// load(), and adds it to document.fonts. Before starting it checks that
// document.fonts.ready is there. Here load() gives the file to the player's
// own text drawing under that family name (browser.registerFont).
(function () {
  'use strict';
  var browser = globalThis.__browser;
  var loaded = [];

  function FontFace(family, source) {
    this.family = String(family);
    this.status = 'unloaded';
    var match = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(String(source));
    this._url = match ? (match[1] || match[2] || match[3] || '').trim() : '';
    var font = this;
    this.loaded = new Promise(function (resolve, reject) { font._settle = { resolve: resolve, reject: reject }; });
    this.loaded.catch(function () {});  // a failure nobody waits for is not an error of its own
  }
  FontFace.prototype.load = function () {
    if (this.status === 'unloaded') {
      var ok = !!this._url && browser.registerFont(this.family, this._url);
      this.status = ok ? 'loaded' : 'error';
      if (ok) this._settle.resolve(this);
      else this._settle.reject(new Error('font: cannot load ' + this._url + ' for ' + this.family));
    }
    return this.loaded;
  };
  globalThis.FontFace = FontFace;

  document.fonts = {
    ready: Promise.resolve(),
    add: function (font) { if (loaded.indexOf(font) < 0) loaded.push(font); return this; },
    // check('20px family'): whether text in that font can be drawn now.
    check: function (font) {
      return loaded.some(function (face) { return String(font).indexOf(face.family) >= 0; });
    },
  };
  document.fonts.ready = Promise.resolve(document.fonts);
})();

// --- IndexedDB ---------------------------------------------------------------
// MZ refuses to start in a browser without IndexedDB, where a web game keeps
// its saves. A game on the player is a desktop game and saves to files, so
// nothing is ever stored through this: it is only there to be found.
(function () {
  'use strict';
  if (!globalThis.indexedDB) globalThis.indexedDB = {};
})();

// --- The desktop player ------------------------------------------------------
// MV asks for the desktop player's interface with require('nw.gui'); MZ uses
// the global `nw`, which newer versions of that player offer, and reads the
// options the game was started with from nw.App.argv ("test", "btest" ...).
// A game here is started without any.
(function () {
  'use strict';
  if (globalThis.nw || typeof require !== 'function') return;
  var gui = require('nw.gui');
  if (!gui) return;
  gui.App = gui.App || {};
  if (!gui.App.argv) gui.App.argv = [];
  globalThis.nw = gui;
})();

// --- Workers -----------------------------------------------------------------
// MZ's sound decoder library (js/libs/vorbisdecoder.js) starts a Worker while
// it loads, to decode Ogg Vorbis in browsers that cannot play it. The engine
// uses that decoder only when the browser says it cannot play Ogg, and the
// player plays Ogg itself, so the worker is never given work. It can be
// made, and does nothing: no script is run and no message is ever answered.
(function () {
  'use strict';
  if (typeof globalThis.Worker === 'function') return;
  function Worker(url) { this.url = String(url); this.onmessage = null; this.onerror = null; }
  Worker.prototype.addEventListener = function () {};
  Worker.prototype.removeEventListener = function () {};
  Worker.prototype.postMessage = function () {};
  Worker.prototype.terminate = function () {};
  globalThis.Worker = Worker;
})();

// --- Work the engine queues --------------------------------------------------
// V8 finishes some things through tasks it queues for the main thread, and
// they only run when the player runs them. Compiling WebAssembly is one:
// MZ's animation library (Effekseer) waits on WebAssembly.instantiate(),
// whose promise is settled by such a task, and the game does not start
// until it is. They are run once a frame. MV games never needed this and
// are not given it.
(function () {
  'use strict';
  if (typeof player === 'undefined' || typeof player.runEngineTasks !== 'function') return;
  if (typeof requestAnimationFrame !== 'function') return;
  function everyFrame() {
    player.runEngineTasks();
    requestAnimationFrame(everyFrame);
  }
  requestAnimationFrame(everyFrame);
})();

// --- Video elements ----------------------------------------------------------
// In a browser, play() on a video element gives a promise. MZ relies on
// that: on every key press, click and touch it calls play() on its video
// element and adds .catch() to the result, so without a promise each key
// press ends in an error and never reaches the game. The player's own
// play() gives nothing back; here it is wrapped to give a promise.
(function () {
  'use strict';
  var browser = globalThis.__browser;
  var makeVideo = browser.makeVideo;
  if (typeof makeVideo !== 'function') return;
  browser.makeVideo = function () {
    var video = makeVideo.apply(this, arguments);
    var play = video.play;
    video.play = function () {
      try { return Promise.resolve(play.apply(this, arguments)); }
      catch (error) { return Promise.reject(error); }
    };
    return video;
  };
})();
