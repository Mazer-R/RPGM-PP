// Patch "gpuLights": draw the TerraxLighting plugin's darkness mask on the GPU.
//
// The lighting plugin decides, on every logic step, which lights exist and
// where, and then paints them into one screen-sized canvas with a handful of
// painting helpers it adds to Bitmap. That canvas is shown through a sprite
// in multiply mode. On the handheld, the painting is what is slow: one
// full-screen radial-gradient fill takes tens of milliseconds on the CPU.
//
// This patch leaves the plugin's decisions alone and replaces only the
// painting. While the plugin updates its mask, its painting helpers record
// what they were asked to draw instead of drawing it. Afterwards each light
// becomes a sprite that stamps one shared, pre-made radial-gradient texture
// with additive blending, on top of a rectangle in the ambient colour, and
// the whole group is rendered into an off-screen texture that the plugin's
// own mask sprite then displays. All of that is ordinary WebGL work for PIXI.
//
// Known differences from the plugin's own painting, not yet matched:
//   - the gradient's inner radius and second colour are ignored: every light
//     fades from its colour at the centre to nothing at its radius;
//   - directional (half) lights are drawn as full circles;
//   - the flashlight cone is drawn as a single round light at the player.
//
// It needs the WebGL renderer and never edits game files. To turn it off for
// one game, name it under "off" in that game's save/mvplayer-patches.json; for
// every game, remove its line from patches/index.json or start the player
// with --no-patches. Its counters are in player.patchStats.gpuLights.
player.patches.gpuLights = function (options) {
  var stats = { steps: 0, radial: 0, cone: 0, rect: 0, circle: 0, baseFills: 0, unsupported: 0, active: false };
  player.patchStats.gpuLights = stats;
  if (!Graphics.isWebGL()) return;

  var commands = [];
  var recording = false;

  // --- Colour parsing: the plugin passes CSS colour strings ---------------
  var NAMED = { black: 0x000000, white: 0xffffff };
  // The plugin passes the same few colour strings on every update.
  var parsed = {};
  function colourOf(text) {
    var known = parsed[text];
    if (known === undefined) known = parsed[text] = parseColour(text);
    return known;
  }
  function parseColour(text) {
    var value = String(text).trim().toLowerCase();
    if (value in NAMED) return NAMED[value];
    var hex = /^#([0-9a-f]{6})/.exec(value);
    if (hex) return parseInt(hex[1], 16);
    var short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
    if (short) return parseInt(short[1] + short[1] + short[2] + short[2] + short[3] + short[3], 16);
    var rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
    if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
    stats.unsupported++;
    return 0x000000;
  }

  // --- Record instead of paint, only for the mask bitmap ------------------
  function intercept(name, record) {
    var original = Bitmap.prototype[name];
    if (typeof original !== 'function') return;
    Bitmap.prototype[name] = function () {
      if (recording && this.__labLightMask) { record.apply(null, arguments); return; }
      return original.apply(this, arguments);
    };
  }
  intercept('fillRect', function (x, y, w, h, colour) {
    stats.baseFills++;
    commands.push({ kind: 'rect', x: x, y: y, w: w, h: h, colour: colourOf(colour) });
  });
  intercept('FillRect', function (x1, y1, x2, y2, colour) {
    stats.rect++;
    commands.push({ kind: 'rect', x: x1, y: y1, w: x2, h: y2, colour: colourOf(colour) });
  });
  intercept('FillCircle', function (cx, cy, rx, ry, colour) {
    stats.circle++;
    commands.push({ kind: 'light', x: Number(cx), y: Number(cy), radius: Math.max(Number(rx), Number(ry)), colour: colourOf(colour) });
  });
  intercept('radialgradientFillRect', function (x, y, r1, r2, colour1) {
    stats.radial++;
    commands.push({ kind: 'light', x: Number(x), y: Number(y), radius: Number(r2), colour: colourOf(colour1) });
  });
  intercept('radialgradientFillRect2', function (x, y, r1, r2, colour1) {
    stats.cone++;
    commands.push({ kind: 'light', x: Number(x), y: Number(y), radius: Number(r2), colour: colourOf(colour1) });
  });

  // --- One shared radial-gradient texture, painted once -------------------
  var glowTexture = null;
  function glow() {
    if (!glowTexture) {
      var size = 256;
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      var ctx = canvas.getContext('2d');
      var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#000000');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      glowTexture = PIXI.Texture.fromCanvas(canvas);
    }
    return glowTexture;
  }

  // --- Scene that is rendered into the off-screen texture -----------------
  var group = new PIXI.Container();
  var base = new PIXI.Graphics();
  group.addChild(base);
  var lightSprites = [];
  var target = null;

  function draw(mask) {
    var width = mask._maskBitmap.width, height = mask._maskBitmap.height;
    if (!target || target.width !== width || target.height !== height) {
      target = PIXI.RenderTexture.create(width, height);
    }
    base.clear();
    var used = 0;
    for (var i = 0; i < commands.length; i++) {
      var command = commands[i];
      if (command.kind === 'rect') {
        base.beginFill(command.colour, 1);
        base.drawRect(command.x, command.y, command.w, command.h);
        base.endFill();
        continue;
      }
      var sprite = lightSprites[used];
      if (!sprite) {
        sprite = lightSprites[used] = new PIXI.Sprite(glow());
        sprite.anchor.set(0.5, 0.5);
        sprite.blendMode = PIXI.BLEND_MODES.ADD;
        group.addChild(sprite);
      }
      sprite.visible = true;
      sprite.position.set(command.x, command.y);
      sprite.width = sprite.height = command.radius * 2;
      sprite.tint = command.colour;
      used++;
    }
    for (var j = used; j < lightSprites.length; j++) lightSprites[j].visible = false;
    Graphics._renderer.render(group, target);

    // Show the off-screen texture through the plugin's own mask sprites.
    for (var k = 0; k < mask.children.length; k++) {
      var child = mask.children[k];
      if (child.bitmap === mask._maskBitmap && child.texture !== target) child.texture = target;
    }
  }

  // --- Hook the plugin's mask update, reached through the live sprite set -
  var createLightmask = Spriteset_Map.prototype.createLightmask;
  if (typeof createLightmask !== 'function') return;
  Spriteset_Map.prototype.createLightmask = function () {
    createLightmask.apply(this, arguments);
    var mask = this._lightmask;
    if (!mask || !mask._maskBitmap) return;
    mask._maskBitmap.__labLightMask = true;
    var proto = Object.getPrototypeOf(mask);
    if (proto.__labGpuLights || typeof proto._updateMask !== 'function') return;
    var updateMask = proto._updateMask;
    proto._updateMask = function () {
      if (this._maskBitmap) this._maskBitmap.__labLightMask = true;
      commands.length = 0;
      recording = true;
      try { updateMask.apply(this, arguments); }
      finally { recording = false; }
      stats.steps++;
      draw(this);
    };
    proto.__labGpuLights = true;
    stats.active = true;
  };
};
