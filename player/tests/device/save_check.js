// Saves and loads through the game's own engine, MV or MZ:
//   mvplayer --game <game> --run tests/device/save_check.js
//
// Starts a new game without the title menu, saves to slot 1, changes a
// variable and saves to the same slot again, changes it once more, loads the
// slot and checks that the variable is the one of the second save. It then
// looks at what is left in the save folder. The lines it logs start with
// "save-check:"; the last one is "save-check: passed" or "save-check: FAILED".
// The slot it writes is the game's real slot 1: run it on a copy of the game
// or on one with no saves worth keeping.
(function () {
  'use strict';
  var FIRST = 111, SECOND = 222, AFTER = 333, VARIABLE = 1;
  var started = false, failures = 0;

  function say(text) { console.log('save-check: ' + text); }
  function expect(what, ok) {
    say((ok ? 'ok   ' : 'FAIL ') + what);
    if (!ok) failures++;
  }
  // MV answers with true or false at once; MZ with a promise.
  function later(result) {
    return Promise.resolve(result).then(function (value) {
      if (value === false) throw new Error('the engine answered false');
    });
  }
  function save() {
    $gameSystem.onBeforeSave();
    return later(DataManager.saveGame(1));
  }
  function exists(name) { return player.fileExists(player.gameDir + '/save/' + name); }

  function run() {
    var mz = !!globalThis.Utils && Utils.RPGMAKER_NAME === 'MZ';
    var slot = mz ? 'file1.rmmzsave' : 'file1.rpgsave';
    var global = mz ? 'global.rmmzsave' : 'global.rpgsave';
    say('engine ' + (mz ? 'MZ' : 'MV') + ', saves in files: ' + StorageManager.isLocalMode());
    DataManager.setupNewGame();
    $gameVariables.setValue(VARIABLE, FIRST);
    save().then(function () {
      expect('a first save writes the slot', exists(slot));
      $gameVariables.setValue(VARIABLE, SECOND);
      return save();
    }).then(function () {
      expect('a second save to the same slot is accepted', true);
      $gameVariables.setValue(VARIABLE, AFTER);
      return later(DataManager.loadGame(1));
    }).then(function () {
      expect('loading gives the second save back (variable ' + $gameVariables.value(VARIABLE) + ')',
        $gameVariables.value(VARIABLE) === SECOND);
      expect('the list of saves is written', exists(global));
      expect('the engine finds the slot', mz ? DataManager.savefileExists(1) : StorageManager.exists(1));
      expect('no backup of the slot is left behind', !exists(slot + '_'));
      expect('no half-written file is left behind', !exists(slot + '.tmp'));
    }).catch(function (error) {
      expect('saving and loading: ' + (error && error.message), false);
    }).then(function () {
      say(failures ? 'FAILED' : 'passed');
      player.exit(failures ? 1 : 0);
    });
  }

  function tick() {
    if (started) return;
    requestAnimationFrame(tick);
    var scene = globalThis.SceneManager && SceneManager._scene;
    if (scene && scene.constructor.name === 'Scene_Title' && globalThis.$dataSystem) {
      started = true;
      run();
    }
  }
  requestAnimationFrame(tick);
})();
