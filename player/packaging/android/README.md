# Android package

An experimental build of the player as an Android app (arm64-v8a, Android
8.0 or later). It is the same program as on the consoles: the native code is
built with the Android NDK, SDL2 provides the window, sound and controllers,
and a small start-up file (`src/platform/android_start.cpp`) does what the
launch scripts do elsewhere: game list, then the chosen game, then the list
again.

## Building

Everything runs on the build machine itself (macOS here), with the Android
SDK and NDK r27 installed in `~/Library/Android/sdk`, a Java compiler, and
`meson` in a Python environment under `build-android/venv`.

1. `tools/v8/build-android.sh` builds V8 for Android into
   `third_party/v8-android` (hours; in a container).
2. `sh tools/build/build-android-deps.sh` builds Cairo, pixman, FreeType and
   libpng into `third_party/android-deps`.
3. `sh tools/build/build-android-ffmpeg.sh` builds the video decoder, a
   cut-down `ffmpeg` program, into `third_party/android-deps/bin`. Android
   has none, and an app may only start programs from its package's library
   folder, so the package carries it there as `libffmpeg.so`.
4. `sh tools/build/build-android.sh` builds SDL2 and the player
   (`build-android/native/libmain.so`).
5. `sh packaging/android/build-apk.sh` makes `build-android/mvplayer.apk`,
   signed with a throw-away debug key. No Gradle is involved: the script
   calls the SDK's `aapt2`, `d8`, `zipalign` and `apksigner` directly.

## Installing and adding games

```sh
adb install -r build-android/mvplayer.apk
adb push "My Game" /sdcard/RPGMV/
```

Games go in the `RPGMV` folder at the top of the device's shared storage,
one folder per game, each holding the game's `www` folder; any file manager
or a USB cable can put them there. A game kept anywhere else in the shared
storage can be added from the list's "Add a game" line, which shows the
folders: go into the game's own folder and choose its `.exe`. The list
shows the games played last first; touch a game to play it, and drag the
list to move it. The cross at the end of the chosen game's line takes the
game off the list (touch it again to confirm); its files stay. Saves and the log stay in each game's
`www/save`.

The first time it starts, the app opens the system screen for "all files
access": allow it and open the app again. Current Android versions give an
app no other way to read and write an ordinary shared folder, and let nobody
but the app write to the app's own folder (`Android/data/org.mvplayer`), so
that one cannot be where games are copied.

| Path | What |
| --- | --- |
| `RPGMV/<Game>/www` | The games. |
| `RPGMV/mvplayer/logs/` | A copy of the log of every run (newest 30) and `picker.log`. |
| `RPGMV/mvplayer/games.txt` | The games played or added, the last one first; a line starting with `-` is a game taken off the list. |
| `Android/data/org.mvplayer/files/args.txt` | For tests: if present, the app runs once with these arguments (one per line) instead of showing the list. Kept in the app's own folder, which other apps cannot write to, because the arguments can name a script to run. |

Until access is allowed, the `mvplayer` folder is kept in
`Android/data/org.mvplayer/files` instead.

## Controls

A controller or keyboard works as on the other platforms. Without one, the
screen shows a direction pad on the left and three buttons on the right
(confirm, cancel/menu, dash); they hide while a controller or keyboard is in
use. The Back button is cancel/menu; held for a second it leaves the game
and returns to the list.

Inside a game, the small MENU button in the top right corner opens the
player's settings menu: the frame counter, which key each controller button
presses, the touch controls, and leaving the game. "TOUCH CONTROLS" lets you
change them on the screen: drag a control to move it; ADD puts a new button
for any key (a game that needs the T key gets a T button), DEL removes the
one touched last, - and + change its size, RESET brings the standard ones
back, OK ends. Controls and buttons are kept per game, in the game's
`www/save` folder (`touch-controls.txt`, `buttons.txt`).
