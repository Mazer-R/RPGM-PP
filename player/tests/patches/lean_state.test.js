// Tests for the "leanState" patch, run with Node:
//   node tests/patches/lean_state.test.js
//
// The patch is loaded against a small stand-in for the parts of the engine
// it touches, with the same behaviour as the engine's own code: every write
// to a switch, variable or self switch asks the map to refresh, and "is any
// event starting?" goes through every event of the map each time it is asked.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// `before` is code run after the engine stand-in is defined and before the
// patch is installed: what a plugin loaded by the game would have done.
function engine(before) {
  const sandbox = { player: { patches: {}, patchStats: {} }, refreshRequests: 0, listsBuilt: 0 };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const tools = path.join(__dirname, '..', '..', 'js', 'patch-select.js');
  vm.runInContext(fs.readFileSync(tools, 'utf8'), sandbox, { filename: tools });
  sandbox.player.patchTools = sandbox.__patchSelect;
  vm.runInContext(`
    var $dataSystem = { switches: new Array(20), variables: new Array(20) };
    var $gameMap;
    function Game_Switches() { this._data = []; }
    Game_Switches.prototype.value = function (id) { return !!this._data[id]; };
    Game_Switches.prototype.setValue = function (id, value) {
      if (id > 0 && id < $dataSystem.switches.length) { this._data[id] = value; this.onChange(); }
    };
    Game_Switches.prototype.onChange = function () { $gameMap.requestRefresh(); };
    function Game_Variables() { this._data = []; }
    Game_Variables.prototype.value = function (id) { return this._data[id] || 0; };
    Game_Variables.prototype.setValue = function (id, value) {
      if (id > 0 && id < $dataSystem.variables.length) {
        if (typeof value === 'number') value = Math.floor(value);
        this._data[id] = value; this.onChange();
      }
    };
    Game_Variables.prototype.onChange = function () { $gameMap.requestRefresh(); };
    function Game_SelfSwitches() { this._data = {}; }
    Game_SelfSwitches.prototype.value = function (key) { return !!this._data[key]; };
    Game_SelfSwitches.prototype.setValue = function (key, value) {
      if (value) this._data[key] = true; else delete this._data[key];
      this.onChange();
    };
    Game_SelfSwitches.prototype.onChange = function () { $gameMap.requestRefresh(); };
    function Game_Map() { this._events = []; }
    Game_Map.prototype.requestRefresh = function () { refreshRequests++; };
    Game_Map.prototype.events = function () {
      listsBuilt++;
      return this._events.filter(function (event) { return !!event; });
    };
    Game_Map.prototype.eventsXy = function (x, y) {
      return this.events().filter(function (event) { return event.pos(x, y); });
    };
    Game_Map.prototype.eventsXyNt = function (x, y) {
      return this.events().filter(function (event) { return event.posNt(x, y); });
    };
    Game_Map.prototype.isAnyEventStarting = function () {
      return this.events().some(function (event) { return event.isStarting(); });
    };
    Game_Map.prototype.setupEvents = function (events) { this._events = events; };
    function Game_Event(id, x, y, through) { this.id = id; this._x = x; this._y = y; this._through = !!through; this._starting = false; }
    Game_Event.prototype.pos = function (x, y) { return this._x === x && this._y === y; };
    Game_Event.prototype.isThrough = function () { return this._through; };
    Game_Event.prototype.posNt = function (x, y) { return this.pos(x, y) && !this.isThrough(); };
    Game_Event.prototype.isStarting = function () { startingAsked++; return this._starting; };
    Game_Event.prototype.start = function () { this._starting = true; };
    Game_Event.prototype.clearStartingFlag = function () { this._starting = false; };
    var startingAsked = 0;
    var SceneManager = { updateScene: function () {} };
    function ev(id, x, y, through) { return new Game_Event(id, x, y, through); }
    $gameMap = new Game_Map();
  `, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'lean-state.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  if (before) vm.runInContext(before, sandbox);
  sandbox.installResult = sandbox.player.patches.leanState({});
  return sandbox;
}
const run = (sandbox, code) => vm.runInContext(code, sandbox);
// The ids of the events a lookup returns, in order, as text.
const ids = (sandbox, lookup) => run(sandbox, lookup + '.map(function (x) { return x.id; }).join(",")');

const tests = {
  'a switch written with the value it already has asks for no refresh'() {
    const e = engine();
    run(e, 'var s = new Game_Switches(); s.setValue(3, true);');
    assert.strictEqual(e.refreshRequests, 1);
    run(e, 's.setValue(3, true); s.setValue(3, true);');
    assert.strictEqual(e.refreshRequests, 1);
    assert.strictEqual(run(e, 's.value(3)'), true);
  },
  'a switch that really changes still asks for a refresh'() {
    const e = engine();
    run(e, 'var s = new Game_Switches(); s.setValue(3, true); s.setValue(3, false);');
    assert.strictEqual(e.refreshRequests, 2);
    assert.strictEqual(run(e, 's.value(3)'), false);
  },
  'turning off a switch that was never set is not a change'() {
    const e = engine();
    run(e, 'var s = new Game_Switches(); s.setValue(4, false);');
    assert.strictEqual(e.refreshRequests, 0);
  },
  'a variable written with the same number asks for no refresh, fractions included'() {
    const e = engine();
    run(e, 'var v = new Game_Variables(); v.setValue(2, 7); v.setValue(2, 7); v.setValue(2, 7.9);');
    assert.strictEqual(e.refreshRequests, 1);
    run(e, 'v.setValue(2, 8);');
    assert.strictEqual(e.refreshRequests, 2);
    assert.strictEqual(run(e, 'v.value(2)'), 8);
  },
  'a variable holding an object is always treated as changed'() {
    const e = engine();
    run(e, 'var v = new Game_Variables(); var list = [1]; v.setValue(2, list); list.push(2); v.setValue(2, list);');
    assert.strictEqual(e.refreshRequests, 2);
  },
  'a self switch written with the value it already has asks for no refresh'() {
    const e = engine();
    run(e, 'var ss = new Game_SelfSwitches(); ss.setValue("1,2,A", true); ss.setValue("1,2,A", true); ss.setValue("1,2,B", false);');
    assert.strictEqual(e.refreshRequests, 1);
    run(e, 'ss.setValue("1,2,A", false);');
    assert.strictEqual(e.refreshRequests, 2);
    assert.strictEqual(run(e, 'ss.value("1,2,A")'), false);
  },
  'an out-of-range switch is still ignored'() {
    const e = engine();
    run(e, 'var s = new Game_Switches(); s.setValue(0, true); s.setValue(99, true);');
    assert.strictEqual(e.refreshRequests, 0);
    assert.strictEqual(run(e, 's.value(99)'), false);
  },
  'an event that is starting is noticed, and none starting is reported as none'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([null, ev(1, 0, 0), null, ev(3, 1, 1)]);');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), false);
    run(e, '$gameMap._events[3].start();');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), true);
  },
  'asked many times in one step, the events are gone through once'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([null, ev(1, 0, 0), ev(2, 1, 1), ev(3, 2, 2)]);');
    run(e, 'for (var i = 0; i < 50; i++) $gameMap.isAnyEventStarting();');
    assert.strictEqual(run(e, 'startingAsked'), 3);
  },
  'an event that starts, or stops starting, is noticed at once within the step'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([null, ev(1, 0, 0), ev(2, 1, 1)]);');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), false);
    run(e, '$gameMap._events[2].start();');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), true);
    run(e, '$gameMap._events[2].clearStartingFlag();');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), false);
  },
  'a change made behind the engine\'s back is seen from the next step on'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([null, ev(1, 0, 0)]); $gameMap.isAnyEventStarting();');
    run(e, '$gameMap._events[1]._starting = true; SceneManager.updateScene();');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), true);
  },
  'the answer is the new map\'s after a change of map, and another map object\'s after a load'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([null, ev(1, 0, 0)]); $gameMap._events[1].start(); $gameMap.isAnyEventStarting();');
    run(e, '$gameMap.setupEvents([null, ev(2, 0, 0)]);');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStarting()'), false);
    run(e, 'var loaded = new Game_Map(); loaded.setupEvents([null, ev(3, 0, 0)]); loaded._events[1]._starting = true;');
    assert.strictEqual(run(e, 'loaded.isAnyEventStarting()'), true);
  },
  'a plugin\'s own copy of the question, when it is the well-known one, shares the answer'() {
    const e = engine(`Game_Map.prototype.isAnyEventStartingQuick = function() {
    var max = this._events.length;
    for (var i = 0; i < max; ++i) {
      var ev = this._events[i];
      if (ev && ev.isStarting()) return true;
    }
    return false;
};`);
    run(e, '$gameMap.setupEvents([null, ev(1, 0, 0), ev(2, 1, 1)]);');
    run(e, 'for (var i = 0; i < 20; i++) { $gameMap.isAnyEventStartingQuick(); $gameMap.isAnyEventStarting(); }');
    assert.strictEqual(run(e, 'startingAsked'), 2);
    run(e, '$gameMap._events[1].start();');
    assert.strictEqual(run(e, '$gameMap.isAnyEventStartingQuick()'), true);
  },
  'the question, when a plugin already replaced it, is left as the plugin made it, and that is reported'() {
    const e = engine('Game_Map.prototype.isAnyEventStarting = function () { pluginAsked++; return false; }; var pluginAsked = 0;');
    run(e, '$gameMap.setupEvents([null, ev(1, 3, 4)]); $gameMap.isAnyEventStarting();');
    assert.strictEqual(run(e, 'pluginAsked'), 1);
    assert.ok(/isAnyEventStarting/.test(String(e.installResult)), 'reported: ' + e.installResult);
  },
  'with the engine as shipped, nothing is reported'() {
    const e = engine();
    assert.strictEqual(e.installResult, undefined);
  },
};

let failed = 0;
for (const name of Object.keys(tests)) {
  try { tests[name](); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n')[0]); }
}
console.log(failed ? failed + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(failed ? 1 : 0);
