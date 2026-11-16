// WebGL 1 for the game, wired straight to OpenGL ES 2.
//
// Creates the JavaScript object a browser would return from
// canvas.getContext('webgl'): the constants plus the functions the game
// uses. Almost every function is a direct call to its OpenGL ES 2
// counterpart. The places where WebGL behaves differently are handled here:
//   - shader sources are rewritten to high precision before compiling,
//     because this GPU's medium precision is only 10 bits;
//   - the flip and premultiply pixel-store flags, which OpenGL ES does not
//     have, are remembered and applied to pixels before upload;
//   - the context reports the attributes PIXI checks at start-up.
//
// There is one OpenGL context per process, so the binding keeps its small
// amount of state in one place and must be used from the main thread with
// that context current.
#pragma once

#include <string>
#include <vector>

#include "v8.h"

namespace mvp {

// Returns a new WebGL context object for the current OpenGL ES context.
v8::Local<v8::Object> CreateWebGLContext(v8::Isolate* isolate, v8::Local<v8::Context> context,
                                         int drawing_width, int drawing_height);

// The game draws at its own size (816x624 for the reference game), which is
// not the screen's. When a script calls gl.setDrawingBufferSize(w, h), the
// binding gives the game an off-screen drawing buffer of that size in place
// of the screen: binding "no framebuffer" then selects that buffer. This
// call copies it to the real screen, scaled to fit with its proportions
// kept, and leaves the OpenGL state exactly as the game had it. It does
// nothing until a drawing buffer size has been set.
//
// `circles` are drawn last, over everything, see-through: the on-screen
// touch controls. Positions are screen pixels from the top left. Each is
// drawn as what it does, so it can be read without trying it: the direction
// pad as a cross with an arrowhead on each arm, a button as a ring around a
// symbol. `lit` brightens what a finger is on: any value for a button; for
// the pad, 1 left + 2 up + 4 right + 8 down.
// kPlain is the ring alone, for a control that carries a name instead (see
// `texts`).
enum class ControlSymbol { kDirections = 0, kConfirm = 1, kCancel = 2, kDash = 3, kPlain = 4 };
struct ScreenCircle {
  float x, y, radius;
  ControlSymbol symbol = ControlSymbol::kConfirm;
  int lit = 0;
};
//
// `boxes` are filled rectangles drawn over the circles: the player's own
// menu. `shade` runs from 0 (black) to 1 (white).
struct ScreenBox {
  float x, y, width, height, shade, alpha;
};
//
// `texts` are written over the circles and the boxes, in the player's own small font
// (capital letters, digits and a few signs; anything else is left blank):
// each centred on x, y, its letters `height` pixels high.
struct ScreenText {
  float x, y, height;
  std::string text;
};
//
// `video`, when given, is shown in place of the game's picture, fitted to
// the screen the same way: a frame of a video that is playing.
struct ScreenVideo {
  const unsigned char* pixels = nullptr;  // RGBA, top row first
  int width = 0, height = 0;
  bool changed = false;  // the pixels differ from the last call's
};
void PresentDrawingBuffer(int screen_width, int screen_height, const std::vector<ScreenCircle>& circles,
                          const std::vector<ScreenBox>& boxes, const std::vector<ScreenText>& texts, const ScreenVideo* video = nullptr);

// True once the game has its own drawing buffer; the main loop then leaves
// clearing to the game.
bool HasDrawingBuffer();

// Releases the references the binding holds into the JavaScript engine. Must
// be called before the engine is shut down; they cannot outlive it.
void ReleaseWebGLBinding();

// Number of WebGL calls made since the last call to this function.
long TakeWebGLCallCount();

}  // namespace mvp
