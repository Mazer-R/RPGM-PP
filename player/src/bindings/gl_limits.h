// What the WebGL binding must know before it passes a script's request to
// the graphics driver: how many values the driver will write for a state
// query, and how many bytes of pixels it will read or write for an image.
// Scripts decide the names and sizes; the driver trusts them. No OpenGL
// call is made here, so this can be tested anywhere.
#pragma once

#include <cstddef>

namespace mvp {

enum class GlValueKind { kNone, kInt, kFloat, kBool };

// What glGet gives for a state name: values of one kind, `count` of them.
// kNone with count 0 for a name that is not passed on: one the binding
// does not know, or one whose number of values the driver decides.
struct GlParameterShape {
  GlValueKind kind;
  int count;
};
GlParameterShape ShapeOfGlParameter(unsigned name);

// The bytes that an image of width x height pixels takes in memory in the
// given format and type, with each row but the last filled up to
// `alignment` bytes (1, 2, 4 or 8, as GL_PACK_ALIGNMENT and
// GL_UNPACK_ALIGNMENT say). Returns false, leaving `bytes` alone, for a
// negative size, a format and type that do not go together or are not
// passed on, another alignment, or a size too large to count.
bool PixelBytes(int width, int height, unsigned format, unsigned type, int alignment, size_t* bytes);

}  // namespace mvp
