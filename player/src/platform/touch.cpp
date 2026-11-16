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

// Sizes of a control while editing, in units of the screen's shorter side.
constexpr float kSmallest = 0.04f, kBiggest = 0.3f, kSizeStep = 1.15f;

// The keys whose controls have a drawing of their own instead of a name.
bool HasOwnDrawing(int key_code) {
  return key_code == 0 || key_code == kKeyConfirm || key_code == kKeyCancel || key_code == kKeyShift;
}

bool Inside(const TouchShape& shape, float x, float y) {
  float dx = x - shape.x, dy = y - shape.y;
  return dx * dx + dy * dy <= shape.radius * shape.radius;
}

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

TouchControls::TouchControls() : layout_(DefaultTouchLayout()) {}

void TouchControls::SetScreen(int width, int height) {
  width_ = static_cast<float>(width);
  height_ = static_cast<float>(height);
  PlaceCircles();
}

void TouchControls::SetLayout(const std::vector<TouchControl>& layout) {
  layout_ = layout;
  chosen_ = -1;
  PlaceCircles();
}

void TouchControls::PlaceCircles() {
  float unit = std::min(width_, height_);
  circles_.clear();
  for (const TouchControl& control : layout_) {
    TouchCircle circle = {control.x < 0 ? width_ + control.x * unit : control.x * unit,
                          control.y < 0 ? height_ + control.y * unit : control.y * unit, control.size * unit,
                          control.key_code};
    KeepOnScreen(&circle);
    circles_.push_back(circle);
  }
}

// The layout that puts the controls where they are on this screen: each
// measured from the edge it is nearer to.
void TouchControls::StoreLayout() {
  float unit = std::min(width_, height_);
  if (unit <= 0) return;
  layout_.clear();
  for (const TouchCircle& circle : circles_) {
    layout_.push_back({circle.x < width_ / 2 ? circle.x / unit : (circle.x - width_) / unit,
                       circle.y < height_ / 2 ? circle.y / unit : (circle.y - height_) / unit, circle.radius / unit,
                       circle.key_code});
  }
  dirty_ = true;
}

void TouchControls::KeepOnScreen(TouchCircle* circle) const {
  if (width_ <= 0 || height_ <= 0) return;
  float radius = std::min(circle->radius, std::min(width_, height_) / 2);
  circle->x = std::max(radius, std::min(width_ - radius, circle->x));
  circle->y = std::max(radius, std::min(height_ - radius, circle->y));
}

void TouchControls::OfferMenu(bool offered) { menu_offered_ = offered; }

bool TouchControls::TakeMenuRequest() {
  bool requested = menu_requested_;
  menu_requested_ = false;
  return requested;
}

void TouchControls::StartEditing() {
  editing_ = true;
  dirty_ = false;
  chosen_ = -1;
  for (auto& finger : held_by_finger_) finger.second.clear();
}

bool TouchControls::TakeLayoutChanged() {
  bool changed = changed_;
  changed_ = false;
  return changed;
}

// The button that asks for the settings menu: small, in the top right
// corner, away from the thumbs.
TouchShape TouchControls::MenuButton() const {
  float unit = std::min(width_, height_);
  return {width_ - unit * 0.07f, unit * 0.07f, unit * 0.05f, -1, 0, "MENU"};
}

// The row of editing buttons, across the top.
std::vector<TouchShape> TouchControls::EditButtons() const {
  static const char* const names[] = {"ADD", "DEL", "-", "+", "RESET", "OK"};
  const int count = 6;
  float unit = std::min(width_, height_);
  float step = std::min(unit * 0.15f, width_ / count), radius = step * 0.42f;
  std::vector<TouchShape> buttons;
  for (int i = 0; i < count; i++) {
    buttons.push_back({width_ / 2 + (static_cast<float>(i) - (count - 1) / 2.0f) * step, radius * 1.3f, radius, -1, 0,
                       names[i]});
  }
  return buttons;
}

// The keys a new control can be given, as a grid under the editing buttons.
std::vector<TouchShape> TouchControls::KeyChoices() const {
  const std::vector<int>& keys = TouchKeyChoices();
  const int columns = 8;
  int rows = (static_cast<int>(keys.size()) + columns - 1) / columns;
  float top = EditButtons()[0].radius * 2.7f;
  float cell = std::min(width_ / columns, (height_ - top) / static_cast<float>(rows));
  float left = (width_ - cell * columns) / 2;
  std::vector<TouchShape> cells;
  for (size_t i = 0; i < keys.size(); i++) {
    float column = static_cast<float>(i % columns), row = static_cast<float>(i / columns);
    cells.push_back({left + (column + 0.5f) * cell, top + (row + 0.5f) * cell, cell * 0.45f, keys[i], 0,
                     TouchKeyLabel(keys[i])});
  }
  return cells;
}

std::vector<TouchShape> TouchControls::Shapes() const {
  std::vector<TouchShape> shapes;
  if (!choosing_) {
    for (size_t i = 0; i < circles_.size(); i++) {
      const TouchCircle& circle = circles_[i];
      // While editing, the chosen control is the lit one.
      int lit = !editing_ ? Lit(circle) : static_cast<int>(i) != chosen_ ? 0 : circle.key_code ? 1 : 15;
      shapes.push_back({circle.x, circle.y, circle.radius, circle.key_code, lit,
                        HasOwnDrawing(circle.key_code) ? "" : TouchKeyLabel(circle.key_code)});
    }
  }
  if (editing_) {
    for (const TouchShape& button : EditButtons()) shapes.push_back(button);
    if (choosing_) {
      for (const TouchShape& cell : KeyChoices()) shapes.push_back(cell);
    }
  } else if (menu_offered_) {
    shapes.push_back(MenuButton());
  }
  return shapes;
}

void TouchControls::Act(const std::string& button) {
  float unit = std::min(width_, height_);
  bool has_chosen = chosen_ >= 0 && chosen_ < static_cast<int>(circles_.size());
  if (button == "ADD") {
    choosing_ = true;
  } else if (button == "DEL") {
    if (!has_chosen) return;
    circles_.erase(circles_.begin() + chosen_);
    chosen_ = -1;
    StoreLayout();
  } else if (button == "-" || button == "+") {
    if (!has_chosen) return;
    TouchCircle& circle = circles_[chosen_];
    float radius = button == "+" ? circle.radius * kSizeStep : circle.radius / kSizeStep;
    circle.radius = std::max(unit * kSmallest, std::min(unit * kBiggest, radius));
    KeepOnScreen(&circle);
    StoreLayout();
  } else if (button == "RESET") {
    SetLayout(DefaultTouchLayout());
    dirty_ = true;
  } else if (button == "OK") {
    editing_ = false;
    chosen_ = -1;
    dragging_ = false;
    changed_ = changed_ || dirty_;
    dirty_ = false;
  }
}

// A finger while editing. `fresh` is its first contact; later ones are it
// sliding.
void TouchControls::Edit(long long finger, float x, float y, bool fresh) {
  if (!fresh) {
    if (dragging_ && finger == dragging_finger_ && chosen_ >= 0) {
      TouchCircle& circle = circles_[chosen_];
      circle.x = x + drag_dx_;
      circle.y = y + drag_dy_;
      KeepOnScreen(&circle);
      StoreLayout();
    }
    return;
  }
  if (choosing_) {
    choosing_ = false;
    for (const TouchShape& cell : KeyChoices()) {
      if (!Inside(cell, x, y)) continue;
      // The new control appears in the middle of the screen, chosen, ready
      // to be dragged to its place.
      float unit = std::min(width_, height_);
      circles_.push_back({width_ / 2, height_ / 2, unit * (cell.key_code ? 0.085f : 0.17f), cell.key_code});
      chosen_ = static_cast<int>(circles_.size()) - 1;
      StoreLayout();
      return;
    }
    return;
  }
  for (const TouchShape& button : EditButtons()) {
    if (Inside(button, x, y)) return Act(button.label);
  }
  // The control drawn last is on top.
  chosen_ = -1;
  dragging_ = false;
  for (int i = static_cast<int>(circles_.size()) - 1; i >= 0; i--) {
    const TouchCircle& circle = circles_[i];
    if (!Inside({circle.x, circle.y, circle.radius, 0, 0, ""}, x, y)) continue;
    chosen_ = i;
    dragging_ = true;
    dragging_finger_ = finger;
    drag_dx_ = circle.x - x;
    drag_dy_ = circle.y - y;
    return;
  }
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

void TouchControls::Place(long long finger, float x, float y) {
  bool fresh = !held_by_finger_.count(finger);
  if (!editing_ && menu_offered_ && fresh && Inside(MenuButton(), x, y)) {
    // Every key held is let go, and this finger does nothing more.
    menu_requested_ = true;
    held_by_finger_.clear();
    held_by_finger_[finger] = {};
    return;
  }
  if (editing_) {
    held_by_finger_[finger] = {};
    Edit(finger, x, y, fresh);
    return;
  }
  held_by_finger_[finger] = KeysAt(x, y);
}

void TouchControls::Lift(long long finger) {
  held_by_finger_.erase(finger);
  if (finger == dragging_finger_) dragging_ = false;
}

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
