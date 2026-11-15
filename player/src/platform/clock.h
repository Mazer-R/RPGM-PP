// Monotonic time for the whole player. Everything the game sees as "now"
// (performance.now, frame timestamps) comes from here, so that it can later
// be clamped after a resume or replaced by recorded values.
#pragma once

namespace mvp {

class Clock {
 public:
  Clock();
  // Milliseconds since the player started, with a fractional part.
  double NowMs() const;

 private:
  double start_seconds_;
};

}  // namespace mvp
