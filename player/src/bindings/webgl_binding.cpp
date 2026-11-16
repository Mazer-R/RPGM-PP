#include "bindings/webgl_binding.h"

#include <GLES2/gl2.h>

#include "bindings/canvas_binding.h"

#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace mvp {

namespace {

// WebGL-only constants: pixel-store flags OpenGL ES does not have, and the
// combined depth-stencil names.
constexpr GLenum kUnpackFlipY = 0x9240;
constexpr GLenum kUnpackPremultiplyAlpha = 0x9241;
constexpr GLenum kUnpackColorspaceConversion = 0x9243;

struct Constant {
  const char* name;
  unsigned value;
};
const Constant kConstants[] = {
#include "gl_constants.inc"
    {"UNPACK_FLIP_Y_WEBGL", 0x9240},
    {"UNPACK_PREMULTIPLY_ALPHA_WEBGL", 0x9241},
    {"CONTEXT_LOST_WEBGL", 0x9242},
    {"UNPACK_COLORSPACE_CONVERSION_WEBGL", 0x9243},
    {"BROWSER_DEFAULT_WEBGL", 0x9244},
    {"DEPTH_STENCIL", 0x84F9},
    {"DEPTH_STENCIL_ATTACHMENT", 0x821A},
};

struct State {
  bool flip_y = false;
  bool premultiply = false;
  long calls = 0;
  // The game's own drawing buffer, standing in for the screen (0 = none).
  GLuint buffer_framebuffer = 0;
  GLuint buffer_texture = 0;
  GLuint buffer_stencil = 0;
  int buffer_width = 0;
  int buffer_height = 0;
  GLuint present_program = 0;
  GLuint ring_program = 0;  // draws the touch controls
  // A small picture drawn over the game when it is shown on the screen (the
  // frame-rate display). Pixels are RGBA rows, top row first.
  std::vector<uint8_t> overlay_pixels;
  int overlay_width = 0, overlay_height = 0, overlay_x = 0, overlay_y = 0;
  bool overlay_changed = false;
  GLuint overlay_texture = 0;
  GLuint video_texture = 0;  // the frame of a playing video, shown in the game's place
  int video_width = 0, video_height = 0;
  // Pixel memory of each texture, by OpenGL name, to report the total.
  std::map<GLuint, long long> texture_bytes;
  v8::Global<v8::Private> name_key;  // hidden property holding an object's GL name
};
State g_state;

using Args = v8::FunctionCallbackInfo<v8::Value>;

v8::Local<v8::String> Str(v8::Isolate* isolate, const char* text) {
  return v8::String::NewFromUtf8(isolate, text).ToLocalChecked();
}

std::string ToStd(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  v8::String::Utf8Value utf8(isolate, value);
  return *utf8 ? std::string(*utf8, static_cast<size_t>(utf8.length())) : std::string();
}

// Wraps an OpenGL name (buffer, texture, program...) in a JavaScript object.
v8::Local<v8::Value> Wrap(v8::Isolate* isolate, GLuint name) {
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  v8::Local<v8::Object> object = v8::Object::New(isolate);
  object->SetPrivate(ctx, g_state.name_key.Get(isolate), v8::Integer::NewFromUnsigned(isolate, name))
      .Check();
  return object;
}

// The OpenGL name inside a wrapper; 0 for null, undefined or anything else.
GLuint Name(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  if (!value->IsObject()) return 0;
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  v8::Local<v8::Value> stored;
  if (!value.As<v8::Object>()->GetPrivate(ctx, g_state.name_key.Get(isolate)).ToLocal(&stored) ||
      !stored->IsUint32()) {
    return 0;
  }
  return stored.As<v8::Uint32>()->Value();
}

// Bytes of a typed array, DataView or ArrayBuffer; null pointer otherwise.
struct Bytes {
  uint8_t* data = nullptr;
  size_t size = 0;
};
Bytes BytesOf(v8::Local<v8::Value> value) {
  Bytes bytes;
  if (value->IsArrayBufferView()) {
    v8::Local<v8::ArrayBufferView> view = value.As<v8::ArrayBufferView>();
    bytes.data = static_cast<uint8_t*>(view->Buffer()->Data()) + view->ByteOffset();
    bytes.size = view->ByteLength();
  } else if (value->IsArrayBuffer()) {
    v8::Local<v8::ArrayBuffer> buffer = value.As<v8::ArrayBuffer>();
    bytes.data = static_cast<uint8_t*>(buffer->Data());
    bytes.size = buffer->ByteLength();
  }
  return bytes;
}

// Numbers from a Float32Array or a plain array, as floats.
std::vector<GLfloat> Floats(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  std::vector<GLfloat> out;
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  if (value->IsFloat32Array()) {
    Bytes bytes = BytesOf(value);
    out.resize(bytes.size / sizeof(GLfloat));
    if (!out.empty()) std::memcpy(out.data(), bytes.data, out.size() * sizeof(GLfloat));
  } else if (value->IsArray()) {
    v8::Local<v8::Array> array = value.As<v8::Array>();
    out.reserve(array->Length());
    for (uint32_t i = 0; i < array->Length(); i++) {
      v8::Local<v8::Value> item;
      out.push_back(array->Get(ctx, i).ToLocal(&item)
                        ? static_cast<GLfloat>(item->NumberValue(ctx).FromMaybe(0.0))
                        : 0.0f);
    }
  }
  return out;
}

std::vector<GLint> Ints(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  std::vector<GLint> out;
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  if (value->IsInt32Array()) {
    Bytes bytes = BytesOf(value);
    out.resize(bytes.size / sizeof(GLint));
    if (!out.empty()) std::memcpy(out.data(), bytes.data, out.size() * sizeof(GLint));
  } else if (value->IsArray()) {
    v8::Local<v8::Array> array = value.As<v8::Array>();
    for (uint32_t i = 0; i < array->Length(); i++) {
      v8::Local<v8::Value> item;
      out.push_back(array->Get(ctx, i).ToLocal(&item) ? item->Int32Value(ctx).FromMaybe(0) : 0);
    }
  }
  return out;
}

// Replaces every precision qualifier with highp. This GPU's mediump has 10
// bits, too coarse to address pixels in a large texture; highp is available.
std::string RewritePrecision(std::string source) {
  for (const char* from : {"mediump", "lowp"}) {
    size_t length = std::strlen(from);
    for (size_t at = source.find(from); at != std::string::npos; at = source.find(from, at + 5)) {
      source.replace(at, length, "highp");
    }
  }
  return source;
}

// One buffer for the pixels of every canvas upload, kept between uploads: a
// new one each time would be megabytes of fresh memory for the system to
// clear on every frame in which a canvas changed. An unusually large upload
// does not keep its memory.
std::vector<uint8_t>& UploadBuffer() {
  static std::vector<uint8_t> buffer;
  if (buffer.size() > 8u * 1024 * 1024) std::vector<uint8_t>().swap(buffer);
  return buffer;
}

// Applies the WebGL flip and premultiply flags to RGBA byte pixels.
std::vector<uint8_t> PreparePixels(const uint8_t* data, int width, int height) {
  size_t row = static_cast<size_t>(width) * 4;
  std::vector<uint8_t> out(row * static_cast<size_t>(height));
  for (int y = 0; y < height; y++) {
    const uint8_t* src = data + row * static_cast<size_t>(g_state.flip_y ? height - 1 - y : y);
    uint8_t* dst = out.data() + row * static_cast<size_t>(y);
    if (!g_state.premultiply) {
      std::memcpy(dst, src, row);
      continue;
    }
    for (int x = 0; x < width; x++) {
      unsigned a = src[x * 4 + 3];
      dst[x * 4 + 0] = static_cast<uint8_t>((src[x * 4 + 0] * a + 127) / 255);
      dst[x * 4 + 1] = static_cast<uint8_t>((src[x * 4 + 1] * a + 127) / 255);
      dst[x * 4 + 2] = static_cast<uint8_t>((src[x * 4 + 2] * a + 127) / 255);
      dst[x * 4 + 3] = static_cast<uint8_t>(a);
    }
  }
  return out;
}

// Creates or resizes the game's drawing buffer: a colour texture plus a
// stencil buffer, which PIXI needs for masks.
void SetDrawingBufferSize(int width, int height) {
  if (width < 1 || height < 1) return;
  GLint previous_texture = 0, previous_renderbuffer = 0;
  glGetIntegerv(GL_TEXTURE_BINDING_2D, &previous_texture);
  glGetIntegerv(GL_RENDERBUFFER_BINDING, &previous_renderbuffer);
  if (!g_state.buffer_framebuffer) {
    glGenFramebuffers(1, &g_state.buffer_framebuffer);
    glGenTextures(1, &g_state.buffer_texture);
    glGenRenderbuffers(1, &g_state.buffer_stencil);
  }
  glBindTexture(GL_TEXTURE_2D, g_state.buffer_texture);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glBindRenderbuffer(GL_RENDERBUFFER, g_state.buffer_stencil);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_STENCIL_INDEX8, width, height);
  glBindFramebuffer(GL_FRAMEBUFFER, g_state.buffer_framebuffer);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_state.buffer_texture, 0);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_STENCIL_ATTACHMENT, GL_RENDERBUFFER, g_state.buffer_stencil);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
  glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(previous_texture));
  glBindRenderbuffer(GL_RENDERBUFFER, static_cast<GLuint>(previous_renderbuffer));
  g_state.buffer_width = width;
  g_state.buffer_height = height;
}

GLuint CompileInternal(GLenum type, const char* source) {
  GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  return shader;
}

// Records the size of the texture bound to GL_TEXTURE_2D after an upload
// that (re)defines its base level.
void NoteTextureSize(int level, int width, int height) {
  if (level != 0) return;
  GLint bound = 0;
  glGetIntegerv(GL_TEXTURE_BINDING_2D, &bound);
  if (bound) g_state.texture_bytes[static_cast<GLuint>(bound)] = static_cast<long long>(width) * height * 4;
}

void Bind(v8::Isolate* isolate, v8::Local<v8::Object> target, const char* name,
          v8::FunctionCallback callback) {
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  v8::Local<v8::Function> function = v8::Function::New(ctx, callback).ToLocalChecked();
  function->SetName(Str(isolate, name));
  target->Set(ctx, Str(isolate, name), function).Check();
}

// Shorthand used only inside the function bodies below.
#define ISO args.GetIsolate()
#define CTX ISO->GetCurrentContext()
#define I(i) (args[i]->Int32Value(CTX).FromMaybe(0))
#define U(i) (static_cast<GLuint>(args[i]->Uint32Value(CTX).FromMaybe(0)))
#define F(i) (static_cast<GLfloat>(args[i]->NumberValue(CTX).FromMaybe(0.0)))
#define B(i) (static_cast<GLboolean>(args[i]->BooleanValue(ISO)))
#define N(i) (Name(ISO, args[i]))
#define RET(v) args.GetReturnValue().Set(v)
// Every call passes through here, so calls can be counted (and later logged,
// timed or checked for driver errors) in one place.
// Variadic because a body may contain commas outside parentheses (in braces),
// which the preprocessor would otherwise read as separate macro arguments.
#define FN(name, ...) \
  Bind(isolate, gl, #name, [](const Args& args) { g_state.calls++; __VA_ARGS__; })

void InstallFunctions(v8::Isolate* isolate, v8::Local<v8::Object> gl) {
  // --- State ---------------------------------------------------------------
  FN(viewport, glViewport(I(0), I(1), I(2), I(3)));
  FN(scissor, glScissor(I(0), I(1), I(2), I(3)));
  FN(enable, glEnable(U(0)));
  FN(disable, glDisable(U(0)));
  FN(blendFunc, glBlendFunc(U(0), U(1)));
  FN(blendFuncSeparate, glBlendFuncSeparate(U(0), U(1), U(2), U(3)));
  FN(blendEquation, glBlendEquation(U(0)));
  FN(blendEquationSeparate, glBlendEquationSeparate(U(0), U(1)));
  FN(blendColor, glBlendColor(F(0), F(1), F(2), F(3)));
  FN(colorMask, glColorMask(B(0), B(1), B(2), B(3)));
  FN(depthMask, glDepthMask(B(0)));
  FN(depthFunc, glDepthFunc(U(0)));
  FN(cullFace, glCullFace(U(0)));
  FN(frontFace, glFrontFace(U(0)));
  FN(stencilFunc, glStencilFunc(U(0), I(1), U(2)));
  FN(stencilMask, glStencilMask(U(0)));
  FN(stencilOp, glStencilOp(U(0), U(1), U(2)));
  FN(clearColor, glClearColor(F(0), F(1), F(2), F(3)));
  FN(clearStencil, glClearStencil(I(0)));
  FN(clearDepth, glClearDepthf(F(0)));
  FN(clear, glClear(U(0)));
  FN(flush, glFlush());
  FN(finish, glFinish());
  FN(getError, RET(static_cast<uint32_t>(glGetError())));
  FN(isContextLost, RET(false));
  FN(getExtension, RET(v8::Null(ISO)));
  FN(getSupportedExtensions, RET(v8::Array::New(ISO, 0)));
  FN(pixelStorei, {
    GLenum name = U(0);
    if (name == kUnpackFlipY) g_state.flip_y = args[1]->BooleanValue(ISO);
    else if (name == kUnpackPremultiplyAlpha) g_state.premultiply = args[1]->BooleanValue(ISO);
    else if (name == kUnpackColorspaceConversion) { /* no colour conversion is done */ }
    else glPixelStorei(name, I(1));
  });
  FN(getContextAttributes, {
    v8::Local<v8::Object> attributes = v8::Object::New(ISO);
    auto set = [&](const char* key, bool value) {
      attributes->Set(CTX, Str(ISO, key), v8::Boolean::New(ISO, value)).Check();
    };
    set("alpha", true); set("depth", false); set("stencil", true); set("antialias", false);
    set("premultipliedAlpha", true); set("preserveDrawingBuffer", false);
    RET(attributes);
  });
  FN(getParameter, {
    GLenum name = U(0);
    switch (name) {
      case GL_VERSION: RET(Str(ISO, "WebGL 1.0")); break;
      case GL_SHADING_LANGUAGE_VERSION: RET(Str(ISO, "WebGL GLSL ES 1.0")); break;
      case GL_VENDOR:
      case GL_RENDERER: {
        const GLubyte* text = glGetString(name);
        RET(Str(ISO, text ? reinterpret_cast<const char*>(text) : ""));
        break;
      }
      case GL_VIEWPORT:
      case GL_SCISSOR_BOX: {
        GLint box[4] = {0, 0, 0, 0};
        glGetIntegerv(name, box);
        v8::Local<v8::Array> array = v8::Array::New(ISO, 4);
        for (uint32_t i = 0; i < 4; i++) array->Set(CTX, i, v8::Integer::New(ISO, box[i])).Check();
        RET(array);
        break;
      }
      default: {
        GLint value = 0;
        glGetIntegerv(name, &value);
        RET(value);
      }
    }
  });
  FN(getShaderPrecisionFormat, {
    GLint range[2] = {0, 0};
    GLint precision = 0;
    glGetShaderPrecisionFormat(U(0), U(1), range, &precision);
    v8::Local<v8::Object> format = v8::Object::New(ISO);
    format->Set(CTX, Str(ISO, "rangeMin"), v8::Integer::New(ISO, range[0])).Check();
    format->Set(CTX, Str(ISO, "rangeMax"), v8::Integer::New(ISO, range[1])).Check();
    format->Set(CTX, Str(ISO, "precision"), v8::Integer::New(ISO, precision)).Check();
    RET(format);
  });

  // --- Buffers -------------------------------------------------------------
  FN(createBuffer, { GLuint id = 0; glGenBuffers(1, &id); RET(Wrap(ISO, id)); });
  FN(deleteBuffer, { GLuint id = N(0); glDeleteBuffers(1, &id); });
  FN(bindBuffer, glBindBuffer(U(0), N(1)));
  FN(bufferData, {
    if (args[1]->IsNumber()) {
      glBufferData(U(0), static_cast<GLsizeiptr>(args[1]->NumberValue(CTX).FromMaybe(0)), nullptr, U(2));
    } else {
      Bytes bytes = BytesOf(args[1]);
      glBufferData(U(0), static_cast<GLsizeiptr>(bytes.size), bytes.data, U(2));
    }
  });
  FN(bufferSubData, {
    Bytes bytes = BytesOf(args[2]);
    glBufferSubData(U(0), static_cast<GLintptr>(I(1)), static_cast<GLsizeiptr>(bytes.size), bytes.data);
  });

  // --- Textures ------------------------------------------------------------
  FN(createTexture, { GLuint id = 0; glGenTextures(1, &id); RET(Wrap(ISO, id)); });
  FN(deleteTexture, { GLuint id = N(0); glDeleteTextures(1, &id); g_state.texture_bytes.erase(id); });
  // Not part of WebGL: pixel memory held by textures, in bytes.
  FN(textureBytes, {
    long long total = 0;
    for (const auto& entry : g_state.texture_bytes) total += entry.second;
    RET(static_cast<double>(total));
  });
  FN(bindTexture, glBindTexture(U(0), N(1)));
  FN(activeTexture, glActiveTexture(U(0)));
  FN(texParameteri, glTexParameteri(U(0), U(1), I(2)));
  FN(texParameterf, glTexParameterf(U(0), U(1), F(2)));
  FN(generateMipmap, glGenerateMipmap(U(0)));
  FN(texImage2D, {
    // Short form: texImage2D(target, level, internalformat, format, type,
    // source), where the source is a canvas or an image.
    if (args.Length() < 9) {
      std::vector<uint8_t>& pixels = UploadBuffer();
      int width = 0, height = 0;
      if (args.Length() >= 6 && SurfacePixelsForUpload(ISO, args[5], g_state.premultiply,
                                                        g_state.flip_y, &pixels, &width, &height)) {
        glTexImage2D(U(0), I(1), I(2), width, height, 0, U(3), U(4), pixels.data());
        NoteTextureSize(I(1), width, height);
      }
      return;
    }
    GLenum format = U(6), type = U(7);
    int width = I(3), height = I(4);
    Bytes bytes = BytesOf(args[8]);
    if (bytes.data && format == GL_RGBA && type == GL_UNSIGNED_BYTE &&
        (g_state.flip_y || g_state.premultiply) &&
        bytes.size >= static_cast<size_t>(width) * static_cast<size_t>(height) * 4) {
      std::vector<uint8_t> pixels = PreparePixels(bytes.data, width, height);
      glTexImage2D(U(0), I(1), I(2), width, height, I(5), format, type, pixels.data());
    } else {
      glTexImage2D(U(0), I(1), I(2), width, height, I(5), format, type, bytes.data);
    }
    NoteTextureSize(I(1), width, height);
  });
  FN(texSubImage2D, {
    // Short form: texSubImage2D(target, level, x, y, format, type, source).
    if (args.Length() < 9) {
      std::vector<uint8_t>& pixels = UploadBuffer();
      int width = 0, height = 0;
      if (args.Length() >= 7 && SurfacePixelsForUpload(ISO, args[6], g_state.premultiply,
                                                        g_state.flip_y, &pixels, &width, &height)) {
        glTexSubImage2D(U(0), I(1), I(2), I(3), width, height, U(4), U(5), pixels.data());
      }
      return;
    }
    GLenum format = U(6), type = U(7);
    int width = I(4), height = I(5);
    Bytes bytes = BytesOf(args[8]);
    if (!bytes.data) return;
    if (format == GL_RGBA && type == GL_UNSIGNED_BYTE && (g_state.flip_y || g_state.premultiply) &&
        bytes.size >= static_cast<size_t>(width) * static_cast<size_t>(height) * 4) {
      std::vector<uint8_t> pixels = PreparePixels(bytes.data, width, height);
      glTexSubImage2D(U(0), I(1), I(2), I(3), width, height, format, type, pixels.data());
    } else {
      glTexSubImage2D(U(0), I(1), I(2), I(3), width, height, format, type, bytes.data);
    }
  });

  // --- Framebuffers and renderbuffers --------------------------------------
  FN(createFramebuffer, { GLuint id = 0; glGenFramebuffers(1, &id); RET(Wrap(ISO, id)); });
  FN(deleteFramebuffer, { GLuint id = N(0); glDeleteFramebuffers(1, &id); });
  FN(bindFramebuffer, {
    GLuint name = N(1);
    glBindFramebuffer(U(0), name ? name : g_state.buffer_framebuffer);
  });
  // Not part of WebGL: setOverlay(canvas, x, y) shows a canvas over the game
  // at that position of the screen, in screen pixels from the top left;
  // setOverlay(null) removes it. The canvas is copied when this is called.
  FN(setOverlay, {
    g_state.overlay_pixels.clear();
    g_state.overlay_width = g_state.overlay_height = 0;
    if (args.Length() > 0 && !args[0]->IsNullOrUndefined()) {
      SurfacePixelsForUpload(ISO, args[0], true, false, &g_state.overlay_pixels, &g_state.overlay_width,
                             &g_state.overlay_height);
      g_state.overlay_x = I(1);
      g_state.overlay_y = I(2);
    }
    g_state.overlay_changed = true;
  });
  // Not part of WebGL: gives the game a drawing buffer of its own size.
  FN(setDrawingBufferSize, SetDrawingBufferSize(I(0), I(1)));
  FN(framebufferTexture2D, glFramebufferTexture2D(U(0), U(1), U(2), N(3), I(4)));
  FN(checkFramebufferStatus, RET(static_cast<uint32_t>(glCheckFramebufferStatus(U(0)))));
  FN(createRenderbuffer, { GLuint id = 0; glGenRenderbuffers(1, &id); RET(Wrap(ISO, id)); });
  FN(deleteRenderbuffer, { GLuint id = N(0); glDeleteRenderbuffers(1, &id); });
  FN(bindRenderbuffer, glBindRenderbuffer(U(0), N(1)));
  FN(renderbufferStorage, {
    // WebGL's combined depth-stencil format is the packed 24/8 format here.
    GLenum format = U(1);
    if (format == 0x84F9) format = 0x88F0;  // DEPTH_STENCIL -> DEPTH24_STENCIL8_OES
    glRenderbufferStorage(U(0), format, I(2), I(3));
  });
  FN(framebufferRenderbuffer, {
    GLenum attachment = U(1);
    GLuint renderbuffer = N(3);
    if (attachment == 0x821A) {  // DEPTH_STENCIL_ATTACHMENT: attach to both
      glFramebufferRenderbuffer(U(0), GL_DEPTH_ATTACHMENT, U(2), renderbuffer);
      glFramebufferRenderbuffer(U(0), GL_STENCIL_ATTACHMENT, U(2), renderbuffer);
    } else {
      glFramebufferRenderbuffer(U(0), attachment, U(2), renderbuffer);
    }
  });
  FN(readPixels, {
    Bytes bytes = BytesOf(args[6]);
    if (bytes.data) glReadPixels(I(0), I(1), I(2), I(3), U(4), U(5), bytes.data);
  });

  // --- Shaders and programs ------------------------------------------------
  FN(createShader, RET(Wrap(ISO, glCreateShader(U(0)))));
  FN(deleteShader, glDeleteShader(N(0)));
  FN(shaderSource, {
    std::string source = RewritePrecision(ToStd(ISO, args[1]));
    const char* text = source.c_str();
    glShaderSource(N(0), 1, &text, nullptr);
  });
  FN(compileShader, glCompileShader(N(0)));
  FN(getShaderParameter, {
    GLenum name = U(1);
    GLint value = 0;
    glGetShaderiv(N(0), name, &value);
    if (name == GL_SHADER_TYPE) RET(value); else RET(value != 0);
  });
  FN(getShaderInfoLog, {
    char log[2048] = "";
    glGetShaderInfoLog(N(0), sizeof log, nullptr, log);
    RET(Str(ISO, log));
  });
  FN(createProgram, RET(Wrap(ISO, glCreateProgram())));
  FN(deleteProgram, glDeleteProgram(N(0)));
  FN(attachShader, glAttachShader(N(0), N(1)));
  FN(bindAttribLocation, glBindAttribLocation(N(0), U(1), ToStd(ISO, args[2]).c_str()));
  FN(linkProgram, glLinkProgram(N(0)));
  FN(useProgram, glUseProgram(N(0)));
  FN(getProgramParameter, {
    GLenum name = U(1);
    GLint value = 0;
    glGetProgramiv(N(0), name, &value);
    if (name == GL_ACTIVE_ATTRIBUTES || name == GL_ACTIVE_UNIFORMS || name == GL_ATTACHED_SHADERS)
      RET(value);
    else
      RET(value != 0);
  });
  FN(getProgramInfoLog, {
    char log[2048] = "";
    glGetProgramInfoLog(N(0), sizeof log, nullptr, log);
    RET(Str(ISO, log));
  });
  FN(getAttribLocation, RET(glGetAttribLocation(N(0), ToStd(ISO, args[1]).c_str())));
  FN(getUniformLocation, {
    GLint location = glGetUniformLocation(N(0), ToStd(ISO, args[1]).c_str());
    if (location < 0) RET(v8::Null(ISO)); else RET(Wrap(ISO, static_cast<GLuint>(location)));
  });
  auto active_info = [](const Args& args, bool attribute) {
    char name[256] = "";
    GLint size = 0;
    GLenum type = 0;
    if (attribute) glGetActiveAttrib(N(0), U(1), sizeof name, nullptr, &size, &type, name);
    else glGetActiveUniform(N(0), U(1), sizeof name, nullptr, &size, &type, name);
    v8::Local<v8::Object> info = v8::Object::New(ISO);
    info->Set(CTX, Str(ISO, "name"), Str(ISO, name)).Check();
    info->Set(CTX, Str(ISO, "size"), v8::Integer::New(ISO, size)).Check();
    info->Set(CTX, Str(ISO, "type"), v8::Integer::NewFromUnsigned(ISO, type)).Check();
    RET(info);
  };
  static auto active = active_info;
  FN(getActiveAttrib, active(args, true));
  FN(getActiveUniform, active(args, false));

  // --- Uniforms and attributes ---------------------------------------------
  // A uniform location is wrapped like other objects; a null location (the
  // uniform was optimised away) must be ignored, as WebGL does.
#define LOC(i) (args[i]->IsObject() ? static_cast<GLint>(N(i)) : -1)
  FN(uniform1i, glUniform1i(LOC(0), I(1)));
  FN(uniform1f, glUniform1f(LOC(0), F(1)));
  FN(uniform2f, glUniform2f(LOC(0), F(1), F(2)));
  FN(uniform3f, glUniform3f(LOC(0), F(1), F(2), F(3)));
  FN(uniform4f, glUniform4f(LOC(0), F(1), F(2), F(3), F(4)));
  FN(uniform1iv, { auto v = Ints(ISO, args[1]); glUniform1iv(LOC(0), static_cast<GLsizei>(v.size()), v.data()); });
  FN(uniform1fv, { auto v = Floats(ISO, args[1]); glUniform1fv(LOC(0), static_cast<GLsizei>(v.size()), v.data()); });
  FN(uniform2fv, { auto v = Floats(ISO, args[1]); glUniform2fv(LOC(0), static_cast<GLsizei>(v.size() / 2), v.data()); });
  FN(uniform3fv, { auto v = Floats(ISO, args[1]); glUniform3fv(LOC(0), static_cast<GLsizei>(v.size() / 3), v.data()); });
  FN(uniform4fv, { auto v = Floats(ISO, args[1]); glUniform4fv(LOC(0), static_cast<GLsizei>(v.size() / 4), v.data()); });
  FN(uniformMatrix2fv, { auto v = Floats(ISO, args[2]); glUniformMatrix2fv(LOC(0), static_cast<GLsizei>(v.size() / 4), GL_FALSE, v.data()); });
  FN(uniformMatrix3fv, { auto v = Floats(ISO, args[2]); glUniformMatrix3fv(LOC(0), static_cast<GLsizei>(v.size() / 9), GL_FALSE, v.data()); });
  FN(uniformMatrix4fv, { auto v = Floats(ISO, args[2]); glUniformMatrix4fv(LOC(0), static_cast<GLsizei>(v.size() / 16), GL_FALSE, v.data()); });
#undef LOC
  FN(enableVertexAttribArray, glEnableVertexAttribArray(U(0)));
  FN(disableVertexAttribArray, glDisableVertexAttribArray(U(0)));
  FN(vertexAttribPointer, glVertexAttribPointer(U(0), I(1), U(2), B(3), I(4),
                                                reinterpret_cast<const void*>(static_cast<intptr_t>(I(5)))));

  // --- Drawing ---------------------------------------------------------------
  FN(drawArrays, glDrawArrays(U(0), I(1), I(2)));
  FN(drawElements, glDrawElements(U(0), I(1), U(2), reinterpret_cast<const void*>(static_cast<intptr_t>(I(3)))));
}

#undef FN
#undef RET
#undef N
#undef B
#undef F
#undef U
#undef I
#undef CTX
#undef ISO

}  // namespace

v8::Local<v8::Object> CreateWebGLContext(v8::Isolate* isolate, v8::Local<v8::Context> context,
                                         int drawing_width, int drawing_height) {
  v8::EscapableHandleScope scope(isolate);
  if (g_state.name_key.IsEmpty()) {
    g_state.name_key.Reset(isolate, v8::Private::New(isolate, Str(isolate, "glName")));
  }
  v8::Local<v8::Object> gl = v8::Object::New(isolate);
  for (const Constant& constant : kConstants) {
    gl->Set(context, Str(isolate, constant.name), v8::Integer::NewFromUnsigned(isolate, constant.value))
        .Check();
  }
  gl->Set(context, Str(isolate, "drawingBufferWidth"), v8::Integer::New(isolate, drawing_width)).Check();
  gl->Set(context, Str(isolate, "drawingBufferHeight"), v8::Integer::New(isolate, drawing_height)).Check();
  InstallFunctions(isolate, gl);
  return scope.Escape(gl);
}

bool HasDrawingBuffer() { return g_state.buffer_framebuffer != 0; }

void PresentDrawingBuffer(int screen_width, int screen_height, const std::vector<ScreenCircle>& circles,
                          const ScreenVideo* video) {
  // Without a drawing buffer the scripts drew straight to the screen (the
  // game list does); only the touch controls are then added on top.
  bool has_buffer = g_state.buffer_framebuffer != 0;
  if (!has_buffer && circles.empty()) return;

  // Remember every piece of OpenGL state touched below. PIXI keeps its own
  // record of the state it set, so it must find things exactly as it left them.
  GLint program = 0, active_texture = 0, texture0 = 0, array_buffer = 0, framebuffer = 0;
  GLint viewport[4] = {0, 0, 0, 0};
  GLfloat clear_colour[4] = {0, 0, 0, 0};
  GLboolean colour_mask[4] = {GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE};
  glGetIntegerv(GL_CURRENT_PROGRAM, &program);
  glGetIntegerv(GL_ACTIVE_TEXTURE, &active_texture);
  glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &array_buffer);
  glGetIntegerv(GL_FRAMEBUFFER_BINDING, &framebuffer);
  glGetIntegerv(GL_VIEWPORT, viewport);
  glGetFloatv(GL_COLOR_CLEAR_VALUE, clear_colour);
  glGetBooleanv(GL_COLOR_WRITEMASK, colour_mask);
  const GLenum switches[] = {GL_BLEND, GL_SCISSOR_TEST, GL_STENCIL_TEST, GL_DEPTH_TEST, GL_CULL_FACE};
  GLboolean was_enabled[5];
  for (int i = 0; i < 5; i++) was_enabled[i] = glIsEnabled(switches[i]);
  GLint blend_function[4] = {GL_ONE, GL_ZERO, GL_ONE, GL_ZERO};  // source and destination, colour then alpha
  glGetIntegerv(GL_BLEND_SRC_RGB, &blend_function[0]);
  glGetIntegerv(GL_BLEND_DST_RGB, &blend_function[1]);
  glGetIntegerv(GL_BLEND_SRC_ALPHA, &blend_function[2]);
  glGetIntegerv(GL_BLEND_DST_ALPHA, &blend_function[3]);
  struct Attribute {
    GLint enabled, size, type, normalized, stride, buffer;
    void* pointer;
  } attributes[2];
  for (GLuint i = 0; i < 2; i++) {
    glGetVertexAttribiv(i, GL_VERTEX_ATTRIB_ARRAY_ENABLED, &attributes[i].enabled);
    glGetVertexAttribiv(i, GL_VERTEX_ATTRIB_ARRAY_SIZE, &attributes[i].size);
    glGetVertexAttribiv(i, GL_VERTEX_ATTRIB_ARRAY_TYPE, &attributes[i].type);
    glGetVertexAttribiv(i, GL_VERTEX_ATTRIB_ARRAY_NORMALIZED, &attributes[i].normalized);
    glGetVertexAttribiv(i, GL_VERTEX_ATTRIB_ARRAY_STRIDE, &attributes[i].stride);
    glGetVertexAttribiv(i, GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING, &attributes[i].buffer);
    glGetVertexAttribPointerv(i, GL_VERTEX_ATTRIB_ARRAY_POINTER, &attributes[i].pointer);
  }
  glActiveTexture(GL_TEXTURE0);
  glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture0);

  if (!g_state.present_program) {
    g_state.present_program = glCreateProgram();
    glAttachShader(g_state.present_program, CompileInternal(GL_VERTEX_SHADER,
        "attribute vec2 p; attribute vec2 t; varying vec2 v;"
        "void main(){ v = t; gl_Position = vec4(p, 0.0, 1.0); }"));
    glAttachShader(g_state.present_program, CompileInternal(GL_FRAGMENT_SHADER,
        "precision highp float; varying vec2 v; uniform sampler2D s;"
        "void main(){ gl_FragColor = vec4(texture2D(s, v).rgb, 1.0); }"));
    glBindAttribLocation(g_state.present_program, 0, "p");
    glBindAttribLocation(g_state.present_program, 1, "t");
    glLinkProgram(g_state.present_program);
  }

  if (has_buffer) {
    // Fit the game's picture inside the screen, keeping its proportions.
    // A video frame takes the game's place; its first row is its top.
    int picture_width = video ? video->width : g_state.buffer_width;
    int picture_height = video ? video->height : g_state.buffer_height;
    float scale_x = static_cast<float>(screen_width) / static_cast<float>(picture_width);
    float scale_y = static_cast<float>(screen_height) / static_cast<float>(picture_height);
    float scale = scale_x < scale_y ? scale_x : scale_y;
    float x = static_cast<float>(picture_width) * scale / static_cast<float>(screen_width);
    float y = static_cast<float>(picture_height) * scale / static_cast<float>(screen_height);
    float bottom_row = video ? 1.0f : 0.0f, top_row = video ? 0.0f : 1.0f;
    const GLfloat quad[16] = {-x, -y, 0, bottom_row, x, -y, 1, bottom_row, -x, y, 0, top_row, x, y, 1, top_row};

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, screen_width, screen_height);
    for (GLenum name : switches) glDisable(name);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);
    glUseProgram(g_state.present_program);
    if (video) {
      bool fresh = !g_state.video_texture;
      if (fresh) glGenTextures(1, &g_state.video_texture);
      glBindTexture(GL_TEXTURE_2D, g_state.video_texture);
      if (fresh) {
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      }
      if (fresh || video->width != g_state.video_width || video->height != g_state.video_height) {
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, video->width, video->height, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                     video->pixels);
        g_state.video_width = video->width;
        g_state.video_height = video->height;
      } else if (video->changed) {
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, video->width, video->height, GL_RGBA, GL_UNSIGNED_BYTE,
                        video->pixels);
      }
    } else {
      glBindTexture(GL_TEXTURE_2D, g_state.buffer_texture);
    }
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glEnableVertexAttribArray(0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), quad);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), quad + 2);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    // The overlay, if any, in screen pixels over the scaled picture.
    if (!g_state.overlay_pixels.empty() && g_state.overlay_width > 0 && g_state.overlay_height > 0) {
      if (!g_state.overlay_texture) {
        glGenTextures(1, &g_state.overlay_texture);
        glBindTexture(GL_TEXTURE_2D, g_state.overlay_texture);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      }
      glBindTexture(GL_TEXTURE_2D, g_state.overlay_texture);
      if (g_state.overlay_changed) {
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, g_state.overlay_width, g_state.overlay_height, 0, GL_RGBA,
                     GL_UNSIGNED_BYTE, g_state.overlay_pixels.data());
        g_state.overlay_changed = false;
      }
      float left = -1.0f + 2.0f * static_cast<float>(g_state.overlay_x) / static_cast<float>(screen_width);
      float right = left + 2.0f * static_cast<float>(g_state.overlay_width) / static_cast<float>(screen_width);
      float top = 1.0f - 2.0f * static_cast<float>(g_state.overlay_y) / static_cast<float>(screen_height);
      float bottom = top - 2.0f * static_cast<float>(g_state.overlay_height) / static_cast<float>(screen_height);
      // The first row of the pixels is the top of the picture.
      const GLfloat box[16] = {left, bottom, 0, 1, right, bottom, 1, 1, left, top, 0, 0, right, top, 1, 0};
      glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), box);
      glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), box + 2);
      glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    }
  } else {
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, screen_width, screen_height);
    for (GLenum name : switches) glDisable(name);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glEnableVertexAttribArray(0);
    glEnableVertexAttribArray(1);
  }

  // The touch controls: each a square whose shader paints a ring with a
  // fainter inside, blended over the picture.
  if (!circles.empty()) {
    if (!g_state.ring_program) {
      g_state.ring_program = glCreateProgram();
      glAttachShader(g_state.ring_program, CompileInternal(GL_VERTEX_SHADER,
          "attribute vec2 p; attribute vec2 t; varying vec2 v;"
          "void main(){ v = t; gl_Position = vec4(p, 0.0, 1.0); }"));
      glAttachShader(g_state.ring_program, CompileInternal(GL_FRAGMENT_SHADER,
          "precision mediump float; varying vec2 v;"
          "void main(){ float d = length(v);"
          "  float a = d > 1.0 ? 0.0 : (d > 0.88 ? 0.5 : 0.13);"
          "  gl_FragColor = vec4(1.0, 1.0, 1.0, a); }"));
      glBindAttribLocation(g_state.ring_program, 0, "p");
      glBindAttribLocation(g_state.ring_program, 1, "t");
      glLinkProgram(g_state.ring_program);
    }
    glUseProgram(g_state.ring_program);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    for (const ScreenCircle& circle : circles) {
      float cx = -1.0f + 2.0f * circle.x / static_cast<float>(screen_width);
      float cy = 1.0f - 2.0f * circle.y / static_cast<float>(screen_height);
      float rx = 2.0f * circle.radius / static_cast<float>(screen_width);
      float ry = 2.0f * circle.radius / static_cast<float>(screen_height);
      const GLfloat box[16] = {cx - rx, cy - ry, -1, -1, cx + rx, cy - ry, 1, -1,
                               cx - rx, cy + ry, -1, 1,  cx + rx, cy + ry, 1, 1};
      glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), box);
      glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), box + 2);
      glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    }
    glBlendFuncSeparate(static_cast<GLenum>(blend_function[0]), static_cast<GLenum>(blend_function[1]),
                        static_cast<GLenum>(blend_function[2]), static_cast<GLenum>(blend_function[3]));
  }

  // Put everything back.
  for (GLuint i = 0; i < 2; i++) {
    glBindBuffer(GL_ARRAY_BUFFER, static_cast<GLuint>(attributes[i].buffer));
    glVertexAttribPointer(i, attributes[i].size, static_cast<GLenum>(attributes[i].type),
                          static_cast<GLboolean>(attributes[i].normalized), attributes[i].stride,
                          attributes[i].pointer);
    if (attributes[i].enabled) glEnableVertexAttribArray(i); else glDisableVertexAttribArray(i);
  }
  glBindBuffer(GL_ARRAY_BUFFER, static_cast<GLuint>(array_buffer));
  glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(texture0));
  glActiveTexture(static_cast<GLenum>(active_texture));
  glUseProgram(static_cast<GLuint>(program));
  for (int i = 0; i < 5; i++) {
    if (was_enabled[i]) glEnable(switches[i]); else glDisable(switches[i]);
  }
  glColorMask(colour_mask[0], colour_mask[1], colour_mask[2], colour_mask[3]);
  glClearColor(clear_colour[0], clear_colour[1], clear_colour[2], clear_colour[3]);
  glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  glBindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(framebuffer));
}

// The OpenGL objects named in the state belong to a screen that is closed
// after this; a later run in the same process starts from nothing.
void ReleaseWebGLBinding() {
  g_state.name_key.Reset();
  g_state = State();
}

long TakeWebGLCallCount() {
  long count = g_state.calls;
  g_state.calls = 0;
  return count;
}

}  // namespace mvp
