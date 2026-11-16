// The page's <video> element, over the player's own video output
// (player.video).
//
// The engine plays a video by giving one element an address and three
// handlers, calling load(), and then waiting: it starts the video when the
// element says its data has loaded, shows the element by making it opaque,
// and considers the video over when the element says it has ended. Until
// then the game's events wait. An element that never answers would therefore
// stop the game for good.
//
// Here the element opens the file in the native video player, which shows
// the picture over the game and sends the sound to the mixer, and reports
// what that player says. When there is no native player, or it cannot play
// the file, the video is over at once: the game goes on without it. The
// engine's error handler is never called, because it stops the game with a
// retry screen.
(function () {
  'use strict';
  var browser = globalThis.__browser = globalThis.__browser || {};
  var native = player.video || null;
  // States of the native player.
  var READY = 2, ENDED = 3, FAILED = 4;

  // The element whose video is loading, playing or still shown; one at a time.
  var current = null;
  var shown = null;

  function emit(video, type) {
    var event = { type: type, target: video };
    if (typeof video.dispatchEvent === 'function') video.dispatchEvent(event);
    else if (typeof video['on' + type] === 'function') video['on' + type](event);
  }
  function loaded(video) {
    video.__phase = 'loaded';
    video.readyState = 4;
    emit(video, 'loadeddata');
  }
  function over(video) {
    video.ended = true;
    video.paused = true;
    emit(video, 'ended');
  }
  function letGo() {
    if (current && !current.__instant) native.close();
    current = null;
  }

  browser.makeVideo = function (video) {
    var volume = 1;
    video.src = '';
    video.paused = true;
    video.ended = false;
    video.readyState = 0;
    video.currentTime = 0;
    video.__phase = 'idle';
    video.__instant = false;
    Object.defineProperty(video, 'volume', {
      get: function () { return volume; },
      set: function (value) {
        volume = Math.max(0, Math.min(1, Number(value) || 0));
        if (native) native.setVolume(volume);
      },
    });
    video.canPlayType = function (type) { return native && /^video\//.test(String(type)) ? 'probably' : ''; };
    video.load = function () {
      letGo();
      var file = browser.gamePath(video.src);
      var opened = !!native && native.open(file, video.width || 0, video.height || 0);
      if (native && !opened) console.warn('video: cannot open ' + file + '; the game goes on without it');
      if (opened) native.setVolume(volume);
      video.__instant = !opened;
      video.__phase = 'loading';
      video.paused = true;
      video.ended = false;
      video.readyState = 0;
      current = video;
      shown = null;
    };
    video.play = function () {
      if (current !== video || video.__phase !== 'loaded' || video.ended) return;
      video.paused = false;
      if (!video.__instant) return native.play();
      browser.later(function () {
        if (current !== video) return;
        current = null;
        over(video);
      });
    };
    video.pause = function () {
      video.paused = true;
      if (current === video && !video.__instant) native.pause();
    };
    return video;
  };

  // Called once per frame.
  browser.updateVideo = function () {
    var video = current;
    if (!video) return;
    if (video.__phase === 'loading') {
      if (!video.__instant) {
        var state = native.state();
        if (state === FAILED) {
          console.warn('video: cannot play ' + browser.gamePath(video.src) + '; the game goes on without it');
          native.close();
          video.__instant = true;
        } else if (state !== READY && state !== ENDED) {
          return;
        }
      }
      loaded(video);
    }
    if (current !== video || video.__instant) return;
    if (!video.ended && !video.paused && native.state() === ENDED) over(video);
    if (current !== video) return;  // a handler loaded another video
    var visible = Number(video.style.opacity) > 0;
    if (visible !== shown) native.show(shown = visible);
    if (video.ended && !visible) letGo();
  };
})();
