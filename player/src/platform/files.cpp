#include "platform/files.h"

#include <dirent.h>
#include <sys/stat.h>

#include <algorithm>
#include <cctype>
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

std::string FindFile(const std::string& path) {
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

void ForgetFileNames() { g_listings.clear(); }

}  // namespace mvp
