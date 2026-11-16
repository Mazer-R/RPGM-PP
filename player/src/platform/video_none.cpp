// The video player of a system where no ffmpeg program can be started
// (Android): there is no video, and the scripts see no player.video.
#include "platform/video.h"

namespace mvp {

struct VideoPlayer::Impl {};

VideoPlayer::VideoPlayer(AudioOutput*) {}
VideoPlayer::~VideoPlayer() = default;
std::string VideoPlayer::FindDecoder() { return std::string(); }
bool VideoPlayer::available() const { return false; }
bool VideoPlayer::Open(const std::string&, int, int) { return false; }
void VideoPlayer::Play() {}
void VideoPlayer::Pause() {}
void VideoPlayer::Close() {}
void VideoPlayer::SetVolume(float) {}
void VideoPlayer::Show(bool) {}
VideoState VideoPlayer::state() { return VideoState::kNone; }
bool VideoPlayer::Picture(VideoPicture*) { return false; }

}  // namespace mvp
