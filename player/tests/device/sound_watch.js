// Run next to a game (mvplayer --game <dir> --run this file) to check that
// sound is produced. Once a second it logs the scene, the loudest sample the
// mixer sent out in that second (0 = silence, 1 = full scale) and the music
// the engine believes it is playing. Nobody can listen for it, so the peak
// is the evidence. Exits with 0 after RUN_MS if any sound was produced, 5 if
// the whole run was silent, 6 if the player has no sound output.
(function () {
  'use strict';
  var RUN_MS = 25000;
  var started = performance.now(), lastReport = 0, loudest = 0;
  if (!player.audio) {
    console.error('sound: the player has no sound output');
    return player.exit(6);
  }
  function watch(now) {
    requestAnimationFrame(watch);
    if (now - lastReport >= 1000) {
      lastReport = now;
      var peak = player.audio.takePeak();
      loudest = Math.max(loudest, peak);
      var scene = globalThis.SceneManager && SceneManager._scene ? SceneManager._scene.constructor.name : 'none';
      var bgm = globalThis.AudioManager && AudioManager._currentBgm ? AudioManager._currentBgm.name : '-';
      var bgs = globalThis.AudioManager && AudioManager._currentBgs ? AudioManager._currentBgs.name : '-';
      console.log('sound: ' + ((now - started) / 1000).toFixed(0) + ' s, ' + scene + ', peak ' + peak.toFixed(3) + ', music ' + bgm + ', ambience ' + bgs);
    }
    if (now - started >= RUN_MS) {
      console.log('sound: loudest sample of the run ' + loudest.toFixed(3));
      player.exit(loudest > 0.01 ? 0 : 5);
    }
  }
  requestAnimationFrame(watch);
})();
