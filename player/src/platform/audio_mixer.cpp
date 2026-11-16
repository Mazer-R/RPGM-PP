// The player's own sound mixer: every voice decodes its Ogg Vorbis file as
// it plays (nothing is decoded ahead into memory), and the voices are mixed
// in SDL2's audio callback.
#include <SDL.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <map>
#include <vector>

#include "platform/audio.h"
#include "platform/files.h"
#include "platform/log.h"

#define STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.c"

namespace mvp {
namespace {

constexpr int kOutputRate = 44100;
constexpr int kChunkFrames = 2048;  // decoded frames kept per voice
constexpr size_t kMaxVoices = 32;

struct Voice {
  int id = 0;
  stb_vorbis* decoder = nullptr;
  unsigned total_samples = 0;
  // Decoded sound waiting to be played: stereo frames, and how far into
  // them playing has got (a fraction, because pitch resamples).
  std::vector<float> frames = std::vector<float>(kChunkFrames * 2);
  int frame_count = 0;
  double position = 0;
  double step = 1;  // decoded frames consumed per output frame
  unsigned next_sample = 0;  // the file position the decoder is at
  bool loop = false;
  unsigned loop_start = 0, loop_end = 0;  // in samples; loop_end 0 = file end
  float volume = 1, volume_target = 1, volume_step = 0;
  float pan = 0;
  bool decoder_ended = false;
  bool finished = false;
};

class Mixer : public AudioOutput {
 public:
  explicit Mixer(Log& log) : log_(log) {}

  bool Open() {
    if (SDL_InitSubSystem(SDL_INIT_AUDIO) != 0) {
      log_.Write(LogLevel::kWarning, "audio", std::string("no sound: ") + SDL_GetError());
      return false;
    }
    SDL_AudioSpec want{}, have{};
    want.freq = kOutputRate;
    want.format = AUDIO_S16SYS;
    want.channels = 2;
    want.samples = 1024;
    want.callback = &Mixer::Callback;
    want.userdata = this;
    device_ = SDL_OpenAudioDevice(nullptr, 0, &want, &have, 0);
    if (!device_) {
      log_.Write(LogLevel::kWarning, "audio", std::string("no sound device: ") + SDL_GetError());
      SDL_QuitSubSystem(SDL_INIT_AUDIO);
      return false;
    }
    description_ = std::string(SDL_GetCurrentAudioDriver() ? SDL_GetCurrentAudioDriver() : "?") + ", " +
                   std::to_string(have.freq) + " Hz, " + std::to_string(have.samples) + " frames per block";
    SDL_PauseAudioDevice(device_, 0);
    return true;
  }

  ~Mixer() override {
    if (device_) SDL_CloseAudioDevice(device_);
    for (Voice* voice : voices_) Destroy(voice);
    if (device_) SDL_QuitSubSystem(SDL_INIT_AUDIO);
  }

  std::string Description() const override { return description_; }

  bool Info(const std::string& written_path, SoundInfo* info) override {
    auto known = infos_.find(written_path);
    if (known != infos_.end()) {
      *info = known->second;
      return info->sample_rate > 0;
    }
    SoundInfo result;
    int error = 0;
    if (stb_vorbis* decoder = stb_vorbis_open_filename(FindFile(written_path).c_str(), &error, nullptr)) {
      stb_vorbis_info format = stb_vorbis_get_info(decoder);
      result.sample_rate = static_cast<int>(format.sample_rate);
      result.channels = format.channels;
      result.seconds = stb_vorbis_stream_length_in_seconds(decoder);
      stb_vorbis_close(decoder);
    }
    infos_[written_path] = result;  // failures are remembered too
    *info = result;
    return result.sample_rate > 0;
  }

  int Play(const std::string& written_path, const PlayOptions& options) override {
    Reap();
    int error = 0;
    stb_vorbis* decoder = stb_vorbis_open_filename(FindFile(written_path).c_str(), &error, nullptr);
    if (!decoder) return 0;
    stb_vorbis_info format = stb_vorbis_get_info(decoder);
    double rate = static_cast<double>(format.sample_rate);

    Voice* voice = new Voice();
    voice->id = next_id_++;
    voice->decoder = decoder;
    voice->total_samples = stb_vorbis_stream_length_in_samples(decoder);
    voice->step = std::max(0.05, static_cast<double>(options.pitch)) * rate / kOutputRate;
    voice->loop = options.loop;
    voice->loop_start = static_cast<unsigned>(std::max(0.0, options.loop_start) * rate);
    voice->loop_end = static_cast<unsigned>(std::max(0.0, options.loop_end) * rate);
    if (voice->loop_end > voice->total_samples) voice->loop_end = 0;
    if (voice->loop_start >= (voice->loop_end ? voice->loop_end : voice->total_samples)) voice->loop_start = 0;
    voice->volume = voice->volume_target = std::max(0.0f, options.volume);
    voice->pan = std::min(1.0f, std::max(-1.0f, options.pan));
    unsigned start = static_cast<unsigned>(std::max(0.0, options.offset) * rate);
    if (start > 0 && start < voice->total_samples) {
      stb_vorbis_seek(decoder, start);
      voice->next_sample = start;
    }

    SDL_LockAudioDevice(device_);
    if (voices_.size() >= kMaxVoices) {
      // Too many at once: the oldest sound that is not a loop makes room.
      for (Voice* old : voices_) {
        if (!old->loop && !old->finished) { old->finished = true; break; }
      }
    }
    voices_.push_back(voice);
    SDL_UnlockAudioDevice(device_);
    return voice->id;
  }

  void Stop(int id) override {
    SDL_LockAudioDevice(device_);
    if (Voice* voice = Find(id)) voice->finished = true;
    SDL_UnlockAudioDevice(device_);
  }

  void SetVolume(int id, float volume, double ramp_seconds) override {
    SDL_LockAudioDevice(device_);
    if (Voice* voice = Find(id)) {
      voice->volume_target = std::max(0.0f, volume);
      double frames = ramp_seconds * kOutputRate;
      if (frames < 1) {
        voice->volume = voice->volume_target;
        voice->volume_step = 0;
      } else {
        voice->volume_step = static_cast<float>((voice->volume_target - voice->volume) / frames);
      }
    }
    SDL_UnlockAudioDevice(device_);
  }

  void SetPan(int id, float pan) override {
    SDL_LockAudioDevice(device_);
    if (Voice* voice = Find(id)) voice->pan = std::min(1.0f, std::max(-1.0f, pan));
    SDL_UnlockAudioDevice(device_);
  }

  bool IsPlaying(int id) override {
    SDL_LockAudioDevice(device_);
    Voice* voice = Find(id);
    bool playing = voice && !voice->finished;
    SDL_UnlockAudioDevice(device_);
    return playing;
  }

  float TakePeak() override { return peak_.exchange(0); }

 private:
  static void Destroy(Voice* voice) {
    if (voice->decoder) stb_vorbis_close(voice->decoder);
    delete voice;
  }

  Voice* Find(int id) {
    for (Voice* voice : voices_) {
      if (voice->id == id) return voice;
    }
    return nullptr;
  }

  // Frees the voices that have finished. Done here, on the caller's thread,
  // so the audio callback never frees memory.
  void Reap() {
    std::vector<Voice*> done;
    SDL_LockAudioDevice(device_);
    auto finished = std::stable_partition(voices_.begin(), voices_.end(), [](Voice* v) { return !v->finished; });
    done.assign(finished, voices_.end());
    voices_.erase(finished, voices_.end());
    SDL_UnlockAudioDevice(device_);
    for (Voice* voice : done) Destroy(voice);
  }

  // Decodes the next stretch of a voice's file after the frame it kept.
  static void Refill(Voice* voice) {
    // The last frame stays as the first, so resampling can blend across the join.
    int kept = voice->frame_count > 0 ? 1 : 0;
    if (kept) {
      voice->frames[0] = voice->frames[(voice->frame_count - 1) * 2];
      voice->frames[1] = voice->frames[(voice->frame_count - 1) * 2 + 1];
      voice->position -= voice->frame_count - 1;
    }
    voice->frame_count = kept;
    for (int attempt = 0; attempt < 2 && voice->frame_count < kChunkFrames && !voice->decoder_ended; attempt++) {
      int want = kChunkFrames - voice->frame_count;
      unsigned end = voice->loop && voice->loop_end ? voice->loop_end : voice->total_samples;
      if (voice->loop && end > voice->next_sample && end - voice->next_sample < static_cast<unsigned>(want)) {
        want = static_cast<int>(end - voice->next_sample);
      }
      int got = want > 0 ? stb_vorbis_get_samples_float_interleaved(
                               voice->decoder, 2, voice->frames.data() + voice->frame_count * 2, want * 2)
                         : 0;
      voice->frame_count += got;
      voice->next_sample += static_cast<unsigned>(got);
      if (got < want || (voice->loop && voice->next_sample >= end)) {
        if (voice->loop && voice->total_samples > 0) {
          stb_vorbis_seek(voice->decoder, voice->loop_start);
          voice->next_sample = voice->loop_start;
        } else {
          voice->decoder_ended = true;
        }
      }
    }
  }

  void Mix(int16_t* out, int frame_total) {
    mix_.assign(static_cast<size_t>(frame_total) * 2, 0.0f);
    for (Voice* voice : voices_) {
      if (voice->finished) continue;
      float left_gain = voice->pan > 0 ? 1 - voice->pan : 1;
      float right_gain = voice->pan < 0 ? 1 + voice->pan : 1;
      for (int i = 0; i < frame_total; i++) {
        if (voice->position >= voice->frame_count - 1) {
          if (voice->decoder_ended) {
            voice->finished = true;
            break;
          }
          Refill(voice);
          if (voice->frame_count < 2) {
            voice->finished = voice->decoder_ended;
            break;
          }
        }
        int index = static_cast<int>(voice->position);
        float blend = static_cast<float>(voice->position - index);
        const float* a = &voice->frames[index * 2];
        float left = a[0] + (a[2] - a[0]) * blend;
        float right = a[1] + (a[3] - a[1]) * blend;
        if (voice->volume_step != 0) {
          voice->volume += voice->volume_step;
          bool reached = voice->volume_step > 0 ? voice->volume >= voice->volume_target
                                                : voice->volume <= voice->volume_target;
          if (reached) {
            voice->volume = voice->volume_target;
            voice->volume_step = 0;
          }
        }
        mix_[i * 2] += left * voice->volume * left_gain;
        mix_[i * 2 + 1] += right * voice->volume * right_gain;
        voice->position += voice->step;
      }
    }
    float peak = 0;
    for (int i = 0; i < frame_total * 2; i++) {
      float sample = std::min(1.0f, std::max(-1.0f, mix_[i]));
      peak = std::max(peak, std::fabs(sample));
      out[i] = static_cast<int16_t>(sample * 32767.0f);
    }
    if (peak > peak_.load()) peak_.store(peak);
  }

  static void Callback(void* self, Uint8* stream, int bytes) {
    static_cast<Mixer*>(self)->Mix(reinterpret_cast<int16_t*>(stream), bytes / 4);
  }

  Log& log_;
  SDL_AudioDeviceID device_ = 0;
  std::string description_;
  std::vector<Voice*> voices_;  // guarded by the audio device's lock
  std::vector<float> mix_;      // used by the audio callback only
  std::map<std::string, SoundInfo> infos_;
  std::atomic<float> peak_{0};
  int next_id_ = 1;
};

}  // namespace

std::unique_ptr<AudioOutput> CreateAudioOutput(Log& log) {
  auto mixer = std::make_unique<Mixer>(log);
  if (!mixer->Open()) return nullptr;
  return mixer;
}

}  // namespace mvp
