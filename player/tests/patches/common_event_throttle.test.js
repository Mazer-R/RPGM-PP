// Tests for patches/common-event-throttle.js, run with Node:
//   node tests/patches/common_event_throttle.test.js
//
// A stand-in engine runs its common events once per logic step. The tests
// check what a player would notice: listed events run once every N steps,
// every one of them gets its turn, and the rest run every step, also when
// another patch drops some of the steps the engine asks for.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// `dropEvery`: of the steps the engine asks for, every dropEvery-th is not
// run (as the frame-pacing patch does when the game cannot keep up).
function setup({ events, dropEvery = 0, options }) {
  const runs = {};
  const sandbox = { player: { patches: {}, patchStats: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`
    function Game_CommonEvent(id) { this._commonEventId = id; }
    Game_CommonEvent.prototype.event = function () { return DATA[this._commonEventId]; };
    Game_CommonEvent.prototype.update = function () { RUNS[this._commonEventId] = (RUNS[this._commonEventId] || 0) + 1; };
    var asked = 0;
    var SceneManager = { updateScene: function () {
      asked++;
      if (DROP && asked % DROP === 0) return;
      for (var i = 0; i < EVENTS.length; i++) EVENTS[i].update();
    } };
  `, Object.assign(sandbox, { DATA: events, RUNS: runs, DROP: dropEvery, EVENTS: [] }));
  sandbox.EVENTS = vm.runInContext('EVENTS', sandbox);
  for (const id of Object.keys(events)) vm.runInContext(`EVENTS.push(new Game_CommonEvent(${id}))`, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'common-event-throttle.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  sandbox.player.patches.commonEventThrottle(options);
  const ask = (steps) => { for (let i = 0; i < steps; i++) vm.runInContext('SceneManager.updateScene()', sandbox); };
  return { runs, ask };
}

const outfits = { 1: { name: 'Outfit change A' }, 2: { name: 'Outfit change B' }, 3: { name: 'Outfit change C' }, 4: { name: 'Weather' } };

const tests = {
  'a listed event runs once every N steps and an unlisted one every step'() {
    const t = setup({ events: outfits, options: { names: ['Outfit change'], every: 6 } });
    t.ask(60);
    assert.deepStrictEqual(t.runs, { 1: 10, 2: 10, 3: 10, 4: 60 });
  },
  'listed events take turns instead of all running on the same step'() {
    const t = setup({ events: outfits, options: { names: ['Outfit change'], every: 6 } });
    t.ask(1);
    const first = [1, 2, 3].filter((id) => t.runs[id]).length;
    assert.strictEqual(first, 1);
  },
  'every listed event keeps its turn when a third of the steps asked for are dropped'() {
    const t = setup({ events: outfits, dropEvery: 3, options: { names: ['Outfit change'], every: 6 } });
    t.ask(180); // 120 steps really run
    assert.deepStrictEqual(t.runs, { 1: 20, 2: 20, 3: 20, 4: 120 });
  },
  'with no names listed nothing is throttled'() {
    const t = setup({ events: outfits, options: { names: [], every: 6 } });
    t.ask(12);
    assert.deepStrictEqual(t.runs, { 1: 12, 2: 12, 3: 12, 4: 12 });
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message.split('\n').slice(0, 6).join(' ')); }
}
console.log(failed ? failed + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(failed ? 1 : 0);
