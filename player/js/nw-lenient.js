// A desktop player's interface that accepts whatever it is asked.
//
// One of the pieces a game's profile can switch on (engine-select.js). It is
// part of the desktop player's interface (NW.js), not of the browser.
//
// The common layers answer what the engine itself asks of the game's window
// and of the desktop player. Plugins ask for more: one that sets a game's
// resolution calls setResizable and setMinimumSize while it loads, and a
// call that does not exist stops the plugin from loading, and with it the
// game. Listing those calls one by one only works until the next plugin
// asks for another.
//
// Here the window is always the player's own, filling the screen or its
// desktop window, so nearly everything a script can ask of the desktop
// player has nothing to change. This piece makes that the rule: the window,
// the application, the screens, the shell and anything else under `nw`
// answer what they know as before, and accept any other call, to any depth,
// doing nothing. Each is noted once in the log as
// "not provided", so that a call that did need an answer can be found.
//
// What the window *is*, as opposed to what it does, is a short fixed list
// (whether it is full screen, its title ...) and has real values: a script
// that reads `isKioskMode` must get false, not something to call.
//
// This is right for the desktop player's interface only. The browser's own
// (document, canvas, sound) is not treated this way: accepting an unknown
// call there would let a game go on drawing or sounding wrong without a
// word.
(function () {
  'use strict';
  if (typeof require !== 'function') return;
  var gui = require('nw.gui');
  if (!gui || !gui.Window || typeof gui.Window.get !== 'function') return;
  var browser = globalThis.__browser || {};

  function note(path) {
    if (typeof browser.missing === 'function') browser.missing(path + ' (accepted: does nothing)');
  }
  // Something that is not there: it can be called, with anything, and asked
  // for any part of itself, and what comes back is the same again, so that
  // nw.Clipboard.get().set(text) goes through. It is not a promise, and it
  // writes out as nothing. (It does count as true in a condition: a script
  // that tests the answer of a call the player does not know is told yes.)
  function absent(path) {
    return new Proxy(function () {}, {
      apply: function () { return absent(path + '()'); },
      construct: function () { return absent(path); },
      get: function (target, key) {
        if (key === 'then' || typeof key === 'symbol') return key === Symbol.toPrimitive ? function () { return ''; } : undefined;
        if (key === 'toString' || key === 'valueOf') return function () { return ''; };
        return absent(path + '.' + key);
      },
    });
  }
  // `known` as it is, and anything else it is asked for accepted.
  function lenient(known, path) {
    var noted = {};
    return new Proxy(known, {
      get: function (target, key) {
        if (key in target || typeof key === 'symbol' || key === 'then') return target[key];
        if (!noted[key]) { noted[key] = true; note(path + '.' + key); }
        return absent(path + '.' + key);
      },
    });
  }

  var win = gui.Window.get();
  if (!win) return;
  if (!('isKioskMode' in win)) win.isKioskMode = false;
  if (!('isAlwaysOnTop' in win)) win.isAlwaysOnTop = false;
  if (!('isTransparent' in win)) win.isTransparent = false;
  if (!('zoomLevel' in win)) win.zoomLevel = 0;
  if (!('title' in win)) {
    Object.defineProperty(win, 'title', {
      get: function () { return document.title; },
      set: function (value) { document.title = String(value); },
    });
  }
  var shownWindow = lenient(win, 'nw.Window');
  gui.Window.get = function () { return shownWindow; };

  // The list of screens holds one: the area the game is shown in.
  var screens = gui.Screen && gui.Screen.screens;
  if (screens && screens.length === 0) {
    var area = function () { return { x: 0, y: 0, width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 }; };
    screens.push({ id: 0, bounds: area(), work_area: area(), scaleFactor: 1, isBuiltIn: true, rotation: 0, touchSupport: 0 });
  }

  ['Window', 'App', 'Screen', 'Shell'].forEach(function (part) {
    if (gui[part] && typeof gui[part] === 'object') gui[part] = lenient(gui[part], 'nw.' + part);
  });
  // The global `nw` is the same interface (nw-global.js); other parts of it
  // (the clipboard, the tray ...) are accepted too.
  if (globalThis.nw === gui) globalThis.nw = lenient(gui, 'nw');
})();
