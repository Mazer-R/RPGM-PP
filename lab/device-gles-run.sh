#!/bin/sh
# Runs on the handheld: pause the muOS menu so it stops drawing, run the
# OpenGL ES timing test on the screen for a few seconds, then resume the menu.
# The menu is paused with SIGSTOP and always resumed, even if the test fails.
cd "$(dirname "$0")" || exit 1

FRONTEND=$(pgrep -f /opt/muos/script/mux/frontend.sh | head -n 1)
MODULE=$(pgrep -f '/opt/muos/extra/mux' | head -n 1)
resume() {
  [ -n "$MODULE" ] && kill -CONT "$MODULE" 2>/dev/null
  [ -n "$FRONTEND" ] && kill -CONT "$FRONTEND" 2>/dev/null
}
trap resume EXIT INT TERM
[ -n "$FRONTEND" ] && kill -STOP "$FRONTEND"
[ -n "$MODULE" ] && kill -STOP "$MODULE"
echo "paused: frontend=${FRONTEND:-none} module=${MODULE:-none}"

# Same SDL settings the system's own launch scripts use.
export SDL_HQ_SCALER=2 SDL_ROTATION=0 SDL_BLITTER_DISABLED=1 SDL_ASSERT=always_ignore
timeout 90 python3 device-gles-test.py
echo "test exit code: $?"
