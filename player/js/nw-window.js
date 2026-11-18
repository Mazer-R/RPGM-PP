// The rest of the desktop player's window and screen interface.
//
// One of the pieces a game's profile can switch on (engine-select.js). It is
// part of the desktop player's interface (NW.js), not of the browser.
//
// The common layers answer what the engine itself asks of the game's window
// (moving, resizing, full screen, the developer tools). Plugins ask for more
// of it: one that sets a game's resolution calls setResizable,
// setMinimumSize and setPosition while it loads, and a call that does not
// exist stops the plugin from loading, and with it the game. Here the window
// is always the player's own, filling the screen or its desktop window, so
// these calls have nothing to change: they are accepted and do nothing.
// What the window already answers is left as it is.
//
// The list of screens holds one: the area the game is shown in.
(function () {
  'use strict';
  if (typeof require !== 'function') return;
  var gui = require('nw.gui');
  if (!gui || !gui.Window || typeof gui.Window.get !== 'function') return;
  var win = gui.Window.get();
  if (!win) return;

  ['setResizable', 'setMinimumSize', 'setMaximumSize', 'setPosition', 'maximize', 'unmaximize', 'minimize', 'restore',
    'enterKioskMode', 'leaveKioskMode', 'toggleKioskMode', 'setAlwaysOnTop', 'setShowInTaskbar', 'requestAttention',
    'blur', 'reload', 'reloadIgnoringCache', 'reloadDev', 'setProgressBar', 'setBadgeLabel', 'setShadow',
    'setVisibleOnAllWorkspaces', 'setTransparent', 'removeListener', 'capturePage', 'print'
  ].forEach(function (name) {
    if (!(name in win)) win[name] = function () {};
  });
  if (!('canSetVisibleOnAllWorkspaces' in win)) win.canSetVisibleOnAllWorkspaces = function () { return false; };
  if (!('isKioskMode' in win)) win.isKioskMode = false;
  if (!('isAlwaysOnTop' in win)) win.isAlwaysOnTop = false;
  if (!('zoomLevel' in win)) win.zoomLevel = 0;
  if (!('title' in win)) {
    Object.defineProperty(win, 'title', {
      get: function () { return document.title; },
      set: function (value) { document.title = String(value); },
    });
  }

  var screens = gui.Screen && gui.Screen.screens;
  if (screens && screens.length === 0) {
    var area = function () { return { x: 0, y: 0, width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 }; };
    screens.push({ id: 0, bounds: area(), work_area: area(), scaleFactor: 1, isBuiltIn: true, rotation: 0, touchSupport: 0 });
  }
})();
