# stb_vorbis

`stb_vorbis.c` is Sean Barrett's Ogg Vorbis decoder, version 1.24, taken
unchanged from https://github.com/nothings/stb (file `stb_vorbis.c`). It is in
the public domain (see the end of the file).

SHA-256: b52cf518355f7b2d181f18b97b812f361ffeb26299d935c8cf29e842401d60a6

The player's sound mixer (`src/platform/audio_mixer.cpp`) uses it to decode
the games' `.ogg` files while they play.
