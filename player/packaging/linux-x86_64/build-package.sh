#!/bin/sh
# Builds the Linux x86-64 package of the player: a folder with the player,
# its JavaScript layer, the per-game patches, the shared libraries a desktop
# may not have in a compatible version, a start script and a README, and the
# same folder as a .tar.gz. Then checks the result.
#
# Meant to run inside the image built from tools/build/Dockerfile.x64 (it
# needs the amd64 libraries and the x86-64 binutils), with the `player/`
# folder mounted at /work/player, after tools/build/build-x64.sh.
#
# Result, under build-x64/:
#   package/mvplayer-linux-x86_64/     the folder
#   mvplayer-linux-x86_64.tar.gz       the same, as an archive
set -eu
cd /work/player
NAME=mvplayer-linux-x86_64
OUT=build-x64
DIR="$OUT/package/$NAME"
READELF=x86_64-linux-gnu-readelf
OBJDUMP=x86_64-linux-gnu-objdump
LIBDIRS="/usr/lib/x86_64-linux-gnu /lib/x86_64-linux-gnu"
MAX_GLIBC=2.36   # Debian bookworm's; the binary must not need a newer one

[ -x "$OUT/mvplayer" ] || { echo "$OUT/mvplayer is missing: build the player first" >&2; exit 1; }

# Libraries that must come from the machine the player runs on, because they
# belong to its C and C++ runtime, its graphics driver, its display server
# or its sound and font services. They are neither bundled nor followed.
from_system() {
  case "$1" in
    ld-linux-*|libc.so.*|libm.so.*|libdl.so.*|libpthread.so.*|librt.so.*) return 0 ;;
    libstdc++.so.*|libgcc_s.so.*) return 0 ;;
    libGL.so.*|libGLESv2.so.*|libEGL.so.*|libGLdispatch.so.*|libOpenGL.so.*) return 0 ;;
    libdrm.so.*|libgbm.so.*) return 0 ;;
    libX*.so.*|libxcb*.so.*|libwayland-*.so.*|libxkbcommon.so.*|libdecor-0.so.*) return 0 ;;
    libasound.so.*|libpulse*.so.*|libfontconfig.so.*|libz.so.*) return 0 ;;
  esac
  return 1
}

needed() { $READELF -d "$1" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'; }

find_lib() {
  for D in $LIBDIRS; do
    [ -e "$D/$1" ] && { echo "$D/$1"; return 0; }
  done
  return 1
}

rm -rf "$OUT/package" "$OUT/$NAME.tar.gz"
mkdir -p "$DIR/js" "$DIR/patches" "$DIR/lib"
cp "$OUT/mvplayer" "$DIR/mvplayer"
cp js/*.js "$DIR/js/"
cp patches/* "$DIR/patches/"
cp packaging/linux-x86_64/mvplayer.sh packaging/linux-x86_64/README.txt "$DIR/"
chmod 755 "$DIR/mvplayer" "$DIR/mvplayer.sh"

# Bundle every library the player needs, directly or through another bundled
# library, except those that come from the system. SYSTEM collects the
# latter, for the report.
SYSTEM=""
QUEUE="$DIR/mvplayer"
while [ -n "$QUEUE" ]; do
  NEXT=""
  for FILE in $QUEUE; do
    for LIB in $(needed "$FILE"); do
      if from_system "$LIB"; then
        case " $SYSTEM " in *" $LIB "*) ;; *) SYSTEM="$SYSTEM $LIB" ;; esac
        continue
      fi
      [ -e "$DIR/lib/$LIB" ] && continue
      SOURCE=$(find_lib "$LIB") || { echo "cannot find $LIB" >&2; exit 1; }
      cp -L "$SOURCE" "$DIR/lib/$LIB"
      chmod 644 "$DIR/lib/$LIB"
      NEXT="$NEXT $DIR/lib/$LIB"
    done
  done
  QUEUE="$NEXT"
done

tar -czf "$OUT/$NAME.tar.gz" --owner=0 --group=0 -C "$OUT/package" "$NAME"

echo "== package contents =="
tar -tzvf "$OUT/$NAME.tar.gz"

echo "== checks =="
FAILED=0
file "$DIR/mvplayer"
file "$DIR/mvplayer" | grep -q "ELF 64-bit LSB.*x86-64" || { echo "FAIL: not an x86-64 ELF"; FAILED=1; }

echo "needed by mvplayer: $(needed "$DIR/mvplayer" | tr '\n' ' ')"
echo "bundled: $(ls "$DIR/lib" | tr '\n' ' ')"
echo "expected from the system: $(echo $SYSTEM | tr ' ' '\n' | sort | tr '\n' ' ')"
for FILE in "$DIR/mvplayer" "$DIR"/lib/*; do
  for LIB in $(needed "$FILE"); do
    from_system "$LIB" || [ -e "$DIR/lib/$LIB" ] || { echo "FAIL: $LIB (needed by $FILE) is not bundled"; FAILED=1; }
  done
done

# Highest version of each versioned runtime the player and the bundled
# libraries ask for.
highest() { $OBJDUMP -T "$DIR/mvplayer" "$DIR"/lib/* | grep -o "$1_[0-9][0-9.]*" | sed "s/$1_//" | sort -V | tail -n 1; }
GLIBC=$(highest GLIBC)
echo "highest GLIBC version required: $GLIBC (limit $MAX_GLIBC)"
[ "$(printf '%s\n' "$GLIBC" "$MAX_GLIBC" | sort -V | tail -n 1)" = "$MAX_GLIBC" ] || { echo "FAIL: needs a newer glibc than $MAX_GLIBC"; FAILED=1; }
echo "highest GLIBCXX version required: $(highest GLIBCXX)"

# Start the packaged binary once under processor emulation, with only the
# bundled libraries on the search path besides the system's. Without
# arguments it must print its usage text and exit with 1.
if command -v qemu-x86_64-static >/dev/null; then
  set +e
  USAGE=$(cd "$DIR" && LD_LIBRARY_PATH="$PWD/lib" qemu-x86_64-static ./mvplayer 2>&1)
  CODE=$?
  set -e
  echo "emulated run without arguments: exit code $CODE"
  echo "$USAGE"
  { [ "$CODE" = 1 ] && echo "$USAGE" | grep -q "usage: mvplayer --game"; } || { echo "FAIL: unexpected result from the emulated run"; FAILED=1; }
else
  echo "qemu-x86_64-static not available: emulated run skipped"
fi

[ "$FAILED" = 0 ] || { echo "== checks FAILED =="; exit 1; }
echo "package: $OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"
echo "== checks passed =="
