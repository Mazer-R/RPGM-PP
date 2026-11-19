// Patch "textureBudget": keep the memory the textures take under a budget.
//
// A picture that has been drawn stays in the graphics memory as a texture.
// The engine's renderer (PIXI) drops a texture only after it has not been
// drawn for about a minute, and a game may keep every picture it has asked
// for (reserved) so that the engine's own image cache never lets go of
// them. A scene that shows a few hundred different pictures in less than
// that minute then needs all of them in memory at once: at 2 MB a picture,
// more than a handheld with 1 GB has, where the graphics memory is the same
// memory as everything else's. The whole device stops answering.
//
// With this patch, when the textures take more than the budget, the
// renderer's own collector is run at once with less patience: first for the
// textures not drawn for thirty seconds, then ten, then two, then half a
// second, stopping as soon as there is room. A texture dropped this way is
// loaded again by the renderer the next time it is drawn, as after its own
// collection; that costs a pause then, not a wrong picture. What is on the
// screen now is never dropped, so a single scene that needs more than the
// budget at the same instant still takes it.
//
// The budget is a share of the device's memory (options `share`, between
// `least` and `most` megabytes), or `megabytes` if given.
//
// It never edits game files. To turn it off for one game, name it
// under "off" in that game's save/mvplayer-patches.json; for every game,
// remove its line from patches/index.json or start the player with
// --no-patches. Its counters are in player.patchStats.textureBudget.
player.patches.textureBudget = function (options) {
  var MB = 1024 * 1024;
  // Frames a texture may have gone undrawn, from the most patient try to the least.
  var PATIENCE = [1800, 600, 120, 30];

  function deviceMegabytes() {
    var found = null;
    try { found = /MemTotal:\s+(\d+)\s*kB/.exec(player.readTextFile('/proc/meminfo') || ''); } catch (error) { found = null; }
    return found ? Number(found[1]) / 1024 : 0;
  }
  function budgetMegabytes() {
    if (options.megabytes) return options.megabytes;
    var device = deviceMegabytes();
    var least = options.least || 96, most = options.most || 512;
    if (!device) return Math.min(most, Math.max(least, 256));
    return Math.round(Math.min(most, Math.max(least, device * (options.share || 0.25))));
  }

  var stats = { megabytes: budgetMegabytes(), checks: 0, collections: 0, droppedMegabytes: 0, stillOver: 0 };
  player.patchStats.textureBudget = stats;
  if (!globalThis.SceneManager || typeof SceneManager.updateMain !== 'function') return;
  var budget = stats.megabytes * MB, every = options.every || 30, frame = 0, told = false;

  // MV keeps the renderer in Graphics._renderer; MZ in its PIXI application.
  function renderer() {
    var g = globalThis.Graphics;
    return g && (g._renderer || (g._app && g._app.renderer) || (g.app && g.app.renderer));
  }

  function makeRoom() {
    var r = renderer(), gl = r && r.gl, gc = r && r.textureGC;
    if (!gl || typeof gl.textureBytes !== 'function' || !gc || typeof gc.run !== 'function') return;
    var before = gl.textureBytes();
    if (before <= budget) return;
    var own = gc.maxIdle;
    try {
      for (var i = 0; i < PATIENCE.length && gl.textureBytes() > budget; i++) {
        gc.maxIdle = PATIENCE[i];
        gc.run();
      }
    } finally {
      gc.maxIdle = own;
    }
    var after = gl.textureBytes();
    stats.collections++;
    stats.droppedMegabytes += Math.round((before - after) / MB);
    if (after > budget) {
      stats.stillOver++;
      if (!told) {
        told = true;
        console.log('patches: textureBudget: the textures on the screen take ' + Math.round(after / MB) + ' MB, over the budget of ' + stats.megabytes + ' MB');
      }
    }
  }

  var updateMain = SceneManager.updateMain;
  SceneManager.updateMain = function () {
    var result = updateMain.apply(this, arguments);
    if (++frame % every === 0) { stats.checks++; makeRoom(); }
    return result;
  };
};
