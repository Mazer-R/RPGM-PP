// Patch "windowClip": keep a window's contents inside it with a rectangle,
// not with a filter.
//
// An RPG Maker MZ window draws its contents (text, cursor, backs) in a
// "client area" that must not spill over the window's frame, for instance
// while a list scrolls. The engine gets that by putting a filter on the
// client area with the area's rectangle as its bounds. A filter makes PIXI
// draw what it covers into a texture and copy the texture back, so every
// open window costs an extra pass in every frame. A menu or a battle has
// several windows open, and on the handheld that is where most of a frame
// goes: 20 to 50 ms of drawing.
//
// The filter itself changes no colour; only its bounds matter. This patch
// takes it off and gives the client area a mask instead: a rectangle of the
// window's inner size, a child of the window so that it moves with it. The
// renderer is told to cut rectangular masks with a scissor, which costs
// nothing to draw. (It must be a scissor and not PIXI's other kind of mask,
// the stencil: the engine's window layer uses the stencil itself, to hide
// what lies under each window.)
//
// It never edits game files. To turn it off for one game, name it under
// "off" in that game's save/mvplayer-patches.json; for every game, remove
// its line from patches/index.json or start the player with --no-patches.
// Its counter is in player.patchStats.windowClip.
player.patches.windowClip = function (options) {
  var stats = { windows: 0 };
  player.patchStats.windowClip = stats;
  if (!globalThis.Window || !Window.prototype || typeof Window.prototype._createClientArea !== 'function' ||
      typeof Window.prototype._updateFilterArea !== 'function' || !globalThis.PIXI || !PIXI.Graphics) return;

  var createClientArea = Window.prototype._createClientArea;
  Window.prototype._createClientArea = function () {
    createClientArea.apply(this, arguments);
    var clip = new PIXI.Graphics();
    this._clientArea.filters = null;
    this._clientArea.mask = clip;
    this._mvpClip = clip;
    this.addChild(clip);
    stats.windows++;
  };

  // The engine calls this for every window in every frame, to move the
  // filter's bounds; the rectangle is redrawn only when it has changed.
  var updateFilterArea = Window.prototype._updateFilterArea;
  Window.prototype._updateFilterArea = function () {
    updateFilterArea.apply(this, arguments);
    var clip = this._mvpClip;
    if (!clip) return;
    var pad = this._padding, width = this.innerWidth, height = this.innerHeight;
    if (clip._mvpPad === pad && clip._mvpWidth === width && clip._mvpHeight === height) return;
    clip._mvpPad = pad; clip._mvpWidth = width; clip._mvpHeight = height;
    clip.clear();
    clip.beginFill(0xffffff);
    clip.drawRect(pad, pad, width, height);
    clip.endFill();
  };

  // The renderer is made after the patches are installed.
  if (globalThis.Graphics && typeof Graphics._createPixiApp === 'function') {
    var createPixiApp = Graphics._createPixiApp;
    Graphics._createPixiApp = function () {
      createPixiApp.apply(this, arguments);
      if (this._app && this._app.renderer && this._app.renderer.mask) this._app.renderer.mask.enableScissor = true;
    };
  }
};
