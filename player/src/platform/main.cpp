// Entry point of the player.
//
// Usage:
//   mvplayer --game <path> [--player <dir>] [--log <file>] [--run <script.js>]
//       Runs a game: loads <player-dir>/js/boot.js, which starts the game in
//       <www-dir>. The log goes to <www-dir>/save/mvplayer.log, so that
//       everything the player writes stays in the game's save folder.
//   mvplayer --pick [<games-dir> ...] [--games-file <file>] [--can-add]
//       Shows a list of games and lets the user choose one: the games found
//       in the given folders (each game is a folder that holds the game's
//       www folder) and the games named in <file>, one path per line. Prints
//       "MVPLAYER_GAME=<www-dir>" on standard output and exits with 0, or
//       exits with 10 if the user leaves without choosing. With --can-add the
//       list has an "add a game" line, which prints "MVPLAYER_ADD". The
//       program that started the player then acts on what was printed.
//   mvplayer --resolve <path>
//       Prints the game's www folder for <path> and exits with 0, or exits
//       with 1 if there is no game there. Opens no window.
//
// A game's <path> may be its www folder (the one with index.html), the
// folder that holds www, or any file directly inside either, such as the
// game's .exe.
//   mvplayer <script.js> [--log <file>]
//       Runs one script, for tests.
// --no-patches runs the game without the per-game patches in patches/.
// --fps starts with the frame-rate display on (also MVPLAYER_FPS=1). It can
// be switched while playing: F2, or the console's menu button plus Select.
// --run adds a script that is run after the first one; tests use it to
// watch a running game.
//
// <player-dir> defaults to the folder that holds this executable.
// Exit codes: 0 clean exit, 1 the screen could not be opened or bad
// arguments, 2 a script error, otherwise the code passed to player.exit().
#include "platform/main.h"

#include <malloc.h>
#include <sys/stat.h>
#include <unistd.h>

#include <climits>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "engine/host.h"
#include "platform/audio.h"
#include "platform/video.h"
#include "platform/clock.h"
#include "platform/input.h"
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

bool IsFile(const std::string& path) {
  struct stat info {};
  return stat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode);
}

// The www folder of the game at `path`, or "" if there is none. See the
// forms of <path> listed at the top of this file.
std::string ResolveGameDir(std::string path) {
  while (path.size() > 1 && path.back() == '/') path.pop_back();
  if (IsFile(path)) {
    size_t slash = path.rfind('/');
    path = slash == std::string::npos ? "." : path.substr(0, slash);
  }
  for (const std::string& candidate : {path, path + "/www"}) {
    if (IsFile(candidate + "/index.html") && IsFile(candidate + "/js/rpg_core.js")) return candidate;
  }
  return "";
}

std::string WithoutTrailingSlash(std::string path) {
  while (path.size() > 1 && path.back() == '/') path.pop_back();
  return path;
}

}  // namespace

namespace mvp {

int PlayerMain(int argc, char** argv) {
#ifdef __GLIBC__
  // Pixel buffers are large and short-lived. By default the C library starts
  // keeping freed large blocks for reuse instead of returning them to the
  // system, and the process only ever grows. A fixed threshold makes every
  // block of 64 KB or more its own mapping, returned as soon as it is freed.
  // Android's C library has no such setting and returns large blocks itself.
  mallopt(M_MMAP_THRESHOLD, 64 * 1024);
#endif
  std::string script, game_dir, player_dir, log_path;
  std::vector<std::string> extra_scripts;
  bool no_patches = false;
  bool pick = false;
  std::vector<std::string> library_dirs, library_games;
  std::string game_path, games_file, resolve_path;
  bool can_add = false;
  const char* fps_setting = std::getenv("MVPLAYER_FPS");
  bool show_fps = fps_setting && fps_setting[0] == '1';
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--log" && i + 1 < argc) log_path = argv[++i];
    else if (arg == "--run" && i + 1 < argc) extra_scripts.push_back(argv[++i]);
    else if (arg == "--no-patches") no_patches = true;
    else if (arg == "--pick") {
      pick = true;
      while (i + 1 < argc && argv[i + 1][0] != '-') library_dirs.push_back(WithoutTrailingSlash(argv[++i]));
    }
    else if (arg == "--games-file" && i + 1 < argc) games_file = argv[++i];
    else if (arg == "--can-add") can_add = true;
    else if (arg == "--fps") show_fps = true;
    else if (arg == "--resolve" && i + 1 < argc) resolve_path = argv[++i];
    else if (arg == "--game" && i + 1 < argc) game_path = argv[++i];
    else if (arg == "--player" && i + 1 < argc) player_dir = WithoutTrailingSlash(argv[++i]);
    else if (script.empty()) script = arg;
  }
  if (!resolve_path.empty()) {
    std::string found = ResolveGameDir(resolve_path);
    if (found.empty()) return 1;
    std::printf("%s\n", found.c_str());
    return 0;
  }
  if (!game_path.empty()) {
    game_dir = ResolveGameDir(game_path);
    if (game_dir.empty()) {
      std::fprintf(stderr,
                   "mvplayer: no RPG Maker MV game at %s\n"
                   "Give the game's www folder (the one with index.html), the folder that holds\n"
                   "it, or the game's .exe.\n",
                   game_path.c_str());
      return 1;
    }
  }
  if (!games_file.empty()) {
    // Lines that no longer lead to a game are left out of the list.
    std::ifstream list(games_file);
    for (std::string line; std::getline(list, line);) {
      std::string found = line.empty() ? "" : ResolveGameDir(line);
      if (!found.empty()) library_games.push_back(found);
    }
  }
  if (player_dir.empty()) player_dir = ExecutableDir();
  if (script.empty() && !game_dir.empty()) script = player_dir + "/js/boot.js";
  if (script.empty() && pick) {
    script = player_dir + "/js/picker.js";
    if (log_path.empty()) log_path = "/tmp/mvplayer-picker.log";
  }
  if (script.empty()) {
    std::fprintf(stderr, "usage: mvplayer --game <game folder, www folder or .exe> [--log <file>]\n"
                         "       mvplayer --pick [<games-dir> ...] [--games-file <file>] [--can-add]\n"
                         "       mvplayer --resolve <path>\n"
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

  // The previous run's log is kept under a second name, so that a problem
  // can still be read after the player has been started again.
  std::rename(log_path.c_str(), (log_path + ".1").c_str());

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

  mvp::Input input(log);
  input.Open();
  input.SetScreenSize(window.width(), window.height());
  // Each game keeps its own controls, next to its saves.
  if (!game_dir.empty()) {
    mkdir((game_dir + "/save").c_str(), 0755);
    input.SetSettingsDir(game_dir + "/save");
  }

  // Declared before the engine, so it outlives it.
  std::unique_ptr<mvp::AudioOutput> audio = mvp::CreateAudioOutput(log);
  log.Write(mvp::LogLevel::kInfo, "audio", audio ? audio->Description() : "silent");
  // After the sound output, which it plays through; before the engine.
  mvp::VideoPlayer video(audio.get());
  log.Write(mvp::LogLevel::kInfo, "video",
            video.available() ? "through " + mvp::VideoPlayer::FindDecoder() : "none: no ffmpeg program found");

  int exit_code;
  {
    mvp::Host host(log, clock);
    log.Write(mvp::LogLevel::kInfo, "host", std::string("V8 ") + v8::V8::GetVersion());
    host.InstallBindings(window.width(), window.height(), audio.get(), video.available() ? &video : nullptr);
    host.SetDirectories(game_dir, player_dir);
    host.SetFlag("noPatches", no_patches);
    host.SetStringList("libraryDirs", library_dirs);
    host.SetStringList("libraryGames", library_games);
    host.SetFlag("canAddGame", can_add);
#ifdef __ANDROID__
    // The game list then explains the permission the games folder needs.
    host.SetFlag("needsFileAccess", true);
#endif
    host.SetFlag("showFps", show_fps);
    bool started = host.RunFile(script);
    for (const std::string& extra : extra_scripts) {
      if (started) started = host.RunFile(extra);
    }
    exit_code = mvp::RunMainLoop(window, input, host, clock, log, video);
    video.Close();
    log.Write(mvp::LogLevel::kInfo, "host", host.HeapSummary());
  }
  log.Write(mvp::LogLevel::kInfo, "main", "exit code " + std::to_string(exit_code));
  return exit_code;
}

}  // namespace mvp

// On Android the program is started by platform/android_start.cpp instead.
#ifndef __ANDROID__
int main(int argc, char** argv) { return mvp::PlayerMain(argc, argv); }
#endif
