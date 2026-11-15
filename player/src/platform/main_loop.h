// The main loop: window events, the scripts' frame callbacks, then present.
// Later stages add input, timers and finished loads before the callbacks.
#pragma once

namespace mvp {

class Clock;
class Host;
class Input;
class Log;
class Window;

// Runs until a script asks to exit, the system asks to quit, a termination
// signal arrives, or there is nothing left that could ever run. Returns the
// process exit code.
int RunMainLoop(Window& window, Input& input, Host& host, const Clock& clock, Log& log);

}  // namespace mvp
