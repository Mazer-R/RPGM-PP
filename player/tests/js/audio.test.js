// Tests for js/audio.js, the Web Audio stand-in, run with Node:
//   node tests/js/audio.test.js
//
// The native mixer is replaced by one that records what it is asked to do.
// Each test drives the stand-in the way the engine's own sound class does
// and checks what reaches the mixer.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup() {
  const calls = [];
  const mixer = { playingVoices: new Set(), nextVoice: 1, files: { '/game/audio/bgm/theme.ogg': [120, 44100, 2] } };
  const sandbox = {
    console: { warn() {}, error() {}, info() {} },
    performance: { now: () => sandbox.clockMs },
    clockMs: 10000,
    Promise,
    player: {
      readFileBytes: (file, max) => (mixer.files[file] ? new ArrayBuffer(Math.min(max || 64, 64)) : null),
      audio: {
        info: (file) => mixer.files[file] || null,
        play(file, volume, pitch, pan, loop, loopStart, loopEnd, offset) {
          const voice = mixer.nextVoice++;
          mixer.playingVoices.add(voice);
          calls.push({ op: 'play', voice, file, volume, pitch, pan, loop, loopStart, loopEnd, offset });
          return voice;
        },
        stop(voice) { mixer.playingVoices.delete(voice); calls.push({ op: 'stop', voice }); },
        setVolume(voice, volume, ramp) { calls.push({ op: 'volume', voice, volume, ramp }); },
        setPan(voice, pan) { calls.push({ op: 'pan', voice, pan }); },
        isPlaying: (voice) => mixer.playingVoices.has(voice),
      },
    },
    __browser: { tasks: [], later(fn) { this.tasks.push(fn); } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const name of ['file-bytes.js', 'audio.js']) {
    const file = path.join(__dirname, '..', '..', 'js', name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  const browser = sandbox.__browser;
  const runTasks = () => { while (browser.tasks.length) browser.tasks.shift()(); };
  return { sandbox, calls, mixer, browser, runTasks };
}

// Builds what the engine builds for one sound: source -> gain -> panner ->
// master gain -> output, from a file "downloaded" through the stand-in.
function engineSound(t, { volume = 1, pan = 0, master = 1, file = '/game/audio/bgm/theme.ogg' } = {}) {
  const context = new t.sandbox.AudioContext();
  const masterGain = context.createGain();
  masterGain.gain.setValueAtTime(master, context.currentTime);
  masterGain.connect(context.destination);
  let buffer = null, failed = false;
  context.decodeAudioData(t.browser.readSoundFile(file) || new ArrayBuffer(8), (b) => { buffer = b; }, () => { failed = true; }).catch(() => {});
  t.runTasks();
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, context.currentTime);
  const panner = context.createPanner();
  panner.setPosition(pan, 0, 1 - Math.abs(pan));
  source.connect(gain);
  gain.connect(panner);
  panner.connect(masterGain);
  return { context, masterGain, source, gain, panner, buffer, failed };
}
const plays = (t) => t.calls.filter((c) => c.op === 'play');
const last = (t, op) => t.calls.filter((c) => c.op === op).pop();

const tests = {
  'a decoded file reports its length and format without holding its sound'() {
    const t = setup();
    const s = engineSound(t);
    assert.strictEqual(s.buffer.duration, 120);
    assert.strictEqual(s.buffer.sampleRate, 44100);
    assert.strictEqual(s.buffer.numberOfChannels, 2);
    assert.strictEqual(typeof s.buffer.getChannelData, 'undefined');
  },
  'a file that cannot be played is reported through the error callback'() {
    const t = setup();
    const s = engineSound(t, { file: '/game/audio/se/missing.ogg' });
    assert.strictEqual(s.buffer, null);
    assert.strictEqual(s.failed, true);
  },
  'starting a source plays the file with its volume, pan, pitch, loop and offset'() {
    const t = setup();
    const s = engineSound(t, { volume: 0.5, pan: -0.4, master: 0.8 });
    s.source.loop = true;
    s.source.loopStart = 12.5;
    s.source.loopEnd = 90;
    s.source.playbackRate.setValueAtTime(1.5, s.context.currentTime);
    s.source.start(0, 3);
    const p = plays(t)[0];
    assert.strictEqual(p.file, '/game/audio/bgm/theme.ogg');
    assert.ok(Math.abs(p.volume - 0.4) < 1e-9, 'volume is the gains multiplied: ' + p.volume);
    assert.strictEqual(p.pan, -0.4);
    assert.strictEqual(p.pitch, 1.5);
    assert.deepStrictEqual([p.loop, p.loopStart, p.loopEnd, p.offset], [true, 12.5, 90, 3]);
  },
  'a fade-out ramps the playing voice to silence over the fade time'() {
    const t = setup();
    const s = engineSound(t, { volume: 0.9 });
    s.source.start(0, 0);
    const at = s.context.currentTime;
    s.gain.gain.setValueAtTime(0.9, at);
    s.gain.gain.linearRampToValueAtTime(0, at + 2);
    const v = last(t, 'volume');
    assert.strictEqual(v.voice, plays(t)[0].voice);
    assert.strictEqual(v.volume, 0);
    assert.ok(Math.abs(v.ramp - 2) < 1e-9, 'ramp ' + v.ramp);
  },
  'the master gain changes every playing voice'() {
    const t = setup();
    const context = new t.sandbox.AudioContext();
    const a = engineSound(t, { volume: 1 });
    const b = engineSound(t, { volume: 0.5 });
    // Both sounds on one master gain, as in the engine.
    b.panner.connect(a.masterGain);
    a.source.start(0, 0);
    b.source.start(0, 0);
    t.calls.length = 0;
    a.masterGain.gain.setValueAtTime(0.5, context.currentTime);
    const volumes = t.calls.filter((c) => c.op === 'volume').map((c) => c.volume);
    assert.deepStrictEqual(volumes.sort(), [0.25, 0.5]);
  },
  'moving the panner moves the playing voice'() {
    const t = setup();
    const s = engineSound(t);
    s.source.start(0, 0);
    s.panner.setPosition(0.7, 0, 0.3);
    assert.strictEqual(last(t, 'pan').pan, 0.7);
  },
  'stopping a source stops its voice, once'() {
    const t = setup();
    const s = engineSound(t);
    s.source.start(0, 0);
    s.source.stop(0);
    s.source.stop(0);
    assert.strictEqual(t.calls.filter((c) => c.op === 'stop').length, 1);
  },
  'a sound that plays to its end tells its listener, and is then left alone'() {
    const t = setup();
    const s = engineSound(t);
    let ended = 0;
    s.source.onended = () => { ended++; };
    s.source.start(0, 0);
    t.browser.updateAudio();
    assert.strictEqual(ended, 0);
    t.mixer.playingVoices.clear();   // the mixer reached the end of the file
    t.browser.updateAudio();
    t.browser.updateAudio();
    assert.strictEqual(ended, 1);
    t.calls.length = 0;
    s.gain.gain.setValueAtTime(0.1, s.context.currentTime);
    assert.strictEqual(t.calls.length, 0);
  },
  'a source that is not connected to the output plays silent'() {
    const t = setup();
    const context = new t.sandbox.AudioContext();
    const s = engineSound(t);
    s.panner.disconnect();
    s.source.start(0, 0);
    assert.strictEqual(plays(t)[0].volume, 0);
    assert.ok(context.currentTime > 0);
  },
  'the clock is in seconds'() {
    const t = setup();
    const context = new t.sandbox.AudioContext();
    assert.strictEqual(context.currentTime, 10);
  },
};

let failed = 0;
for (const name of Object.keys(tests)) {
  try { tests[name](); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n')[0]); }
}
console.log(failed ? failed + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(failed ? 1 : 0);
