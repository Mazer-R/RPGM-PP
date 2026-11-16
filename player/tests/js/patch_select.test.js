// Tests for js/patch-select.js, which decides the patches a game gets, run
// with Node:
//   node tests/js/patch_select.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const file = path.join(__dirname, '..', '..', 'js', 'patch-select.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
// Results cross from the sandbox; compare them as plain data.
const select = (rules, game, off) => JSON.parse(JSON.stringify(sandbox.__patchSelect.select(rules, game, off)));
const names = (result) => result.selected.map((rule) => rule.patch);

const RULES = [
  { patch: 'gpuLights', file: 'gpu-lights.js', when: { engine: 'MV', plugin: 'TerraxLighting' } },
  { patch: 'eventCulling', file: 'event-culling.js', when: { engine: 'MV' }, options: { margin: 4 } },
  { patch: 'framePacing', file: 'frame-pacing.js', when: { engine: 'MV' } },
  { patch: 'outfits', file: 'common-event-throttle.js', when: { title: 'Fear & Hunger' }, options: { every: 6 } },
  { patch: 'either', file: 'x.js', when: { title: ['Game A', 'Game B'] } },
  { patch: 'both', file: 'y.js', when: { plugin: ['One', 'Two'] } },
];
const game = (over) => Object.assign({ title: 'Some Game', engine: 'MV', plugins: [] }, over);

const tests = {
  'a game on the engine gets the engine-wide patches and no others'() {
    assert.deepStrictEqual(names(select(RULES, game())), ['eventCulling', 'framePacing']);
  },
  'a patch for a plugin is added when the game has that plugin switched on'() {
    assert.deepStrictEqual(names(select(RULES, game({ plugins: ['TerraxLighting'] }))),
      ['gpuLights', 'eventCulling', 'framePacing']);
  },
  'a patch for one game is added by its exact title only'() {
    assert.ok(names(select(RULES, game({ title: 'Fear & Hunger' }))).includes('outfits'));
    assert.ok(!names(select(RULES, game({ title: 'Fear & Hunger 2: TERMINA' }))).includes('outfits'));
  },
  'a list of titles matches any of them; a list of plugins needs all of them'() {
    assert.ok(names(select(RULES, game({ title: 'Game B' }))).includes('either'));
    assert.ok(!names(select(RULES, game({ plugins: ['One'] }))).includes('both'));
    assert.ok(names(select(RULES, game({ plugins: ['Two', 'One'] }))).includes('both'));
  },
  'a game on another engine gets nothing meant for this one'() {
    assert.deepStrictEqual(names(select(RULES, game({ engine: 'MZ', plugins: ['TerraxLighting'] }))), []);
  },
  'patches keep the order of the list'() {
    const shuffled = [RULES[2], RULES[1]];
    assert.deepStrictEqual(names(select(shuffled, game())), ['framePacing', 'eventCulling']);
  },
  'a patch keeps its options'() {
    const result = select(RULES, game());
    assert.deepStrictEqual(result.selected[0].options, { margin: 4 });
  },
  'a patch the game switched off is left out, and that is said'() {
    const result = select(RULES, game(), ['framePacing']);
    assert.deepStrictEqual(names(result), ['eventCulling']);
    assert.ok(result.notes.some((note) => /framePacing/.test(note) && /off/.test(note)), result.notes.join(' | '));
  },
  'switching off a patch that does not exist is reported, not ignored'() {
    const result = select(RULES, game(), ['noSuchPatch']);
    assert.deepStrictEqual(names(result), ['eventCulling', 'framePacing']);
    assert.ok(result.notes.some((note) => /noSuchPatch/.test(note)), result.notes.join(' | '));
  },
  'a rule with no condition applies to every game'() {
    assert.deepStrictEqual(names(select([{ patch: 'always', file: 'a.js' }], game({ engine: 'other' }))), ['always']);
  },
  'a rule with a condition it does not know is not applied'() {
    const result = select([{ patch: 'odd', file: 'o.js', when: { engine: 'MV', moon: 'full' } }], game());
    assert.deepStrictEqual(names(result), []);
    assert.ok(result.notes.some((note) => /odd/.test(note) && /moon/.test(note)), result.notes.join(' | '));
  },
  'code is the same when only its spacing and line breaks differ'() {
    const sameCode = sandbox.__patchSelect.sameCode;
    const original = function (x, y) {
      return this.events().filter(function (event) { return event.pos(x, y); });
    };
    assert.strictEqual(sameCode(original, 'function(x,y){return this.events().filter(function(event){return event.pos(x,y);});}'), true);
    assert.strictEqual(sameCode(original, 'function (x, y) {\n  return this.events().filter(function (event) {\n    return event.pos(x, y);\n  });\n}'), true);
  },
  'code that does something else is not the same, and neither is a missing function'() {
    const sameCode = sandbox.__patchSelect.sameCode;
    const replaced = function (x, y) { return this.fastLookup(x, y); };
    assert.strictEqual(sameCode(replaced, 'function(x,y){return this.events().filter(function(event){return event.pos(x,y);});}'), false);
    assert.strictEqual(sameCode(undefined, 'function(){}'), false);
  },
  'a broken list gives no patches instead of failing'() {
    assert.deepStrictEqual(names(select(null, game())), []);
    assert.deepStrictEqual(names(select([null, 3, { file: 'nameless.js' }], game())), []);
  },
};

let failed = 0;
for (const name of Object.keys(tests)) {
  try { tests[name](); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n')[0]); }
}
console.log(failed ? failed + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(failed ? 1 : 0);
