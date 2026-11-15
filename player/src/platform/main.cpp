// Entry point of the player.
//
// Usage: mvplayer <script.js> [--log <file>]
//
// First-stage behaviour: open the screen, start V8, run the given script and
// keep presenting frames until the script calls player.exit(). Exit codes:
// 0 clean exit, 1 the screen could not be opened or bad arguments, 2 a script
// error, otherwise the code passed to player.exit().
#include <cstdio>
#include <string>

#include "engine/host.h"
#include "platform/clock.h"
#include "platform/log.h"
#include "platform/main_loop.h"
#include "platform/window.h"

int main(int argc, char** argv) {
  std::string script;
  std::string log_path = "mvplayer.log";
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--log" && i + 1 < argc) {
      log_path = argv[++i];
    } else if (script.empty()) {
      script = arg;
    }
  }
  if (script.empty()) {
    std::fprintf(stderr, "usage: mvplayer <script.js> [--log <file>]\n");
    return 1;
  }

  mvp::Clock clock;
  mvp::Log log(log_path, clock, 4 * 1024 * 1024);
  if (!log.ok()) std::fprintf(stderr, "warning: cannot open log file %s\n", log_path.c_str());

  mvp::Window window;
  std::string error;
  if (!window.Open(&error)) {
    log.Write(mvp::LogLevel::kError, "window", error);
    return 1;
  }
  log.Write(mvp::LogLevel::kInfo, "window", window.DriverDescription());

  int exit_code;
  {
    mvp::Host host(log, clock);
    log.Write(mvp::LogLevel::kInfo, "host", std::string("V8 ") + v8::V8::GetVersion());
    host.RunFile(script);
    exit_code = mvp::RunMainLoop(window, host, clock, log);
    log.Write(mvp::LogLevel::kInfo, "host", host.HeapSummary());
  }
  log.Write(mvp::LogLevel::kInfo, "main", "exit code " + std::to_string(exit_code));
  return exit_code;
}
