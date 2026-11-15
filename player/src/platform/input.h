// The controls. Reads the console's buttons (through SDL2's game controller
// layer, which knows each device's button layout) and a keyboard, and turns
// both into the key presses the game's engine already understands: the key
// codes a browser reports for a keyboard.
#pragma once

#include <vector>

union SDL_Event;
struct _SDL_GameController;

namespace mvp {

class Log;

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
  // Looks at one SDL event; key changes are queued.
  void HandleEvent(const SDL_Event& event);
  // Returns the queued key changes, oldest first, and empties the queue.
  std::vector<KeyChange> TakeChanges();
  // True once the player's own quit combination has been pressed: the
  // console's menu button held, then Start within a few seconds.
  bool quit_requested() const { return quit_requested_; }

 private:
  void Queue(int key_code, bool down);
  void OpenController(int device_index);
  void SetStickDirection(int key_code, bool down);

  Log& log_;
  std::vector<KeyChange> changes_;
  std::vector<_SDL_GameController*> controllers_;
  bool guide_down_ = false;
  unsigned guide_down_at_ms_ = 0;  // SDL ticks when the menu button went down
  bool quit_requested_ = false;
  bool stick_[4] = {false, false, false, false};  // left, up, right, down
};

}  // namespace mvp
