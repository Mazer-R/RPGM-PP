// Tests for bindings/texture_scale: at what size a picture is sent to the
// graphics memory when a smaller one is asked for, where a part of it then
// falls, and what the smaller picture holds. Built and run by
// tools/build/test.sh.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <string>
#include <vector>

#include "bindings/texture_scale.h"

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

std::string Size(int width, int height, double scale) {
  mvp::PixelSize size = mvp::ScaledUploadSize(width, height, scale);
  return std::to_string(size.width) + "x" + std::to_string(size.height);
}

std::string Rect(mvp::PixelRect part, mvp::PixelSize full, mvp::PixelSize sent) {
  mvp::PixelRect r = mvp::ScaledRect(part, full, sent);
  return std::to_string(r.x) + "," + std::to_string(r.y) + " " + std::to_string(r.width) + "x" + std::to_string(r.height);
}

// A picture of one byte value per pixel, in all four channels.
std::vector<uint8_t> Grey(const std::vector<int>& values) {
  std::vector<uint8_t> out;
  for (int v : values) out.insert(out.end(), 4, static_cast<uint8_t>(v));
  return out;
}

std::string Shrunk(const std::vector<int>& values, mvp::PixelSize from, mvp::PixelSize to) {
  std::vector<uint8_t> in = Grey(values), out(static_cast<size_t>(to.width) * to.height * 4, 7);
  mvp::ShrinkPixels(in.data(), from, to, out.data());
  std::string text;
  for (size_t i = 0; i < out.size(); i += 4) {
    bool same = out[i] == out[i + 1] && out[i] == out[i + 2] && out[i] == out[i + 3];
    text += (i ? " " : "") + (same ? std::to_string(out[i]) : std::string("mixed"));
  }
  return text;
}

}  // namespace

int main() {
  // The size a picture is sent at.
  Expect("a picture the size of the game's is sent at the screen's", Size(816, 624, 640.0 / 816), "640x490");
  Expect("a side is rounded up, so nothing is lost at the edge", Size(801, 601, 0.5), "401x301");
  Expect("no scale asked for: as it is", Size(816, 624, 1.0), "816x624");
  Expect("a scale over one: as it is", Size(816, 624, 1.5), "816x624");
  Expect("a scale of nothing: as it is", Size(816, 624, 0.0), "816x624");
  Expect("a scale that is no number: as it is", Size(816, 624, std::nan("")), "816x624");
  Expect("never under half a side", Size(816, 624, 0.1), "408x312");
  Expect("sides that are powers of two: as it is", Size(1024, 512, 0.78), "1024x512");
  Expect("one side a power of two is not enough to keep it", Size(1024, 600, 0.5), "512x300");
  Expect("a small picture: as it is", Size(192, 192, 0.78), "192x192");
  Expect("a long thin picture is large enough", Size(2000, 100, 0.5), "1000x50");
  Expect("a scale so near one that a side would not change: as it is", Size(1000, 1000, 0.9999), "1000x1000");

  // Where a part falls.
  mvp::PixelSize full = {816, 624}, sent = {640, 490};
  Expect("the whole picture is the whole texture", Rect({0, 0, 816, 624}, full, sent), "0,0 640x490");
  Expect("a part starts at the pixel that holds its first one", Rect({100, 100, 10, 10}, full, sent), "78,78 9x9");
  Expect("a part of one pixel still has a pixel", Rect({815, 623, 1, 1}, full, sent), "639,489 1x1");
  Expect("a part past the edge stops at the edge", Rect({800, 600, 100, 100}, full, sent), "627,471 13x19");

  // What the smaller picture holds.
  Expect("half the size: each pixel the average of four", Shrunk({0, 100, 0, 100, 100, 200, 100, 200,
                                                                   40, 40, 80, 80, 40, 40, 80, 80}, {4, 4}, {2, 2}),
         "100 100 40 80");
  Expect("a flat picture stays flat", Shrunk({200, 200, 200, 200, 200, 200, 200, 200, 200}, {3, 3}, {2, 2}), "200 200 200 200");
  Expect("three to two: the middle one is shared", Shrunk({0, 90, 240}, {3, 1}, {2, 1}), "30 190");
  Expect("the same size: a copy", Shrunk({1, 2, 3, 4}, {2, 2}, {2, 2}), "1 2 3 4");
  Expect("three to one: all three", Shrunk({30, 60, 90}, {3, 1}, {1, 1}), "60");
  Expect("five to two: a pixel made of three, the last one read to its end", Shrunk({10, 20, 30, 40, 50}, {5, 1}, {2, 1}), "18 42");
  Expect("a column made shorter", Shrunk({0, 90, 240}, {1, 3}, {1, 2}), "30 190");
  Expect("white stays white", Shrunk({255, 255, 255, 255, 255, 255, 255, 255, 255}, {3, 3}, {2, 2}), "255 255 255 255");

  // A picture large enough to be shared between cores, against the plain
  // average worked out one pixel at a time.
  {
    mvp::PixelSize from = {816, 628}, to = {628, 484};
    std::vector<uint8_t> in(static_cast<size_t>(from.width) * from.height * 4), out(static_cast<size_t>(to.width) * to.height * 4);
    for (size_t i = 0; i < in.size(); i++) in[i] = static_cast<uint8_t>(i * 31 + (i >> 9));
    mvp::ShrinkPixels(in.data(), from, to, out.data());
    long worst = 0;
    for (int y = 0; y < to.height; y++) {
      for (int x = 0; x < to.width; x++) {
        double a = x * 816.0 / to.width, b = (x + 1) * 816.0 / to.width, e = y * 628.0 / to.height, f = (y + 1) * 628.0 / to.height;
        for (int c = 0; c < 4; c++) {
          double sum = 0, weights = 0;
          for (int sy = static_cast<int>(e); sy < f && sy < from.height; sy++) {
            for (int sx = static_cast<int>(a); sx < b && sx < from.width; sx++) {
              double w = (std::min<double>(sx + 1, b) - std::max<double>(sx, a)) * (std::min<double>(sy + 1, f) - std::max<double>(sy, e));
              sum += in[(static_cast<size_t>(sy) * from.width + sx) * 4 + c] * w;
              weights += w;
            }
          }
          long off = std::labs(static_cast<long>(out[(static_cast<size_t>(y) * to.width + x) * 4 + c]) - std::lround(sum / weights));
          worst = std::max(worst, off);
        }
      }
    }
    Expect("a large picture: every pixel within two of the plain average (the shares are in 256ths)", worst <= 2 ? "yes" : "no, off by " + std::to_string(worst), "yes");
  }

  std::printf("%d failures\n", g_failures);
  return g_failures ? 1 : 0;
}
