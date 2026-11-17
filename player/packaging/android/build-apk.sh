#!/bin/sh
# Makes the installable Android package (build-android/mvplayer.apk) from the
# native libraries built by tools/build/build-android.sh. It uses the Android
# SDK's own tools directly (aapt2, d8, zipalign, apksigner) and a Java
# compiler; no Gradle and no downloads.
#
# The package holds: SDL's Java classes and PlayerActivity, libmain.so and
# libSDL2.so, the video decoder built by tools/build/build-android-ffmpeg.sh
# (as libffmpeg.so), and the player's js/ and patches/ as assets, with a manifest
# (build stamp, then one path per line) that the program uses to unpack them.
#
# It is signed with a throw-away debug key made on first use in
# build-android/debug.keystore: good for installing on one's own devices,
# not for publishing.
#
#   ANDROID_SDK  the SDK folder (default ~/Library/Android/sdk)
# Install with: adb install -r build-android/mvplayer.apk
set -eu
HERE=$(cd "$(dirname "$0")/../.." && pwd)
SDK="${ANDROID_SDK:-$HOME/Library/Android/sdk}"
TOOLS=$(ls -d "$SDK"/build-tools/35.* | tail -n 1)
PLATFORM="$SDK/platforms/android-35/android.jar"
WORK="$HERE/build-android"
SDL_JAVA=$(ls -d "$WORK"/SDL2-*/android-project/app/src/main/java | tail -n 1)
STAGE="$WORK/apk"

rm -rf "$STAGE"
mkdir -p "$STAGE/classes" "$STAGE/dex" "$STAGE/root/lib/arm64-v8a" "$STAGE/root/assets"

echo "== Java =="
find "$SDL_JAVA" "$HERE/packaging/android/java" -name '*.java' > "$STAGE/sources.txt"
javac -nowarn -Xlint:-options --release 8 -cp "$PLATFORM" -d "$STAGE/classes" @"$STAGE/sources.txt"
find "$STAGE/classes" -name '*.class' > "$STAGE/classes.txt"
"$TOOLS/d8" --release --min-api 26 --lib "$PLATFORM" --output "$STAGE/dex" @"$STAGE/classes.txt"

echo "== contents =="
cp "$WORK/native/libmain.so" "$WORK/native/sdl2/libSDL2.so" "$STAGE/root/lib/arm64-v8a/"
# The video decoder is a program, not a library, but only files named
# lib*.so in this folder are unpacked where the app may start them.
cp "$HERE/third_party/android-deps/bin/ffmpeg" "$STAGE/root/lib/arm64-v8a/libffmpeg.so"
STRIP=$(ls "$SDK"/ndk/*/toolchains/llvm/prebuilt/*/bin/llvm-strip | tail -n 1)
"$STRIP" --strip-unneeded "$STAGE/root/lib/arm64-v8a/"*.so
cp -R "$HERE/js" "$HERE/patches" "$STAGE/root/assets/"
cp "$STAGE/dex/classes.dex" "$STAGE/root/"
(
  cd "$STAGE/root/assets"
  FILES=$(find js patches -type f | LC_ALL=C sort)
  # The stamp changes whenever any unpacked file or the program changes.
  { cat $FILES; cat ../lib/arm64-v8a/libmain.so; } | shasum -a 256 | cut -d ' ' -f 1 > manifest.txt
  echo "$FILES" >> manifest.txt
)

echo "== package =="
"$TOOLS/aapt2" link -o "$STAGE/base.apk" -I "$PLATFORM" \
  --manifest "$HERE/packaging/android/AndroidManifest.xml"
cp "$STAGE/base.apk" "$STAGE/unaligned.apk"
(cd "$STAGE/root" && zip -q -r "$STAGE/unaligned.apk" classes.dex lib assets)
rm -f "$WORK/mvplayer.apk"
"$TOOLS/zipalign" -P 16 4 "$STAGE/unaligned.apk" "$WORK/mvplayer.apk"

KEY="$WORK/debug.keystore"
if [ ! -f "$KEY" ]; then
  keytool -genkeypair -keystore "$KEY" -storepass android -keypass android -alias debug \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=mvplayer debug" >/dev/null 2>&1
fi
"$TOOLS/apksigner" sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android "$WORK/mvplayer.apk"
"$TOOLS/apksigner" verify "$WORK/mvplayer.apk"
ls -l "$WORK/mvplayer.apk"
