// The browser's font loading: FontFace and document.fonts.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
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
