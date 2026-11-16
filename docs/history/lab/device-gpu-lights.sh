#!/bin/sh
# Runs on the handheld: logic step and frame preparation with a real Canvas 2D
# library and a do-nothing WebGL context, with the lighting plugin's mask
# painted on the canvas (as shipped) or handed to WebGL by the GPU-lights
# overlay, with and without the third culling overlay.
cd /opt/rpgmv-lab || exit 1
export NODE_PATH="$PWD/node_modules" LAB_TIMEOUT=900 LAB_STEPS="${LAB_STEPS:-600}" LAB_CANVAS=1 LAB_FAKEGL=1 LAB_CANVAS_PROFILE=1
run() { # label map x y gpu-lights(0|1) cull-options cull-margin
  line=$(LAB_GPU_LIGHTS="$5" LAB_CULL_OVERLAY=event-culling-v3.js LAB_CULL_OPTS="$6" ./node --expose-gc minimal/run.js www "$2" "$3" "$4" 600 $7 2>/dev/null | tail -n 1)
  echo "RESULT $1 $line"
}
for map in "10 8 6" "110 28 35" "184 45 50"; do
  set -- $map
  run "map$1-canvas-lights"     "$1" "$2" "$3" "" '{}' ""
  run "map$1-gpu-lights"        "$1" "$2" "$3" 1  '{}' ""
  run "map$1-gpu-lights-cullv3" "$1" "$2" "$3" 1  '{"lazyRefresh":true,"lightEvery":1}' 4
done
echo "== done =="
