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
