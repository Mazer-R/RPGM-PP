#include "platform/pad_cursor.h"

#include <algorithm>
#include <cmath>

namespace mvp {
namespace {
constexpr int kKeyEnter = 13, kKeySpace = 32, kKeyLeft = 37, kKeyZ = 90;
// Speeds in screen heights per second: crossing the screen takes about
// three seconds at first and under one once it has sped up.
constexpr double kSlow = 0.3, kFast = 1.2, kSecondsToFast = 0.8;

bool IsConfirm(int key_code) { return key_code == kKeyEnter || key_code == kKeySpace || key_code == kKeyZ; }
}  // namespace

void PadCursor::SetScreen(int width, int height) {
  bool first = width_ == 0;
  // A screen that changes size keeps the cursor at the same part of it.
  if (!first && width > 0 && height > 0) {
    x_ = x_ * static_cast<float>(width) / static_cast<float>(width_);
    y_ = y_ * static_cast<float>(height) / static_cast<float>(height_);
  }
  width_ = width;
  height_ = height;
  if (first) {
    x_ = static_cast<float>(width) / 2;
    y_ = static_cast<float>(height) / 2;
  }
}

void PadCursor::SetOn(bool on, std::vector<PointerChange>* out) {
  if (!on) Release(out);
  on_ = on;
  // The game learns where the cursor is as soon as there is one.
  if (on) out->push_back({3, x_, y_});
}

void PadCursor::Release(std::vector<PointerChange>* out) {
  for (bool& held : held_) held = false;
  held_for_ = 0;
  if (pressed_) out->push_back({2, x_, y_});
  pressed_ = false;
}

bool PadCursor::Key(int key_code, bool down, std::vector<PointerChange>* out) {
  if (!on_) return false;
  if (key_code >= kKeyLeft && key_code <= kKeyLeft + 3) {
    held_[key_code - kKeyLeft] = down;
    if (!held_[0] && !held_[1] && !held_[2] && !held_[3]) held_for_ = 0;
    return true;
  }
  if (!IsConfirm(key_code)) return false;
  if (down != pressed_) {
    pressed_ = down;
    out->push_back({down ? 0 : 2, x_, y_});
  }
  return true;
}

void PadCursor::Advance(double seconds, std::vector<PointerChange>* out) {
  if (!on_ || seconds <= 0) return;
  double dx = (held_[2] ? 1 : 0) - (held_[0] ? 1 : 0), dy = (held_[3] ? 1 : 0) - (held_[1] ? 1 : 0);
  if (dx == 0 && dy == 0) return;
  seconds = std::min(seconds, 0.1);  // a long pause is not a long move
  held_for_ += seconds;
  double speed = kSlow + (kFast - kSlow) * std::min(1.0, held_for_ / kSecondsToFast);
  double length = std::sqrt(dx * dx + dy * dy);
  double step = speed * height_ * seconds / length;
  float x = std::max(0.0f, std::min(static_cast<float>(width_ - 1), x_ + static_cast<float>(dx * step)));
  float y = std::max(0.0f, std::min(static_cast<float>(height_ - 1), y_ + static_cast<float>(dy * step)));
  if (x == x_ && y == y_) return;
  x_ = x;
  y_ = y;
  out->push_back({pressed_ ? 1 : 3, x_, y_});
}

}  // namespace mvp
