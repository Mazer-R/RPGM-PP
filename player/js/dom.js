// The part of a browser page the game expects to find: window, document,
// elements, events, timers, images, file requests. Nothing here draws a page;
// the objects exist so the engine's own code runs unchanged. What the game
// really shows goes through one canvas with a WebGL context, which the native
// player scales to the screen.
//
// Everything is driven from the native frame callback: once per frame the
// pump below runs the timers that are due, then finished loads (images, file
// requests), then the game's own animation-frame callbacks.
(function () {
  'use strict';
  var c2d = player.canvas;
  var gl = player.gl;
  var browser = globalThis.__browser = globalThis.__browser || {};

  // --- Features the player does not provide ---------------------------------
  // Each one is reported once, so the log lists what a game reached for.
  var reported = {};
  browser.missing = function (what) {
    if (reported[what]) return;
    reported[what] = true;
    console.warn('not provided: ' + what);
  };

  function describe(error) { return String(error && error.stack ? error.stack : error); }

  // A page address the game uses ("img/system/Window.png?x=1", "./js/a.js")
  // as a file path inside the game folder.
  function gamePath(url) {
    var clean = String(url).split('?')[0].split('#')[0];
    try { clean = decodeURIComponent(clean); } catch (e) { /* keep as written */ }
    // A full path into the game or the player is used as it is. Any other
    // address starting with "/" is relative to the page's root, which for
    // a desktop game is the game folder.
    if (clean.indexOf(player.gameDir + '/') === 0 || clean.indexOf(player.playerDir + '/') === 0) return clean;
    return player.gameDir + '/' + clean.replace(/^\/+/, '').replace(/^(\.\/)+/, '');
  }
  browser.gamePath = gamePath;

  // --- Events ---------------------------------------------------------------
  function Event(type, init) {
    this.type = type;
    this.defaultPrevented = false;
    if (init) Object.assign(this, init);
  }
  Event.prototype.preventDefault = function () { this.defaultPrevented = true; };
  Event.prototype.stopPropagation = function () {};
  Event.prototype.stopImmediatePropagation = function () {};

  function EventTarget() {}
  EventTarget.prototype.addEventListener = function (type, fn) {
    if (typeof fn !== 'function') return;
    var all = this.__listeners || (this.__listeners = {});
    (all[type] || (all[type] = [])).push(fn);
  };
  EventTarget.prototype.removeEventListener = function (type, fn) {
    var list = this.__listeners && this.__listeners[type];
    if (list) this.__listeners[type] = list.filter(function (f) { return f !== fn; });
  };
  EventTarget.prototype.dispatchEvent = function (event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    var handler = this['on' + event.type];
    if (typeof handler === 'function') handler.call(this, event);
    var list = this.__listeners && this.__listeners[event.type];
    if (list) list.slice().forEach(function (fn) { fn.call(this, event); }, this);
    return !event.defaultPrevented;
  };
  function emit(target, type, init) { return target.dispatchEvent(new Event(type, init)); }

  // --- Timers, finished loads and animation frames --------------------------
  var nativeRequestFrame = globalThis.requestAnimationFrame;
  var timers = [];
  var nextTimerId = 1;
  var tasks = [];
  var frameCallbacks = [];
  var nextFrameId = 1;

  function addTimer(fn, delay, repeat, args) {
    if (typeof fn !== 'function') return 0;
    delay = Math.max(0, Number(delay) || 0);
    var timer = { id: nextTimerId++, at: performance.now() + delay, fn: fn, every: repeat ? Math.max(1, delay) : 0, args: args };
    timers.push(timer);
    return timer.id;
  }
  function removeTimer(id) {
    for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; }
  }
  globalThis.setTimeout = function (fn, delay) { return addTimer(fn, delay, false, Array.prototype.slice.call(arguments, 2)); };
  globalThis.setInterval = function (fn, delay) { return addTimer(fn, delay, true, Array.prototype.slice.call(arguments, 2)); };
  globalThis.clearTimeout = globalThis.clearInterval = removeTimer;
  globalThis.requestAnimationFrame = function (fn) {
    var id = nextFrameId++;
    frameCallbacks.push({ id: id, fn: fn });
    return id;
  };
  globalThis.cancelAnimationFrame = function (id) {
    frameCallbacks = frameCallbacks.filter(function (entry) { return entry.id !== id; });
  };

  // Runs something after the current script, as a browser does with the
  // result of a load. Images are decoded here, so the work per frame is
  // limited to keep frames coming while many files load.
  function later(fn) { tasks.push(fn); }
  browser.later = later;
  var TASK_BUDGET_MS = 12;

  function guarded(fn, self, args, what) {
    try { fn.apply(self, args); }
    catch (error) { console.error(what + ': ' + describe(error)); }
  }

  function pump(now) {
    nativeRequestFrame(pump);
    var due = timers.filter(function (timer) { return timer.at <= now; });
    due.forEach(function (timer) {
      if (timers.indexOf(timer) < 0) return; // cancelled by an earlier timer
      if (timer.every) timer.at = now + timer.every; else removeTimer(timer.id);
      guarded(timer.fn, globalThis, timer.args, 'timer');
    });
    var started = performance.now();
    while (tasks.length && performance.now() - started < TASK_BUDGET_MS) {
      guarded(tasks.shift(), globalThis, [], 'load');
    }
    var callbacks = frameCallbacks;
    frameCallbacks = [];
    callbacks.forEach(function (entry) { guarded(entry.fn, globalThis, [now], 'frame'); });
    if (browser.updateAudio) browser.updateAudio();
    if (browser.updateVideo) browser.updateVideo();
    frameRateDisplay(now);
  }

  // --- Frame-rate display -----------------------------------------------------
  // A small box in the screen's top-left corner with the frames shown per
  // second and the longest frame of the last half second: the first says how
  // fast, the second how steady. Off unless the player was started with
  // --fps; F2 (menu button + Select on the console) switches it.
  var fps = { on: !!player.showFps, canvas: null, since: 0, frames: 0, last: 0, longest: 0 };
  function frameRateDisplay(now) {
    if (!fps.on) return;
    if (fps.last) fps.longest = Math.max(fps.longest, now - fps.last);
    fps.last = now;
    fps.frames++;
    if (!fps.since) fps.since = now;
    if (now - fps.since < 500) return;
    var W = 132, H = 24;
    if (!fps.canvas) fps.canvas = c2d.create(W, H);
    var rate = fps.frames * 1000 / (now - fps.since);
    c2d.setOperator(fps.canvas, 'source-over');
    c2d.fillRect(fps.canvas, 0, 0, W, H, [0, 0, 0, 1], 1);
    var family = browser.resolveFontFamily(['sans-serif']);
    if (family.name) {
      c2d.setFont(fps.canvas, family.name, 16);
      // Green at 50 and above, yellow from 30, red below.
      var colour = rate >= 50 ? [0.45, 1, 0.45, 1] : rate >= 30 ? [1, 0.9, 0.3, 1] : [1, 0.4, 0.4, 1];
      c2d.fillText(fps.canvas, rate.toFixed(0) + ' fps  ' + fps.longest.toFixed(0) + ' ms', 6, 18, colour, 1);
    }
    gl.setOverlay(fps.canvas, 4, 4);
    fps.since = now; fps.frames = 0; fps.longest = 0;
  }
  function switchFrameRateDisplay() {
    fps.on = !fps.on;
    fps.since = fps.frames = fps.last = fps.longest = 0;
    if (!fps.on) gl.setOverlay(null);
    console.info('frame-rate display ' + (fps.on ? 'on' : 'off'));
  }
  nativeRequestFrame(pump);

  // --- Fonts ----------------------------------------------------------------
  var fontFamilies = {};
  var fallbackFamily = null;
  browser.registerFont = function (family, url) {
    // A font file of the system, named by its full path, is used as it is.
    var file = String(url).charAt(0) === '/' && player.fileExists(String(url)) ? String(url) : gamePath(url);
    if (!c2d.registerFont(family, file)) {
      console.warn('font: cannot load ' + file + ' for ' + family);
      return false;
    }
    fontFamilies[family] = { name: family, widthFactor: 1 };
    console.info('font: ' + family + ' from ' + file);
    return true;
  };
  function registerFontFaceRules(cssText, baseUrl) {
    var pattern = /@font-face\s*\{([^}]*)\}/g;
    var rule;
    while ((rule = pattern.exec(cssText))) {
      var family = /font-family\s*:\s*["']?([^;"']+)["']?\s*;?/.exec(rule[1]);
      var source = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(rule[1]);
      if (family && source) browser.registerFont(family[1].trim(), baseUrl + source[1]);
    }
  }
  browser.registerFontsFromCss = function (url) {
    var text = player.readTextFile(gamePath(url));
    if (text === null) return console.warn('font: cannot read ' + url);
    registerFontFaceRules(text, url.replace(/[^\/]*$/, ''));
  };
  // The face used for a family the game never declared ("sans-serif"). The
  // engine decides that its own font has loaded by checking that text is not
  // the same width in it as in a generic family, so the fallback is given a
  // very slightly different width in case it is the same file.
  function fallback() {
    if (fallbackFamily) return fallbackFamily;
    var name = '';
    var bundled = 'fonts/mplus-1m-regular.ttf';
    if (player.fileExists(gamePath(bundled)) && c2d.registerFont('__fallback', gamePath(bundled))) name = '__fallback';
    else name = Object.keys(fontFamilies)[0] || '';
    // With no font yet, the answer is not kept: a game may load its fonts
    // after its first text is asked for (MZ does), and the next call finds
    // them.
    if (!name) {
      browser.missing('any usable font: text will not be drawn');
      return { name: '', widthFactor: 1.001 };
    }
    return (fallbackFamily = { name: name, widthFactor: 1.001 });
  }
  browser.resolveFontFamily = function (families) {
    for (var i = 0; i < families.length; i++) if (fontFamilies[families[i]]) return fontFamilies[families[i]];
    return fallback();
  };

  // --- Elements -------------------------------------------------------------
  // Lists of elements are arrays with the item() method page lists have.
  function nodeList(array) {
    array.item = function (index) { return this[index] || null; };
    return array;
  }
  function Element(tag) {
    this.tagName = this.nodeName = String(tag).toUpperCase();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.id = '';
    this._html = '';
  }
  Element.prototype = Object.create(EventTarget.prototype);
  Element.prototype.constructor = Element;
  Object.assign(Element.prototype, {
    appendChild: function (child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
      if (child.tagName === 'SCRIPT' && child.src && !child.__started) startScript(child);
      return child;
    },
    insertBefore: function (child) { return this.appendChild(child); },
    removeChild: function (child) {
      var i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    remove: function () { if (this.parentNode) this.parentNode.removeChild(this); },
    contains: function (node) {
      for (; node; node = node.parentNode) if (node === this) return true;
      return false;
    },
    hasChildNodes: function () { return this.children.length > 0; },
    setAttribute: function (name, value) { this[name] = String(value); },
    getAttribute: function (name) { return name in this ? this[name] : null; },
    removeAttribute: function (name) { delete this[name]; },
    getElementsByTagName: function (tag) {
      var wanted = String(tag).toUpperCase();
      var found = [];
      (function visit(node) {
        node.children.forEach(function (child) { if (wanted === '*' || child.tagName === wanted) found.push(child); visit(child); });
      })(this);
      return nodeList(found);
    },
    getBoundingClientRect: function () {
      var w = this.width || 0, h = this.height || 0;
      return { left: 0, top: 0, x: 0, y: 0, width: w, height: h, right: w, bottom: h };
    },
    focus: function () {}, blur: function () {}, click: function () {},
    // What a sound element says it can play. Sound goes through the Web Audio
    // stand-in (audio.js), which plays Ogg Vorbis; nothing plays through the
    // elements themselves. Video elements answer for themselves (video.js).
    canPlayType: function (type) { return player.audio && /audio\/ogg/.test(String(type)) ? 'probably' : ''; },
    play: function () {}, pause: function () {}, load: function () {},
  });
  Object.defineProperties(Element.prototype, {
    firstChild: { get: function () { return this.children[0] || null; } },
    lastChild: { get: function () { return this.children[this.children.length - 1] || null; } },
    childNodes: { get: function () { return this.children; } },
    // The page is as large as the game's canvas, which starts at its corner.
    offsetLeft: { get: function () { return 0; } },
    offsetTop: { get: function () { return 0; } },
    offsetWidth: { get: function () { return this.width || 0; } },
    offsetHeight: { get: function () { return this.height || 0; } },
    clientWidth: { get: function () { return this.width || 0; } },
    clientHeight: { get: function () { return this.height || 0; } },
    // The engine reports a fatal error by filling an element with this id.
    // There is no page to show it on, so the text goes to the log.
    innerHTML: {
      get: function () { return this._html; },
      set: function (value) {
        this._html = String(value);
        if (this.id === 'ErrorPrinter' && this._html) {
          console.error('game error screen: ' + this._html.replace(/<br\s*\/?>/g, ' | ').replace(/<[^>]*>/g, ''));
        }
      },
    },
  });

  // Which files are given to the engine by their start only (see the file
  // requests below): sounds, and encrypted images. These are MV's names; an
  // engine that names them otherwise says so in a piece of its profile.
  browser.soundFiles = /\.(ogg|m4a|rpgmvo)$/i;
  browser.startOnlyFiles = /\.rpgmvp$/i;

  // --- Scripts --------------------------------------------------------------
  var scripts = [];
  browser.runScript = function (url, element) {
    element = element || Object.assign(new Element('script'), { src: url });
    element.__started = true;
    scripts.push(element);
    var previous = document.currentScript;
    document.currentScript = element;
    var ok = player.loadScript(gamePath(url));
    document.currentScript = previous;
    return ok;
  };
  // A script element the game adds to the page (the engine loads its plugins
  // this way). It runs at once, and its load or error event follows.
  function startScript(element) {
    var ok = browser.runScript(element.src, element);
    later(function () { emit(element, ok ? 'load' : 'error'); });
  }

  // --- Canvas ---------------------------------------------------------------
  // The one canvas whose WebGL picture is shown on the screen.
  var screenCanvas = null;
  browser.screenCanvas = function () { return screenCanvas; };

  function HTMLCanvasElement() {
    Element.call(this, 'canvas');
    this._width = 300;
    this._height = 150;
    this._surface = null;
    this._context = null;
    this._gl = null;
  }
  HTMLCanvasElement.prototype = Object.create(Element.prototype);
  HTMLCanvasElement.prototype.constructor = HTMLCanvasElement;
  HTMLCanvasElement.prototype._resized = function () {
    // Setting a size always empties the canvas and resets its context.
    if (this._surface) c2d.resize(this._surface, Math.max(1, this._width), Math.max(1, this._height));
    if (this._context) this._context._reset();
    if (screenCanvas === this) useAsScreen(this);
  };
  function sizeProperty(name, field) {
    Object.defineProperty(HTMLCanvasElement.prototype, name, {
      get: function () { return this[field]; },
      set: function (value) {
        value = Math.floor(Number(value));
        this[field] = value > 0 ? value : 0;
        this._resized();
      },
    });
  }
  sizeProperty('width', '_width');
  sizeProperty('height', '_height');
  // The native drawing surface behind a 2D canvas, created on first use. The
  // WebGL binding reads this property when a canvas is uploaded as a texture.
  Object.defineProperty(HTMLCanvasElement.prototype, '__native', {
    get: function () {
      if (this._gl) return null;
      if (!this._surface) this._surface = c2d.create(Math.max(1, this._width), Math.max(1, this._height));
      return this._surface;
    },
  });
  function useAsScreen(canvas) {
    screenCanvas = canvas;
    var w = Math.max(1, canvas._width), h = Math.max(1, canvas._height);
    gl.setDrawingBufferSize(w, h);
    gl.drawingBufferWidth = w;
    gl.drawingBufferHeight = h;
    gl.canvas = canvas;
    console.info('screen: the game draws at ' + w + 'x' + h);
  }
  HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind === '2d') {
      if (this._gl) return null;
      return this._context || (this._context = new CanvasRenderingContext2D(this));
    }
    if (kind === 'webgl' || kind === 'experimental-webgl') {
      if (this._context) return null;
      // There is a single WebGL context. Libraries also ask for one on a
      // throwaway canvas to see whether WebGL works; only a canvas that is
      // part of the page becomes the picture shown on the screen.
      this._gl = gl;
      if (!screenCanvas && document.body.contains(this)) useAsScreen(this);
      return gl;
    }
    return null;
  };
  HTMLCanvasElement.prototype.toDataURL = function () {
    browser.missing('canvas.toDataURL');
    return 'data:,';
  };

  // --- Images ---------------------------------------------------------------
  // Loading an image reads only its size. Its pixels are decoded the first
  // time something needs them: an upload to a texture, or drawing it on a
  // canvas. Most images are uploaded once and then live in the texture, so
  // the decoded copy is dropped again: only the most recently used ones are
  // kept, up to DECODED_BUDGET bytes, and an image needed again later is
  // decoded again.
  var DECODED_BUDGET = 32 * 1024 * 1024;
  var failedImages = {};
  var decoded = [];        // images holding decoded pixels, oldest first
  var decodedBytes = 0;
  function dropDecoded(image) {
    if (!image._surface) return;
    c2d.destroy(image._surface);
    image._surface = null;
    decodedBytes -= image.width * image.height * 4;
    var i = decoded.indexOf(image);
    if (i >= 0) decoded.splice(i, 1);
  }
  function decode(image) {
    var handle = c2d.loadImage(image._file);
    if (!handle) {
      if (!image._decodeFailed) console.warn('image: cannot decode ' + image._file);
      image._decodeFailed = true;
      return null;
    }
    image._surface = handle;
    decodedBytes += image.width * image.height * 4;
    decoded.push(image);
    // The newest one always stays, whatever its size.
    while (decodedBytes > DECODED_BUDGET && decoded.length > 1) dropDecoded(decoded[0]);
    return handle;
  }

  function HTMLImageElement() {
    Element.call(this, 'img');
    this.complete = false;
    this.width = this.height = this.naturalWidth = this.naturalHeight = 0;
    this._surface = null;
    this._file = '';
    this._src = '';
  }
  HTMLImageElement.prototype = Object.create(Element.prototype);
  HTMLImageElement.prototype.constructor = HTMLImageElement;
  // The decoded pixels, as the native canvas and WebGL functions take them.
  Object.defineProperty(HTMLImageElement.prototype, '__native', {
    get: function () {
      if (!this.complete || this._decodeFailed) return null;
      if (!this._surface) return decode(this);
      // Used again: it goes to the back of the queue of copies to drop.
      // Nearly always it is there already or the queue is short.
      var last = decoded.length - 1;
      if (decoded[last] !== this) {
        var at = decoded.lastIndexOf(this);
        if (at >= 0) { decoded.splice(at, 1); decoded.push(this); }
      }
      return this._surface;
    },
  });
  // --- Bytes as addresses (Blob, URL.createObjectURL) -----------------------
  // Only what the engine's handling of encrypted images needs: a Blob keeps
  // the blocks of bytes it was made from, and an address made for it leads
  // back to them.
  function Blob(parts, options) {
    this._parts = parts ? Array.prototype.slice.call(parts) : [];
    this.type = (options && options.type) || '';
    this.size = this._parts.reduce(function (sum, part) { return sum + (part.byteLength || part.length || 0); }, 0);
  }
  var blobs = {};
  var nextBlob = 1;
  function URL() { browser.missing('the URL class'); }
  URL.createObjectURL = function (blob) {
    var url = 'blob:potato-player/' + nextBlob++;
    blobs[url] = blob;
    return url;
  };
  URL.revokeObjectURL = function (url) { delete blobs[url]; };
  globalThis.Blob = Blob;
  globalThis.URL = globalThis.webkitURL = URL;

  // The image file behind a blob: address and its size, read from the PNG
  // header in the blob's own bytes; null if the bytes are not the start of a
  // PNG file that came from a file.
  function blobFile(url) {
    var blob = blobs[url];
    var part = blob && blob._parts.length === 1 ? blob._parts[0] : null;
    var path = part ? browser.fileBehind(part) : null;
    if (!path) return null;
    var head = new Uint8Array(ArrayBuffer.isView(part) ? part.buffer : part);
    var signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
    if (head.length < 24) return null;
    for (var i = 0; i < signature.length; i++) if (head[i] !== signature[i]) return null;
    var view = new DataView(head.buffer);
    return { path: path, size: [view.getUint32(16), view.getUint32(20)] };
  }

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    get: function () { return this._src; },
    set: function (url) {
      url = String(url);
      this._src = url;
      this.complete = false;
      if (!url) return;
      var image = this;
      later(function () {
        if (image._src !== url) return; // replaced before it loaded
        // A blob: address made from bytes that stand for a file (an encrypted
        // image the engine has unscrambled) shows that file.
        var blob = /^blob:/.test(url) ? blobFile(url) : null;
        var file = blob ? blob.path : gamePath(url);
        var size = blob ? blob.size : /^(data|blob):/.test(url) ? null : c2d.imageSize(file);
        if (!size) {
          if (/^(data|blob):/.test(url)) browser.missing('images from data: addresses or from bytes made in script');
          // Reported once per address: the engine asks again and again.
          if (!failedImages[url]) console.warn('image: cannot load ' + url.slice(0, 120));
          failedImages[url] = true;
          return emit(image, 'error');
        }
        dropDecoded(image);
        image._file = file;
        image._decodeFailed = false;
        image.width = image.naturalWidth = size[0];
        image.height = image.naturalHeight = size[1];
        image.complete = true;
        emit(image, 'load');
      });
    },
  });

  // --- File requests --------------------------------------------------------
  function startOfFile(file, count) {
    var bytes = player.readFileBytes(file, count);
    return bytes && browser.bytesStandFor(bytes, file);
  }
  function XMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseType = '';
    this.response = null;
    this.responseText = '';
  }
  XMLHttpRequest.prototype = Object.create(EventTarget.prototype);
  XMLHttpRequest.prototype.constructor = XMLHttpRequest;
  Object.assign(XMLHttpRequest.prototype, {
    open: function (method, url) { this._url = String(url); this.responseURL = this._url; this.readyState = 1; },
    overrideMimeType: function () {},
    setRequestHeader: function () {},
    getResponseHeader: function () { return null; },
    abort: function () { this._aborted = true; },
    send: function () {
      var request = this;
      later(function () {
        if (request._aborted) return;
        var text = null;
        var file = gamePath(request._url);
        if (request.responseType === 'arraybuffer') {
          // Sound files are not handed over whole: see audio.js.
          // Nor are encrypted images: the engine only unscrambles their
          // start, so the start is all it gets (see file-bytes.js).
          var isSound = browser.readSoundFile && browser.soundFiles.test(file);
          var bytes = isSound ? browser.readSoundFile(file)
            : browser.startOnlyFiles.test(file) ? startOfFile(file, 80)
            : player.readFileBytes(file);
          request.readyState = 4;
          if (bytes) {
            request.status = 200;
            request.response = bytes;
            emit(request, 'readystatechange');
            return emit(request, 'load');
          }
        } else if (request.responseType === 'blob') {
          browser.missing('file requests for binary data (blob)');
        } else {
          text = player.readTextFile(file);
        }
        request.readyState = 4;
        if (text === null) {
          request.status = 404;
          console.warn('request: cannot read ' + request._url);
          emit(request, 'readystatechange');
          return emit(request, 'error');
        }
        request.status = 200;
        request.responseText = text;
        request.response = request.responseType === 'json' ? JSON.parse(text) : text;
        emit(request, 'readystatechange');
        emit(request, 'load');
      });
    },
  });

  // --- The page -------------------------------------------------------------
  var document = new Element('#document');
  document.documentElement = new Element('html');
  document.head = new Element('head');
  document.body = new Element('body');
  document.appendChild(document.documentElement);
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  Object.assign(document, {
    readyState: 'complete', hidden: false, visibilityState: 'visible', title: '', currentScript: null,
    createElement: function (tag) {
      var name = String(tag).toLowerCase();
      if (name === 'canvas') return new HTMLCanvasElement();
      if (name === 'img') return new HTMLImageElement();
      var element = new Element(name);
      if (name === 'video' && browser.makeVideo) return browser.makeVideo(element);
      // The engine adds fonts at run time by inserting a rule in a style sheet.
      if (name === 'style') element.sheet = { insertRule: function (rule) { registerFontFaceRules(String(rule), ''); return 0; } };
      return element;
    },
    createTextNode: function (text) { return Object.assign(new Element('#text'), { textContent: String(text) }); },
    getElementById: function (id) {
      var all = document.getElementsByTagName('*');
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    },
    hasFocus: function () { return true; },
  });
  var elementsByTag = Element.prototype.getElementsByTagName;
  document.getElementsByTagName = function (tag) {
    // Plugins look up their own <script> element to read its address.
    return String(tag).toLowerCase() === 'script' ? nodeList(scripts.slice()) : elementsByTag.call(document, tag);
  };

  // The global object is the window.
  var windowEvents = new EventTarget();
  var storage = {};
  Object.assign(globalThis, {
    window: globalThis, self: globalThis, top: globalThis, parent: globalThis,
    document: document,
    Event: Event, EventTarget: EventTarget,
    Element: Element, HTMLElement: Element, Node: Element,
    HTMLCanvasElement: HTMLCanvasElement, HTMLImageElement: HTMLImageElement, Image: HTMLImageElement,
    // video.js, loaded before this file, defines the one that knows its elements.
    HTMLVideoElement: globalThis.HTMLVideoElement || function HTMLVideoElement() {},
    XMLHttpRequest: XMLHttpRequest,
    WebGLRenderingContext: function WebGLRenderingContext() {},
    devicePixelRatio: 1,
    // Without a sound output the engine is told to skip loading and playing
    // audio, with its own option for that.
    location: { search: player.audio ? '' : '?noaudio', hash: '', pathname: '/index.html', href: 'file://' + player.gameDir + '/index.html', protocol: 'file:', reload: function () { browser.missing('location.reload'); } },
    navigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0 Safari/537.36 potato-player',
      platform: 'Linux aarch64', language: 'en-US', languages: ['en-US'], maxTouchPoints: 0, onLine: false,
      getGamepads: function () { return []; },
    },
    screen: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, availWidth: gl.drawingBufferWidth, availHeight: gl.drawingBufferHeight },
    localStorage: {
      getItem: function (key) { return key in storage ? storage[key] : null; },
      setItem: function (key, value) { storage[key] = String(value); },
      removeItem: function (key) { delete storage[key]; },
    },
    addEventListener: function (type, fn) { windowEvents.addEventListener(type, fn); },
    removeEventListener: function (type, fn) { windowEvents.removeEventListener(type, fn); },
    dispatchEvent: function (event) { return windowEvents.dispatchEvent(event); },
    alert: function (text) { console.warn('alert: ' + text); },
    close: function () { console.info('the game closed its window'); player.exit(0); },
    focus: function () {}, blur: function () {},
    moveBy: function () {}, moveTo: function () {}, resizeBy: function () {}, resizeTo: function () {},
    scrollTo: function () {},
    getComputedStyle: function (element) { return element.style; },
    // Libraries replaced by inert stand-ins (see boot.js).
    FPSMeter: function FPSMeter() {
      this.isPaused = true;
      this.hide = this.show = this.showFps = this.showDuration = this.tickStart = this.tick = this.destroy = function () {};
    },
    makeVideoPlayableInline: function () {},
  });
  // The page is as large as the game's picture, so the engine applies no
  // scaling of its own; fitting it to the screen is the native player's job.
  Object.defineProperties(globalThis, {
    innerWidth: { get: function () { return screenCanvas ? screenCanvas.width : 816; }, configurable: true },
    innerHeight: { get: function () { return screenCanvas ? screenCanvas.height : 624; }, configurable: true },
    outerWidth: { get: function () { return globalThis.innerWidth; }, configurable: true },
    outerHeight: { get: function () { return globalThis.innerHeight; }, configurable: true },
  });

  // --- Keys -----------------------------------------------------------------
  // The native player reports the console's buttons and a keyboard as key
  // codes. They become the keyboard events a page receives.
  var KEY_NAMES = { 8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Control', 18: 'Alt', 27: 'Escape',
    32: ' ', 33: 'PageUp', 34: 'PageDown', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 45: 'Insert' };
  var keysDown = {};
  player.onKey = function (keyCode, down) {
    // F2 belongs to the player: the engine's own frame counter is a page
    // element this player does not have.
    if (keyCode === 113) { if (down) switchFrameRateDisplay(); return; }
    var name = KEY_NAMES[keyCode] || String.fromCharCode(keyCode).toLowerCase();
    var event = new Event(down ? 'keydown' : 'keyup', {
      keyCode: keyCode, which: keyCode, key: name, repeat: false, target: document.body,
      shiftKey: !!keysDown[16], ctrlKey: !!keysDown[17], altKey: !!keysDown[18], metaKey: false,
    });
    if (down) keysDown[keyCode] = true; else delete keysDown[keyCode];
    // Listeners are on the document or on the window; a real event reaches both.
    try {
      document.dispatchEvent(event);
      windowEvents.dispatchEvent(event);
    } catch (error) { console.error('key event: ' + describe(error)); }
  };

  // Fires the page's load event, which starts the engine.
  browser.fireLoad = function () {
    var event = new Event('load', { target: globalThis });
    if (typeof globalThis.onload === 'function') globalThis.onload(event);
    windowEvents.dispatchEvent(event);
  };
})();
