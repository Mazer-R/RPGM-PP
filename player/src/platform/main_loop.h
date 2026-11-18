// The main loop: window events and input, the scripts' frame callbacks,
// then the touch controls and the settings menu over the picture, and
// present.
#pragma once

namespace mvp {

class Clock;
class Host;
class Input;
class Log;
class VideoPlayer;
class Window;

// Runs until a script asks to exit, the system asks to quit, a termination
// signal arrives, or there is nothing left that could ever run. Returns the
// process exit code.
// A video that is playing and shown takes the place of the game's picture.
// `frames_shown`, when given, receives the number of frames presented.
int RunMainLoop(Window& window, Input& input, Host& host, const Clock& clock, Log& log, VideoPlayer& video,
                long* frames_shown = nullptr);

}  // namespace mvp
