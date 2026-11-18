// Tests for platform/button_map and platform/settings_menu: which key each
// of a controller's buttons presses, and the player's own settings menu.
// Built and run by tools/build/test.sh.
#include <cstdio>
#include <string>
#include <vector>

#include "platform/button_map.h"
#include "platform/settings_menu.h"

namespace {

int g_failures = 0;

void Expect(const std::string& what, const std::string& got, const std::string& wanted) {
  bool ok = got == wanted;
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) {
    std::printf("       got    %s\n       wanted %s\n", got.c_str(), wanted.c_str());
    g_failures++;
  }
}

std::string Joined(const std::vector<std::string>& rows) {
  std::string text;
  for (const std::string& row : rows) text += (text.empty() ? "" : " | ") + row;
  return text;
}

const char* Name(mvp::MenuEffect effect) {
  switch (effect) {
    case mvp::MenuEffect::kNone: return "none";
    case mvp::MenuEffect::kClose: return "close";
    case mvp::MenuEffect::kToggleFps: return "fps";
    case mvp::MenuEffect::kToggleMove: return "move";
    case mvp::MenuEffect::kToggleControls: return "controls";
    case mvp::MenuEffect::kTogglePointer: return "pointer";
    case mvp::MenuEffect::kEditTouch: return "touch";
    case mvp::MenuEffect::kQuit: return "quit";
    case mvp::MenuEffect::kButtonsChanged: return "buttons";
  }
  return "?";
}

// Moves down to the row with this text and confirms it.
mvp::MenuEffect Choose(mvp::SettingsMenu* menu, const std::string& row) {
  std::vector<std::string> rows = menu->Rows();
  for (size_t i = 0; i < rows.size(); i++) {
    if (rows[i] != row) continue;
    while (menu->selected() != static_cast<int>(i)) {
      menu->Press(menu->selected() < static_cast<int>(i) ? mvp::MenuInput::kRight : mvp::MenuInput::kLeft);
    }
    return menu->Press(mvp::MenuInput::kConfirm);
  }
  std::printf("FAIL no row %s\n", row.c_str());
  g_failures++;
  return mvp::MenuEffect::kNone;
}

void TestButtonMap() {
  mvp::ButtonMap standard;
  Expect("by default A confirms, B cancels, X dashes and Y opens the game's menu",
         std::to_string(standard.KeyFor("a")) + " " + std::to_string(standard.KeyFor("b")) + " " +
             std::to_string(standard.KeyFor("x")) + " " + std::to_string(standard.KeyFor("y")),
         "90 88 16 27");
  Expect("the shoulders page, Start confirms", std::to_string(standard.KeyFor("leftshoulder")) + " " +
             std::to_string(standard.KeyFor("rightshoulder")) + " " + std::to_string(standard.KeyFor("start")),
         "33 34 13");
  Expect("the triggers press nothing until given a key", std::to_string(standard.KeyFor("lefttrigger")), "0");
  Expect("a button that is not one of the controller's presses nothing", std::to_string(standard.KeyFor("turbo")), "0");

  mvp::ButtonMap changed;
  changed.Set("lefttrigger", 84);
  changed.Set("y", 0);
  Expect("a button can be given another key", std::to_string(changed.KeyFor("lefttrigger")), "84");
  Expect("or none", std::to_string(changed.KeyFor("y")), "0");
  mvp::ButtonMap read = mvp::ButtonMap::Parse(changed.Format());
  Expect("a map written out and read back is the same map", read.Format(), changed.Format());
  mvp::ButtonMap partial = mvp::ButtonMap::Parse("# mine\nlefttrigger 84\nturbo 65\nb nonsense\na 999\n");
  Expect("a file names only what it changes; lines that make no sense are skipped",
         std::to_string(partial.KeyFor("lefttrigger")) + " " + std::to_string(partial.KeyFor("a")) + " " +
             std::to_string(partial.KeyFor("b")),
         "84 90 88");
  Expect("the buttons are shown by the names printed on a controller",
         mvp::ButtonLabel("leftshoulder") + " " + mvp::ButtonLabel("back") + " " + mvp::ButtonLabel("a"), "L1 SELECT A");
}

void TestMenu() {
  mvp::ButtonMap buttons;
  mvp::SettingsMenu menu(&buttons);
  Expect("the menu starts closed", menu.open() ? "open" : "closed", "closed");
  menu.Open(false);
  Expect("opened without a touch screen it offers", Joined(menu.Rows()), "RESUME | FPS COUNTER: OFF | BUTTONS | POINTER: OFF | QUIT GAME");
  Expect("the first row is the chosen one", std::to_string(menu.selected()), "0");
  menu.Press(mvp::MenuInput::kUp);
  Expect("up from the first row goes to the last", std::to_string(menu.selected()), "4");
  menu.Press(mvp::MenuInput::kDown);
  Expect("down from the last row goes to the first", std::to_string(menu.selected()), "0");
  Expect("RESUME closes the menu", Name(menu.Press(mvp::MenuInput::kConfirm)), "close");
  Expect("and it is closed", menu.open() ? "open" : "closed", "closed");

  menu.Open(false);
  Expect("the pointer worked with the pad is switched on without leaving the menu", Name(Choose(&menu, "POINTER: OFF")), "pointer");
  menu.SetPointerOn(true);
  Expect("its row says it is on", menu.Rows()[3], "POINTER: ON");
  Expect("and switches it off again", Name(Choose(&menu, "POINTER: ON")), "pointer");
  menu.SetPointerOn(false);
  menu.Press(mvp::MenuInput::kCancel);

  menu.Open(true);
  Expect("with a touch screen it also offers its controls", Joined(menu.Rows()),
         "RESUME | FPS COUNTER: OFF | BUTTONS | CONTROLS: ON | MOVE: STICK | TOUCH CONTROLS | QUIT GAME");
  Expect("choosing how to move keeps the menu open", Name(Choose(&menu, "MOVE: STICK")), "move");
  menu.SetMoveStick(false);
  Expect("its row names the control in use", menu.Rows()[4], "MOVE: PAD");
  Expect("and still switches it", Name(Choose(&menu, "MOVE: PAD")), "move");
  menu.SetMoveStick(true);
  Expect("switching the on-screen controls off keeps the menu open", Name(Choose(&menu, "CONTROLS: ON")), "controls");
  menu.SetControlsShown(false);
  Expect("its row says they are off", menu.Rows()[3], "CONTROLS: OFF");
  Expect("and switches them back on", Name(Choose(&menu, "CONTROLS: OFF")), "controls");
  menu.SetControlsShown(true);
  Expect("the frame counter is switched without leaving the menu", Name(Choose(&menu, "FPS COUNTER: OFF")), "fps");
  Expect("so the menu stays open", menu.open() ? "open" : "closed", "open");
  menu.SetFpsShown(true);
  Expect("its row says when the counter is on", menu.Rows()[1], "FPS COUNTER: ON");
  Expect("and is still the row that switches it", Name(Choose(&menu, "FPS COUNTER: ON")), "fps");
  menu.SetFpsShown(false);
  Expect("and when it is off again", menu.Rows()[1], "FPS COUNTER: OFF");
  Expect("editing the touch controls closes the menu", Name(Choose(&menu, "TOUCH CONTROLS")), "touch");
  Expect("which is then closed", menu.open() ? "open" : "closed", "closed");
  menu.Open(false);
  Expect("QUIT GAME asks to leave the game", Name(Choose(&menu, "QUIT GAME")), "quit");
  menu.Open(false);
  Expect("cancel closes the menu", Name(menu.Press(mvp::MenuInput::kCancel)), "close");

  // The buttons page.
  menu.Open(false);
  Choose(&menu, "BUTTONS");
  std::vector<std::string> rows = menu.Rows();
  Expect("the buttons page lists each button with its key", rows[0] + " | " + rows[1] + " | " + rows[8], "A: Z | B: X | L2: NONE");
  Expect("and ends with the way back", rows[rows.size() - 2] + " | " + rows[rows.size() - 1], "STANDARD BUTTONS | BACK");
  Expect("choosing a button changes nothing yet", Name(Choose(&menu, "L2: NONE")), "none");
  bool has_t = false, has_none = false, has_pad = false;
  for (const std::string& row : menu.Rows()) {
    has_t = has_t || row == "T";
    has_none = has_none || row == "NONE";
    has_pad = has_pad || row == "PAD";
  }
  Expect("it offers the keys, and none, but not the direction pad",
         std::string(has_t ? "T " : "") + (has_none ? "NONE " : "") + (has_pad ? "PAD" : ""), "T NONE ");
  int before = menu.selected();
  menu.Press(mvp::MenuInput::kDown);
  Expect("the keys are in rows of eight: down moves a whole row", std::to_string(menu.selected() - before), "8");
  Expect("choosing a key gives it to the button", Name(Choose(&menu, "T")), "buttons");
  Expect("the map has it", std::to_string(buttons.KeyFor("lefttrigger")), "84");
  Expect("and the page shows it", menu.Rows()[8], "L2: T");
  Choose(&menu, "A: Z");
  Expect("cancel on the keys keeps the button as it was", Name(menu.Press(mvp::MenuInput::kCancel)), "none");
  Expect("unchanged", std::to_string(buttons.KeyFor("a")), "90");
  Expect("STANDARD BUTTONS brings the usual keys back", Name(Choose(&menu, "STANDARD BUTTONS")), "buttons");
  Expect("L2 is free again", std::to_string(buttons.KeyFor("lefttrigger")), "0");
  Expect("BACK returns to the first page", Name(Choose(&menu, "BACK")), "none");
  Expect("which is", menu.Rows()[0], "RESUME");

  // What is drawn, and a finger on it.
  std::vector<mvp::MenuBox> boxes;
  std::vector<mvp::MenuText> texts;
  menu.Picture(640, 480, &boxes, &texts);
  bool inside = !boxes.empty();
  for (const mvp::MenuBox& box : boxes) {
    inside = inside && box.x >= 0 && box.y >= 0 && box.x + box.width <= 640 && box.y + box.height <= 480;
  }
  Expect("the menu is drawn wholly on a small screen", inside ? "yes" : "no", "yes");
  Expect("with a title and every row written", std::to_string(texts.size()), std::to_string(menu.Rows().size() + 1));
  const mvp::MenuText* quit = nullptr;
  for (const mvp::MenuText& text : texts) {
    if (text.text == "QUIT GAME") quit = &text;
  }
  Expect("a finger on a row chooses it", quit ? Name(menu.Touch(quit->x, quit->y, 640, 480)) : "not drawn", "quit");
  menu.Open(false);
  Expect("a finger beside the menu closes it", Name(menu.Touch(2, 2, 640, 480)), "close");
  Expect("a closed menu draws nothing and takes no input",
         (menu.Picture(640, 480, &boxes, &texts), std::to_string(boxes.size() + texts.size())) + " " +
             Name(menu.Press(mvp::MenuInput::kConfirm)),
         "0 none");
}

}  // namespace

int main() {
  TestButtonMap();
  TestMenu();
  std::printf(g_failures ? "%d failed\n" : "all passed\n", g_failures);
  return g_failures ? 1 : 0;
}
