// Tests for platform/touch: which keys fingers on the screen press.
// Built and run by tools/build/test.sh.
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>

#include "platform/fit.h"
#include "platform/touch.h"
#include "platform/touch_layout.h"

namespace {

int g_failures = 0;

// Key changes as text: "+37" for a press, "-37" for a release.
std::string Text(const std::vector<mvp::KeyChange>& changes) {
  std::string text;
  for (const mvp::KeyChange& change : changes) {
    text += (text.empty() ? "" : " ") + std::string(change.down ? "+" : "-") + std::to_string(change.key_code);
  }
  return text;
}

void Expect(const std::string& what, const std::string& got, const std::string& wanted) {
  bool ok = got == wanted;
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) {
    std::printf("       got    %s\n       wanted %s\n", got.c_str(), wanted.c_str());
    g_failures++;
  }
}

const mvp::TouchCircle& Control(const mvp::TouchControls& controls, int key_code) {
  for (const mvp::TouchCircle& circle : controls.circles()) {
    if (circle.key_code == key_code) return circle;
  }
  std::printf("FAIL no control for key %d\n", key_code);
  std::exit(1);
}

// What is drawn, found by the text on it.
bool Shown(const mvp::TouchControls& controls, const std::string& label) {
  for (const mvp::TouchShape& shape : controls.Shapes()) {
    if (shape.label == label) return true;
  }
  return false;
}

mvp::TouchShape Shape(const mvp::TouchControls& controls, const std::string& label) {
  for (const mvp::TouchShape& shape : controls.Shapes()) {
    if (shape.label == label) return shape;
  }
  std::printf("FAIL nothing drawn with the text %s\n", label.c_str());
  std::exit(1);
}

// A finger down and up again on what carries this text.
void Tap(mvp::TouchControls* controls, const std::string& label) {
  mvp::TouchShape shape = Shape(*controls, label);
  controls->Place(50, shape.x, shape.y);
  controls->Lift(50);
}

std::string Keys(const std::vector<mvp::TouchControl>& layout) {
  std::string text;
  for (const mvp::TouchControl& control : layout) text += (text.empty() ? "" : " ") + std::to_string(control.key_code);
  return text;
}

void TestLayouts() {
  std::vector<mvp::TouchControl> standard = mvp::DefaultTouchLayout();
  Expect("the standard layout is the stick, confirm, cancel and dash", Keys(standard), "1 90 88 16");
  Expect("a layout written out and read back is the same layout",
         mvp::FormatTouchLayout(mvp::ParseTouchLayout(mvp::FormatTouchLayout(standard))),
         mvp::FormatTouchLayout(standard));
  std::vector<mvp::TouchControl> read = mvp::ParseTouchLayout(
      "# a comment\npad 0.2 -0.2 0.17\n84 -0.3 0.5 0.08\nnonsense\n84 1 2\n999999 0.1 0.1 0.1\n\n90 0.5 0.5 0\n");
  Expect("lines that are not a control are skipped", Keys(read), "0 84");
  Expect("the stick is written and read by its name",
         Keys(mvp::ParseTouchLayout(mvp::FormatTouchLayout({{0.2f, -0.2f, 0.2f, mvp::kTouchStick}}))) + " " +
             (mvp::FormatTouchLayout({{0.2f, -0.2f, 0.2f, mvp::kTouchStick}}).find("\nstick ") != std::string::npos ? "named" : "unnamed"),
         "1 named");
  Expect("an empty file is a layout without controls", Keys(mvp::ParseTouchLayout("")), "");

  Expect("a letter key is named by its letter", mvp::TouchKeyLabel(84), "T");
  Expect("a digit key by its digit", mvp::TouchKeyLabel(49), "1");
  Expect("the other keys by a short name", mvp::TouchKeyLabel(13) + " " + mvp::TouchKeyLabel(27), "ENTER ESC");
  bool has_t = false, has_pad = false;
  for (int key : mvp::TouchKeyChoices()) {
    has_t = has_t || key == 84;
    has_pad = has_pad || key == 0;
  }
  Expect("the keys to choose from include T and the direction pad", has_t && has_pad ? "yes" : "no", "yes");

  // A layout places its controls from the nearer edge, in units of the
  // screen's shorter side.
  mvp::TouchControls controls;
  controls.SetLayout({{0.2f, -0.2f, 0.1f, 84}, {-0.3f, 0.25f, 0.05f, 13}});
  controls.SetScreen(2000, 1000);
  const mvp::TouchCircle t = Control(controls, 84);
  const mvp::TouchCircle enter = Control(controls, 13);
  Expect("positive positions count from the left and the top, negative ones from the right and the bottom",
         std::to_string(static_cast<int>(t.x + 0.5f)) + "," + std::to_string(static_cast<int>(t.y + 0.5f)) + " " +
             std::to_string(static_cast<int>(enter.x + 0.5f)) + "," + std::to_string(static_cast<int>(enter.y + 0.5f)),
         "200,800 1700,250");
  controls.Place(1, t.x, t.y);
  Expect("a button added for the T key presses T", Text(controls.TakeChanges()), "+84");
  controls.Lift(1);
  controls.TakeChanges();
  Expect("a button for another key carries the key's name", Shown(controls, "T") ? "yes" : "no", "yes");
}

void TestEditing() {
  mvp::TouchControls controls;
  controls.SetScreen(2400, 1080);
  Expect("the button for the settings menu is not there unless offered", Shown(controls, "MENU") ? "yes" : "no", "no");
  controls.OfferMenu(true);
  Expect("when offered it is", Shown(controls, "MENU") ? "yes" : "no", "yes");
  Expect("nobody has asked for the menu yet", controls.TakeMenuRequest() ? "yes" : "no", "no");

  const mvp::TouchCircle confirm = Control(controls, 90);
  controls.Place(1, confirm.x, confirm.y);
  controls.TakeChanges();
  Tap(&controls, "MENU");
  Expect("touching MENU lets go of what was held", Text(controls.TakeChanges()), "-90");
  Expect("and asks for the menu", controls.TakeMenuRequest() ? "yes" : "no", "yes");
  Expect("once", controls.TakeMenuRequest() ? "yes" : "no", "no");
  controls.Lift(1);
  controls.StartEditing();
  Expect("editing is on", controls.editing() ? "yes" : "no", "yes");
  Expect("the editing buttons are shown",
         Shown(controls, "ADD") && Shown(controls, "DEL") && Shown(controls, "RESET") && Shown(controls, "OK") ? "yes" : "no",
         "yes");

  // Moving: a finger put on a control drags it.
  controls.Place(1, confirm.x + 5, confirm.y);
  controls.Place(1, 1205, 500);
  controls.Lift(1);
  Expect("no key is pressed while editing", Text(controls.TakeChanges()), "");
  const mvp::TouchCircle moved = Control(controls, 90);
  Expect("a dragged control follows the finger, keeping where it was held",
         std::to_string(static_cast<int>(moved.x + 0.5f)) + "," + std::to_string(static_cast<int>(moved.y + 0.5f)),
         "1200,500");
  controls.Place(1, 1200, 500);
  controls.Place(1, 5000, -300);
  controls.Lift(1);
  const mvp::TouchCircle edge = Control(controls, 90);
  Expect("a control cannot be dragged off the screen",
         edge.x + edge.radius <= 2400 && edge.y - edge.radius >= 0 ? "yes" : "no", "yes");

  controls.Place(1, edge.x, edge.y);
  controls.Place(1, 1200, 500);
  controls.Lift(1);

  // Size: the control touched last is the one the buttons act on.
  float before = Control(controls, 90).radius;
  Tap(&controls, "+");
  Expect("+ makes the chosen control bigger", Control(controls, 90).radius > before ? "yes" : "no", "yes");
  Tap(&controls, "-");
  Tap(&controls, "-");
  Expect("- makes it smaller", Control(controls, 90).radius < before ? "yes" : "no", "yes");
  for (int i = 0; i < 40; i++) Tap(&controls, "-");
  Expect("but never too small to touch", Control(controls, 90).radius >= 1080 * 0.03f ? "yes" : "no", "yes");

  // Adding: choose a key from the list.
  Tap(&controls, "ADD");
  Expect("ADD shows the keys to choose from", Shown(controls, "T") && Shown(controls, "PAD") ? "yes" : "no", "yes");
  Tap(&controls, "T");
  Expect("choosing a key adds a button for it", Keys(controls.layout()), "1 90 88 16 84");
  Expect("and closes the list", Shown(controls, "PAD") ? "yes" : "no", "no");
  Tap(&controls, "ADD");
  controls.Place(1, 2, 1078);
  controls.Lift(1);
  Expect("a touch beside the keys closes the list without adding", Keys(controls.layout()), "1 90 88 16 84");

  // Removing: the button just added is the chosen one.
  Tap(&controls, "T");
  Tap(&controls, "DEL");
  Expect("DEL removes the chosen control", Keys(controls.layout()), "1 90 88 16");
  Tap(&controls, "DEL");
  Expect("with nothing chosen DEL removes nothing", Keys(controls.layout()), "1 90 88 16");

  Expect("nothing is to be saved while editing goes on", controls.TakeLayoutChanged() ? "yes" : "no", "no");
  Tap(&controls, "OK");
  Expect("OK ends editing", controls.editing() ? "yes" : "no", "no");
  Expect("and the changed layout is to be saved", controls.TakeLayoutChanged() ? "yes" : "no", "yes");
  Expect("once", controls.TakeLayoutChanged() ? "yes" : "no", "no");
  const mvp::TouchCircle after = Control(controls, 90);
  controls.Place(1, after.x, after.y);
  Expect("the controls work again where they now are", Text(controls.TakeChanges()), "+90");
  controls.Lift(1);
  controls.TakeChanges();

  // The layout survives a change of screen size.
  std::string saved = mvp::FormatTouchLayout(controls.layout());
  mvp::TouchControls again;
  again.SetLayout(mvp::ParseTouchLayout(saved));
  again.SetScreen(2400, 1080);
  const mvp::TouchCircle restored = Control(again, 90);
  Expect("a saved layout puts the controls back where they were",
         std::to_string(static_cast<int>(restored.x + 0.5f)) + "," + std::to_string(static_cast<int>(restored.y + 0.5f)),
         std::to_string(static_cast<int>(after.x + 0.5f)) + "," + std::to_string(static_cast<int>(after.y + 0.5f)));

  controls.StartEditing();
  Tap(&controls, "OK");
  Expect("editing without changing anything leaves nothing to save", controls.TakeLayoutChanged() ? "yes" : "no", "no");
  controls.StartEditing();
  Tap(&controls, "RESET");
  Tap(&controls, "OK");
  Expect("RESET brings the standard layout back",
         mvp::FormatTouchLayout(controls.layout()), mvp::FormatTouchLayout(mvp::DefaultTouchLayout()));
}

// Where the stick is drawn and where its knob is, in radii from its middle.
std::string StickAt(const mvp::TouchControls& controls) {
  for (const mvp::TouchShape& shape : controls.Shapes()) {
    if (shape.key_code != mvp::kTouchStick || !shape.label.empty()) continue;
    char text[64];
    std::snprintf(text, sizeof text, "%d,%d knob %.2f,%.2f", static_cast<int>(shape.x), static_cast<int>(shape.y),
                  shape.knob_x, shape.knob_y);
    return text;
  }
  return "no stick";
}

}  // namespace

int main() {
  const int kLeft = 37, kUp = 38, kRight = 39, kDown = 40, kConfirm = 90, kCancel = 88, kDash = 16;
  // A finger that lands on none of the player's controls is the game's own:
  // the engines move the character to a touched place and take touches on
  // their menus. It stays the game's until it lifts.
  {
    mvp::TouchControls pads;
    pads.SetScreen(2400, 1080);
    pads.SetMoveStick(false);
    const mvp::TouchCircle confirm = Control(pads, kConfirm);
    const mvp::TouchCircle pad = Control(pads, mvp::kTouchPad);
    pads.Place(1, 1200, 300);
    Expect("with the pad, a finger on no control is for the game", pads.ForGame(1) ? "game" : "controls", "game");
    Expect("and presses nothing", Text(pads.TakeChanges()), "");
    pads.Place(1, confirm.x, confirm.y);
    Expect("sliding onto a control, it is still the game's and presses nothing",
           std::string(pads.ForGame(1) ? "game" : "controls") + " [" + Text(pads.TakeChanges()) + "]", "game []");
    pads.Lift(1);
    Expect("once lifted it is nobody's", pads.ForGame(1) ? "game" : "none", "none");
    pads.Place(2, confirm.x, confirm.y);
    Expect("a finger on a button is for the controls", pads.ForGame(2) ? "game" : "controls", "controls");
    pads.Place(2, 1200, 300);
    Expect("and stays theirs when it slides off", pads.ForGame(2) ? "game" : "controls", "controls");
    pads.Lift(2);
    pads.TakeChanges();
    pads.Place(3, pad.x, pad.y);
    Expect("the middle of the pad is the pad's, though it presses nothing",
           std::string(pads.ForGame(3) ? "game" : "controls") + " [" + Text(pads.TakeChanges()) + "]", "controls []");
    pads.Lift(3);
    pads.Place(4, 300, 300);
    Expect("with the pad, the left half is free too", pads.ForGame(4) ? "game" : "controls", "game");
    pads.Lift(4);

    mvp::TouchControls sticks;
    sticks.SetScreen(2400, 1080);
    sticks.Place(1, 700, 400);
    Expect("with the stick, a thumb in the left half is the stick's", sticks.ForGame(1) ? "game" : "controls", "controls");
    sticks.Place(2, 1500, 300);
    Expect("and a finger in the right half, on no control, is for the game", sticks.ForGame(2) ? "game" : "controls", "game");
    sticks.Lift(1);
    sticks.Lift(2);

    mvp::TouchControls menus;
    menus.SetScreen(2400, 1080);
    menus.OfferMenu(true);
    mvp::TouchShape menu = Shape(menus, "MENU");
    menus.Place(1, menu.x, menu.y);
    Expect("the MENU button is not the game's", menus.ForGame(1) ? "game" : "controls", "controls");
    menus.Lift(1);
    menus.TakeMenuRequest();
    menus.StartEditing();
    menus.Place(2, 1500, 300);
    Expect("while the controls are being changed, no finger is", menus.ForGame(2) ? "game" : "controls", "controls");
  }
  // The controls can be switched off, for a game played by touching it. The
  // MENU button stays, to bring them back.
  {
    mvp::TouchControls hidden;
    hidden.SetScreen(2400, 1080);
    hidden.OfferMenu(true);
    const mvp::TouchCircle confirm = Control(hidden, kConfirm);
    Expect("the controls are shown unless switched off", hidden.shown() ? "shown" : "hidden", "shown");
    hidden.SetShown(false);
    std::string drawn;
    for (const mvp::TouchShape& shape : hidden.Shapes()) drawn += (drawn.empty() ? "" : " ") + (shape.label.empty() ? std::to_string(shape.key_code) : shape.label);
    Expect("switched off, only the MENU button is drawn", drawn, "MENU");
    hidden.Place(1, confirm.x, confirm.y);
    Expect("a finger where a button was is the game's and presses nothing",
           std::string(hidden.ForGame(1) ? "game" : "controls") + " [" + Text(hidden.TakeChanges()) + "]", "game []");
    hidden.Lift(1);
    hidden.Place(2, 500, 400);
    Expect("the left half is the game's too: there is no stick", hidden.ForGame(2) ? "game" : "controls", "game");
    hidden.Lift(2);
    mvp::TouchShape menu = Shape(hidden, "MENU");
    hidden.Place(3, menu.x, menu.y);
    Expect("the MENU button still asks for the menu", hidden.TakeMenuRequest() ? "asked" : "not asked", "asked");
    hidden.Lift(3);
    hidden.SetShown(true);
    hidden.Place(4, confirm.x, confirm.y);
    Expect("switched back on, the button presses its key", Text(hidden.TakeChanges()), "+90");
    hidden.Lift(4);

    std::vector<mvp::TouchControl> standard = mvp::DefaultTouchLayout();
    std::string off = mvp::FormatTouchLayout(standard, false);
    Expect("the file says when the controls are off", mvp::TouchControlsShown(off) ? "shown" : "hidden", "hidden");
    Expect("and keeps the controls themselves", Keys(mvp::ParseTouchLayout(off)), Keys(standard));
    Expect("a file that says nothing has them on", mvp::TouchControlsShown(mvp::FormatTouchLayout(standard)) ? "shown" : "hidden", "shown");
  }
  // The game's picture is fitted inside the screen; a place on the screen is
  // told to the game as a place in its picture.
  {
    auto at = [](int sw, int sh, int pw, int ph, float x, float y) {
      mvp::PicturePoint p = mvp::ScreenToPicture(sw, sh, pw, ph, x, y);
      return std::to_string(static_cast<int>(std::lround(p.x))) + "," + std::to_string(static_cast<int>(std::lround(p.y)));
    };
    Expect("a screen the picture's size: the same place", at(816, 624, 816, 624, 100, 50), "100,50");
    Expect("a screen twice the size: half the numbers", at(1632, 1248, 816, 624, 200, 100), "100,50");
    Expect("a wider screen: the bars at the sides are taken off", at(2400, 1080, 816, 624, 1200, 540), "408,312");
    Expect("the picture's left edge on a wider screen", at(2400, 1080, 816, 624, (2400 - 816 * 1080.0f / 624) / 2, 0), "0,0");
    Expect("a place on a bar is outside the picture", at(2400, 1080, 816, 624, 0, 540).substr(0, 1), "-");
    Expect("a taller screen: the bars above and below", at(640, 960, 640, 480, 320, 480), "320,240");
  }
  // The stick: what moves the character unless the pad is chosen instead. It
  // has no place of its own while playing: it is wherever the thumb lands in
  // the left half of the screen.
  {
    mvp::TouchControls sticks;
    sticks.SetScreen(2400, 1080);
    Expect("the standard movement control is the stick", sticks.move_stick() ? "stick" : "pad", "stick");
    const mvp::TouchCircle home = Control(sticks, mvp::kTouchStick);
    Expect("a thumb landing on the left presses nothing yet", (sticks.Place(1, 700, 400), Text(sticks.TakeChanges())), "");
    Expect("and the stick is drawn there, its knob in the middle", StickAt(sticks), "700,400 knob 0.00,0.00");
    sticks.Place(1, 700 + home.radius * 0.6f, 400);
    Expect("sliding right holds right", Text(sticks.TakeChanges()), "+39");
    Expect("the knob follows the thumb", StickAt(sticks), "700,400 knob 0.60,0.00");
    sticks.Place(1, 700 + home.radius * 0.5f, 400 - home.radius * 0.5f);
    Expect("up and right holds both", Text(sticks.TakeChanges()), "+38");
    sticks.Place(1, 700, 400 - home.radius * 0.6f);
    Expect("straight up lets right go", Text(sticks.TakeChanges()), "-39");
    sticks.Place(1, 700 + home.radius * 0.1f, 400);
    Expect("near where it landed nothing is held", Text(sticks.TakeChanges()), "-38");
    sticks.Place(1, 700 + home.radius * 3.0f, 400);
    Expect("far to the right is still right", Text(sticks.TakeChanges()), "+39");
    Expect("and the stick has come along, a radius behind the thumb",
           StickAt(sticks), std::to_string(static_cast<int>(700 + home.radius * 2.0f)) + ",400 knob 1.00,0.00");
    sticks.Lift(1);
    Expect("lifting the thumb lets go", Text(sticks.TakeChanges()), "-39");
    char at[64];
    std::snprintf(at, sizeof at, "%d,%d knob 0.00,0.00", static_cast<int>(home.x), static_cast<int>(home.y));
    Expect("and the stick is back at its place", StickAt(sticks), at);

    sticks.Place(2, 1800, 300);
    Expect("a thumb on the right half moves nothing", Text(sticks.TakeChanges()), "");
    sticks.Lift(2);
    const mvp::TouchCircle ok = Control(sticks, 90);
    sticks.Place(1, 500, 500);
    sticks.Place(2, ok.x, ok.y);
    sticks.Place(1, 500, 500 + home.radius * 0.7f);
    Expect("the stick and a button work together", Text(sticks.TakeChanges()), "+40 +90");
    sticks.Lift(1);
    sticks.Lift(2);
    sticks.TakeChanges();

    sticks.SetMoveStick(false);
    Expect("the pad can be chosen instead, in the stick's place",
           !sticks.move_stick() && Control(sticks, mvp::kTouchPad).x == home.x ? "yes" : "no", "yes");
    Expect("which is something to save", sticks.TakeLayoutChanged() ? "yes" : "no", "yes");
    sticks.Place(1, 700, 400);
    Expect("then a thumb elsewhere on the left does nothing", Text(sticks.TakeChanges()), "");
    sticks.Lift(1);
    sticks.SetMoveStick(true);
    Expect("and the stick can be chosen again", sticks.move_stick() ? "stick" : "pad", "stick");
  }

  mvp::TouchControls controls;
  controls.SetScreen(2400, 1080);
  controls.SetMoveStick(false);
  controls.TakeLayoutChanged();
  const mvp::TouchCircle pad = Control(controls, 0);
  const mvp::TouchCircle confirm = Control(controls, kConfirm);
  const mvp::TouchCircle cancel = Control(controls, kCancel);
  const mvp::TouchCircle dash = Control(controls, kDash);

  bool inside = true;
  for (const mvp::TouchCircle& circle : controls.circles()) {
    inside = inside && circle.x - circle.radius >= 0 && circle.x + circle.radius <= 2400 &&
             circle.y - circle.radius >= 0 && circle.y + circle.radius <= 1080;
  }
  Expect("every control is wholly on the screen", inside ? "yes" : "no", "yes");
  Expect("the pad is on the left, the buttons on the right",
         pad.x < 1200 && confirm.x > 1200 && cancel.x > 1200 && dash.x > 1200 ? "yes" : "no", "yes");

  Expect("the pad is big enough for a thumb: its radius is a fifth of the screen's shorter side",
         pad.radius >= 0.2f * 1080 ? "yes" : "no", "yes");
  Expect("and at least twice a button's", pad.radius >= 2 * confirm.radius ? "yes" : "no", "yes");

  // Eight directions, each an eighth of the circle wide: the four arrows and
  // the four diagonals between them, which hold two arrows at once.
  {
    const char* wanted[8] = {"+39", "+38 +39", "+38", "+37 +38", "+37", "+37 +40", "+40", "+39 +40"};
    const char* names[8] = {"right", "up and right", "up", "up and left", "left", "down and left", "down", "down and right"};
    const float kPi = 3.14159265f;
    for (int direction = 0; direction < 8; direction++) {
      for (float off : {-20.0f, 0.0f, 20.0f}) {
        mvp::TouchControls fresh;
        fresh.SetScreen(2400, 1080);
        fresh.SetMoveStick(false);
        float angle = (static_cast<float>(direction) * 45.0f + off) * kPi / 180.0f;
        // The screen's y grows downwards.
        fresh.Place(1, pad.x + std::cos(angle) * pad.radius * 0.7f, pad.y - std::sin(angle) * pad.radius * 0.7f);
        Expect(std::string("the pad's ") + names[direction] + " eighth, " + std::to_string(static_cast<int>(off)) + " degrees off its middle",
               Text(fresh.TakeChanges()), wanted[direction]);
      }
    }
  }

  Expect("nothing touched, nothing pressed", Text(controls.TakeChanges()), "");

  controls.Place(1, confirm.x, confirm.y);
  Expect("a finger on the confirm button presses it", Text(controls.TakeChanges()), "+90");
  Expect("a press is reported once", Text(controls.TakeChanges()), "");
  controls.Lift(1);
  Expect("lifting the finger releases it", Text(controls.TakeChanges()), "-90");

  controls.Place(1, 1200, 300);
  Expect("a finger on the game picture presses nothing", Text(controls.TakeChanges()), "");
  controls.Lift(1);

  float reach = pad.radius * 0.7f;
  controls.Place(1, pad.x - reach, pad.y);
  Expect("left of the pad's centre is left", Text(controls.TakeChanges()), "+37");
  controls.Place(1, pad.x, pad.y - reach);
  Expect("sliding to the top lets go of left and presses up", Text(controls.TakeChanges()), "-37 +38");
  controls.Place(1, pad.x + reach, pad.y);
  Expect("the right side is right", Text(controls.TakeChanges()), "-38 +39");
  controls.Place(1, pad.x, pad.y + reach);
  Expect("the bottom is down", Text(controls.TakeChanges()), "-39 +40");
  controls.Place(1, pad.x + reach * 0.7f, pad.y + reach * 0.7f);
  Expect("between down and right both are held", Text(controls.TakeChanges()), "+39");
  controls.Place(1, pad.x + 2, pad.y + 2);
  Expect("the very centre of the pad is neutral", Text(controls.TakeChanges()), "-39 -40");
  controls.Place(1, pad.x - pad.radius * 1.3f, pad.y);
  Expect("a thumb that slid a little past the pad's edge still counts", Text(controls.TakeChanges()), "+37");

  controls.Place(2, cancel.x, cancel.y);
  Expect("a second finger presses a button while the first holds a direction",
         Text(controls.TakeChanges()), "+88");
  controls.Place(3, cancel.x + 3, cancel.y);
  controls.Lift(2);
  Expect("a key held by two fingers stays down when one leaves", Text(controls.TakeChanges()), "");
  controls.Lift(3);
  controls.Lift(1);
  Expect("lifting everything releases everything", Text(controls.TakeChanges()), "-37 -88");

  controls.Place(1, dash.x, dash.y);
  controls.Place(1, confirm.x, confirm.y);
  Expect("a slide from one button to another seen in one go presses only the last",
         Text(controls.TakeChanges()), "+90");
  controls.Lift(1);
  controls.TakeChanges();

  controls.Lift(9);
  Expect("lifting an unknown finger does nothing", Text(controls.TakeChanges()), "");

  // What each control should light up, so the player sees the touch land.
  Expect("an untouched button is not lit", std::to_string(controls.Lit(confirm)), "0");
  controls.Place(1, confirm.x, confirm.y);
  Expect("a touched button is lit", std::to_string(controls.Lit(confirm)), "1");
  Expect("the other buttons are not", std::to_string(controls.Lit(cancel) + controls.Lit(dash)), "0");
  Expect("nor is the pad", std::to_string(controls.Lit(pad)), "0");
  controls.Place(2, pad.x - reach, pad.y);
  Expect("the pad lights its left arm", std::to_string(controls.Lit(pad)), std::to_string(mvp::kLitLeft));
  controls.Place(2, pad.x + reach * 0.7f, pad.y - reach * 0.7f);
  Expect("between up and right it lights both arms", std::to_string(controls.Lit(pad)),
         std::to_string(mvp::kLitUp | mvp::kLitRight));
  controls.Place(2, pad.x, pad.y + reach);
  Expect("the pad lights its bottom arm", std::to_string(controls.Lit(pad)), std::to_string(mvp::kLitDown));
  controls.Lift(1);
  controls.Lift(2);
  Expect("nothing is lit once the fingers are gone",
         std::to_string(controls.Lit(pad) + controls.Lit(confirm)), "0");
  controls.TakeChanges();

  auto Split = [](std::vector<mvp::KeyChange> batch) {
    std::vector<mvp::KeyChange> later;
    mvp::HoldQuickReleases(&batch, &later);
    return Text(batch) + " | " + Text(later);
  };
  Expect("a press and its release in one frame: the release waits for the next frame",
         Split({{90, true}, {90, false}}), "+90 | -90");
  Expect("a release of a key pressed in an earlier frame is delivered at once",
         Split({{90, false}, {37, true}}), "-90 +37 | ");
  Expect("other keys are not held back by a quick tap",
         Split({{90, true}, {37, true}, {90, false}, {37, false}, {88, true}}), "+90 +37 +88 | -90 -37");
  Expect("two taps of one key in one frame stay in order, the second wholly later",
         Split({{90, true}, {90, false}, {90, true}, {90, false}}), "+90 | -90 +90 -90");
  Expect("an empty frame stays empty", Split({}), " | ");

  // A small screen in portrait proportions still gets usable controls.
  controls.SetScreen(480, 640);
  inside = true;
  for (const mvp::TouchCircle& circle : controls.circles()) {
    inside = inside && circle.x - circle.radius >= 0 && circle.x + circle.radius <= 480 &&
             circle.y - circle.radius >= 0 && circle.y + circle.radius <= 640;
  }
  Expect("on a small upright screen every control is still on the screen", inside ? "yes" : "no", "yes");
  (void)kUp; (void)kRight; (void)kDown; (void)kLeft;

  TestLayouts();
  TestEditing();

  std::printf(g_failures ? "%d failed\n" : "all passed\n", g_failures);
  return g_failures ? 1 : 0;
}
