// Decides which patches a game gets, and gives patches a way to check the
// engine code they replace. No engine, no files: plain functions, so they
// can be tested on their own.
//
// A patch changes how a game runs without touching its files. What a patch
// depends on differs: most depend only on the engine, some on a plugin the
// game uses, a few on one particular game. Each line of the list
// (patches/index.json) says so itself:
//
//   { "patch": "<name>", "file": "<file in patches/>", "options": { ... },
//     "when": { "engine": "MV",              the game's engine
//               "plugin": "Name" | [..],     plugins the game has switched on (all of them)
//               "title":  "Name" | [..] } }  the game's title (any of them)
//
// A line with no "when" applies to every game. All the conditions a line
// gives must hold. A condition this code does not know keeps the patch out,
// so a list written for a newer player does no harm in an older one.
(function () {
  'use strict';

  function asList(value) { return Array.isArray(value) ? value : [value]; }

  var CONDITIONS = {
    engine: function (wanted, game) { return game.engine === wanted; },
    plugin: function (wanted, game) {
      return asList(wanted).every(function (name) { return game.plugins.indexOf(name) >= 0; });
    },
    title: function (wanted, game) { return asList(wanted).indexOf(game.title) >= 0; },
  };

  // rules: the list from index.json.
  // game:  { title, engine, plugins: [names of the plugins switched on] }.
  // off:   names of patches this game has switched off.
  // Returns { selected: [rules to install, in the list's order],
  //           notes: [text worth logging] }.
  function select(rules, game, off) {
    var selected = [], notes = [];
    var known = {};
    off = off || [];
    (Array.isArray(rules) ? rules : []).forEach(function (rule) {
      if (!rule || typeof rule !== 'object' || !rule.patch || !rule.file) return;
      known[rule.patch] = true;
      var when = rule.when || {};
      var unknown = Object.keys(when).filter(function (key) { return !CONDITIONS[key]; });
      if (unknown.length) {
        notes.push(rule.patch + ' not applied: unknown condition "' + unknown.join('", "') + '"');
        return;
      }
      var applies = Object.keys(when).every(function (key) { return CONDITIONS[key](when[key], game); });
      if (!applies) return;
      if (off.indexOf(rule.patch) >= 0) {
        notes.push(rule.patch + ' switched off for this game');
        return;
      }
      selected.push(rule);
    });
    off.forEach(function (name) {
      if (!known[name]) notes.push('no patch is called "' + name + '" (named in the game\'s switched-off list)');
    });
    return { selected: selected, notes: notes };
  }

  // True when `fn` is a function whose code is `expected`, spacing and line
  // breaks aside. A patch that replaces an engine function outright uses it
  // to make sure the function is still the engine's own: if a plugin has
  // already replaced it, the plugin's version must stay.
  function sameCode(fn, expected) {
    if (typeof fn !== 'function') return false;
    var squeeze = function (text) { return String(text).replace(/\s+/g, ''); };
    return squeeze(Function.prototype.toString.call(fn)) === squeeze(expected);
  }

  globalThis.__patchSelect = { select: select, sameCode: sameCode };
})();
