#!/bin/sh
# Runs on the handheld: shows the game on the screen. The lab runner executes
# the game's own scripts in Node, draws each frame on the CPU with a real
# Canvas 2D library, and sends it to the screen through lab/screen. The muOS
# menu is paused meanwhile and resumed afterwards.
#
# Usage: device-show-map.sh <map-id> <x> <y> <seconds> [light-every]
# Slow by design: CPU drawing and the lighting plugin's canvas painting are
# exactly what the real player replaces. This is for looking at the picture.
cd /opt/rpgmv-lab || exit 1
MAP="$1"; X="$2"; Y="$3"; SECONDS_ON_MAP="$4"; LIGHT="${5:-3}"

FRONTEND=$(pgrep -f /opt/muos/script/mux/frontend.sh | head -n 1)
MODULE=$(pgrep -f '^/opt/muos/extra/mux' | head -n 1)
resume() {
  [ -n "$MODULE" ] && kill -CONT "$MODULE" 2>/dev/null
  [ -n "$FRONTEND" ] && kill -CONT "$FRONTEND" 2>/dev/null
}
trap resume EXIT INT TERM
[ -n "$FRONTEND" ] && kill -STOP "$FRONTEND"
[ -n "$MODULE" ] && kill -STOP "$MODULE"

export SDL_HQ_SCALER=2 SDL_ROTATION=0 SDL_BLITTER_DISABLED=1 SDL_ASSERT=always_ignore
export NODE_PATH="$PWD/node_modules" LAB_TIMEOUT=900 LAB_CANVAS=1 LAB_PRESENT="$PWD/screen/labgl.node"
export LAB_CULL_OVERLAY=event-culling-v3.js LAB_CULL_OPTS="{\"lazyRefresh\":true,\"lightEvery\":$LIGHT}"
echo "== showing map $MAP on the screen for $SECONDS_ON_MAP s =="
./node --expose-gc minimal/run.js www "$MAP" "$X" "$Y" "$SECONDS_ON_MAP" 4 2>/dev/null | tail -n 1
