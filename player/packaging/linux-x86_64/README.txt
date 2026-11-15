mvplayer for Linux x86-64 (internal test build)
===============================================

A player for RPG Maker MV games. This build is for testing only.

Run
---
Extract the archive anywhere and run, from a terminal:

    ./mvplayer.sh --game /path/to/game/www

where "www" is the game's folder that contains index.html. Saves and the
player's log (mvplayer.log) are written to the game's www/save folder; if
something goes wrong, that log is the first thing to look at.

Always start the player through mvplayer.sh: it makes the player use the
libraries in the lib/ folder. Keep the files together; the player looks for
js/ and patches/ next to its executable.

Contents
--------
    mvplayer.sh   start script
    mvplayer      the player (x86-64, needs glibc 2.36 or newer)
    js/           the player's JavaScript layer
    patches/      per-game patches
    lib/          SDL2, Cairo, FreeType and the libraries they need

What the system must provide
----------------------------
The C and C++ runtime (glibc 2.36 or newer, libstdc++ from GCC 12 or newer),
an OpenGL ES 2 driver (libGLESv2.so.2, libEGL.so.1 - Mesa or the vendor's
driver through libglvnd), and the usual desktop libraries: X11 and its
extension libraries (including libXss and libXrender), xcb, Wayland,
libxkbcommon, libdecor, libdrm, libgbm, ALSA (libasound), PulseAudio's client
library (libpulse), fontconfig and zlib. A desktop installation normally has
all of them. To check:

    ./mvplayer.sh --check-libs

lists any that are missing.

If the bundled libraries cause trouble
--------------------------------------
With SDL2, Cairo and FreeType installed on the system, the player can use
those instead of the ones in lib/:

    MVPLAYER_SYSTEM_LIBS=1 ./mvplayer.sh --game /path/to/game/www

SDL's usual environment variables work, for example SDL_VIDEODRIVER=wayland
or SDL_VIDEODRIVER=x11 to choose the display system.
