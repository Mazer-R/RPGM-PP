#!/bin/sh
# Compiles and links smoke_test.cc for 64-bit ARM Android (API 26) against
# the V8 library produced by build-android.sh, with the NDK's clang and the
# NDK's libc++. Meant to run inside the image built from Dockerfile.android,
# with the same folders mounted:
#   /work/tools this folder, /work/out the V8 headers and library.
#
# It only proves that the program links; an Android program cannot run in
# this image. To run it, copy /work/out/smoke_test to a device or emulator
# (for example under /data/local/tmp) and start it there. The binary carries
# libc++ inside it (-static-libstdc++), so that one file is all it needs.
# A second link against the shared libc++ (libc++_shared.so, the usual
# choice for an app) is made as well and then discarded.
set -eu
NDK="${ANDROID_NDK_ROOT:-/opt/android-ndk}"
CXX="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/clang++"
link() {
  out="$1"; shift
  "$CXX" --target=aarch64-linux-android26 -std=c++20 -O2 \
      -I/work/out/include /work/tools/smoke_test.cc -o "$out" \
      -L/work/out/lib -lv8_monolith -llog -ldl "$@"
}
link /work/out/smoke_test -static-libstdc++
link /tmp/smoke_test_shared
echo "linked with libc++ inside the binary and with libc++_shared.so"
ls -l /work/out/smoke_test
