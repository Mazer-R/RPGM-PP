#!/bin/sh
# Configures and builds the player. Meant to run inside the image built from
# the Dockerfile next to this script, with the `player/` folder mounted at
# /work/player. The build tree goes to /work/player/build-device.
set -eu
cmake -S /work/player -B /work/player/build-device -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build /work/player/build-device
ls -l /work/player/build-device/potato-player
