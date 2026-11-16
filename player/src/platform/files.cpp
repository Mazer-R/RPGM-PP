#include "platform/files.h"

#include <dirent.h>
#include <sys/stat.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <unordered_map>

namespace mvp {
namespace {

bool Exists(const std::string& path) {
  struct stat info {};
  return stat(path.c_str(), &info) == 0;
}

std::string Lower(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return text;
}

// For each folder asked about: its entries, by lower-case name. A folder is
// listed once; games ask for thousands of files from a few folders.
using Listing = std::unordered_map<std::string, std::string>;
std::unordered_map<std::string, Listing> g_listings;

const Listing& ListingOf(const std::string& folder) {
  auto found = g_listings.find(folder);
  if (found != g_listings.end()) return found->second;
  Listing& listing = g_listings[folder];
  if (DIR* dir = opendir(folder.empty() ? "/" : folder.c_str())) {
    while (dirent* entry = readdir(dir)) {
      // When two entries differ only in case, the first one listed is kept.
      listing.emplace(Lower(entry->d_name), entry->d_name);
    }
    closedir(dir);
  }
  return listing;
}

}  // namespace

namespace {
// Answers already worked out, for paths that led to an existing file. Games
// ask for the same few hundred files again and again (every sound effect,
// every image decoded anew), and each answer costs at least one question to
// the system.
std::unordered_map<std::string, std::string> g_found;

std::string Search(const std::string& path);
}  // namespace

std::string FindFile(const std::string& path) {
  auto known = g_found.find(path);
  if (known != g_found.end()) return known->second;
  std::string found = Search(path);
  if (!path.empty() && Exists(found)) g_found[path] = found;
  return found;
}

namespace {
std::string Search(const std::string& path) {
  if (path.empty() || Exists(path)) return path;

  // Walk the path part by part, taking each part as written when it exists
  // and by its lower-case name when it does not.
  bool absolute = path[0] == '/';
  std::string found = absolute ? "" : ".";
  size_t start = absolute ? 1 : 0;
  while (start <= path.size()) {
    size_t end = path.find('/', start);
    if (end == std::string::npos) end = path.size();
    std::string part = path.substr(start, end - start);
    start = end + 1;
    if (part.empty()) continue;
    std::string as_written = found + "/" + part;
    if (Exists(as_written)) {
      found = as_written;
      continue;
    }
    const Listing& listing = ListingOf(found);
    auto match = listing.find(Lower(part));
    if (match == listing.end()) return path;
    found += "/" + match->second;
  }
  return absolute || found.size() < 2 ? found : found.substr(2);
}
}  // namespace

void ForgetFileNames() {
  g_listings.clear();
  g_found.clear();
}

namespace {
struct Head {
  size_t skip;
  std::string bytes;
};
std::unordered_map<std::string, Head> g_heads;
}  // namespace

void SetFileHead(const std::string& path, size_t skip, const std::string& head) { g_heads[path] = {skip, head}; }
bool HasFileHead(const std::string& path) { return g_heads.count(path) > 0; }
void ForgetFileHeads() { g_heads.clear(); }

bool ReadFileContents(const std::string& path, std::vector<unsigned char>* contents) {
  std::FILE* file = std::fopen(FindFile(path).c_str(), "rb");
  if (!file) return false;
  contents->clear();
  unsigned char block[65536];
  for (size_t got; (got = std::fread(block, 1, sizeof block, file)) > 0;) {
    contents->insert(contents->end(), block, block + got);
  }
  std::fclose(file);
  auto head = g_heads.find(path);
  if (head == g_heads.end()) return true;
  const Head& known = head->second;
  if (contents->size() < known.skip + known.bytes.size()) return false;
  contents->erase(contents->begin(), contents->begin() + static_cast<std::ptrdiff_t>(known.skip));
  std::copy(known.bytes.begin(), known.bytes.end(), contents->begin());
  return true;
}

}  // namespace mvp
