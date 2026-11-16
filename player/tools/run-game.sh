#!/bin/sh
# Copies the built player and its JavaScript layer to the handheld,
# runs a game that is already on the handheld with the muOS menu paused,
# resumes the menu, and prints the player's exit code and log.
#
# Usage: tools/run-game.sh <game-www-dir-on-handheld> [watch-script.js]
#        (run from the player/ folder)
# $PLAYER_OPTIONS is passed to the player, for example --no-patches.
# The player is stopped after $PLAY_SECONDS (default 120), so the menu always
# comes back; set it higher to play for longer. On the console, the menu
# button held plus Start quits the player.
# Needs: the player built in build-device/, and a way to reach the handheld:
#   - over USB: adb on PATH or in $ADB, the handheld in ADB mode; or
#   - over the network: $SSH_HOST set (for example root@<console-address>) and,
#     optionally, $SSH_KEY naming the private key to use.
# The log is the game's own save/mvplayer.log, as in normal use.
set -eu
ADB="${ADB:-adb}"
GAME="$1"
WATCH="${2:-}"
REMOTE=/opt/mvplayer
RUN=""
PLAY_SECONDS="${PLAY_SECONDS:-120}"

# remote <command>: runs a command on the handheld. put <file> <remote path>:
# copies a file to it.
if [ -n "${SSH_HOST:-}" ]; then
  SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=8"
  [ -n "${SSH_KEY:-}" ] && SSH="$SSH -i $SSH_KEY"
  remote() { $SSH "$SSH_HOST" "$1"; }
  put() { rsync -a -e "$SSH" "$1" "$SSH_HOST:$2"; }
else
  remote() { "$ADB" shell "$1"; }
  put() { "$ADB" push "$1" "$2" >/dev/null; }
fi

# Two players at once fight over the screen and spoil any measurement.
if [ -n "$(remote 'pidof mvplayer' | tr -d '\r')" ]; then
  echo "a player is already running on the handheld (a game or the game list); close it first" >&2
  exit 1
fi

remote "mkdir -p $REMOTE/js $REMOTE/patches"
put build-device/mvplayer "$REMOTE/mvplayer"
for FILE in js/*.js patches/*; do put "$FILE" "$REMOTE/$FILE"; done
if [ -n "$WATCH" ]; then
  put "$WATCH" "$REMOTE/$(basename "$WATCH")"
  RUN="--run $REMOTE/$(basename "$WATCH")"
fi

# The menu is paused with SIGSTOP so it stops drawing; afterwards its loop
# is resumed and the paused screen replaced by a fresh one.
remote "
  cd $REMOTE && chmod +x mvplayer
  # Matched by process name, not by command line: a command-line match also
  # finds this very shell, whose command line contains the same text.
  FRONTEND=\$(pgrep -x frontend.sh | head -n 1)
  MODULE=\$(pgrep '^mux' | head -n 1)
  [ -n \"\$FRONTEND\" ] && kill -STOP \$FRONTEND
  [ -n \"\$MODULE\" ] && kill -STOP \$MODULE
  export SDL_HQ_SCALER=2 SDL_ROTATION=0 SDL_BLITTER_DISABLED=1 SDL_ASSERT=always_ignore
  # Where muOS's sound service listens; programs started from its menu
  # inherit this, a shell that came in from outside does not.
  export XDG_RUNTIME_DIR=/var/run PIPEWIRE_RUNTIME_DIR=/var/run
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
  # The paused menu screen has every button press of the game queued up and
  # would act on all of them when resumed (moving around, even starting
  # something). It is ended instead; the menu's own loop starts a fresh one.
  [ -n \"\$MODULE\" ] && kill -KILL \$MODULE
  # The menu's loop waits for the screen it started to report a clean exit
  # (this file), then starts whatever act_go names. Without both, the loop
  # waits for ever and the screen stays on the game's last picture.
  echo launcher > /tmp/act_go
  echo 0 > /tmp/safe_quit
  [ -n \"\$FRONTEND\" ] && kill -CONT \$FRONTEND
  echo \"player exit code: \$CODE\"
  echo '--- memory after 12 s ---'
  cat /tmp/mvplayer.rss 2>/dev/null
  echo '--- log ---'
  cat $GAME/save/mvplayer.log
" | tr -d '\r'
