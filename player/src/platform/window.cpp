#include "platform/window.h"

#include "platform/input.h"

#include <GLES2/gl2.h>
#include <SDL.h>

namespace mvp {

Window::~Window() {
  if (context_) SDL_GL_DeleteContext(context_);
  if (window_) SDL_DestroyWindow(window_);
  if (window_ || context_) SDL_Quit();
}

bool Window::Open(std::string* error) {
  if (SDL_Init(SDL_INIT_VIDEO) != 0) {
    *error = std::string("SDL_Init: ") + SDL_GetError();
    return false;
  }
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
  // PIXI refuses its WebGL renderer without a stencil buffer.
  SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 0);

  SDL_DisplayMode mode{};
  if (SDL_GetCurrentDisplayMode(0, &mode) != 0 || mode.w <= 0 || mode.h <= 0) {
    mode.w = 640;
    mode.h = 480;
  }
  window_ = SDL_CreateWindow("mvplayer", SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED, mode.w,
                             mode.h, SDL_WINDOW_OPENGL | SDL_WINDOW_FULLSCREEN);
  if (!window_) {
    *error = std::string("SDL_CreateWindow: ") + SDL_GetError();
    return false;
  }
  context_ = SDL_GL_CreateContext(window_);
  if (!context_) {
    *error = std::string("SDL_GL_CreateContext: ") + SDL_GetError();
    return false;
  }
  SDL_GL_SetSwapInterval(1);
  SDL_GL_GetDrawableSize(window_, &width_, &height_);
  glViewport(0, 0, width_, height_);
  return true;
}

std::string Window::DriverDescription() const {
  auto text = [](GLenum name) {
    const GLubyte* value = glGetString(name);
    return std::string(value ? reinterpret_cast<const char*>(value) : "?");
  };
  return text(GL_RENDERER) + " | " + text(GL_VERSION) + " | " + std::to_string(width_) + "x" +
         std::to_string(height_) + " | video driver " +
         (SDL_GetCurrentVideoDriver() ? SDL_GetCurrentVideoDriver() : "?");
}

void Window::Clear(float r, float g, float b) {
  glClearColor(r, g, b, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT);
}

void Window::Swap() { SDL_GL_SwapWindow(window_); }

bool Window::PumpEvents(Input& input) {
  SDL_Event event;
  bool keep_running = true;
  while (SDL_PollEvent(&event)) {
    if (event.type == SDL_QUIT) keep_running = false;
    else input.HandleEvent(event);
  }
  return keep_running;
}

}  // namespace mvp
