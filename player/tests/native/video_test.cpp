// Tests for platform/video: playing a video through a decoder program.
// Built and run by tools/build/test.sh.
//
// The real decoder is the machine's ffmpeg. Here its place is taken by a
// small shell script that writes what ffmpeg would: pictures of 4x2 pixels,
// each filled with one letter ('A' for the first, 'B' for the second...), on
// its standard output, and sound on output number 3 when asked for it. The
// script's behaviour is chosen by $FAKE_VIDEO.
#include <sys/stat.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#include "platform/audio.h"
#include "platform/video.h"

namespace {

int g_failures = 0;

void Expect(const std::string& what, const std::string& got, const std::string& wanted) {
  bool ok = got == wanted;
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) {
    std::printf("       got    %s\n       wanted %s\n", got.c_str(), wanted.c_str());
    g_failures++;
  }
}
void Expect(const std::string& what, bool ok) { Expect(what, ok ? "yes" : "no", "yes"); }

const char* kDecoderScript = R"(#!/bin/sh
# Stands in for ffmpeg in video_test. One picture is 4x2 pixels of 4 bytes.
SOUND=no
case "$*" in *pipe:3*) SOUND=yes ;; esac
pictures() {
  for LETTER in $1; do printf "$LETTER%.0s" 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32; done
}
case "$FAKE_VIDEO" in
  broken) exit 1 ;;
  silent)
    # As ffmpeg does when asked for the sound of a video without any.
    [ "$SOUND" = yes ] && exit 1
    pictures "A B C" ;;
  sound)
    # Ten pictures (a third of a second) and as much sound: 13230 frames of
    # 4 bytes at 44100 per second, each frame the letters "wxyz".
    [ "$SOUND" = yes ] && { i=0; while [ $i -lt 1323 ]; do printf 'wxyzwxyzwxyzwxyzwxyzwxyzwxyzwxyzwxyzwxyz' >&3; i=$((i+1)); done; exec 3>&-; }
    pictures "A B C D E F G H I J" ;;
  libraries)
    # Gives a picture only if it was started with the libraries of the
    # system, not with the ones the player's package puts first.
    [ "$LD_LIBRARY_PATH" = "$WANTED_LIBRARIES" ] || exit 1
    pictures "A" ;;
  endless)
    while :; do pictures "A B C D E F G H" || exit 0; done ;;
esac
)";

std::string WriteDecoder() {
  std::string path = "/tmp/potato-player-video-test-decoder-" + std::to_string(getpid()) + ".sh";
  std::ofstream(path) << kDecoderScript;
  chmod(path.c_str(), 0755);
  return path;
}

// A sound output that only remembers the stream it was given; the test
// plays the part of the sound thread by asking the stream for sound itself.
class FakeAudio : public mvp::AudioOutput {
 public:
  std::string Description() const override { return "fake"; }
  int Rate() const override { return 44100; }
  void SetStream(mvp::SoundStream* stream) override { this->stream = stream; }
  void SetStreamVolume(float volume) override { this->volume = volume; }
  bool Info(const std::string&, mvp::SoundInfo*) override { return false; }
  int Play(const std::string&, const mvp::PlayOptions&) override { return 0; }
  void Stop(int) override {}
  void SetVolume(int, float, double) override {}
  void SetPan(int, float) override {}
  bool IsPlaying(int) override { return false; }
  float TakePeak() override { return 0; }
  mvp::SoundStream* stream = nullptr;
  float volume = -1;
};

void Sleep(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

// Waits, for two seconds at most, until the video is no longer loading.
mvp::VideoState Loaded(mvp::VideoPlayer& video) {
  for (int i = 0; i < 200 && video.state() == mvp::VideoState::kLoading; i++) Sleep(10);
  return video.state();
}

// The letter the picture being shown is filled with, "-" when there is none.
std::string Letter(mvp::VideoPlayer& video) {
  mvp::VideoPicture picture;
  if (!video.Picture(&picture)) return "-";
  if (picture.width != 4 || picture.height != 2) return "wrong size";
  return std::string(1, static_cast<char>(picture.pixels[0])) + std::string(1, static_cast<char>(picture.pixels[31]));
}

std::string StateName(mvp::VideoState state) {
  const char* names[] = {"none", "loading", "ready", "ended", "failed"};
  return names[static_cast<int>(state)];
}

const std::string kFile = "/bin/sh";  // any file that exists: the fake decoder never reads it

void TestWithoutDecoder() {
  setenv("POTATO_PLAYER_FFMPEG", "/nowhere/ffmpeg", 1);
  mvp::VideoPlayer video(nullptr);
  Expect("no decoder program: video is not available", !video.available());
  Expect("no decoder program: nothing opens", !video.Open(kFile, 4, 2));
  Expect("no decoder program: state", StateName(video.state()), "none");
}

void TestSilentVideo(const std::string& decoder) {
  setenv("POTATO_PLAYER_FFMPEG", decoder.c_str(), 1);
  setenv("FAKE_VIDEO", "silent", 1);
  mvp::VideoPlayer video(nullptr);
  Expect("a decoder program makes video available", video.available());
  Expect("a missing file does not open", !video.Open("/nowhere/video.webm", 4, 2));
  Expect("silent video: opens", video.Open(kFile, 4, 2));
  Expect("silent video: gets its first picture", StateName(Loaded(video)), "ready");
  Expect("silent video: nothing is given while hidden", Letter(video), "-");
  video.Show(true);
  Expect("silent video: waits at the first picture until played", Letter(video), "AA");
  Sleep(120);
  Expect("silent video: still waiting", Letter(video), "AA");
  video.Play();
  Sleep(150);  // three pictures at 30 per second are over after 100 ms
  Expect("silent video: the last picture is shown at the end", Letter(video), "CC");
  Expect("silent video: has ended", StateName(video.state()), "ended");
  video.Close();
  Expect("silent video: closed", StateName(video.state()), "none");
}

void TestVideoWithoutSoundOnAMachineWithSound(const std::string& decoder) {
  setenv("POTATO_PLAYER_FFMPEG", decoder.c_str(), 1);
  setenv("FAKE_VIDEO", "silent", 1);
  FakeAudio audio;
  mvp::VideoPlayer video(&audio);
  video.Open(kFile, 4, 2);
  Expect("video without a sound track: is read again without sound", StateName(Loaded(video)), "ready");
  video.Show(true);
  video.Play();
  Sleep(150);
  Expect("video without a sound track: plays by the clock", Letter(video), "CC");
  Expect("video without a sound track: has ended", StateName(video.state()), "ended");
}

void TestVideoWithSound(const std::string& decoder) {
  setenv("POTATO_PLAYER_FFMPEG", decoder.c_str(), 1);
  setenv("FAKE_VIDEO", "sound", 1);
  FakeAudio audio;
  mvp::VideoPlayer video(&audio);
  video.SetVolume(0.5f);
  video.Open(kFile, 4, 2);
  Expect("video with sound: gives its sound to the output", audio.stream != nullptr);
  Expect("video with sound: at the volume set", audio.volume == 0.5f);
  Expect("video with sound: gets its first picture", StateName(Loaded(video)), "ready");
  video.Show(true);

  std::vector<int16_t> heard(2 * 20000);
  Expect("video with sound: no sound before it is played", audio.stream->Read(heard.data(), 100) == 0);
  video.Play();
  // No sound is being taken, as when the sound output stalls: the pictures
  // must not run on to the end (the last, J, is due at 300 ms).
  Sleep(400);
  std::string stalled = Letter(video);
  Expect("video with sound: pictures wait for the sound (showing " + stalled + ")", stalled >= "AA" && stalled <= "EE");
  Expect("video with sound: not ended while sound is left", StateName(video.state()), "ready");

  // The sound thread now takes all the sound, in blocks as it would.
  int total = 0;
  for (int i = 0; i < 400 && total < 13230; i++) {
    int got = audio.stream->Read(heard.data() + total * 2, 1024);
    total += got;
    mvp::VideoPicture unused;
    video.Picture(&unused);  // keeps the pictures moving, as the main loop does
    if (got == 0) Sleep(5);
  }
  Expect("video with sound: all the sound arrives", std::to_string(total), "13230");
  const char* bytes = reinterpret_cast<const char*>(heard.data());
  Expect("video with sound: the sound is the file's", std::string(bytes, 8) + std::string(bytes + 13229 * 4, 4), "wxyzwxyzwxyz");
  audio.stream->Read(heard.data(), 1024);  // one more request finds it played out
  Sleep(50);
  Expect("video with sound: the last picture is shown", Letter(video), "JJ");
  Expect("video with sound: has ended", StateName(video.state()), "ended");
  video.Close();
  Expect("video with sound: the output is given its stream back", audio.stream == nullptr);
}

void TestBrokenVideo(const std::string& decoder) {
  setenv("POTATO_PLAYER_FFMPEG", decoder.c_str(), 1);
  setenv("FAKE_VIDEO", "broken", 1);
  mvp::VideoPlayer video(nullptr);
  video.Open(kFile, 4, 2);
  Expect("a video the decoder cannot read: failed", StateName(Loaded(video)), "failed");
}

void TestClosingEarly(const std::string& decoder) {
  setenv("POTATO_PLAYER_FFMPEG", decoder.c_str(), 1);
  setenv("FAKE_VIDEO", "endless", 1);
  FakeAudio audio;
  mvp::VideoPlayer video(&audio);
  video.Open(kFile, 4, 2);
  video.Close();
  Expect("closing at once: closed", StateName(video.state()), "none");
  video.Open(kFile, 4, 2);
  Loaded(video);
  video.Show(true);
  video.Play();
  Sleep(100);
  video.Close();
  Expect("closing while playing: closed", StateName(video.state()), "none");
  setenv("FAKE_VIDEO", "silent", 1);
  video.Open(kFile, 4, 2);
  Expect("another video opens after a close", StateName(Loaded(video)), "ready");
  video.Show(true);
  Expect("another video starts at its own first picture", Letter(video), "AA");
}

// On Android the decoder comes inside the app's package, next to the
// player's own library, as libffmpeg.so: the only folder an app may start
// programs from.
void TestDecoderBesideThePlayer(const std::string& decoder) {
  std::string folder = "/tmp/potato-player-video-test-lib-" + std::to_string(getpid());
  mkdir(folder.c_str(), 0755);
  Expect("no decoder beside the player: none", mvp::VideoPlayer::DecoderBeside(folder + "/libmain.so"), "");
  std::string beside = folder + "/libffmpeg.so";
  symlink(decoder.c_str(), beside.c_str());
  Expect("a decoder beside the player is found", mvp::VideoPlayer::DecoderBeside(folder + "/libmain.so"), beside);
  Expect("a file without a folder has nothing beside it", mvp::VideoPlayer::DecoderBeside("libmain.so"), "");
  unlink(beside.c_str());
  rmdir(folder.c_str());
}

// The Linux package starts the player with its own copies of some libraries
// first in the search path. The decoder is the system's program and must
// get the search path the package's start script found, not the player's.
void TestDecoderGetsTheSystemsLibraries(const std::string& decoder) {
  setenv("POTATO_PLAYER_FFMPEG", decoder.c_str(), 1);
  setenv("FAKE_VIDEO", "libraries", 1);
  setenv("LD_LIBRARY_PATH", "/package/lib:/system/extra", 1);

  setenv("POTATO_PLAYER_SYSTEM_LIBRARY_PATH", "/system/extra", 1);
  setenv("WANTED_LIBRARIES", "/system/extra", 1);
  {
    mvp::VideoPlayer video(nullptr);
    video.Open(kFile, 4, 2);
    Expect("decoder libraries: the search path from before the package", StateName(Loaded(video)), "ready");
  }
  setenv("POTATO_PLAYER_SYSTEM_LIBRARY_PATH", "", 1);
  setenv("WANTED_LIBRARIES", "", 1);
  {
    mvp::VideoPlayer video(nullptr);
    video.Open(kFile, 4, 2);
    Expect("decoder libraries: no search path when there was none", StateName(Loaded(video)), "ready");
  }
  unsetenv("POTATO_PLAYER_SYSTEM_LIBRARY_PATH");
  setenv("WANTED_LIBRARIES", "/package/lib:/system/extra", 1);
  {
    mvp::VideoPlayer video(nullptr);
    video.Open(kFile, 4, 2);
    Expect("decoder libraries: unchanged when the player was started directly", StateName(Loaded(video)), "ready");
  }
  unsetenv("LD_LIBRARY_PATH");
}

}  // namespace

int main() {
  std::string decoder = WriteDecoder();
  TestWithoutDecoder();
  TestSilentVideo(decoder);
  TestVideoWithoutSoundOnAMachineWithSound(decoder);
  TestVideoWithSound(decoder);
  TestBrokenVideo(decoder);
  TestClosingEarly(decoder);
  TestDecoderGetsTheSystemsLibraries(decoder);
  TestDecoderBesideThePlayer(decoder);
  unlink(decoder.c_str());
  std::printf("%s\n", g_failures ? "video_test: FAILED" : "video_test: all passed");
  return g_failures ? 1 : 0;
}
