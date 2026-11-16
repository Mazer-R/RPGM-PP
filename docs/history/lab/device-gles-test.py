#!/usr/bin/env python3
"""OpenGL ES 2 timing test for the handheld, driven through SDL2 with ctypes.

It opens the device's screen the same way the system's own emulators do
(SDL2 with its Mali video driver), reports what the GPU driver says about
itself, and times a few drawing workloads that stand in for what the game's
WebGL renderer does each frame:

  * an empty frame, with and without waiting for the display refresh;
  * N full-screen alpha-blended textured layers drawn straight to the screen;
  * the same layers drawn into an off-screen texture at the game's 816x624
    resolution and then scaled to the screen (the engine's tone filter makes
    the whole map go through such a texture);
  * re-uploading a full-screen texture every frame (the lighting plugin
    redraws and re-uploads its darkness mask).

Nothing from the game is used; the textures are generated noise. Results are
printed as one JSON object. Needs no compiler: Python 3 and the system's own
libSDL2 and libGLESv2 only.
"""
import ctypes
import json
import os
import sys
import time

SCREEN_W, SCREEN_H = 640, 480
GAME_W, GAME_H = 816, 624
FRAMES = int(os.environ.get("LAB_FRAMES", "90"))

sdl = ctypes.CDLL("libSDL2-2.0.so.0")
gl = ctypes.CDLL("libGLESv2.so.2")

sdl.SDL_GetError.restype = ctypes.c_char_p
sdl.SDL_CreateWindow.restype = ctypes.c_void_p
sdl.SDL_CreateWindow.argtypes = [ctypes.c_char_p] + [ctypes.c_int] * 4 + [ctypes.c_uint32]
sdl.SDL_GL_CreateContext.restype = ctypes.c_void_p
sdl.SDL_GL_CreateContext.argtypes = [ctypes.c_void_p]
sdl.SDL_GL_SwapWindow.argtypes = [ctypes.c_void_p]
sdl.SDL_GL_DeleteContext.argtypes = [ctypes.c_void_p]
sdl.SDL_DestroyWindow.argtypes = [ctypes.c_void_p]
sdl.SDL_GetCurrentVideoDriver.restype = ctypes.c_char_p
sdl.SDL_GL_GetDrawableSize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
gl.glGetString.restype = ctypes.c_char_p
gl.glCreateShader.restype = ctypes.c_uint
gl.glCreateProgram.restype = ctypes.c_uint
gl.glClearColor.argtypes = [ctypes.c_float] * 4
gl.glUniform1f.argtypes = [ctypes.c_int, ctypes.c_float]

SDL_INIT_VIDEO = 0x20
SDL_WINDOW_FULLSCREEN, SDL_WINDOW_OPENGL = 0x1, 0x2
(SDL_GL_DEPTH_SIZE, SDL_GL_STENCIL_SIZE, SDL_GL_CONTEXT_MAJOR_VERSION,
 SDL_GL_CONTEXT_MINOR_VERSION, SDL_GL_CONTEXT_PROFILE_MASK) = 6, 7, 17, 18, 21
SDL_GL_CONTEXT_PROFILE_ES = 0x4

GL_TRIANGLE_STRIP, GL_FLOAT, GL_UNSIGNED_BYTE = 0x0005, 0x1406, 0x1401
GL_TEXTURE_2D, GL_RGBA, GL_BLEND = 0x0DE1, 0x1908, 0x0BE2
GL_ONE, GL_ONE_MINUS_SRC_ALPHA = 1, 0x0303
GL_COLOR_BUFFER_BIT = 0x4000
GL_LINEAR, GL_CLAMP_TO_EDGE = 0x2601, 0x812F
GL_TEXTURE_MIN_FILTER, GL_TEXTURE_MAG_FILTER, GL_TEXTURE_WRAP_S, GL_TEXTURE_WRAP_T = 0x2801, 0x2800, 0x2802, 0x2803
GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_FRAMEBUFFER_COMPLETE = 0x8D40, 0x8CE0, 0x8CD5
GL_VERTEX_SHADER, GL_FRAGMENT_SHADER = 0x8B31, 0x8B30
GL_COMPILE_STATUS, GL_LINK_STATUS = 0x8B81, 0x8B82
GL_VENDOR, GL_RENDERER, GL_VERSION, GL_EXTENSIONS = 0x1F00, 0x1F01, 0x1F02, 0x1F03
GL_MAX_TEXTURE_SIZE, GL_STENCIL_BITS = 0x0D33, 0x0D57
GL_MEDIUM_FLOAT, GL_HIGH_FLOAT = 0x8DF1, 0x8DF2


def fail(message):
    print(json.dumps({"error": message, "sdl": (sdl.SDL_GetError() or b"").decode()}))
    sys.exit(1)


def get_int(name):
    value = ctypes.c_int(0)
    gl.glGetIntegerv(name, ctypes.byref(value))
    return value.value


def precision(kind):
    rng = (ctypes.c_int * 2)()
    bits = ctypes.c_int(0)
    gl.glGetShaderPrecisionFormat(GL_FRAGMENT_SHADER, kind, rng, ctypes.byref(bits))
    return bits.value


def compile_shader(kind, source):
    shader = gl.glCreateShader(kind)
    text = ctypes.c_char_p(source.encode())
    gl.glShaderSource(shader, 1, ctypes.byref(text), None)
    gl.glCompileShader(shader)
    status = ctypes.c_int(0)
    gl.glGetShaderiv(shader, GL_COMPILE_STATUS, ctypes.byref(status))
    if not status.value:
        log = ctypes.create_string_buffer(1024)
        gl.glGetShaderInfoLog(shader, 1024, None, log)
        fail("shader: " + log.value.decode(errors="replace"))
    return shader


def make_texture(width, height, data=None):
    texture = ctypes.c_uint(0)
    gl.glGenTextures(1, ctypes.byref(texture))
    gl.glBindTexture(GL_TEXTURE_2D, texture)
    for name, value in ((GL_TEXTURE_MIN_FILTER, GL_LINEAR), (GL_TEXTURE_MAG_FILTER, GL_LINEAR),
                        (GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE), (GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)):
        gl.glTexParameteri(GL_TEXTURE_2D, name, value)
    gl.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, data)
    return texture


def noise(width, height):
    # Cheap repeating pattern with partial alpha; content does not matter.
    row = bytes((x * 7 + c * 61) & 0xFF if c < 3 else 160 for x in range(width) for c in range(4))
    return ctypes.create_string_buffer(row * height, width * height * 4)


if sdl.SDL_Init(SDL_INIT_VIDEO) != 0:
    fail("SDL_Init")
sdl.SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES)
sdl.SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2)
sdl.SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0)
sdl.SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8)
sdl.SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 0)
window = sdl.SDL_CreateWindow(b"lab", 0, 0, SCREEN_W, SCREEN_H, SDL_WINDOW_OPENGL | SDL_WINDOW_FULLSCREEN)
if not window:
    fail("SDL_CreateWindow")
context = sdl.SDL_GL_CreateContext(window)
if not context:
    fail("SDL_GL_CreateContext")

drawable_w, drawable_h = ctypes.c_int(0), ctypes.c_int(0)
sdl.SDL_GL_GetDrawableSize(window, ctypes.byref(drawable_w), ctypes.byref(drawable_h))
info = {
    "videoDriver": (sdl.SDL_GetCurrentVideoDriver() or b"").decode(),
    "drawable": [drawable_w.value, drawable_h.value],
    "vendor": (gl.glGetString(GL_VENDOR) or b"").decode(),
    "renderer": (gl.glGetString(GL_RENDERER) or b"").decode(),
    "version": (gl.glGetString(GL_VERSION) or b"").decode(),
    "extensions": (gl.glGetString(GL_EXTENSIONS) or b"").decode().split(),
    "maxTextureSize": get_int(GL_MAX_TEXTURE_SIZE),
    "stencilBits": get_int(GL_STENCIL_BITS),
    "fragmentPrecisionBits": {"mediump": precision(GL_MEDIUM_FLOAT), "highp": precision(GL_HIGH_FLOAT)},
}

program = gl.glCreateProgram()
gl.glAttachShader(program, compile_shader(GL_VERTEX_SHADER,
    "attribute vec2 p; attribute vec2 t; varying vec2 v;"
    "void main(){ v = t; gl_Position = vec4(p, 0.0, 1.0); }"))
gl.glAttachShader(program, compile_shader(GL_FRAGMENT_SHADER,
    "precision mediump float; varying vec2 v; uniform sampler2D s; uniform float a;"
    "void main(){ gl_FragColor = texture2D(s, v) * a; }"))
gl.glBindAttribLocation(program, 0, b"p")
gl.glBindAttribLocation(program, 1, b"t")
gl.glLinkProgram(program)
linked = ctypes.c_int(0)
gl.glGetProgramiv(program, GL_LINK_STATUS, ctypes.byref(linked))
if not linked.value:
    fail("program link")
gl.glUseProgram(program)
alpha_location = gl.glGetUniformLocation(program, b"a")

quad = (ctypes.c_float * 16)(-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1)
stride = 4 * ctypes.sizeof(ctypes.c_float)
gl.glVertexAttribPointer(0, 2, GL_FLOAT, 0, stride, quad)
gl.glVertexAttribPointer(1, 2, GL_FLOAT, 0, stride, ctypes.byref(quad, 2 * ctypes.sizeof(ctypes.c_float)))
gl.glEnableVertexAttribArray(0)
gl.glEnableVertexAttribArray(1)
gl.glEnable(GL_BLEND)
gl.glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)

layer_pixels = noise(1024, 1024)
layer_texture = make_texture(1024, 1024, layer_pixels)
upload_pixels = noise(GAME_W, GAME_H)
upload_texture = make_texture(GAME_W, GAME_H, upload_pixels)
target_texture = make_texture(GAME_W, GAME_H)
framebuffer = ctypes.c_uint(0)
gl.glGenFramebuffers(1, ctypes.byref(framebuffer))
gl.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer)
gl.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target_texture, 0)
info["offscreenComplete"] = gl.glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE
gl.glBindFramebuffer(GL_FRAMEBUFFER, 0)


def draw_layers(count):
    gl.glBindTexture(GL_TEXTURE_2D, layer_texture)
    gl.glUniform1f(alpha_location, 0.5)
    for _ in range(count):
        gl.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4)


def frame_direct(layers):
    gl.glViewport(0, 0, SCREEN_W, SCREEN_H)
    gl.glClear(GL_COLOR_BUFFER_BIT)
    draw_layers(layers)


def frame_offscreen(layers):
    gl.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer)
    gl.glViewport(0, 0, GAME_W, GAME_H)
    gl.glClear(GL_COLOR_BUFFER_BIT)
    draw_layers(layers)
    gl.glBindFramebuffer(GL_FRAMEBUFFER, 0)
    gl.glViewport(0, 0, SCREEN_W, SCREEN_H)
    gl.glClear(GL_COLOR_BUFFER_BIT)
    gl.glBindTexture(GL_TEXTURE_2D, target_texture)
    gl.glUniform1f(alpha_location, 1.0)
    gl.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4)


def frame_upload(layers):
    gl.glBindTexture(GL_TEXTURE_2D, upload_texture)
    gl.glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, GAME_W, GAME_H, GL_RGBA, GL_UNSIGNED_BYTE, upload_pixels)
    frame_direct(layers)


def measure(label, draw, layers, swap_interval):
    sdl.SDL_GL_SetSwapInterval(swap_interval)
    times = []
    gpu_times = []
    for index in range(FRAMES + 10):
        started = time.perf_counter()
        draw(layers)
        # glFinish waits until the GPU has really done the work, so the time
        # up to here is the cost of drawing alone, without the wait for the
        # display refresh that the buffer swap adds.
        gl.glFinish()
        drawn = time.perf_counter()
        sdl.SDL_GL_SwapWindow(window)
        if index >= 10:  # skip warm-up frames
            times.append((time.perf_counter() - started) * 1000.0)
            gpu_times.append((drawn - started) * 1000.0)
    times.sort()
    gpu_times.sort()
    return {
        "case": label, "layers": layers, "vsync": bool(swap_interval),
        "drawMedianMs": round(gpu_times[len(gpu_times) // 2], 2),
        "drawP95Ms": round(gpu_times[int(len(gpu_times) * 0.95) - 1], 2),
        "medianMs": round(times[len(times) // 2], 2),
        "p95Ms": round(times[int(len(times) * 0.95) - 1], 2),
        "maxMs": round(times[-1], 2),
        "glError": gl.glGetError(),
    }


gl.glClearColor(0.05, 0.05, 0.1, 1.0)
results = [measure("empty frame, waiting for refresh", frame_direct, 0, 1),
           measure("empty frame", frame_direct, 0, 0)]
for layers in (1, 4, 8, 16, 32, 64):
    results.append(measure("layers to screen", frame_direct, layers, 0))
for layers in (4, 8, 16, 32, 64):
    results.append(measure("layers via 816x624 off-screen texture", frame_offscreen, layers, 0))
results.append(measure("full-screen texture re-upload + 4 layers", frame_upload, 4, 0))
results.append(measure("full-screen texture re-upload only", frame_upload, 0, 0))

sdl.SDL_GL_DeleteContext(context)
sdl.SDL_DestroyWindow(window)
sdl.SDL_Quit()
print(json.dumps({"info": info, "results": results}))
