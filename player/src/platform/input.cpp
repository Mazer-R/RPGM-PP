#include "platform/input.h"

#include <SDL.h>

#include <cstdlib>
#include <string>

#include "platform/log.h"
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

// The layout follows the engine's own gamepad defaults: A confirms, B
// cancels, X dashes, Y opens the menu, the shoulders page.
int KeyForButton(int button) {
  switch (button) {
    case SDL_CONTROLLER_BUTTON_A: return kKeyZ;
    case SDL_CONTROLLER_BUTTON_B: return kKeyX;
    case SDL_CONTROLLER_BUTTON_X: return kKeyShift;
    case SDL_CONTROLLER_BUTTON_Y: return kKeyEscape;
    case SDL_CONTROLLER_BUTTON_START: return kKeyEnter;
    case SDL_CONTROLLER_BUTTON_BACK: return kKeyEscape;
    case SDL_CONTROLLER_BUTTON_LEFTSHOULDER: return kKeyPageUp;
    case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER: return kKeyPageDown;
    case SDL_CONTROLLER_BUTTON_DPAD_LEFT: return kKeyLeft;
    case SDL_CONTROLLER_BUTTON_DPAD_UP: return kKeyUp;
    case SDL_CONTROLLER_BUTTON_DPAD_RIGHT: return kKeyRight;
    case SDL_CONTROLLER_BUTTON_DPAD_DOWN: return kKeyDown;
    default: return 0;
  }
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

Input::Input(Log& log) : log_(log), touch_(new TouchControls) {
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

const std::vector<TouchCircle>& Input::VisibleTouchControls() const {
  static const std::vector<TouchCircle> none;
  return touch_visible_ ? touch_->circles() : none;
}

int Input::TouchLit(const TouchCircle& control) const { return touch_->Lit(control); }

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
  if (key_code) changes_.push_back({key_code, down});
}

void Input::SetStickDirection(int index, bool down) {
  static const int keys[4] = {kKeyLeft, kKeyUp, kKeyRight, kKeyDown};
  if (stick_[index] == down) return;
  stick_[index] = down;
  Queue(keys[index], down);
}

void Input::HandleEvent(const SDL_Event& event) {
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
      for (const KeyChange& change : touch_->TakeChanges()) Queue(change.key_code, change.down);
      break;
    case SDL_FINGERUP:
      touch_->Lift(event.tfinger.fingerId);
      for (const KeyChange& change : touch_->TakeChanges()) Queue(change.key_code, change.down);
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
      } else {
        Queue(KeyForButton(event.cbutton.button), down);
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
        if (event.type == SDL_KEYDOWN) back_down_at_ms_ = event.key.timestamp;
        else if (event.key.timestamp - back_down_at_ms_ >= kBackHoldMs) quit_requested_ = true;
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
