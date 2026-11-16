#!/bin/sh
# Starts the player with the libraries shipped next to it.
#
#   ./mvplayer.sh                     show the list of games; the list's last
#                                     line opens a file dialog to add a game
#   ./mvplayer.sh <path>              play the game at <path>
#   ./mvplayer.sh --install-launcher  add "RPG Maker MV Player" to the
#                                     desktop's application menu
#   ./mvplayer.sh --check-libs        list the libraries the system is missing
#   ./mvplayer.sh --<option> ...      anything else goes to the player as it is
#
# <path> may be the game's www folder (the one with index.html), the folder
# that holds it, or the game's .exe. The games added through the list are
# remembered in ~/.config/mvplayer/games.txt, one folder per line.
#
# Set MVPLAYER_SYSTEM_LIBS=1 to ignore the lib/ folder and use the system's
# own SDL2, Cairo and FreeType instead.
HERE=$(dirname -- "$(readlink -f -- "$0")")
if [ "${MVPLAYER_SYSTEM_LIBS:-0}" != 1 ]; then
  LD_LIBRARY_PATH="$HERE/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export LD_LIBRARY_PATH
fi
PLAYER="$HERE/mvplayer"
LIBRARY="${XDG_CONFIG_HOME:-$HOME/.config}/mvplayer/games.txt"
# Whether games show the frames per second, as the list last left it.
SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/mvplayer/show-fps"
FPS=""
[ "$(cat "$SETTINGS" 2>/dev/null)" = 1 ] && FPS="--fps"

# Shows a message in a window when there is a dialog program, else in the terminal.
say() {
  if command -v zenity >/dev/null 2>&1; then zenity --error --title="RPG Maker MV Player" --text="$1" 2>/dev/null
  elif command -v kdialog >/dev/null 2>&1; then kdialog --title "RPG Maker MV Player" --error "$1" 2>/dev/null
  fi
  echo "$1" >&2
}

# Lets the user point at a game with the desktop's own file dialog and prints
# what was chosen; prints nothing if the dialog was closed or there is none.
ask_for_game() {
  TITLE="Choose the game's .exe (or the index.html in its www folder)"
  if command -v zenity >/dev/null 2>&1; then zenity --file-selection --title="$TITLE" 2>/dev/null
  elif command -v kdialog >/dev/null 2>&1; then kdialog --title "$TITLE" --getopenfilename "$HOME" 2>/dev/null
  else
    echo "No file dialog (zenity or kdialog) is installed. Start a game with:" >&2
    echo "  $0 /path/to/the/game" >&2
  fi
}

# Adds a game to the remembered list. Prints its www folder, or nothing.
add_game() {
  CHOSEN=$(ask_for_game)
  [ -n "$CHOSEN" ] || return 0
  WWW=$("$PLAYER" --resolve "$CHOSEN")
  if [ -z "$WWW" ]; then
    say "There is no RPG Maker MV game at: $CHOSEN"
    return 0
  fi
  mkdir -p "$(dirname "$LIBRARY")"
  grep -qxF -- "$WWW" "$LIBRARY" 2>/dev/null || printf '%s\n' "$WWW" >> "$LIBRARY"
  printf '%s\n' "$WWW"
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
  ?*) exec "$PLAYER" --game "$@" ;;
esac

# No arguments: the list of games, then the chosen game, then the list again.
while :; do
  if [ ! -s "$LIBRARY" ]; then
    # Nothing remembered yet: go straight to choosing a game.
    GAME=$(add_game)
    [ -n "$GAME" ] || exit 0
  else
    ANSWER=$("$PLAYER" --pick --games-file "$LIBRARY" --can-add $FPS)
    case "$ANSWER" in
      *MVPLAYER_FPS=1*) FPS="--fps"; mkdir -p "$(dirname "$SETTINGS")"; echo 1 > "$SETTINGS" ;;
      *MVPLAYER_FPS=0*) FPS=""; mkdir -p "$(dirname "$SETTINGS")"; echo 0 > "$SETTINGS" ;;
    esac
    case "$ANSWER" in
      *MVPLAYER_GAME=*) GAME=$(printf '%s\n' "$ANSWER" | sed -n 's/^MVPLAYER_GAME=//p' | head -n 1) ;;
      *MVPLAYER_ADD*) GAME=$(add_game); [ -n "$GAME" ] || continue ;;
      *) exit 0 ;;
    esac
  fi
  "$PLAYER" --game "$GAME" $FPS
done
