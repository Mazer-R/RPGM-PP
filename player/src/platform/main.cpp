// Entry point of the player.
//
// Usage:
//   potato-player --game <path> [--player <dir>] [--log <file>] [--run <script.js>]
//       Runs a game: loads <player-dir>/js/boot.js, which starts the game in
//       <www-dir>. The log goes to <www-dir>/save/potato-player.log, so that
//       everything the player writes stays in the game's save folder.
//   potato-player --pick [<games-dir> ...] [--games-file <file>] [--can-add] [--browse <dir> ...]
//       Shows a list of games and lets the user choose one: the games found
//       in the given folders (each game is a folder that holds the game's
//       www folder) and the games named in <file>, one path per line. Prints
//       "POTATO_PLAYER_GAME=<www-dir>" on standard output and exits with 0, or
//       exits with 10 if the user leaves without choosing. The program that
//       started the player then runs the game. <file> is the list's own
//       memory: the game chosen goes to its top, so the games played last
//       are shown first. With --can-add the list has an "add a game" line
//       that lets the user look through folders, starting from each
//       --browse <dir> (from "/" if none is given), for a game to add to
//       <file>.
//   potato-player --resolve <path>
//       Prints the game's www folder for <path> and exits with 0, or exits
//       with 1 if there is no game there. Opens no window.
//
// A game's <path> may be its www folder (the one with index.html), the
// folder that holds www, or any file directly inside either, such as the
// game's .exe.
//   potato-player <script.js> [--log <file>]
//       Runs one script, for tests.
// --no-patches runs the game without the per-game patches in patches/.
// --fps starts with the frame-rate display on (also POTATO_PLAYER_FPS=1). It can
// be switched while playing: F2, or the console's menu button plus Select.
// --profile-slow samples where the scripts spend their time after a slow
// stretch of play and logs it; starting the sampler stops the game for
// more than a second on a handheld, so it is for looking into a game.
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
#include <ctime>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "engine/host.h"
#include "platform/audio.h"
#include "platform/game_library.h"
#include "platform/video.h"
#include "platform/clock.h"
#include "platform/input.h"
#include "platform/log.h"
#include "platform/main_loop.h"
#include "platform/session.h"
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
  bool profile_slow = false;
  bool pick = false;
  std::vector<std::string> library_dirs, library_games, forgotten_games, browse_dirs;
  std::string game_path, games_file, resolve_path, sessions_file;
  bool can_add = false;
  const char* fps_setting = std::getenv("POTATO_PLAYER_FPS");
  bool show_fps = fps_setting && fps_setting[0] == '1';
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--log" && i + 1 < argc) log_path = argv[++i];
    else if (arg == "--run" && i + 1 < argc) extra_scripts.push_back(argv[++i]);
    else if (arg == "--no-patches") no_patches = true;
    else if (arg == "--profile-slow") profile_slow = true;
    else if (arg == "--pick") {
      pick = true;
      while (i + 1 < argc && argv[i + 1][0] != '-') library_dirs.push_back(WithoutTrailingSlash(argv[++i]));
    }
    else if (arg == "--games-file" && i + 1 < argc) games_file = argv[++i];
    else if (arg == "--sessions" && i + 1 < argc) sessions_file = argv[++i];
    else if (arg == "--can-add") can_add = true;
    else if (arg == "--browse" && i + 1 < argc) browse_dirs.push_back(WithoutTrailingSlash(argv[++i]));
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
                   "potato-player: no RPG Maker MV or MZ game at %s\n"
                   "Give the game's www folder (the one with index.html), the folder that holds\n"
                   "it, or the game's .exe.\n",
                   game_path.c_str());
      return 1;
    }
  }
  if (!games_file.empty()) {
    // Lines that no longer lead to a game are left out of the list, and so
    // are the games taken off it.
    std::ostringstream text;
    text << std::ifstream(games_file).rdbuf();
    std::istringstream list(text.str());
    for (std::string line; std::getline(list, line);) {
      std::string found = line.empty() || line[0] == '-' ? "" : ResolveGameDir(line);
      if (!found.empty()) library_games.push_back(found);
    }
    forgotten_games = ForgottenGames(text.str());
  }
  if (player_dir.empty()) player_dir = ExecutableDir();
  if (script.empty() && !game_dir.empty()) script = player_dir + "/js/boot.js";
  if (script.empty() && pick) {
    script = player_dir + "/js/picker.js";
    if (log_path.empty()) log_path = "/tmp/potato-player-picker.log";
  }
  if (script.empty()) {
    std::fprintf(stderr, "usage: potato-player --game <game folder, www folder or .exe> [--log <file>]\n"
                         "       potato-player --pick [<games-dir> ...] [--games-file <file>] [--can-add] [--browse <dir> ...]\n"
                         "       (--sessions <file> with --game: add a line about the run to that file when it ends)\n"
                         "       potato-player --resolve <path>\n"
                         "       potato-player <script.js> [--log <file>]\n");
    return 1;
  }
  if (log_path.empty()) {
    if (game_dir.empty()) {
      log_path = "potato-player.log";
    } else {
      // The save folder is the one place inside the game the player writes to.
      mkdir((game_dir + "/save").c_str(), 0755);
      log_path = game_dir + "/save/potato-player.log";
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
  // The game list is touched directly; games get the on-screen controls.
  input.SetPointerMode(pick);
  input.SetFpsShown(show_fps);
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

  // What this run of a game notes about itself, for the profile.
  mvp::Session session;
  const mvp::SessionTime begun = mvp::LocalSessionTime(time(nullptr));
  const bool noted = !game_dir.empty() && !sessions_file.empty();
  if (noted) input.SetSession(&session);
  // The profile is kept next to the list of games, with the log of runs.
  std::string profile_dir = games_file.substr(0, games_file.find_last_of('/') == std::string::npos ? 0 : games_file.find_last_of('/'));

  int exit_code;
  long frames_shown = 0;
  double loop_started_ms = 0;
  {
    mvp::Host host(log, clock);
    log.Write(mvp::LogLevel::kInfo, "host", std::string("V8 ") + v8::V8::GetVersion());
    host.InstallBindings(window.width(), window.height(), audio.get(), video.available() ? &video : nullptr);
    host.SetDirectories(game_dir, player_dir);
    host.SetFlag("noPatches", no_patches);
    host.SetFlag("screenResizable", window.resizable());
    host.SetFlag("profileSlow", profile_slow);
    host.SetStringList("libraryDirs", library_dirs);
    host.SetStringList("libraryGames", library_games);
    host.SetStringList("forgottenGames", forgotten_games);
    host.SetFlag("canAddGame", can_add);
    host.SetStringList("browseDirs", browse_dirs);
    host.SetGamesFile(games_file);
    if (noted) host.SetSession(&session);
    if (pick && !profile_dir.empty()) {
      host.SetProfileFile(profile_dir + "/profile.json");
      host.SetStringList("profileFiles", {profile_dir + "/profile.json", profile_dir + "/sessions.log"});
    }
#ifdef __ANDROID__
    // The game list then explains the permission the games folder needs.
    host.SetFlag("needsFileAccess", true);
#endif
    host.SetFlag("showFps", show_fps);
    bool started = host.RunFile(script);
    for (const std::string& extra : extra_scripts) {
      if (started) started = host.RunFile(extra);
    }
    loop_started_ms = clock.NowMs();
    exit_code = mvp::RunMainLoop(window, input, host, clock, log, video, &frames_shown);
    video.Close();
    log.Write(mvp::LogLevel::kInfo, "host", host.HeapSummary());
  }
  if (noted) {
    double seconds = (clock.NowMs() - loop_started_ms) / 1000.0;
    if (!mvp::AppendSessionLine(sessions_file, session.Line(begun, seconds, frames_shown, exit_code, game_dir))) {
      log.Write(mvp::LogLevel::kWarning, "main", "cannot add this run to " + sessions_file);
    }
  }
  log.Write(mvp::LogLevel::kInfo, "main", "exit code " + std::to_string(exit_code));
  return exit_code;
}

}  // namespace mvp

// On Android the program is started by platform/android_start.cpp instead.
#ifndef __ANDROID__
int main(int argc, char** argv) { return mvp::PlayerMain(argc, argv); }
#endif
