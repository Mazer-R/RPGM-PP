// A pointer worked with the direction pad, for a game made for the mouse on
// a device that has neither mouse nor touch screen. While it is on, the
// directions move a cursor over the screen instead of reaching the game, and
// the confirm button is the mouse's left button at the cursor's place.
// Everything else (cancel, which both engines treat as the right button; the
// other buttons) stays as it is. This file knows nothing about SDL or
// drawing: keys and time go in, pointer changes and a place come out.
#pragma once

#include <vector>

#include "platform/input.h"

namespace mvp {

class PadCursor {
 public:
  // The screen's size in pixels. The cursor starts in the middle.
  void SetScreen(int width, int height);
  bool on() const { return on_; }
  // Switching it off lets go of the button if it is held.
  void SetOn(bool on, std::vector<PointerChange>* out);

  // A key going down or up. Returns true when the cursor took it (a
  // direction or confirm, while on): the game must then not see it.
  bool Key(int key_code, bool down, std::vector<PointerChange>* out);
  // Time passing: moves the cursor while a direction is held. It starts
  // slowly, for small targets, and speeds up while held.
  void Advance(double seconds, std::vector<PointerChange>* out);
  // Lets go of everything held, as when the player's menu opens.
  void Release(std::vector<PointerChange>* out);

  float x() const { return x_; }
  float y() const { return y_; }

 private:
  bool on_ = false, pressed_ = false;
  bool held_[4] = {false, false, false, false};  // left, up, right, down
  double held_for_ = 0;  // seconds a direction has been held
  float x_ = 0, y_ = 0;
  int width_ = 0, height_ = 0;
};

}  // namespace mvp
