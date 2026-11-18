// The page's load event, in its place.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// The load event, which starts the engine, comes after what the page's
// scripts had already asked for, as in a browser. RPG Maker MZ's main.js
// reads a file while the scripts load and refuses to start ("Your browser
// does not allow to read local files") if the answer has not arrived by the
// time of the load event.
(function () {
  'use strict';
  var browser = globalThis.__browser;

  var fireLoad = browser.fireLoad;
  browser.fireLoad = function () { browser.later(fireLoad); };
})();
