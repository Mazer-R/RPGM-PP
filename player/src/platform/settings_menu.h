// The player's own settings menu, shown over a game while the game waits:
// the frame counter, which key each controller button presses, the touch
// controls, and leaving the game. It is worked with the direction pad and
// two buttons, or with a finger. This file knows nothing about SDL or
// drawing: input goes in, what to draw and what to do come out.
#pragma once

#include <string>
#include <vector>

#include "platform/button_map.h"

namespace mvp {

enum class MenuInput { kUp, kDown, kLeft, kRight, kConfirm, kCancel };

// What the owner of the menu must do after an input.
enum class MenuEffect {
  kNone,
  kClose,           // the menu has closed; the game goes on
  kToggleFps,       // show or hide the frame counter
  kEditTouch,       // the menu has closed; start editing the touch controls
  kQuit,            // leave the game
  kButtonsChanged,  // the button map changed: save it
};

// A filled rectangle, in screen pixels from the top left. `shade` runs from
// 0 (black) to 1 (white).
struct MenuBox {
  float x, y, width, height, shade, alpha;
};

// A line of text, centred on x, y, its letters `height` pixels high.
struct MenuText {
  float x, y, height;
  std::string text;
};

class SettingsMenu {
 public:
  // The map is changed in place.
  explicit SettingsMenu(ButtonMap* buttons);

  // `with_touch` adds the row for the touch controls.
  void Open(bool with_touch);
  bool open() const { return open_; }

  MenuEffect Press(MenuInput input);
  // A finger put down at x, y on a screen of this size: on a row it chooses
  // the row, beside the menu it is cancel.
  MenuEffect Touch(float x, float y, int screen_width, int screen_height);

  // The rows of the page being shown, and which one is chosen.
  std::vector<std::string> Rows() const;
  int selected() const { return selected_; }

  // What to draw; nothing when closed.
  void Picture(int screen_width, int screen_height, std::vector<MenuBox>* boxes, std::vector<MenuText>* texts) const;

 private:
  enum class Page { kMain, kButtons, kKeys };
  struct Frame {
    float left, top, cell_width, row_height;
    int columns, rows;
  };

  std::string Title() const;
  int Columns() const { return page_ == Page::kKeys ? 8 : 1; }
  Frame FrameFor(int screen_width, int screen_height) const;
  void Show(Page page, int selected);
  MenuEffect Confirm();
  MenuEffect Cancel();

  ButtonMap* buttons_;
  bool open_ = false, with_touch_ = false;
  Page page_ = Page::kMain;
  int selected_ = 0;
  std::string button_;  // the button being given a key, on the keys page
};

}  // namespace mvp
