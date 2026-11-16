// Tests for the "eventCulling" patch, run with Node:
//   node tests/patches/event_culling.test.js
//
// The patch stops visiting map events that are far from the screen. The
// tests load it against a small stand-in for the engine's map and events,
// with the engine's own rules: an event's update starts it when its page is
// an autorun one, an event moves by itself only while it is within one
// screen's width of the middle of the screen (half a screen beyond its
// edges), and an event is saved with everything it holds.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The screen shows 17 x 13 tiles, from tile 0,0.
function engine(options) {
  const sandbox = { player: { patches: {}, patchStats: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const tools = path.join(__dirname, '..', '..', 'js', 'patch-select.js');
  vm.runInContext(fs.readFileSync(tools, 'utf8'), sandbox, { filename: tools });
  sandbox.player.patchTools = sandbox.__patchSelect;
  vm.runInContext(`
    var Graphics = { width: 816, height: 624 };
    var SceneManager = { _scene: null };
    var $gameMap;
    function Game_Event(x, y, pages) {
      this._realX = x; this._realY = y; this._pages = pages || [{ trigger: 0 }];
      this._trigger = this._pages[0].trigger; this._moveType = 0;
      this._starting = false; this._locked = false; this._updates = 0; this._refreshes = 0; this._moves = 0; this.page = 0;
    }
    Game_Event.prototype.event = function () { return { pages: this._pages }; };
    Game_Event.prototype.isMoveRouteForcing = function () { return false; };
    Game_Event.prototype.scrolledX = function () { return $gameMap.adjustX(this._realX); };
    Game_Event.prototype.scrolledY = function () { return $gameMap.adjustY(this._realY); };
    // As the engine's Game_CharacterBase.isNearTheScreen.
    Game_Event.prototype.isNearTheScreen = function () {
      var gw = Graphics.width, gh = Graphics.height, tw = $gameMap.tileWidth(), th = $gameMap.tileHeight();
      var px = this.scrolledX() * tw + tw / 2 - gw / 2, py = this.scrolledY() * th + th / 2 - gh / 2;
      return px >= -gw && px <= gw && py >= -gh && py <= gh;
    };
    Game_Event.prototype.start = function () { this._starting = true; };
    // As the engine: self movement only near the screen, then autorun.
    Game_Event.prototype.update = function () {
      this._updates++;
      if (this._moveType !== 0 && this.isNearTheScreen()) this._moves++;
      if (this._trigger === 3) this.start();
    };
    // The page in force: here, the last one named in \`page\`.
    Game_Event.prototype.refresh = function () { this._refreshes++; this._trigger = this._pages[this.page].trigger; };
    function Game_Map() { this._events = []; this._commonEvents = []; }
    Game_Map.prototype.mapId = function () { return 1; };
    Game_Map.prototype.tileWidth = function () { return 48; };
    Game_Map.prototype.tileHeight = function () { return 48; };
    Game_Map.prototype.adjustX = function (x) { return x; };
    Game_Map.prototype.adjustY = function (y) { return y; };
    Game_Map.prototype.events = function () { return this._events; };
    Game_Map.prototype.updateEvents = function() {
    this.events().forEach(function(event) {
        event.update();
    });
    this._commonEvents.forEach(function(event) {
        event.update();
    });
};
    $gameMap = new Game_Map();
  `, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'event-culling.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const said = sandbox.player.patches.eventCulling(options || { margin: 4, lazyRefresh: true });
  assert.strictEqual(said, undefined, 'the patch installs on the engine\'s own code');
  const run = (code) => vm.runInContext(code, sandbox);
  const add = (name, x, y, pages) => run(`var ${name} = new Game_Event(${x}, ${y}, ${JSON.stringify(pages || [{ trigger: 0 }])}); $gameMap._events.push(${name}); ${name}`);
  const steps = (count) => { for (let i = 0; i < count; i++) run('$gameMap.updateEvents()'); };
  return { run, add, steps };
}

const tests = {
  'an event far from the screen is left alone; one on it is visited every step'() {
    const t = engine();
    const near = t.add('near', 5, 5), far = t.add('far', 80, 5);
    t.steps(20);
    assert.strictEqual(near._updates, 20);
    assert.strictEqual(far._updates, 0);
  },

  'an autorun event starts wherever it is on the map'() {
    const t = engine();
    const far = t.add('cutscene', 80, 80, [{ trigger: 3 }]);
    t.steps(1);
    assert.strictEqual(far._starting, true, 'a scene set to run by itself on entering the map must run');
  },

  'an event whose page turns into an autorun one while far away starts too'() {
    const t = engine();
    const far = t.add('later', 80, 80, [{ trigger: 0 }, { trigger: 3 }]);
    t.steps(3);
    assert.strictEqual(far._starting, false);
    t.run('later.page = 1; later.refresh()');
    assert.strictEqual(far._trigger, 3, 'an event with such a page is re-evaluated at once, not when it comes near');
    t.steps(10);
    assert.strictEqual(far._starting, true);
  },

  'an event that moves by itself keeps moving as far away as the engine lets it'() {
    const t = engine();
    // The screen is 17 tiles wide: the engine moves events up to 8 tiles beyond either edge,
    // twice as far as the 4 tiles this patch looks at.
    const chaser = t.add('chaser', 17 + 7, 5), tooFar = t.add('tooFar', 17 + 25, 5);
    t.run('chaser._moveType = 2; tooFar._moveType = 2;');
    t.steps(10);
    assert.strictEqual(chaser._moves, 10, 'an enemy coming from off the screen must not stand still until it is close');
    assert.strictEqual(tooFar._moves, 0);
  },

  'an event that stands still that far away is not visited'() {
    const t = engine();
    const statue = t.add('statue', 17 + 7, 5);
    t.steps(10);
    assert.strictEqual(statue._updates, 0);
  },

  'a far event catches up on a page change when it comes near'() {
    const t = engine();
    const far = t.add('door', 80, 5, [{ trigger: 0 }, { trigger: 1 }]);
    t.steps(1);
    t.run('door.page = 1; door.refresh()');
    assert.strictEqual(far._refreshes, 0, 'put off while it is far away');
    t.run('door._realX = 5');
    t.steps(11);
    assert.strictEqual(far._refreshes, 1);
    assert.strictEqual(far._trigger, 1);
  },

  'nothing is added to an event, so a save file is what the game alone would write'() {
    const t = engine();
    t.add('near', 5, 5); t.add('far', 80, 5, [{ trigger: 0 }, { trigger: 1 }]); t.add('auto', 80, 80, [{ trigger: 3 }]);
    const before = t.run('JSON.stringify($gameMap._events.map(function (e) { return Object.keys(e).sort(); }))');
    t.steps(3);
    t.run('far.page = 1; far.refresh()');
    t.steps(12);
    const after = t.run('JSON.stringify($gameMap._events.map(function (e) { return Object.keys(e).sort(); }))');
    assert.strictEqual(after, before);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
