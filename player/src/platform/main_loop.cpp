#include "platform/main_loop.h"

#include <algorithm>
#include <csignal>
#include <string>

#include "bindings/webgl_binding.h"
#include "engine/host.h"
#include "platform/clock.h"
#include "platform/fit.h"
#include "platform/input.h"
#include "platform/log.h"
#include "platform/settings_menu.h"
#include "platform/touch.h"
#include "platform/video.h"
#include "platform/window.h"

namespace mvp {

namespace {
volatile std::sig_atomic_t g_terminate = 0;
void OnTerminate(int) { g_terminate = 1; }

// How an on-screen control is drawn: by its name when it has one, else from
// the key it presses (browser key codes; 0 is the direction pad).
ControlSymbol SymbolFor(const TouchShape& shape) {
  if (!shape.label.empty()) return ControlSymbol::kPlain;
  switch (shape.key_code) {
    case kTouchPad: return ControlSymbol::kDirections;
    case kTouchStick: return ControlSymbol::kStick;
    case 88: return ControlSymbol::kCancel;
    case 16: return ControlSymbol::kDash;
    default: return ControlSymbol::kConfirm;
  }
}

// The height of a name's letters, so that it fits inside its circle: a
// letter is 5 dots wide and 7 high, with a dot between letters.
float LetterHeight(const TouchShape& shape) {
  float dots_wide = static_cast<float>(shape.label.size()) * 6.0f - 1.0f;
  float dot = std::min(shape.radius * 1.5f / dots_wide, shape.radius * 0.8f / 7.0f);
  return dot * 7.0f;
}
}  // namespace

int RunMainLoop(Window& window, Input& input, Host& host, const Clock& clock, Log& log, VideoPlayer& video) {
  std::signal(SIGTERM, OnTerminate);
  std::signal(SIGINT, OnTerminate);

  host.StartWatchdog(&g_terminate);
  long frames = 0;
  double started = clock.NowMs();
  bool idle = false;
  double last_ms = started;
  // What showing a frame costs beyond the game's own work: copying its
  // picture to the screen, and handing the screen over (which waits for the
  // display where it is in step with it).
  double present_ms = 0, swap_ms = 0;
  while (!host.exit_requested() && !g_terminate) {
    host.Heartbeat();
    if (!window.PumpEvents(input)) break;
    if (window.TakeResized()) {
      // A desktop's window changed size: the picture is fitted to it from
      // now on, and the touch controls and the game list are told.
      input.SetScreenSize(window.width(), window.height());
      host.DispatchResize(window.width(), window.height());
    }
    if (input.quit_requested()) {
      log.Write(LogLevel::kInfo, "loop", "quit combination pressed (menu button + Start, or Back held)");
      break;
    }
    // Key changes reach the game before this frame's work, as a browser
    // delivers key events between frames.
    for (const KeyChange& change : input.TakeChanges()) host.DispatchKey(change.key_code, change.down);
    double now_ms = clock.NowMs();
    input.Advance((now_ms - last_ms) / 1000.0);
    last_ms = now_ms;
    for (const PointerChange& change : input.TakePointerChanges()) {
      // A game is told the place in its own picture, which is fitted inside
      // the screen; the game list draws straight to the screen.
      PicturePoint at = {change.x, change.y};
      if (HasDrawingBuffer()) {
        int picture_width = 0, picture_height = 0;
        DrawingBufferSize(&picture_width, &picture_height);
        at = ScreenToPicture(window.width(), window.height(), picture_width, picture_height, change.x, change.y);
      }
      host.DispatchPointer(change.phase, at.x, at.y);
    }
    // Frame callbacks are the only source of work so far. When none is
    // waiting, nothing can run again, so the loop ends instead of presenting
    // empty frames for ever (for example after a script failed while loading).
    if (!host.has_pending_frames()) {
      idle = true;
      break;
    }
    // Cleared first, so whatever the scripts draw this frame is what shows.
    // Once the game has its own drawing buffer it does its own clearing, and
    // a frame it chooses not to redraw must keep the previous picture.
    if (!HasDrawingBuffer()) {
      const float* colour = host.clear_color();
      window.Clear(colour[0], colour[1], colour[2]);
    }
    // The game waits while the player's own menu is open; its last picture
    // stays on the screen under the menu.
    if (!input.menu_open()) host.RunFrameCallbacks(clock.NowMs());
    std::vector<ScreenCircle> circles;
    std::vector<ScreenText> texts;
    for (const TouchShape& shape : input.TouchShapes()) {
      circles.push_back({shape.x, shape.y, shape.radius, SymbolFor(shape), shape.lit, shape.knob_x, shape.knob_y});
      if (!shape.label.empty()) texts.push_back({shape.x, shape.y, LetterHeight(shape), shape.label});
    }
    std::vector<MenuBox> menu_boxes;
    std::vector<MenuText> menu_texts;
    input.MenuPicture(&menu_boxes, &menu_texts);
    std::vector<ScreenBox> boxes;
    for (const MenuBox& box : menu_boxes) boxes.push_back({box.x, box.y, box.width, box.height, box.shade, box.alpha});
    for (const MenuText& text : menu_texts) texts.push_back({text.x, text.y, text.height, text.text});
    // The pointer worked with the pad: a white cross edged in black, which
    // shows on any picture.
    float cursor_x = 0, cursor_y = 0;
    if (input.Cursor(&cursor_x, &cursor_y)) {
      float arm = static_cast<float>(std::min(window.width(), window.height())) * 0.022f;
      float thick = std::max(2.0f, arm * 0.22f), edge = std::max(1.0f, thick * 0.5f);
      boxes.push_back({cursor_x - arm - edge, cursor_y - thick / 2 - edge, 2 * (arm + edge), thick + 2 * edge, 0.0f, 1.0f});
      boxes.push_back({cursor_x - thick / 2 - edge, cursor_y - arm - edge, thick + 2 * edge, 2 * (arm + edge), 0.0f, 1.0f});
      boxes.push_back({cursor_x - arm, cursor_y - thick / 2, 2 * arm, thick, 1.0f, 1.0f});
      boxes.push_back({cursor_x - thick / 2, cursor_y - arm, thick, 2 * arm, 1.0f, 1.0f});
    }
    VideoPicture picture;
    ScreenVideo screen_video;
    bool has_video = video.Picture(&picture);
    if (has_video) screen_video = {picture.pixels, picture.width, picture.height, picture.changed};
    double before_present = clock.NowMs();
    PresentDrawingBuffer(window.width(), window.height(), circles, boxes, texts, has_video ? &screen_video : nullptr);
    double before_swap = clock.NowMs();
    window.Swap();
    present_ms += before_swap - before_present;
    swap_ms += clock.NowMs() - before_swap;
    frames++;
  }
  double seconds = (clock.NowMs() - started) / 1000.0;
  long gl_calls = TakeWebGLCallCount();
  if (gl_calls > 0 && frames > 0) {
    log.Write(LogLevel::kInfo, "loop", "WebGL calls: " + std::to_string(gl_calls) + " in total, " +
                                           std::to_string(gl_calls / frames) + " per frame");
  }
  log.Write(LogLevel::kInfo, "loop",
            std::to_string(frames) + " frames in " + std::to_string(seconds) + " s" +
                (frames > 0 ? "; per frame, " + std::to_string(present_ms / static_cast<double>(frames)) +
                                  " ms copying the picture to the screen and " +
                                  std::to_string(swap_ms / static_cast<double>(frames)) + " ms handing it over"
                            : "") +
                (g_terminate ? " (stopped by a signal)" : "") +
                (idle ? " (nothing left to run)" : ""));
  if (host.had_script_error()) return 2;
  return host.exit_code();
}

}  // namespace mvp
