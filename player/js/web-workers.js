// The browser's Worker, as far as being made.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
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
