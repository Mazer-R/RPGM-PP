// The part of the browser's Web Audio API the engine uses, over the player's
// own sound output (player.audio).
//
// The engine plays every sound the same way: it downloads the file, asks the
// browser to decode all of it into memory, and plays that through a small
// chain of nodes (source -> gain -> panner -> master gain -> output), moving
// the gains over time for fades. Here nothing is decoded into memory. A
// "decoded buffer" is only the file's name and length; starting a source
// starts a voice in the native mixer, which decodes the file while it plays;
// and each node change is passed on to the voices it affects.
//
// Loaded only when the player has sound; without it the engine is told to
// run silent (see dom.js).
(function () {
  'use strict';
  var native = player.audio;
  var browser = globalThis.__browser;

  // --- Files -------------------------------------------------------------------
  // The engine reads a sound file's bytes itself, to find the loop points
  // stored in its header. It is given the start of the file only, and that
  // block of bytes is remembered as standing for the file.
  var HEADER_BYTES = 256 * 1024;
  browser.readSoundFile = function (path) {
    var bytes = player.readFileBytes(path, HEADER_BYTES);
    return bytes && browser.bytesStandFor(bytes, path);
  };

  function AudioBuffer(path, info) {
    this.__path = path;
    this.duration = info[0];
    this.sampleRate = info[1];
    this.numberOfChannels = info[2];
    this.length = Math.round(info[0] * info[1]);
  }

  // --- Values that change over time ---------------------------------------------
  // Only what the engine uses: set now, and ramp to a value by a time.
  function AudioParam(value, onChange) {
    this._value = value;
    this._onChange = onChange || function () {};
  }
  Object.defineProperty(AudioParam.prototype, 'value', {
    get: function () { return this._value; },
    set: function (value) { this.setValueAtTime(value, 0); },
  });
  AudioParam.prototype.setValueAtTime = function (value) {
    this._value = Number(value);
    this._onChange(0);
    return this;
  };
  AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
    this._value = Number(value);
    this._onChange(Math.max(0, time - now()));
    return this;
  };
  AudioParam.prototype.exponentialRampToValueAtTime = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.cancelScheduledValues = function () { return this; };

  function now() { return performance.now() / 1000; }

  // --- Nodes -----------------------------------------------------------------
  // Every node knows what it is connected to; a source follows that chain to
  // the output to work out its volume and pan.
  var playing = [];   // sources with a voice in the mixer

  function AudioNode() { this._next = null; }
  AudioNode.prototype.connect = function (node) { this._next = node; refreshAll(0); return node; };
  AudioNode.prototype.disconnect = function () { this._next = null; };

  function GainNode() {
    AudioNode.call(this);
    this.gain = new AudioParam(1, refreshAll);
  }
  GainNode.prototype = Object.create(AudioNode.prototype);

  function PannerNode() {
    AudioNode.call(this);
    this._pan = 0;
    this.panningModel = 'equalpower';
  }
  PannerNode.prototype = Object.create(AudioNode.prototype);
  // The engine places a sound at (pan, 0, 1 - |pan|); the first number is the pan.
  PannerNode.prototype.setPosition = function (x) {
    this._pan = Math.max(-1, Math.min(1, Number(x) || 0));
    refreshAll(0);
  };

  function DestinationNode() { AudioNode.call(this); }
  DestinationNode.prototype = Object.create(AudioNode.prototype);

  // The volume and pan a source ends up with, or null if its chain does not
  // reach the output.
  function mixOf(source) {
    var volume = 1, pan = 0;
    for (var node = source._next, hops = 0; node && hops < 16; node = node._next, hops++) {
      if (node instanceof GainNode) volume *= node.gain._value;
      else if (node instanceof PannerNode) pan = node._pan;
      else if (node instanceof DestinationNode) return { volume: Math.max(0, volume), pan: pan };
    }
    return null;
  }
  // A gain or a connection changed: tell the mixer about every voice.
  function refreshAll(rampSeconds) {
    for (var i = 0; i < playing.length; i++) {
      var source = playing[i], mix = mixOf(source);
      native.setVolume(source._voice, mix ? mix.volume : 0, rampSeconds || 0);
      if (mix) native.setPan(source._voice, mix.pan);
    }
  }

  function BufferSourceNode() {
    AudioNode.call(this);
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new AudioParam(1);
    this.onended = null;
    this._voice = 0;
  }
  BufferSourceNode.prototype = Object.create(AudioNode.prototype);
  BufferSourceNode.prototype.start = function (when, offset) {
    if (this._voice || !this.buffer || !this.buffer.__path) return;
    var mix = mixOf(this) || { volume: 0, pan: 0 };
    this._voice = native.play(this.buffer.__path, mix.volume, this.playbackRate._value, mix.pan,
      !!this.loop, this.loopStart || 0, this.loopEnd || 0, offset || 0);
    if (this._voice) playing.push(this);
  };
  BufferSourceNode.prototype.stop = function () {
    if (!this._voice) return;
    native.stop(this._voice);
    forget(this);
  };
  function forget(source) {
    var index = playing.indexOf(source);
    if (index >= 0) playing.splice(index, 1);
    source._voice = 0;
  }

  // Called once per frame: sources whose sound has played to its end.
  browser.updateAudio = function () {
    for (var i = playing.length - 1; i >= 0; i--) {
      var source = playing[i];
      if (native.isPlaying(source._voice)) continue;
      forget(source);
      if (typeof source.onended === 'function') {
        try { source.onended({ type: 'ended', target: source }); }
        catch (error) { console.error('audio: onended: ' + error); }
      }
    }
  };

  // --- The context ---------------------------------------------------------------
  function AudioContext() {
    this.destination = new DestinationNode();
    this.sampleRate = 44100;
    this.state = 'running';
  }
  Object.defineProperty(AudioContext.prototype, 'currentTime', { get: now });
  AudioContext.prototype.createGain = function () { return new GainNode(); };
  AudioContext.prototype.createPanner = function () { return new PannerNode(); };
  AudioContext.prototype.createBufferSource = function () { return new BufferSourceNode(); };
  AudioContext.prototype.resume = function () { return Promise.resolve(); };
  AudioContext.prototype.suspend = function () { return Promise.resolve(); };
  AudioContext.prototype.close = function () { return Promise.resolve(); };
  AudioContext.prototype.decodeAudioData = function (bytes, onDecoded, onError) {
    var path = browser.fileBehind(bytes);
    var info = path ? native.info(path) : null;
    var result = info ? new AudioBuffer(path, info) : null;
    if (!result) {
      console.warn('audio: cannot play ' + (path || 'sound data that did not come from a file'));
    }
    // As a browser does, the answer comes after the current script.
    browser.later(function () {
      if (result && onDecoded) onDecoded(result);
      if (!result && onError) onError(new Error('cannot decode audio data'));
    });
    return result ? Promise.resolve(result) : Promise.reject(new Error('cannot decode audio data'));
  };

  globalThis.AudioContext = globalThis.webkitAudioContext = AudioContext;
})();
