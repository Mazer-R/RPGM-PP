// Minimal-runtime experiment: run an RPG Maker MV game's own scripts in a
// bare JavaScript engine (Node, so V8) with no browser. Drawing and audio are
// stubbed out; images are "loaded" by reading only their size from the PNG
// header. The point is to measure the engine-side cost alone: heap size and
// time per logic step.
//
// With LAB_CANVAS=1 the stand-in canvas and image objects are replaced by a
// real Canvas 2D implementation (the `canvas` package, backed by Cairo), so
// frames are really drawn on the CPU. LAB_SHOT=<file> then saves the last
// frame as a PNG.
//
// With LAB_GL=1 as well, canvases can also hand out a WebGL context (the `gl`
// package), so PIXI uses its WebGL renderer instead of drawing on the CPU.
//
// With LAB_FAKEGL=1 (and no real canvas) the stand-in canvases hand out a
// WebGL context that accepts every call and draws nothing, so PIXI runs its
// real WebGL renderer and the processor time it spends preparing a frame can
// be measured without a GPU.
//
// Usage: node --expose-gc run.js <www-dir> <map-id> <x> <y> <seconds> [cull-margin]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [wwwArg, mapId, mapX, mapY, seconds, cullMargin] = process.argv.slice(2);
const WWW = path.resolve(wwwArg);
const real = process.env.LAB_CANVAS ? require('canvas') : null;
const createGL = real && process.env.LAB_GL ? require('gl') : null;
const glCalls = {};
let glMs = 0;
let glContexts = 0;
let shaderRenames = 0;
let lightmaskHidden = false;
let screenTone = null;
let arrayUniformLookups = 0;
const glDebug = {};
const pendingFramebufferChecks = [];
const fakeGL = process.env.LAB_FAKEGL ? require('./fake-webgl.js') : null;
const fakeGlCalls = {};
// True only while the measurement window is open. Declared early because
// wrappers installed at start-up consult it before the driver state exists.
let measuring = false;
const errors = [];
const noteError = (where, e) => {
  const text = where + ': ' + (e && e.message ? e.message : String(e));
  if (errors.length < 12 && errors.indexOf(text) < 0) errors.push(text);
};
const resolveUrl = (url) => path.join(WWW, decodeURIComponent(String(url).split('?')[0]));

// --- Event plumbing shared by every fake DOM object ------------------------
class Target {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
  }
  _emit(type) {
    const event = { type, target: this, preventDefault() {} };
    if (typeof this['on' + type] === 'function') this['on' + type](event);
    (this._listeners[type] || []).slice().forEach((fn) => fn.call(this, event));
  }
}

// --- Canvas 2D context that accepts every call and draws nothing -----------
function makeContext(canvas) {
  const gradient = { addColorStop() {} };
  const base = {
    canvas,
    measureText(text) {
      // Width depends on the font so the engine's "is the font loaded yet"
      // check, which compares widths between two fonts, succeeds.
      let hash = 0;
      const font = String(this.font);
      for (let i = 0; i < font.length; i++) hash = (hash * 31 + font.charCodeAt(i)) & 0xffff;
      return { width: String(text).length * (6 + (hash % 7)) };
    },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    createPattern() { return {}; },
  };
  const noop = function () {};
  return new Proxy(base, {
    get(target, key) { return key in target ? target[key] : noop; },
    set(target, key, value) { target[key] = value; return true; },
  });
}

// --- Elements ---------------------------------------------------------------
class Element extends Target {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.children = [];
    this.width = 0;
    this.height = 0;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    if (child.tagName === 'SCRIPT' && child.src) loadScript(child.src, child);
    return child;
  }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  insertBefore(child) { return this.appendChild(child); }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name]; }
  getElementsByTagName(tag) {
    const wanted = String(tag).toUpperCase();
    const found = [];
    const visit = (node) => (node.children || []).forEach((c) => { if (c.tagName === wanted) found.push(c); visit(c); });
    visit(this);
    return found;
  }
  hasChildNodes() { return this.children.length > 0; }
  get firstChild() { return this.children[0] || null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  getContext(kind) {
    if (kind === '2d') return this._context || (this._context = makeContext(this));
    if (fakeGL && (kind === 'webgl' || kind === 'experimental-webgl')) {
      return this._gl || (this._gl = fakeGL.createFakeWebGL(this, fakeGlCalls));
    }
    return null; // no WebGL: the engine falls back to canvas drawing
  }
  canPlayType() { return ''; }
  focus() {}
  play() {}
  pause() {}
  load() {}
}
class HTMLCanvasElement extends Element { constructor() { super('canvas'); } }
class HTMLVideoElement extends Element { constructor() { super('video'); } }

// --- Images: only the size is read, never the pixels -----------------------
// LAB_IMAGE_SIZES=<file> points at a JSON map of image path to [width,
// height], so the stubbed runner can run where the image files are absent.
const imageSizes = process.env.LAB_IMAGE_SIZES ? JSON.parse(fs.readFileSync(process.env.LAB_IMAGE_SIZES, 'utf8')) : null;
let imagesRequested = 0, imagePixels = 0;
class Image extends Element {
  constructor() { super('img'); this.complete = false; this._src = ''; }
  get src() { return this._src; }
  set src(url) {
    this._src = url;
    if (!url) return;
    imagesRequested++;
    setImmediate(() => {
      try {
        const known = imageSizes && imageSizes[decodeURIComponent(String(url).split('?')[0])];
        if (known) {
          this.width = this.naturalWidth = known[0];
          this.height = this.naturalHeight = known[1];
        } else {
          const fd = fs.openSync(resolveUrl(url), 'r');
          const header = Buffer.alloc(24);
          fs.readSync(fd, header, 0, 24, 0);
          fs.closeSync(fd);
          this.width = this.naturalWidth = header.readUInt32BE(16);
          this.height = this.naturalHeight = header.readUInt32BE(20);
        }
        imagePixels += this.width * this.height;
        this.complete = true;
        this._emit('load');
      } catch (e) {
        noteError('image ' + url, e);
        this._emit('error');
      }
    });
  }
}


// --- Optional real Canvas 2D ------------------------------------------------
// The real canvas and image classes get the few DOM members the engine and
// PIXI touch, and images are loaded from the game folder through the same
// asynchronous load/error events a browser would fire.
if (real) {
  const css = fs.readFileSync(path.join(WWW, 'fonts', 'gamefont.css'), 'utf8');
  for (const m of css.matchAll(/font-family:\s*([^;]+);[^}]*?url\(["']?([^"')]+)/g)) {
    real.registerFont(path.join(WWW, 'fonts', m[2]), { family: m[1].trim() });
  }
  const canvasProto = real.Canvas.prototype;
  const nativeGetContext = canvasProto.getContext;
  Object.assign(canvasProto, {
    tagName: 'CANVAS',
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, focus() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
    getContext(kind, options) {
      if (kind === '2d') return nativeGetContext.apply(this, arguments);
      if (createGL && (kind === 'webgl' || kind === 'experimental-webgl')) return webglContextFor(this, options || {});
      if (fakeGL && (kind === 'webgl' || kind === 'experimental-webgl')) {
        return this._labFakeGl || (this._labFakeGl = fakeGL.createFakeWebGL(this, fakeGlCalls));
      }
      return null;
    },
  });

  // One WebGL context per canvas, created at the canvas's current size and
  // resized with it. Every call is counted and timed so the set of WebGL
  // functions the game really uses can be listed afterwards.
  function webglContextFor(canvas, options) {
    if (canvas._labGl) return canvas._labGl;
    const gl = createGL(canvas.width || 1, canvas.height || 1, {
      stencil: true, depth: true, alpha: options.alpha !== false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    glContexts++;
    for (const name in gl) {
      const native = gl[name];
      if (typeof native !== 'function') continue;
      gl[name] = function () {
        if (process.env.LAB_GL_TRACE) {
          // Written synchronously so the last line survives a native crash.
          const brief = Array.prototype.map.call(arguments, (a) =>
            (a && typeof a === 'object' ? (a.constructor ? a.constructor.name : 'object') + (a.width ? '(' + a.width + 'x' + a.height + ')' : a.length !== undefined ? '[' + a.length + ']' : '') : String(a)));
          fs.writeSync(2, 'GL ' + name + ' ' + brief.join(',') + '\n');
        }
        const before = performance.now();
        try { return native.apply(gl, arguments); }
        finally { glMs += performance.now() - before; glCalls[name] = (glCalls[name] || 0) + 1; }
      };
    }
    // Report shader compile failures: the engine's own handling of a failed
    // shader goes on to crash the WebGL library.
    const compileShader = gl.compileShader, shaderSource = gl.shaderSource;
    const sources = new Map();
    gl.shaderSource = function (shader, source) {
      // `sample` is an ordinary name in the shader language WebGL uses, but a
      // reserved word in the desktop OpenGL this library runs on. Rename it.
      // A real OpenGL ES 2.0 driver does not need this.
      const patched = String(source).replace(/\bsample\b/g, 'sample_lab');
      if (patched !== source) shaderRenames++;
      sources.set(shader, patched);
      return shaderSource.call(gl, shader, patched);
    };
    gl.compileShader = function (shader) {
      compileShader.call(gl, shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = String(gl.getShaderInfoLog(shader));
        noteError('shader', log.split('\n')[0]);
        fs.writeSync(2, 'SHADER FAILED\n' + log + '\n--- first lines of source ---\n' +
          String(sources.get(shader)).split('\n').slice(0, 12).join('\n') + '\n--- end ---\n');
      }
    };
    // Optional diagnostics: record WebGL errors after each draw call and
    // whether each off-screen framebuffer is usable when it is bound.
    if (process.env.LAB_GL_DEBUG) {
      // Tally WebGL errors raised by texture uploads, with a short summary of
      // the arguments, to find uploads the library rejects.
      ['texImage2D', 'texSubImage2D', 'uniform1iv', 'uniform2fv', 'uniform1fv', 'bufferData', 'bufferSubData', 'drawArrays'].forEach((name) => {
        const nativeCall = gl[name];
        gl[name] = function () {
          const result = nativeCall.apply(gl, arguments);
          const error = gl.getError();
          if (error) {
            const brief = Array.prototype.map.call(arguments, (a) => (a === null ? 'null' : typeof a === 'object'
              ? (a.constructor ? a.constructor.name : 'object') + (a.width ? '(' + a.width + 'x' + a.height + ')' : a.length !== undefined ? '[' + a.length + ']' : '')
              : typeof a)).join(',');
            const key = name + ' error 0x' + error.toString(16) + ' (' + brief + ')';
            glDebug[key] = (glDebug[key] || 0) + 1;
          }
          return result;
        };
      });
      const draw = gl.drawElements, bind = gl.bindFramebuffer;
      const seen = new Set();
      gl.drawElements = function () {
        const result = draw.apply(gl, arguments);
        const error = gl.getError();
        if (error) glDebug['drawElements error 0x' + error.toString(16)] = (glDebug['drawElements error 0x' + error.toString(16)] || 0) + 1;
        return result;
      };
      gl.bindFramebuffer = function (target, framebuffer) {
        const result = bind.apply(gl, arguments);
        if (framebuffer) {
          const key = 'framebuffer status at bind 0x' + gl.checkFramebufferStatus(gl.FRAMEBUFFER).toString(16);
          glDebug[key] = (glDebug[key] || 0) + 1;
        }
        return result;
      };
    }
    // WebGL and OpenGL ES both accept an array uniform's bare name ("m") as
    // well as "m[0]". This library only accepts the second form, so PIXI's
    // lookup of array uniforms returned nothing and filters drew black.
    const getUniformLocation = gl.getUniformLocation;
    gl.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(gl, program, name);
      if (location || String(name).indexOf('[') >= 0) return location;
      const asArray = getUniformLocation.call(gl, program, name + '[0]');
      if (asArray) arrayUniformLookups++;
      return asArray;
    };
    gl.canvas = canvas;
    canvas._labGl = gl;
    return gl;
  }
  for (const dimension of ['width', 'height']) {
    const native = Object.getOwnPropertyDescriptor(canvasProto, dimension);
    Object.defineProperty(canvasProto, dimension, {
      get() { return native.get.call(this); },
      set(value) {
        native.set.call(this, value);
        if (this._labGl) {
          const ext = this._labGl.getExtension('STACKGL_resize_drawingbuffer');
          if (ext) ext.resize(this.width, this.height);
        }
      },
    });
  }
  if (createGL) globalThis.WebGLRenderingContext = function WebGLRenderingContext() {};
  Object.defineProperty(canvasProto, 'style', {
    get() { return this._labStyle || (this._labStyle = {}); },
  });

  const imageProto = real.Image.prototype;
  const nativeSrc = Object.getOwnPropertyDescriptor(imageProto, 'src');
  Object.assign(imageProto, {
    tagName: 'IMG',
    addEventListener(type, fn) {
      this._labListeners = this._labListeners || {};
      (this._labListeners[type] = this._labListeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      if (this._labListeners && this._labListeners[type]) {
        this._labListeners[type] = this._labListeners[type].filter((f) => f !== fn);
      }
    },
  });
  Object.defineProperty(imageProto, 'src', {
    get() { return this._labUrl || ''; },
    set(url) {
      this._labUrl = url;
      if (!url) return;
      imagesRequested++;
      const fire = (type) => ((this._labListeners || {})[type] || []).slice()
        .forEach((fn) => fn.call(this, { type, target: this }));
      setImmediate(() => {
        this.onload = () => { imagePixels += this.width * this.height; fire('load'); };
        this.onerror = (e) => { noteError('image ' + url, e); fire('error'); };
        try { nativeSrc.set.call(this, fs.readFileSync(resolveUrl(url))); }
        catch (e) { this.onerror(e); }
      });
    },
  });
}
// Browsers convert every numeric argument with the language's ToNumber rule
// before a canvas call runs, so "150" or true are accepted. The canvas
// library rejects non-numbers, and game plugins rely on the conversion.
// Apply it here for the methods whose arguments are all numbers, and count
// how often it was actually needed.
const coercions = {};
if (real) {
  const contextProto = real.CanvasRenderingContext2D.prototype;
  ['createRadialGradient', 'createLinearGradient', 'fillRect', 'clearRect', 'strokeRect', 'rect', 'arc',
    'moveTo', 'lineTo', 'translate', 'scale', 'rotate', 'setTransform', 'transform',
    'quadraticCurveTo', 'bezierCurveTo'].forEach((name) => {
    const native = contextProto[name];
    if (typeof native !== 'function') return;
    contextProto[name] = function () {
      const args = new Array(arguments.length);
      for (let i = 0; i < arguments.length; i++) {
        const value = arguments[i];
        if (typeof value === 'number' || typeof value === 'boolean' && name === 'arc' && i === 5) {
          args[i] = value;
        } else {
          args[i] = Number(value);
          coercions[name] = (coercions[name] || 0) + 1;
        }
      }
      return native.apply(this, args);
    };
  });
}
// LAB_CANVAS_PROFILE=1 times every Canvas 2D call by method name while the
// measurement runs, and splits fillRect by how it is used, since one large
// gradient fill costs far more than many small solid ones.
const canvasCalls = {};
if (real && process.env.LAB_CANVAS_PROFILE) {
  const contextProto = real.CanvasRenderingContext2D.prototype;
  Object.getOwnPropertyNames(contextProto).forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(contextProto, name);
    if (!descriptor || typeof descriptor.value !== 'function' || name === 'constructor') return;
    const native = descriptor.value;
    contextProto[name] = function () {
      if (!measuring) return native.apply(this, arguments);
      let label = name;
      if (name === 'fillRect') {
        const big = Math.abs(arguments[2] * arguments[3]) >= 200000;
        const gradient = typeof this.fillStyle !== 'string';
        label = 'fillRect ' + (big ? 'large' : 'small') + (gradient ? ' gradient' : ' solid') + ' [' + this.globalCompositeOperation + ']';
      } else if (name === 'drawImage') {
        const w = arguments.length >= 9 ? arguments[7] : (arguments.length >= 5 ? arguments[3] : (arguments[0] && arguments[0].width) || 0);
        const h = arguments.length >= 9 ? arguments[8] : (arguments.length >= 5 ? arguments[4] : (arguments[0] && arguments[0].height) || 0);
        label = 'drawImage ' + (Math.abs(w * h) >= 200000 ? 'large' : 'small') + ' [' + this.globalCompositeOperation + ']';
      }
      const before = performance.now();
      try { return native.apply(this, arguments); }
      finally {
        const entry = canvasCalls[label] || (canvasCalls[label] = { n: 0, ms: 0 });
        entry.n++; entry.ms += performance.now() - before;
      }
    };
  });
}
const ImageClass = real ? real.Image : Image;
const CanvasClass = real ? real.Canvas : HTMLCanvasElement;

// --- XMLHttpRequest over local files ---------------------------------------
class XMLHttpRequest extends Target {
  open(method, url) { this._url = url; }
  overrideMimeType() {}
  setRequestHeader() {}
  send() {
    setImmediate(() => {
      try {
        const data = fs.readFileSync(resolveUrl(this._url));
        this.status = 200;
        this.readyState = 4;
        if (this.responseType === 'arraybuffer') {
          this.response = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } else {
          this.responseText = this.response = data.toString('utf8');
        }
        this._emit('load');
      } catch (e) {
        this.status = 404;
        noteError('xhr ' + this._url, e);
        this._emit('error');
      }
    });
  }
}

// --- Globals the game scripts expect ---------------------------------------
function loadScript(src, element) {
  const current = element || Object.assign(new Element('script'), { src });
  scriptElements.push(current);
  documentTarget.currentScript = current;
  try {
    vm.runInThisContext(fs.readFileSync(resolveUrl(src), 'utf8'), { filename: src });
    if (element) setImmediate(() => element._emit('load'));
  } catch (e) {
    noteError('script ' + src, e);
    if (element) setImmediate(() => element._emit('error'));
  }
}

const windowTarget = new Target();
const documentTarget = new Element('document');
const storage = {};
Object.assign(globalThis, {
  window: globalThis,
  self: globalThis,
  Image: ImageClass, HTMLImageElement: ImageClass, HTMLCanvasElement: CanvasClass, HTMLVideoElement, XMLHttpRequest,
  location: { search: '?noaudio', pathname: '/index.html', href: 'http://lab/index.html', reload() {} },
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  },
  innerWidth: 816, innerHeight: 624, devicePixelRatio: 1,
  addEventListener: (t, f) => windowTarget.addEventListener(t, f),
  removeEventListener: (t, f) => windowTarget.removeEventListener(t, f),
  alert() {}, close() {},
  // Libraries replaced by empty stand-ins instead of being loaded.
  FPSMeter: function () {
    this.isPaused = true;
    this.hide = this.show = this.showFps = this.showDuration = this.tickStart = this.tick = function () {};
  },
  makeVideoPlayableInline: function () {},
});
// Recent Node versions define `navigator` as a read-only getter.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'lab', maxTouchPoints: 0, getGamepads: () => [] }, configurable: true, writable: true,
});
documentTarget.body = new Element('body');
documentTarget.head = new Element('head');
documentTarget.createElement = (tag) => {
  const t = String(tag).toLowerCase();
  if (t === 'canvas') return real ? real.createCanvas(300, 150) : new HTMLCanvasElement();
  if (t === 'video') return new HTMLVideoElement();
  if (t === 'img') return new ImageClass();
  return new Element(t);
};
documentTarget.createTextNode = (text) => Object.assign(new Element('#text'), { textContent: String(text) });
documentTarget.getElementById = (id) => {
  const find = (node) => node.id === id ? node : (node.children || []).map(find).find(Boolean);
  return find(documentTarget.body) || null;
};
// Some plugins look up their own <script> element to read its URL.
const scriptElements = [];
documentTarget.getElementsByTagName = (tag) => (String(tag).toLowerCase() === 'script' ? scriptElements : []);
globalThis.document = documentTarget;
if (fakeGL) globalThis.WebGLRenderingContext = function WebGLRenderingContext() {};

let frameCallback = null;
globalThis.requestAnimationFrame = (fn) => { frameCallback = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};

// --- Boot: same script order as the game's index.html ----------------------
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const skipped = ['fpsmeter.js', 'iphone-inline-video.browser.js'];
for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  if (!skipped.some((name) => match[1].endsWith(name))) loadScript(match[1]);
}

let bootSeconds = null;
let leftMapAtStep = null;
const logicMs = [];
const drawMs = [];
let phase = 'boot', phaseAt = Date.now(), frames = 0;
const startedAt = Date.now();
// LAB_STEPS=<n> measures a fixed number of logic steps instead of a time span.
const stepLimit = Number(process.env.LAB_STEPS) || 0;

function sceneName() {
  const s = globalThis.SceneManager && SceneManager._scene;
  return s ? s.constructor.name : null;
}

// Diagnostic switch: skip the full-map tone filter the engine adds in WebGL
// mode, to tell a filter-pipeline fault from a general drawing fault.
function disableToneFilter() {
  Spriteset_Base.prototype.createWebGLToneChanger = function () {};
  Spriteset_Base.prototype.updateWebGLToneChanger = function () {};
}

// LAB_PROFILE=1 splits the logic step into its main parts by timing a few
// engine functions. The parts nest: events and sprites are inside the map
// scene's update.
const profile = {};
function profileWrap(owner, name, label) {
  if (!owner || typeof owner[name] !== 'function') return;
  const original = owner[name];
  profile[label] = 0;
  owner[name] = function () {
    const before = performance.now();
    try { return original.apply(this, arguments); }
    finally { if (phase === 'measure') profile[label] += performance.now() - before; }
  };
}
function installProfile() {
  profileWrap(Game_Map.prototype, 'updateEvents', 'events');
  profileWrap(Game_Map.prototype, 'update', 'mapTotal');
  profileWrap(Game_Player.prototype, 'update', 'player');
  profileWrap(Spriteset_Map.prototype, 'update', 'spriteset');
  profileWrap(Game_Screen.prototype, 'update', 'screen');
  profileWrap(Game_Timer.prototype, 'update', 'timer');
  profileWrap(Scene_Map.prototype, 'updateChildren', 'sceneChildren');
  profileWrap(Scene_Map.prototype, 'updateMain', 'sceneMain');
  profileWrap(Window_Base.prototype, 'update', 'windows');
}

// Diagnostic switch: make the engine build its classic tilemap (layers
// painted on canvases and uploaded as textures) even under WebGL, instead of
// the shader-based tilemap library, to tell which of the two fails to draw.
function forcePlainTilemap() {
  const createTilemap = Spriteset_Map.prototype.createTilemap;
  Spriteset_Map.prototype.createTilemap = function () {
    const isWebGL = Graphics.isWebGL;
    Graphics.isWebGL = function () { return false; };
    try { createTilemap.apply(this, arguments); }
    finally { Graphics.isWebGL = isWebGL; }
  };
}

function installMeasurement() {
  if (process.env.LAB_NO_TONE_FILTER) disableToneFilter();
  if (process.env.LAB_PLAIN_TILEMAP) forcePlainTilemap();
  // LAB_GPU_LIGHTS=1 replaces the lighting plugin's canvas painting with
  // sprites drawn through WebGL. It must be in place before the map scene
  // builds its sprite set.
  if (process.env.LAB_GPU_LIGHTS) {
    const file = path.join(__dirname, '..', 'overlays', 'gpu-lights.js');
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'gpu-lights.js' });
    window.__installGpuLights();
  }
  if (cullMargin) {
    loadOverlay();
    window.__installEventCulling(Number(cullMargin));
  }
  if (process.env.LAB_PROFILE) installProfile();
  const updateScene = SceneManager.updateScene;
  SceneManager.updateScene = function () {
    const before = performance.now();
    updateScene.apply(this, arguments);
    if (phase === 'measure') {
      logicMs.push(performance.now() - before);
      // Remember when the game first left the map scene (for example to the
      // game-over scene), counted in logic steps.
      if (leftMapAtStep === null && sceneName() !== 'Scene_Map') leftMapAtStep = logicMs.length;
    }
  };
  const renderScene = SceneManager.renderScene;
  SceneManager.renderScene = function () {
    const before = performance.now();
    renderScene.apply(this, arguments);
    if (phase === 'measure') drawMs.push(performance.now() - before);
  };
  Object.keys(fakeGlCalls).forEach((k) => { delete fakeGlCalls[k]; });
  // Count WebGL work only from here on, so start-up uploads are excluded.
  glMs = 0;
  Object.keys(glCalls).forEach((k) => { delete glCalls[k]; });
}

function loadOverlay() {
  // LAB_CULL_OVERLAY picks the overlay file; the default is the first version.
  // LAB_CULL_OPTS is a JSON object of options handed to the overlay.
  globalThis.__eventCullingOptions = JSON.parse(process.env.LAB_CULL_OPTS || '{}');
  const name = process.env.LAB_CULL_OVERLAY || 'event-culling.js';
  const file = path.join(__dirname, '..', 'overlays', name);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: name });
}

function finish() {
  if (global.gc) global.gc();
  const sorted = logicMs.slice().sort((a, b) => a - b);
  const pickFrom = (list, p) => (list.length ? Math.round(list[Math.floor((list.length - 1) * p)] * 100) / 100 : null);
  const pick = (p) => pickFrom(sorted, p);
  const drawSorted = drawMs.slice().sort((a, b) => a - b);
  let shot = null;
  let shotLitFraction = null;
  if (real && process.env.LAB_SHOT) {
    try {
      let source = Graphics._canvas;
      const gl = Graphics._canvas._labGl;
      if (gl) {
        // Read the WebGL framebuffer back and flip it: GL rows start at the bottom.
        const w = Graphics._canvas.width, h = Graphics._canvas.height;
        const pixels = new Uint8Array(w * h * 4);
        // PIXI may leave an off-screen framebuffer bound; read the screen itself.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++;
        shotLitFraction = Math.round(lit / (w * h) * 1000) / 1000;
        source = real.createCanvas(w, h);
        const image = source.getContext('2d').createImageData(w, h);
        for (let y = 0; y < h; y++) {
          image.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        }
        source.getContext('2d').putImageData(image, 0, 0);
      }
      fs.writeFileSync(process.env.LAB_SHOT, source.toBuffer('image/png'));
      shot = process.env.LAB_SHOT;
    }
    catch (e) { noteError('screenshot', e); }
  }
  const mem = process.memoryUsage();
  const mb = (n) => Math.round(n / 1048576);
  let events = null;
  try { events = $gameMap.events().length; } catch (e) { /* no map */ }
  console.log(JSON.stringify({
    scene: sceneName(), mapId: Number(mapId), events, cullMargin: cullMargin || null,
    logicSteps: sorted.length, logicMedianMs: pick(0.5), logicP95Ms: pick(0.95), logicMaxMs: pick(1),
    drawFrames: drawSorted.length, drawMedianMs: pickFrom(drawSorted, 0.5), drawP95Ms: pickFrom(drawSorted, 0.95),
    glDebug, shotLitFraction, glContexts, shaderRenames, arrayUniformLookups, lightmaskHidden, screenTone, glFunctionsUsed: Object.keys(glCalls).length,
    glMsPerFrame: drawSorted.length ? Math.round(glMs / drawSorted.length * 100) / 100 : null,
    glCallsPerFrame: drawSorted.length ? Math.round(Object.values(glCalls).reduce((a, b) => a + b, 0) / drawSorted.length) : null,
    glTop: Object.entries(glCalls).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v),
    fakeGlCallsPerFrame: drawSorted.length ? Math.round(Object.values(fakeGlCalls).reduce((a, b) => a + b, 0) / drawSorted.length) : null,
    fakeGlTop: Object.entries(fakeGlCalls).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v),
    canvasMsPerStep: Object.fromEntries(Object.entries(canvasCalls).sort((a, b) => b[1].ms - a[1].ms).slice(0, 10)
      .map(([k, v]) => [k, { callsPerStep: Math.round(v.n / Math.max(1, sorted.length) * 10) / 10, msPerStep: Math.round(v.ms / Math.max(1, sorted.length) * 100) / 100 }])),
    coercions, realCanvas: !!real, renderer: globalThis.Graphics && Graphics._renderer ? Graphics._renderer.constructor.name : null, shot,
    leftMapAtStep,
    profileMsPerStep: Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, sorted.length ? Math.round(v / sorted.length * 100) / 100 : null])),
    cullStats: globalThis.__eventCullingStats || null,
    gpuLights: globalThis.__gpuLightsStats || null,
    bootSeconds: bootSeconds, node: process.version, jitless: process.execArgv.indexOf('--jitless') >= 0,
    heapUsedMb: mb(mem.heapUsed), rssMb: mb(mem.rss), externalMb: mb(mem.external),
    imagesRequested, imagePixelsMb: mb(imagePixels * 4), frames,
    errorPrinter: (documentTarget.body.children.find((c) => c.id === 'ErrorPrinter') || {}).innerHTML || null,
    errors,
  }));
  process.exit(0);
}

function tick() {
  const callback = frameCallback;
  frameCallback = null;
  if (callback) {
    try { callback(performance.now()); frames++; } catch (e) { noteError('frame', e); console.error(e.stack); return finish(); }
    if (SceneManager._stopped && !tick.reported) { tick.reported = true; }
  }
  const held = (Date.now() - phaseAt) / 1000;
  if (globalThis.SceneManager && SceneManager._stopped) return finish();
  try {
    if (phase === 'boot' && sceneName() && sceneName() !== 'Scene_Boot') {
      phase = 'first-scene'; phaseAt = Date.now();
      bootSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
    } else if (phase === 'first-scene' && held > 3) {
      installMeasurement();
      DataManager.setupNewGame();
      $gamePlayer.reserveTransfer(Number(mapId), Number(mapX), Number(mapY), 2, 0);
      SceneManager.goto(Scene_Map);
      phase = 'settle'; phaseAt = Date.now();
    } else if (phase === 'settle' && held > 4) {
      // Diagnostic: record the screen tone the map set, and optionally clear it.
      try {
        screenTone = $gameScreen.tone().slice();
        if (process.env.LAB_RESET_TONE) { $gameScreen._tone = [0, 0, 0, 0]; $gameScreen._toneTarget = [0, 0, 0, 0]; }
      } catch (e) { noteError('tone', e); }
      // Diagnostic switch: hide the lighting plugin's darkness layer.
      if (process.env.LAB_HIDE_LIGHTMASK) {
        const spriteset = SceneManager._scene._spriteset;
        const mask = spriteset && (spriteset._lightmask || spriteset.children.find((c) => c.constructor.name === 'Lightmask'));
        if (mask) { mask.visible = false; lightmaskHidden = true; }
      }
      phase = 'measure'; phaseAt = Date.now(); measuring = true;
    } else if (phase === 'measure' && (stepLimit ? logicMs.length >= stepLimit : held > Number(seconds))) {
      return finish();
    }
  } catch (e) { noteError('driver', e); return finish(); }
  // Slow machines need longer to boot; LAB_TIMEOUT (seconds) raises the limit.
  if (Date.now() - startedAt > (Number(process.env.LAB_TIMEOUT) || 40) * 1000 + Number(seconds) * 1000) return finish();
  setTimeout(tick, 16);
}

if (typeof window.onload === 'function') window.onload();
const catchException = SceneManager.catchException;
SceneManager.catchException = function (e) {
  noteError('engine', e);
  console.error('ENGINE ERROR STACK\n' + (e && e.stack ? e.stack.split('\n').slice(0, 9).join('\n') : e));
  return catchException.apply(this, arguments);
};
windowTarget._emit('load');
tick();
