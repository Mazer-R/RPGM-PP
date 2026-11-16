#include "platform/touch.h"

#include <algorithm>
#include <cmath>

namespace mvp {
namespace {

constexpr int kKeyShift = 16, kKeyLeft = 37, kKeyUp = 38, kKeyRight = 39, kKeyDown = 40;
constexpr int kKeyCancel = 88, kKeyConfirm = 90;

// A thumb drifts: the pad still answers this far beyond its drawn edge
// (as a multiple of its radius), and ignores this much around its centre.
constexpr float kPadReach = 1.5f;
constexpr float kPadNeutral = 0.2f;

}  // namespace

void HoldQuickReleases(std::vector<KeyChange>* batch, std::vector<KeyChange>* later) {
  std::set<int> pressed_here, held_back;
  std::vector<KeyChange> now;
  for (const KeyChange& change : *batch) {
    if (held_back.count(change.key_code)) {
      later->push_back(change);
    } else if (change.down) {
      pressed_here.insert(change.key_code);
      now.push_back(change);
    } else if (pressed_here.count(change.key_code)) {
      held_back.insert(change.key_code);
      later->push_back(change);
    } else {
      now.push_back(change);
    }
  }
  batch->swap(now);
}

void TouchControls::SetScreen(int width, int height) {
  float w = static_cast<float>(width), h = static_cast<float>(height);
  float unit = std::min(w, h);
  float pad = unit * 0.17f, button = unit * 0.085f, margin = unit * 0.04f;
  circles_ = {
      {margin + pad, h - margin - pad, pad, 0},
      // Confirm under the thumb, cancel to its lower left, dash above.
      {w - margin - button, h - margin - button * 3.0f, button, kKeyConfirm},
      {w - margin - button * 3.2f, h - margin - button, button, kKeyCancel},
      {w - margin - button, h - margin - button * 5.6f, button * 0.8f, kKeyShift},
  };
}

std::set<int> TouchControls::KeysAt(float x, float y) const {
  for (const TouchCircle& circle : circles_) {
    float dx = x - circle.x, dy = y - circle.y;
    float distance = std::sqrt(dx * dx + dy * dy) / circle.radius;
    if (circle.key_code) {
      if (distance <= 1.0f) return {circle.key_code};
      continue;
    }
    if (distance > kPadReach) continue;
    if (distance < kPadNeutral) return {};
    // Eight directions: a direction is held while the finger is within 67.5
    // degrees of it, so the diagonals hold two.
    std::set<int> keys;
    float limit = std::cos(67.5f * 3.14159265f / 180.0f) * distance * circle.radius;
    if (dx < -limit) keys.insert(kKeyLeft);
    if (dx > limit) keys.insert(kKeyRight);
    if (dy < -limit) keys.insert(kKeyUp);
    if (dy > limit) keys.insert(kKeyDown);
    return keys;
  }
  return {};
}

void TouchControls::Place(long long finger, float x, float y) { held_by_finger_[finger] = KeysAt(x, y); }

void TouchControls::Lift(long long finger) { held_by_finger_.erase(finger); }

int TouchControls::Lit(const TouchCircle& circle) const {
  auto held = [this](int key) {
    for (const auto& finger : held_by_finger_) {
      if (finger.second.count(key)) return true;
    }
    return false;
  };
  if (circle.key_code) return held(circle.key_code) ? 1 : 0;
  return (held(kKeyLeft) ? kLitLeft : 0) | (held(kKeyUp) ? kLitUp : 0) | (held(kKeyRight) ? kLitRight : 0) |
         (held(kKeyDown) ? kLitDown : 0);
}

std::vector<KeyChange> TouchControls::TakeChanges() {
  std::set<int> held;
  for (const auto& finger : held_by_finger_) held.insert(finger.second.begin(), finger.second.end());
  std::vector<KeyChange> changes;
  for (int key : reported_) {
    if (!held.count(key)) changes.push_back({key, false});
  }
  for (int key : held) {
    if (!reported_.count(key)) changes.push_back({key, true});
  }
  reported_ = held;
  return changes;
}

}  // namespace mvp
