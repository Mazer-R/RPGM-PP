// Test harness for the WPE experiment. Injected by serve.py; not part of the
// game. It reports progress on the console and drives the game through
// title -> new game -> map -> battle without any input device.
(function () {
  var start = Date.now();
  var updateMs = [];
  var phase = 'boot';
  var phaseSince = Date.now();
  var lastFrames = 0;

  function log(kind, data) {
    data.t = Math.round((Date.now() - start) / 100) / 10;
    console.log('[H] ' + kind + ' ' + JSON.stringify(data));
  }

  window.addEventListener('error', function (e) {
    log('error', { msg: String(e.message), src: String(e.filename).split('/').pop(), line: e.lineno });
  });
  window.addEventListener('unhandledrejection', function (e) {
    log('rejection', { msg: String(e.reason) });
  });


  // --- Memory accounting -------------------------------------------------
  // Track every image element, canvas and decoded audio buffer the page
  // creates, through weak references, so their pixel and sample sizes can be
  // summed later without keeping them alive.
  var tracked = { img: [], canvas: [], audio: [] };
  function track(kind, obj) { tracked[kind].push(new WeakRef(obj)); return obj; }

  var NativeImage = window.Image;
  window.Image = function (w, h) {
    return track('img', arguments.length ? new NativeImage(w, h) : new NativeImage());
  };
  window.Image.prototype = NativeImage.prototype;

  var nativeCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (name) {
    var el = nativeCreate.apply(this, arguments);
    var tag = String(name).toLowerCase();
    if (tag === 'canvas') track('canvas', el);
    if (tag === 'img') track('img', el);
    return el;
  };

  var AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    var nativeDecode = AC.prototype.decodeAudioData;
    AC.prototype.decodeAudioData = function (data, ok, fail) {
      return nativeDecode.call(this, data, function (buffer) {
        track('audio', buffer);
        if (ok) ok(buffer);
      }, fail);
    };
  }

  function live(kind, sizeOf) {
    var count = 0, bytes = 0, kept = [];
    tracked[kind].forEach(function (ref) {
      var o = ref.deref();
      if (o) { kept.push(ref); count++; bytes += sizeOf(o); }
    });
    tracked[kind] = kept;
    return { n: count, mb: Math.round(bytes / 1048576) };
  }

  function memoryReport() {
    var report = {
      phase: phase,
      images: live('img', function (i) { return i.naturalWidth * i.naturalHeight * 4; }),
      canvases: live('canvas', function (c) { return c.width * c.height * 4; }),
      audio: live('audio', function (b) { return b.length * b.numberOfChannels * 4; })
    };
    // Textures PIXI has uploaded to the GPU.
    try {
      var managed = Graphics._renderer.textureManager._managedTextures;
      var bytes = 0;
      managed.forEach(function (t) { bytes += t.realWidth * t.realHeight * 4; });
      report.glTextures = { n: managed.length, mb: Math.round(bytes / 1048576) };
    } catch (e) { report.glTextures = String(e); }
    // What MV's own image cache believes it holds.
    try {
      var items = ImageManager._imageCache._items, n = 0, px = 0, withCanvas = 0;
      Object.keys(items).forEach(function (k) {
        var b = items[k].bitmap; n++; px += b.width * b.height;
        if (b.__canvas) withCanvas++;
      });
      report.mvCache = { n: n, mb: Math.round(px * 4 / 1048576), withCanvas: withCanvas };
    } catch (e) { report.mvCache = String(e); }
    log('mem', report);
  }
  setInterval(memoryReport, 8000);


  // --- Per-frame time profile ---------------------------------------------
  // Wraps a few engine functions and sums the time spent inside each, so one
  // frame can be split into event logic, sprites, lighting and drawing.
  var query = {};
  location.search.slice(1).split('&').forEach(function (kv) {
    var parts = kv.split('='); query[parts[0]] = parts[1] === undefined ? true : parts[1];
  });
  var profile = {};
  var frames = 0;
  function wrap(owner, name, label) {
    if (!owner || typeof owner[name] !== 'function' || owner[name].__wrapped) return;
    var original = owner[name];
    profile[label] = 0;
    owner[name] = function () {
      var before = performance.now();
      try { return original.apply(this, arguments); }
      finally { profile[label] += performance.now() - before; }
    };
    owner[name].__wrapped = true;
  }
  function installProfile() {
    wrap(SceneManager, 'updateScene', 'logic');
    wrap(SceneManager, 'renderScene', 'draw');
    wrap(Game_Map.prototype, 'updateEvents', 'logic.events');
    wrap(Game_Map.prototype, 'updateInterpreter', 'logic.mapInterpreter');
    wrap(Game_Player.prototype, 'update', 'logic.player');
    wrap(Spriteset_Map.prototype, 'update', 'logic.sprites');
    if (window.Lightmask) wrap(Lightmask.prototype, 'update', 'logic.lighting');
    // Time spent inside WebGL calls themselves, to separate the browser's
    // drawing work from the JavaScript that prepares it. Opt-in, because the
    // extra timer calls slow the frame down slightly.
    if (query.labgl && Graphics._renderer && Graphics._renderer.gl) {
      var gl = Graphics._renderer.gl;
      profile['draw.glCalls'] = 0;
      profile['draw.glCallCount'] = 0;
      for (var key in gl) {
        if (typeof gl[key] !== 'function') continue;
        (function (name, fn) {
          gl[name] = function () {
            var before = performance.now();
            try { return fn.apply(gl, arguments); }
            finally {
              var spent = performance.now() - before;
              profile['draw.glCalls'] += spent;
              profile['draw.glCallCount']++;
              profile['gl.' + name] = (profile['gl.' + name] || 0) + spent;
            }
          };
        })(key, gl[key]);
      }
    }
    var requestUpdate = SceneManager.requestUpdate;
    SceneManager.requestUpdate = function () { frames++; return requestUpdate.apply(this, arguments); };
  }
  function profileReport() {
    var out = { frames: frames };
    Object.keys(profile).forEach(function (k) {
      out[k] = frames ? Math.round(profile[k] / frames * 100) / 100 : null;
      profile[k] = 0;
    });
    frames = 0;
    try {
      var events = $gameMap.events();
      out.mapId = $gameMap.mapId();
      out.events = events.length;
      out.parallel = events.filter(function (e) { return e._trigger === 4 && e._interpreter; }).length;
      if (window.__eventCullingStats) { out.cull = JSON.parse(JSON.stringify(window.__eventCullingStats)); var cs = window.__eventCullingStats; cs.updated = cs.skipped = cs.spritesSkipped = 0; }
      out.withImage = events.filter(function (e) { return e._characterName || e._tileId > 0; }).length;
    } catch (e) { /* no map yet */ }
    log('prof', out);
  }

  function setPhase(name) {
    phase = name;
    phaseSince = Date.now();
    log('phase', { phase: name });
  }

  function hookUpdate() {
    if (!window.SceneManager || SceneManager.__hooked) return;
    var original = SceneManager.updateMain;
    SceneManager.updateMain = function () {
      var before = performance.now();
      original.apply(this, arguments);
      updateMs.push(performance.now() - before);
    };
    SceneManager.__hooked = true;
  }

  function sceneName() {
    var s = window.SceneManager && SceneManager._scene;
    return s ? s.constructor.name : null;
  }

  function percentile(sorted, p) {
    return sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) * p)] * 10) / 10 : null;
  }

  setInterval(function () {
    hookUpdate();
    var sorted = updateMs.slice().sort(function (a, b) { return a - b; });
    var frames = window.Graphics ? Graphics.frameCount : 0;
    var printer = document.getElementById('ErrorPrinter');
    log('tick', {
      phase: phase,
      scene: sceneName(),
      fps: (frames - lastFrames) / 2,
      updMedian: percentile(sorted, 0.5),
      updP95: percentile(sorted, 0.95),
      updMax: percentile(sorted, 1),
      webgl: window.Graphics && Graphics.isWebGL ? Graphics.isWebGL() : null,
      audioCtx: window.WebAudio && WebAudio._context ? WebAudio._context.state : null,
      errorPrinter: printer && printer.innerHTML ? printer.textContent.slice(0, 200) : null
    });
    lastFrames = frames;
    updateMs = [];

    var held = (Date.now() - phaseSince) / 1000;
    var scene = sceneName();
    try {
      if (phase === 'boot' && scene && scene !== 'Scene_Boot') {
        setPhase('first-scene');
      } else if (phase === 'first-scene' && held > 15) {
        if (query.labcull) window.__installEventCulling(Number(query.labcull));
        installProfile();
        DataManager.setupNewGame();
        if (query.labmap) {
          // Jump straight to the requested map instead of the start map.
          $gamePlayer.reserveTransfer(Number(query.labmap), Number(query.labx), Number(query.laby), 2, 0);
        }
        SceneManager.goto(Scene_Map);
        setPhase('map');
      } else if (phase === 'map' && query.labmap) {
        if (held > 6) profileReport();
      } else if (phase === 'map' && held > 30) {
        BattleManager.setup(1, false, false);
        SceneManager.push(Scene_Battle);
        setPhase('battle');
      } else if (phase === 'battle' && held > 30) {
        setPhase('done');
      }
    } catch (e) {
      log('harness-error', { msg: String(e), phase: phase });
      setPhase('done');
    }
  }, 2000);
})();
