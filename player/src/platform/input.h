// The controls. Reads the console's buttons (through SDL2's game controller
// layer, which knows each device's button layout) and a keyboard, and turns
// both into the key presses the game's engine already understands: the key
// codes a browser reports for a keyboard.
#pragma once

#include <memory>
#include <vector>

union SDL_Event;
struct _SDL_GameController;

namespace mvp {

class Log;
class TouchControls;
struct TouchCircle;

// One key going down or up, as a browser key code (for example 37 = left).
struct KeyChange {
  int key_code;
  bool down;
};

class Input {
 public:
  explicit Input(Log& log);
  ~Input();
  Input(const Input&) = delete;
  Input& operator=(const Input&) = delete;

  // Starts the controller layer and opens the controllers already plugged in.
  void Open();
  // The screen's size in pixels, which places the on-screen touch controls.
  void SetScreenSize(int width, int height);
  // The touch controls to draw: empty unless a finger was the last thing
  // used (on Android also at the start, before anything has been used).
  const std::vector<TouchCircle>& VisibleTouchControls() const;
  // Looks at one SDL event; key changes are queued.
  void HandleEvent(const SDL_Event& event);
  // Returns the queued key changes, oldest first, and empties the queue.
  std::vector<KeyChange> TakeChanges();
  // True once the player's own quit combination has been pressed: the
  // console's menu button held, then Start within a few seconds; or a
  // phone's Back button held for a second.
  bool quit_requested() const { return quit_requested_; }

 private:
  void Queue(int key_code, bool down);
  void OpenController(int device_index);
  void SetStickDirection(int key_code, bool down);

  Log& log_;
  std::vector<KeyChange> changes_;
  std::vector<KeyChange> held_back_;  // releases waiting for the next frame
  std::vector<_SDL_GameController*> controllers_;
  bool guide_down_ = false;
  unsigned guide_down_at_ms_ = 0;  // SDL ticks when the menu button went down
  unsigned back_down_at_ms_ = 0;   // SDL ticks when a phone's Back button went down
  bool quit_requested_ = false;
  bool stick_[4] = {false, false, false, false};  // left, up, right, down
  std::unique_ptr<TouchControls> touch_;
  bool touch_visible_ = false;
  int screen_width_ = 0, screen_height_ = 0;
};

}  // namespace mvp
