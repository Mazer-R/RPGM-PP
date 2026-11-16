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
3. `sh tools/build/build-android.sh` builds SDL2 and the player
   (`build-android/native/libmain.so`).
4. `sh packaging/android/build-apk.sh` makes `build-android/mvplayer.apk`,
   signed with a throw-away debug key. No Gradle is involved: the script
   calls the SDK's `aapt2`, `d8`, `zipalign` and `apksigner` directly.

## Installing and adding games

```sh
adb install -r build-android/mvplayer.apk
adb push "My Game" /sdcard/RPGMV/
```

Games go in the `RPGMV` folder at the top of the device's shared storage,
one folder per game, each holding the game's `www` folder; any file manager
or a USB cable can put them there. Saves and the log stay in each game's
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
| `RPGMV/mvplayer/show-fps` | The frame-rate setting chosen in the game list. |
| `RPGMV/mvplayer/args.txt` | For tests: if present, the app runs once with these arguments (one per line) instead of showing the list. |

Until access is allowed, the `mvplayer` folder is kept in
`Android/data/org.mvplayer/files` instead.

## Controls

A controller or keyboard works as on the other platforms. Without one, the
screen shows a direction pad on the left and three buttons on the right
(confirm, cancel/menu, dash); they hide while a controller or keyboard is in
use. The Back button is cancel/menu; held for a second it leaves the game
and returns to the list.
