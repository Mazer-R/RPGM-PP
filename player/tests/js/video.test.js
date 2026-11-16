// Tests for js/video.js, run with Node:
//   node tests/js/video.test.js
//
// The module gives the page's <video> element its behaviour. The engine
// drives a video the same way every time: it sets the address, sets its
// handlers, calls load(), and from then on believes a video is playing until
// the element says it has ended. The tests take those steps and check what
// the engine would see, with a native video player that the test controls
// and with none at all.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// States of the native player, as video.js reads them.
const LOADING = 1, READY = 2, ENDED = 3, FAILED = 4;

function setup(withNative) {
  const calls = [];
  const native = {
    stateNow: LOADING,
    opens: true,
    open(file, width, height) { calls.push('open ' + file + ' ' + width + 'x' + height); return this.opens; },
    play() { calls.push('play'); },
    pause() { calls.push('pause'); },
    close() { calls.push('close'); },
    setVolume(value) { calls.push('volume ' + value); },
    show(visible) { calls.push('show ' + visible); },
    state() { return this.stateNow; },
  };
  const waiting = [];
  const warnings = [];
  const sandbox = {
    player: withNative ? { video: native } : {},
    console: { warn: (text) => warnings.push(text), info() {} },
    __browser: { later: (fn) => waiting.push(fn), gamePath: (url) => '/game/' + url },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'js', 'video.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });

  const browser = sandbox.__browser;
  const events = [];
  const video = browser.makeVideo({ style: { opacity: 0 }, width: 816, height: 624 });
  // The engine's three handlers.
  video.onloadeddata = () => { events.push('loadeddata'); video.play(); video.style.opacity = 1; };
  video.onended = () => { events.push('ended'); video.style.opacity = 0; };
  video.onerror = () => events.push('error');
  // One frame of the player: things queued for "after this script", then the
  // per-frame check.
  const frame = () => { waiting.splice(0).forEach((fn) => fn()); browser.updateVideo(); };
  return { native, calls, events, video, frame, warnings };
}

const tests = {
  'a video plays from load to end'() {
    const t = setup(true);
    t.video.src = 'movies/intro.webm';
    t.video.load();
    assert.deepStrictEqual(t.calls, ['open /game/movies/intro.webm 816x624', 'volume 1']);
    t.frame();
    assert.deepStrictEqual(t.events, [], 'nothing is announced while the first picture is not there');

    t.native.stateNow = READY;
    t.frame();
    assert.deepStrictEqual(t.events, ['loadeddata']);
    assert.strictEqual(t.video.paused, false);
    assert.ok(t.calls.includes('play'));
    t.frame();
    assert.strictEqual(t.calls[t.calls.length - 1], 'show true', 'the picture is shown once the engine made the element visible');

    t.native.stateNow = ENDED;
    t.frame();
    assert.deepStrictEqual(t.events, ['loadeddata', 'ended']);
    assert.strictEqual(t.video.ended, true);
    t.frame();
    assert.ok(t.calls.includes('close'), 'the native player is let go once the element is hidden again');
    t.frame();
    assert.deepStrictEqual(t.events, ['loadeddata', 'ended'], 'the end is announced once');
  },

  'the picture stays hidden while the element is'() {
    const t = setup(true);
    t.video.onloadeddata = () => {};
    t.video.src = 'movies/a.webm';
    t.video.load();
    t.native.stateNow = READY;
    t.frame();
    assert.strictEqual(t.calls[t.calls.length - 1], 'show false');
  },

  'without a native player a video is over at once, and the game goes on'() {
    const t = setup(false);
    t.video.src = 'movies/intro.webm';
    t.video.load();
    t.frame();
    t.frame();
    assert.deepStrictEqual(t.events, ['loadeddata', 'ended']);
    assert.strictEqual(t.video.canPlayType('video/webm'), '');
  },

  'a video that cannot be opened is over at once, with a warning'() {
    const t = setup(true);
    t.native.opens = false;
    t.video.src = 'movies/missing.webm';
    t.video.load();
    t.frame();
    t.frame();
    assert.deepStrictEqual(t.events, ['loadeddata', 'ended']);
    assert.strictEqual(t.warnings.length, 1);
    assert.ok(/missing\.webm/.test(t.warnings[0]));
  },

  'a video that fails while loading is over at once, without the error handler'() {
    const t = setup(true);
    t.video.src = 'movies/broken.webm';
    t.video.load();
    t.native.stateNow = FAILED;
    t.frame();
    t.frame();
    assert.deepStrictEqual(t.events, ['loadeddata', 'ended'], 'the engine\'s error handler would stop the game with a retry screen');
    assert.ok(t.calls.includes('close'));
    assert.strictEqual(t.warnings.length, 1);
  },

  'loading another video lets go of the one before'() {
    const t = setup(true);
    t.video.src = 'movies/a.webm';
    t.video.load();
    t.video.src = 'movies/b.webm';
    t.video.load();
    assert.deepStrictEqual(t.calls, ['open /game/movies/a.webm 816x624', 'volume 1', 'close', 'open /game/movies/b.webm 816x624', 'volume 1']);
  },

  'the element says what it can play and passes its volume on'() {
    const t = setup(true);
    assert.strictEqual(t.video.canPlayType('video/webm'), 'probably');
    assert.strictEqual(t.video.canPlayType('video/mp4'), 'probably');
    assert.strictEqual(t.video.canPlayType('audio/ogg'), '');
    t.video.volume = 0.5;
    assert.strictEqual(t.video.volume, 0.5);
    assert.deepStrictEqual(t.calls, ['volume 0.5']);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
