#!/bin/sh
# Starts the player with the libraries shipped next to it.
#
#   ./mvplayer.sh                     show the list of games, the ones played
#                                     last first; its "add a game" line lets
#                                     you look through folders for a game
#   ./mvplayer.sh <path>              play the game at <path>
#   ./mvplayer.sh --install-launcher  add "RPG Maker MV Player" to the
#                                     desktop's application menu
#   ./mvplayer.sh --check-libs        list the libraries the system is missing
#   ./mvplayer.sh --<option> ...      anything else goes to the player as it is
#
# <path> may be the game's www folder (the one with index.html), the folder
# that holds it, or the game's .exe. The games played or added through the
# list are remembered in ~/.config/mvplayer/games.txt, one folder per line;
# a line starting with "-" is a game taken off the list (Delete key).
#
# A copy of the log of every run is kept in the logs/ folder next to this
# script (or in ~/.config/mvplayer/logs if that cannot be written), named
# after the game and the time: the place to look when a game misbehaves.
#
# Videos play if the system has the ffmpeg program installed; without it the
# game goes on as if each video had ended at once.
#
# Set MVPLAYER_SYSTEM_LIBS=1 to ignore the lib/ folder and use the system's
# own SDL2, Cairo and FreeType instead.
HERE=$(dirname -- "$(readlink -f -- "$0")")
if [ "${MVPLAYER_SYSTEM_LIBS:-0}" != 1 ]; then
  # The player starts the system's ffmpeg to play videos; that program must
  # get the library search path as it was, without the lib/ folder.
  MVPLAYER_SYSTEM_LIBRARY_PATH="${LD_LIBRARY_PATH:-}"
  export MVPLAYER_SYSTEM_LIBRARY_PATH
  LD_LIBRARY_PATH="$HERE/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export LD_LIBRARY_PATH
fi
PLAYER="$HERE/mvplayer"
LIBRARY="${XDG_CONFIG_HOME:-$HOME/.config}/mvplayer/games.txt"

# Keeps a copy of the log of the game that has just run in the logs folder,
# named after the game and the time, with the way the player ended as its
# last line; only the newest 30 copies are kept. The game's own
# save/mvplayer.log is left where it is.
keep_log() {
  [ -f "$1/save/mvplayer.log" ] || return 0
  mkdir -p "$LOGS" || return 0
  NAME=$(printf '%s' "$(basename "$(dirname "$1")")" | tr -c 'A-Za-z0-9._-' '_')
  COPY="$LOGS/$(date +%Y%m%d-%H%M%S)-$NAME.log"
  cp "$1/save/mvplayer.log" "$COPY" && echo "launcher: the player ended with exit code $2" >>"$COPY"
  ls -1t "$LOGS"/*.log 2>/dev/null | tail -n +31 | while IFS= read -r OLD; do rm -f "$OLD"; done
}
LOGS="$HERE/logs"
mkdir -p "$LOGS" 2>/dev/null && [ -w "$LOGS" ] || LOGS="${XDG_CONFIG_HOME:-$HOME/.config}/mvplayer/logs"

# Runs one game and keeps its log. Returns the player's exit code.
play() {
  WWW=$("$PLAYER" --resolve "$1")
  "$PLAYER" --game "$@"
  CODE=$?
  [ -n "$WWW" ] && keep_log "$WWW" "$CODE"
  return "$CODE"
}

case "${1:-}" in
  --check-libs)
    MISSING=$(ldd "$PLAYER" "$HERE"/lib/*.so* 2>&1 | grep "not found" | sort -u)
    if [ -n "$MISSING" ]; then
      echo "Missing libraries (install them with the system's package manager):"
      echo "$MISSING"
      exit 1
    fi
    echo "All libraries found."
    exit 0 ;;
  --install-launcher)
    APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    mkdir -p "$APPS"
    printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=RPG Maker MV Player' \
      'Comment=Play RPG Maker MV games without their bundled browser' \
      "Exec=\"$HERE/mvplayer.sh\" %f" 'Terminal=false' 'Categories=Game;' > "$APPS/mvplayer.desktop"
    echo "Added $APPS/mvplayer.desktop"
    exit 0 ;;
  -*) exec "$PLAYER" "$@" ;;
  ?*) play "$@"; exit $? ;;
esac

# No arguments: the list of games, then the chosen game, then the list again.
# The list keeps the games in $LIBRARY itself: the ones played last first,
# and the ones added through its "add a game" line.
mkdir -p "$(dirname "$LIBRARY")"
while :; do
  ANSWER=$("$PLAYER" --pick --games-file "$LIBRARY" --can-add --browse "$HOME" --browse /)
  case "$ANSWER" in
    *MVPLAYER_GAME=*) GAME=$(printf '%s\n' "$ANSWER" | sed -n 's/^MVPLAYER_GAME=//p' | head -n 1) ;;
    *) exit 0 ;;
  esac
  play "$GAME"
done
