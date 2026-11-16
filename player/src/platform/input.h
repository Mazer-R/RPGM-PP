// The controls. Reads the console's buttons (through SDL2's game controller
// layer, which knows each device's button layout) and a keyboard, and turns
// both into the key presses the game's engine already understands: the key
// codes a browser reports for a keyboard.
#pragma once

#include <memory>
#include <string>
#include <vector>

union SDL_Event;
struct _SDL_GameController;

namespace mvp {

class Log;
class ButtonMap;
class SettingsMenu;
class TouchControls;
struct MenuBox;
struct MenuText;
struct TouchShape;

// One key going down or up, as a browser key code (for example 37 = left).
struct KeyChange {
  int key_code;
  bool down;
};

// A finger or the mouse on the screen, for a script that asked for them:
// phase 0 = put down, 1 = moved while down, 2 = lifted; x, y in screen
// pixels from the top left.
struct PointerChange {
  int phase;
  float x, y;
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
  // The folder a game's settings are kept in. Its touch controls
  // (touch-controls.txt) and button map (buttons.txt) are read now, if they
  // exist. From then on the player's settings menu can be opened over the
  // game, and what is changed there is written back. Without a folder there
  // is no menu, and controls and buttons are the standard ones.
  void SetSettingsDir(const std::string& dir);
  // The touch controls to draw: empty unless a finger was the last thing
  // used (on Android also at the start, before anything has been used), and
  // while the settings menu is open.
  std::vector<TouchShape> TouchShapes() const;
  // The settings menu: opened with the console's menu button + X, the F1
  // key, or the MENU touch control. While it is open the game should wait,
  // and no key reaches it.
  bool menu_open() const;
  void MenuPicture(std::vector<MenuBox>* boxes, std::vector<MenuText>* texts) const;
  // In pointer mode the first finger on the screen, and the mouse's left
  // button, are passed on as they are (TakePointerChanges) instead of
  // working the on-screen touch controls, which are then not shown. The
  // game list uses it: its lines are touched directly.
  void SetPointerMode(bool on) { pointer_mode_ = on; }
  std::vector<PointerChange> TakePointerChanges();
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
  bool back_down_ = false;         // a phone's Back button is down, and the game saw it go down
  unsigned back_down_at_ms_ = 0;   // SDL ticks when it went down
  bool quit_requested_ = false;
  bool stick_[4] = {false, false, false, false};  // left, up, right, down
  void AfterTouch();
  void OpenMenu();
  // One input for the open menu, and what follows from it.
  void MenuPress(int input);
  void MenuEffectDone(int effect);
  void HandleMenuEvent(const SDL_Event& event);
  void SetTrigger(int index, bool down);

  std::unique_ptr<TouchControls> touch_;
  std::unique_ptr<ButtonMap> buttons_;
  std::unique_ptr<SettingsMenu> menu_;
  std::string settings_dir_;
  std::vector<int> keys_down_;  // keys the game has been told are down
  bool trigger_[2] = {false, false};  // left, right
  bool touch_visible_ = false;
  bool pointer_mode_ = false;
  bool pointer_down_ = false;      // the finger or mouse button being followed is down
  bool pointer_is_finger_ = false;
  long long pointer_finger_ = 0;   // which finger, while one is followed
  std::vector<PointerChange> pointer_changes_;
  bool HandlePointerEvent(const SDL_Event& event);
  int screen_width_ = 0, screen_height_ = 0;
};

}  // namespace mvp
