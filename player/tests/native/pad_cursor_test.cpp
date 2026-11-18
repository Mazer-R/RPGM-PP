// Tests for platform/pad_cursor: a pointer worked with the direction pad.
// Built and run by tools/build/test.sh.
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "platform/pad_cursor.h"

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

// Pointer changes as text: "down 320,240", "move", "up", "hover".
std::string Text(const std::vector<mvp::PointerChange>& changes) {
  static const char* names[] = {"down", "move", "up", "hover"};
  std::string text;
  for (const mvp::PointerChange& change : changes) {
    text += (text.empty() ? "" : " | ") + std::string(names[change.phase]) + " " +
            std::to_string(static_cast<int>(std::lround(change.x))) + "," +
            std::to_string(static_cast<int>(std::lround(change.y)));
  }
  return text;
}

std::string At(const mvp::PadCursor& cursor) {
  return std::to_string(static_cast<int>(std::lround(cursor.x()))) + "," +
         std::to_string(static_cast<int>(std::lround(cursor.y())));
}

}  // namespace

int main() {
  const int kLeft = 37, kUp = 38, kRight = 39, kDown = 40, kConfirm = 90, kEnter = 13, kCancel = 88;
  std::vector<mvp::PointerChange> out;

  mvp::PadCursor cursor;
  cursor.SetScreen(640, 480);
  Expect("it is off until switched on", cursor.on() ? "on" : "off", "off");
  Expect("off, it takes no key", cursor.Key(kRight, true, &out) || cursor.Key(kConfirm, true, &out) ? "took" : "left", "left");
  cursor.Advance(1.0, &out);
  Expect("and tells the game nothing", Text(out), "");

  cursor.SetOn(true, &out);
  Expect("switched on, it starts in the middle and says where it is", Text(out), "hover 320,240");
  out.clear();

  Expect("a direction is taken from the game", cursor.Key(kRight, true, &out) ? "took" : "left", "took");
  cursor.Advance(0.1, &out);
  Expect("and moves the cursor that way", cursor.x() > 320 && At(cursor).substr(At(cursor).find(',')) == ",240" ? "right" : At(cursor), "right");
  Expect("which the game is told as the mouse moving", Text(out).substr(0, 6), "hover ");
  cursor.Key(kRight, false, &out);

  // Speeds, on a screen wide enough not to reach its edge.
  {
    mvp::PadCursor wide;
    wide.SetScreen(20000, 480);
    wide.SetOn(true, &out);
    wide.Key(kRight, true, &out);
    float before = wide.x();
    wide.Advance(0.1, &out);
    float slow = wide.x() - before;
    for (int i = 0; i < 10; i++) wide.Advance(0.1, &out);
    before = wide.x();
    wide.Advance(0.1, &out);
    Expect("held, it speeds up", wide.x() - before > slow * 2 ? "faster" : "same", "faster");
    wide.Key(kRight, false, &out);
    before = wide.x();
    wide.Advance(0.1, &out);
    Expect("let go, it stops", wide.x() == before ? "still" : "moving", "still");
    wide.Key(kRight, true, &out);
    before = wide.x();
    wide.Advance(0.1, &out);
    Expect("and starts slowly again", std::fabs(wide.x() - before - slow) < 0.5f ? "slow" : "fast", "slow");
    before = wide.x();
    wide.Advance(30.0, &out);
    Expect("a long pause is not a long move", wide.x() - before < 480 * 0.2f ? "short" : "long", "short");
  }

  cursor.Key(kLeft, true, &out);
  for (int i = 0; i < 100; i++) cursor.Advance(0.1, &out);
  cursor.Key(kLeft, false, &out);
  cursor.Key(kUp, true, &out);
  for (int i = 0; i < 100; i++) cursor.Advance(0.1, &out);
  cursor.Key(kUp, false, &out);
  Expect("it stops at the screen's edges", At(cursor), "0,0");
  cursor.Key(kRight, true, &out);
  cursor.Key(kDown, true, &out);
  for (int i = 0; i < 100; i++) cursor.Advance(0.1, &out);
  Expect("two directions move it at a slant, to the far corner", At(cursor), "639,479");
  cursor.Key(kRight, false, &out);
  cursor.Key(kDown, false, &out);
  cursor.Advance(5.0, &out);
  out.clear();

  Expect("confirm is taken too", cursor.Key(kConfirm, true, &out) ? "took" : "left", "took");
  Expect("and is the left button going down where the cursor is", Text(out), "down 639,479");
  out.clear();
  cursor.Key(kUp, true, &out);
  cursor.Advance(0.1, &out);
  Expect("moving with it held is a drag", Text(out).substr(0, 5), "move ");
  cursor.Key(kUp, false, &out);
  out.clear();
  cursor.Key(kConfirm, false, &out);
  Expect("letting go lifts the button there", Text(out), "up " + At(cursor));
  out.clear();
  cursor.Key(kEnter, true, &out);
  cursor.Key(kEnter, false, &out);
  Expect("the other confirm key clicks as well", Text(out), "down " + At(cursor) + " | up " + At(cursor));
  out.clear();
  Expect("cancel stays the game's", cursor.Key(kCancel, true, &out) ? "took" : "left", "left");

  cursor.Key(kConfirm, true, &out);
  cursor.Key(kLeft, true, &out);
  out.clear();
  cursor.Release(&out);
  Expect("when everything is let go, the held button lifts", Text(out), "up " + At(cursor));
  float before = cursor.x();
  cursor.Advance(0.1, &out);
  Expect("and nothing keeps moving", cursor.x() == before ? "still" : "moving", "still");
  out.clear();

  cursor.Key(kConfirm, true, &out);
  out.clear();
  cursor.SetOn(false, &out);
  Expect("switched off with the button held, it lifts", Text(out), "up " + At(cursor));
  Expect("and takes no key again", cursor.Key(kRight, true, &out) ? "took" : "left", "left");

  mvp::PadCursor resized;
  resized.SetScreen(640, 480);
  resized.SetScreen(1280, 960);
  Expect("a screen that changes size keeps it at the same part", At(resized), "640,480");

  std::printf(g_failures ? "\n%d failed\n" : "\nall passed\n", g_failures);
  return g_failures ? 1 : 0;
}
