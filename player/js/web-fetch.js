// The browser's fetch, for the game's own files.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// The engines read their files through XMLHttpRequest, which the common
// layers provide. Plugins written more recently use fetch instead, for a
// table of texts or a list of settings kept beside the game's data. Here
// fetch reads a file of the game, and only that: there is no network, so an
// address on another machine fails as it would with no connection, and a
// file that is not there fails as it does for a page opened from disk.
//
// A response gives its text, its data as JSON, or its bytes; what is read is
// read when asked for. The body as a stream is not provided.
(function () {
  'use strict';
  if (typeof globalThis.fetch === 'function') return;
  var browser = globalThis.__browser;

  var TYPES = { json: 'application/json', txt: 'text/plain', csv: 'text/csv', js: 'text/javascript', html: 'text/html',
    xml: 'application/xml', png: 'image/png', jpg: 'image/jpeg', ogg: 'audio/ogg', wasm: 'application/wasm' };
  function typeOf(file) {
    var dot = file.lastIndexOf('.');
    return (dot >= 0 && TYPES[file.slice(dot + 1).toLowerCase()]) || null;
  }
  function failed() { return new TypeError('Failed to fetch'); }

  function Response(url, file) {
    this.url = url;
    this.ok = true;
    this.status = 200;
    this.statusText = 'OK';
    this.redirected = false;
    this.type = 'basic';
    this.bodyUsed = false;
    this.body = null;
    this._file = file;
    var type = typeOf(file);
    this.headers = {
      get: function (name) { return String(name).toLowerCase() === 'content-type' ? type : null; },
      has: function (name) { return String(name).toLowerCase() === 'content-type' && type !== null; },
    };
  }
  Response.prototype.text = function () {
    var text = player.readTextFile(this._file);
    return text === null ? Promise.reject(failed()) : Promise.resolve(text);
  };
  Response.prototype.json = function () {
    return this.text().then(function (text) { return JSON.parse(text); });
  };
  Response.prototype.arrayBuffer = function () {
    var bytes = player.readFileBytes(this._file);
    return bytes ? Promise.resolve(bytes) : Promise.reject(failed());
  };
  Response.prototype.blob = function () {
    var type = typeOf(this._file) || '';
    return this.arrayBuffer().then(function (bytes) {
      return typeof Blob === 'function' ? new Blob([bytes], { type: type }) : bytes;
    });
  };
  Response.prototype.clone = function () { return new Response(this.url, this._file); };

  globalThis.fetch = function (input) {
    var url = String(input && typeof input === 'object' && 'url' in input ? input.url : input);
    // Another machine: http:, https:, or an address starting with "//".
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^file:\/\//i.test(url) || /^\/\//.test(url)) return Promise.reject(failed());
    var file = browser.gamePath(url.replace(/^file:\/\//i, ''));
    if (!player.fileExists(file)) return Promise.reject(failed());
    return Promise.resolve(new Response(url, file));
  };
  if (typeof globalThis.Response !== 'function') globalThis.Response = Response;
})();
