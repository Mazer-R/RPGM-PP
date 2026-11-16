// Tests for the "eventLookup" patch, run with Node:
//   node tests/patches/event_lookup.test.js
//
// The patch is loaded against a small stand-in for the parts of the engine
// it touches, with the engine's own behaviour: events are found at a
// position by listing every event of the map and asking each one, and a
// character's position changes only through the engine's own functions.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// `before` is code run after the stand-in is defined and before the patch
// is installed: what a plugin loaded by the game would have done.
function engine(before) {
  const sandbox = { player: { patches: {}, patchStats: {} }, listsBuilt: 0, positionsAsked: 0 };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const tools = path.join(__dirname, '..', '..', 'js', 'patch-select.js');
  vm.runInContext(fs.readFileSync(tools, 'utf8'), sandbox, { filename: tools });
  sandbox.player.patchTools = sandbox.__patchSelect;
  vm.runInContext(`
    var $gameMap;
    var SceneManager = { updateScene: function () {} };
    function Game_CharacterBase() { this._x = 0; this._y = 0; this._through = false; this._jumpCount = 0; }
    Game_CharacterBase.prototype.pos = function(x, y) {
        return this._x === x && this._y === y;
    };
    Game_CharacterBase.prototype.posNt = function(x, y) {
        // No through
        return this.pos(x, y) && !this.isThrough();
    };
    Game_CharacterBase.prototype.isThrough = function () { return this._through; };
    Game_CharacterBase.prototype.setPosition = function (x, y) { this._x = Math.round(x); this._y = Math.round(y); };
    Game_CharacterBase.prototype.copyPosition = function (other) { this._x = other._x; this._y = other._y; };
    Game_CharacterBase.prototype.locate = function (x, y) { this.setPosition(x, y); };
    Game_CharacterBase.prototype.moveStraight = function (d) {
      if (d === 6) this._x++; else if (d === 4) this._x--; else if (d === 2) this._y++; else this._y--;
    };
    Game_CharacterBase.prototype.moveDiagonally = function (horz, vert) {
      this._x += horz === 6 ? 1 : -1; this._y += vert === 2 ? 1 : -1;
    };
    Game_CharacterBase.prototype.jump = function (xPlus, yPlus) { this._x += xPlus; this._y += yPlus; this._jumpCount = 1; };
    Game_CharacterBase.prototype.updateJump = function () {
      this._jumpCount--;
      if (this._jumpCount === 0) { this._x = this._x % 100; this._y = this._y % 100; }   // wraps on a looping map
    };
    function Game_Event(id, x, y, through) {
      Game_CharacterBase.call(this);
      this._eventId = id; this._x = x; this._y = y; this._through = !!through;
    }
    Game_Event.prototype = Object.create(Game_CharacterBase.prototype);
    Game_Event.prototype.constructor = Game_Event;
    function Game_Player() { Game_CharacterBase.call(this); }
    Game_Player.prototype = Object.create(Game_CharacterBase.prototype);
    function Game_Map() { this._events = []; }
    Game_Map.prototype.events = function () {
      listsBuilt++;
      return this._events.filter(function (event) { return !!event; });
    };
    Game_Map.prototype.eventsXy = function(x, y) {
        return this.events().filter(function(event) {
            return event.pos(x, y);
        });
    };
    Game_Map.prototype.eventsXyNt = function(x, y) {
        return this.events().filter(function(event) {
            return event.posNt(x, y);
        });
    };
    // Events are stored at the index that is their id, as in the engine.
    Game_Map.prototype.setupEvents = function (list) {
      this._events = [];
      for (var i = 0; i < list.length; i++) this._events[list[i]._eventId] = list[i];
    };
    // Every read of an event's x position is counted, whoever does it, so a
    // test can tell how many events a lookup had to look at.
    function ev(id, x, y, through) {
      var event = new Game_Event(id, x, y, through);
      var held = event._x;
      Object.defineProperty(event, '_x', {
        get: function () { positionsAsked++; return held; },
        set: function (value) { held = value; },
      });
      return event;
    }
    $gameMap = new Game_Map();
  `, sandbox);
  if (before) vm.runInContext(before, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'event-lookup.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  sandbox.installResult = sandbox.player.patches.eventLookup({});
  return sandbox;
}
const run = (sandbox, code) => vm.runInContext(code, sandbox);
// The ids of the events a lookup returns, in order, as text.
const ids = (sandbox, lookup) => run(sandbox, lookup + '.map(function (x) { return x._eventId; }).join(",")');
const step = (sandbox) => run(sandbox, 'SceneManager.updateScene();');

const tests = {
  'events at a position are found in map order, skipping empty slots'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(4, 3, 4), ev(1, 3, 4), ev(3, 9, 9)]);');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '1,4');
    assert.strictEqual(run(e, '$gameMap.eventsXy(0, 0).length'), 0);
    assert.strictEqual(run(e, 'Array.isArray($gameMap.eventsXy(3, 4))'), true);
  },
  'events that can be walked through are left out of the blocking lookup only'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4, true), ev(2, 3, 4)]);');
    assert.strictEqual(ids(e, '$gameMap.eventsXyNt(3, 4)'), '2');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '1,2');
  },
  'an event that becomes walk-through is left out from that moment'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4)]); $gameMap.eventsXyNt(3, 4); $gameMap._events[1]._through = true;');
    assert.strictEqual(ids(e, '$gameMap.eventsXyNt(3, 4)'), '');
  },
  'on a large map, asking about one square asks only the events standing there'() {
    const e = engine();
    run(e, 'var many = []; for (var i = 1; i <= 300; i++) many.push(ev(i, i % 20, Math.floor(i / 20))); $gameMap.setupEvents(many);');
    run(e, '$gameMap.eventsXyNt(5, 5);');
    run(e, 'positionsAsked = 0; for (var n = 0; n < 100; n++) { $gameMap.eventsXyNt(5, 5); $gameMap.eventsXy(6, 6); }');
    // The engine's own way reads all 300 positions for each of the 200 lookups.
    assert.ok(run(e, 'positionsAsked') <= 400, 'positions read: ' + run(e, 'positionsAsked'));
    assert.strictEqual(ids(e, '$gameMap.eventsXyNt(5, 5)'), '105');
  },
  'an event that moves is found at its new square and not at the old one, at once'() {
    const moves = {
      'moveStraight(6)': [4, 4], 'moveDiagonally(4, 2)': [2, 5], 'setPosition(7, 8)': [7, 8],
      'locate(1, 2)': [1, 2], 'jump(2, -1)': [5, 3],
    };
    for (const move of Object.keys(moves)) {
      const e = engine();
      run(e, '$gameMap.setupEvents([ev(1, 3, 4), ev(2, 9, 9)]); $gameMap.eventsXy(3, 4);');
      run(e, '$gameMap._events[1].' + move + ';');
      const [x, y] = moves[move];
      assert.strictEqual(ids(e, `$gameMap.eventsXyNt(${x}, ${y})`), '1', move + ' new square');
      assert.strictEqual(ids(e, '$gameMap.eventsXyNt(3, 4)'), '', move + ' old square');
    }
  },
  'an event that takes another character\'s position is found there'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4), ev(2, 9, 9)]); $gameMap.eventsXy(3, 4);');
    run(e, '$gameMap._events[1].copyPosition($gameMap._events[2]);');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(9, 9)'), '1,2');
  },
  'the end of a jump that wraps round the map moves the event to where it lands'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 99, 4)]); $gameMap.eventsXy(99, 4);');
    run(e, '$gameMap._events[1].jump(3, 0);');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(102, 4)'), '1');
    run(e, '$gameMap._events[1].updateJump();');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(2, 4)'), '1');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(102, 4)'), '');
  },
  'a position changed behind the engine\'s back is right from the next step on'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4)]); $gameMap.eventsXy(3, 4); $gameMap._events[1]._x = 6;');
    step(e);
    assert.strictEqual(ids(e, '$gameMap.eventsXy(6, 4)'), '1');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '');
  },
  'a character that is not an event of the map can move without being listed'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4)]); $gameMap.eventsXy(3, 4);');
    run(e, 'var hero = new Game_Player(); hero.setPosition(3, 4); hero.moveStraight(6); var stray = ev(9, 3, 4); stray.moveStraight(2);');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '1');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 5)'), '');
  },
  'the lookups follow a new map, an added event and a removed event'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4)]); $gameMap.eventsXy(3, 4);');
    run(e, '$gameMap.setupEvents([ev(1, 8, 8), ev(2, 3, 4)]);');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '2');
    run(e, '$gameMap._events.push(ev(3, 3, 4));');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '2,3');
    run(e, '$gameMap._events[2] = null;');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '3');
  },
  'another map object, as after loading a save, gets its own answers'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4)]); $gameMap.eventsXy(3, 4);');
    run(e, 'var loaded = new Game_Map(); loaded.setupEvents([ev(1, 5, 5)]);');
    assert.strictEqual(ids(e, 'loaded.eventsXy(5, 5)'), '1');
    assert.strictEqual(ids(e, 'loaded.eventsXy(3, 4)'), '');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(3, 4)'), '1');
  },
  'an event with its own idea of position is still asked, as the engine would'() {
    const e = engine();
    run(e, 'var wide = ev(1, 3, 4); wide.pos = function (x, y) { return y === 4 && (x === 3 || x === 4); };' +
           '$gameMap.setupEvents([wide, ev(2, 4, 4)]);');
    assert.strictEqual(ids(e, '$gameMap.eventsXy(4, 4)'), '1,2');
    assert.strictEqual(ids(e, '$gameMap.eventsXyNt(4, 4)'), '1,2');
  },
  'the lookups build no list of all the events'() {
    const e = engine();
    run(e, '$gameMap.setupEvents([ev(1, 3, 4), ev(2, 5, 5)]);');
    run(e, '$gameMap.eventsXy(3, 4); $gameMap.eventsXyNt(3, 4);');
    assert.strictEqual(e.listsBuilt, 0);
  },
  'a lookup that a plugin already replaced is left as the plugin made it, and that is reported'() {
    const e = engine('Game_Map.prototype.eventsXy = function (x, y) { pluginLookups++; return []; }; var pluginLookups = 0;');
    run(e, '$gameMap.setupEvents([ev(1, 3, 4)]); $gameMap.eventsXy(3, 4);');
    assert.strictEqual(run(e, 'pluginLookups'), 1);
    assert.ok(/eventsXy/.test(String(e.installResult)), 'reported: ' + e.installResult);
    assert.strictEqual(ids(e, '$gameMap.eventsXyNt(3, 4)'), '1');
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
