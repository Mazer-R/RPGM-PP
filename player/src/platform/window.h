// The screen. Opens a full-screen SDL2 window with an OpenGL ES 2 context
// and presents frames. This is the only part of the player that includes
// SDL's video headers.
#pragma once

#include <string>

struct SDL_Window;

namespace mvp {

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
  // Drains pending window events. Returns false once the system asks to quit.
  bool PumpEvents();

  int width() const { return width_; }
  int height() const { return height_; }

 private:
  SDL_Window* window_ = nullptr;
  void* context_ = nullptr;
  int width_ = 0;
  int height_ = 0;
};

}  // namespace mvp
