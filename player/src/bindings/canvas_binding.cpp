#include "bindings/canvas_binding.h"

#include "platform/files.h"

#include <cairo-ft.h>
#include <cairo.h>
#include <ft2build.h>
#include FT_FREETYPE_H

#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace mvp {

namespace {

// A block of pixels. Canvases have a drawing context; decoded images do not.
struct Surface {
  cairo_surface_t* surface = nullptr;
  cairo_t* cr = nullptr;
  int width = 0;
  int height = 0;
};

struct State {
  v8::Global<v8::Private> surface_key;   // hidden property: a Surface*
  v8::Global<v8::Private> gradient_key;  // hidden property: a cairo_pattern_t*
  FT_Library freetype = nullptr;
  std::map<std::string, cairo_font_face_t*> fonts;  // family name -> font file face
  long long bytes = 0;
  v8::Isolate* isolate = nullptr;
};
State g_state;

// Pixel memory lives outside the JavaScript heap, so the engine cannot see
// it. It is told how much there is; otherwise it would see only small handle
// objects and not bother collecting them while the pixels behind them pile up.
void AccountBytes(long long delta) {
  g_state.bytes += delta;
  if (g_state.isolate) g_state.isolate->AdjustAmountOfExternalAllocatedMemory(delta);
}

using Args = v8::FunctionCallbackInfo<v8::Value>;

v8::Local<v8::String> Str(v8::Isolate* isolate, const char* text) {
  return v8::String::NewFromUtf8(isolate, text).ToLocalChecked();
}

std::string ToStd(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  v8::String::Utf8Value utf8(isolate, value);
  return *utf8 ? std::string(*utf8, static_cast<size_t>(utf8.length())) : std::string();
}

template <typename T>
T* Hidden(v8::Isolate* isolate, v8::Local<v8::Value> value, const v8::Global<v8::Private>& key) {
  if (!value->IsObject()) return nullptr;
  v8::Local<v8::Value> stored;
  if (!value.As<v8::Object>()
           ->GetPrivate(isolate->GetCurrentContext(), key.Get(isolate))
           .ToLocal(&stored) ||
      !stored->IsExternal()) {
    return nullptr;
  }
  return static_cast<T*>(stored.As<v8::External>()->Value());
}

Surface* SurfaceOf(v8::Isolate* isolate, v8::Local<v8::Value> value) {
  if (Surface* direct = Hidden<Surface>(isolate, value, g_state.surface_key)) return direct;
  // An element object that carries its surface in `__native`.
  if (!value->IsObject()) return nullptr;
  v8::Local<v8::Value> inner;
  if (!value.As<v8::Object>()
           ->Get(isolate->GetCurrentContext(), Str(isolate, "__native"))
           .ToLocal(&inner)) {
    return nullptr;
  }
  return Hidden<Surface>(isolate, inner, g_state.surface_key);
}

void FreeSurface(Surface* s);

// Ties a native object to the JavaScript handle that stands for it: when the
// handle is garbage-collected, the native object is freed. The game never
// frees images or canvases itself, as a page does not have to.
struct Owned {
  v8::Global<v8::Object> handle;
  Surface* surface = nullptr;
  cairo_pattern_t* gradient = nullptr;
};
std::set<Owned*> g_owned;

void FreeOwned(Owned* owned) {
  if (owned->surface) {
    FreeSurface(owned->surface);
    delete owned->surface;
  }
  if (owned->gradient) cairo_pattern_destroy(owned->gradient);
  g_owned.erase(owned);
  delete owned;
}

// The engine's rule for weak handles: the first call may only drop the
// handle; the real work happens in a second call.
void OnHandleCollectedSecondPass(const v8::WeakCallbackInfo<Owned>& info) { FreeOwned(info.GetParameter()); }
void OnHandleCollected(const v8::WeakCallbackInfo<Owned>& info) {
  info.GetParameter()->handle.Reset();
  info.SetSecondPassCallback(OnHandleCollectedSecondPass);
}

v8::Local<v8::Object> WrapOwned(v8::Isolate* isolate, Owned* owned, void* pointer,
                                const v8::Global<v8::Private>& key) {
  v8::Local<v8::Object> object = v8::Object::New(isolate);
  object->SetPrivate(isolate->GetCurrentContext(), key.Get(isolate), v8::External::New(isolate, pointer))
      .Check();
  owned->handle.Reset(isolate, object);
  owned->handle.SetWeak(owned, OnHandleCollected, v8::WeakCallbackType::kParameter);
  g_owned.insert(owned);
  return object;
}
v8::Local<v8::Object> WrapSurface(v8::Isolate* isolate, Surface* surface) {
  Owned* owned = new Owned();
  owned->surface = surface;
  return WrapOwned(isolate, owned, surface, g_state.surface_key);
}
v8::Local<v8::Object> WrapGradient(v8::Isolate* isolate, cairo_pattern_t* gradient) {
  Owned* owned = new Owned();
  owned->gradient = gradient;
  return WrapOwned(isolate, owned, gradient, g_state.gradient_key);
}

Surface* NewCanvas(int width, int height) {
  if (width < 1) width = 1;
  if (height < 1) height = 1;
  Surface* s = new Surface();
  s->surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
  s->cr = cairo_create(s->surface);
  s->width = width;
  s->height = height;
  AccountBytes(static_cast<long long>(width) * height * 4);
  return s;
}

void FreeSurface(Surface* s) {
  if (!s || !s->surface) return;
  AccountBytes(-static_cast<long long>(s->width) * s->height * 4);
  if (s->cr) cairo_destroy(s->cr);
  cairo_surface_destroy(s->surface);
  s->surface = nullptr;
  s->cr = nullptr;
}

cairo_operator_t OperatorOf(const std::string& name) {
  static const std::map<std::string, cairo_operator_t> operators = {
      {"source-over", CAIRO_OPERATOR_OVER},        {"source-in", CAIRO_OPERATOR_IN},
      {"source-out", CAIRO_OPERATOR_OUT},          {"source-atop", CAIRO_OPERATOR_ATOP},
      {"destination-over", CAIRO_OPERATOR_DEST_OVER}, {"destination-in", CAIRO_OPERATOR_DEST_IN},
      {"destination-out", CAIRO_OPERATOR_DEST_OUT}, {"destination-atop", CAIRO_OPERATOR_DEST_ATOP},
      {"lighter", CAIRO_OPERATOR_ADD},             {"copy", CAIRO_OPERATOR_SOURCE},
      {"xor", CAIRO_OPERATOR_XOR},                 {"multiply", CAIRO_OPERATOR_MULTIPLY},
      {"screen", CAIRO_OPERATOR_SCREEN},           {"overlay", CAIRO_OPERATOR_OVERLAY},
      {"darken", CAIRO_OPERATOR_DARKEN},           {"lighten", CAIRO_OPERATOR_LIGHTEN},
      {"difference", CAIRO_OPERATOR_DIFFERENCE},   {"exclusion", CAIRO_OPERATOR_EXCLUSION},
      {"hue", CAIRO_OPERATOR_HSL_HUE},             {"saturation", CAIRO_OPERATOR_HSL_SATURATION},
      {"color", CAIRO_OPERATOR_HSL_COLOR},         {"luminosity", CAIRO_OPERATOR_HSL_LUMINOSITY},
  };
  auto found = operators.find(name);
  return found == operators.end() ? CAIRO_OPERATOR_OVER : found->second;
}

#define ISO args.GetIsolate()
#define CTX ISO->GetCurrentContext()
#define D(i) (args[i]->NumberValue(CTX).FromMaybe(0.0))
#define I(i) (args[i]->Int32Value(CTX).FromMaybe(0))
#define RET(v) args.GetReturnValue().Set(v)
// The canvas a call draws on. Returns from the callback if the first
// argument is not a canvas.
// Puts the path being built aside while something is drawn by itself, and
// brings it back after. In a browser a rectangle (fillRect, clearRect) and
// an image neither use the current path nor change it; cairo draws them
// through the one path it has, so without this a rectangle filled after a
// path filled the path again with the rectangle's paint.
class PathAside {
 public:
  explicit PathAside(cairo_t* cr) : cr_(cr), kept_(cairo_has_current_point(cr) ? cairo_copy_path(cr) : nullptr) {
    cairo_new_path(cr_);
  }
  ~PathAside() {
    cairo_new_path(cr_);
    if (!kept_) return;
    cairo_append_path(cr_, kept_);
    cairo_path_destroy(kept_);
  }
  PathAside(const PathAside&) = delete;
  PathAside& operator=(const PathAside&) = delete;

 private:
  cairo_t* cr_;
  cairo_path_t* kept_;
};

#define CANVAS()                           \
  Surface* s = SurfaceOf(ISO, args[0]);    \
  if (!s || !s->cr) return;                \
  cairo_t* cr = s->cr;                     \
  (void)cr

// Sets the drawing source from a paint argument: a gradient handle, or an
// array of four numbers from 0 to 1 (red, green, blue, alpha).
void SetPaint(v8::Isolate* isolate, cairo_t* cr, v8::Local<v8::Value> paint) {
  if (cairo_pattern_t* gradient = Hidden<cairo_pattern_t>(isolate, paint, g_state.gradient_key)) {
    cairo_set_source(cr, gradient);
    return;
  }
  double rgba[4] = {0, 0, 0, 1};
  if (paint->IsArray()) {
    v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
    v8::Local<v8::Array> array = paint.As<v8::Array>();
    for (uint32_t i = 0; i < 4 && i < array->Length(); i++) {
      v8::Local<v8::Value> item;
      if (array->Get(ctx, i).ToLocal(&item)) rgba[i] = item->NumberValue(ctx).FromMaybe(rgba[i]);
    }
  }
  cairo_set_source_rgba(cr, rgba[0], rgba[1], rgba[2], rgba[3]);
}

void Bind(v8::Isolate* isolate, v8::Local<v8::Object> target, const char* name,
          v8::FunctionCallback callback) {
  v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
  v8::Local<v8::Function> function = v8::Function::New(ctx, callback).ToLocalChecked();
  function->SetName(Str(isolate, name));
  target->Set(ctx, Str(isolate, name), function).Check();
}

#define FN(name, ...) Bind(isolate, canvas, #name, [](const Args& args) { __VA_ARGS__; })

void InstallFunctions(v8::Isolate* isolate, v8::Local<v8::Object> canvas) {
  // --- Surfaces --------------------------------------------------------------
  FN(create, RET(WrapSurface(ISO, NewCanvas(I(0), I(1)))));
  FN(resize, {
    // Changing a canvas's size clears it, as in a browser.
    Surface* s = SurfaceOf(ISO, args[0]);
    if (!s) return;
    Surface* fresh = NewCanvas(I(1), I(2));
    FreeSurface(s);
    *s = *fresh;
    delete fresh;
  });
  FN(destroy, FreeSurface(SurfaceOf(ISO, args[0])));
  FN(size, {
    Surface* s = SurfaceOf(ISO, args[0]);
    v8::Local<v8::Array> size = v8::Array::New(ISO, 2);
    size->Set(CTX, 0, v8::Integer::New(ISO, s ? s->width : 0)).Check();
    size->Set(CTX, 1, v8::Integer::New(ISO, s ? s->height : 0)).Check();
    RET(size);
  });
  // Reads only the size of a PNG file, from its header. Returns [width,
  // height], or null if the file is missing or is not a PNG.
  FN(imageSize, {
    std::string path = mvp::FindFile(ToStd(ISO, args[0]));
    unsigned char header[24];
    FILE* file = std::fopen(path.c_str(), "rb");
    size_t got = file ? std::fread(header, 1, sizeof header, file) : 0;
    if (file) std::fclose(file);
    static const unsigned char kSignature[8] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};
    if (got != sizeof header || std::memcmp(header, kSignature, 8) != 0 ||
        std::memcmp(header + 12, "IHDR", 4) != 0) {
      RET(v8::Null(ISO));
      return;
    }
    auto be32 = [&](int at) {
      return (header[at] << 24) | (header[at + 1] << 16) | (header[at + 2] << 8) | header[at + 3];
    };
    v8::Local<v8::Array> size = v8::Array::New(ISO, 2);
    size->Set(CTX, 0, v8::Integer::New(ISO, be32(16))).Check();
    size->Set(CTX, 1, v8::Integer::New(ISO, be32(20))).Check();
    RET(size);
  });
  // Decodes a PNG file. Returns a surface handle, or null if it cannot be read.
  FN(loadImage, {
    std::string written = ToStd(ISO, args[0]);
    cairo_surface_t* image;
    if (mvp::HasFileHead(written)) {
      // An image whose beginning is disguised on disk is decoded from memory.
      struct Source {
        std::vector<unsigned char> bytes;
        size_t at = 0;
      } source;
      if (!mvp::ReadFileContents(written, &source.bytes)) {
        RET(v8::Null(ISO));
        return;
      }
      image = cairo_image_surface_create_from_png_stream(
          [](void* closure, unsigned char* data, unsigned int length) {
            Source* from = static_cast<Source*>(closure);
            if (from->bytes.size() - from->at < length) return CAIRO_STATUS_READ_ERROR;
            std::memcpy(data, from->bytes.data() + from->at, length);
            from->at += length;
            return CAIRO_STATUS_SUCCESS;
          },
          &source);
    } else {
      image = cairo_image_surface_create_from_png(mvp::FindFile(written).c_str());
    }
    if (cairo_surface_status(image) != CAIRO_STATUS_SUCCESS) {
      cairo_surface_destroy(image);
      RET(v8::Null(ISO));
      return;
    }
    Surface* s = new Surface();
    s->surface = image;
    s->width = cairo_image_surface_get_width(image);
    s->height = cairo_image_surface_get_height(image);
    AccountBytes(static_cast<long long>(s->width) * s->height * 4);
    RET(WrapSurface(ISO, s));
  });

  // --- State -----------------------------------------------------------------
  FN(save, { CANVAS(); cairo_save(cr); });
  FN(restore, { CANVAS(); cairo_restore(cr); });
  FN(setTransform, {
    CANVAS();
    cairo_matrix_t m;
    cairo_matrix_init(&m, D(1), D(2), D(3), D(4), D(5), D(6));
    cairo_set_matrix(cr, &m);
  });
  FN(transform, {
    CANVAS();
    cairo_matrix_t m;
    cairo_matrix_init(&m, D(1), D(2), D(3), D(4), D(5), D(6));
    cairo_transform(cr, &m);
  });
  FN(translate, { CANVAS(); cairo_translate(cr, D(1), D(2)); });
  FN(scale, { CANVAS(); cairo_scale(cr, D(1), D(2)); });
  FN(rotate, { CANVAS(); cairo_rotate(cr, D(1)); });
  FN(setOperator, { CANVAS(); cairo_set_operator(cr, OperatorOf(ToStd(ISO, args[1]))); });

  // --- Rectangles ------------------------------------------------------------
  // fillRect(canvas, x, y, w, h, paint, alpha)
  FN(fillRect, {
    CANVAS();
    PathAside aside(cr);
    SetPaint(ISO, cr, args[5]);
    cairo_rectangle(cr, D(1), D(2), D(3), D(4));
    if (D(6) < 1.0) {
      cairo_save(cr);
      cairo_clip(cr);
      cairo_paint_with_alpha(cr, D(6));
      cairo_restore(cr);
    } else {
      cairo_fill(cr);
    }
  });
  FN(clearRect, {
    CANVAS();
    PathAside aside(cr);
    cairo_save(cr);
    cairo_set_operator(cr, CAIRO_OPERATOR_CLEAR);
    cairo_rectangle(cr, D(1), D(2), D(3), D(4));
    cairo_fill(cr);
    cairo_restore(cr);
  });

  // --- Paths -----------------------------------------------------------------
  FN(beginPath, { CANVAS(); cairo_new_path(cr); });
  FN(closePath, { CANVAS(); cairo_close_path(cr); });
  FN(moveTo, { CANVAS(); cairo_move_to(cr, D(1), D(2)); });
  FN(lineTo, { CANVAS(); cairo_line_to(cr, D(1), D(2)); });
  FN(rect, { CANVAS(); cairo_rectangle(cr, D(1), D(2), D(3), D(4)); });
  FN(arc, {
    CANVAS();
    if (args[6]->BooleanValue(ISO)) cairo_arc_negative(cr, D(1), D(2), D(3), D(4), D(5));
    else cairo_arc(cr, D(1), D(2), D(3), D(4), D(5));
  });
  FN(quadraticCurveTo, {
    CANVAS();
    double x0 = 0, y0 = 0;
    cairo_get_current_point(cr, &x0, &y0);
    double cx = D(1), cy = D(2), x = D(3), y = D(4);
    cairo_curve_to(cr, x0 + 2.0 / 3.0 * (cx - x0), y0 + 2.0 / 3.0 * (cy - y0),
                   x + 2.0 / 3.0 * (cx - x), y + 2.0 / 3.0 * (cy - y), x, y);
  });
  FN(bezierCurveTo, { CANVAS(); cairo_curve_to(cr, D(1), D(2), D(3), D(4), D(5), D(6)); });
  // fill(canvas, paint, alpha) and stroke(canvas, paint, alpha, lineWidth, roundJoin)
  FN(fill, {
    CANVAS();
    SetPaint(ISO, cr, args[1]);
    if (D(2) < 1.0) {
      cairo_save(cr);
      cairo_clip_preserve(cr);
      cairo_paint_with_alpha(cr, D(2));
      cairo_restore(cr);
    } else {
      cairo_fill_preserve(cr);
    }
  });
  FN(stroke, {
    CANVAS();
    SetPaint(ISO, cr, args[1]);
    cairo_set_line_width(cr, D(3));
    cairo_set_line_join(cr, args[4]->BooleanValue(ISO) ? CAIRO_LINE_JOIN_ROUND : CAIRO_LINE_JOIN_MITER);
    cairo_stroke_preserve(cr);
  });
  FN(clip, { CANVAS(); cairo_clip_preserve(cr); });

  // --- Images ----------------------------------------------------------------
  // drawImage(canvas, source, sx, sy, sw, sh, dx, dy, dw, dh, alpha)
  FN(drawImage, {
    CANVAS();
    Surface* source = SurfaceOf(ISO, args[1]);
    if (!source || !source->surface) return;
    double sx = D(2), sy = D(3), sw = D(4), sh = D(5), dx = D(6), dy = D(7), dw = D(8), dh = D(9);
    if (sw <= 0 || sh <= 0 || dw == 0 || dh == 0) return;
    cairo_surface_flush(source->surface);
    PathAside aside(cr);
    cairo_save(cr);
    cairo_rectangle(cr, dx, dy, dw, dh);
    cairo_clip(cr);
    cairo_translate(cr, dx, dy);
    cairo_scale(cr, dw / sw, dh / sh);
    cairo_set_source_surface(cr, source->surface, -sx, -sy);
    // Unscaled copies stay sharp; scaled ones are smoothed.
    cairo_pattern_set_filter(cairo_get_source(cr),
                             (dw == sw && dh == sh) ? CAIRO_FILTER_NEAREST : CAIRO_FILTER_BILINEAR);
    cairo_paint_with_alpha(cr, D(10));
    cairo_restore(cr);
  });

  // --- Text --------------------------------------------------------------------
  // registerFont(family, path): makes a font file usable under a family name.
  FN(registerFont, {
    if (!g_state.freetype && FT_Init_FreeType(&g_state.freetype) != 0) { RET(false); return; }
    FT_Face face = nullptr;
    // The file is looked for whatever the case of its name, as every other
    // file of a game is: games written on Windows name files loosely.
    std::string path = mvp::FindFile(ToStd(ISO, args[1]));
    if (FT_New_Face(g_state.freetype, path.c_str(), 0, &face) != 0) { RET(false); return; }
    g_state.fonts[ToStd(ISO, args[0])] = cairo_ft_font_face_create_for_ft_face(face, 0);
    RET(true);
  });
  // setFont(canvas, family, size): a registered family, or a system font.
  FN(setFont, {
    CANVAS();
    std::string family = ToStd(ISO, args[1]);
    auto found = g_state.fonts.find(family);
    if (found != g_state.fonts.end()) cairo_set_font_face(cr, found->second);
    else cairo_select_font_face(cr, family.c_str(), CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
    cairo_set_font_size(cr, D(2));
  });
  // measureText(canvas, text) -> [advance width, ascent, descent]
  FN(measureText, {
    CANVAS();
    cairo_text_extents_t text;
    cairo_font_extents_t font;
    cairo_text_extents(cr, ToStd(ISO, args[1]).c_str(), &text);
    cairo_font_extents(cr, &font);
    v8::Local<v8::Array> out = v8::Array::New(ISO, 3);
    out->Set(CTX, 0, v8::Number::New(ISO, text.x_advance)).Check();
    out->Set(CTX, 1, v8::Number::New(ISO, font.ascent)).Check();
    out->Set(CTX, 2, v8::Number::New(ISO, font.descent)).Check();
    RET(out);
  });
  // fillText(canvas, text, x, baselineY, paint, alpha)
  FN(fillText, {
    CANVAS();
    SetPaint(ISO, cr, args[4]);
    cairo_new_path(cr);
    cairo_move_to(cr, D(2), D(3));
    cairo_text_path(cr, ToStd(ISO, args[1]).c_str());
    if (D(5) < 1.0) {
      cairo_save(cr);
      cairo_clip(cr);
      cairo_paint_with_alpha(cr, D(5));
      cairo_restore(cr);
    } else {
      cairo_fill(cr);
    }
  });
  // strokeText(canvas, text, x, baselineY, paint, alpha, lineWidth, roundJoin)
  FN(strokeText, {
    CANVAS();
    SetPaint(ISO, cr, args[4]);
    cairo_new_path(cr);
    cairo_move_to(cr, D(2), D(3));
    cairo_text_path(cr, ToStd(ISO, args[1]).c_str());
    cairo_set_line_width(cr, D(6));
    cairo_set_line_join(cr, args[7]->BooleanValue(ISO) ? CAIRO_LINE_JOIN_ROUND : CAIRO_LINE_JOIN_MITER);
    cairo_stroke(cr);
  });

  // --- Gradients ---------------------------------------------------------------
  FN(createLinearGradient,
     RET(WrapGradient(ISO, cairo_pattern_create_linear(D(0), D(1), D(2), D(3)))));
  FN(createRadialGradient,
     RET(WrapGradient(ISO, cairo_pattern_create_radial(D(0), D(1), D(2), D(3), D(4), D(5)))));
  // addColorStop(gradient, offset, r, g, b, a)
  FN(addColorStop, {
    if (cairo_pattern_t* gradient = Hidden<cairo_pattern_t>(ISO, args[0], g_state.gradient_key)) {
      cairo_pattern_add_color_stop_rgba(gradient, D(1), D(2), D(3), D(4), D(5));
    }
  });

  // --- Pixels ------------------------------------------------------------------
  // getImageData(canvas, x, y, w, h) -> Uint8ClampedArray of RGBA, not premultiplied
  FN(getImageData, {
    Surface* s = SurfaceOf(ISO, args[0]);
    int x0 = I(1), y0 = I(2), w = I(3), h = I(4);
    if (!s || w <= 0 || h <= 0) return;
    cairo_surface_flush(s->surface);
    const uint8_t* data = cairo_image_surface_get_data(s->surface);
    int stride = cairo_image_surface_get_stride(s->surface);
    v8::Local<v8::ArrayBuffer> buffer = v8::ArrayBuffer::New(ISO, static_cast<size_t>(w) * h * 4);
    uint8_t* out = static_cast<uint8_t*>(buffer->Data());
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        int sx = x0 + x, sy = y0 + y;
        uint8_t* p = out + (static_cast<size_t>(y) * w + x) * 4;
        if (sx < 0 || sy < 0 || sx >= s->width || sy >= s->height) { std::memset(p, 0, 4); continue; }
        const uint8_t* q = data + sy * stride + sx * 4;  // blue, green, red, alpha
        unsigned a = q[3];
        p[0] = a ? static_cast<uint8_t>(q[2] * 255 / a) : 0;
        p[1] = a ? static_cast<uint8_t>(q[1] * 255 / a) : 0;
        p[2] = a ? static_cast<uint8_t>(q[0] * 255 / a) : 0;
        p[3] = static_cast<uint8_t>(a);
      }
    }
    RET(v8::Uint8ClampedArray::New(buffer, 0, buffer->ByteLength()));
  });
  // putImageData(canvas, rgbaBytes, w, h, dx, dy)
  FN(putImageData, {
    Surface* s = SurfaceOf(ISO, args[0]);
    if (!s || !args[1]->IsArrayBufferView()) return;
    v8::Local<v8::ArrayBufferView> view = args[1].As<v8::ArrayBufferView>();
    const uint8_t* in = static_cast<const uint8_t*>(view->Buffer()->Data()) + view->ByteOffset();
    int w = I(2), h = I(3), dx = I(4), dy = I(5);
    if (w <= 0 || h <= 0 || view->ByteLength() < static_cast<size_t>(w) * h * 4) return;
    cairo_surface_flush(s->surface);
    uint8_t* data = cairo_image_surface_get_data(s->surface);
    int stride = cairo_image_surface_get_stride(s->surface);
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        int tx = dx + x, ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= s->width || ty >= s->height) continue;
        const uint8_t* p = in + (static_cast<size_t>(y) * w + x) * 4;
        uint8_t* q = data + ty * stride + tx * 4;
        unsigned a = p[3];
        q[0] = static_cast<uint8_t>((p[2] * a + 127) / 255);
        q[1] = static_cast<uint8_t>((p[1] * a + 127) / 255);
        q[2] = static_cast<uint8_t>((p[0] * a + 127) / 255);
        q[3] = static_cast<uint8_t>(a);
      }
    }
    cairo_surface_mark_dirty(s->surface);
  });
  FN(bytesInUse, RET(static_cast<double>(g_state.bytes)));
}

#undef FN
#undef CANVAS
#undef RET
#undef I
#undef D
#undef CTX
#undef ISO

}  // namespace

void InstallCanvasBinding(v8::Isolate* isolate, v8::Local<v8::Context> context,
                          v8::Local<v8::Object> player) {
  v8::HandleScope scope(isolate);
  if (g_state.surface_key.IsEmpty()) {
    g_state.isolate = isolate;
    g_state.surface_key.Reset(isolate, v8::Private::New(isolate, Str(isolate, "surface")));
    g_state.gradient_key.Reset(isolate, v8::Private::New(isolate, Str(isolate, "gradient")));
  }
  v8::Local<v8::Object> canvas = v8::Object::New(isolate);
  InstallFunctions(isolate, canvas);
  player->Set(context, Str(isolate, "canvas"), canvas).Check();
}

void ReleaseCanvasBinding() {
  // Free what is still alive; the engine is about to go away.
  while (!g_owned.empty()) {
    Owned* owned = *g_owned.begin();
    owned->handle.Reset();
    FreeOwned(owned);
  }
  g_state.isolate = nullptr;
  g_state.surface_key.Reset();
  g_state.gradient_key.Reset();
}

bool SurfacePixelsForUpload(v8::Isolate* isolate, v8::Local<v8::Value> value, bool premultiply,
                            bool flip_y, std::vector<uint8_t>* pixels, int* width, int* height) {
  if (g_state.surface_key.IsEmpty()) return false;
  Surface* s = SurfaceOf(isolate, value);
  if (!s || !s->surface) return false;
  cairo_surface_flush(s->surface);
  const uint8_t* data = cairo_image_surface_get_data(s->surface);
  int stride = cairo_image_surface_get_stride(s->surface);
  *width = s->width;
  *height = s->height;
  // The buffer only ever grows here: callers reuse one, and making it the
  // exact size each time would clear it for nothing.
  size_t needed = static_cast<size_t>(s->width) * s->height * 4;
  if (pixels->size() < needed) pixels->resize(needed);
  for (int y = 0; y < s->height; y++) {
    const uint8_t* row = data + static_cast<size_t>(flip_y ? s->height - 1 - y : y) * stride;
    uint8_t* out = pixels->data() + static_cast<size_t>(y) * s->width * 4;
    if (premultiply) {
      // The usual case: the colours are wanted as Cairo holds them, with
      // red and blue changing places. One whole pixel at a time, no
      // decisions, so the compiler can do several per instruction.
      for (int x = 0; x < s->width; x++) {
        uint32_t p;
        std::memcpy(&p, row + x * 4, 4);
        p = (p & 0xFF00FF00u) | ((p >> 16) & 0xFFu) | ((p & 0xFFu) << 16);
        std::memcpy(out + x * 4, &p, 4);
      }
      continue;
    }
    for (int x = 0; x < s->width; x++) {
      const uint8_t* q = row + x * 4;  // blue, green, red, alpha; colour already times alpha
      unsigned a = q[3];
      if (a == 255) {
        out[x * 4 + 0] = q[2];
        out[x * 4 + 1] = q[1];
        out[x * 4 + 2] = q[0];
      } else {
        out[x * 4 + 0] = a ? static_cast<uint8_t>(q[2] * 255 / a) : 0;
        out[x * 4 + 1] = a ? static_cast<uint8_t>(q[1] * 255 / a) : 0;
        out[x * 4 + 2] = a ? static_cast<uint8_t>(q[0] * 255 / a) : 0;
      }
      out[x * 4 + 3] = static_cast<uint8_t>(a);
    }
  }
  return true;
}

long long SurfaceBytesInUse() { return g_state.bytes; }

}  // namespace mvp
