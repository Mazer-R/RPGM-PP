#!/bin/sh
# Runs on the handheld: time PIXI's WebGL renderer preparing each frame over a
# do-nothing WebGL context, together with the logic step, per map.
cd /opt/rpgmv-lab || exit 1
export LAB_IMAGE_SIZES="$PWD/image-sizes.json" LAB_TIMEOUT=900 LAB_STEPS="${LAB_STEPS:-700}" LAB_FAKEGL=1
run() { # label map x y overlay options cull
  line=$(LAB_CULL_OVERLAY="$5" LAB_CULL_OPTS="$6" ./node --expose-gc minimal/run.js www "$2" "$3" "$4" 600 $7 2>/dev/null | tail -n 1)
  echo "RESULT $1 $line"
}
for map in "10 8 6" "110 28 35" "184 45 50"; do
  set -- $map
  run "map$1-nocull" "$1" "$2" "$3" event-culling-v3.js '{}' ""
  run "map$1-v3"     "$1" "$2" "$3" event-culling-v3.js '{"lazyRefresh":true,"lightEvery":3}' 4
done
echo "== done =="
