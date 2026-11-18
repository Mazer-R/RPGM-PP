// What one run of a game notes about itself, for the player's profile. A
// run notes what was used of the player (a video, the settings menu, a save)
// and never what happens inside the game, so it holds for any game. When the
// run ends, one line goes to the end of the profile's session log; the game
// list reads the log and works out the achievements (js/profile-model.js).
// Nothing here is done per frame.
#pragma once

#include <ctime>
#include <deque>
#include <set>
#include <string>

namespace mvp {

// When a run began: its day as a number (20261118), its hour, both in local
// time, and its second since 1970.
struct SessionTime {
  int day;
  int hour;
  long long start;
};
SessionTime LocalSessionTime(time_t when);

class Session {
 public:
  // Sets a flag for this run: a short word in small letters ("video",
  // "settings"). Anything else, and the names of the line's own fields, are
  // dropped, since the word may come from a script.
  void Note(const std::string& key);
  // A save slot was written, `now_seconds` into the run. Counts it; three
  // in a row within a minute set the flag "quick".
  void SaveWritten(double now_seconds);

  // The run's line for the session log, without the line break:
  //   day=20261118 hour=20 start=1795032000 seconds=600 frames=36000 code=0 saves=2 mz=1 game=/games/My Game/www
  // The game's folder is last, and is the rest of the line.
  std::string Line(const SessionTime& begun, double seconds, long frames, int code, const std::string& game) const;

 private:
  std::set<std::string> flags_;
  int saves_ = 0;
  std::deque<double> last_saves_;
};

// Whether a path is one of a game's save slots (save/file<N>.rpgsave or
// .rmmzsave): not its list of saves, its settings or the player's own files.
bool IsSaveSlot(const std::string& path);

// Whether the file was last written on a day before the day of `now`, in
// local time. A file that is not there was not.
bool SavedOnEarlierDay(const std::string& path, time_t now);

// Adds a line to the end of the session log. With no log named nothing is
// written and the answer is true; false when the log cannot be written.
bool AppendSessionLine(const std::string& log_path, const std::string& line);

}  // namespace mvp
