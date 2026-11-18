// Where RPG Maker MZ's frames, logic steps and drawing are, for the
// player's performance line (see boot.js).
//
// One of the pieces of MZ's profile (engine-select.js), about that engine
// only. MV runs a frame from SceneManager and draws through renderScene,
// which is what the common layers measure. In MZ a frame is one tick of
// PIXI's ticker (Graphics._onTick), which runs zero or more logic steps
// (SceneManager.updateScene) and then draws by calling the PIXI
// application's render.
//
// boot.js calls browser.hookPerformance, when a profile has set it, with
// its meter: frame(now, scene) at the start of each frame, and step and draw
// to run and time a logic step and a drawing.
(function () {
  'use strict';
  var browser = globalThis.__browser;
  browser.hookPerformance = function (meter) {
    if (!globalThis.Graphics || !Graphics._onTick || !globalThis.SceneManager || !SceneManager.updateScene) return false;
    var updateScene = SceneManager.updateScene, onTick = Graphics._onTick;
    var measured = null;  // the application whose render is already measured
    SceneManager.updateScene = function () { return meter.step(updateScene, this, arguments); };
    Graphics._onTick = function () {
      var scene = SceneManager._scene ? SceneManager._scene.constructor.name : 'none';
      meter.frame(performance.now(), scene);
      // The application is made after the scripts have loaded, and a game
      // may make another: its render is wrapped when first seen.
      var app = this._app;
      if (app && app !== measured) {
        var render = app.render;
        app.render = function () { return meter.draw(render, this, arguments); };
        measured = app;
      }
      return onTick.apply(this, arguments);
    };
    return true;
  };
})();
