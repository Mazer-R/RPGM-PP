#!/bin/sh
# Fetches a pinned V8 version and builds it as one static library for 64-bit
# ARM Linux. Meant to run inside the image built from the Dockerfile next to
# this script, with:
#   /work/src   a persistent folder for the V8 checkout and build output
#   /work/tools this folder (read-only)
#   /work/out   where the headers, the library and a build record are placed
set -eu

V8_VERSION="${V8_VERSION:-12.4.254.21}"   # the V8 line shipped in Node 22
JOBS="${JOBS:-$(nproc)}"
SRC=/work/src
OUT=/work/out

# Run gclient with the system Python; depot_tools' own wrappers expect a
# bootstrap that this image does not perform.
gclient() { /usr/bin/python3 /opt/depot_tools/gclient.py "$@"; }

mkdir -p "$SRC" "$OUT"
cd "$SRC"

if [ ! -d v8/.git ]; then
  echo "== fetching V8 $V8_VERSION =="
  gclient config --name v8 --unmanaged https://chromium.googlesource.com/v8/v8.git
fi
# No hooks: the hooks download an x86 compiler and sysroots that are not used.
gclient sync --nohooks --no-history --revision "v8@$V8_VERSION" --jobs "$JOBS"

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
python3 build/util/lastchange.py -o build/util/LASTCHANGE

echo "== generating the build =="
mkdir -p out/player
cp /work/tools/args.gn out/player/args.gn
gn gen out/player

echo "== building v8_monolith with $JOBS jobs =="
ninja -C out/player -j "$JOBS" v8_monolith

echo "== collecting output =="
rm -rf "$OUT/include" "$OUT/lib"
mkdir -p "$OUT/lib"
cp -r include "$OUT/include"
cp out/player/obj/libv8_monolith.a "$OUT/lib/"
{
  echo "V8 version: $V8_VERSION"
  echo "Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Compiler: $(g++ --version | head -n 1)"
  echo "Host: $(uname -m) $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "--- args.gn ---"
  cat out/player/args.gn
} > "$OUT/BUILD_RECORD.txt"
ls -l "$OUT/lib/libv8_monolith.a"
echo "== done =="
