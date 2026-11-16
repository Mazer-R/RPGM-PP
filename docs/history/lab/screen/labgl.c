/* Lab experiment: a small Node native module that shows frames on the
 * handheld's screen. It opens the screen through SDL2 and OpenGL ES 2 and
 * offers two calls: present(pixels, width, height), which uploads a frame
 * drawn elsewhere and shows it scaled to fit, and quit().
 *
 * SDL2 and the GL library are loaded at run time with dlopen, so the module
 * builds without their headers and uses the handheld's own copies.
 *
 * Pixels are expected as the `canvas` package's "raw" buffer: 4 bytes per
 * pixel in blue, green, red, alpha order, rows from top to bottom. */
#include <node_api.h>
#include <dlfcn.h>
#include <stdio.h>

static void *sdl, *gles, *window, *context;
static int screen_w = 640, screen_h = 480;
static unsigned texture, program;
static int tex_w, tex_h;

static int (*SDL_Init_)(unsigned);
static int (*SDL_GL_SetAttribute_)(int, int);
static void *(*SDL_CreateWindow_)(const char *, int, int, int, int, unsigned);
static void *(*SDL_GL_CreateContext_)(void *);
static int (*SDL_GL_SetSwapInterval_)(int);
static void (*SDL_GL_SwapWindow_)(void *);
static void (*SDL_GL_GetDrawableSize_)(void *, int *, int *);
static const char *(*SDL_GetError_)(void);
static int (*SDL_PollEvent_)(void *);
static void (*SDL_Quit_)(void);

static void (*glViewport_)(int, int, int, int);
static void (*glClearColor_)(float, float, float, float);
static void (*glClear_)(unsigned);
static void (*glGenTextures_)(int, unsigned *);
static void (*glBindTexture_)(unsigned, unsigned);
static void (*glTexParameteri_)(unsigned, unsigned, int);
static void (*glTexImage2D_)(unsigned, int, int, int, int, int, unsigned, unsigned, const void *);
static void (*glTexSubImage2D_)(unsigned, int, int, int, int, int, unsigned, unsigned, const void *);
static unsigned (*glCreateShader_)(unsigned);
static void (*glShaderSource_)(unsigned, int, const char **, const int *);
static void (*glCompileShader_)(unsigned);
static unsigned (*glCreateProgram_)(void);
static void (*glAttachShader_)(unsigned, unsigned);
static void (*glBindAttribLocation_)(unsigned, unsigned, const char *);
static void (*glLinkProgram_)(unsigned);
static void (*glUseProgram_)(unsigned);
static void (*glVertexAttribPointer_)(unsigned, int, unsigned, unsigned char, int, const void *);
static void (*glEnableVertexAttribArray_)(unsigned);
static void (*glDrawArrays_)(unsigned, int, int);

#define LOAD(lib, name) name##_ = dlsym(lib, #name)

static napi_value fail(napi_env env, const char *what) {
  char message[256];
  snprintf(message, sizeof message, "%s: %s", what, SDL_GetError_ ? SDL_GetError_() : "library not loaded");
  napi_throw_error(env, NULL, message);
  return NULL;
}

static unsigned shader(unsigned type, const char *source) {
  unsigned s = glCreateShader_(type);
  glShaderSource_(s, 1, &source, NULL);
  glCompileShader_(s);
  return s;
}

static int open_screen(napi_env env) {
  sdl = dlopen("libSDL2-2.0.so.0", RTLD_NOW | RTLD_GLOBAL);
  gles = dlopen("libGLESv2.so.2", RTLD_NOW | RTLD_GLOBAL);
  if (!sdl || !gles) { fail(env, "dlopen"); return 0; }
  LOAD(sdl, SDL_Init); LOAD(sdl, SDL_GL_SetAttribute); LOAD(sdl, SDL_CreateWindow);
  LOAD(sdl, SDL_GL_CreateContext); LOAD(sdl, SDL_GL_SetSwapInterval); LOAD(sdl, SDL_GL_SwapWindow);
  LOAD(sdl, SDL_GL_GetDrawableSize); LOAD(sdl, SDL_GetError); LOAD(sdl, SDL_PollEvent); LOAD(sdl, SDL_Quit);
  LOAD(gles, glViewport); LOAD(gles, glClearColor); LOAD(gles, glClear); LOAD(gles, glGenTextures);
  LOAD(gles, glBindTexture); LOAD(gles, glTexParameteri); LOAD(gles, glTexImage2D); LOAD(gles, glTexSubImage2D);
  LOAD(gles, glCreateShader); LOAD(gles, glShaderSource); LOAD(gles, glCompileShader);
  LOAD(gles, glCreateProgram); LOAD(gles, glAttachShader); LOAD(gles, glBindAttribLocation);
  LOAD(gles, glLinkProgram); LOAD(gles, glUseProgram); LOAD(gles, glVertexAttribPointer);
  LOAD(gles, glEnableVertexAttribArray); LOAD(gles, glDrawArrays);

  if (SDL_Init_(0x20) != 0) { fail(env, "SDL_Init"); return 0; }
  SDL_GL_SetAttribute_(21, 4); /* profile: ES */
  SDL_GL_SetAttribute_(17, 2); /* major version */
  SDL_GL_SetAttribute_(18, 0); /* minor version */
  window = SDL_CreateWindow_("lab", 0, 0, screen_w, screen_h, 0x2 | 0x1);
  if (!window) { fail(env, "SDL_CreateWindow"); return 0; }
  context = SDL_GL_CreateContext_(window);
  if (!context) { fail(env, "SDL_GL_CreateContext"); return 0; }
  SDL_GL_SetSwapInterval_(1);
  SDL_GL_GetDrawableSize_(window, &screen_w, &screen_h);

  program = glCreateProgram_();
  glAttachShader_(program, shader(0x8B31,
      "attribute vec2 p; attribute vec2 t; varying vec2 v;"
      "void main(){ v = t; gl_Position = vec4(p, 0.0, 1.0); }"));
  /* The source bytes are blue, green, red, alpha; swap to red, green, blue. */
  glAttachShader_(program, shader(0x8B30,
      "precision mediump float; varying vec2 v; uniform sampler2D s;"
      "void main(){ gl_FragColor = vec4(texture2D(s, v).bgr, 1.0); }"));
  glBindAttribLocation_(program, 0, "p");
  glBindAttribLocation_(program, 1, "t");
  glLinkProgram_(program);
  glUseProgram_(program);

  glGenTextures_(1, &texture);
  glBindTexture_(0x0DE1, texture);
  glTexParameteri_(0x0DE1, 0x2801, 0x2601); /* min filter: linear */
  glTexParameteri_(0x0DE1, 0x2800, 0x2601); /* mag filter: linear */
  glTexParameteri_(0x0DE1, 0x2802, 0x812F); /* wrap s: clamp */
  glTexParameteri_(0x0DE1, 0x2803, 0x812F); /* wrap t: clamp */
  return 1;
}

/* present(buffer, width, height): show one frame, scaled to fit the screen
 * with its proportions kept. */
static napi_value Present(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3];
  void *data = NULL; size_t length = 0; int width = 0, height = 0;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 3 || napi_get_buffer_info(env, args[0], &data, &length) != napi_ok) {
    napi_throw_error(env, NULL, "present(buffer, width, height)");
    return NULL;
  }
  napi_get_value_int32(env, args[1], &width);
  napi_get_value_int32(env, args[2], &height);
  if (width <= 0 || height <= 0 || length < (size_t)width * (size_t)height * 4) {
    napi_throw_error(env, NULL, "present: buffer smaller than width*height*4");
    return NULL;
  }
  if (!window && !open_screen(env)) return NULL;

  char event[64];
  while (SDL_PollEvent_(event)) { }

  glBindTexture_(0x0DE1, texture);
  if (width != tex_w || height != tex_h) {
    glTexImage2D_(0x0DE1, 0, 0x1908, width, height, 0, 0x1908, 0x1401, data);
    tex_w = width; tex_h = height;
  } else {
    glTexSubImage2D_(0x0DE1, 0, 0, 0, width, height, 0x1908, 0x1401, data);
  }

  /* Fit the frame inside the screen, keeping its proportions. */
  float scale_x = (float)screen_w / (float)width, scale_y = (float)screen_h / (float)height;
  float scale = scale_x < scale_y ? scale_x : scale_y;
  float x = (float)width * scale / (float)screen_w, y = (float)height * scale / (float)screen_h;
  /* Texture row 0 is the top of the picture, so the top of the quad uses t = 0. */
  float quad[16] = { -x, -y, 0, 1,   x, -y, 1, 1,   -x, y, 0, 0,   x, y, 1, 0 };
  glViewport_(0, 0, screen_w, screen_h);
  glClearColor_(0, 0, 0, 1);
  glClear_(0x4000);
  glVertexAttribPointer_(0, 2, 0x1406, 0, 4 * sizeof(float), quad);
  glVertexAttribPointer_(1, 2, 0x1406, 0, 4 * sizeof(float), quad + 2);
  glEnableVertexAttribArray_(0);
  glEnableVertexAttribArray_(1);
  glDrawArrays_(0x0005, 0, 4);
  SDL_GL_SwapWindow_(window);
  return NULL;
}

static napi_value Quit(napi_env env, napi_callback_info info) {
  if (window && SDL_Quit_) SDL_Quit_();
  window = NULL;
  return NULL;
}

static napi_value Setup(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "present", NULL, Present, NULL, NULL, NULL, napi_default, NULL },
    { "quit", NULL, Quit, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 2, properties);
  return exports;
}
NAPI_MODULE(labgl, Setup)
