#include "bindings/webgl_binding.h"

#include "bindings/gl_limits.h"
#include "bindings/control_font.h"

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
  GLuint box_program = 0;   // fills the rectangles of the player's menu
  GLuint text_program = 0;  // writes the names on them
  GLuint font_texture = 0;  // every glyph of the built-in font, side by side
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

// Whether a script's bytes are enough for an image of this size, format
// and type, with rows aligned as the driver's setting `alignment_name`
// (GL_UNPACK_ALIGNMENT or GL_PACK_ALIGNMENT) says now.
bool HoldsImage(const Bytes& bytes, int width, int height, GLenum format, GLenum type, GLenum alignment_name) {
  GLint alignment = 4;
  glGetIntegerv(alignment_name, &alignment);
  size_t needed = 0;
  return PixelBytes(width, height, format, type, alignment, &needed) && bytes.size >= needed;
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
      default: {
        // The driver writes as many values as the name has; only names
        // whose number of values is known are asked for (gl_limits.h).
        // Anything else gives null, as WebGL does for an unknown name.
        GlParameterShape shape = ShapeOfGlParameter(name);
        GLint ints[4] = {0, 0, 0, 0};
        GLfloat floats[4] = {0, 0, 0, 0};
        GLboolean bools[4] = {GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE};
        if (shape.kind == GlValueKind::kInt) glGetIntegerv(name, ints);
        else if (shape.kind == GlValueKind::kFloat) glGetFloatv(name, floats);
        else if (shape.kind == GlValueKind::kBool) glGetBooleanv(name, bools);
        else { RET(v8::Null(ISO)); break; }
        auto value = [&](int i) -> v8::Local<v8::Value> {
          if (shape.kind == GlValueKind::kInt) return v8::Integer::New(ISO, ints[i]);
          if (shape.kind == GlValueKind::kFloat) return v8::Number::New(ISO, floats[i]);
          return v8::Boolean::New(ISO, bools[i] != GL_FALSE);
        };
        if (shape.count == 1) { RET(value(0)); break; }
        v8::Local<v8::Array> array = v8::Array::New(ISO, shape.count);
        for (int i = 0; i < shape.count; i++) array->Set(CTX, static_cast<uint32_t>(i), value(i)).Check();
        RET(array);
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
    // Without pixels the texture is only given its size. With pixels, the
    // driver reads as many as the size says: there must be that many.
    if (bytes.data && !HoldsImage(bytes, width, height, format, type, GL_UNPACK_ALIGNMENT)) return;
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
    if (!bytes.data || !HoldsImage(bytes, width, height, format, type, GL_UNPACK_ALIGNMENT)) return;
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
    // The driver writes width x height pixels: there must be room for them.
    Bytes bytes = BytesOf(args[6]);
    if (bytes.data && HoldsImage(bytes, I(2), I(3), U(4), U(5), GL_PACK_ALIGNMENT)) {
      glReadPixels(I(0), I(1), I(2), I(3), U(4), U(5), bytes.data);
    }
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
  FN(uniform2i, glUniform2i(LOC(0), I(1), I(2)));
  FN(uniform3i, glUniform3i(LOC(0), I(1), I(2), I(3)));
  FN(uniform4i, glUniform4i(LOC(0), I(1), I(2), I(3), I(4)));
  FN(uniform2iv, { auto v = Ints(ISO, args[1]); glUniform2iv(LOC(0), static_cast<GLsizei>(v.size() / 2), v.data()); });
  FN(uniform3iv, { auto v = Ints(ISO, args[1]); glUniform3iv(LOC(0), static_cast<GLsizei>(v.size() / 3), v.data()); });
  FN(uniform4iv, { auto v = Ints(ISO, args[1]); glUniform4iv(LOC(0), static_cast<GLsizei>(v.size() / 4), v.data()); });
#undef LOC
  FN(enableVertexAttribArray, glEnableVertexAttribArray(U(0)));
  FN(disableVertexAttribArray, glDisableVertexAttribArray(U(0)));
  FN(vertexAttribPointer, glVertexAttribPointer(U(0), I(1), U(2), B(3), I(4),
                                                reinterpret_cast<const void*>(static_cast<intptr_t>(I(5)))));

  FN(vertexAttrib1f, glVertexAttrib1f(U(0), F(1)));
  FN(vertexAttrib2f, glVertexAttrib2f(U(0), F(1), F(2)));
  FN(vertexAttrib3f, glVertexAttrib3f(U(0), F(1), F(2), F(3)));
  FN(vertexAttrib4f, glVertexAttrib4f(U(0), F(1), F(2), F(3), F(4)));
  FN(getVertexAttribOffset, {
    void* offset = nullptr;
    glGetVertexAttribPointerv(U(0), U(1), &offset);
    RET(static_cast<double>(reinterpret_cast<intptr_t>(offset)));
  });

  // --- Asked for less often --------------------------------------------------
  // PIXI does without these. A library compiled to WebAssembly brings a GL
  // layer of its own that uses them: RPG Maker MZ's animation library asks
  // whether a capability is enabled before every draw.
  FN(isEnabled, RET(glIsEnabled(U(0)) == GL_TRUE));
  FN(isBuffer, RET(args[0]->IsObject() && glIsBuffer(N(0)) == GL_TRUE));
  FN(isTexture, RET(args[0]->IsObject() && glIsTexture(N(0)) == GL_TRUE));
  FN(isFramebuffer, RET(args[0]->IsObject() && glIsFramebuffer(N(0)) == GL_TRUE));
  FN(isRenderbuffer, RET(args[0]->IsObject() && glIsRenderbuffer(N(0)) == GL_TRUE));
  FN(isShader, RET(args[0]->IsObject() && glIsShader(N(0)) == GL_TRUE));
  FN(isProgram, RET(args[0]->IsObject() && glIsProgram(N(0)) == GL_TRUE));
  FN(hint, glHint(U(0), U(1)));
  FN(lineWidth, glLineWidth(F(0)));
  FN(polygonOffset, glPolygonOffset(F(0), F(1)));
  FN(depthRange, glDepthRangef(F(0), F(1)));
  FN(sampleCoverage, glSampleCoverage(F(0), B(1)));
  FN(stencilFuncSeparate, glStencilFuncSeparate(U(0), U(1), I(2), U(3)));
  FN(stencilMaskSeparate, glStencilMaskSeparate(U(0), U(1)));
  FN(stencilOpSeparate, glStencilOpSeparate(U(0), U(1), U(2), U(3)));
  FN(validateProgram, glValidateProgram(N(0)));
  FN(detachShader, glDetachShader(N(0), N(1)));
  FN(copyTexImage2D, glCopyTexImage2D(U(0), I(1), U(2), I(3), I(4), I(5), I(6), I(7)));
  FN(copyTexSubImage2D, glCopyTexSubImage2D(U(0), I(1), I(2), I(3), I(4), I(5), I(6), I(7)));
  FN(getTexParameter, { GLint value = 0; glGetTexParameteriv(U(0), U(1), &value); RET(value); });
  FN(getBufferParameter, { GLint value = 0; glGetBufferParameteriv(U(0), U(1), &value); RET(value); });
  FN(getRenderbufferParameter, { GLint value = 0; glGetRenderbufferParameteriv(U(0), U(1), &value); RET(value); });
  FN(getShaderSource, {
    GLint length = 0;
    glGetShaderiv(N(0), GL_SHADER_SOURCE_LENGTH, &length);
    std::string source(static_cast<size_t>(length > 0 ? length : 1), '\0');
    glGetShaderSource(N(0), static_cast<GLsizei>(source.size()), nullptr, &source[0]);
    RET(Str(ISO, source.c_str()));
  });

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

// Fills `boxes`. Expects blending to be set up, and leaves the program
// changed, as the rest of the present pass does.
static void DrawBoxes(int screen_width, int screen_height, const std::vector<ScreenBox>& boxes) {
  if (boxes.empty()) return;
  if (!g_state.box_program) {
    g_state.box_program = glCreateProgram();
    glAttachShader(g_state.box_program, CompileInternal(GL_VERTEX_SHADER,
        "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"));
    glAttachShader(g_state.box_program, CompileInternal(GL_FRAGMENT_SHADER,
        "precision mediump float; uniform vec4 c; void main(){ gl_FragColor = c; }"));
    glBindAttribLocation(g_state.box_program, 0, "p");
    glLinkProgram(g_state.box_program);
  }
  glUseProgram(g_state.box_program);
  GLint colour = glGetUniformLocation(g_state.box_program, "c");
  for (const ScreenBox& box : boxes) {
    // To the screen's own measure: -1 to 1, up positive.
    float left = -1.0f + 2.0f * box.x / screen_width, right = -1.0f + 2.0f * (box.x + box.width) / screen_width;
    float top = 1.0f - 2.0f * box.y / screen_height, bottom = 1.0f - 2.0f * (box.y + box.height) / screen_height;
    const GLfloat corners[8] = {left, bottom, right, bottom, left, top, right, top};
    glUniform4f(colour, box.shade, box.shade, box.shade, box.alpha);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, corners);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  }
}

// Writes `texts` in the built-in font. Expects blending to be set up, and
// leaves texture unit 0 and the program changed, as the rest of the present
// pass does.
static void DrawTexts(int screen_width, int screen_height, const std::vector<ScreenText>& texts) {
  if (texts.empty()) return;
  // Each glyph has a cell one dot wider and higher than itself, so that
  // neighbours never bleed into each other.
  const int cell_width = kFontWidth + 1, cell_height = kFontHeight + 1;
  const int atlas_width = cell_width * kFontGlyphCount;
  if (!g_state.font_texture) {
    std::vector<uint8_t> pixels(static_cast<size_t>(atlas_width) * cell_height * 4, 0);
    for (int glyph = 0; glyph < kFontGlyphCount; glyph++) {
      for (int row = 0; row < kFontHeight; row++) {
        for (int column = 0; column < kFontWidth; column++) {
          if (!(kFontGlyphs[glyph].rows[row] & (0x10 >> column))) continue;
          size_t at = (static_cast<size_t>(row) * atlas_width + glyph * cell_width + column) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = pixels[at + 3] = 255;
        }
      }
    }
    glGenTextures(1, &g_state.font_texture);
    glBindTexture(GL_TEXTURE_2D, g_state.font_texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    // The scripts may have left their own settings for texture uploads.
    GLint alignment = 4;
    glGetIntegerv(GL_UNPACK_ALIGNMENT, &alignment);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, atlas_width, cell_height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
    glPixelStorei(GL_UNPACK_ALIGNMENT, alignment);
  }
  if (!g_state.text_program) {
    g_state.text_program = glCreateProgram();
    glAttachShader(g_state.text_program, CompileInternal(GL_VERTEX_SHADER,
        "attribute vec2 p; attribute vec2 t; varying vec2 v;"
        "void main(){ v = t; gl_Position = vec4(p, 0.0, 1.0); }"));
    glAttachShader(g_state.text_program, CompileInternal(GL_FRAGMENT_SHADER,
        "precision mediump float; varying vec2 v; uniform sampler2D s;"
        "void main(){ gl_FragColor = vec4(1.0, 1.0, 1.0, texture2D(s, v).a * 0.9); }"));
    glBindAttribLocation(g_state.text_program, 0, "p");
    glBindAttribLocation(g_state.text_program, 1, "t");
    glLinkProgram(g_state.text_program);
  }

  // Two triangles per letter, all in one draw.
  std::vector<GLfloat> corners;
  for (const ScreenText& text : texts) {
    float dot = text.height / kFontHeight;
    float left = text.x - (static_cast<float>(text.text.size()) * cell_width - 1) * dot / 2;
    float top = text.y - text.height / 2;
    for (size_t i = 0; i < text.text.size(); i++) {
      int glyph = -1;
      for (int g = 0; g < kFontGlyphCount; g++) {
        if (kFontGlyphs[g].character == text.text[i]) glyph = g;
      }
      if (glyph < 0) continue;
      float x0 = left + static_cast<float>(i) * cell_width * dot, x1 = x0 + kFontWidth * dot;
      float y0 = top, y1 = top + text.height;
      float u0 = static_cast<float>(glyph * cell_width) / atlas_width;
      float u1 = static_cast<float>(glyph * cell_width + kFontWidth) / atlas_width;
      float v1 = static_cast<float>(kFontHeight) / cell_height;
      // To the screen's own measure: -1 to 1, up positive.
      float a = -1.0f + 2.0f * x0 / screen_width, b = -1.0f + 2.0f * x1 / screen_width;
      float c = 1.0f - 2.0f * y0 / screen_height, d = 1.0f - 2.0f * y1 / screen_height;
      const GLfloat letter[24] = {a, c, u0, 0, b, c, u1, 0, a, d, u0, v1, b, c, u1, 0, b, d, u1, v1, a, d, u0, v1};
      corners.insert(corners.end(), letter, letter + 24);
    }
  }
  if (corners.empty()) return;
  glUseProgram(g_state.text_program);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, g_state.font_texture);
  glUniform1i(glGetUniformLocation(g_state.text_program, "s"), 0);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), corners.data());
  glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), corners.data() + 2);
  glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(corners.size() / 4));
}

bool HasDrawingBuffer() { return g_state.buffer_framebuffer != 0; }

void PresentDrawingBuffer(int screen_width, int screen_height, const std::vector<ScreenCircle>& circles,
                          const std::vector<ScreenBox>& boxes, const std::vector<ScreenText>& texts, const ScreenVideo* video) {
  // Without a drawing buffer the scripts drew straight to the screen (the
  // game list does); only the touch controls are then added on top.
  bool has_buffer = g_state.buffer_framebuffer != 0;
  bool has_extras = !circles.empty() || !boxes.empty() || !texts.empty();
  if (!has_buffer && !has_extras) return;

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

  // The touch controls: each a square whose shader paints the control's
  // shape from the position inside the square (-1 to 1, up positive),
  // blended over the picture.
  if (has_extras) {
    if (!g_state.ring_program) {
      g_state.ring_program = glCreateProgram();
      glAttachShader(g_state.ring_program, CompileInternal(GL_VERTEX_SHADER,
          "attribute vec2 p; attribute vec2 t; varying vec2 v;"
          "void main(){ v = t; gl_Position = vec4(p, 0.0, 1.0); }"));
      glAttachShader(g_state.ring_program, CompileInternal(GL_FRAGMENT_SHADER,
          "precision mediump float; varying vec2 v; uniform float symbol; uniform vec4 lit;"
          // Distance from p to the stroke from a to b.
          "float stroke(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a;"
          "  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }"
          "void main(){ float a = 0.0;"
          "  if (symbol < 0.5) {"
          // A cross: two bars. d is below zero inside it.
          "    vec2 q = abs(v); float arm = 0.36;"
          "    float d = min(max(q.x - 1.0, q.y - arm), max(q.y - 1.0, q.x - arm));"
          "    float held = v.x < -arm ? lit.x : v.x > arm ? lit.z : v.y > arm ? lit.y : v.y < -arm ? lit.w : 0.0;"
          "    if (d < 0.0) a = d > -0.05 ? 0.6 : (held > 0.5 ? 0.5 : 0.16);"
          // An arrowhead on each arm, pointing outwards: r.x runs along the arm.
          "    vec2 r = q.x > q.y ? q : q.yx; float t = (0.88 - r.x) / 0.26;"
          "    if (t > 0.0 && t < 1.0 && r.y < 0.22 * t) a = 0.85;"
          "  } else {"
          "    float d = length(v);"
          "    if (d <= 1.0) a = d > 0.88 ? 0.6 : (lit.x > 0.5 ? 0.5 : 0.16);"
          "    float s;"
          // Confirm: a tick. Cancel or menu: a cross. Dash: two chevrons.
          "    if (symbol < 1.5) s = min(stroke(v, vec2(-0.42, 0.02), vec2(-0.12, -0.30)),"
          "                              stroke(v, vec2(-0.12, -0.30), vec2(0.45, 0.36)));"
          "    else if (symbol < 2.5) s = min(stroke(v, vec2(-0.34, -0.34), vec2(0.34, 0.34)),"
          "                                   stroke(v, vec2(-0.34, 0.34), vec2(0.34, -0.34)));"
          "    else if (symbol > 3.5) s = 1.0;"
          "    else s = min(min(stroke(v, vec2(-0.42, 0.34), vec2(-0.08, 0.0)), stroke(v, vec2(-0.08, 0.0), vec2(-0.42, -0.34))),"
          "                 min(stroke(v, vec2(0.04, 0.34), vec2(0.38, 0.0)), stroke(v, vec2(0.38, 0.0), vec2(0.04, -0.34))));"
          "    if (s < 0.09) a = 0.85;"
          "  }"
          "  gl_FragColor = vec4(1.0, 1.0, 1.0, a); }"));
      glBindAttribLocation(g_state.ring_program, 0, "p");
      glBindAttribLocation(g_state.ring_program, 1, "t");
      glLinkProgram(g_state.ring_program);
    }
    glUseProgram(g_state.ring_program);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    GLint symbol_uniform = glGetUniformLocation(g_state.ring_program, "symbol");
    GLint lit_uniform = glGetUniformLocation(g_state.ring_program, "lit");
    for (const ScreenCircle& circle : circles) {
      glUniform1f(symbol_uniform, static_cast<GLfloat>(static_cast<int>(circle.symbol)));
      glUniform4f(lit_uniform, circle.lit & 1 ? 1.0f : 0.0f, circle.lit & 2 ? 1.0f : 0.0f,
                  circle.lit & 4 ? 1.0f : 0.0f, circle.lit & 8 ? 1.0f : 0.0f);
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
    DrawBoxes(screen_width, screen_height, boxes);
    DrawTexts(screen_width, screen_height, texts);
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
