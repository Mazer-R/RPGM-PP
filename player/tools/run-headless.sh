#!/bin/sh
# Runs a game with the ARM build of the player on the build machine, with no
# screen and no console attached, and prints the player's exit code and log.
# See tools/build/Dockerfile.headless for what this can and cannot show.
#
# Usage: tools/run-headless.sh <game-www-dir> [watch-script.js]
#        (run from the player/ folder; needs the mvp-player-headless image)
# The game folder is not written to: the game runs on a copy of its save
# folder that is thrown away. $PLAYER_OPTIONS is passed to the player.
# $SAVES names a folder whose files are added to that copy, to run a game
# from saves that are not in the game folder.
set -eu
GAME=$(cd "$1" && pwd)
WATCH="${2:-}"
RUN=""
MOUNT=""
if [ -n "$WATCH" ]; then
  WATCH_DIR=$(cd "$(dirname "$WATCH")" && pwd)
  MOUNT="-v $WATCH_DIR:/watch:ro"
  RUN="--run /watch/$(basename "$WATCH")"
fi
# shellcheck disable=SC2086
if [ -n "${SAVES:-}" ]; then MOUNT="$MOUNT -v $(cd "$SAVES" && pwd):/saves:ro"; fi
# shellcheck disable=SC2086
docker run --rm -v "$PWD":/work/player:ro -v "$GAME":/game-ro:ro $MOUNT mvp-player-headless sh -c "
  # Everything of the game is linked from the read-only folder except save/.
  mkdir -p /game/save && cd /game-ro
  for ENTRY in *; do [ \"\$ENTRY\" = save ] || ln -s \"/game-ro/\$ENTRY\" \"/game/\$ENTRY\"; done
  cp -r /game-ro/save/. /game/save/ 2>/dev/null || true
  [ -d /saves ] && cp -r /saves/. /game/save/
  rm -f /game/save/potato-player.log
  mkdir /p && cp /work/player/build-device/potato-player /p/ && cp -r /work/player/js /work/player/patches /p/
  cd /p
  # The player takes the whole of this small screen, as it does on a handheld.
  POTATO_PLAYER_FULLSCREEN=1 xvfb-run -a -s '-screen 0 640x480x24' timeout -k 5 ${PLAY_SECONDS:-120} ./potato-player --game /game $RUN ${PLAYER_OPTIONS:-}
  echo \"player exit code: \$?\"
  echo '--- log ---'
  cat /game/save/potato-player.log
"
