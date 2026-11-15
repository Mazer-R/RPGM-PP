#include "platform/log.h"

#include "platform/clock.h"

namespace mvp {

namespace {
const char* LevelName(LogLevel level) {
  switch (level) {
    case LogLevel::kInfo: return "info";
    case LogLevel::kWarning: return "warn";
    case LogLevel::kError: return "error";
  }
  return "info";
}
}  // namespace

Log::Log(const std::string& path, const Clock& clock, std::size_t max_bytes)
    : file_(std::fopen(path.c_str(), "w")), clock_(clock), max_bytes_(max_bytes) {}

Log::~Log() {
  if (file_) std::fclose(file_);
}

void Log::Write(LogLevel level, const std::string& source, const std::string& text) {
  // Errors are also echoed to stderr so they show up when run from a shell.
  if (level == LogLevel::kError) std::fprintf(stderr, "[%s] %s\n", source.c_str(), text.c_str());
  if (!file_) return;
  if (written_ >= max_bytes_) {
    if (!limit_reported_) {
      std::fprintf(file_, "log size limit reached; further messages are dropped\n");
      std::fflush(file_);
      limit_reported_ = true;
    }
    return;
  }
  int count = std::fprintf(file_, "%10.1f %-5s [%s] %s\n", clock_.NowMs(), LevelName(level),
                           source.c_str(), text.c_str());
  if (count > 0) written_ += static_cast<std::size_t>(count);
  // Flushed on every line: after a crash the last lines are the useful ones.
  std::fflush(file_);
}

}  // namespace mvp
