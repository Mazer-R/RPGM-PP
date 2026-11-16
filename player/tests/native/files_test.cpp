// Tests for platform/files: finding files whatever the case of their names.
// Built and run by tools/build/test.sh.
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

#include "platform/files.h"

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

}  // namespace

int main() {
  char pattern[] = "/tmp/mvp-files-XXXXXX";
  std::string root = mkdtemp(pattern);
  mkdir((root + "/img").c_str(), 0755);
  mkdir((root + "/img/Layers").c_str(), 0755);
  mkdir((root + "/data").c_str(), 0755);
  Touch(root + "/img/Layers/Fog1.png");
  Touch(root + "/img/Layers/plain.png");
  Touch(root + "/data/Map001.json");

  using mvp::FindFile;
  Expect("a file named as it is written is returned as written",
         FindFile(root + "/img/Layers/plain.png"), root + "/img/Layers/plain.png");
  Expect("a file asked for in another case is found",
         FindFile(root + "/img/Layers/fog1.png"), root + "/img/Layers/Fog1.png");
  Expect("a folder in another case is found too",
         FindFile(root + "/IMG/layers/FOG1.PNG"), root + "/img/Layers/Fog1.png");
  Expect("a folder alone is found in another case",
         FindFile(root + "/Data"), root + "/data");
  Expect("a file that does not exist in any case comes back unchanged",
         FindFile(root + "/img/Layers/missing.png"), root + "/img/Layers/missing.png");
  Expect("a path whose folder does not exist comes back unchanged",
         FindFile(root + "/nothing/here.png"), root + "/nothing/here.png");
  Expect("an empty path stays empty", FindFile(""), "");

  // A file created after its folder was listed is found once told to forget.
  FindFile(root + "/data/map002.json");
  Touch(root + "/data/Map002.json");
  mvp::ForgetFileNames();
  Expect("a file created later is found after forgetting the listings",
         FindFile(root + "/data/map002.json"), root + "/data/Map002.json");

  // An answer is remembered, and forgotten when told that files changed.
  Touch(root + "/data/Old.json");
  FindFile(root + "/data/old.json");
  std::remove((root + "/data/Old.json").c_str());
  Touch(root + "/data/OLD.json");
  mvp::ForgetFileNames();
  Expect("after forgetting, a file renamed in the meantime is found under its new name",
         FindFile(root + "/data/old.json"), root + "/data/OLD.json");
  Expect("asking twice gives the same answer",
         FindFile(root + "/data/old.json"), root + "/data/OLD.json");

  // Files with a disguised beginning.
  auto Contents = [](const std::string& path) {
    std::vector<unsigned char> bytes;
    if (!mvp::ReadFileContents(path, &bytes)) return std::string("<unreadable>");
    return std::string(bytes.begin(), bytes.end());
  };
  std::ofstream(root + "/img/Hidden.rpgmvp") << "MARKERMARKER....????rest of the file";
  Expect("a file without a registered head is read as it is on disk",
         Contents(root + "/data/Map001.json"), "x");
  Expect("no head is known before one is registered",
         mvp::HasFileHead(root + "/img/hidden.rpgmvp") ? "yes" : "no", "no");
  mvp::SetFileHead(root + "/img/hidden.rpgmvp", 16, "TRUE");
  Expect("a registered head is known under the name the scripts use",
         mvp::HasFileHead(root + "/img/hidden.rpgmvp") ? "yes" : "no", "yes");
  Expect("a file with a head is read from the skip on, with the head in place of its first bytes",
         Contents(root + "/img/hidden.rpgmvp"), "TRUErest of the file");
  mvp::SetFileHead(root + "/data/Map001.json", 16, "TRUE");
  Expect("a file shorter than its head says is unreadable", Contents(root + "/data/Map001.json"), "<unreadable>");
  Expect("a missing file is unreadable", Contents(root + "/img/none.png"), "<unreadable>");
  mvp::ForgetFileHeads();
  Expect("forgetting the heads gives the file on disk again",
         Contents(root + "/img/hidden.rpgmvp"), "MARKERMARKER....????rest of the file");

  // A relative path is resolved from the current folder and stays relative.
  if (chdir(root.c_str()) == 0) {
    mvp::ForgetFileNames();
    Expect("a relative path is found and stays relative", FindFile("img/layers/fog1.png"), "img/Layers/Fog1.png");
  }

  std::printf(g_failures ? "%d failed\n" : "all passed\n", g_failures);
  return g_failures ? 1 : 0;
}
