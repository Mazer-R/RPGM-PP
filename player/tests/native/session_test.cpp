// Tests for platform/session: what one run of a game notes about itself, and
// the line it leaves in the profile's session log.
// Built and run by tools/build/test.sh.
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "platform/session.h"

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
std::string YesNo(bool value) { return value ? "yes" : "no"; }

const mvp::SessionTime kEvening = {20261118, 20, 1795032000};

}  // namespace

int main() {
  mvp::Session plain;
  Expect("a run that notes nothing leaves the time, the frames, the code and the game",
         plain.Line(kEvening, 600.9, 36000, 0, "/games/My Game/www"),
         "day=20261118 hour=20 start=1795032000 seconds=600 frames=36000 code=0 game=/games/My Game/www");

  mvp::Session noted;
  noted.Note("mz");
  noted.Note("video");
  noted.Note("mz");
  Expect("what is noted is a flag each, once, in alphabetical order",
         noted.Line(kEvening, 5, 100, 2, "/g"), "day=20261118 hour=20 start=1795032000 seconds=5 frames=100 code=2 mz=1 video=1 game=/g");

  mvp::Session odd;
  odd.Note("game");
  odd.Note("seconds");
  odd.Note("two words");
  odd.Note("UPPER");
  odd.Note("");
  odd.Note("averyveryverylongnamethatisnotakey");
  odd.Note("a=b");
  Expect("a note that is not a plain short word, or is one of the line's own fields, is dropped",
         odd.Line(kEvening, 5, 100, 0, "/g"), "day=20261118 hour=20 start=1795032000 seconds=5 frames=100 code=0 game=/g");

  Expect("a game folder with a line break in its name stays on one line",
         plain.Line(kEvening, 5, 100, 0, "/games/a\nb"), "day=20261118 hour=20 start=1795032000 seconds=5 frames=100 code=0 game=/games/a b");

  mvp::Session saving;
  saving.SaveWritten(10);
  saving.SaveWritten(200);
  Expect("saves are counted", saving.Line(kEvening, 5, 100, 0, "/g"),
         "day=20261118 hour=20 start=1795032000 seconds=5 frames=100 code=0 saves=2 game=/g");
  saving.SaveWritten(259.5);
  Expect("three saves, the first and the last a minute or less apart, are quick saves",
         saving.Line(kEvening, 5, 100, 0, "/g"),
         "day=20261118 hour=20 start=1795032000 seconds=5 frames=100 code=0 saves=3 game=/g");
  saving.SaveWritten(260);
  Expect("the last three count, not the first three", saving.Line(kEvening, 5, 100, 0, "/g"),
         "day=20261118 hour=20 start=1795032000 seconds=5 frames=100 code=0 saves=4 quick=1 game=/g");

  Expect("an MV slot is a save slot", YesNo(mvp::IsSaveSlot("/g/www/save/file1.rpgsave")), "yes");
  Expect("an MZ slot is a save slot", YesNo(mvp::IsSaveSlot("/g/save/file12.rmmzsave")), "yes");
  Expect("the list of saves is not a slot", YesNo(mvp::IsSaveSlot("/g/save/global.rmmzsave")), "no");
  Expect("the game's settings are not a slot", YesNo(mvp::IsSaveSlot("/g/save/config.rpgsave")), "no");
  Expect("the backup MZ makes while saving is not a slot", YesNo(mvp::IsSaveSlot("/g/save/file1.rmmzsave_")), "no");
  Expect("a file named like a slot outside a save folder is not one", YesNo(mvp::IsSaveSlot("/g/data/file1.rpgsave")), "no");
  Expect("the player's own files are not slots", YesNo(mvp::IsSaveSlot("/g/save/pointer.txt")), "no");

  mvp::SessionTime noon = mvp::LocalSessionTime(1795003200);
  Expect("the time of a run is its day, its hour and its second, in local time",
         std::to_string(noon.start) + " " + YesNo(noon.day > 20260000 && noon.day < 20270000) + " " + YesNo(noon.hour >= 0 && noon.hour < 24),
         "1795003200 yes yes");

  char folder[] = "/tmp/session_test_XXXXXX";
  if (!mkdtemp(folder)) return 1;
  std::string slot = std::string(folder) + "/file1.rpgsave";
  std::ofstream(slot) << "x";
  time_t now = time(nullptr);
  Expect("a file written just now was not saved on an earlier day", YesNo(mvp::SavedOnEarlierDay(slot, now)), "no");
  struct timeval old_times[2] = {{now - 3 * 86400, 0}, {now - 3 * 86400, 0}};
  utimes(slot.c_str(), old_times);
  Expect("a file three days old was", YesNo(mvp::SavedOnEarlierDay(slot, now)), "yes");
  Expect("a file that is not there was not", YesNo(mvp::SavedOnEarlierDay(std::string(folder) + "/none", now)), "no");

  std::string log = std::string(folder) + "/deeper/sessions.log";
  Expect("a line cannot be added where the folder is missing", YesNo(mvp::AppendSessionLine(log, "one")), "no");
  log = std::string(folder) + "/sessions.log";
  mvp::AppendSessionLine(log, "one");
  mvp::AppendSessionLine(log, "two");
  std::ostringstream text;
  text << std::ifstream(log).rdbuf();
  Expect("lines are added to the end of the log, one each", text.str(), "one\ntwo\n");
  Expect("no log is asked for: nothing is written, and that is not a failure", YesNo(mvp::AppendSessionLine("", "x")), "yes");
  std::remove(slot.c_str());
  std::remove(log.c_str());
  rmdir(folder);

  std::printf(g_failures ? "\n%d failed\n" : "\nall passed\n", g_failures);
  return g_failures ? 1 : 0;
}
