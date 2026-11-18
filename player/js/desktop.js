// What the game sees of the desktop player (NW.js): the `require` function
// and the `process` object. The engine checks for these two to decide that it
// runs as a desktop game, and then saves to files in the game's own save
// folder instead of browser storage.
//
// File writes are only possible inside <game>/save: the native side refuses
// anything else.
(function () {
  'use strict';
  var browser = globalThis.__browser;

  function fail(message, code) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  var path = {
    sep: '/',
    dirname: function (p) {
      p = String(p).replace(/\/+$/, '');
      var i = p.lastIndexOf('/');
      return i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i);
    },
    basename: function (p, ext) {
      var name = String(p).replace(/\/+$/, '').split('/').pop();
      if (ext && name.slice(-ext.length) === ext) name = name.slice(0, -ext.length);
      return name;
    },
    extname: function (p) {
      var m = /[^\/.](\.[^\/.]*)$/.exec(String(p));
      return m ? m[1] : '';
    },
    normalize: function (p) {
      p = String(p);
      var absolute = p.charAt(0) === '/';
      var trailing = p.length > 1 && p.slice(-1) === '/';
      var out = [];
      p.split('/').forEach(function (part) {
        if (!part || part === '.') return;
        if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
        else if (part !== '..' || !absolute) out.push(part);
      });
      return (absolute ? '/' : '') + out.join('/') + (trailing && out.length ? '/' : '') || '.';
    },
    join: function () {
      return path.normalize(Array.prototype.filter.call(arguments, Boolean).join('/'));
    },
    resolve: function () {
      var result = '';
      for (var i = arguments.length - 1; i >= 0 && result.charAt(0) !== '/'; i--) {
        if (arguments[i]) result = arguments[i] + (result ? '/' + result : '');
      }
      if (result.charAt(0) !== '/') result = player.gameDir + '/' + result;
      return path.normalize(result);
    },
    isAbsolute: function (p) { return String(p).charAt(0) === '/'; },
  };

  // Paths the game builds are absolute; a relative one is taken from the game
  // folder, which is the working directory the desktop player gives a game.
  function absolute(p) { return path.resolve(String(p)); }

  var fs = {
    existsSync: function (p) { return player.fileExists(absolute(p)); },
    readFileSync: function (p, options) {
      var text = player.readTextFile(absolute(p));
      if (text === null) throw fail("ENOENT: no such file or directory, open '" + p + "'", 'ENOENT');
      return text;
    },
    writeFileSync: function (p, data) {
      if (!player.writeSaveFile(absolute(p), String(data))) {
        throw fail("EACCES: the player only writes inside the game's save folder: '" + p + "'", 'EACCES');
      }
    },
    unlinkSync: function (p) {
      if (!player.removeSaveFile(absolute(p))) throw fail("ENOENT: cannot remove '" + p + "'", 'ENOENT');
    },
    mkdirSync: function (p) {
      if (!player.makeSaveDir(absolute(p))) throw fail("EACCES: cannot create folder '" + p + "'", 'EACCES');
    },
    readdirSync: function (p) {
      browser.missing('fs.readdirSync');
      return [];
    },
  };

  var gameWindow = {
    menu: null,
    isDevToolsOpen: function () { return true; },
    showDevTools: function () {},
    closeDevTools: function () {},
    focus: function () {}, show: function () {}, hide: function () {},
    moveBy: function () {}, moveTo: function () {}, resizeBy: function () {}, resizeTo: function () {},
    enterFullscreen: function () {}, leaveFullscreen: function () {}, toggleFullscreen: function () {},
    isFullscreen: true,
    on: function () {}, once: function () {}, removeAllListeners: function () {},
    close: function () { window.close(); },
    get x() { return 0; }, get y() { return 0; },
    get width() { return window.innerWidth; }, get height() { return window.innerHeight; },
  };
  var gui = {
    Window: { get: function () { return gameWindow; } },
    App: { argv: [], quit: function () { window.close(); }, manifest: {} },
    Menu: function () { this.createMacBuiltin = function () {}; this.append = function () {}; },
    MenuItem: function () {},
    Shell: { openExternal: function () { browser.missing('nw.gui Shell.openExternal'); } },
    Screen: { Init: function () {}, screens: [] },
  };

  // A module the player does not provide (for example the Steam library some
  // games bundle). The desktop player would load the real thing; here the
  // game gets an object whose every function does nothing and returns false,
  // which is how such libraries answer when their service is not running.
  function inertModule(name) {
    browser.missing("require('" + name + "')");
    var nothing = function () { return false; };
    return new Proxy({}, {
      get: function (target, key) {
        if (key in target) return target[key];
        return typeof key === 'symbol' ? undefined : nothing;
      },
    });
  }

  var modules = { fs: fs, path: path, 'nw.gui': gui };
  // The modules that are really there, as opposed to accepted and inert.
  browser.providedModules = Object.keys(modules);
  globalThis.require = function (name) {
    name = String(name);
    return modules[name] || (modules[name] = inertModule(name));
  };

  globalThis.process = {
    platform: 'linux',
    // The engine takes the game folder from the folder of this file.
    mainModule: { filename: player.gameDir + '/index.html' },
    versions: { 'node-webkit': '0.29.0' },
    env: {},
    argv: [],
    cwd: function () { return player.gameDir; },
    exit: function (code) { player.exit(code | 0); },
    on: function () {},
    nextTick: function (fn) { Promise.resolve().then(fn); },
  };
})();
