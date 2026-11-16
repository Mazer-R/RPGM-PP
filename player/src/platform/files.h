// Finding game files whatever the case of their names.
//
// RPG Maker MV games are made on Windows, where "Fog1.png" and "fog1.png"
// are the same file, and their data often names a file in a different case
// than the file has. On Linux those are two names, and the game would wait
// for ever for an image that "does not exist".
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace mvp {

// Returns the path of the existing file or folder that `path` names when
// case is ignored: `path` itself if it exists as written, otherwise the same
// path with each part replaced by the entry of that name in another case.
// Returns `path` unchanged if there is no such entry.
std::string FindFile(const std::string& path);

// Forgets the folder listings FindFile remembers. Call after creating or
// removing a file.
void ForgetFileNames();

// Files whose beginning is disguised.
//
// RPG Maker MV can ship images and sounds "encrypted": a 16-byte marker is
// put in front of the file and the file's own first 16 bytes are scrambled
// with a key. The game's engine undoes this itself, in script, on the bytes
// it is given. The player gives it only the start of such a file; the true
// first bytes that the engine works out are then registered here, so that
// native code can read the file as it really is.
//
// SetFileHead records that `path` (as the scripts write it) is to be read
// from byte `skip` on, with `head` in place of the bytes found there.
void SetFileHead(const std::string& path, size_t skip, const std::string& head);
bool HasFileHead(const std::string& path);
void ForgetFileHeads();

// Reads a whole file into memory: as it is on disk, or, for a file with a
// registered head, as it really is. Returns false if it cannot be read or is
// shorter than its registered head says.
bool ReadFileContents(const std::string& path, std::vector<unsigned char>* contents);

}  // namespace mvp
