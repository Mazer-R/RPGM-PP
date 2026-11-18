// Running the work V8 queues for the main thread.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// V8 finishes some things through tasks it queues for the main thread, and
// they only run when the player runs them. Compiling WebAssembly is one:
// MZ's animation library (Effekseer) waits on WebAssembly.instantiate(),
// whose promise is settled by such a task, and the game does not start
// until it is. They are run once a frame. MV games never needed this and
// are not given it.
(function () {
  'use strict';
  if (typeof player === 'undefined' || typeof player.runEngineTasks !== 'function') return;
  if (typeof requestAnimationFrame !== 'function') return;
  function everyFrame() {
    player.runEngineTasks();
    requestAnimationFrame(everyFrame);
  }
  requestAnimationFrame(everyFrame);
})();
