// Where a place on the screen falls in the game's picture. The picture is
// shown as large as fits inside the screen, keeping its proportions and
// centred, with bars at the sides or above and below. A place on a bar
// comes out outside the picture (negative, or past its size).
#pragma once

namespace mvp {

struct PicturePoint {
  float x, y;
};

inline PicturePoint ScreenToPicture(int screen_width, int screen_height, int picture_width, int picture_height,
                                    float x, float y) {
  if (screen_width <= 0 || screen_height <= 0 || picture_width <= 0 || picture_height <= 0) return {x, y};
  float scale_x = static_cast<float>(screen_width) / static_cast<float>(picture_width);
  float scale_y = static_cast<float>(screen_height) / static_cast<float>(picture_height);
  float scale = scale_x < scale_y ? scale_x : scale_y;
  float left = (static_cast<float>(screen_width) - static_cast<float>(picture_width) * scale) / 2;
  float top = (static_cast<float>(screen_height) - static_cast<float>(picture_height) * scale) / 2;
  return {(x - left) / scale, (y - top) / scale};
}

}  // namespace mvp
