// Video playback, through the ffmpeg program of the machine the player runs
// on.
//
// The player has no video decoder of its own. To play a video it starts
// ffmpeg as a separate program and reads what it writes: the pictures, already
// scaled to the size asked for, as plain RGBA frames at a fixed 30 per
// second, and the sound as plain samples at the sound output's rate. Nothing
// is linked against, so any ffmpeg will do; a machine without one simply has
// no video (see available()).
//
// The sound goes to the sound output as a stream, and the pictures follow
// the sound: the picture shown is the one that belongs to the sound being
// played. A video without sound, or a machine without sound, follows the
// clock instead.
//
// Open, Play, Pause, Close, Show, state and Picture must be called from one
// thread.
#pragma once

#include <cstdint>
#include <memory>
#include <string>

namespace mvp {

class AudioOutput;

// The numbers are what the scripts see (player.video.state()).
enum class VideoState {
  kNone = 0,     // nothing open
  kLoading = 1,  // opened, no picture yet
  kReady = 2,    // has a picture; playing or waiting to
  kEnded = 3,    // every picture shown and all the sound played
  kFailed = 4,   // the file gave no picture at all
};

struct VideoPicture {
  const uint8_t* pixels = nullptr;  // RGBA, top row first; valid until the next call on the player
  int width = 0;
  int height = 0;
  bool changed = false;  // different from the one the last call gave
};

class VideoPlayer {
 public:
  // `audio` may be null: videos then play without sound.
  explicit VideoPlayer(AudioOutput* audio);
  ~VideoPlayer();
  VideoPlayer(const VideoPlayer&) = delete;
  VideoPlayer& operator=(const VideoPlayer&) = delete;

  // The ffmpeg program that will be used: $MVPLAYER_FFMPEG if set, else the
  // first "ffmpeg" on the PATH. Empty when there is none.
  static std::string FindDecoder();
  bool available() const;

  // Starts reading `path`, to be shown fitted inside width x height with its
  // proportions kept. Returns false if there is no decoder or no such file.
  // The video waits at its first picture until Play.
  bool Open(const std::string& path, int width, int height);
  void Play();
  void Pause();
  void Close();
  void SetVolume(float volume);
  // Whether Picture should give the picture at all. Off after Open.
  void Show(bool visible);
  VideoState state();

  // Moves the video on to the present moment. Returns true, and fills
  // `picture`, when there is a picture to show.
  bool Picture(VideoPicture* picture);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace mvp
