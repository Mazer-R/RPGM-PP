#!/bin/sh
# Builds the player for Android (arm64-v8a) on the build machine itself, with
# the Android NDK and the CMake that comes with the Android SDK. It needs:
#   third_party/v8-android     V8, from tools/v8/build-android.sh
#   third_party/android-deps   Cairo and friends, from build-android-deps.sh
# The result is build-android/native/libmain.so and libSDL2.so; to make the
# installable package run packaging/android/build-apk.sh afterwards.
#
#   ANDROID_SDK  the SDK folder (default ~/Library/Android/sdk)
#   ANDROID_NDK  the NDK folder (default: the r27 one in the SDK)
#   MVP_V8_DIR   another V8 folder
set -eu
HERE=$(cd "$(dirname "$0")/../.." && pwd)
SDK="${ANDROID_SDK:-$HOME/Library/Android/sdk}"
NDK="${ANDROID_NDK:-$SDK/ndk/27.1.12297006}"
CMAKE_DIR=$(ls -d "$SDK"/cmake/*/bin | tail -n 1)
SDL=SDL2-2.32.10
SDL_SHA=5f5993c530f084535c65a6879e9b26ad441169b3e25d789d83287040a9ca5165
WORK="$HERE/build-android"

mkdir -p "$WORK/dl"
if [ ! -d "$WORK/$SDL" ]; then
  [ -f "$WORK/dl/$SDL.tar.gz" ] || curl -sSL -o "$WORK/dl/$SDL.tar.gz" \
    "https://github.com/libsdl-org/SDL/releases/download/release-${SDL#SDL2-}/$SDL.tar.gz"
  echo "$SDL_SHA  $WORK/dl/$SDL.tar.gz" | shasum -a 256 -c -
  tar -xf "$WORK/dl/$SDL.tar.gz" -C "$WORK"
fi

# API level 26 (Android 8.0). Libraries are laid out for 16 KB memory pages,
# which newer devices require and older ones accept.
"$CMAKE_DIR/cmake" -S "$HERE" -B "$WORK/native" -G Ninja -DCMAKE_MAKE_PROGRAM="$CMAKE_DIR/ninja" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static \
  -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON \
  -DMVP_SDL_DIR="$WORK/$SDL" \
  -DMVP_V8_DIR="${MVP_V8_DIR:-$HERE/third_party/v8-android}"
"$CMAKE_DIR/cmake" --build "$WORK/native"
ls -l "$WORK/native/libmain.so" "$WORK/native/sdl2/libSDL2.so"
