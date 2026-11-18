// What a game's own scripts ask for that the player does not have, found
// before the game starts and written to the log in one go.
//
// One of the pieces a game's profile can switch on (engine-select.js). It
// knows nothing of the game's engine.
//
// The player stands in for a browser and for the desktop player, and has
// what the games tried so far needed. A game with other plugins may ask for
// something else, and without this the only way to learn what is one
// failure at a time: start, read the error, add the missing piece, start
// again. Here the game's plugins are read once, when the game's scripts
// have loaded, and everything they name of a browser, of the desktop player
// or of Node is checked against what is really there at that moment. What
// is missing is listed with the files that name it.
//
// The list is a warning, not a verdict. A name in a script may sit in a
// branch that never runs here, and a thing the player has by name may still
// be incomplete. Nothing is changed and nothing is stopped.
(function () {
  'use strict';

  // The ways a script names something: [how it is written, pattern].
  var GLOBALS = 'fetch|localStorage|sessionStorage|XMLHttpRequest|WebSocket|Worker|alert|confirm|prompt|structuredClone|' +
    'queueMicrotask|crypto|indexedDB|caches|speechSynthesis|Notification|getComputedStyle|matchMedia|requestIdleCallback|' +
    'createImageBitmap|OffscreenCanvas|ResizeObserver|MutationObserver|IntersectionObserver|TextDecoder|TextEncoder|' +
    'AudioContext|webkitAudioContext|FileReader|Blob|URL|FormData|Intl|atob|btoa';
  var ELEMENT = 'innerHTML|outerHTML|classList|setAttribute|getAttribute|insertBefore|querySelector|querySelectorAll|' +
    'getBoundingClientRect|requestFullscreen|requestPointerLock|toDataURL|toBlob|getImageData|putImageData|createPattern|' +
    'createLinearGradient|createRadialGradient|measureText|drawImage|captureStream|insertAdjacentHTML|scrollIntoView|' +
    'isPointInPath|setLineDash|ellipse|roundRect|createImageData|transferControlToOffscreen';
  var KINDS = [
    { pattern: /\bdocument\.([a-zA-Z_$][\w$]*)/g, name: function (m) { return 'document.' + m[1]; }, has: function (has, m) { return has.document(m[1]); } },
    { pattern: /\bwindow\.([a-zA-Z_$][\w$]*)/g, name: function (m) { return 'window.' + m[1]; }, has: function (has, m) { return has.global(m[1]); }, own: 1 },
    { pattern: /\bnavigator\.([a-zA-Z_$][\w$]*)/g, name: function (m) { return 'navigator.' + m[1]; }, has: function (has, m) { return has.navigator(m[1]); } },
    { pattern: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, name: function (m) { return "require('" + m[1] + "')"; }, has: function (has, m) { return has.module(m[1]); } },
    { pattern: /\bnew\s+([A-Z][\w$]*)\s*\(/g, name: function (m) { return 'new ' + m[1]; }, has: function (has, m) { return has.global(m[1]); }, own: 1 },
    // Not after `new`, which is counted above, nor as a part of something else.
    { pattern: new RegExp('(?<![.\\w$])(?<!\\bnew\\s{1,4})(' + GLOBALS + ')\\s*[(.]', 'g'), name: function (m) { return m[1]; }, has: function (has, m) { return has.global(m[1]); } },
    // Not what was already counted as the document's or the window's.
    { pattern: new RegExp('(?<!\\bdocument|\\bwindow|\\bnavigator)\\.(' + ELEMENT + ')\\b', 'g'), name: function (m) { return '.' + m[1]; }, has: function (has, m) { return has.element(m[1]); } },
  ];

  // scripts: [{ file, text }]. has: { global, document, navigator, module,
  // element }, each a function of a name saying whether the player has it.
  // Returns [{ what, files }], the most named first.
  function survey(scripts, has) {
    var all = scripts.map(function (script) { return script.text; }).join('\n');
    // What the game's scripts define themselves is theirs, not the browser's.
    function definedByTheGame(name) {
      var escaped = name.replace(/[$]/g, '\\$');
      return new RegExp('(?:function|class)\\s+' + escaped + '\\b|\\b' + escaped + '\\s*=[^=]|\\b' + escaped + '\\.prototype\\b').test(all);
    }
    var found = {}, order = [];
    scripts.forEach(function (script) {
      KINDS.forEach(function (kind) {
        kind.pattern.lastIndex = 0;
        var match;
        while ((match = kind.pattern.exec(script.text))) {
          var what = kind.name(match);
          if (found[what] === false) continue;
          if (!found[what]) {
            if (kind.has(has, match) || (kind.own && definedByTheGame(match[1]))) { found[what] = false; continue; }
            found[what] = [];
            order.push(what);
          }
          if (found[what].indexOf(script.file) < 0) found[what].push(script.file);
        }
      });
    });
    return order.map(function (what) { return { what: what, files: found[what] }; })
      .sort(function (a, b) { return b.files.length - a.files.length; });
  }

  globalThis.__compatReport = { survey: survey };

  // --- In the player: read the game's plugins and write the list ------------
  var browser = globalThis.__browser;
  if (!browser || typeof player === 'undefined') return;

  function pluginFiles() {
    var dir = player.gameDir + '/js/plugins';
    var listed = globalThis.$plugins;
    var names = Array.isArray(listed)
      ? listed.filter(function (plugin) { return plugin && plugin.status; }).map(function (plugin) { return plugin.name + '.js'; })
      : (player.listDir(dir) || []).filter(function (name) { return /\.js$/i.test(name); });
    return names.map(function (name) { return { file: name, path: dir + '/' + name }; });
  }

  function report() {
    var started = performance.now();
    var scripts = [];
    pluginFiles().forEach(function (plugin) {
      var text = player.readTextFile(plugin.path);
      if (text !== null) scripts.push({ file: plugin.file, text: text });
    });
    if (!scripts.length) return;
    var samples = [];
    try {
      var canvas = document.createElement('canvas');
      samples = [document.createElement('div'), canvas, canvas.getContext('2d'), document.createElement('video')];
    } catch (error) { samples = []; }
    var provided = browser.providedModules || [];
    var missing = survey(scripts, {
      global: function (name) { return name in globalThis; },
      document: function (name) { return name in document; },
      navigator: function (name) { return name in navigator; },
      module: function (name) { return provided.indexOf(name) >= 0; },
      element: function (name) { return samples.some(function (sample) { return sample && name in sample; }); },
    });
    var took = (performance.now() - started).toFixed(0);
    if (!missing.length) {
      console.info('compat: ' + scripts.length + ' plugins read in ' + took + ' ms; they name nothing the player lacks');
      return;
    }
    console.warn('compat: ' + scripts.length + ' plugins read in ' + took + ' ms; they name ' + missing.length +
      ' things the player does not have (the game may still run without them):');
    missing.forEach(function (item) {
      var files = item.files.slice(0, 4).join(', ') + (item.files.length > 4 ? ' and ' + (item.files.length - 4) + ' more' : '');
      console.warn('compat:   ' + item.what + '  (' + files + ')');
    });
  }

  browser.whenScriptsLoaded = browser.whenScriptsLoaded || [];
  browser.whenScriptsLoaded.push(report);
})();
