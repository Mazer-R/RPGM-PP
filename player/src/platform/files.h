// Finding game files whatever the case of their names.
//
// RPG Maker MV games are made on Windows, where "Fog1.png" and "fog1.png"
// are the same file, and their data often names a file in a different case
// than the file has. On Linux those are two names, and the game would wait
// for ever for an image that "does not exist".
#pragma once

#include <string>

namespace mvp {

// Returns the path of the existing file or folder that `path` names when
// case is ignored: `path` itself if it exists as written, otherwise the same
// path with each part replaced by the entry of that name in another case.
// Returns `path` unchanged if there is no such entry.
std::string FindFile(const std::string& path);

// Forgets the folder listings FindFile remembers. Call after creating or
// removing a file.
void ForgetFileNames();

}  // namespace mvp
