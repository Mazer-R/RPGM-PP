#!/bin/sh
# Runs on the handheld: logic step and frame preparation with a real Canvas 2D
# library (text, gauges and the lighting mask are really painted) and a
# do-nothing WebGL context, per map and overlay setting.
cd /opt/rpgmv-lab || exit 1
export NODE_PATH="$PWD/node_modules" LAB_TIMEOUT=900 LAB_STEPS="${LAB_STEPS:-600}" LAB_CANVAS=1 LAB_FAKEGL=1
run() { # label map x y options cull
  line=$(LAB_CULL_OVERLAY=event-culling-v3.js LAB_CULL_OPTS="$5" ./node --expose-gc minimal/run.js www "$2" "$3" "$4" 600 $6 2>/dev/null | tail -n 1)
  echo "RESULT $1 $line"
}
run "map10-none" 10 8 6 '{}' ""
for map in "110 28 35" "184 45 50"; do
  set -- $map
  run "map$1-none"      "$1" "$2" "$3" '{}' ""
  run "map$1-v3-light1" "$1" "$2" "$3" '{"lazyRefresh":true,"lightEvery":1}' 4
  run "map$1-v3-light3" "$1" "$2" "$3" '{"lazyRefresh":true,"lightEvery":3}' 4
done
echo "== memory =="; free -m | sed -n 2p
echo "== done =="
