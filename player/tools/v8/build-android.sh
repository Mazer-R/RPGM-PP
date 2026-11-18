#!/bin/sh
# Builds the pinned V8 version as one static library for 64-bit ARM Android,
# on a 64-bit ARM Linux host. Meant to run inside the image built from
# Dockerfile.android next to this script, with:
#   /work/src   a persistent folder for the V8 checkout and build output
#               (the same one the Linux builds use; this build only writes
#               to its own output folder, out/android.release, and adds one
#               Android-only dependency under third_party/)
#   /work/tools this folder (read-only)
#   /work/out   where the headers, the library and a build record are placed
#
#   V8_WEBASSEMBLY=1  builds with WebAssembly, which RPG Maker MZ games need
#                     (use a different /work/out to keep both libraries)
#
# V8 is compiled with the NDK's clang, which is an x86-64 program (see
# Dockerfile.android), so the machine must be able to execute x86-64
# programs through emulation.
set -eu

V8_VERSION="${V8_VERSION:-12.4.254.21}"   # the V8 line shipped in Node 22
JOBS="${JOBS:-$(nproc)}"
SRC=/work/src
OUT=/work/out
BUILD_DIR=out/android.release
NDK="${ANDROID_NDK_ROOT:-/opt/android-ndk}"
NDK_CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/clang++"

# Run gclient with the system Python; depot_tools' own wrappers expect a
# bootstrap that this image does not perform.
gclient() { /usr/bin/python3 /opt/depot_tools/gclient.py "$@"; }

# The version of a checkout, read from its own version header.
checkout_version() {
  sed -n -E 's/^#define V8_(MAJOR_VERSION|MINOR_VERSION|BUILD_NUMBER|PATCH_LEVEL) ([0-9]+).*/\2/p' \
    "$1/include/v8-version.h" | paste -sd . -
}

mkdir -p "$SRC" "$OUT"
cd "$SRC"

if [ -d v8/.git ] && [ "$(checkout_version v8)" = "$V8_VERSION" ]; then
  echo "== reusing the V8 $V8_VERSION checkout =="
else
  echo "== fetching V8 $V8_VERSION =="
  if [ ! -d v8/.git ]; then
    gclient config --name v8 --unmanaged https://chromium.googlesource.com/v8/v8.git
  fi
  # No hooks: the hooks download an x86 compiler and sysroots that are not used.
  gclient sync --nohooks --no-history --revision "v8@$V8_VERSION" --jobs "$JOBS"
fi

cd v8

# The one dependency V8 fetches only for Android that this build compiles:
# cpu_features, used by the bundled zlib. It is fetched here, at the revision
# V8's DEPS file pins, instead of asking gclient for the whole Android set
# (an SDK, a second NDK, test tooling: several gigabytes that go unused).
if [ ! -e third_party/cpu_features/src/ndk_compat/cpu-features.c ]; then
  cpu_features_rev="$(sed -n -E "s|.*/external/github.com/google/cpu_features.git' \+ '@' \+ '([0-9a-f]{40})'.*|\1|p" DEPS)"
  [ -n "$cpu_features_rev" ] || { echo "cpu_features revision not found in DEPS" >&2; exit 1; }
  echo "== fetching cpu_features $cpu_features_rev =="
  rm -rf third_party/cpu_features/src
  git init -q third_party/cpu_features/src
  git -C third_party/cpu_features/src fetch -q --depth 1 \
    https://chromium.googlesource.com/external/github.com/google/cpu_features.git "$cpu_features_rev"
  git -C third_party/cpu_features/src checkout -q FETCH_HEAD
fi

# Local patches, each explained in its own header comment. Applied only if
# not already present, so the script can be run again on the same checkout.
for patch in /work/tools/patches/*.patch; do
  [ -e "$patch" ] || continue
  if git apply --reverse --check "$patch" 2>/dev/null; then
    echo "patch already applied: $(basename "$patch")"
  else
    git apply "$patch"
    echo "patch applied: $(basename "$patch")"
  fi
done

# The one hook output the build needs: a file recording the checkout's date.
if [ ! -e build/util/LASTCHANGE ]; then
  python3 build/util/lastchange.py -o build/util/LASTCHANGE
fi

# Fail early, with a clear message, if x86-64 programs cannot be executed.
"$NDK_CLANG" --version > /dev/null || { echo "this machine cannot run the NDK compiler (an x86-64 program); enable Rosetta or qemu-user emulation" >&2; exit 1; }

echo "== generating the build =="
mkdir -p "$BUILD_DIR"
cp /work/tools/args-android.gn "$BUILD_DIR/args.gn"
# RPG Maker MZ games need WebAssembly (their animation library is compiled
# to it); MV games do not, and the library is smaller without it.
if [ "${V8_WEBASSEMBLY:-0}" = 1 ]; then
  sed -i 's/^v8_enable_webassembly = false$/v8_enable_webassembly = true/' "$BUILD_DIR/args.gn"
  grep -q '^v8_enable_webassembly = true$' "$BUILD_DIR/args.gn" || { echo "could not turn WebAssembly on in args.gn" >&2; exit 1; }
  echo "WebAssembly: on"
fi
# Only the library and what it depends on: other targets in V8's build files
# refer to Android test tooling that is not part of this checkout.
gn gen "$BUILD_DIR" --root-pattern="//:v8_monolith"

echo "== building v8_monolith with $JOBS jobs =="
ninja -C "$BUILD_DIR" -j "$JOBS" v8_monolith

echo "== collecting output =="
rm -rf "$OUT/include" "$OUT/lib"
mkdir -p "$OUT/lib"
cp -r include "$OUT/include"
cp "$BUILD_DIR/obj/libv8_monolith.a" "$OUT/lib/"
{
  echo "V8 version: $V8_VERSION"
  echo "Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Target compiler: $("$NDK_CLANG" --version | head -n 1)"
  echo "Android NDK: $(sed -n 's/^Pkg.Revision = //p' "$NDK/source.properties")"
  echo "C++ standard library: the NDK's libc++ (std::__ndk1)"
  echo "Host compiler: $(g++ --version | head -n 1)"
  echo "Host: $(uname -m) $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "--- args.gn ---"
  cat "$BUILD_DIR/args.gn"
} > "$OUT/BUILD_RECORD.txt"
ls -l "$OUT/lib/libv8_monolith.a"
echo "== done =="
