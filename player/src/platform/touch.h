// On-screen controls for a touch screen: a direction pad on the left and
// three buttons on the right. Fingers go in, the same key presses a keyboard
// or controller produces come out. This file knows nothing about SDL or
// drawing: it only places the controls for a screen size and decides which
// keys the fingers currently hold.
#pragma once

#include <map>
#include <set>
#include <vector>

#include "platform/input.h"

namespace mvp {

// A round control, in screen pixels from the top-left corner. key_code is
// the browser key code it presses; 0 for the direction pad, which presses
// one or two of the arrow keys depending on where it is touched.
struct TouchCircle {
  float x, y, radius;
  int key_code;
};

// The game looks at which keys are down once per frame. A key pressed and
// let go within one frame (a quick tap on a touch screen) would never be seen
// as down. This moves such a release, and whatever follows it for that key,
// from `batch` (one frame's changes, oldest first) to `later`, to be
// delivered with the next frame's changes.
void HoldQuickReleases(std::vector<KeyChange>* batch, std::vector<KeyChange>* later);

class TouchControls {
 public:
  // Places the controls for a screen of this size. Sizes follow the screen's
  // shorter side, so they are the same physical proportion on any screen.
  void SetScreen(int width, int height);
  const std::vector<TouchCircle>& circles() const { return circles_; }

  // A finger touching, sliding to, or leaving the screen. Fingers are told
  // apart by `finger`. A finger that slides from one control to another
  // lets go of the first and presses the second.
  void Place(long long finger, float x, float y);
  void Lift(long long finger);

  // Key changes since the last call, releases first.
  std::vector<KeyChange> TakeChanges();

 private:
  std::set<int> KeysAt(float x, float y) const;

  std::vector<TouchCircle> circles_;
  std::map<long long, std::set<int>> held_by_finger_;
  std::set<int> reported_;  // keys reported as down so far
};

}  // namespace mvp
