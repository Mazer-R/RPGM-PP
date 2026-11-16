// Run next to a game (mvplayer --game <dir> --run this file) to play one of
// its videos the way the engine's "play movie" event command does, and log
// what happens: whether the player has video at all, when the engine
// considers the video started and over, the state of the native video player
// once a second, and the loudest sound sent out in that second.
//
// VIDEO_FILE (default 'movies/intro.webm') names the video inside the game.
// Exits with 0 once the video is over, with 1 if it is not over after
// VIDEO_LIMIT_MS (default 90 seconds).
(function () {
  'use strict';
  var FILE = globalThis.VIDEO_FILE || 'movies/intro.webm';
  var LIMIT_MS = globalThis.VIDEO_LIMIT_MS || 90000;
  var STATES = ['nothing open', 'loading', 'ready', 'ended', 'failed'];
  var stage = 'boot', at = 0, lastReport = 0, frames = 0;

  function scene() { var s = globalThis.SceneManager && SceneManager._scene; return s ? s.constructor.name : ''; }
  function report(now) {
    var peak = player.audio ? player.audio.takePeak() : 0;
    console.log('video: ' + ((now - at) / 1000).toFixed(1) + ' s, engine says ' +
      (Graphics.isVideoPlaying() ? 'playing' : 'not playing') + ', native player ' +
      (player.video ? STATES[player.video.state()] : 'absent') + ', ' + frames + ' frames drawn, loudest sound ' + peak.toFixed(3));
    frames = 0;
  }

  function watch(now) {
    requestAnimationFrame(watch);
    frames++;
    if (stage === 'boot' && scene() === 'Scene_Title') {
      console.log('video: the player ' + (player.video ? 'has' : 'does not have') + ' video; playing ' + FILE);
      Graphics.playVideo(FILE);
      stage = 'playing'; at = lastReport = now;
    } else if (stage === 'playing') {
      if (now - lastReport >= 1000) { report(now); lastReport = now; }
      if (!Graphics.isVideoPlaying()) {
        console.log('video: over after ' + ((now - at) / 1000).toFixed(1) + ' s');
        player.exit(0);
      } else if (now - at > LIMIT_MS) {
        console.log('video: still playing after ' + (LIMIT_MS / 1000) + ' s; giving up');
        player.exit(1);
      }
    }
  }
  requestAnimationFrame(watch);
})();
