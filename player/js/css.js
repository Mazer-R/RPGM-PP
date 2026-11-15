// Parsing of the two CSS value kinds the game hands to a canvas: colours and
// font descriptions. The native canvas takes numbers, so this is where text
// such as "rgba(0, 0, 0, 0.5)" or "28px GameFont" is turned into them.
(function () {
  'use strict';
  var NAMED = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
    yellow: '#ffff00', gray: '#808080', grey: '#808080', silver: '#c0c0c0', orange: '#ffa500',
    purple: '#800080', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff',
    magenta: '#ff00ff', maroon: '#800000', navy: '#000080', olive: '#808000', teal: '#008080',
    pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
    lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkred: '#8b0000', crimson: '#dc143c',
  };
  var colours = new Map();
  var unknown = {};

  function channel(text) {
    var value = parseFloat(text);
    if (String(text).indexOf('%') >= 0) value = value * 255 / 100;
    return Math.min(255, Math.max(0, value)) / 255;
  }

  function hueToChannel(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function parse(text) {
    var s = String(text).trim().toLowerCase();
    if (s === 'transparent') return [0, 0, 0, 0];
    if (NAMED[s]) s = NAMED[s];
    var m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
      var hex = m[1];
      if (hex.length === 3 || hex.length === 4) hex = hex.replace(/./g, '$&$&');
      if (hex.length === 6 || hex.length === 8) {
        return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255,
          parseInt(hex.slice(4, 6), 16) / 255, hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1];
      }
    }
    if ((m = /^rgba?\(([^)]*)\)$/.exec(s))) {
      var parts = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length >= 3) {
        var alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
        if (parts.length > 3 && parts[3].indexOf('%') >= 0) alpha /= 100;
        if (isNaN(alpha)) alpha = 1;
        return [channel(parts[0]), channel(parts[1]), channel(parts[2]), Math.min(1, Math.max(0, alpha))];
      }
    }
    if ((m = /^hsla?\(([^)]*)\)$/.exec(s))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length >= 3) {
        var h = ((parseFloat(p[0]) % 360) + 360) % 360 / 360;
        var sat = Math.min(1, Math.max(0, parseFloat(p[1]) / 100));
        var light = Math.min(1, Math.max(0, parseFloat(p[2]) / 100));
        var q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
        var pp = 2 * light - q;
        return [hueToChannel(pp, q, h + 1 / 3), hueToChannel(pp, q, h), hueToChannel(pp, q, h - 1 / 3),
          p.length > 3 ? Math.min(1, Math.max(0, parseFloat(p[3]))) : 1];
      }
    }
    return null;
  }

  // Returns [r, g, b, a] with each part from 0 to 1, or null when the text
  // is not a colour (a canvas then keeps its previous colour, as browsers do).
  function parseColour(text) {
    var cached = colours.get(text);
    if (cached !== undefined) return cached;
    var result = parse(text);
    if (result === null && !unknown[text]) {
      unknown[text] = true;
      console.warn('css: colour not understood: ' + text);
    }
    if (colours.size < 4096) colours.set(text, result);
    return result;
  }

  var fonts = new Map();
  // Returns { size, families } from text such as 'italic 28px "GameFont", serif',
  // or null. Weight and slant are not applied: the game ships one face per font.
  function parseFont(text) {
    var cached = fonts.get(text);
    if (cached !== undefined) return cached;
    var m = /(\d+(?:\.\d+)?)px(?:\/\S+)?\s+(.+)$/.exec(String(text));
    var result = null;
    if (m) {
      result = {
        size: parseFloat(m[1]),
        families: m[2].split(',').map(function (name) { return name.trim().replace(/^["']|["']$/g, ''); }),
      };
    }
    if (fonts.size < 1024) fonts.set(text, result);
    return result;
  }

  globalThis.__css = { parseColour: parseColour, parseFont: parseFont };
})();
