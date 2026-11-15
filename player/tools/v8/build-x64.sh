#!/bin/sh
# Builds the pinned V8 version as one static library for x86-64 Linux,
# cross-compiling from a 64-bit ARM host. Meant to run inside the image built
# from Dockerfile.x64 next to this script, with:
#   /work/src   a persistent folder for the V8 checkout and build output
#               (the same one the ARM build uses; this build only writes to
#               its own output folder, out/x64.release)
#   /work/tools this folder (read-only)
#   /work/out   where the headers, the library and a build record are placed
#
# The build runs x86-64 programs it has just compiled (see args-x64.gn), so
# the machine must be able to execute them through emulation.
set -eu

V8_VERSION="${V8_VERSION:-12.4.254.21}"   # the V8 line shipped in Node 22
JOBS="${JOBS:-$(nproc)}"
SRC=/work/src
OUT=/work/out
BUILD_DIR=out/x64.release
CROSS=x86_64-linux-gnu

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

# The cross compiler; read by the toolchain that args-x64.gn selects with
# custom_toolchain.
export CC="$CROSS-gcc" CXX="$CROSS-g++" AR="$CROSS-ar" NM="$CROSS-nm"

# Fail early, with a clear message, if x86-64 programs cannot be executed.
echo 'int main() { return 0; }' > /tmp/emulation_check.c
$CC -o /tmp/emulation_check /tmp/emulation_check.c
/tmp/emulation_check || { echo "this machine cannot run x86-64 programs; enable Rosetta or qemu-user emulation" >&2; exit 1; }

echo "== generating the build =="
mkdir -p "$BUILD_DIR"
cp /work/tools/args-x64.gn "$BUILD_DIR/args.gn"
gn gen "$BUILD_DIR"

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
  echo "Target compiler: $($CXX --version | head -n 1)"
  echo "Host compiler: $(g++ --version | head -n 1)"
  echo "Host: $(uname -m) $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "--- args.gn ---"
  cat "$BUILD_DIR/args.gn"
} > "$OUT/BUILD_RECORD.txt"
ls -l "$OUT/lib/libv8_monolith.a"
echo "== done =="
