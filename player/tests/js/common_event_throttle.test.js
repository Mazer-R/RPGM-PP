// Tests for patches/common-event-throttle.js, run with Node:
//   node tests/js/common_event_throttle.test.js
//
// The patch runs some of a game's parallel common events once every few
// logic steps instead of on every one. Which ones: those the patch is told
// by name, and, by itself, those that are pure checks (nothing in them but
// conditions and fixed assignments) and cost more than a set time per step.
// The tests stand in for the engine with common events whose command lists
// and cost per run the test decides, and count how often each one runs.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Command lists, by the engine's command codes.
const IF_SWITCH = { code: 111, parameters: [0, 5, 0] };
const IF_BUTTON = { code: 111, parameters: [11, 'ok'] };
const IF_SCRIPT = { code: 111, parameters: [12, 'x()'] };
const IF_TIMER = { code: 111, parameters: [3, 10, 0] };
const SET_SWITCH = { code: 121, parameters: [7, 7, 0] };
const SET_VARIABLE = { code: 122, parameters: [3, 3, 0, 0, 5] };
const ADD_TO_VARIABLE = { code: 122, parameters: [3, 3, 1, 0, 1] };
const RANDOM_VARIABLE = { code: 122, parameters: [3, 3, 0, 2, 1, 6] };
const LEARN_SKILL = { code: 318, parameters: [0, 1, 0, 9] };
const WAIT = { code: 230, parameters: [5] };
const SHOW_PICTURE = { code: 231, parameters: [] };
const SCRIPT = { code: 355, parameters: ['x()'] };
const call = (id) => ({ code: 117, parameters: [id] });
const END = [{ code: 412, parameters: [] }, { code: 0, parameters: [] }];
const check = (...commands) => [IF_SWITCH, ...commands, ...END];

function setup(events, options, title) {
  let clock = 0;
  const runs = {};
  const sandbox = {
    player: { patches: {}, patchStats: {} },
    performance: { now: () => clock },
    document: { title: title || 'Some Game' },
    // The game's common events by id, as the engine keeps them.
    $dataCommonEvents: events,
  };
  sandbox.globalThis = sandbox;
  function Game_CommonEvent(id) { this._commonEventId = id; }
  Game_CommonEvent.prototype.event = function () { return events[this._commonEventId]; };
  // One run of the event: takes the time the test gave it.
  Game_CommonEvent.prototype.update = function () {
    runs[this._commonEventId] = (runs[this._commonEventId] || 0) + 1;
    clock += events[this._commonEventId].ms || 0;
  };
  sandbox.Game_CommonEvent = Game_CommonEvent;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'common-event-throttle.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  sandbox.player.patches.commonEventThrottle(options);
  const live = Object.keys(events).map((id) => new Game_CommonEvent(Number(id)));
  // `count` logic steps: every event is offered once per step.
  const steps = (count) => { for (let i = 0; i < count; i++) { live.forEach((e) => e.update()); clock += 1; } };
  return { runs, steps, stats: sandbox.player.patchStats.commonEventThrottle };
}

const AUTO = { every: 6, minMs: 0.05 };

const tests = {
  'a costly pure check is slowed down once it has been seen to be costly'() {
    const t = setup({ 1: { name: 'SkillAvailable', list: check(SET_SWITCH, LEARN_SKILL, SET_VARIABLE), ms: 1 } }, AUTO);
    t.steps(120);
    assert.strictEqual(t.runs[1], 120, 'it runs on every step while it is being timed');
    t.steps(600);
    assert.strictEqual(t.runs[1], 220, 'then on one step in six');
    assert.strictEqual(t.stats.slowedByCost, 1);
  },

  'a cheap pure check is left alone'() {
    const t = setup({ 1: { name: 'Cheap', list: check(SET_SWITCH), ms: 0.01 } }, AUTO);
    t.steps(720);
    assert.strictEqual(t.runs[1], 720);
    assert.strictEqual(t.stats.slowedByCost, 0);
  },

  'a check that becomes costly later is slowed down then'() {
    const events = { 1: { name: 'Sometimes', list: check(SET_SWITCH), ms: 0.01 } };
    const t = setup(events, AUTO);
    t.steps(240);
    events[1].ms = 1;
    t.steps(120);
    const before = t.runs[1];
    t.steps(600);
    assert.strictEqual(t.runs[1] - before, 100);
  },

  'events that do more than check are never slowed down by themselves'() {
    const lists = {
      waits: check(WAIT), counts: check(ADD_TO_VARIABLE), random: check(RANDOM_VARIABLE), shows: check(SHOW_PICTURE),
      script: check(SCRIPT), button: [IF_BUTTON, SET_SWITCH, ...END],
      scriptCondition: [IF_SCRIPT, SET_SWITCH, ...END], timer: [IF_TIMER, SET_SWITCH, ...END],
    };
    const events = {};
    Object.keys(lists).forEach((name, index) => { events[index + 1] = { name, list: lists[name], ms: 1 }; });
    const t = setup(events, AUTO);
    t.steps(720);
    Object.keys(events).forEach((id) => assert.strictEqual(t.runs[id], 720, events[id].name));
    assert.strictEqual(t.stats.pure, 0);
  },

  'calling another event keeps a check pure only if that one is pure too'() {
    const events = {
      1: { name: 'CallsPure', list: check(call(5)), ms: 1 },
      2: { name: 'CallsOneThatWaits', list: check(call(6)), ms: 1 },
      3: { name: 'CallsThroughAnother', list: check(call(7)), ms: 1 },
      4: { name: 'CallsItself', list: check(call(4)), ms: 1 },
      5: { name: 'Pure', list: check(SET_SWITCH) },
      6: { name: 'Waits', list: check(WAIT) },
      7: { name: 'CallsOneThatWaits', list: check(call(6)) },
      8: { name: 'CallsNothingThere', list: check(call(99)), ms: 1 },
    };
    const t = setup(events, AUTO);
    t.steps(720);
    assert.strictEqual(t.runs[1], 220);
    [2, 3, 4, 8].forEach((id) => assert.strictEqual(t.runs[id], 720, events[id].name));
  },

  'counting afresh on every run is still a check: a variable set first and then added to'() {
    const reset = { code: 122, indent: 0, parameters: [3, 3, 0, 0, 0] };
    const add = { code: 122, indent: 1, parameters: [3, 3, 1, 0, 1] };
    const resetInBranch = { code: 122, indent: 1, parameters: [3, 3, 0, 0, 0] };
    const resetOfAnother = { code: 122, indent: 0, parameters: [4, 4, 0, 0, 0] };
    const jump = { code: 119, indent: 0, parameters: ['again'] };
    const events = {
      1: { name: 'PartyCount', list: [reset, IF_SWITCH, add, ...END], ms: 1 },
      2: { name: 'ResetOnlySometimes', list: [IF_SWITCH, resetInBranch, add, ...END], ms: 1 },
      3: { name: 'ResetsAnother', list: [resetOfAnother, IF_SWITCH, add, ...END], ms: 1 },
      4: { name: 'AddsBeforeReset', list: [IF_SWITCH, add, ...END, reset], ms: 1 },
      5: { name: 'Jumps', list: [reset, IF_SWITCH, add, ...END, jump], ms: 1 },
    };
    const t = setup(events, AUTO);
    t.steps(720);
    assert.strictEqual(t.runs[1], 220);
    [2, 3, 4, 5].forEach((id) => assert.strictEqual(t.runs[id], 720, events[id].name));
  },

  'slowed events take different steps'() {
    const events = {};
    for (let id = 1; id <= 6; id++) events[id] = { name: 'Check' + id, list: check(SET_SWITCH), ms: 1 };
    const t = setup(events, AUTO);
    t.steps(120);
    const before = Object.assign({}, t.runs);
    t.steps(1);
    const ran = Object.keys(events).filter((id) => t.runs[id] > before[id]);
    assert.strictEqual(ran.length, 1, 'one of the six on any one step');
    t.steps(5);
    Object.keys(events).forEach((id) => assert.strictEqual(t.runs[id] - before[id], 1));
  },

  'events named for the game are slowed from the start, whatever is in them'() {
    const events = { 1: { name: '////Girl_Outfit change', list: check(SHOW_PICTURE), ms: 0.01 }, 2: { name: 'Other', list: check(SHOW_PICTURE), ms: 0.01 } };
    const t = setup(events, { every: 6, minMs: 0.05, names: { 'Fear & Hunger': ['Outfit change'] } }, 'Fear & Hunger');
    t.steps(600);
    assert.strictEqual(t.runs[1], 100);
    assert.strictEqual(t.runs[2], 600);
    assert.strictEqual(t.stats.named, 1);
  },

  'names given for another game do not count'() {
    const events = { 1: { name: 'Outfit change', list: check(SHOW_PICTURE), ms: 0.01 } };
    const t = setup(events, { every: 6, minMs: 0.05, names: { 'Fear & Hunger': ['Outfit change'] } }, 'Fear & Hunger 2: TERMINA');
    t.steps(600);
    assert.strictEqual(t.runs[1], 600);
  },

  'a plain list of names counts for any game, and no time limit means names only'() {
    const events = { 1: { name: 'Outfit change', list: check(SHOW_PICTURE), ms: 0.01 }, 2: { name: 'Costly', list: check(SET_SWITCH), ms: 1 } };
    const t = setup(events, { every: 6, names: ['Outfit change'] });
    t.steps(600);
    assert.strictEqual(t.runs[1], 100);
    assert.strictEqual(t.runs[2], 600);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
