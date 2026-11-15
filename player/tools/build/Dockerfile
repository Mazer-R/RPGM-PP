# Build environment for the player itself, on 64-bit ARM Linux.
#
# Same base system and compiler as the image that builds V8, so the player
# and the V8 library agree on the C++ standard library. The development
# packages provide headers and link-time libraries for SDL2, OpenGL ES 2 and
# EGL. The handheld has its own copies of those libraries under the same
# library names, so a binary linked here loads the handheld's copies there.
FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake ninja-build pkg-config \
      libsdl2-dev libgles-dev libegl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
