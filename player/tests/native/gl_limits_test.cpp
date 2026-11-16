// Tests for bindings/gl_limits: what the WebGL binding must know before it
// hands a script's request to the graphics driver, so that the driver never
// writes or reads past the memory it was given. Built and run by
// tools/build/test.sh.
#include <cstdio>
#include <string>

#include "bindings/gl_limits.h"

namespace {

int g_failures = 0;

void Expect(const std::string& what, const std::string& got, const std::string& wanted) {
  bool ok = got == wanted;
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) {
    std::printf("       got    %s\n       wanted %s\n", got.c_str(), wanted.c_str());
    g_failures++;
  }
}

std::string Shape(unsigned name) {
  mvp::GlParameterShape shape = mvp::ShapeOfGlParameter(name);
  const char* kinds[] = {"none", "int", "float", "bool"};
  return std::string(kinds[static_cast<int>(shape.kind)]) + " x" + std::to_string(shape.count);
}

std::string Bytes(int width, int height, unsigned format, unsigned type, int alignment) {
  size_t bytes = 0;
  return mvp::PixelBytes(width, height, format, type, alignment, &bytes) ? std::to_string(bytes) : "unknown";
}

// OpenGL ES 2 names, as numbers.
const unsigned kMaxTextureSize = 0x0D33, kMaxViewportDims = 0x0D3A, kViewport = 0x0BA2, kColorClearValue = 0x0C22;
const unsigned kAliasedLineWidthRange = 0x846E, kColorWritemask = 0x0C23, kBlend = 0x0BE2, kLineWidth = 0x0B21;
const unsigned kCompressedTextureFormats = 0x86A3, kCurrentProgram = 0x8B8D;
const unsigned kAlpha = 0x1906, kRgb = 0x1907, kRgba = 0x1908, kLuminanceAlpha = 0x190A;
const unsigned kUnsignedByte = 0x1401, kUnsignedShort565 = 0x8363, kFloat = 0x1406;

}  // namespace

int main() {
  Expect("the largest texture size is one whole number", Shape(kMaxTextureSize), "int x1");
  Expect("the largest viewport is two", Shape(kMaxViewportDims), "int x2");
  Expect("the viewport is four", Shape(kViewport), "int x4");
  Expect("the clear colour is four fractions", Shape(kColorClearValue), "float x4");
  Expect("the range of line widths is two fractions", Shape(kAliasedLineWidthRange), "float x2");
  Expect("the line width is one fraction", Shape(kLineWidth), "float x1");
  Expect("the colour mask is four yes-or-noes", Shape(kColorWritemask), "bool x4");
  Expect("whether blending is on is one", Shape(kBlend), "bool x1");
  Expect("the program in use is one whole number", Shape(kCurrentProgram), "int x1");
  Expect("a list whose length the driver decides is not asked for", Shape(kCompressedTextureFormats), "none x0");
  Expect("nor is a name the binding does not know", Shape(0x9999), "none x0");

  Expect("four bytes per RGBA pixel", Bytes(8, 4, kRgba, kUnsignedByte, 4), "128");
  Expect("rows of RGB are filled up to the alignment, but not the last one", Bytes(3, 2, kRgb, kUnsignedByte, 4), "21");
  Expect("with alignment 1 they are not", Bytes(3, 2, kRgb, kUnsignedByte, 1), "18");
  Expect("one byte per alpha pixel, rows aligned", Bytes(5, 3, kAlpha, kUnsignedByte, 4), "21");
  Expect("two bytes for luminance with alpha", Bytes(2, 2, kLuminanceAlpha, kUnsignedByte, 1), "8");
  Expect("packed 5-6-5 pixels take two bytes", Bytes(3, 1, kRgb, kUnsignedShort565, 4), "6");
  Expect("an empty image needs no bytes", Bytes(0, 7, kRgba, kUnsignedByte, 4), "0");
  Expect("a negative size is refused", Bytes(-1, 4, kRgba, kUnsignedByte, 4), "unknown");
  Expect("so is a type the binding does not pass on", Bytes(4, 4, kRgba, kFloat, 4), "unknown");
  Expect("and a format that does not go with the type", Bytes(4, 4, kRgba, kUnsignedShort565, 4), "unknown");
  Expect("and an alignment the driver would not have", Bytes(4, 4, kRgba, kUnsignedByte, 3), "unknown");
  Expect("a size too large to count is refused, not wrapped round", Bytes(0x7fffffff, 0x7fffffff, kRgba, kUnsignedByte, 8), "unknown");

  std::printf(g_failures ? "\n%d FAILED\n" : "\nall passed\n", g_failures);
  return g_failures ? 1 : 0;
}
