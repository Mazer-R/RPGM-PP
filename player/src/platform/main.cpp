// Entry point of the player.
//
// Usage:
//   mvplayer --game <www-dir> [--player <dir>] [--log <file>] [--run <script.js>]
//       Runs a game: loads <player-dir>/js/boot.js, which starts the game in
//       <www-dir>. The log goes to <www-dir>/save/mvplayer.log, so that
//       everything the player writes stays in the game's save folder.
//   mvplayer <script.js> [--log <file>]
//       Runs one script, for tests.
// --run adds a script that is run after the first one; tests use it to
// watch a running game.
//
// <player-dir> defaults to the folder that holds this executable.
// Exit codes: 0 clean exit, 1 the screen could not be opened or bad
// arguments, 2 a script error, otherwise the code passed to player.exit().
#include <sys/stat.h>
#include <unistd.h>

#include <climits>
#include <cstdio>
#include <string>
#include <vector>

#include "engine/host.h"
#include "platform/clock.h"
#include "platform/log.h"
#include "platform/main_loop.h"
#include "platform/window.h"

namespace {

// Folder that holds the running executable.
std::string ExecutableDir() {
  char path[PATH_MAX] = "";
  ssize_t length = readlink("/proc/self/exe", path, sizeof path - 1);
  if (length <= 0) return ".";
  std::string full(path, static_cast<size_t>(length));
  size_t slash = full.rfind('/');
  return slash == std::string::npos ? "." : full.substr(0, slash);
}

std::string WithoutTrailingSlash(std::string path) {
  while (path.size() > 1 && path.back() == '/') path.pop_back();
  return path;
}

}  // namespace

int main(int argc, char** argv) {
  std::string script, game_dir, player_dir, log_path;
  std::vector<std::string> extra_scripts;
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--log" && i + 1 < argc) log_path = argv[++i];
    else if (arg == "--run" && i + 1 < argc) extra_scripts.push_back(argv[++i]);
    else if (arg == "--game" && i + 1 < argc) game_dir = WithoutTrailingSlash(argv[++i]);
    else if (arg == "--player" && i + 1 < argc) player_dir = WithoutTrailingSlash(argv[++i]);
    else if (script.empty()) script = arg;
  }
  if (player_dir.empty()) player_dir = ExecutableDir();
  if (script.empty() && !game_dir.empty()) script = player_dir + "/js/boot.js";
  if (script.empty()) {
    std::fprintf(stderr, "usage: mvplayer --game <www-dir> [--player <dir>] [--log <file>]\n"
                         "       mvplayer <script.js> [--log <file>]\n");
    return 1;
  }
  if (log_path.empty()) {
    if (game_dir.empty()) {
      log_path = "mvplayer.log";
    } else {
      // The save folder is the one place inside the game the player writes to.
      mkdir((game_dir + "/save").c_str(), 0755);
      log_path = game_dir + "/save/mvplayer.log";
    }
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
    host.InstallBindings(window.width(), window.height());
    host.SetDirectories(game_dir, player_dir);
    bool started = host.RunFile(script);
    for (const std::string& extra : extra_scripts) {
      if (started) started = host.RunFile(extra);
    }
    exit_code = mvp::RunMainLoop(window, host, clock, log);
    log.Write(mvp::LogLevel::kInfo, "host", host.HeapSummary());
  }
  log.Write(mvp::LogLevel::kInfo, "main", "exit code " + std::to_string(exit_code));
  return exit_code;
}
