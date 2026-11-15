#!/bin/sh
# Starts the player with the libraries shipped next to it.
#
#   ./mvplayer.sh --game /path/to/game/www
#   ./mvplayer.sh --check-libs      list the libraries the system is missing
#
# Set MVPLAYER_SYSTEM_LIBS=1 to ignore the lib/ folder and use the system's
# own SDL2, Cairo and FreeType instead.
HERE=$(dirname -- "$(readlink -f -- "$0")")
if [ "${MVPLAYER_SYSTEM_LIBS:-0}" != 1 ]; then
  LD_LIBRARY_PATH="$HERE/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export LD_LIBRARY_PATH
fi
if [ "${1:-}" = "--check-libs" ]; then
  MISSING=$(ldd "$HERE/mvplayer" "$HERE"/lib/*.so* 2>&1 | grep "not found" | sort -u)
  if [ -n "$MISSING" ]; then
    echo "Missing libraries (install them with the system's package manager):"
    echo "$MISSING"
    exit 1
  fi
  echo "All libraries found."
  exit 0
fi
exec "$HERE/mvplayer" "$@"
