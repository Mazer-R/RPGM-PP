// The player's log file. The handheld has no debugger, so this file is the
// main way to find out what happened: the game's console output, script
// errors and the player's own messages all end up here.
#pragma once

#include <cstddef>
#include <cstdio>
#include <string>

namespace mvp {

class Clock;

enum class LogLevel { kInfo, kWarning, kError };

class Log {
 public:
  // Opens (and truncates) the file at `path`. Writing stops once `max_bytes`
  // have been written, so a script that logs in a loop cannot fill the card.
  Log(const std::string& path, const Clock& clock, std::size_t max_bytes);
  ~Log();
  Log(const Log&) = delete;
  Log& operator=(const Log&) = delete;

  void Write(LogLevel level, const std::string& source, const std::string& text);
  bool ok() const { return file_ != nullptr; }

 private:
  std::FILE* file_;
  const Clock& clock_;
  std::size_t max_bytes_;
  std::size_t written_ = 0;
  bool limit_reported_ = false;
};

}  // namespace mvp
