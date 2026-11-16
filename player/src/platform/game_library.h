// The games the player knows of: which game a path points at, the list of
// games remembered between runs, and what is in a folder, for the game
// list's "add a game" browser.
#pragma once

#include <string>
#include <vector>

namespace mvp {

// The www folder of the game at `path`, or "" if there is none. `path` may
// be the game's www folder (the one with index.html), the folder that holds
// www, or any file directly inside either, such as the game's .exe.
std::string ResolveGameDir(std::string path);

// The remembered games are a text file of www folders, one per line, the
// one played or added last first. Returns that text with `www` at the top
// and nowhere else.
std::string RememberGame(const std::string& list, const std::string& www);

// The names in a folder, without those that start with a dot: folders
// first, each ending in "/", then files; each group by name, whatever the
// case. Empty if the folder cannot be read.
std::vector<std::string> ListFolder(const std::string& path);

}  // namespace mvp
