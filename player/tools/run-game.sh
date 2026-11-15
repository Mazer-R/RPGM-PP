#!/bin/sh
# Copies the built player and its JavaScript layer to the handheld over adb,
# runs a game that is already on the handheld with the muOS menu paused,
# resumes the menu, and prints the player's exit code and log.
#
# Usage: tools/run-game.sh <game-www-dir-on-handheld> [watch-script.js]
#        (run from the player/ folder)
# $PLAYER_OPTIONS is passed to the player, for example --no-patches.
# The player is stopped after $PLAY_SECONDS (default 120), so the menu always
# comes back; set it higher to play for longer. On the console, the menu
# button held plus Start quits the player.
# Needs: adb on PATH or in $ADB, the handheld connected with USB in ADB mode,
#        and the player built in build-device/.
# The log is the game's own save/mvplayer.log, as in normal use.
set -eu
ADB="${ADB:-adb}"
GAME="$1"
WATCH="${2:-}"
REMOTE=/opt/mvplayer
RUN=""
PLAY_SECONDS="${PLAY_SECONDS:-120}"

"$ADB" shell "mkdir -p $REMOTE/js $REMOTE/patches"
"$ADB" push build-device/mvplayer "$REMOTE/mvplayer" >/dev/null
for FILE in js/*.js patches/*; do "$ADB" push "$FILE" "$REMOTE/$FILE" >/dev/null; done
if [ -n "$WATCH" ]; then
  "$ADB" push "$WATCH" "$REMOTE/$(basename "$WATCH")" >/dev/null
  RUN="--run $REMOTE/$(basename "$WATCH")"
fi

# The menu is paused with SIGSTOP so it stops drawing, and always resumed.
"$ADB" shell "
  cd $REMOTE && chmod +x mvplayer
  # Matched by process name, not by command line: a command-line match also
  # finds this very shell, whose command line contains the same text.
  FRONTEND=\$(pgrep -x frontend.sh | head -n 1)
  MODULE=\$(pgrep '^mux' | head -n 1)
  [ -n \"\$FRONTEND\" ] && kill -STOP \$FRONTEND
  [ -n \"\$MODULE\" ] && kill -STOP \$MODULE
  export SDL_HQ_SCALER=2 SDL_ROTATION=0 SDL_BLITTER_DISABLED=1 SDL_ASSERT=always_ignore
  rm -f $GAME/save/mvplayer.log /tmp/mvplayer.rss
  # Memory in use, sampled once the game has had time to start.
  (sleep 12; grep -E 'VmRSS|VmHWM' /proc/\$(pidof mvplayer)/status > /tmp/mvplayer.rss 2>/dev/null
   # Then every five seconds: seconds since start, resident memory, free memory.
   T=12; while PID=\$(pidof mvplayer); do
     echo \"\$T s: \$(grep VmRSS /proc/\$PID/status | tr -s ' \t' ' ') | \$(grep MemAvailable /proc/meminfo | tr -s ' ' ' ')\" >> /tmp/mvplayer.rss
     sleep 5; T=\$((T+5)); done) &
  # TERM after the time limit, KILL five seconds later if it is still there.
  timeout -k 5 $PLAY_SECONDS ./mvplayer --game $GAME $RUN ${PLAYER_OPTIONS:-}
  CODE=\$?
  [ -n \"\$MODULE\" ] && kill -CONT \$MODULE
  [ -n \"\$FRONTEND\" ] && kill -CONT \$FRONTEND
  echo \"player exit code: \$CODE\"
  echo '--- memory after 12 s ---'
  cat /tmp/mvplayer.rss 2>/dev/null
  echo '--- log ---'
  cat $GAME/save/mvplayer.log
" | tr -d '\r'
