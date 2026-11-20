// A finger or the mouse reaching the game's engine, MV or MZ:
//   potato-player --game <game> --run tests/device/pointer_check.js
//
// At the title it presses, moves and lifts at places in the game's picture,
// the way the native player reports a finger or the mouse, and checks each
// frame what the engine's own TouchInput then says. It also logs every press
// the engine sees from then on ("pointer-check: engine saw a press at x,y"),
// so that a real click or touch on the screen can be followed in the log.
// The lines it logs start with "pointer-check:"; the checks end with
// "pointer-check: passed" or "pointer-check: FAILED".
(function () {
  'use strict';
  var failures = 0, step = -1, wait = 0;

  function say(text) { console.log('pointer-check: ' + text); }
  function expect(what, ok) {
    say((ok ? 'ok   ' : 'FAIL ') + what);
    if (!ok) failures++;
  }
  function at() { return TouchInput.x + ',' + TouchInput.y; }

  // Each step acts, and the next one looks a frame later, after the engine
  // has updated its input.
  var steps = [
    function () { player.onPointer(0, 200, 150); },
    function () {
      expect('a press is seen as a press, at its place (' + at() + ')', TouchInput.isPressed() && at() === '200,150');
      player.onPointer(1, 230, 170);
    },
    function () {
      expect('a move while pressed is followed (' + at() + ')', TouchInput.isPressed() && at() === '230,170');
      player.onPointer(2, 230, 170);
    },
    function () {
      expect('a lift ends the press', !TouchInput.isPressed());
      player.onPointer(0, -40, 150);
    },
    function () {
      expect('a press outside the picture is not a press', !TouchInput.isPressed());
      player.onPointer(2, -40, 150);
      say(failures ? 'FAILED' : 'passed');
      if (!globalThis.__pointerCheckStay) player.exit(failures ? 1 : 0);
    },
  ];

  function tick() {
    requestAnimationFrame(tick);
    var scene = globalThis.SceneManager && SceneManager._scene;
    if (!scene || !globalThis.TouchInput) return;
    if (step < 0) {
      if (scene.constructor.name !== 'Scene_Title' || ++wait < 90) return;
      say('engine ' + (globalThis.Utils && Utils.RPGMAKER_NAME) + ', picture ' + Graphics.width + 'x' + Graphics.height);
      step = 0;
    }
    if (step < steps.length) { steps[step++](); return; }
    if (TouchInput.isTriggered()) say('engine saw a press at ' + at());
    if (TouchInput.isCancelled()) say('engine saw a cancel');
  }
  requestAnimationFrame(tick);
})();
