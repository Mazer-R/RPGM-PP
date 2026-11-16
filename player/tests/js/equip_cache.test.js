// Tests for patches/equip-cache.js, run with Node:
//   node tests/js/equip_cache.test.js
//
// The patch makes an actor's list of equipment be worked out once and then
// remembered until some piece of equipment changes. The tests use the
// engine's own few lines for an item slot and an actor's equipment, count
// how often the list is really worked out, and check that what the game
// sees is what it would see without the patch.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const sandbox = { player: { patches: {}, patchStats: {} }, built: { count: 0 } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // As in the engine (rpg_objects.js), cut down to weapons and armours.
  vm.runInContext(`
    var $dataWeapons = [null, { id: 1, name: 'sword' }, { id: 2, name: 'axe' }];
    var $dataArmors = [null, { id: 1, name: 'shield' }, { id: 2, name: 'helmet' }];
    function Game_Item() { this.initialize.apply(this, arguments); }
    Game_Item.prototype.initialize = function (item) { this._dataClass = ''; this._itemId = 0; if (item) this.setObject(item); };
    Game_Item.prototype.object = function () {
      return this._dataClass === 'weapon' ? $dataWeapons[this._itemId] : this._dataClass === 'armor' ? $dataArmors[this._itemId] : null;
    };
    Game_Item.prototype.setObject = function (item) {
      this._dataClass = $dataWeapons.indexOf(item) > 0 ? 'weapon' : $dataArmors.indexOf(item) > 0 ? 'armor' : '';
      this._itemId = item ? item.id : 0;
    };
    Game_Item.prototype.setEquip = function (isWeapon, itemId) { this._dataClass = isWeapon ? 'weapon' : 'armor'; this._itemId = itemId; };
    function Game_Actor() { this.initEquips([1, 1]); }
    Game_Actor.prototype.initEquips = function (ids) {
      this._equips = [];
      for (var i = 0; i < ids.length; i++) { this._equips[i] = new Game_Item(); this._equips[i].setEquip(i === 0, ids[i]); }
    };
    Game_Actor.prototype.equips = function () { built.count++; return this._equips.map(function (item) { return item.object(); }); };
    Game_Actor.prototype.hasArmor = function (armor) { return this.equips().indexOf(armor) >= 0; };
  `, sandbox);
  const file = path.join(__dirname, '..', '..', 'patches', 'equip-cache.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  sandbox.player.patches.equipCache({});
  const run = (code) => vm.runInContext(code, sandbox);
  run('var actor = new Game_Actor(), other = new Game_Actor();');
  const names = (who) => run('(' + who + ').equips().map(function (item) { return item ? item.name : "-"; }).join(" ")');
  return { run, names, built: sandbox.built, stats: sandbox.player.patchStats.equipCache };
}

const tests = {
  'the list is worked out once while nothing changes'() {
    const t = setup();
    assert.strictEqual(t.names('actor'), 'sword shield');
    const before = t.built.count;
    assert.strictEqual(t.names('actor'), 'sword shield');
    assert.strictEqual(t.run('actor.hasArmor($dataArmors[1])'), true);
    assert.strictEqual(t.built.count, before);
    assert.ok(t.stats.remembered >= 2);
  },

  'each actor has its own list'() {
    const t = setup();
    t.run('other._equips[0].setEquip(true, 2)');
    assert.strictEqual(t.names('actor'), 'sword shield');
    assert.strictEqual(t.names('other'), 'axe shield');
  },

  'a changed slot shows at once, however it was changed'() {
    const t = setup();
    t.names('actor');
    t.run('actor._equips[1].setObject($dataArmors[2])');
    assert.strictEqual(t.names('actor'), 'sword helmet');
    t.run('actor._equips[0].setEquip(true, 2)');
    assert.strictEqual(t.names('actor'), 'axe helmet');
    t.run('actor._equips[0].setObject(null)');
    assert.strictEqual(t.names('actor'), '- helmet');
    t.run('actor._equips[0] = new Game_Item($dataWeapons[1])');
    assert.strictEqual(t.names('actor'), 'sword helmet');
    t.run('actor.initEquips([2, 2])');
    assert.strictEqual(t.names('actor'), 'axe helmet');
  },

  'slots added or taken away show at once'() {
    const t = setup();
    t.names('actor');
    t.run('actor._equips.push(new Game_Item($dataArmors[2]))');
    assert.strictEqual(t.names('actor'), 'sword shield helmet');
    t.run('actor._equips = actor._equips.slice(0, 1)');
    assert.strictEqual(t.names('actor'), 'sword');
  },

  'what a caller does to the list it was given changes nobody else\'s'() {
    const t = setup();
    t.run('actor.equips().push("mine")');
    assert.strictEqual(t.names('actor'), 'sword shield');
  },

  'an actor read back from a save file starts afresh'() {
    const t = setup();
    t.names('actor');
    t.run('var loaded = Object.create(Game_Actor.prototype); loaded._equips = [Object.assign(Object.create(Game_Item.prototype), { _dataClass: "weapon", _itemId: 2 })];');
    assert.strictEqual(t.names('loaded'), 'axe');
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
