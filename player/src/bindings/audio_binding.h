// Sound for the scripts: player.audio, a thin layer over the sound output.
//
//   player.audio.info(path)            -> [seconds, sampleRate, channels] or null
//   player.audio.play(path, volume, pitch, pan, loop, loopStart, loopEnd, offset)
//                                      -> voice id, or 0 (times in seconds)
//   player.audio.stop(voice)
//   player.audio.setVolume(voice, volume, rampSeconds)
//   player.audio.setPan(voice, pan)
//   player.audio.isPlaying(voice)      -> true or false
//   player.audio.takePeak()            -> loudest sample sent out since the last call
#pragma once

#include "v8.h"

namespace mvp {

class AudioOutput;

// Adds `audio` to the player object. `output` must outlive the engine.
void InstallAudioBinding(v8::Isolate* isolate, v8::Local<v8::Context> context,
                         v8::Local<v8::Object> player, AudioOutput* output);

}  // namespace mvp
