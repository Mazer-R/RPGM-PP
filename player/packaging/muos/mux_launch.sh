#!/bin/sh
# HELP: RPG Maker MV games, run without their bundled browser
# ICON: app
# GRID: RPG Maker MV

# The player as a muOS application. muOS closes its menu before running this
# script and reopens it when the script ends.
#
# It shows the list of games, runs the one chosen, and comes back to the list
# when that game ends. Leaving the list (B) returns to muOS.
#
# Games are looked for in two places; a game is a folder that holds the
# game's own www folder (the one with index.html):
#   /opt/mvplayer/games/<Game>/www     internal storage: fastest to load
#   <card>/ROMS/RPGMV/<Game>/www       the card's shared partition
# Saves and the log stay in each game's www/save.
# To leave a game: hold the menu button and press Start.
# To show or hide the frames per second: hold the menu button and press Select.

. /opt/muos/script/var/func.sh

echo app >/tmp/act_go

STORAGE="$(GET_VAR "device" "storage/rom/mount")"
PLAYER_DIR="$STORAGE/MUOS/emulator/mvplayer"
INTERNAL_GAMES=/opt/mvplayer/games
CARD_GAMES="$STORAGE/ROMS/RPGMV"

if [ "$(cat "$(GET_VAR "device" "screen/hdmi")")" -eq 1 ] && [ "$(GET_VAR "device" "board/hdmi")" -eq 1 ]; then
	SDL_HQ_SCALER=2
	SDL_ROTATION=0
	SDL_BLITTER_DISABLED=1
else
	SDL_HQ_SCALER="$(GET_VAR "device" "sdl/scaler")"
	SDL_ROTATION="$(GET_VAR "device" "sdl/rotation")"
	SDL_BLITTER_DISABLED="$(GET_VAR "device" "sdl/blitter_disabled")"
fi
SDL_ASSERT=always_ignore
export SDL_HQ_SCALER SDL_ROTATION SDL_BLITTER_DISABLED SDL_ASSERT

cd "$PLAYER_DIR" || exit

SET_VAR "system" "foreground_process" "mvplayer"

while :; do
	# The list prints the chosen game's folder; any other outcome ends the loop.
	GAME=$(./mvplayer --pick "$INTERNAL_GAMES" "$CARD_GAMES" | sed -n 's/^MVPLAYER_GAME=//p' | head -n 1)
	[ -n "$GAME" ] || break
	./mvplayer --game "$GAME"
done

unset SDL_HQ_SCALER SDL_ROTATION SDL_BLITTER_DISABLED SDL_ASSERT
