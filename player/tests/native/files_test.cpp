// Tests for platform/files: finding files whatever the case of their names.
// Built and run by tools/build/test.sh.
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

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

  // A relative path is resolved from the current folder and stays relative.
  if (chdir(root.c_str()) == 0) {
    mvp::ForgetFileNames();
    Expect("a relative path is found and stays relative", FindFile("img/layers/fog1.png"), "img/Layers/Fog1.png");
  }

  std::printf(g_failures ? "%d failed\n" : "all passed\n", g_failures);
  return g_failures ? 1 : 0;
}
