// Tests for platform/touch: which keys fingers on the screen press.
// Built and run by tools/build/test.sh.
#include <cstdio>
#include <string>
#include <vector>

#include "platform/touch.h"

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

}  // namespace

int main() {
  const int kLeft = 37, kUp = 38, kRight = 39, kDown = 40, kConfirm = 90, kCancel = 88, kDash = 16;
  mvp::TouchControls controls;
  controls.SetScreen(2400, 1080);
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

  // Presses shorter than a frame.
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

  std::printf(g_failures ? "%d failed\n" : "all passed\n", g_failures);
  return g_failures ? 1 : 0;
}
