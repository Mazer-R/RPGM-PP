#include "platform/video.h"

#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

#include "platform/audio.h"

extern char** environ;

namespace mvp {
namespace {

constexpr double kFramesPerSecond = 30.0;
// Pictures decoded ahead of the one being shown. The decoder waits when
// these are full, which is what keeps it in step with playing.
constexpr size_t kPicturesAhead = 6;
// While the sound is still coming, the pictures may run this far past the
// last sound that was played, and no further: sound that stops stops them.
constexpr double kSecondsPastSound = 0.1;
constexpr size_t kSoundBytesAhead = 2 * 4 * 48000;  // about two seconds

using SteadyClock = std::chrono::steady_clock;

bool IsProgram(const std::string& path) { return !path.empty() && access(path.c_str(), X_OK) == 0; }

// Reads until `size` bytes have arrived. False at the end of the data.
bool ReadAll(int fd, uint8_t* out, size_t size) {
  size_t done = 0;
  while (done < size) {
    ssize_t got = read(fd, out + done, size - done);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return false;
    done += static_cast<size_t>(got);
  }
  return true;
}

// A pipe whose ends are closed when another program is started, and are
// numbered above the few numbers the decoder is given its outputs on.
bool MakePipe(int* read_end, int* write_end) {
  int ends[2];
  if (pipe(ends) != 0) return false;
  *read_end = fcntl(ends[0], F_DUPFD_CLOEXEC, 10);
  *write_end = fcntl(ends[1], F_DUPFD_CLOEXEC, 10);
  close(ends[0]);
  close(ends[1]);
  if (*read_end >= 0 && *write_end >= 0) return true;
  if (*read_end >= 0) close(*read_end);
  if (*write_end >= 0) close(*write_end);
  return false;
}

// The environment the decoder is started with: the player's own, except
// that the library search path is the one the system had before the
// player's package put its own copies of some libraries first
// ($MVPLAYER_SYSTEM_LIBRARY_PATH, set by the package's start script). The
// decoder is the system's program and must load the system's libraries.
std::vector<std::string> DecoderEnvironment() {
  const char* system_path = std::getenv("MVPLAYER_SYSTEM_LIBRARY_PATH");
  std::vector<std::string> result;
  for (char** entry = environ; entry && *entry; entry++) {
    if (system_path && std::strncmp(*entry, "LD_LIBRARY_PATH=", 16) == 0) continue;
    result.push_back(*entry);
  }
  if (system_path && *system_path) result.push_back(std::string("LD_LIBRARY_PATH=") + system_path);
  return result;
}

}  // namespace

std::string VideoPlayer::FindDecoder() {
  if (const char* chosen = std::getenv("MVPLAYER_FFMPEG")) return IsProgram(chosen) ? chosen : std::string();
  const char* path = std::getenv("PATH");
  std::string folders = path ? path : "/usr/local/bin:/usr/bin:/bin";
  size_t start = 0;
  while (start <= folders.size()) {
    size_t end = folders.find(':', start);
    if (end == std::string::npos) end = folders.size();
    std::string candidate = folders.substr(start, end - start) + "/ffmpeg";
    if (end > start && IsProgram(candidate)) return candidate;
    start = end + 1;
  }
  return std::string();
}

struct VideoPlayer::Impl : SoundStream {
  AudioOutput* audio = nullptr;
  std::string decoder;
  float volume = 1;

  // --- One open video. Everything below is guarded by `mutex`, except what
  // is marked as belonging to one thread. ---
  std::mutex mutex;
  std::condition_variable changed;
  std::thread reader;        // reads the pictures, and runs the decoder
  std::string path;
  int width = 0, height = 0;
  bool open = false;
  bool closing = false;
  bool visible = false;      // the caller's thread only
  pid_t decoder_pid = -1;

  // Pictures: decoded ones waiting for their moment, the one being shown,
  // and used ones kept to be filled again.
  std::deque<std::vector<uint8_t>> waiting;
  std::vector<std::vector<uint8_t>> spare;
  std::vector<uint8_t> shown;  // the caller's thread only
  long next_number = 0;        // the number of waiting.front(), counted from 0
  bool has_picture = false;
  bool picture_changed = false;
  bool pictures_done = false;  // the decoder has given all it will
  bool failed = false;

  // Sound: bytes of 16-bit stereo waiting to be played.
  std::vector<uint8_t> sound;
  size_t sound_read = 0;
  bool sound_coming = false;  // a sound track exists and is not played out
  bool sound_done = true;     // the decoder has given all the sound it will
  long frames_played = 0;

  // The video's own time: where it was at `anchor_wall`, and whether it moves.
  bool playing = false;
  double anchor_seconds = 0;
  SteadyClock::time_point anchor_wall;

  double NowLocked() const {
    if (!playing) return anchor_seconds;
    double passed = std::chrono::duration<double>(SteadyClock::now() - anchor_wall).count();
    if (sound_coming) passed = std::min(passed, kSecondsPastSound);
    return anchor_seconds + passed;
  }

  // The sound thread asks for the next stretch of sound.
  int Read(int16_t* out, int frames) override {
    std::lock_guard<std::mutex> lock(mutex);
    if (!playing || !sound_coming) return 0;
    size_t available = (sound.size() - sound_read) / 4;
    size_t count = std::min(available, static_cast<size_t>(frames));
    if (count > 0) {
      std::memcpy(out, sound.data() + sound_read, count * 4);
      sound_read += count * 4;
      frames_played += static_cast<long>(count);
      anchor_seconds = static_cast<double>(frames_played) / audio->Rate();
      anchor_wall = SteadyClock::now();
      if (sound_read >= sound.size()) {
        sound.clear();
        sound_read = 0;
      } else if (sound_read > (1u << 20)) {
        sound.erase(sound.begin(), sound.begin() + static_cast<long>(sound_read));
        sound_read = 0;
      }
    }
    if (sound_done && sound.size() - sound_read < 4) {
      // Played out: from here the pictures follow the clock.
      anchor_seconds = NowLocked();
      anchor_wall = SteadyClock::now();
      sound_coming = false;
    }
    changed.notify_all();
    return static_cast<int>(count);
  }

  // Starts the decoder on the video, writing pictures to *pictures_fd and,
  // if `with_sound`, sound to *sound_fd.
  bool StartDecoder(bool with_sound, int* pictures_fd, int* sound_fd) {
    int pictures_write = -1, sound_write = -1;
    *sound_fd = -1;
    if (!MakePipe(pictures_fd, &pictures_write)) return false;
    if (with_sound && !MakePipe(sound_fd, &sound_write)) {
      close(*pictures_fd);
      close(pictures_write);
      return false;
    }
#ifdef F_SETPIPE_SZ
    fcntl(*pictures_fd, F_SETPIPE_SZ, 1 << 20);  // fewer, larger reads per picture
#endif
    std::string size = std::to_string(width) + ":" + std::to_string(height);
    std::string fit = "scale=" + size + ":force_original_aspect_ratio=decrease,pad=" + size + ":(ow-iw)/2:(oh-ih)/2";
    std::string rate = std::to_string(static_cast<int>(kFramesPerSecond));
    std::string sound_rate = std::to_string(audio ? audio->Rate() : 44100);
    std::vector<std::string> words = {decoder, "-nostdin", "-loglevel", "error", "-i", path,
                                      "-map", "0:v:0", "-vf", fit, "-r", rate, "-pix_fmt", "rgba",
                                      "-f", "rawvideo", "pipe:1"};
    if (with_sound) {
      for (const char* word : {"-map", "0:a:0", "-ac", "2", "-ar"}) words.push_back(word);
      words.push_back(sound_rate);
      for (const char* word : {"-f", "s16le", "pipe:3"}) words.push_back(word);
    }
    std::vector<char*> argv;
    for (std::string& word : words) argv.push_back(&word[0]);
    argv.push_back(nullptr);

    std::vector<std::string> variables = DecoderEnvironment();
    std::vector<char*> envp;
    for (std::string& variable : variables) envp.push_back(&variable[0]);
    envp.push_back(nullptr);

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
    posix_spawn_file_actions_adddup2(&actions, pictures_write, 1);
    posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0);
    if (with_sound) posix_spawn_file_actions_adddup2(&actions, sound_write, 3);
    pid_t pid = -1;
    bool started = posix_spawn(&pid, decoder.c_str(), &actions, nullptr, argv.data(), envp.data()) == 0;
    posix_spawn_file_actions_destroy(&actions);
    close(pictures_write);
    if (sound_write >= 0) close(sound_write);
    if (!started) {
      close(*pictures_fd);
      if (*sound_fd >= 0) close(*sound_fd);
      return false;
    }
    std::lock_guard<std::mutex> lock(mutex);
    decoder_pid = pid;
    if (closing) kill(pid, SIGKILL);
    return true;
  }

  void ReadSound(int fd) {
    std::vector<uint8_t> block(16 * 1024);
    for (;;) {
      ssize_t got = read(fd, block.data(), block.size());
      if (got < 0 && errno == EINTR) continue;
      if (got <= 0) break;
      std::unique_lock<std::mutex> lock(mutex);
      changed.wait(lock, [this] { return closing || sound.size() - sound_read < kSoundBytesAhead; });
      if (closing) break;
      sound.insert(sound.end(), block.begin(), block.begin() + got);
    }
    close(fd);
    std::lock_guard<std::mutex> lock(mutex);
    sound_done = true;
  }

  // Runs the decoder once over the video. Returns how many pictures it gave.
  long Decode(bool with_sound) {
    int pictures_fd = -1, sound_fd = -1;
    if (!StartDecoder(with_sound, &pictures_fd, &sound_fd)) return 0;
    std::thread sound_reader;
    if (with_sound) {
      {
        std::lock_guard<std::mutex> lock(mutex);
        sound_coming = true;
        sound_done = false;
      }
      sound_reader = std::thread([this, sound_fd] { ReadSound(sound_fd); });
    }
    size_t bytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
    long count = 0;
    for (;;) {
      std::vector<uint8_t> picture;
      {
        std::lock_guard<std::mutex> lock(mutex);
        if (closing) break;
        if (!spare.empty()) {
          picture = std::move(spare.back());
          spare.pop_back();
        }
      }
      picture.resize(bytes);
      if (!ReadAll(pictures_fd, picture.data(), bytes)) break;
      std::unique_lock<std::mutex> lock(mutex);
      changed.wait(lock, [this] { return closing || waiting.size() < kPicturesAhead; });
      if (closing) break;
      waiting.push_back(std::move(picture));
      count++;
    }
    close(pictures_fd);
    if (sound_reader.joinable()) sound_reader.join();
    pid_t pid;
    {
      std::lock_guard<std::mutex> lock(mutex);
      pid = decoder_pid;
      decoder_pid = -1;
    }
    // Everything wanted from it has been read.
    kill(pid, SIGKILL);
    waitpid(pid, nullptr, 0);
    return count;
  }

  void ReadVideo() {
    bool with_sound = audio != nullptr;
    long count = Decode(with_sound);
    // The decoder gives nothing when asked for the sound of a video that
    // has none; such a video is read again without.
    if (count == 0 && with_sound) {
      {
        std::lock_guard<std::mutex> lock(mutex);
        sound_coming = false;
        sound_done = true;
        sound.clear();
        sound_read = 0;
      }
      count = Decode(false);
    }
    std::lock_guard<std::mutex> lock(mutex);
    pictures_done = true;
    failed = count == 0;
  }
};

VideoPlayer::VideoPlayer(AudioOutput* audio) : impl_(new Impl()) {
  impl_->audio = audio;
  impl_->decoder = FindDecoder();
}

VideoPlayer::~VideoPlayer() { Close(); }

bool VideoPlayer::available() const { return !impl_->decoder.empty(); }

bool VideoPlayer::Open(const std::string& path, int width, int height) {
  Close();
  Impl& v = *impl_;
  if (v.decoder.empty() || access(path.c_str(), R_OK) != 0) return false;
  v.path = path;
  v.width = std::max(2, std::min(width > 0 ? width : 816, 4096));
  v.height = std::max(2, std::min(height > 0 ? height : 624, 4096));
  v.open = true;
  v.anchor_wall = SteadyClock::now();
  if (v.audio) {
    v.audio->SetStreamVolume(v.volume);
    v.audio->SetStream(&v);
  }
  v.reader = std::thread([&v] { v.ReadVideo(); });
  return true;
}

void VideoPlayer::Close() {
  Impl& v = *impl_;
  if (!v.open) return;
  // First, so that the sound thread is no longer inside Read.
  if (v.audio) v.audio->SetStream(nullptr);
  {
    std::lock_guard<std::mutex> lock(v.mutex);
    v.closing = true;
    if (v.decoder_pid > 0) kill(v.decoder_pid, SIGKILL);
  }
  v.changed.notify_all();
  if (v.reader.joinable()) v.reader.join();
  v.open = v.closing = v.visible = false;
  v.waiting.clear();
  v.spare.clear();
  v.shown = std::vector<uint8_t>();
  v.next_number = 0;
  v.has_picture = v.picture_changed = v.pictures_done = v.failed = false;
  v.sound.clear();
  v.sound_read = 0;
  v.sound_coming = false;
  v.sound_done = true;
  v.frames_played = 0;
  v.playing = false;
  v.anchor_seconds = 0;
}

void VideoPlayer::Play() {
  Impl& v = *impl_;
  std::lock_guard<std::mutex> lock(v.mutex);
  if (!v.open || v.playing) return;
  v.playing = true;
  v.anchor_wall = SteadyClock::now();
}

void VideoPlayer::Pause() {
  Impl& v = *impl_;
  std::lock_guard<std::mutex> lock(v.mutex);
  if (!v.playing) return;
  v.anchor_seconds = v.NowLocked();
  v.playing = false;
}

void VideoPlayer::SetVolume(float volume) {
  impl_->volume = volume;
  if (impl_->audio) impl_->audio->SetStreamVolume(volume);
}

void VideoPlayer::Show(bool visible) { impl_->visible = visible; }

VideoState VideoPlayer::state() {
  Impl& v = *impl_;
  if (!v.open) return VideoState::kNone;
  std::lock_guard<std::mutex> lock(v.mutex);
  if (v.failed) return VideoState::kFailed;
  if (!v.has_picture && v.waiting.empty()) return VideoState::kLoading;
  if (v.pictures_done && v.waiting.empty() && !v.sound_coming) return VideoState::kEnded;
  return VideoState::kReady;
}

bool VideoPlayer::Picture(VideoPicture* picture) {
  Impl& v = *impl_;
  if (!v.open) return false;
  {
    std::lock_guard<std::mutex> lock(v.mutex);
    double now = v.NowLocked();
    while (!v.waiting.empty() && static_cast<double>(v.next_number) / kFramesPerSecond <= now) {
      if (v.has_picture) v.spare.push_back(std::move(v.shown));
      v.shown = std::move(v.waiting.front());
      v.waiting.pop_front();
      v.next_number++;
      v.has_picture = v.picture_changed = true;
    }
  }
  v.changed.notify_all();
  if (!v.visible || !v.has_picture) return false;
  picture->pixels = v.shown.data();
  picture->width = v.width;
  picture->height = v.height;
  picture->changed = v.picture_changed;
  v.picture_changed = false;
  return true;
}

}  // namespace mvp
