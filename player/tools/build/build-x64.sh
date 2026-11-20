#!/bin/sh
# Configures and builds the player for x86-64 Linux. Meant to run inside the
# image built from Dockerfile.x64 next to this script, with the `player/`
# folder mounted at /work/player. It needs the x86-64 V8 library from
# tools/v8/build-x64.sh in third_party/v8-x64. The build tree goes to
# /work/player/build-x64. To make the package, run
# packaging/linux/build-package.sh x86_64 afterwards, in the same image.
set -eu
cmake -S /work/player -B /work/player/build-x64 -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=/work/player/tools/build/toolchain-x64.cmake \
  -DMVP_V8_DIR=/work/player/third_party/v8-x64
cmake --build /work/player/build-x64
ls -l /work/player/build-x64/potato-player
