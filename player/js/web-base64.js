// The browser's atob and btoa: base64 text to and from a string that holds
// one byte in each character.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// RPG Maker MZ's sound decoder (js/libs/vorbisdecoder.js) carries its
// WebAssembly code as base64 text and calls atob while it loads.
(function () {
  'use strict';
  var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var VALUES = {};
  for (var i = 0; i < CHARS.length; i++) VALUES[CHARS[i]] = i;

  function atob(text) {
    var input = String(text).replace(/[\t\n\f\r ]+/g, '');
    if (input.length % 4 === 0) input = input.replace(/==?$/, '');
    if (input.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(input)) {
      throw new Error('atob: the string to be decoded is not correctly encoded');
    }
    var out = [], bits = 0, held = 0;
    for (var at = 0; at < input.length; at++) {
      held = (held << 6) | VALUES[input[at]];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push(String.fromCharCode((held >> bits) & 255));
      }
      // Long texts are joined in pieces: one string of megabytes of single
      // characters is slow to build.
      if (out.length >= 8192) out = [out.join('')];
    }
    return out.join('');
  }

  function btoa(text) {
    var input = String(text), out = [];
    for (var at = 0; at < input.length; at += 3) {
      var a = input.charCodeAt(at), b = input.charCodeAt(at + 1), c = input.charCodeAt(at + 2);
      if (a > 255 || b > 255 || c > 255) {
        throw new Error('btoa: the string contains characters outside of the Latin1 range');
      }
      var left = input.length - at;
      out.push(CHARS[a >> 2], CHARS[((a & 3) << 4) | (b >> 4)],
        left > 1 ? CHARS[((b & 15) << 2) | (c >> 6)] : '=', left > 2 ? CHARS[c & 63] : '=');
    }
    return out.join('');
  }

  if (typeof globalThis.atob !== 'function') globalThis.atob = atob;
  if (typeof globalThis.btoa !== 'function') globalThis.btoa = btoa;
})();
