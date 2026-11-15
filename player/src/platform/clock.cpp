#include "platform/clock.h"

#include <time.h>

namespace mvp {

namespace {
double MonotonicSeconds() {
  timespec ts{};
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<double>(ts.tv_sec) + static_cast<double>(ts.tv_nsec) / 1e9;
}
}  // namespace

Clock::Clock() : start_seconds_(MonotonicSeconds()) {}

double Clock::NowMs() const { return (MonotonicSeconds() - start_seconds_) * 1000.0; }

}  // namespace mvp
