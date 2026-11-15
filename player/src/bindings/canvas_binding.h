// Canvas 2D drawing and image decoding for the game, on Cairo and FreeType.
//
// This is the low-level half. It exposes plain functions that take every
// parameter explicitly (a surface handle, coordinates, a paint). The Canvas
// 2D object the game sees (with its state, CSS colour strings and font
// shorthand) is JavaScript built on top of these, because that part does no
// per-pixel work.
//
// A "surface" is a block of pixels: either a canvas, which can be drawn on,
// or a decoded image. Both can be drawn onto a canvas and both can be used
// as a WebGL texture source.
#pragma once

#include <cstdint>
#include <vector>

#include "v8.h"

namespace mvp {

// Installs the `player.canvas` object with the drawing functions.
void InstallCanvasBinding(v8::Isolate* isolate, v8::Local<v8::Context> context,
                          v8::Local<v8::Object> player);

// Releases the references the binding holds into the JavaScript engine.
// Must be called before the engine is shut down.
void ReleaseCanvasBinding();

// Pixels of a surface for a WebGL upload, as RGBA bytes, rows top to bottom.
// `value` is a surface handle, or an object whose `__native` property is
// one. Colour is premultiplied by alpha when `premultiply` is set, and rows
// are reversed when `flip_y` is set. Returns false if `value` is no surface.
bool SurfacePixelsForUpload(v8::Isolate* isolate, v8::Local<v8::Value> value, bool premultiply,
                            bool flip_y, std::vector<uint8_t>* pixels, int* width, int* height);

// Bytes currently held by surfaces, for the log.
long long SurfaceBytesInUse();

}  // namespace mvp
