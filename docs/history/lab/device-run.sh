#!/bin/sh
# Runs on the handheld: measures how long the game's logic step takes there,
# using the minimal runner with drawing and audio stubbed out. No display or
# GPU is used and nothing outside this folder is touched.
#
# Expected layout (built by the development machine): this script next to
# `node`, `minimal/run.js`, `overlays/`, `www/` (scripts and data only) and
# `image-sizes.json`.
cd "$(dirname "$0")" || exit 1
SECONDS_TO_MEASURE="${LAB_SECONDS:-20}"
export LAB_IMAGE_SIZES="$PWD/image-sizes.json" LAB_TIMEOUT="${LAB_TIMEOUT:-900}"

echo "== start $(date) =="
echo "== node =="
if ! ./node --version; then
  echo "RESULT node-does-not-start"
  exit 1
fi
echo "== memory before =="; free -m 2>/dev/null | head -2

run() { # label map x y cull-margin node-flags...
  label="$1"; map="$2"; x="$3"; y="$4"; cull="$5"; shift 5
  started=$(date +%s)
  line=$(./node --expose-gc "$@" minimal/run.js www "$map" "$x" "$y" "$SECONDS_TO_MEASURE" $cull 2>/dev/null | tail -n 1)
  echo "RESULT $label wall=$(( $(date +%s) - started ))s $line"
}

run "map10-jit"          10  8  6 ""
run "map10-jitless"      10  8  6 "" --jitless
if [ -z "$LAB_QUICK" ]; then
  run "map110-jit"         110 28 35 ""
  run "map110-jitless"     110 28 35 "" --jitless
  run "map110-jit-cull"    110 28 35 4
  run "map110-jitless-cull" 110 28 35 4 --jitless
  run "map184-jit"         184 45 50 ""
  run "map184-jitless"     184 45 50 "" --jitless
  run "map184-jit-cull"    184 45 50 4
  run "map184-jitless-cull" 184 45 50 4 --jitless
fi
echo "== memory after =="; free -m 2>/dev/null | head -2
echo "== done $(date) =="
