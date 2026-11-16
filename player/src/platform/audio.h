// Sound output. The rest of the player talks to this interface only, so the
// way sound is produced can be replaced without touching anything else.
//
// A "voice" is one sound being played: a piece of music, an ambience, an
// effect. Many can play at once.
#pragma once

#include <cstdint>
#include <memory>
#include <string>

namespace mvp {

class Log;

struct SoundInfo {
  double seconds = 0;
  int sample_rate = 0;
  int channels = 0;
};

struct PlayOptions {
  float volume = 1;      // 0 to 1 and above
  float pitch = 1;       // 1 = as recorded; 2 = an octave up and twice as fast
  float pan = 0;         // -1 left, 0 centre, 1 right
  bool loop = false;
  double loop_start = 0; // seconds; where a looping sound goes back to
  double loop_end = 0;   // seconds; 0 = the end of the file
  double offset = 0;     // seconds; where playing starts
};

// Sound that is already decoded and arrives a little at a time, such as a
// video's sound track: stereo, 16 bits, at the output's own rate.
class SoundStream {
 public:
  virtual ~SoundStream() = default;
  // Called on the sound thread. Writes up to `frames` stereo frames to `out`
  // and returns how many it wrote; the rest is played as silence.
  virtual int Read(int16_t* out, int frames) = 0;
};

class AudioOutput {
 public:
  virtual ~AudioOutput() = default;

  // Samples per second of the output.
  virtual int Rate() const = 0;
  // Mixes `stream` into the output until it is replaced; null removes it.
  // One stream at a time. The stream must stay alive until it is removed.
  virtual void SetStream(SoundStream* stream) = 0;
  virtual void SetStreamVolume(float volume) = 0;

  // Text describing the output, for the log.
  virtual std::string Description() const = 0;
  // Reads a sound file's length and format. Returns false if it cannot be played.
  virtual bool Info(const std::string& path, SoundInfo* info) = 0;
  // Starts a voice and returns its id, or 0 if the file cannot be played.
  virtual int Play(const std::string& path, const PlayOptions& options) = 0;
  // Stops a voice. Unknown ids are ignored.
  virtual void Stop(int voice) = 0;
  // Moves a voice's volume to `volume` over `ramp_seconds` (0 = at once).
  virtual void SetVolume(int voice, float volume, double ramp_seconds) = 0;
  virtual void SetPan(int voice, float pan) = 0;
  // False once a voice has played to its end or was stopped.
  virtual bool IsPlaying(int voice) = 0;
  // The loudest sample sent out since the last call, 0 to 1: lets a test
  // tell that sound is really being produced.
  virtual float TakePeak() = 0;
};

// Opens the sound output. Returns null when the machine has no usable sound
// device; the player then runs silent.
std::unique_ptr<AudioOutput> CreateAudioOutput(Log& log);

}  // namespace mvp
