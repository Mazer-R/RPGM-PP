// The desktop player's interface as the global `nw`.
//
// One of the pieces a game's profile can switch on (engine-select.js). It is
// part of the desktop player's interface (NW.js), not of the browser.
//
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
