// The screen. Opens an SDL2 window with an OpenGL ES 2 context and presents
// frames. On a handheld or a phone the window is the whole screen. On a
// desktop (X11 or Wayland) it is an ordinary window that can be resized;
// F11 switches it to the whole screen and back, and MVPLAYER_FULLSCREEN=1
// starts it that way. This is the only part of the player that includes
// SDL's video headers.
#pragma once

#include <string>

struct SDL_Window;

namespace mvp {

class Input;

class Window {
 public:
  Window() = default;
  ~Window();
  Window(const Window&) = delete;
  Window& operator=(const Window&) = delete;

  // Returns false and fills `error` if the screen cannot be opened.
  bool Open(std::string* error);
  // Text describing the graphics driver, for the log.
  std::string DriverDescription() const;
  // Fills the frame with one colour. Stands in for real drawing until the
  // WebGL binding exists.
  void Clear(float r, float g, float b);
  // Presents the frame. Waits for the display refresh when the frame is early.
  void Swap();
  // Drains pending events, passing each one to `input`. Returns false once
  // the system asks to quit.
  bool PumpEvents(Input& input);

  // The size of what is drawn on, in pixels. It changes when a desktop's
  // window is resized.
  int width() const { return width_; }
  int height() const { return height_; }
  // True once after each change of size.
  bool TakeResized();

 private:
  SDL_Window* window_ = nullptr;
  void* context_ = nullptr;
  int width_ = 0;
  int height_ = 0;
  bool resizable_ = false;
  bool resized_ = false;
};

}  // namespace mvp
