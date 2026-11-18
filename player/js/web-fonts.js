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
  // Fonts a desktop system usually has, for a game none of whose own can be
  // used.
  var SYSTEM_FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/noto/NotoSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Regular.ttf', '/system/fonts/Roboto-Regular.ttf',
    '/system/fonts/NotoSans-Regular.ttf', '/system/fonts/DroidSans.ttf'];

  // A font that cannot be loaded does not stop the game. In a browser it
  // would: the engine shows a load error and waits. But a font is only how
  // the text looks, and a player that will not start over one file is of no
  // use, so the family is given another font instead: one of the game's own
  // other fonts if any can be used, else one of the system's. With none, the
  // game still goes on, without text in that family.
  function standIn(family, failed) {
    var names = [];
    try { names = player.listDir(player.gameDir + '/fonts') || []; } catch (error) { names = []; }
    var candidates = names.filter(function (name) { return /\.(ttf|otf|woff2?)$/i.test(name); }).sort()
      .map(function (name) { return 'fonts/' + name; })
      .filter(function (url) { return url.toLowerCase() !== String(failed).split('?')[0].toLowerCase(); });
    SYSTEM_FONTS.forEach(function (file) { if (player.fileExists(file)) candidates.push(file); });
    for (var i = 0; i < candidates.length; i++) {
      if (browser.registerFont(family, candidates[i])) return candidates[i];
    }
    return '';
  }

  FontFace.prototype.load = function () {
    if (this.status === 'unloaded') {
      if (!this._url || !browser.registerFont(this.family, this._url)) {
        var other = standIn(this.family, this._url);
        console.warn(other
          ? 'font: ' + this._url + ' cannot be loaded for ' + this.family + '; ' + other + ' is used in its place'
          : 'font: ' + this._url + ' cannot be loaded for ' + this.family + ' and there is no font to use in its place: its text will not show');
      }
      this.status = 'loaded';
      this._settle.resolve(this);
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
