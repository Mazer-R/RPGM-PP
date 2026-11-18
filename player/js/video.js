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
//
// A script may instead draw the video itself: plugins that put videos in
// sprites hand the element to the graphics library as the source of a
// texture, never make it visible, and play, pause and replay it. For them
// the element is an HTMLVideoElement, says how large its picture is and how
// far it has played, announces what such a library waits for, and is marked
// (__videoFrame) while its picture is the one a texture gets from the
// native side. There is no seeking: setting the time to the start replays
// the video, and setting it to the end ends it.
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
  function open(video) {
    var file = browser.gamePath(video.src);
    var opened = !!native && native.open(file, video.width || 0, video.height || 0);
    if (native && !opened) console.warn('video: cannot open ' + file + '; the game goes on without it');
    if (opened) native.setVolume(video.muted ? 0 : video.volume);
    video.__instant = !opened;
    video.__phase = 'loading';
    video.__videoFrame = false;
    video.ended = false;
    current = video;
    shown = null;
  }
  function start(video) {
    video.__wantsPlay = false;
    video.paused = false;
    emit(video, 'play');
    if (!video.__instant) return native.play();
    browser.later(function () {
      if (current !== video) return;
      current = null;
      over(video);
    });
  }
  function loaded(video) {
    video.__phase = 'loaded';
    video.readyState = 4;
    video.__videoFrame = !video.__instant;
    if (!video.__instant && native.width) {
      video.videoWidth = native.width();
      video.videoHeight = native.height();
    }
    // A video being played again has announced its data already.
    if (!video.__again) {
      emit(video, 'loadedmetadata');
      emit(video, 'loadeddata');
      emit(video, 'canplay');
      emit(video, 'canplaythrough');
    }
    video.__again = false;
    if (current === video && video.__phase === 'loaded' && video.__wantsPlay && video.paused) start(video);
  }
  function over(video) {
    if (!video.__instant && native && native.time && current === video) video.duration = native.time();
    video.ended = true;
    video.paused = true;
    emit(video, 'ended');
  }
  function letGo() {
    if (current) current.__videoFrame = false;
    if (current && !current.__instant) native.close();
    current = null;
  }

  // The native player has one video open at a time. A script may ask for
  // several to be loaded before it plays any (a plugin that preloads the
  // game's videos does): each one that another takes the place of while its
  // data is awaited is told, a moment later, that its data is there, without
  // being open. It is opened again when it is played.
  function take(video) {
    var displaced = current;
    letGo();
    if (!displaced || displaced === video || displaced.__phase !== 'loading') return;
    browser.later(function () {
      if (current === displaced || displaced.__phase !== 'loading') return;
      var wantsPlay = displaced.__wantsPlay;
      displaced.__instant = false;
      displaced.__phase = 'loaded';
      displaced.readyState = 4;
      // The size its pictures will have: the native player's when none is asked for.
      displaced.videoWidth = displaced.width || 816;
      displaced.videoHeight = displaced.height || 624;
      if (!displaced.__again) ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'].forEach(function (type) { emit(displaced, type); });
      displaced.__again = false;
      if (wantsPlay && current !== displaced) displaced.play();
    });
  }

  // What tells a video element from any other, for libraries that ask
  // whether what they were given is one.
  if (!globalThis.HTMLVideoElement) {
    globalThis.HTMLVideoElement = function HTMLVideoElement() {};
    Object.defineProperty(globalThis.HTMLVideoElement, Symbol.hasInstance, {
      value: function (thing) { return !!thing && thing.__isVideo === true; },
    });
  }

  browser.makeVideo = function (video) {
    var volume = 1, muted = false;
    video.__isVideo = true;
    video.__videoFrame = false;
    video.__wantsPlay = false;
    video.__again = false;
    video.HAVE_NOTHING = 0; video.HAVE_METADATA = 1; video.HAVE_CURRENT_DATA = 2;
    video.HAVE_FUTURE_DATA = 3; video.HAVE_ENOUGH_DATA = 4;
    video.src = '';
    video.paused = true;
    video.ended = false;
    video.readyState = 0;
    video.videoWidth = 0;
    video.videoHeight = 0;
    video.duration = NaN;  // known once the video has played through
    video.playbackRate = 1;
    video.defaultPlaybackRate = 1;
    video.loop = false;
    video.autoplay = false;
    video.__phase = 'idle';
    video.__instant = false;
    Object.defineProperty(video, 'volume', {
      get: function () { return volume; },
      set: function (value) {
        volume = Math.max(0, Math.min(1, Number(value) || 0));
        if (native) native.setVolume(muted ? 0 : volume);
      },
    });
    Object.defineProperty(video, 'muted', {
      get: function () { return muted; },
      set: function (value) {
        muted = !!value;
        if (native && current === video) native.setVolume(muted ? 0 : volume);
      },
    });
    Object.defineProperty(video, 'currentTime', {
      get: function () {
        if (current !== video || video.__instant || !native || !native.time) return 0;
        return video.__phase === 'loaded' ? native.time() : 0;
      },
      set: function (value) {
        value = Number(value);
        if (video.__phase !== 'loaded') return;
        // The end, as far as it is known: the video is over.
        if (!(value < Infinity) || value >= video.duration) {
          if (video.ended) return;
          var mine = current === video;
          if (mine) letGo();
          over(video);
          return;
        }
        // The start, of a video that has moved on: it plays again from there.
        if (value <= 0 && (video.ended || current !== video || video.currentTime > 0.25)) again(video);
      },
    });
    function again(video) {
      var playing = !video.paused && !video.ended;
      take(video);
      video.__again = true;
      video.__wantsPlay = playing;
      video.paused = true;
      open(video);
    }
    video.canPlayType = function (type) { return native && /^video\//.test(String(type)) ? 'probably' : ''; };
    video.load = function () {
      take(video);
      video.__again = false;
      video.__wantsPlay = false;
      video.paused = true;
      video.readyState = 0;
      open(video);
    };
    video.play = function () {
      // One that has ended, or that another video took the place of, starts
      // again; one whose data is not there yet starts when it is.
      if (video.__phase === 'loaded' && (video.ended || current !== video)) again(video);
      if (current !== video) return;
      if (video.__phase !== 'loaded') { video.__wantsPlay = true; return; }
      if (!video.paused) return;
      return start(video);
    };
    video.pause = function () {
      video.__wantsPlay = false;
      if (video.paused) return;
      video.paused = true;
      if (current === video && !video.__instant) native.pause();
      emit(video, 'pause');
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
