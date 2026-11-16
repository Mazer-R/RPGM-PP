#include "bindings/gl_limits.h"

#include <cstdint>

namespace mvp {

namespace {

struct KnownParameter {
  unsigned name;
  GlValueKind kind;
  int count;
};

// The state names of OpenGL ES 2 that WebGL 1 lets a page ask for, by
// number, with what the driver writes for each.
const KnownParameter kParameters[] = {
    // Whole numbers, one each.
    {0x84E0, GlValueKind::kInt, 1},  // ACTIVE_TEXTURE
    {0x0D52, GlValueKind::kInt, 1},  // RED_BITS
    {0x0D53, GlValueKind::kInt, 1},  // GREEN_BITS
    {0x0D54, GlValueKind::kInt, 1},  // BLUE_BITS
    {0x0D55, GlValueKind::kInt, 1},  // ALPHA_BITS
    {0x0D56, GlValueKind::kInt, 1},  // DEPTH_BITS
    {0x0D57, GlValueKind::kInt, 1},  // STENCIL_BITS
    {0x0D50, GlValueKind::kInt, 1},  // SUBPIXEL_BITS
    {0x80A8, GlValueKind::kInt, 1},  // SAMPLE_BUFFERS
    {0x80A9, GlValueKind::kInt, 1},  // SAMPLES
    {0x80C8, GlValueKind::kInt, 1},  // BLEND_DST_RGB
    {0x80C9, GlValueKind::kInt, 1},  // BLEND_SRC_RGB
    {0x80CA, GlValueKind::kInt, 1},  // BLEND_DST_ALPHA
    {0x80CB, GlValueKind::kInt, 1},  // BLEND_SRC_ALPHA
    {0x8009, GlValueKind::kInt, 1},  // BLEND_EQUATION_RGB
    {0x883D, GlValueKind::kInt, 1},  // BLEND_EQUATION_ALPHA
    {0x0B45, GlValueKind::kInt, 1},  // CULL_FACE_MODE
    {0x0B46, GlValueKind::kInt, 1},  // FRONT_FACE
    {0x0B74, GlValueKind::kInt, 1},  // DEPTH_FUNC
    {0x0B91, GlValueKind::kInt, 1},  // STENCIL_CLEAR_VALUE
    {0x0B92, GlValueKind::kInt, 1},  // STENCIL_FUNC
    {0x0B93, GlValueKind::kInt, 1},  // STENCIL_VALUE_MASK
    {0x0B94, GlValueKind::kInt, 1},  // STENCIL_FAIL
    {0x0B95, GlValueKind::kInt, 1},  // STENCIL_PASS_DEPTH_FAIL
    {0x0B96, GlValueKind::kInt, 1},  // STENCIL_PASS_DEPTH_PASS
    {0x0B97, GlValueKind::kInt, 1},  // STENCIL_REF
    {0x0B98, GlValueKind::kInt, 1},  // STENCIL_WRITEMASK
    {0x8800, GlValueKind::kInt, 1},  // STENCIL_BACK_FUNC
    {0x8801, GlValueKind::kInt, 1},  // STENCIL_BACK_FAIL
    {0x8802, GlValueKind::kInt, 1},  // STENCIL_BACK_PASS_DEPTH_FAIL
    {0x8803, GlValueKind::kInt, 1},  // STENCIL_BACK_PASS_DEPTH_PASS
    {0x8CA3, GlValueKind::kInt, 1},  // STENCIL_BACK_REF
    {0x8CA4, GlValueKind::kInt, 1},  // STENCIL_BACK_VALUE_MASK
    {0x8CA5, GlValueKind::kInt, 1},  // STENCIL_BACK_WRITEMASK
    {0x8192, GlValueKind::kInt, 1},  // GENERATE_MIPMAP_HINT
    {0x0D05, GlValueKind::kInt, 1},  // PACK_ALIGNMENT
    {0x0CF5, GlValueKind::kInt, 1},  // UNPACK_ALIGNMENT
    {0x0D33, GlValueKind::kInt, 1},  // MAX_TEXTURE_SIZE
    {0x851C, GlValueKind::kInt, 1},  // MAX_CUBE_MAP_TEXTURE_SIZE
    {0x84E8, GlValueKind::kInt, 1},  // MAX_RENDERBUFFER_SIZE
    {0x8869, GlValueKind::kInt, 1},  // MAX_VERTEX_ATTRIBS
    {0x8DFB, GlValueKind::kInt, 1},  // MAX_VERTEX_UNIFORM_VECTORS
    {0x8DFC, GlValueKind::kInt, 1},  // MAX_VARYING_VECTORS
    {0x8DFD, GlValueKind::kInt, 1},  // MAX_FRAGMENT_UNIFORM_VECTORS
    {0x8B4C, GlValueKind::kInt, 1},  // MAX_VERTEX_TEXTURE_IMAGE_UNITS
    {0x8B4D, GlValueKind::kInt, 1},  // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    {0x8872, GlValueKind::kInt, 1},  // MAX_TEXTURE_IMAGE_UNITS
    {0x8B9A, GlValueKind::kInt, 1},  // IMPLEMENTATION_COLOR_READ_TYPE
    {0x8B9B, GlValueKind::kInt, 1},  // IMPLEMENTATION_COLOR_READ_FORMAT
    // What is bound or in use: the driver's own number for it.
    {0x8894, GlValueKind::kInt, 1},  // ARRAY_BUFFER_BINDING
    {0x8895, GlValueKind::kInt, 1},  // ELEMENT_ARRAY_BUFFER_BINDING
    {0x8CA6, GlValueKind::kInt, 1},  // FRAMEBUFFER_BINDING
    {0x8CA7, GlValueKind::kInt, 1},  // RENDERBUFFER_BINDING
    {0x8069, GlValueKind::kInt, 1},  // TEXTURE_BINDING_2D
    {0x8514, GlValueKind::kInt, 1},  // TEXTURE_BINDING_CUBE_MAP
    {0x8B8D, GlValueKind::kInt, 1},  // CURRENT_PROGRAM
    // Whole numbers, several.
    {0x0D3A, GlValueKind::kInt, 2},  // MAX_VIEWPORT_DIMS
    {0x0BA2, GlValueKind::kInt, 4},  // VIEWPORT
    {0x0C10, GlValueKind::kInt, 4},  // SCISSOR_BOX
    // Fractions.
    {0x0B73, GlValueKind::kFloat, 1},  // DEPTH_CLEAR_VALUE
    {0x0B21, GlValueKind::kFloat, 1},  // LINE_WIDTH
    {0x8038, GlValueKind::kFloat, 1},  // POLYGON_OFFSET_FACTOR
    {0x2A00, GlValueKind::kFloat, 1},  // POLYGON_OFFSET_UNITS
    {0x80AA, GlValueKind::kFloat, 1},  // SAMPLE_COVERAGE_VALUE
    {0x846D, GlValueKind::kFloat, 2},  // ALIASED_POINT_SIZE_RANGE
    {0x846E, GlValueKind::kFloat, 2},  // ALIASED_LINE_WIDTH_RANGE
    {0x0B70, GlValueKind::kFloat, 2},  // DEPTH_RANGE
    {0x8005, GlValueKind::kFloat, 4},  // BLEND_COLOR
    {0x0C22, GlValueKind::kFloat, 4},  // COLOR_CLEAR_VALUE
    // Yes or no.
    {0x0BE2, GlValueKind::kBool, 1},  // BLEND
    {0x0B44, GlValueKind::kBool, 1},  // CULL_FACE
    {0x0B71, GlValueKind::kBool, 1},  // DEPTH_TEST
    {0x0B72, GlValueKind::kBool, 1},  // DEPTH_WRITEMASK
    {0x0BD0, GlValueKind::kBool, 1},  // DITHER
    {0x8037, GlValueKind::kBool, 1},  // POLYGON_OFFSET_FILL
    {0x809E, GlValueKind::kBool, 1},  // SAMPLE_ALPHA_TO_COVERAGE
    {0x80A0, GlValueKind::kBool, 1},  // SAMPLE_COVERAGE
    {0x80AB, GlValueKind::kBool, 1},  // SAMPLE_COVERAGE_INVERT
    {0x0C11, GlValueKind::kBool, 1},  // SCISSOR_TEST
    {0x0B90, GlValueKind::kBool, 1},  // STENCIL_TEST
    {0x0C23, GlValueKind::kBool, 4},  // COLOR_WRITEMASK
};

// Bytes per pixel for a format and type that go together, else 0.
size_t BytesPerPixel(unsigned format, unsigned type) {
  const unsigned kAlpha = 0x1906, kRgb = 0x1907, kRgba = 0x1908, kLuminance = 0x1909, kLuminanceAlpha = 0x190A;
  const unsigned kUnsignedByte = 0x1401, k565 = 0x8363, k4444 = 0x8033, k5551 = 0x8034;
  if (type == kUnsignedByte) {
    if (format == kAlpha || format == kLuminance) return 1;
    if (format == kLuminanceAlpha) return 2;
    if (format == kRgb) return 3;
    if (format == kRgba) return 4;
    return 0;
  }
  if (type == k565) return format == kRgb ? 2 : 0;
  if (type == k4444 || type == k5551) return format == kRgba ? 2 : 0;
  return 0;
}

}  // namespace

GlParameterShape ShapeOfGlParameter(unsigned name) {
  for (const KnownParameter& known : kParameters) {
    if (known.name == name) return {known.kind, known.count};
  }
  return {GlValueKind::kNone, 0};
}

bool PixelBytes(int width, int height, unsigned format, unsigned type, int alignment, size_t* bytes) {
  size_t pixel = BytesPerPixel(format, type);
  if (width < 0 || height < 0 || pixel == 0) return false;
  if (alignment != 1 && alignment != 2 && alignment != 4 && alignment != 8) return false;
  if (width == 0 || height == 0) {
    *bytes = 0;
    return true;
  }
  // Counted in 64 bits: at most 2^31 * 4 per row and 2^31 rows.
  uint64_t row = static_cast<uint64_t>(width) * pixel;
  uint64_t aligned = (row + static_cast<uint64_t>(alignment) - 1) / static_cast<uint64_t>(alignment) *
                     static_cast<uint64_t>(alignment);
  uint64_t total = aligned * static_cast<uint64_t>(height - 1) + row;
  if (total > static_cast<uint64_t>(SIZE_MAX) || total > (uint64_t{1} << 40)) return false;
  *bytes = static_cast<size_t>(total);
  return true;
}

}  // namespace mvp
