// Video for the scripts: player.video, a thin layer over the video player.
// It exists only on a machine that can play video (see platform/video.h).
//
//   player.video.open(path, width, height) -> true if the file was opened
//   player.video.play()
//   player.video.pause()
//   player.video.close()
//   player.video.setVolume(volume)         0 to 1
//   player.video.show(visible)             whether the picture covers the game
//   player.video.state()                   -> 0 nothing open, 1 loading,
//                                             2 ready, 3 ended, 4 failed
#pragma once

#include "v8.h"

namespace mvp {

class VideoPlayer;

// Adds `video` to the player object. `video_player` must outlive the engine.
void InstallVideoBinding(v8::Isolate* isolate, v8::Local<v8::Context> context,
                         v8::Local<v8::Object> player, VideoPlayer* video_player);

}  // namespace mvp
