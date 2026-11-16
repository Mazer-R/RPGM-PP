// Patch "framePacing": limit how many logic steps the engine runs in one
// frame.
//
// The engine advances the game in fixed steps of 1/60 s and, when a frame
// took longer than that, runs several steps in the next frame to catch up
// (up to fifteen). On a machine where one step already takes most of a
// frame's time this feeds on itself: more steps make the frame longer, which
// asks for more steps, and the picture drops to a few frames per second.
//
// With this patch at most `maxStepsPerFrame` steps run per frame; the time
// the engine wanted to make up beyond that is dropped. In heavy moments the
// game then runs somewhat slower than real time instead of in bursts.
//
// Options: { maxStepsPerFrame: N } (default 2).
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters
// are in player.patchStats.framePacing.
player.patches.framePacing = function (options) {
  var limit = Math.max(1, Number(options && options.maxStepsPerFrame) || 2);
  var stats = { maxStepsPerFrame: limit, frames: 0, stepsRun: 0, stepsDropped: 0 };
  player.patchStats.framePacing = stats;
  if (!globalThis.SceneManager || !SceneManager.updateMain || !SceneManager.updateScene) return;
  var stepsThisFrame = 0;
  var updateMain = SceneManager.updateMain, updateScene = SceneManager.updateScene;
  SceneManager.updateMain = function () {
    stepsThisFrame = 0;
    stats.frames++;
    return updateMain.apply(this, arguments);
  };
  // The engine's catch-up loop still counts down the time it owes; only the
  // work of the extra steps is skipped.
  SceneManager.updateScene = function () {
    if (stepsThisFrame >= limit) { stats.stepsDropped++; return; }
    stepsThisFrame++;
    stats.stepsRun++;
    return updateScene.apply(this, arguments);
  };
};
