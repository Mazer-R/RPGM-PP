#include "platform/main_loop.h"

#include <csignal>
#include <string>

#include "bindings/webgl_binding.h"
#include "engine/host.h"
#include "platform/clock.h"
#include "platform/log.h"
#include "platform/window.h"

namespace mvp {

namespace {
volatile std::sig_atomic_t g_terminate = 0;
void OnTerminate(int) { g_terminate = 1; }
}  // namespace

int RunMainLoop(Window& window, Host& host, const Clock& clock, Log& log) {
  std::signal(SIGTERM, OnTerminate);
  std::signal(SIGINT, OnTerminate);

  long frames = 0;
  double started = clock.NowMs();
  bool idle = false;
  while (!host.exit_requested() && !g_terminate) {
    if (!window.PumpEvents()) break;
    // Frame callbacks are the only source of work so far. When none is
    // waiting, nothing can run again, so the loop ends instead of presenting
    // empty frames for ever (for example after a script failed while loading).
    if (!host.has_pending_frames()) {
      idle = true;
      break;
    }
    // Cleared first, so whatever the scripts draw this frame is what shows.
    const float* colour = host.clear_color();
    window.Clear(colour[0], colour[1], colour[2]);
    host.RunFrameCallbacks(clock.NowMs());
    window.Swap();
    frames++;
  }
  double seconds = (clock.NowMs() - started) / 1000.0;
  long gl_calls = TakeWebGLCallCount();
  if (gl_calls > 0 && frames > 0) {
    log.Write(LogLevel::kInfo, "loop", "WebGL calls: " + std::to_string(gl_calls) + " in total, " +
                                           std::to_string(gl_calls / frames) + " per frame");
  }
  log.Write(LogLevel::kInfo, "loop",
            std::to_string(frames) + " frames in " + std::to_string(seconds) + " s" +
                (g_terminate ? " (stopped by a signal)" : "") +
                (idle ? " (nothing left to run)" : ""));
  if (host.had_script_error()) return 2;
  return host.exit_code();
}

}  // namespace mvp
