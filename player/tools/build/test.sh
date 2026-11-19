#!/bin/sh
# Builds and runs the player's native unit tests inside the build container.
# Usage (from the player/ folder):
#   docker run --rm -v "$PWD":/work/player mvp-player-build sh /work/player/tools/build/test.sh
set -eu
cd /work/player
mkdir -p build-device/tests
# run <name> <sources...>: builds tests/native/<name>.cpp with the sources it
# tests, and runs it. A test that fails stops the script.
run() {
  NAME=$1; shift
  g++ -std=c++17 -Wall -Wextra -Werror -pthread -Isrc "tests/native/$NAME.cpp" "$@" -o "build-device/tests/$NAME"
  "build-device/tests/$NAME"
}
run files_test src/platform/files.cpp
run gl_limits_test src/bindings/gl_limits.cpp
run library_test src/platform/game_library.cpp
run touch_test src/platform/touch.cpp src/platform/touch_layout.cpp
run pad_cursor_test src/platform/pad_cursor.cpp
run session_test src/platform/session.cpp
run menu_test src/platform/button_map.cpp src/platform/settings_menu.cpp src/platform/touch_layout.cpp
run video_test src/platform/video.cpp
run texture_scale_test src/bindings/texture_scale.cpp
