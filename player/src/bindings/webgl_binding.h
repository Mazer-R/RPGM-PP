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
// `circles` are drawn last, over everything, as faint see-through rings: the
// on-screen touch controls. Positions are screen pixels from the top left.
struct ScreenCircle {
  float x, y, radius;
};
void PresentDrawingBuffer(int screen_width, int screen_height, const std::vector<ScreenCircle>& circles);

// True once the game has its own drawing buffer; the main loop then leaves
// clearing to the game.
bool HasDrawingBuffer();

// Releases the references the binding holds into the JavaScript engine. Must
// be called before the engine is shut down; they cannot outlive it.
void ReleaseWebGLBinding();

// Number of WebGL calls made since the last call to this function.
long TakeWebGLCallCount();

}  // namespace mvp
