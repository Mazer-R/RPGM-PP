Potato Player for Linux, @ARCH@ (internal test build)
=====================================================

A player for RPG Maker MV and MZ games. This build is for testing only.

Run
---
Extract the archive anywhere. Then either:

    ./mvplayer.sh

which shows the list of your games, the ones played last first. Its "Add a
game" line shows your folders: go into the game's own folder and choose its
.exe (or the index.html inside its www folder). Games added this way are
remembered. In the list: arrow keys to move, Z or Enter to choose, X or Esc
to go back or leave.

Or start one game directly, giving its folder, its www folder or its .exe:

    ./mvplayer.sh "/path/to/the game/Game.exe"

    ./mvplayer.sh --install-launcher

adds "Potato Player" to the desktop's application menu.

The player opens in a window of its own that can be resized; the picture
keeps its proportions. F11 switches between the window and the whole screen
(MVPLAYER_FULLSCREEN=1 ./mvplayer.sh starts on the whole screen).

While playing, F2 shows or hides the frames per second.
F1 opens the player's settings menu over the game (on a controller: the
menu button held, then X). There you can switch the frame counter, choose
which key each controller button presses, and leave the game. The buttons
are kept per game, in the game's www/save/buttons.txt.

Saves and the player's log (mvplayer.log) are written to the game's
www/save folder. A copy of the log of every run is also kept in the logs/
folder next to mvplayer.sh, named after the game and the time; if something
goes wrong, that is the first thing to look at (and to send along).

Always start the player through mvplayer.sh: it makes the player use the
libraries in the lib/ folder. Keep the files together; the player looks for
js/ and patches/ next to its executable.

Contents
--------
    mvplayer.sh   start script
    mvplayer      the player (@ARCH@, needs glibc 2.35 or newer)
    js/           the player's JavaScript layer
    patches/      per-game patches
    lib/          SDL2, Cairo, FreeType and the libraries they need

What the system must provide
----------------------------
The C and C++ runtime (glibc 2.35 or newer, libstdc++ from GCC 12 or newer),
an OpenGL ES 2 driver (libGLESv2.so.2, libEGL.so.1 - Mesa or the vendor's
driver through libglvnd), and the usual desktop libraries: X11 and its
extension libraries (including libXss and libXrender), xcb, Wayland,
libxkbcommon, libdecor, libdrm, libgbm, ALSA (libasound), PulseAudio's client
library (libpulse), fontconfig and zlib. A desktop installation normally has
all of them. To check:

    ./mvplayer.sh --check-libs

lists any that are missing.

Videos
------
To play a game's videos the player starts the system's ffmpeg program. It is
optional: install it with the system's package manager (the package is
called "ffmpeg" everywhere) to see them. Without it, a game goes on as if
each video had ended at once.

If the bundled libraries cause trouble
--------------------------------------
With SDL2, Cairo and FreeType installed on the system, the player can use
those instead of the ones in lib/:

    MVPLAYER_SYSTEM_LIBS=1 ./mvplayer.sh --game /path/to/game/www

SDL's usual environment variables work, for example SDL_VIDEODRIVER=wayland
or SDL_VIDEODRIVER=x11 to choose the display system.
