#!/bin/sh
# Builds the C libraries the player needs on Android that Android does not
# ship: Cairo with pixman, FreeType and libpng, as static libraries for
# arm64-v8a. Runs on the build machine itself (macOS or Linux) with the
# Android NDK; the result goes to third_party/android-deps (headers under
# include/, libraries under lib/).
#
# Usage: sh tools/build/build-android-deps.sh
#   ANDROID_NDK  the NDK folder (default: the r27 one under ~/Library/Android/sdk)
#   MESON        the meson program (default: build-android/venv/bin/meson,
#                made with `python3 -m venv build-android/venv` and
#                `build-android/venv/bin/pip install meson`)
#   NINJA        the ninja program (default: the one in the SDK's cmake)
#
# Cairo's source is downloaded once to build-android/dl and checked against
# the SHA-256 below; pixman, FreeType and libpng come through the wrap files
# inside Cairo's source, which carry their own checksums.
set -eu
HERE=$(cd "$(dirname "$0")/../.." && pwd)
NDK="${ANDROID_NDK:-$HOME/Library/Android/sdk/ndk/27.1.12297006}"
MESON="${MESON:-$HERE/build-android/venv/bin/meson}"
NINJA="${NINJA:-$(ls "$HOME"/Library/Android/sdk/cmake/*/bin/ninja | tail -n 1)}"
API=26
CAIRO=cairo-1.18.4
CAIRO_SHA=445ed8208a6e4823de1226a74ca319d3600e83f6369f99b14265006599c32ccb

TOOLS=$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/bin | head -n 1)
WORK="$HERE/build-android"
OUT="$HERE/third_party/android-deps"
mkdir -p "$WORK/dl"

if [ ! -f "$WORK/dl/$CAIRO.tar.xz" ]; then
  curl -sSL -o "$WORK/dl/$CAIRO.tar.xz" "https://cairographics.org/releases/$CAIRO.tar.xz"
fi
echo "$CAIRO_SHA  $WORK/dl/$CAIRO.tar.xz" | shasum -a 256 -c -
[ -d "$WORK/$CAIRO" ] || tar -xf "$WORK/dl/$CAIRO.tar.xz" -C "$WORK"

cat > "$WORK/android-arm64.ini" <<CROSS
[binaries]
c = '$TOOLS/aarch64-linux-android$API-clang'
cpp = '$TOOLS/aarch64-linux-android$API-clang++'
ar = '$TOOLS/llvm-ar'
strip = '$TOOLS/llvm-strip'
ninja = '$NINJA'

[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'
CROSS

echo "== configuring =="
NINJA="$NINJA" "$MESON" setup "$WORK/cairo-build" "$WORK/$CAIRO" \
  --cross-file "$WORK/android-arm64.ini" --prefix "$OUT" --libdir lib \
  --buildtype release --default-library static -Db_pie=true -Db_staticpic=true \
  --force-fallback-for=freetype2,libpng,pixman \
  -Dfontconfig=disabled -Dfreetype=enabled -Dpng=enabled -Dzlib=enabled \
  -Dxlib=disabled -Dxcb=disabled -Dglib=disabled -Dtests=disabled \
  -Dspectre=disabled -Dsymbol-lookup=disabled -Dgtk_doc=false \
  -Dfreetype2:harfbuzz=disabled -Dfreetype2:brotli=disabled \
  -Dfreetype2:bzip2=disabled -Dfreetype2:png=disabled \
  -Dpixman:tests=disabled -Dpixman:demos=disabled
echo "== building =="
"$NINJA" -C "$WORK/cairo-build"
echo "== installing =="
"$MESON" install --no-rebuild -C "$WORK/cairo-build" >/dev/null
ls -l "$OUT/lib"/*.a
