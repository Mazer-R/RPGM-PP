// The Canvas 2D drawing context the game uses, written over the native
// canvas functions in player.canvas. The native side takes every value as an
// explicit number; this file keeps the state a browser context keeps (fill
// colour, font, alignment, the save/restore stack) and passes it along.
(function () {
  'use strict';
  var c2d = player.canvas;
  var css = globalThis.__css;
  var browser = globalThis.__browser;

  function CanvasGradient(handle) { this.__native = handle; }
  CanvasGradient.prototype.addColorStop = function (offset, colour) {
    var c = css.parseColour(colour) || [0, 0, 0, 1];
    c2d.addColorStop(this.__native, Number(offset), c[0], c[1], c[2], c[3]);
  };

  function ImageData(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }

  function freshState() {
    return {
      fillStyle: '#000000', fillPaint: [0, 0, 0, 1],
      strokeStyle: '#000000', strokePaint: [0, 0, 0, 1],
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      font: '10px sans-serif', fontSize: 10, fontFamily: browser.resolveFontFamily(['sans-serif']),
      textAlign: 'start', textBaseline: 'alphabetic',
      lineWidth: 1, lineJoin: 'miter', lineCap: 'butt', miterLimit: 10,
      imageSmoothingEnabled: true,
    };
  }

  function CanvasRenderingContext2D(canvas) {
    this.canvas = canvas;
    this._s = freshState();
    this._stack = [];
    this._fontApplied = '';
  }
  var proto = CanvasRenderingContext2D.prototype;

  // The native surface is created when first needed and replaced when the
  // canvas is resized, so it is looked up for every call.
  function surface(context) { return context.canvas.__native; }

  // Called when the canvas is resized: a browser resets the context then.
  proto._reset = function () {
    this._s = freshState();
    this._stack = [];
    this._fontApplied = '';
  };

  function paintFrom(value) {
    if (value instanceof CanvasGradient) return value.__native;
    if (typeof value === 'string') return css.parseColour(value);
    return null;
  }
  function styleProperty(name, paintName) {
    Object.defineProperty(proto, name, {
      get: function () { return this._s[name]; },
      set: function (value) {
        var paint = paintFrom(value);
        if (paint === null) return; // not a colour: keep the previous one
        this._s[name] = value;
        this._s[paintName] = paint;
      },
    });
  }
  styleProperty('fillStyle', 'fillPaint');
  styleProperty('strokeStyle', 'strokePaint');

  ['textAlign', 'textBaseline', 'lineJoin', 'lineCap', 'imageSmoothingEnabled'].forEach(function (name) {
    Object.defineProperty(proto, name, {
      get: function () { return this._s[name]; },
      set: function (value) { this._s[name] = value; },
    });
  });
  ['globalAlpha', 'lineWidth', 'miterLimit'].forEach(function (name) {
    Object.defineProperty(proto, name, {
      get: function () { return this._s[name]; },
      set: function (value) {
        value = Number(value);
        if (isFinite(value) && value >= 0) this._s[name] = value;
      },
    });
  });
  Object.defineProperty(proto, 'globalCompositeOperation', {
    get: function () { return this._s.globalCompositeOperation; },
    set: function (value) {
      this._s.globalCompositeOperation = String(value);
      c2d.setOperator(surface(this), String(value));
    },
  });
  Object.defineProperty(proto, 'font', {
    get: function () { return this._s.font; },
    set: function (value) {
      var parsed = css.parseFont(value);
      if (!parsed) return;
      this._s.font = String(value);
      this._s.fontSize = parsed.size;
      this._s.fontFamily = browser.resolveFontFamily(parsed.families);
    },
  });

  proto._applyFont = function () {
    var s = this._s;
    var key = s.fontFamily.name + '/' + s.fontSize;
    if (key === this._fontApplied) return;
    c2d.setFont(surface(this), s.fontFamily.name, s.fontSize);
    this._fontApplied = key;
  };

  proto.save = function () {
    this._stack.push(Object.assign({}, this._s));
    c2d.save(surface(this));
  };
  proto.restore = function () {
    if (!this._stack.length) return;
    this._s = this._stack.pop();
    c2d.restore(surface(this));
    c2d.setOperator(surface(this), this._s.globalCompositeOperation);
    this._fontApplied = '';
  };

  // Browsers convert every numeric argument before drawing, so "150" is
  // accepted; game plugins rely on that.
  proto.setTransform = function (a, b, c, d, e, f) { c2d.setTransform(surface(this), +a, +b, +c, +d, +e, +f); };
  proto.resetTransform = function () { c2d.setTransform(surface(this), 1, 0, 0, 1, 0, 0); };
  proto.transform = function (a, b, c, d, e, f) { c2d.transform(surface(this), +a, +b, +c, +d, +e, +f); };
  proto.translate = function (x, y) { c2d.translate(surface(this), +x, +y); };
  proto.scale = function (x, y) { c2d.scale(surface(this), +x, +y); };
  proto.rotate = function (angle) { c2d.rotate(surface(this), +angle); };

  proto.fillRect = function (x, y, w, h) {
    c2d.fillRect(surface(this), +x, +y, +w, +h, this._s.fillPaint, this._s.globalAlpha);
  };
  proto.clearRect = function (x, y, w, h) { c2d.clearRect(surface(this), +x, +y, +w, +h); };
  proto.strokeRect = function (x, y, w, h) {
    c2d.beginPath(surface(this));
    c2d.rect(surface(this), +x, +y, +w, +h);
    this.stroke();
    c2d.beginPath(surface(this));
  };

  proto.beginPath = function () { c2d.beginPath(surface(this)); };
  proto.closePath = function () { c2d.closePath(surface(this)); };
  proto.moveTo = function (x, y) { c2d.moveTo(surface(this), +x, +y); };
  proto.lineTo = function (x, y) { c2d.lineTo(surface(this), +x, +y); };
  proto.rect = function (x, y, w, h) { c2d.rect(surface(this), +x, +y, +w, +h); };
  proto.arc = function (x, y, r, a0, a1, ccw) { c2d.arc(surface(this), +x, +y, +r, +a0, +a1, !!ccw); };
  proto.quadraticCurveTo = function (cx, cy, x, y) { c2d.quadraticCurveTo(surface(this), +cx, +cy, +x, +y); };
  proto.bezierCurveTo = function (a, b, c, d, x, y) { c2d.bezierCurveTo(surface(this), +a, +b, +c, +d, +x, +y); };
  proto.fill = function () { c2d.fill(surface(this), this._s.fillPaint, this._s.globalAlpha); };
  proto.stroke = function () {
    var s = this._s;
    c2d.stroke(surface(this), s.strokePaint, s.globalAlpha, s.lineWidth, s.lineJoin === 'round');
  };
  proto.clip = function () { c2d.clip(surface(this)); };

  proto.drawImage = function (source, a, b, c, d, e, f, g, h) {
    var native = source && source.__native;
    if (!native) return; // an image that has not loaded draws nothing
    var sw = source.width, sh = source.height;
    var n = arguments.length;
    if (n >= 9) c2d.drawImage(surface(this), native, +a, +b, +c, +d, +e, +f, +g, +h, this._s.globalAlpha);
    else if (n >= 5) c2d.drawImage(surface(this), native, 0, 0, sw, sh, +a, +b, +c, +d, this._s.globalAlpha);
    else c2d.drawImage(surface(this), native, 0, 0, sw, sh, +a, +b, sw, sh, this._s.globalAlpha);
  };

  proto.measureText = function (text) {
    this._applyFont();
    var m = c2d.measureText(surface(this), String(text));
    return { width: m[0] * this._s.fontFamily.widthFactor };
  };

  // Shared by fillText and strokeText: works out where the baseline starts
  // from the alignment settings, squeezes the text when it is wider than
  // maxWidth, and hands the final position to `draw`.
  proto._text = function (text, x, y, maxWidth, draw) {
    text = String(text);
    x = +x; y = +y;
    this._applyFont();
    var target = surface(this);
    var m = c2d.measureText(target, text);
    var width = m[0], ascent = m[1], descent = m[2];
    var squeeze = 1;
    if (maxWidth !== undefined && maxWidth !== null) {
      maxWidth = +maxWidth;
      if (!(maxWidth > 0)) return;
      if (width > maxWidth) squeeze = maxWidth / width;
    }
    var shown = width * squeeze;
    var align = this._s.textAlign;
    if (align === 'center') x -= shown / 2;
    else if (align === 'right' || align === 'end') x -= shown;
    var baseline = this._s.textBaseline;
    if (baseline === 'top') y += ascent;
    else if (baseline === 'hanging') y += ascent * 0.8;
    else if (baseline === 'middle') y += (ascent - descent) / 2;
    else if (baseline === 'bottom' || baseline === 'ideographic') y -= descent;
    if (squeeze === 1) {
      draw(target, text, x, y);
    } else {
      c2d.save(target);
      c2d.translate(target, x, y);
      c2d.scale(target, squeeze, 1);
      draw(target, text, 0, 0);
      c2d.restore(target);
      c2d.setOperator(target, this._s.globalCompositeOperation);
      this._fontApplied = '';
    }
  };
  proto.fillText = function (text, x, y, maxWidth) {
    var s = this._s;
    this._text(text, x, y, maxWidth, function (target, string, tx, ty) {
      c2d.fillText(target, string, tx, ty, s.fillPaint, s.globalAlpha);
    });
  };
  proto.strokeText = function (text, x, y, maxWidth) {
    var s = this._s;
    this._text(text, x, y, maxWidth, function (target, string, tx, ty) {
      c2d.strokeText(target, string, tx, ty, s.strokePaint, s.globalAlpha, s.lineWidth, s.lineJoin === 'round');
    });
  };

  proto.createLinearGradient = function (x0, y0, x1, y1) {
    return new CanvasGradient(c2d.createLinearGradient(+x0, +y0, +x1, +y1));
  };
  proto.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
    return new CanvasGradient(c2d.createRadialGradient(+x0, +y0, +r0, +x1, +y1, +r1));
  };
  proto.createPattern = function () {
    browser.missing('CanvasRenderingContext2D.createPattern');
    return null;
  };

  proto.getImageData = function (x, y, w, h) {
    x = Math.floor(+x); y = Math.floor(+y); w = Math.floor(+w); h = Math.floor(+h);
    return new ImageData(c2d.getImageData(surface(this), x, y, w, h), w, h);
  };
  proto.createImageData = function (w, h) {
    if (typeof w === 'object') { h = w.height; w = w.width; }
    return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
  };
  proto.putImageData = function (image, dx, dy) {
    c2d.putImageData(surface(this), image.data, image.width, image.height, Math.floor(+dx), Math.floor(+dy));
  };

  globalThis.CanvasRenderingContext2D = CanvasRenderingContext2D;
  globalThis.CanvasGradient = CanvasGradient;
  globalThis.ImageData = ImageData;
})();
