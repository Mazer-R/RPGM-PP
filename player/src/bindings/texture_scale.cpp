#include "bindings/texture_scale.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <thread>
#include <vector>

namespace mvp {

namespace {

// Under this many pixels a picture's texture is not worth making smaller.
const long long kLeastPixels = 128 * 1024;
const double kLeastScale = 0.5;
// From this many pixels on, making a picture smaller is shared between cores.
const long long kLeastPixelsToShare = 64 * 1024;

bool IsPowerOfTwo(int n) { return n > 0 && (n & (n - 1)) == 0; }

// A side at a scale, rounded up; a hair is taken off first so that a side
// meant to come out whole (816 at 640/816) does not gain a pixel.
int ScaledSide(int side, double scale) {
  return std::max(1, std::min(side, static_cast<int>(std::ceil(side * scale - 1e-6))));
}

// For one side: the source pixels each smaller pixel is made of, and how
// much of each. Every smaller pixel has the same number of them (`count`,
// as many as the one that covers most), the ones it does not cover with a
// weight of nothing, so that the work is the same for every pixel and the
// compiler can do several at once. The weights of a pixel add up to 256.
struct Taps {
  int count = 1;
  std::vector<int> first;        // the first source pixel of each smaller one
  std::vector<uint16_t> weight;  // `count` for each smaller one
};
Taps TapsFor(int from, int to) {
  Taps taps;
  // The edges of each smaller pixel on the source, in 1/256ths of a pixel.
  auto edge = [&](int i) { return static_cast<long long>(i) * from * 256 / to; };
  for (int i = 0; i < to; i++) {
    int first = static_cast<int>(edge(i) / 256), last = static_cast<int>((edge(i + 1) - 1) / 256);
    taps.count = std::max(taps.count, std::min(last, from - 1) - first + 1);
  }
  taps.count = std::min(taps.count, from);
  taps.first.resize(static_cast<size_t>(to));
  taps.weight.assign(static_cast<size_t>(to) * taps.count, 0);
  for (int i = 0; i < to; i++) {
    long long a = edge(i), b = edge(i + 1);
    int first = static_cast<int>(a / 256), last = std::min(static_cast<int>((b - 1) / 256), from - 1);
    // Never read past the end of the source: start early enough instead.
    int start = std::min(first, from - taps.count);
    taps.first[static_cast<size_t>(i)] = start;
    uint16_t* weight = taps.weight.data() + static_cast<size_t>(i) * taps.count;
    long long whole = b - a, given = 0;
    for (int at = first; at <= last; at++) {
      long long covered = std::min(b, (at + 1) * 256LL) - std::max(a, at * 256LL);
      long long share = at == last ? 256 - given : (covered * 256 + whole / 2) / whole;
      weight[at - start] = static_cast<uint16_t>(share);
      given += share;
    }
  }
  return taps;
}

// Makes the rows of the smaller picture from `first_row` up to `end_row`:
// each source row is made narrower, then the narrow rows are added up. A
// narrow row holds each colour times 256, so that nothing is lost between
// the two steps. No division anywhere: a handheld's processor takes longer
// over one than over all the rest.
void ShrinkRows(const uint8_t* pixels, PixelSize from, PixelSize to, const Taps& columns, const Taps& rows,
                int first_row, int end_row, uint8_t* out) {
  size_t narrow_row = static_cast<size_t>(to.width) * 4;
  // The narrow rows that the row being made needs, each in the place its
  // source row's number gives, so that a row two of them share is made once.
  std::vector<uint16_t> narrow(narrow_row * static_cast<size_t>(rows.count));
  std::vector<int> held(static_cast<size_t>(rows.count), -1);
  std::vector<uint32_t> sums(narrow_row);

  auto narrowed = [&](int sy) -> const uint16_t* {
    size_t slot = static_cast<size_t>(sy % rows.count);
    uint16_t* row = narrow.data() + slot * narrow_row;
    if (held[slot] == sy) return row;
    held[slot] = sy;
    const uint8_t* line = pixels + static_cast<size_t>(sy) * from.width * 4;
    const uint16_t* weight = columns.weight.data();
    for (int x = 0; x < to.width; x++, weight += columns.count) {
      const uint8_t* p = line + static_cast<size_t>(columns.first[static_cast<size_t>(x)]) * 4;
      uint32_t sum[4] = {0, 0, 0, 0};
      for (int tap = 0; tap < columns.count; tap++, p += 4) {
        uint32_t w = weight[tap];
        sum[0] += p[0] * w;
        sum[1] += p[1] * w;
        sum[2] += p[2] * w;
        sum[3] += p[3] * w;
      }
      uint16_t* q = row + static_cast<size_t>(x) * 4;
      q[0] = static_cast<uint16_t>(sum[0]);
      q[1] = static_cast<uint16_t>(sum[1]);
      q[2] = static_cast<uint16_t>(sum[2]);
      q[3] = static_cast<uint16_t>(sum[3]);
    }
    return row;
  };

  for (int y = first_row; y < end_row; y++) {
    int start = rows.first[static_cast<size_t>(y)];
    const uint16_t* weight = rows.weight.data() + static_cast<size_t>(y) * rows.count;
    std::fill(sums.begin(), sums.end(), 1u << 15);  // half of what is divided by: rounds
    for (int tap = 0; tap < rows.count; tap++) {
      uint32_t w = weight[tap];
      if (!w) continue;
      const uint16_t* line = narrowed(start + tap);
      for (size_t i = 0; i < narrow_row; i++) sums[i] += line[i] * w;
    }
    uint8_t* line = out + static_cast<size_t>(y) * narrow_row;
    for (size_t i = 0; i < narrow_row; i++) line[i] = static_cast<uint8_t>(sums[i] >> 16);
  }
}

}  // namespace

PixelSize ScaledUploadSize(int width, int height, double scale) {
  PixelSize same = {width, height};
  if (!(scale > 0.0 && scale < 1.0) || width < 1 || height < 1) return same;
  if (IsPowerOfTwo(width) && IsPowerOfTwo(height)) return same;
  if (static_cast<long long>(width) * height < kLeastPixels) return same;
  scale = std::max(scale, kLeastScale);
  return {ScaledSide(width, scale), ScaledSide(height, scale)};
}

PixelRect ScaledRect(PixelRect part, PixelSize full, PixelSize sent) {
  auto low = [](int at, int of, int to) { return static_cast<int>(static_cast<long long>(at) * to / of); };
  auto high = [](int at, int of, int to) { return static_cast<int>((static_cast<long long>(at) * to + of - 1) / of); };
  int x0 = std::max(0, std::min(part.x, full.width)), x1 = std::max(x0, std::min(part.x + part.width, full.width));
  int y0 = std::max(0, std::min(part.y, full.height)), y1 = std::max(y0, std::min(part.y + part.height, full.height));
  int left = low(x0, full.width, sent.width), right = high(x1, full.width, sent.width);
  int top = low(y0, full.height, sent.height), bottom = high(y1, full.height, sent.height);
  return {left, top, right - left, bottom - top};
}

void ShrinkPixels(const uint8_t* pixels, PixelSize from, PixelSize to, uint8_t* out) {
  if (from.width == to.width && from.height == to.height) {
    std::memcpy(out, pixels, static_cast<size_t>(from.width) * from.height * 4);
    return;
  }
  // One side at a time, which is the same average for far less work.
  Taps columns = TapsFor(from.width, to.width), rows = TapsFor(from.height, to.height);
  // A large picture is shared out between the processor's cores, each
  // making some of the rows: on a handheld one core takes a frame's time
  // and more over a picture the size of the screen.
  int parts = 1;
  if (static_cast<long long>(to.width) * to.height >= kLeastPixelsToShare) {
    parts = static_cast<int>(std::max(1u, std::min(4u, std::thread::hardware_concurrency())));
  }
  std::vector<std::thread> others;
  for (int part = 1; part < parts; part++) {
    others.emplace_back(ShrinkRows, pixels, from, to, std::cref(columns), std::cref(rows), to.height * part / parts,
                        to.height * (part + 1) / parts, out);
  }
  ShrinkRows(pixels, from, to, columns, rows, 0, to.height / parts, out);
  for (std::thread& other : others) other.join();
}

}  // namespace mvp
