#include "platform/game_library.h"

#include <dirent.h>
#include <sys/stat.h>

#include <algorithm>
#include <cctype>
#include <sstream>

namespace mvp {

namespace {

bool IsFile(const std::string& path) {
  struct stat info {};
  return stat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode);
}

bool IsFolder(const std::string& path) {
  struct stat info {};
  return stat(path.c_str(), &info) == 0 && S_ISDIR(info.st_mode);
}

std::string Lower(std::string text) {
  for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return text;
}

}  // namespace

std::string ResolveGameDir(std::string path) {
  while (path.size() > 1 && path.back() == '/') path.pop_back();
  if (IsFile(path)) {
    size_t slash = path.rfind('/');
    path = slash == std::string::npos ? "." : path.substr(0, slash);
  }
  // MV keeps the game in a www folder next to the .exe; MZ keeps it in the
  // folder of the .exe itself. Each is known by its engine's core script.
  for (const std::string& candidate : {path, path + "/www"}) {
    if (!IsFile(candidate + "/index.html")) continue;
    if (IsFile(candidate + "/js/rpg_core.js") || IsFile(candidate + "/js/rmmz_core.js")) return candidate;
  }
  return "";
}

namespace {

constexpr char kForgotten = '-';

// The text's lines, without the empty ones and those that name `www`,
// whether to remember or to keep it off the list.
std::string WithoutGame(const std::string& list, const std::string& www) {
  std::string text;
  std::istringstream lines(list);
  for (std::string line; std::getline(lines, line);) {
    if (!line.empty() && line != www && line != kForgotten + www) text += line + "\n";
  }
  return text;
}

}  // namespace

std::string RememberGame(const std::string& list, const std::string& www) {
  return www + "\n" + WithoutGame(list, www);
}

std::string ForgetGame(const std::string& list, const std::string& www) {
  return WithoutGame(list, www) + kForgotten + www + "\n";
}

std::vector<std::string> ForgottenGames(const std::string& list) {
  std::vector<std::string> games;
  std::istringstream lines(list);
  for (std::string line; std::getline(lines, line);) {
    if (line.size() > 1 && line[0] == kForgotten) games.push_back(line.substr(1));
  }
  return games;
}

std::vector<std::string> ListFolder(const std::string& path) {
  std::vector<std::string> folders, files;
  if (DIR* dir = opendir(path.c_str())) {
    while (dirent* entry = readdir(dir)) {
      std::string name = entry->d_name;
      if (name.empty() || name[0] == '.') continue;
      if (IsFolder(path + "/" + name)) folders.push_back(name + "/");
      else files.push_back(name);
    }
    closedir(dir);
  }
  auto by_name = [](const std::string& a, const std::string& b) {
    std::string la = Lower(a), lb = Lower(b);
    return la != lb ? la < lb : a < b;
  };
  std::sort(folders.begin(), folders.end(), by_name);
  std::sort(files.begin(), files.end(), by_name);
  folders.insert(folders.end(), files.begin(), files.end());
  return folders;
}

}  // namespace mvp
