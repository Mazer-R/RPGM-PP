// Patch "pictureScale": pictures shown whole take only the graphics memory
// the screen can show of them.
//
// A picture that has been drawn stays in the graphics memory as a texture,
// at its full size. On a screen smaller than the game's own picture (a
// handheld of 640x480 for a game of 816x624) the whole game is shown made
// smaller, so a picture that fills the game's picture is never seen at its
// full size, and four tenths of its texture are memory for nothing.
//
// With this patch, a picture loaded from a folder of pictures that are
// shown whole is marked with the scale the screen shows the game at, and
// the player sends it to the graphics memory at that size. The game is told
// nothing: the picture keeps its size for it, and a texture is drawn in the
// same place whatever its own size. The canvas a game makes of such a
// picture to change it carries the same mark.
//
// What is drawn in parts (tiles, characters, faces, icons, animations, the
// windows' skin) is left alone: made smaller, a part would take some colour
// from its neighbours at its edges. So is everything when the screen is as
// large as the game, or nearly (option `unless`, 0.95), and in a desktop's
// window, which can be made larger afterwards. A picture is never asked for
// at under half its size (option `least`). A picture the game shows
// enlarged is less sharp with this patch than without.
//
// The folders are the option `folders` (default: img/pictures/).
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/potato-player-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters are in player.patchStats.pictureScale.
player.patches.pictureScale = function (options) {
  var folders = options.folders || ['img/pictures/'];
  var least = options.least || 0.5, unless = options.unless || 0.95;
  var stats = { scale: 1, marked: 0 };
  player.patchStats.pictureScale = stats;
  var Bitmap = globalThis.Bitmap;
  if (!Bitmap || typeof Bitmap.prototype._onLoad !== 'function') return;

  // The scale the screen shows the game at, or 1 when nothing is to be gained.
  function screenScale() {
    var gl = player.gl, graphics = globalThis.Graphics;
    if (player.screenResizable || !gl || typeof gl.screenSize !== 'function' || !graphics) return 1;
    var screen = gl.screenSize(), width = graphics.width, height = graphics.height;
    if (!screen || !(screen[0] > 0 && screen[1] > 0 && width > 0 && height > 0)) return 1;
    var scale = Math.min(screen[0] / width, screen[1] / height);
    return scale >= unless ? 1 : Math.max(least, scale);
  }

  function shownWhole(url) {
    var name = String(url || '');
    try { name = decodeURIComponent(name); } catch (error) { /* not written for a web address: as it is */ }
    return folders.some(function (folder) { return name.indexOf(folder) >= 0; });
  }

  // The canvas a bitmap has now, without making one: in MV 1.6 asking for
  // `_canvas` makes it.
  function canvasOf(bitmap) {
    if (bitmap.__canvas) return bitmap.__canvas;
    return Object.prototype.hasOwnProperty.call(bitmap, '_canvas') ? bitmap._canvas : null;
  }

  function mark(bitmap, scale) {
    bitmap.__uploadScale = scale;
    if (bitmap._image) bitmap._image.__uploadScale = scale;
    var canvas = canvasOf(bitmap);
    if (canvas) canvas.__uploadScale = scale;
  }

  var onLoad = Bitmap.prototype._onLoad;
  Bitmap.prototype._onLoad = function () {
    var result = onLoad.apply(this, arguments);
    if (shownWhole(this._url)) {
      stats.scale = screenScale();
      if (stats.scale < 1) { stats.marked++; mark(this, stats.scale); }
    }
    return result;
  };

  var createCanvas = Bitmap.prototype._createCanvas;
  if (typeof createCanvas === 'function') {
    Bitmap.prototype._createCanvas = function () {
      var result = createCanvas.apply(this, arguments);
      if (this.__uploadScale) mark(this, this.__uploadScale);
      return result;
    };
  }
};
