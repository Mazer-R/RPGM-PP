// Tests for platform/game_library: finding the game a path points at, the
// remembered list of games, and listing a folder for the game list's
// browser. Built and run by tools/build/test.sh.
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

#include "platform/game_library.h"

namespace {

int g_failures = 0;

void Expect(const std::string& what, const std::string& got, const std::string& wanted) {
  bool ok = got == wanted;
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) {
    std::printf("       got    %s\n       wanted %s\n", got.c_str(), wanted.c_str());
    g_failures++;
  }
}

void Touch(const std::string& path) { std::ofstream(path) << "x"; }

std::string Joined(const std::vector<std::string>& names) {
  std::string text;
  for (const std::string& name : names) text += (text.empty() ? "" : " ") + name;
  return text;
}

}  // namespace

int main() {
  char pattern[] = "/tmp/mvp-library-XXXXXX";
  std::string root = mkdtemp(pattern);
  // A game as it is shipped for Windows: Game.exe next to www.
  for (const char* dir : {"/Game", "/Game/www", "/Game/www/js", "/Game/locales", "/NotAGame", "/NotAGame/www", "/.hidden"}) {
    mkdir((root + dir).c_str(), 0755);
  }
  Touch(root + "/Game/Game.exe");
  Touch(root + "/Game/www/index.html");
  Touch(root + "/Game/www/js/rpg_core.js");
  Touch(root + "/NotAGame/www/index.html");
  Touch(root + "/notes.txt");

  std::string www = root + "/Game/www";
  Expect("the www folder is the game", mvp::ResolveGameDir(www), www);
  Expect("so is the folder that holds it", mvp::ResolveGameDir(root + "/Game"), www);
  Expect("with a slash at the end too", mvp::ResolveGameDir(root + "/Game/"), www);
  Expect("the game's .exe leads to it", mvp::ResolveGameDir(root + "/Game/Game.exe"), www);
  Expect("and the page inside www", mvp::ResolveGameDir(www + "/index.html"), www);
  Expect("a page without the engine is no game", mvp::ResolveGameDir(root + "/NotAGame"), "");
  Expect("nor is a path that is not there", mvp::ResolveGameDir(root + "/Nowhere"), "");

  Expect("a folder is listed with its folders marked, hidden names left out",
         Joined(mvp::ListFolder(root)), "Game/ NotAGame/ notes.txt");
  Expect("folders first, then files, each by name whatever the case",
         Joined(mvp::ListFolder(root + "/Game")), "locales/ www/ Game.exe");
  Expect("a folder that cannot be read is empty", Joined(mvp::ListFolder(root + "/Nowhere")), "");

  Expect("the first game remembered is the whole list", mvp::RememberGame("", "/a/www"), "/a/www\n");
  Expect("a new one goes to the top", mvp::RememberGame("/a/www\n/b/www\n", "/c/www"), "/c/www\n/a/www\n/b/www\n");
  Expect("one already there moves to the top, once", mvp::RememberGame("/a/www\n/b/www\n/c/www\n", "/b/www"),
         "/b/www\n/a/www\n/c/www\n");
  Expect("empty lines and a missing last line end are put right", mvp::RememberGame("\n/a/www\n\n/b/www", "/a/www"),
         "/a/www\n/b/www\n");

  Expect("a game taken off the list is gone from it and marked", mvp::ForgetGame("/a/www\n/b/www\n", "/a/www"),
         "/b/www\n-/a/www\n");
  Expect("one that was only in a games folder is marked", mvp::ForgetGame("/a/www\n", "/g/www"), "/a/www\n-/g/www\n");
  Expect("taking a game off twice marks it once", mvp::ForgetGame("-/a/www\n/b/www\n", "/a/www"), "/b/www\n-/a/www\n");
  Expect("a game added again is no longer taken off", mvp::RememberGame("/b/www\n-/a/www\n", "/a/www"),
         "/a/www\n/b/www\n");
  Expect("the games taken off are read back in order",
         Joined(mvp::ForgottenGames("-/a/www\n/b/www\n-/c/www\n-\n")), "/a/www /c/www");

  std::system(("rm -rf " + root).c_str());
  std::printf(g_failures ? "\n%d FAILED\n" : "\nall passed\n", g_failures);
  return g_failures ? 1 : 0;
}
