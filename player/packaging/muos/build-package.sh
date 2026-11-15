#!/bin/sh
# Builds the muOS package of the player: a folder tree to copy onto the root
# of the handheld's SD card, and the same tree as a .tar.gz.
#
# Usage: packaging/muos/build-package.sh
#        (run from the player/ folder, after building build-device/mvplayer)
#
# The package adds one entry to muOS's Apps menu, "RPG Maker MV", which shows
# the list of games and runs the one chosen. The games themselves are not
# part of the package; see the note it writes to ROMS/RPGMV/README.txt.
#
# Result, under build-device/muos/:
#   card/MUOS/emulator/mvplayer/            the player
#   card/MUOS/application/RPG Maker MV/     its entry in the Apps menu
#   card/ROMS/RPGMV/                        one of the places games go
#   mvplayer-muos.tar.gz                    the same, to extract at the card's root
set -eu
OUT=build-device/muos
CARD="$OUT/card"
PLAYER="$CARD/MUOS/emulator/mvplayer"
APP="$CARD/MUOS/application/RPG Maker MV"

[ -x build-device/mvplayer ] || { echo "build-device/mvplayer is missing: build the player first" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$PLAYER/js" "$PLAYER/patches" "$CARD/ROMS/RPGMV" "$APP"
cp build-device/mvplayer "$PLAYER/mvplayer"
cp js/*.js "$PLAYER/js/"
cp patches/* "$PLAYER/patches/"
cp packaging/muos/mux_launch.sh "$APP/mux_launch.sh"
chmod +x "$APP/mux_launch.sh"
cat > "$CARD/ROMS/RPGMV/README.txt" <<'NOTE'
RPG Maker MV games for the "RPG Maker MV" entry in the Apps menu.

Each game is a folder that contains the game's own "www" folder (the one
with index.html). Games are looked for in two places:

    /opt/mvplayer/games/MyGame/www/index.html    internal storage (fastest)
    ROMS/RPGMV/MyGame/www/index.html             this folder, on the card

Saves and the player's log are written to the game's www/save folder.
To leave a game, hold the menu button and press Start.
NOTE

tar -czf "$OUT/mvplayer-muos.tar.gz" -C "$CARD" .
echo "package: $OUT/mvplayer-muos.tar.gz ($(du -h "$OUT/mvplayer-muos.tar.gz" | cut -f1))"
