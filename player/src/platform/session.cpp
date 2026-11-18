#include "platform/session.h"

#include <sys/stat.h>

#include <fstream>

namespace mvp {

namespace {

const char* const kOwnFields[] = {"day", "hour", "start", "seconds", "frames", "code", "saves", "game"};
constexpr size_t kLongestNote = 16;
constexpr double kQuickSeconds = 60;

int DayOf(time_t when) {
  struct tm local = {};
  localtime_r(&when, &local);
  return (local.tm_year + 1900) * 10000 + (local.tm_mon + 1) * 100 + local.tm_mday;
}

}  // namespace

SessionTime LocalSessionTime(time_t when) {
  struct tm local = {};
  localtime_r(&when, &local);
  return {DayOf(when), local.tm_hour, static_cast<long long>(when)};
}

void Session::Note(const std::string& key) {
  if (key.empty() || key.size() > kLongestNote) return;
  for (char c : key) {
    if (c < 'a' || c > 'z') return;
  }
  for (const char* own : kOwnFields) {
    if (key == own) return;
  }
  flags_.insert(key);
}

void Session::SaveWritten(double now_seconds) {
  saves_++;
  last_saves_.push_back(now_seconds);
  if (last_saves_.size() > 3) last_saves_.pop_front();
  if (last_saves_.size() == 3 && last_saves_.back() - last_saves_.front() <= kQuickSeconds) flags_.insert("quick");
}

std::string Session::Line(const SessionTime& begun, double seconds, long frames, int code, const std::string& game) const {
  std::string line = "day=" + std::to_string(begun.day) + " hour=" + std::to_string(begun.hour) +
                     " start=" + std::to_string(begun.start) + " seconds=" + std::to_string(static_cast<long>(seconds)) +
                     " frames=" + std::to_string(frames) + " code=" + std::to_string(code);
  if (saves_ > 0) line += " saves=" + std::to_string(saves_);
  for (const std::string& flag : flags_) line += " " + flag + "=1";
  std::string folder = game;
  for (char& c : folder) {
    if (c == '\n' || c == '\r') c = ' ';
  }
  return line + " game=" + folder;
}

bool IsSaveSlot(const std::string& path) {
  size_t slash = path.rfind('/');
  if (slash == std::string::npos || slash < 5 || path.compare(slash - 5, 5, "/save") != 0) return false;
  std::string name = path.substr(slash + 1);
  if (name.compare(0, 4, "file") != 0) return false;
  size_t dot = name.find('.');
  if (dot == std::string::npos || dot == 4) return false;
  for (size_t i = 4; i < dot; i++) {
    if (name[i] < '0' || name[i] > '9') return false;
  }
  std::string kind = name.substr(dot);
  return kind == ".rpgsave" || kind == ".rmmzsave";
}

bool SavedOnEarlierDay(const std::string& path, time_t now) {
  struct stat info = {};
  if (stat(path.c_str(), &info) != 0) return false;
  return DayOf(info.st_mtime) < DayOf(now);
}

bool AppendSessionLine(const std::string& log_path, const std::string& line) {
  if (log_path.empty()) return true;
  std::ofstream log(log_path, std::ios::app);
  log << line << '\n';
  log.flush();
  return log.good();
}

}  // namespace mvp
