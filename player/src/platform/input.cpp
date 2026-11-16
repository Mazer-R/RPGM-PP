#include "platform/input.h"

#include <SDL.h>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

#include "platform/button_map.h"
#include "platform/log.h"
#include "platform/settings_menu.h"
#include "platform/touch.h"

namespace mvp {
namespace {

// Browser key codes the engine maps to its actions by default:
// Z = confirm, X = cancel and menu, Shift = dash, Page Up/Down = previous/next.
constexpr int kKeyEnter = 13, kKeyShift = 16, kKeyEscape = 27, kKeySpace = 32;
constexpr int kKeyPageUp = 33, kKeyPageDown = 34;
constexpr int kKeyLeft = 37, kKeyUp = 38, kKeyRight = 39, kKeyDown = 40;
constexpr int kKeyX = 88, kKeyZ = 90;
constexpr int kKeyF2 = 113;  // shows or hides the frame-rate display

// How far the stick must be pushed (of 32767) to count as a direction.
constexpr int kStickThreshold = 16000;

// Start must follow the menu button within this time to count as "quit".
constexpr unsigned kQuitWindowMs = 3000;

// A phone's Back button held this long leaves the game.
constexpr unsigned kBackHoldMs = 1000;

// The direction pad always presses the arrow keys; 0 for any other button.
int KeyForDirection(int button) {
  switch (button) {
    case SDL_CONTROLLER_BUTTON_DPAD_LEFT: return kKeyLeft;
    case SDL_CONTROLLER_BUTTON_DPAD_UP: return kKeyUp;
    case SDL_CONTROLLER_BUTTON_DPAD_RIGHT: return kKeyRight;
    case SDL_CONTROLLER_BUTTON_DPAD_DOWN: return kKeyDown;
    default: return 0;
  }
}

// What a key does in the settings menu; -1 for nothing. The menu is worked
// the same way whatever the game's buttons have been set to.
int MenuInputForKey(int key_code) {
  switch (key_code) {
    case kKeyLeft: return static_cast<int>(MenuInput::kLeft);
    case kKeyUp: return static_cast<int>(MenuInput::kUp);
    case kKeyRight: return static_cast<int>(MenuInput::kRight);
    case kKeyDown: return static_cast<int>(MenuInput::kDown);
    case kKeyEnter: case kKeySpace: case kKeyZ: return static_cast<int>(MenuInput::kConfirm);
    case kKeyEscape: case kKeyX: return static_cast<int>(MenuInput::kCancel);
    default: return -1;
  }
}

std::string ReadFile(const std::string& path, bool* found) {
  std::ifstream file(path);
  *found = static_cast<bool>(file);
  std::stringstream text;
  if (file) text << file.rdbuf();
  return text.str();
}

// A keyboard key as the code a browser reports for it; 0 if not passed on.
int KeyForKeyboard(SDL_Keycode key) {
  if (key >= SDLK_a && key <= SDLK_z) return 65 + (key - SDLK_a);
  if (key >= SDLK_0 && key <= SDLK_9) return 48 + (key - SDLK_0);
  if (key >= SDLK_F1 && key <= SDLK_F12) return 112 + (key - SDLK_F1);
  switch (key) {
    case SDLK_RETURN: case SDLK_KP_ENTER: return kKeyEnter;
    case SDLK_ESCAPE: return kKeyEscape;
    case SDLK_AC_BACK: return kKeyEscape;  // a phone's Back button
    case SDLK_SPACE: return kKeySpace;
    case SDLK_LSHIFT: case SDLK_RSHIFT: return kKeyShift;
    case SDLK_LCTRL: case SDLK_RCTRL: return 17;
    case SDLK_LALT: case SDLK_RALT: return 18;
    case SDLK_TAB: return 9;
    case SDLK_BACKSPACE: return 8;
    case SDLK_INSERT: return 45;
    case SDLK_PAGEUP: return kKeyPageUp;
    case SDLK_PAGEDOWN: return kKeyPageDown;
    case SDLK_LEFT: return kKeyLeft;
    case SDLK_UP: return kKeyUp;
    case SDLK_RIGHT: return kKeyRight;
    case SDLK_DOWN: return kKeyDown;
    default: return 0;
  }
}

}  // namespace

Input::Input(Log& log)
    : log_(log), touch_(new TouchControls), buttons_(new ButtonMap), menu_(new SettingsMenu(buttons_.get())) {
#ifdef __ANDROID__
  // A phone has no other controls until a controller or keyboard shows up.
  touch_visible_ = true;
#endif
}

void Input::SetScreenSize(int width, int height) {
  screen_width_ = width;
  screen_height_ = height;
  touch_->SetScreen(width, height);
}

void Input::SetSettingsDir(const std::string& dir) {
  settings_dir_ = dir;
  touch_->OfferMenu(true);
  bool found = false;
  std::string text = ReadFile(dir + "/touch-controls.txt", &found);
  if (found) {
    touch_->SetLayout(ParseTouchLayout(text));
    log_.Write(LogLevel::kInfo, "input", std::to_string(touch_->layout().size()) + " touch controls from " + dir);
  }
  text = ReadFile(dir + "/buttons.txt", &found);
  if (found) {
    *buttons_ = ButtonMap::Parse(text);
    log_.Write(LogLevel::kInfo, "input", "controller buttons from " + dir);
  }
}

std::vector<TouchShape> Input::TouchShapes() const {
  return touch_visible_ && !pointer_mode_ && !menu_->open() ? touch_->Shapes() : std::vector<TouchShape>();
}

bool Input::menu_open() const { return menu_->open(); }

void Input::MenuPicture(std::vector<MenuBox>* boxes, std::vector<MenuText>* texts) const {
  menu_->Picture(screen_width_, screen_height_, boxes, texts);
}

namespace {
void Save(Log& log, const std::string& path, const std::string& text, const char* what) {
  std::ofstream file(path, std::ios::trunc);
  file << text;
  log.Write(file ? LogLevel::kInfo : LogLevel::kWarning, "input",
            std::string(file ? "saved the " : "cannot save the ") + what + " to " + path);
}
}  // namespace

// Passes on what the fingers now hold, opens the menu when its touch control
// asked for it, and saves the layout when an edit of it has just ended.
void Input::AfterTouch() {
  for (const KeyChange& change : touch_->TakeChanges()) Queue(change.key_code, change.down);
  if (touch_->TakeMenuRequest()) OpenMenu();
  if (touch_->TakeLayoutChanged() && !settings_dir_.empty()) {
    Save(log_, settings_dir_ + "/touch-controls.txt", FormatTouchLayout(touch_->layout()), "touch controls");
  }
}

// The game is told that every key it believes down has been let go: it will
// not see the releases that happen while the menu is open.
void Input::OpenMenu() {
  if (settings_dir_.empty() || menu_->open()) return;
  std::vector<int> down = keys_down_;
  for (int key : down) Queue(key, false);
  // The stick and the triggers start afresh once the menu closes.
  for (bool& held : stick_) held = false;
  for (bool& held : trigger_) held = false;
  menu_->Open(touch_visible_);
}

void Input::MenuPress(int input) {
  if (input >= 0) MenuEffectDone(static_cast<int>(menu_->Press(static_cast<MenuInput>(input))));
}

void Input::MenuEffectDone(int effect) {
  switch (static_cast<MenuEffect>(effect)) {
    case MenuEffect::kToggleFps:
      // The frame counter belongs to the scripts, which switch it on F2.
      changes_.push_back({kKeyF2, true});
      changes_.push_back({kKeyF2, false});
      break;
    case MenuEffect::kEditTouch:
      touch_visible_ = true;
      touch_->StartEditing();
      break;
    case MenuEffect::kQuit:
      quit_requested_ = true;
      break;
    case MenuEffect::kButtonsChanged:
      Save(log_, settings_dir_ + "/buttons.txt", buttons_->Format(), "controller buttons");
      break;
    case MenuEffect::kNone:
    case MenuEffect::kClose:
      break;
  }
}

// An event while the menu is open: it works the menu, and nothing reaches
// the game.
void Input::HandleMenuEvent(const SDL_Event& event) {
  switch (event.type) {
    case SDL_FINGERDOWN:
      touch_visible_ = true;
      MenuEffectDone(static_cast<int>(menu_->Touch(event.tfinger.x * static_cast<float>(screen_width_),
                                                   event.tfinger.y * static_cast<float>(screen_height_),
                                                   screen_width_, screen_height_)));
      break;
    case SDL_CONTROLLERBUTTONDOWN:
      if (event.cbutton.button == SDL_CONTROLLER_BUTTON_A) MenuPress(static_cast<int>(MenuInput::kConfirm));
      else if (event.cbutton.button == SDL_CONTROLLER_BUTTON_B) MenuPress(static_cast<int>(MenuInput::kCancel));
      else MenuPress(MenuInputForKey(KeyForDirection(event.cbutton.button)));
      break;
    case SDL_KEYDOWN:
      if (!event.key.repeat) MenuPress(MenuInputForKey(KeyForKeyboard(event.key.keysym.sym)));
      break;
    default:
      break;
  }
}

void Input::SetTrigger(int index, bool down) {
  if (trigger_[index] == down) return;
  trigger_[index] = down;
  Queue(buttons_->KeyFor(index == 0 ? "lefttrigger" : "righttrigger"), down);
}

Input::~Input() {
  for (SDL_GameController* controller : controllers_) SDL_GameControllerClose(controller);
  SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER);
}

void Input::Open() {
  if (SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER) != 0) {
    log_.Write(LogLevel::kWarning, "input", std::string("no controller support: ") + SDL_GetError());
    return;
  }
  // Button layouts of handheld consoles come from the system's list. SDL
  // reads the file named by SDL_GAMECONTROLLERCONFIG_FILE by itself; when a
  // launcher has not set it, the usual system locations are tried.
  if (!std::getenv("SDL_GAMECONTROLLERCONFIG_FILE")) {
    for (const char* path : {"/usr/lib/gamecontrollerdb.txt", "/usr/share/sdl2/gamecontrollerdb.txt"}) {
      int added = SDL_GameControllerAddMappingsFromFile(path);
      if (added > 0) {
        log_.Write(LogLevel::kInfo, "input", std::to_string(added) + " controller layouts from " + path);
        break;
      }
    }
  }
  for (int i = 0; i < SDL_NumJoysticks(); i++) OpenController(i);
  if (controllers_.empty()) log_.Write(LogLevel::kInfo, "input", "no controller found; keyboard only");
}

void Input::OpenController(int device_index) {
  const char* name = SDL_JoystickNameForIndex(device_index);
  std::string label = name ? name : "unnamed";
  if (!SDL_IsGameController(device_index)) {
    log_.Write(LogLevel::kWarning, "input", "controller without a known button layout, ignored: " + label);
    return;
  }
  SDL_GameController* controller = SDL_GameControllerOpen(device_index);
  if (!controller) {
    log_.Write(LogLevel::kWarning, "input", "cannot open controller " + label + ": " + SDL_GetError());
    return;
  }
  controllers_.push_back(controller);
  log_.Write(LogLevel::kInfo, "input", "controller: " + label);
}

void Input::Queue(int key_code, bool down) {
  if (!key_code) return;
  changes_.push_back({key_code, down});
  auto held = std::find(keys_down_.begin(), keys_down_.end(), key_code);
  if (down && held == keys_down_.end()) keys_down_.push_back(key_code);
  if (!down && held != keys_down_.end()) keys_down_.erase(held);
}

void Input::SetStickDirection(int index, bool down) {
  static const int keys[4] = {kKeyLeft, kKeyUp, kKeyRight, kKeyDown};
  if (stick_[index] == down) return;
  stick_[index] = down;
  Queue(keys[index], down);
}

std::vector<PointerChange> Input::TakePointerChanges() {
  std::vector<PointerChange> taken;
  taken.swap(pointer_changes_);
  return taken;
}

// Pointer mode: follows one finger, or the mouse's left button, from going
// down to coming up. Returns whether the event was a finger or mouse event,
// which then goes no further. The mouse events SDL makes up for a finger
// are left out: the finger itself is followed.
bool Input::HandlePointerEvent(const SDL_Event& event) {
  switch (event.type) {
    case SDL_FINGERDOWN:
    case SDL_FINGERMOTION:
    case SDL_FINGERUP: {
      long long finger = static_cast<long long>(event.tfinger.fingerId);
      bool down = event.type == SDL_FINGERDOWN;
      if (down ? pointer_down_ : !(pointer_down_ && pointer_is_finger_ && pointer_finger_ == finger)) return true;
      if (down) {
        pointer_down_ = true;
        pointer_is_finger_ = true;
        pointer_finger_ = finger;
      }
      if (event.type == SDL_FINGERUP) pointer_down_ = false;
      // Finger positions come as fractions of the screen.
      pointer_changes_.push_back({down ? 0 : event.type == SDL_FINGERMOTION ? 1 : 2,
                                  event.tfinger.x * static_cast<float>(screen_width_),
                                  event.tfinger.y * static_cast<float>(screen_height_)});
      return true;
    }
    case SDL_MOUSEBUTTONDOWN:
    case SDL_MOUSEBUTTONUP: {
      if (event.button.which == SDL_TOUCH_MOUSEID || event.button.button != SDL_BUTTON_LEFT) return true;
      bool down = event.type == SDL_MOUSEBUTTONDOWN;
      if (down ? pointer_down_ : !(pointer_down_ && !pointer_is_finger_)) return true;
      pointer_down_ = down;
      pointer_is_finger_ = false;
      pointer_changes_.push_back({down ? 0 : 2, static_cast<float>(event.button.x), static_cast<float>(event.button.y)});
      return true;
    }
    case SDL_MOUSEMOTION:
      if (event.motion.which != SDL_TOUCH_MOUSEID && pointer_down_ && !pointer_is_finger_) {
        pointer_changes_.push_back({1, static_cast<float>(event.motion.x), static_cast<float>(event.motion.y)});
      }
      return true;
    default:
      return false;
  }
}

void Input::HandleEvent(const SDL_Event& event) {
  if (pointer_mode_ && HandlePointerEvent(event)) return;
  // The menu button is followed even while the menu is open, so that menu
  // button + Start still leaves the game from there.
  bool guide_event = (event.type == SDL_CONTROLLERBUTTONDOWN || event.type == SDL_CONTROLLERBUTTONUP) &&
                     (event.cbutton.button == SDL_CONTROLLER_BUTTON_GUIDE ||
                      (guide_down_ && event.cbutton.button == SDL_CONTROLLER_BUTTON_START));
  if (menu_->open() && !guide_event && event.type != SDL_CONTROLLERDEVICEADDED) {
    // A finger lifted or a button let go still has to be forgotten.
    if (event.type == SDL_FINGERUP) touch_->Lift(event.tfinger.fingerId);
    HandleMenuEvent(event);
    return;
  }
  switch (event.type) {
    case SDL_CONTROLLERDEVICEADDED:
      // Also sent at start-up for controllers already opened in Open().
      if (!SDL_GameControllerFromInstanceID(SDL_JoystickGetDeviceInstanceID(event.cdevice.which))) {
        OpenController(event.cdevice.which);
      }
      break;
    case SDL_FINGERDOWN:
    case SDL_FINGERMOTION:
      // Finger positions come as fractions of the screen.
      touch_visible_ = true;
      touch_->Place(event.tfinger.fingerId, event.tfinger.x * static_cast<float>(screen_width_),
                    event.tfinger.y * static_cast<float>(screen_height_));
      AfterTouch();
      break;
    case SDL_FINGERUP:
      touch_->Lift(event.tfinger.fingerId);
      AfterTouch();
      break;
    case SDL_CONTROLLERBUTTONDOWN:
    case SDL_CONTROLLERBUTTONUP: {
      bool down = event.type == SDL_CONTROLLERBUTTONDOWN;
      touch_visible_ = false;
      if (event.cbutton.button == SDL_CONTROLLER_BUTTON_GUIDE) {
        guide_down_ = down;
        if (down) guide_down_at_ms_ = event.cbutton.timestamp;
        log_.Write(LogLevel::kInfo, "input", down ? "menu button down" : "menu button up");
      } else if (guide_down_ && event.cbutton.button == SDL_CONTROLLER_BUTTON_BACK) {
        // Menu button + Select: the frame-rate display, as the F2 key.
        Queue(kKeyF2, down);
      } else if (down && guide_down_ && event.cbutton.button == SDL_CONTROLLER_BUTTON_START &&
                 event.cbutton.timestamp - guide_down_at_ms_ <= kQuitWindowMs) {
        // The time limit guards against a menu button whose release was never
        // reported (the system may keep that event for itself): without it,
        // the next Start press, however much later, would quit the game.
        quit_requested_ = true;
      } else if (guide_down_ && event.cbutton.button == SDL_CONTROLLER_BUTTON_X) {
        // Menu button + X: the player's settings menu.
        if (down) OpenMenu();
      } else if (int direction = KeyForDirection(event.cbutton.button)) {
        Queue(direction, down);
      } else {
        const char* name = SDL_GameControllerGetStringForButton(
            static_cast<SDL_GameControllerButton>(event.cbutton.button));
        Queue(name ? buttons_->KeyFor(name) : 0, down);
      }
      break;
    }
    case SDL_CONTROLLERAXISMOTION: {
      int value = event.caxis.value;
      if (event.caxis.axis == SDL_CONTROLLER_AXIS_LEFTX) {
        SetStickDirection(0, value < -kStickThreshold);
        SetStickDirection(2, value > kStickThreshold);
      } else if (event.caxis.axis == SDL_CONTROLLER_AXIS_LEFTY) {
        SetStickDirection(1, value < -kStickThreshold);
        SetStickDirection(3, value > kStickThreshold);
      } else if (event.caxis.axis == SDL_CONTROLLER_AXIS_TRIGGERLEFT) {
        SetTrigger(0, value > kStickThreshold);
      } else if (event.caxis.axis == SDL_CONTROLLER_AXIS_TRIGGERRIGHT) {
        SetTrigger(1, value > kStickThreshold);
      }
      break;
    }
    case SDL_KEYDOWN:
    case SDL_KEYUP:
      // A phone's Back button is a key too, and is used along with the touch
      // controls; any other key means a keyboard is in use.
      if (event.key.keysym.sym != SDLK_AC_BACK) touch_visible_ = false;
      // Back held for a second leaves the game, as menu + Start does on a
      // console; a short press is cancel.
      if (event.key.keysym.sym == SDLK_AC_BACK && !event.key.repeat) {
        // A release whose press went to the settings menu does not count.
        if (event.type == SDL_KEYDOWN) back_down_at_ms_ = event.key.timestamp;
        else if (back_down_ && event.key.timestamp - back_down_at_ms_ >= kBackHoldMs) quit_requested_ = true;
        back_down_ = event.type == SDL_KEYDOWN;
      }
      // F1 belongs to the player: its settings menu.
      if (event.key.keysym.sym == SDLK_F1) {
        if (event.type == SDL_KEYDOWN && !event.key.repeat) OpenMenu();
        break;
      }
      if (!event.key.repeat) Queue(KeyForKeyboard(event.key.keysym.sym), event.type == SDL_KEYDOWN);
      break;
    default:
      break;
  }
}

std::vector<KeyChange> Input::TakeChanges() {
  // What was held back last time comes first; see HoldQuickReleases.
  std::vector<KeyChange> taken;
  taken.swap(held_back_);
  taken.insert(taken.end(), changes_.begin(), changes_.end());
  changes_.clear();
  HoldQuickReleases(&taken, &held_back_);
  return taken;
}

}  // namespace mvp
