// Sending a picture to the graphics memory smaller than it is. A picture
// that the game shows whole on a screen smaller than the game's own picture
// is never seen at its full size, yet its texture takes the memory of all
// of it. A texture's coordinates run from 0 to 1 whatever its size, so a
// smaller texture is drawn in the same place; the game is told nothing.
// No OpenGL call is made here, so this can be tested anywhere.
#pragma once

#include <cstdint>

namespace mvp {

struct PixelSize {
  int width;
  int height;
};

// The size at which a picture of width x height is sent when `scale` is
// asked for. The same size when nothing is to be gained or it is not safe:
// a scale that is no number between 0 and 1, a picture whose sides are both
// powers of two (the game may repeat it or ask for smaller copies of it,
// which OpenGL ES 2 allows only for such sizes), or a picture too small to
// matter. Never under half a side.
PixelSize ScaledUploadSize(int width, int height, double scale);

struct PixelRect {
  int x, y, width, height;
};

// Where a part of a picture falls in its texture, when the picture of
// `full` size was sent at `sent` size: every pixel of the texture that the
// part touches.
PixelRect ScaledRect(PixelRect part, PixelSize full, PixelSize sent);

// Writes to `out` (to.width x to.height pixels of four bytes) the picture
// `pixels` (from.width x from.height) made smaller: each pixel is the
// average of the ones it covers, by how much of each it covers. The colours
// should already be multiplied by their alpha, or a see-through pixel's
// colour leaks into its neighbours.
void ShrinkPixels(const uint8_t* pixels, PixelSize from, PixelSize to, uint8_t* out);

}  // namespace mvp
