// Start of the player on Android, where there is no command line and no
// launch script: this file does what packaging/muos/mux_launch.sh does on a
// console. It shows the game list, runs the chosen game, and comes back to
// the list, all in one process.
//
// Folders:
//   <shared storage>/RPGMV/<Game>/www   the games, copied there by the user;
//       saves and the log stay in each game's www/save. The app needs the
//       "all files access" permission for this folder (see PlayerActivity).
//   <external files>/games/<Game>/www   also looked at; only the app itself
//       can write there (Android/data/<package>/files/games)
//   <shared storage>/RPGMV/mvplayer     the player's own things, where the
//       user can reach them (<external files> until access is allowed):
//         logs/      a copy of the log of every run
//         games.txt  the games played or added, the last one first, and
//                    those taken off the list
//   <external files>/args.txt           for tests: if present, one run with
//       these arguments, one per line, instead of the list. Read only from
//       the app's own folder, which other apps cannot write to: the
//       arguments can name a script to run.
//   <internal files>/player             js/ and patches/, unpacked from the
//       app's assets when the app's build stamp changes
#include <SDL.h>
#include <SDL_main.h>
#include <android/log.h>
#include <dirent.h>
#include <dlfcn.h>
#include <sys/stat.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <string>
#include <vector>

#include "platform/main.h"
#include "platform/video.h"

namespace {

void Note(const std::string& text) { __android_log_print(ANDROID_LOG_INFO, "mvplayer", "%s", text.c_str()); }

std::string ReadText(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

std::vector<std::string> Lines(const std::string& text) {
  std::vector<std::string> lines;
  size_t start = 0;
  while (start <= text.size()) {
    size_t end = text.find('\n', start);
    if (end == std::string::npos) end = text.size();
    std::string line = text.substr(start, end - start);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (!line.empty()) lines.push_back(line);
    start = end + 1;
  }
  return lines;
}

void MakeDirs(const std::string& path) {
  for (size_t slash = path.find('/', 1); ; slash = path.find('/', slash + 1)) {
    mkdir(path.substr(0, slash).c_str(), 0755);
    if (slash == std::string::npos) break;
  }
}

// One file of the app's assets as bytes; SDL reads a relative path from there.
bool ReadAsset(const std::string& name, std::string* bytes) {
  SDL_RWops* in = SDL_RWFromFile(name.c_str(), "rb");
  if (!in) return false;
  char block[16384];
  for (size_t got; (got = SDL_RWread(in, block, 1, sizeof block)) > 0;) bytes->append(block, got);
  SDL_RWclose(in);
  return true;
}

// Unpacks js/ and patches/ to `player_dir` unless the files already there are
// from this build. assets/manifest.txt, written by the packaging script, has
// the build stamp on its first line and then one file path per line.
bool UnpackPlayerFiles(const std::string& player_dir) {
  std::string manifest;
  if (!ReadAsset("manifest.txt", &manifest)) return false;
  std::vector<std::string> lines = Lines(manifest);
  if (lines.empty()) return false;
  if (ReadText(player_dir + "/stamp") == lines[0]) return true;
  for (size_t i = 1; i < lines.size(); i++) {
    std::string bytes, target = player_dir + "/" + lines[i];
    if (!ReadAsset(lines[i], &bytes)) return false;
    MakeDirs(target.substr(0, target.rfind('/')));
    std::ofstream out(target, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    if (!out) return false;
  }
  // Written last: a half-finished unpacking is done again next time.
  std::ofstream(player_dir + "/stamp", std::ios::trunc) << lines[0];
  Note("player files unpacked: " + std::to_string(lines.size() - 1));
  return true;
}

int Run(std::vector<std::string> arguments) {
  std::vector<char*> argv;
  std::string program = "mvplayer";
  argv.push_back(&program[0]);
  for (std::string& argument : arguments) argv.push_back(&argument[0]);
  return mvp::PlayerMain(static_cast<int>(argv.size()), argv.data());
}

// Keeps a copy of the log of the game that has just run, named after the
// time and the game, with the way the player ended as its last line; only
// the newest 30 copies are kept (their names sort by time).
void KeepLog(const std::string& game_dir, const std::string& logs_dir, int exit_code) {
  std::string text = ReadText(game_dir + "/save/mvplayer.log");
  if (text.empty()) return;
  std::string parent = game_dir.substr(0, game_dir.rfind('/'));
  std::string name = parent.substr(parent.rfind('/') + 1);
  for (char& c : name) {
    if (!isalnum(static_cast<unsigned char>(c)) && c != '.' && c != '-') c = '_';
  }
  char stamp[32];
  time_t now = time(nullptr);
  strftime(stamp, sizeof stamp, "%Y%m%d-%H%M%S", localtime(&now));
  std::ofstream(logs_dir + "/" + stamp + "-" + name + ".log", std::ios::trunc)
      << text << "launcher: the player ended with exit code " << exit_code << "\n";

  std::vector<std::string> copies;
  if (DIR* dir = opendir(logs_dir.c_str())) {
    while (dirent* entry = readdir(dir)) {
      std::string file = entry->d_name;
      if (file.size() > 4 && file.compare(file.size() - 4, 4, ".log") == 0 && isdigit(static_cast<unsigned char>(file[0]))) {
        copies.push_back(file);
      }
    }
    closedir(dir);
  }
  std::sort(copies.begin(), copies.end());
  for (size_t i = 0; i + 30 < copies.size(); i++) std::remove((logs_dir + "/" + copies[i]).c_str());
}

// Points the player at the video decoder the package carries: Android has
// no ffmpeg, so one comes in the package's library folder, next to this
// program, the only place an app may start programs from.
void UseOwnVideoDecoder() {
  Dl_info here;
  if (!dladdr(reinterpret_cast<void*>(&UseOwnVideoDecoder), &here) || !here.dli_fname) return;
  std::string decoder = mvp::VideoPlayer::DecoderBeside(here.dli_fname);
  if (decoder.empty()) {
    Note("no video decoder beside the player: videos will be skipped");
    return;
  }
  setenv("MVPLAYER_FFMPEG", decoder.c_str(), 0);
}

}  // namespace

int main(int, char**) {
  SDL_SetHint(SDL_HINT_ANDROID_TRAP_BACK_BUTTON, "1");
  UseOwnVideoDecoder();
  const char* external = SDL_AndroidGetExternalStoragePath();
  const char* internal = SDL_AndroidGetInternalStoragePath();
  if (!external || !internal) {
    Note("no app storage");
    return 1;
  }
  std::string base = external, player_dir = std::string(internal) + "/player";
  const std::string test_arguments_file = base + "/args.txt";
  std::string games = base + "/games", logs = base + "/logs";
  // The shared storage's top folder is the part of the app's own folder
  // before "/Android/data/".
  size_t android_data = base.find("/Android/data/");
  std::string shared_games = (android_data == std::string::npos ? base : base.substr(0, android_data)) + "/RPGMV";
  mkdir(shared_games.c_str(), 0775);  // fails quietly until access is allowed
  MakeDirs(games);
  // The player's own folder goes next to the games when that can be written.
  std::string own = shared_games + "/mvplayer";
  mkdir(own.c_str(), 0775);
  if (std::ofstream(own + "/.writable", std::ios::trunc).good()) {
    std::remove((own + "/.writable").c_str());
    base = own;
    logs = base + "/logs";
  }
  MakeDirs(logs);
  if (!UnpackPlayerFiles(player_dir)) {
    Note("the player's own files could not be unpacked");
    return 1;
  }

  std::vector<std::string> test_arguments = Lines(ReadText(test_arguments_file));
  if (!test_arguments.empty()) {
    test_arguments.insert(test_arguments.end(), {"--player", player_dir});
    int code = Run(test_arguments);
    Note("test run ended with exit code " + std::to_string(code));
    return code;
  }

  std::string answers = std::string(internal) + "/picker.out";
  for (;;) {
    // The list prints its answers; they are read back from a file.
    if (!std::freopen(answers.c_str(), "w", stdout)) return 1;
    // The list remembers the games played and added, and can look through
    // the shared storage for a game to add.
    std::vector<std::string> pick = {"--pick", shared_games, games, "--player", player_dir,
                                     "--log", logs + "/picker.log", "--games-file", base + "/games.txt",
                                     "--can-add", "--browse", shared_games.substr(0, shared_games.rfind('/'))};
    // The list is read like any other list on a phone, held upright; a game
    // is a wide picture, shown with the phone on its side. SDL asks Android
    // for the orientation when the window of each is made.
    SDL_SetHint(SDL_HINT_ORIENTATIONS, "Portrait");
    int code = Run(pick);
    std::fflush(stdout);
    std::string game;
    for (const std::string& line : Lines(ReadText(answers))) {
      if (line.rfind("MVPLAYER_GAME=", 0) == 0) game = line.substr(14);
    }
    if (code != 0 || game.empty()) return 0;

    std::vector<std::string> play = {"--game", game, "--player", player_dir};
    SDL_SetHint(SDL_HINT_ORIENTATIONS, "LandscapeLeft LandscapeRight");
    code = Run(play);
    KeepLog(game, logs, code);
    Note("game ended with exit code " + std::to_string(code));
  }
}
