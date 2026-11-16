#!/bin/sh
# Builds and runs the player's native unit tests inside the build container.
# Usage (from the player/ folder):
#   docker run --rm -v "$PWD":/work/player mvp-player-build sh /work/player/tools/build/test.sh
set -eu
cd /work/player
mkdir -p build-device/tests
g++ -std=c++17 -Wall -Wextra -Werror -Isrc tests/native/files_test.cpp src/platform/files.cpp -o build-device/tests/files_test
build-device/tests/files_test
g++ -std=c++17 -Wall -Wextra -Werror -Isrc tests/native/touch_test.cpp src/platform/touch.cpp -o build-device/tests/touch_test
build-device/tests/touch_test
g++ -std=c++17 -Wall -Wextra -Werror -pthread -Isrc tests/native/video_test.cpp src/platform/video.cpp -o build-device/tests/video_test
build-device/tests/video_test
