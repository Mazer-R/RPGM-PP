#!/bin/sh
# Copies the built player and a script to the handheld over adb, runs the
# script there with the muOS menu paused, resumes the menu, and prints the
# player's exit code and log.
#
# Usage: tools/deploy.sh <script.js>          (run from the player/ folder)
# Needs: adb on PATH or in $ADB, the handheld connected with USB in ADB mode,
#        and the player built in build-device/.
set -eu
ADB="${ADB:-adb}"
SCRIPT="$1"
REMOTE=/opt/mvplayer
NAME=$(basename "$SCRIPT")

"$ADB" shell "mkdir -p $REMOTE"
"$ADB" push build-device/mvplayer "$REMOTE/mvplayer" >/dev/null
"$ADB" push "$SCRIPT" "$REMOTE/$NAME" >/dev/null

# The menu is paused with SIGSTOP so it stops drawing, and always resumed.
"$ADB" shell "
  cd $REMOTE && chmod +x mvplayer
  FRONTEND=\$(pgrep -f /opt/muos/script/mux/frontend.sh | head -n 1)
  MODULE=\$(pgrep -f '^/opt/muos/extra/mux' | head -n 1)
  [ -n \"\$FRONTEND\" ] && kill -STOP \$FRONTEND
  [ -n \"\$MODULE\" ] && kill -STOP \$MODULE
  export SDL_HQ_SCALER=2 SDL_ROTATION=0 SDL_BLITTER_DISABLED=1 SDL_ASSERT=always_ignore
  timeout 120 ./mvplayer $NAME --log $REMOTE/mvplayer.log
  CODE=\$?
  [ -n \"\$MODULE\" ] && kill -CONT \$MODULE
  [ -n \"\$FRONTEND\" ] && kill -CONT \$FRONTEND
  echo \"player exit code: \$CODE\"
  echo '--- log ---'
  cat $REMOTE/mvplayer.log
" | tr -d '\r'
