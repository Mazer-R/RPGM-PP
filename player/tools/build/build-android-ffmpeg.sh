#!/bin/sh
# Builds the video decoder the Android app carries: the ffmpeg program, for
# arm64-v8a, cut down to what the player asks of it. Android has no ffmpeg
# of its own, and an app may only start programs that came in its package's
# library folder, so the APK holds this one there as libffmpeg.so
# (packaging/android/build-apk.sh) and the player starts it as it starts
# the system's ffmpeg elsewhere (src/platform/video.cpp).
#
# Runs on the build machine itself (macOS or Linux) with the Android NDK;
# the result is third_party/android-deps/bin/ffmpeg.
#
# Usage: sh tools/build/build-android-ffmpeg.sh
#   ANDROID_NDK  the NDK folder (default: the r27 one under ~/Library/Android/sdk)
#
# What is left in: reading WebM, MP4 and Ogg files; the VP8, VP9, H.264,
# H.265 (without it this FFmpeg's H.264 decoder does not link) and Theora
# pictures and the Vorbis, Opus, AAC and MP3 sound found in them;
# resizing; and writing raw pictures and raw sound to pipes. Nothing is
# encoded, and no part under the GPL or a patent-encumbered external
# library is built in: the program stays under the LGPL 2.1 or later.
#
# FFmpeg's source is downloaded once to build-android/dl and checked against
# the SHA-256 below.
set -eu
HERE=$(cd "$(dirname "$0")/../.." && pwd)
NDK="${ANDROID_NDK:-$HOME/Library/Android/sdk/ndk/27.1.12297006}"
API=26
FFMPEG=ffmpeg-7.1.1
FFMPEG_SHA=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1

TOOLS=$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/bin | head -n 1)
WORK="$HERE/build-android"
OUT="$HERE/third_party/android-deps"
mkdir -p "$WORK/dl" "$OUT/bin"

if [ ! -f "$WORK/dl/$FFMPEG.tar.xz" ]; then
  curl -sSL -o "$WORK/dl/$FFMPEG.tar.xz" "https://ffmpeg.org/releases/$FFMPEG.tar.xz"
fi
echo "$FFMPEG_SHA  $WORK/dl/$FFMPEG.tar.xz" | shasum -a 256 -c -
[ -d "$WORK/$FFMPEG" ] || tar -xf "$WORK/dl/$FFMPEG.tar.xz" -C "$WORK"

echo "== configuring =="
rm -rf "$WORK/ffmpeg-build"
mkdir -p "$WORK/ffmpeg-build"
cd "$WORK/ffmpeg-build"
"$WORK/$FFMPEG/configure" \
  --target-os=android --arch=aarch64 --enable-cross-compile \
  --cc="$TOOLS/aarch64-linux-android$API-clang" \
  --cxx="$TOOLS/aarch64-linux-android$API-clang++" \
  --ar="$TOOLS/llvm-ar" --nm="$TOOLS/llvm-nm" --ranlib="$TOOLS/llvm-ranlib" \
  --strip="$TOOLS/llvm-strip" \
  --enable-pic --enable-static --disable-shared --enable-small \
  --disable-everything --disable-autodetect --disable-doc --disable-debug \
  --disable-ffplay --disable-ffprobe --disable-network \
  --disable-avdevice --disable-postproc \
  --enable-protocol=file,pipe \
  --enable-demuxer=matroska,mov,ogg \
  --enable-parser=vp8,vp9,h264,hevc,aac,opus,vorbis,mpegaudio,theora \
  --enable-decoder=vp8,vp9,h264,hevc,theora,vorbis,opus,aac,mp3 \
  --enable-filter=scale,pad,fps,format,aresample,aformat,null,anull \
  --enable-encoder=rawvideo,pcm_s16le \
  --enable-muxer=rawvideo,pcm_s16le \
  --extra-ldflags="-Wl,-z,max-page-size=16384"

echo "== building =="
make -j"$(getconf _NPROCESSORS_ONLN)" ffmpeg
"$TOOLS/llvm-strip" -o "$OUT/bin/ffmpeg" ffmpeg

echo "== result =="
ls -l "$OUT/bin/ffmpeg"
file "$OUT/bin/ffmpeg"
