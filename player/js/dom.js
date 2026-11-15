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
  var browser = globalThis.__browser = {};

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
    if (clean.charAt(0) === '/') return clean;
    return player.gameDir + '/' + clean.replace(/^(\.\/)+/, '');
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
  }
  nativeRequestFrame(pump);

  // --- Fonts ----------------------------------------------------------------
  var fontFamilies = {};
  var fallbackFamily = null;
  browser.registerFont = function (family, url) {
    var file = gamePath(url);
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
    if (!name) browser.missing('any usable font: text will not be drawn');
    return (fallbackFamily = { name: name, widthFactor: 1.001 });
  }
  browser.resolveFontFamily = function (families) {
    for (var i = 0; i < families.length; i++) if (fontFamilies[families[i]]) return fontFamilies[families[i]];
    return fallback();
  };

  // --- Elements -------------------------------------------------------------
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
      return found;
    },
    getBoundingClientRect: function () {
      var w = this.width || 0, h = this.height || 0;
      return { left: 0, top: 0, x: 0, y: 0, width: w, height: h, right: w, bottom: h };
    },
    focus: function () {}, blur: function () {}, click: function () {},
    // Sound and video elements: nothing is playable through them yet.
    canPlayType: function () { return ''; },
    play: function () {}, pause: function () {}, load: function () {},
  });
  Object.defineProperties(Element.prototype, {
    firstChild: { get: function () { return this.children[0] || null; } },
    lastChild: { get: function () { return this.children[this.children.length - 1] || null; } },
    childNodes: { get: function () { return this.children; } },
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
  function HTMLImageElement() {
    Element.call(this, 'img');
    this.complete = false;
    this.width = this.height = this.naturalWidth = this.naturalHeight = 0;
    this.__native = null;
    this._src = '';
  }
  HTMLImageElement.prototype = Object.create(Element.prototype);
  HTMLImageElement.prototype.constructor = HTMLImageElement;
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
        var handle = /^(data|blob):/.test(url) ? null : c2d.loadImage(gamePath(url));
        if (!handle) {
          if (/^(data|blob):/.test(url)) browser.missing('images from data: or blob: addresses');
          console.warn('image: cannot load ' + url.slice(0, 120));
          return emit(image, 'error');
        }
        if (image.__native) c2d.destroy(image.__native);
        var size = c2d.size(handle);
        image.__native = handle;
        image.width = image.naturalWidth = size[0];
        image.height = image.naturalHeight = size[1];
        image.complete = true;
        emit(image, 'load');
      });
    },
  });

  // --- File requests --------------------------------------------------------
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
        if (request.responseType === 'arraybuffer' || request.responseType === 'blob') {
          browser.missing('file requests for binary data (' + request.responseType + ')');
        } else {
          text = player.readTextFile(gamePath(request._url));
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
    return String(tag).toLowerCase() === 'script' ? scripts.slice() : elementsByTag.call(document, tag);
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
    HTMLVideoElement: function HTMLVideoElement() {},
    XMLHttpRequest: XMLHttpRequest,
    WebGLRenderingContext: function WebGLRenderingContext() {},
    devicePixelRatio: 1,
    // Sound is switched off until the player has its audio output: with this
    // option the engine skips loading and playing audio.
    location: { search: '?noaudio', hash: '', pathname: '/index.html', href: 'file://' + player.gameDir + '/index.html', protocol: 'file:', reload: function () { browser.missing('location.reload'); } },
    navigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0 Safari/537.36 mvplayer',
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

  // Fires the page's load event, which starts the engine.
  browser.fireLoad = function () {
    var event = new Event('load', { target: globalThis });
    if (typeof globalThis.onload === 'function') globalThis.onload(event);
    windowEvents.dispatchEvent(event);
  };
})();
