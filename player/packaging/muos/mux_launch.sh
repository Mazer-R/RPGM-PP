#!/bin/sh
# HELP: RPG Maker MV and MZ games, run without their bundled browser
# ICON: app
# GRID: Potato Player

# The player as a muOS application. muOS closes its menu before running this
# script and reopens it when the script ends.
#
# It shows the list of games, runs the one chosen, and comes back to the list
# when that game ends. Leaving the list (B) returns to muOS.
#
# Games are looked for in two places; a game is a folder that holds the
# game's own www folder (the one with index.html):
#   /opt/potato-player/games/<Game>/www     internal storage: fastest to load
#   <card>/ROMS/RPGMV/<Game>/www       the card's shared partition
# Saves and the log stay in each game's www/save. A copy of the log of every
# run is also kept in MUOS/emulator/potato-player/logs on the card, where it can be
# read from a computer when a game misbehaves.
# To leave a game: hold the menu button and press Start.
# While playing, the menu button plus Select shows or hides the frames per
# second, and the menu button plus X opens the player's settings.

. /opt/muos/script/var/func.sh

echo app >/tmp/act_go

STORAGE="$(GET_VAR "device" "storage/rom/mount")"
PLAYER_DIR="$STORAGE/MUOS/emulator/potato-player"
INTERNAL_GAMES=/opt/potato-player/games
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

SET_VAR "system" "foreground_process" "potato-player"

# Keeps a copy of the log of the game that has just run in the logs folder,
# named after the game and the time, with the way the player ended as its
# last line; only the newest 30 copies are kept. The game's own
# save/potato-player.log is left where it is.
keep_log() {
	[ -f "$1/save/potato-player.log" ] || return 0
	mkdir -p "$LOGS" || return 0
	NAME=$(printf '%s' "$(basename "$(dirname "$1")")" | tr -c 'A-Za-z0-9._-' '_')
	COPY="$LOGS/$(date +%Y%m%d-%H%M%S)-$NAME.log"
	cp "$1/save/potato-player.log" "$COPY" && echo "launcher: the player ended with exit code $2" >>"$COPY"
	ls -1t "$LOGS"/*.log 2>/dev/null | tail -n +31 | while IFS= read -r OLD; do rm -f "$OLD"; done
}
LOGS="$PLAYER_DIR/logs"

while :; do
	# The list prints the chosen game's folder; with no game chosen the
	# loop ends.
	ANSWER=$(./potato-player --pick "$INTERNAL_GAMES" "$CARD_GAMES" --games-file "$PLAYER_DIR/games.txt" --can-add --browse /mnt)
	GAME=$(printf '%s\n' "$ANSWER" | sed -n 's/^POTATO_PLAYER_GAME=//p' | head -n 1)
	[ -n "$GAME" ] || break
	./potato-player --game "$GAME" --sessions "$PLAYER_DIR/sessions.log"
	keep_log "$GAME" $?
done

unset SDL_HQ_SCALER SDL_ROTATION SDL_BLITTER_DISABLED SDL_ASSERT
