// Patch "leanTint": the engine's tint without the steps that change nothing.
//
// A sprite with a blend colour or a colour tone (an enemy flashing white
// when it acts or is hit, a target of an animation's flash, a character
// under a tone) is tinted by the engine on a canvas, at every frame in which
// the colour changes, with up to six fills of the whole picture: one to grey
// it, one to brighten it, three to darken it, one for the blend colour. The
// canvas is worked out by the processor, and on a handheld the greying fill
// of a large enemy takes 30 ms and each darkening fill 7 ms: 60 ms a frame
// for a flash that asks for neither.
//
// With this patch the steps that cannot change the picture are left out:
// the greying when the tone has no grey, and the three darkening fills when
// the tone darkens nothing (turning the colours over, adding black, turning
// them back). Every other step is done as the engine does it, in the same
// order, so the picture is the same pixel for pixel.
//
// The tint is replaced only if it is still the engine's own code (option
// `engineCode`: the marks of the code it may replace). One that a plugin has
// rewritten stays as the plugin made it.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/potato-player-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters are in player.patchStats.leanTint.
(function () {
  // A mark of a function's code, whatever its spacing, so that the engine's
  // own text need not be kept here to compare with.
  function codeMark(fn) {
    var text = Function.prototype.toString.call(fn).replace(/\s+/g, ''), mark = 5381;
    for (var i = 0; i < text.length; i++) mark = ((mark * 33) ^ text.charCodeAt(i)) >>> 0;
    return text.length + ':' + mark.toString(16);
  }

  player.patches.leanTint = function (options) {
    var stats = { tints: 0, fillsLeftOut: 0 };
    player.patchStats.leanTint = stats;
    var Sprite = globalThis.Sprite;
    if (!Sprite || typeof Sprite.prototype._executeTint !== 'function') return;
    var known = options.engineCode || [];
    if (known.indexOf(codeMark(Sprite.prototype._executeTint)) < 0) return 'left as a plugin made it: the tint';

    function zero(n) { return Math.max(0, n); }

    Sprite.prototype._executeTint = function (x, y, w, h) {
      var context = this._context, tone = this._colorTone, color = this._blendColor;
      stats.tints++;

      context.globalCompositeOperation = 'copy';
      context.drawImage(this._bitmap.canvas, x, y, w, h, 0, 0, w, h);

      // Greying with no grey paints with a colour that is not there.
      if (Graphics.canUseSaturationBlend()) {
        var gray = zero(tone[3]);
        if (gray > 0) {
          context.globalCompositeOperation = 'saturation';
          context.fillStyle = 'rgba(255,255,255,' + gray / 255 + ')';
          context.fillRect(0, 0, w, h);
        } else {
          stats.fillsLeftOut++;
        }
      }

      // Never left out, even when it adds black: it also makes every pixel
      // solid, which the steps after it count on.
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = Utils.rgbToCssColor(zero(tone[0]), zero(tone[1]), zero(tone[2]));
      context.fillRect(0, 0, w, h);

      // Darkening: the colours turned over, what is to be taken away added,
      // the colours turned back. With nothing to take away, the picture is
      // turned over and back for nothing.
      if (Graphics.canUseDifferenceBlend()) {
        var r2 = zero(-tone[0]), g2 = zero(-tone[1]), b2 = zero(-tone[2]);
        if (r2 > 0 || g2 > 0 || b2 > 0) {
          context.globalCompositeOperation = 'difference';
          context.fillStyle = 'white';
          context.fillRect(0, 0, w, h);

          context.globalCompositeOperation = 'lighter';
          context.fillStyle = Utils.rgbToCssColor(r2, g2, b2);
          context.fillRect(0, 0, w, h);

          context.globalCompositeOperation = 'difference';
          context.fillStyle = 'white';
          context.fillRect(0, 0, w, h);
        } else {
          stats.fillsLeftOut += 3;
        }
      }

      context.globalCompositeOperation = 'source-atop';
      context.fillStyle = Utils.rgbToCssColor(zero(color[0]), zero(color[1]), zero(color[2]));
      context.globalAlpha = zero(color[3]) / 255;
      context.fillRect(0, 0, w, h);

      context.globalCompositeOperation = 'destination-in';
      context.globalAlpha = 1;
      context.drawImage(this._bitmap.canvas, x, y, w, h, 0, 0, w, h);
    };
  };
  player.patches.leanTint.codeMark = codeMark;
})();
