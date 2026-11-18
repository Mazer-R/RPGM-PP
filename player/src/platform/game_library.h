// The games the player knows of: which game a path points at, the list of
// games remembered between runs, and what is in a folder, for the game
// list's "add a game" browser.
#pragma once

#include <string>
#include <vector>

namespace mvp {

// The folder of the game at `path` (the one with index.html and the
// engine's scripts), or "" if there is none. For an MV game that is its www
// folder, and `path` may be that folder, the folder that holds it, or any
// file directly inside either, such as the game's .exe. An MZ game has no
// www: its folder is the one that holds the .exe.
std::string ResolveGameDir(std::string path);

// The remembered games are a text file of www folders, one per line, the
// one played or added last first. A line that starts with "-" holds a game
// taken off the list instead: it is not shown, even when it is in one of
// the folders the list looks through. Its files are left alone.
//
// Returns that text with `www` at the top and nowhere else, and no longer
// taken off.
std::string RememberGame(const std::string& list, const std::string& www);

// Returns the text with `www` taken off the list: gone from the games
// played or added, and marked as taken off, once.
std::string ForgetGame(const std::string& list, const std::string& www);

// The www folders the text marks as taken off, in its order.
std::vector<std::string> ForgottenGames(const std::string& list);

// The names in a folder, without those that start with a dot: folders
// first, each ending in "/", then files; each group by name, whatever the
// case. Empty if the folder cannot be read.
std::vector<std::string> ListFolder(const std::string& path);

}  // namespace mvp
