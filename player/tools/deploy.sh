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
REMOTE=/opt/potato-player
NAME=$(basename "$SCRIPT")

"$ADB" shell "mkdir -p $REMOTE"
"$ADB" push build-device/potato-player "$REMOTE/potato-player" >/dev/null
"$ADB" push "$SCRIPT" "$REMOTE/$NAME" >/dev/null

# The menu is paused with SIGSTOP so it stops drawing, and always resumed.
"$ADB" shell "
  cd $REMOTE && chmod +x potato-player
  # Matched by process name, not by command line: a command-line match also
  # finds this very shell, whose command line contains the same text.
  FRONTEND=\$(pgrep -x frontend.sh | head -n 1)
  MODULE=\$(pgrep '^mux' | head -n 1)
  [ -n \"\$FRONTEND\" ] && kill -STOP \$FRONTEND
  [ -n \"\$MODULE\" ] && kill -STOP \$MODULE
  export SDL_HQ_SCALER=2 SDL_ROTATION=0 SDL_BLITTER_DISABLED=1 SDL_ASSERT=always_ignore
  # TERM after two minutes, KILL five seconds later if it is still there.
  timeout -k 5 120 ./potato-player $NAME --log $REMOTE/potato-player.log
  CODE=\$?
  [ -n \"\$MODULE\" ] && kill -CONT \$MODULE
  [ -n \"\$FRONTEND\" ] && kill -CONT \$FRONTEND
  echo \"player exit code: \$CODE\"
  echo '--- log ---'
  cat $REMOTE/potato-player.log
" | tr -d '\r'
