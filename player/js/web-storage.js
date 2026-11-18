// The browser's IndexedDB, as far as being there.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// MZ refuses to start in a browser without IndexedDB, where a web game keeps
// its saves. A game on the player is a desktop game and saves to files, so
// nothing is ever stored through this: it is only there to be found.
(function () {
  'use strict';
  if (!globalThis.indexedDB) globalThis.indexedDB = {};
})();
