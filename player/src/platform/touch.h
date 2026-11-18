// On-screen controls for a touch screen: by default a direction pad on the
// left and three buttons on the right (confirm, cancel or menu, and dash).
// Fingers go in, the same key presses a keyboard or controller produces come
// out. This file knows nothing about SDL or drawing: it only places the
// controls for a screen size, decides which keys the fingers currently hold,
// and says what there is to draw.
//
// A small MENU button asks for the player's settings menu, from which the
// controls can be changed on the screen itself. While editing, no key is
// pressed: a finger drags a control to a new place, and a row of buttons
// adds a control for any key, removes the chosen one, changes its size, or
// brings the standard layout back.
#pragma once

#include <map>
#include <set>
#include <string>
#include <vector>

#include "platform/input.h"
#include "platform/touch_layout.h"

namespace mvp {

// A round control, in screen pixels from the top-left corner. key_code is
// the browser key code it presses, or one of the two movement controls
// (kTouchPad, kTouchStick), which press one or two of the arrow keys.
struct TouchCircle {
  float x, y, radius;
  int key_code;
};

// Something to draw: a control, or one of the editing buttons. `label` is the
// text to write on it; empty for the controls that have a drawing of their
// own (the pad, confirm, cancel and dash, told apart by key_code). `lit` is
// as Lit() gives it.
struct TouchShape {
  float x, y, radius;
  int key_code;
  int lit;
  std::string label;
  // For the stick: where its knob is, in radii from its middle, x to the
  // right and y down.
  float knob_x = 0, knob_y = 0;
};

// What Lit() answers for the direction pad: one bit per arm being held.
constexpr int kLitLeft = 1, kLitUp = 2, kLitRight = 4, kLitDown = 8;

// The game looks at which keys are down once per frame. A key pressed and
// let go within one frame (a quick tap on a touch screen) would never be seen
// as down. This moves such a release, and whatever follows it for that key,
// from `batch` (one frame's changes, oldest first) to `later`, to be
// delivered with the next frame's changes.
void HoldQuickReleases(std::vector<KeyChange>* batch, std::vector<KeyChange>* later);

class TouchControls {
 public:
  TouchControls();

  // Places the controls for a screen of this size. Sizes follow the screen's
  // shorter side, so they are the same physical proportion on any screen.
  void SetScreen(int width, int height);
  const std::vector<TouchCircle>& circles() const { return circles_; }

  // The controls there are; the standard ones until told otherwise.
  void SetLayout(const std::vector<TouchControl>& layout);
  const std::vector<TouchControl>& layout() const { return layout_; }

  // Which movement control the layout has: the stick, or the pad. Changing
  // it keeps the control's place and size, and is something to save.
  bool move_stick() const;
  void SetMoveStick(bool stick);

  // Whether the MENU button is offered. Off at first.
  void OfferMenu(bool offered);
  // True once after the MENU button has been touched. Every key held was
  // let go.
  bool TakeMenuRequest();
  void StartEditing();
  bool editing() const { return editing_; }
  // True once after an edit that changed the layout has been ended with OK:
  // the moment to save layout().
  bool TakeLayoutChanged();

  // Everything to draw, bottom first.
  std::vector<TouchShape> Shapes() const;

  // A finger touching, sliding to, or leaving the screen. Fingers are told
  // apart by `finger`. A finger that slides from one control to another
  // lets go of the first and presses the second.
  void Place(long long finger, float x, float y);
  void Lift(long long finger);
  // Whether this finger, now on the screen, is the game's own: it landed on
  // none of these controls (with the stick, that means in the right half),
  // and presses nothing until it lifts.
  bool ForGame(long long finger) const { return game_fingers_.count(finger) > 0; }

  // Whether a finger is on a control right now, for drawing it lit: 1 for a
  // button; for the direction pad, the kLit bits of the arms being held.
  int Lit(const TouchCircle& circle) const;

  // Key changes since the last call, releases first.
  std::vector<KeyChange> TakeChanges();

 private:
  std::set<int> KeysAt(float x, float y) const;
  int StickIndex() const;
  std::set<int> StickKeys(float x, float y);
  void PlaceCircles();
  void StoreLayout();
  void Edit(long long finger, float x, float y, bool fresh);
  void Act(const std::string& button);
  void KeepOnScreen(TouchCircle* circle) const;
  std::vector<TouchShape> EditButtons() const;
  std::vector<TouchShape> KeyChoices() const;
  TouchShape MenuButton() const;

  float width_ = 0, height_ = 0;
  std::vector<TouchControl> layout_;
  std::vector<TouchCircle> circles_;  // layout_ on this screen, in the same order
  bool menu_offered_ = false, menu_requested_ = false, editing_ = false;
  bool choosing_ = false;   // the list of keys for a new control is open
  bool dirty_ = false;      // this edit changed something
  bool changed_ = false;    // an ended edit left something to save
  int chosen_ = -1;         // index of the control the editing buttons act on
  long long dragging_finger_ = -1;
  bool dragging_ = false;
  float drag_dx_ = 0, drag_dy_ = 0;
  std::map<long long, std::set<int>> held_by_finger_;
  std::set<long long> game_fingers_;
  bool OnControl(float x, float y) const;
  std::set<int> reported_;  // keys reported as down so far
  // The stick while a thumb is on it: whose thumb, where the stick is, and
  // its knob in radii from there.
  long long stick_finger_ = -1;
  float stick_x_ = 0, stick_y_ = 0, knob_x_ = 0, knob_y_ = 0;
};

}  // namespace mvp
