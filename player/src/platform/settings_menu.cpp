#include "platform/settings_menu.h"

#include <algorithm>

#include "platform/touch_layout.h"

namespace mvp {
namespace {

// The keys a button can be given: none first, then the same keys a touch
// control can have, without the direction pad.
const std::vector<int>& ButtonKeyChoices() {
  static const std::vector<int> choices = [] {
    std::vector<int> keys = {0};
    for (int key : TouchKeyChoices()) {
      if (key) keys.push_back(key);
    }
    return keys;
  }();
  return choices;
}

std::string KeyName(int key_code) {
  if (!key_code) return "NONE";
  std::string label = TouchKeyLabel(key_code);
  return label.empty() ? std::to_string(key_code) : label;
}

// Width of a text in dots of the built-in font: letters are 5 dots wide
// with a dot between them.
float DotsWide(const std::string& text) { return static_cast<float>(text.size()) * 6.0f - 1.0f; }

}  // namespace

SettingsMenu::SettingsMenu(ButtonMap* buttons) : buttons_(buttons) {}

void SettingsMenu::Open(bool with_touch) {
  open_ = true;
  with_touch_ = with_touch;
  Show(Page::kMain, 0);
}

void SettingsMenu::Show(Page page, int selected) {
  page_ = page;
  selected_ = selected;
}

std::string SettingsMenu::Title() const {
  switch (page_) {
    case Page::kMain: return "SETTINGS";
    case Page::kButtons: return "BUTTONS";
    case Page::kKeys: return "KEY FOR " + ButtonLabel(button_);
  }
  return "";
}

namespace {
// The row of the frame counter starts with this; ": ON" or ": OFF" follows.
constexpr char kFpsRow[] = "FPS COUNTER";
}  // namespace

std::vector<std::string> SettingsMenu::Rows() const {
  std::vector<std::string> rows;
  if (!open_) return rows;
  if (page_ == Page::kMain) {
    rows = {"RESUME", std::string(kFpsRow) + (fps_shown_ ? ": ON" : ": OFF"), "BUTTONS"};
    if (with_touch_) rows.push_back("TOUCH CONTROLS");
    rows.push_back("QUIT GAME");
  } else if (page_ == Page::kButtons) {
    for (const std::string& button : MappableButtons()) {
      rows.push_back(ButtonLabel(button) + ": " + KeyName(buttons_->KeyFor(button)));
    }
    rows.push_back("STANDARD BUTTONS");
    rows.push_back("BACK");
  } else {
    for (int key : ButtonKeyChoices()) rows.push_back(KeyName(key));
  }
  return rows;
}

MenuEffect SettingsMenu::Press(MenuInput input) {
  if (!open_) return MenuEffect::kNone;
  if (input == MenuInput::kConfirm) return Confirm();
  if (input == MenuInput::kCancel) return Cancel();
  int count = static_cast<int>(Rows().size()), columns = Columns();
  bool along = input == MenuInput::kLeft || input == MenuInput::kRight;
  bool back = input == MenuInput::kLeft || input == MenuInput::kUp;
  int moved = selected_ + (back ? -1 : 1) * (along ? 1 : columns);
  // A list goes round at its ends; a grid stops at its edges.
  if (columns == 1) selected_ = (moved + count) % count;
  else if (moved >= 0 && moved < count) selected_ = moved;
  return MenuEffect::kNone;
}

MenuEffect SettingsMenu::Confirm() {
  std::vector<std::string> rows = Rows();
  const std::string& row = rows[selected_];
  if (page_ == Page::kMain) {
    if (row.rfind(kFpsRow, 0) == 0) return MenuEffect::kToggleFps;
    if (row == "BUTTONS") {
      Show(Page::kButtons, 0);
      return MenuEffect::kNone;
    }
    if (row == "QUIT GAME") return MenuEffect::kQuit;
    open_ = false;
    return row == "TOUCH CONTROLS" ? MenuEffect::kEditTouch : MenuEffect::kClose;
  }
  const std::vector<std::string>& buttons = MappableButtons();
  if (page_ == Page::kButtons) {
    if (selected_ < static_cast<int>(buttons.size())) {
      // The keys page opens on the key the button has now.
      button_ = buttons[selected_];
      const std::vector<int>& keys = ButtonKeyChoices();
      int at = static_cast<int>(std::find(keys.begin(), keys.end(), buttons_->KeyFor(button_)) - keys.begin());
      Show(Page::kKeys, at < static_cast<int>(keys.size()) ? at : 0);
      return MenuEffect::kNone;
    }
    if (row == "STANDARD BUTTONS") {
      *buttons_ = ButtonMap();
      return MenuEffect::kButtonsChanged;
    }
    Show(Page::kMain, 2);
    return MenuEffect::kNone;
  }
  buttons_->Set(button_, ButtonKeyChoices()[selected_]);
  Cancel();
  return MenuEffect::kButtonsChanged;
}

MenuEffect SettingsMenu::Cancel() {
  if (page_ == Page::kKeys) {
    const std::vector<std::string>& buttons = MappableButtons();
    Show(Page::kButtons, static_cast<int>(std::find(buttons.begin(), buttons.end(), button_) - buttons.begin()));
    return MenuEffect::kNone;
  }
  if (page_ == Page::kButtons) {
    Show(Page::kMain, 2);
    return MenuEffect::kNone;
  }
  open_ = false;
  return MenuEffect::kClose;
}

// Where the page goes on a screen of this size: a title row, then the rows,
// in the middle of the screen.
SettingsMenu::Frame SettingsMenu::FrameFor(int screen_width, int screen_height) const {
  float width = static_cast<float>(screen_width), height = static_cast<float>(screen_height);
  Frame frame;
  frame.columns = Columns();
  frame.rows = (static_cast<int>(Rows().size()) + frame.columns - 1) / frame.columns;
  frame.row_height = std::min(height * 0.94f / static_cast<float>(frame.rows + 1), height / 9.0f);
  float panel_width = std::min(width * 0.94f, frame.row_height * (frame.columns == 1 ? 11.0f : 20.0f));
  frame.cell_width = panel_width / static_cast<float>(frame.columns);
  frame.left = (width - panel_width) / 2;
  frame.top = (height - frame.row_height * static_cast<float>(frame.rows + 1)) / 2;
  return frame;
}

MenuEffect SettingsMenu::Touch(float x, float y, int screen_width, int screen_height) {
  if (!open_) return MenuEffect::kNone;
  Frame frame = FrameFor(screen_width, screen_height);
  float column = (x - frame.left) / frame.cell_width, row = (y - frame.top) / frame.row_height - 1.0f;
  if (column < 0 || column >= static_cast<float>(frame.columns) || row < -1.0f || row >= static_cast<float>(frame.rows)) {
    return Cancel();
  }
  int index = static_cast<int>(row) * frame.columns + static_cast<int>(column);
  if (row < 0 || index >= static_cast<int>(Rows().size())) return MenuEffect::kNone;  // the title, or an empty cell
  selected_ = index;
  return Confirm();
}

void SettingsMenu::Picture(int screen_width, int screen_height, std::vector<MenuBox>* boxes,
                           std::vector<MenuText>* texts) const {
  boxes->clear();
  texts->clear();
  if (!open_) return;
  Frame frame = FrameFor(screen_width, screen_height);
  std::vector<std::string> rows = Rows();
  float panel_width = frame.cell_width * static_cast<float>(frame.columns);
  boxes->push_back({frame.left, frame.top, panel_width, frame.row_height * static_cast<float>(frame.rows + 1), 0.05f, 0.9f});
  boxes->push_back({frame.left, frame.top, panel_width, frame.row_height, 0.18f, 0.9f});
  // Letters half a row high, smaller where a text would not fit its cell.
  auto letter_height = [&](const std::string& text, float room) {
    return 7.0f * std::min(frame.row_height * 0.5f / 7.0f, room * 0.9f / DotsWide(text));
  };
  texts->push_back({frame.left + panel_width / 2, frame.top + frame.row_height / 2, letter_height(Title(), panel_width), Title()});
  for (size_t i = 0; i < rows.size(); i++) {
    float left = frame.left + static_cast<float>(i % frame.columns) * frame.cell_width;
    float top = frame.top + static_cast<float>(i / frame.columns + 1) * frame.row_height;
    if (static_cast<int>(i) == selected_) boxes->push_back({left, top, frame.cell_width, frame.row_height, 0.4f, 0.9f});
    texts->push_back({left + frame.cell_width / 2, top + frame.row_height / 2, letter_height(rows[i], frame.cell_width), rows[i]});
  }
}

}  // namespace mvp
