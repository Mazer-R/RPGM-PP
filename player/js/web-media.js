// A video element's play() as a promise.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// In a browser, play() on a video element gives a promise. MZ relies on
// that: on every key press, click and touch it calls play() on its video
// element and adds .catch() to the result, so without a promise each key
// press ends in an error and never reaches the game. The player's own
// play() gives nothing back; here it is wrapped to give a promise.
(function () {
  'use strict';
  var browser = globalThis.__browser;
  var makeVideo = browser.makeVideo;
  if (typeof makeVideo !== 'function') return;
  browser.makeVideo = function () {
    var video = makeVideo.apply(this, arguments);
    var play = video.play;
    video.play = function () {
      try { return Promise.resolve(play.apply(this, arguments)); }
      catch (error) { return Promise.reject(error); }
    };
    return video;
  };
})();
