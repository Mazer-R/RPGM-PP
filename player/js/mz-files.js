// How RPG Maker MZ names its files.
//
// One of the pieces of MZ's profile (engine-select.js). Unlike the web-*
// pieces it is about one engine: MV has its own names, which the common
// layers know.
//
// MZ encrypts a file by the same scheme as MV (a 16-byte marker, then the
// file with its first 16 bytes scrambled) but keeps the file's name and adds
// an underscore: Window.png_, Theme.ogg_. The player gives the engine only
// the start of such files, as it does for MV's .rpgmvp and .rpgmvo (see
// file-bytes.js); this tells it which names those are.
(function () {
  'use strict';
  var browser = globalThis.__browser;
  browser.soundFiles = /\.(ogg|m4a)_?$/i;
  browser.startOnlyFiles = /\.png_$/i;
})();
