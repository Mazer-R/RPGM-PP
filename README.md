# RPGM-PP

**RPG Maker Potato Player.**

A native player for RPG Maker MV games, without the Chromium-based NW.js
player the games ship with. It is written for low-memory Linux handhelds
(reference device: Anbernic RG35XX SP, 1 GB RAM, muOS) and is also built for
desktop Linux (x86-64 and 64-bit ARM) and Android. Ready-made packages are
on the [releases page](https://github.com/Mazer-R/RPGM-PP/releases/latest);
[Installing and using](#installing-and-using) says how to install each.

![A console turning into a potato](docs/images/console-to-potato.gif)

**Why.** I wanted to play RPG Maker games on my Anbernic RG35XX, and could
not: the Chromium wrapper the games come with ate all of the console's
memory. Through other systems the games did start, but they could not be
played: 5 frames per second at most.

**Status: experimental.** Two games have been played on the reference
console, Fear & Hunger and Fear & Hunger 2: Termina, neither of them to
the end, and the player has been tried on one Android phone and on one
desktop PC. Other games are untested, and the 64-bit ARM desktop package
has not been tried on a real machine yet. RPG Maker MZ games do not run.

## What it is

An MV game is a web page: the engine's scripts, the PIXI.js drawing library
and the game's plugins, loaded by a browser. On a 1 GB handheld that browser
does not fit, cannot reach the display, and is too slow where it does start.

The player keeps the game's JavaScript unchanged and replaces the browser
around it:

| Part | What it does | Where |
| --- | --- | --- |
| JavaScript engine | V8 12.4, embedded, with its JIT | `player/src/engine` |
| WebGL | The WebGL calls PIXI makes, passed on to OpenGL ES 2 | `player/src/bindings/webgl_binding.cpp` |
| Canvas 2D | Text and bitmap drawing, on Cairo and FreeType | `player/src/bindings/canvas_binding.cpp` |
| Sound | Own mixer on SDL2; Ogg Vorbis through stb_vorbis | `player/src/platform/audio_mixer.cpp` |
| Video | The `ffmpeg` program (the system's; on Android one inside the app), read through pipes | `player/src/platform/video.cpp` |
| Window and input | SDL2: controllers, keyboard, touch | `player/src/platform` |
| Browser stand-in | The DOM, events, storage and Node pieces the engine asks for, in JavaScript | `player/js` |
| Patches | In-memory changes to the engine where its code is too costly | `player/patches` |

There is no browser, no DOM tree and no HTML layout inside it. Game files
are never edited: patches replace functions in memory after the game's own
scripts and plugins have loaded.

## Measured on the reference console

Anbernic RG35XX SP (Allwinner H700, Mali-G31, 640x480), muOS.

| | NW.js / browser engine | This player |
| --- | --- | --- |
| Memory, Fear & Hunger on a map | 750 MB, over 1 GB in battle | 220 to 275 MB |
| Lighting plugin, per logic step | about 40 ms on the CPU | drawn by the GPU |
| Fear & Hunger, large map | does not start | about 39 frames per second |
| Fear & Hunger 2, large map | does not start | 22 to 24 frames per second |

The numbers, how they were taken and their limits are in
`docs/designs/native-rpgmaker-mv-player.md`. The earlier feasibility
measurements are in `docs/history/feasibility-study.md`.

## What works

- MV games on the WebGL renderer, with their plugins, unchanged.
- Saves in the game's own format, in the game's `www/save` folder; a save
  made on a PC continues on the console.
- Encrypted images and sounds (`.rpgmvp`, `.rpgmvo`).
- Videos, where the system has `ffmpeg`; the Android app brings its own.
- Controllers, keyboard and touch. A settings menu inside the game (menu
  button + X, or F1, or the MENU button on a touch screen): frame counter,
  which key each controller button presses, and an on-screen editor for
  the touch controls. Both are kept per game.
- A game list, to choose among the games found, add others, and take off
  the ones you no longer want (their files are not deleted).

## What does not

- RPG Maker MZ.
- `.m4a` sound, encrypted or not.
- Sound effects that rely on pitch or exact loop points are approximated.

## Installing and using

The player is distributed ready to run; nothing has to be compiled.

You need your own copy of a game. The player uses only the game's `www`
folder (the one with `index.html`), which the Windows and Linux downloads of
an MV game contain. Copy the whole game folder: the list also finds a game
by its `.exe`.

### Download

The packages are on the project's releases page:
<https://github.com/Mazer-R/RPGM-PP/releases/latest>

| System | File |
| --- | --- |
| Android phone or tablet (64-bit ARM, Android 8.0 or later) | `mvplayer-android-arm64.apk` |
| Handheld with muOS (Anbernic RG35XX family and alike) | `mvplayer-muos.tar.gz` |
| Desktop Linux, Intel or AMD processor | `mvplayer-linux-x86_64.tar.gz` |
| Desktop Linux, 64-bit ARM (Raspberry Pi 4 or 5, ARM laptops and boards) | `mvplayer-linux-aarch64.tar.gz` |

### Android

1. Download `mvplayer-android-arm64.apk` on the device (or copy it there)
   and open it from the file manager. The first time, Android asks to allow
   installing from that app: allow it and go back. The app is not in any
   store and is signed with a test key, so Play Protect may ask once more.
   With a computer and USB debugging the same is done with
   `adb install -r mvplayer-android-arm64.apk`.
2. Start "RPG Maker MV Player". It opens the system's "all files access"
   screen: allow it and open the app again. Without it the app cannot read
   the games.
3. Copy each game to the device, with a USB cable or a file manager. The
   app looks in the `RPGMV` folder at the top of the shared storage, one
   folder per game, each holding the game's `www` folder:
   `RPGMV/<Game>/www`. The app creates that folder once access is allowed.
4. Touch a game to choose it and touch it again to start it; the games
   played last come first. A game kept anywhere else on the device is added
   with the list's "Add a game" line: go into the game's own folder and
   choose its `.exe`. To take a game off the list, choose it and touch the
   cross at the end of its line, then touch it again to confirm; its files
   stay where they are.

Without a controller, the screen shows a direction pad and three buttons.
The MENU button in the top right corner opens the settings; "TOUCH
CONTROLS" there moves, resizes, adds and removes buttons (a game that needs
the T key gets a T button). Back is cancel; held for a second it returns to
the list. Videos are decoded by an `ffmpeg` inside the app; this has not
been seen on a phone's screen yet.

To update, install the newer APK over the old one; games, saves and
settings are kept. To remove the player, uninstall the app; the `RPGMV`
folder, with the games and their saves, stays until you delete it.

### Handhelds with muOS

The package is extracted onto the SD card that holds the `MUOS` and `ROMS`
folders (the first card), at its top level. It adds
`MUOS/emulator/mvplayer`, `MUOS/application/RPG Maker MV` and `ROMS/RPGMV`,
and touches nothing else.

1. Switch the console off, take the card out and put it in a computer.
2. Extract the archive at the card's top level, so that its `MUOS` and
   `ROMS` folders merge with the ones already there. On Linux or macOS,
   with the card's own path in place of `/path/to/card`:

   ```sh
   tar -xzf mvplayer-muos.tar.gz -C /path/to/card
   ```

   On Windows, 7-Zip opens the archive (twice: the `.gz`, then the `.tar`
   inside); drag the `MUOS` and `ROMS` folders onto the card and accept
   merging the folders.
3. Copy each game to `ROMS/RPGMV/<Game>/www` on the card.
4. Put the card back and start the console: Apps, then "RPG Maker MV".
   Choose a game with A; the games played last come first. A game kept in
   any other folder of the cards is added with the list's "Add a game"
   line: go into the game's own folder and choose its `.exe`. X takes the
   chosen game off the list (press X again to confirm, B to keep it); its
   files stay on the card.

With SSH enabled on the console, the same archive can be copied over the
network and extracted there with `tar -xzf mvplayer-muos.tar.gz -C
/mnt/mmc`. A game also runs from `/opt/mvplayer/games/<Game>/www` on
internal storage, which loads faster.

| Buttons | What they do |
| --- | --- |
| Menu held + Start | Leave the game, back to the list |
| Menu held + X | The player's settings: frame counter, which key each button presses |
| Menu held + Select | Show or hide the frames per second |

Videos use the `ffmpeg` that muOS already has.

To update, extract the newer archive over the old one; the list of games
and the saves are kept. To remove the player, delete
`MUOS/emulator/mvplayer` and `MUOS/application/RPG Maker MV` from the card.

### Desktop Linux (x86-64 and 64-bit ARM)

The steps are the same for both; only the archive differs. The x86-64
package has been tried on a desktop PC; the 64-bit ARM one has only been
run in a container, without a screen. Both need glibc 2.35 or newer (Ubuntu
22.04, Debian 12, Fedora 36, or later).

1. Extract the archive anywhere in your home folder and go into it:

   ```sh
   tar -xzf mvplayer-linux-x86_64.tar.gz
   cd mvplayer-linux-x86_64
   ```

2. Check that the system has the libraries the player expects; it lists
   any that are missing, to install with the system's package manager:

   ```sh
   ./mvplayer.sh --check-libs
   ```

3. Start it:

   ```sh
   ./mvplayer.sh
   ```

   The list's "Add a game" line shows your folders: go into the game's own
   folder and choose its `.exe` (or the `index.html` in its `www` folder).
   Games added are remembered, and the ones played last come first. Delete
   (or X on a controller, or the cross at the end of the chosen line with
   the mouse) takes a game off the list, after asking again; its files
   stay where they are. A game can also be started directly:
   `./mvplayer.sh "/path/to/the game/Game.exe"`.
4. Optional: `./mvplayer.sh --install-launcher` adds "RPG Maker MV Player"
   to the desktop's application menu.
5. Optional, for a game's videos: install `ffmpeg` with the system's
   package manager (`sudo apt install ffmpeg`, `sudo dnf install ffmpeg`,
   `sudo pacman -S ffmpeg`). Without it a game goes on as if each video had
   ended at once.

Keys: arrows to move, Z or Enter to confirm, X or Esc to cancel, F1 for the
player's settings, F2 for the frames per second. A controller works too.
The player opens in a window that can be resized; F11 switches between the
window and the whole screen. The package brings its own SDL2, Cairo and
FreeType and keeps its files together: always start it through
`mvplayer.sh`. More details are in the `README.txt` inside it.

To update, extract the newer archive in place of the old folder; the list
of games is kept in `~/.config/mvplayer/games.txt` and the saves in each
game's `www/save`. To remove the player, delete its folder, that file and,
if the launcher was installed, `~/.local/share/applications/mvplayer.desktop`.

## Patches

`player/patches/index.json` lists them and when each applies. All are
switched off with `--no-patches`, or per game by naming them under `"off"`
in the game's `save/mvplayer-patches.json`.

| Patch | Applies to | What it changes |
| --- | --- | --- |
| `gpuLights` | Games with the TerraxLighting plugin | The darkness mask is drawn by the GPU instead of the CPU |
| `eventCulling` | MV | Events far from the player are not updated on every step |
| `eventLookup` | MV | Looking up the events on a tile no longer scans every event |
| `preloadOnce` | MV | An event's images are asked for only the first time its command list starts |
| `framePacing` | MV | At most two logic steps per frame |
| `leanState` | MV | Writes that change nothing do not trigger a map refresh |
| `commonEventThrottle` | MV | Parallel common events that are pure checks, and cost enough, run once every six steps |
| `equipCache` | MV | An actor's equipment list is rebuilt only after a slot changed |

## Repository layout

```
player/
  src/engine/      V8 host: contexts, script loading, profiling
  src/bindings/    WebGL, Canvas 2D, audio and video, as seen from JavaScript
  src/platform/    window, input, sound mixer, video, files, settings menu
  js/              the browser stand-in and the game list
  patches/         the patches and their index
  packaging/       muOS, desktop Linux and Android packages
  tests/           native, JavaScript and on-device tests
  tools/           build scripts, V8 build, helpers
docs/designs/      the design document, with every result
docs/history/      the feasibility study and the experiments behind it
```

## Building

Builds run in containers; the images are described by the Dockerfiles in
`player/tools/build` and `player/tools/v8`. V8 is built once per target
(hours) and is not kept in git.

| Target | V8 | Player | Package |
| --- | --- | --- | --- |
| ARM64 Linux | `tools/v8/build.sh` | `tools/build/build.sh` | `packaging/muos/build-package.sh` (muOS), `packaging/linux/build-package.sh aarch64` (desktop) |
| Linux x86-64 | `tools/v8/build-x64.sh` | `tools/build/build-x64.sh` | `packaging/linux/build-package.sh x86_64` |
| Android (arm64-v8a) | `tools/v8/build-android.sh` | `tools/build/build-android-deps.sh`, `tools/build/build-android-ffmpeg.sh`, then `tools/build/build-android.sh` | `packaging/android/build-apk.sh` |

For example, the console build, from the repository's root:

```sh
docker run --rm -v "$PWD/player":/work/player mvp-player-build sh /work/player/tools/build/build.sh
```

Each package has its own notes: `player/packaging/android/README.md`,
`player/packaging/linux/README.txt`.

## Running

```sh
mvplayer --game <path>                 # a game: its www folder, the folder holding it, or its .exe
mvplayer --pick <games-dir> [...]      # the game list
mvplayer --game <path> --run <script>  # with a watch script, for tests
```

`--fps` starts with the frame counter on; `--no-patches` runs without the
patches. The log of a run is the game's `www/save/mvplayer.log`.

Where games go on each platform is under "Installing and using".

## Tests

```sh
# Native tests, in the build image
docker run --rm -v "$PWD/player":/work/player mvp-player-build sh /work/player/tools/build/test.sh

# JavaScript tests, with Node
for t in player/tests/js/*.test.js player/tests/patches/*.test.js; do node "$t"; done
```

`player/tests/device` holds scripts that run next to a real game on the
console (`--run`) and log measurements: a walk, a battle, a video, the cost
of each common event.

## Game files

No game data, engine scripts or plugins are included, and none may be
committed. Use your own copy of a game.

## License

GPL-3.0-or-later: see `LICENSE`. The license covers the player only; games,
their engine scripts and their plugins belong to their own authors.

The player links against V8 (BSD 3-Clause), SDL2 (zlib), Cairo (LGPL 2.1 or
MPL 1.1), pixman (MIT), FreeType (FTL), libpng and stb_vorbis (public domain
or MIT), and starts `ffmpeg` as a separate program. The Android package
carries a build of FFmpeg (LGPL 2.1 or later) for that.

## Thanks

To Miro Haverinen, the creator of Fear & Hunger, for inspiring me to build
this so that I could play his games.

---

# RPGM-PP (español)

**RPG Maker Potato Player.**

Un reproductor nativo de juegos de RPG Maker MV, sin el reproductor NW.js
basado en Chromium con el que se distribuyen. Está escrito para consolas
Linux con poca memoria (dispositivo de referencia: Anbernic RG35XX SP, 1 GB
de RAM, muOS) y se compila también para Linux de escritorio (x86-64 y ARM de
64 bits) y Android. Los paquetes ya compilados están en la
[página de versiones](https://github.com/Mazer-R/RPGM-PP/releases/latest);
[Instalar y usar](#instalar-y-usar) explica cómo instalar cada uno.

![Una consola que se convierte en patata](docs/images/console-to-potato.gif)

**Por qué.** Quería jugar a juegos de RPG Maker en mi Anbernic RG35XX y no
podía: el envoltorio de Chromium con el que vienen los juegos se comía toda
la memoria de la consola. Con otros sistemas los juegos arrancaban, pero
eran injugables: 5 fotogramas por segundo como mucho.

**Estado: experimental.** En la consola de referencia se ha jugado a dos
juegos, Fear & Hunger y Fear & Hunger 2: Termina, ninguno de los dos hasta
el final, y el reproductor se ha probado en un móvil Android y en un PC de
escritorio. Los demás juegos están sin probar, y el paquete de escritorio
para ARM de 64 bits no se ha probado todavía en una máquina real. Los
juegos de RPG Maker MZ no funcionan.

## Qué es

Un juego de MV es una página web: los scripts del motor, la librería de
dibujo PIXI.js y los plugins del juego, cargados por un navegador. En una
consola de 1 GB ese navegador no cabe, no puede usar la pantalla y, donde
arranca, va demasiado lento.

El reproductor deja el JavaScript del juego tal cual y sustituye el
navegador que lo rodea:

| Parte | Qué hace | Dónde |
| --- | --- | --- |
| Motor de JavaScript | V8 12.4, embebido, con su JIT | `player/src/engine` |
| WebGL | Las llamadas WebGL que hace PIXI, pasadas a OpenGL ES 2 | `player/src/bindings/webgl_binding.cpp` |
| Canvas 2D | Texto y dibujo de mapas de bits, sobre Cairo y FreeType | `player/src/bindings/canvas_binding.cpp` |
| Sonido | Mezclador propio sobre SDL2; Ogg Vorbis con stb_vorbis | `player/src/platform/audio_mixer.cpp` |
| Vídeo | El programa `ffmpeg` (el del sistema; en Android, uno dentro de la app), leído por tuberías | `player/src/platform/video.cpp` |
| Ventana y entrada | SDL2: mandos, teclado, pantalla táctil | `player/src/platform` |
| Sustituto del navegador | El DOM, los eventos, el almacenamiento y las piezas de Node que pide el motor, en JavaScript | `player/js` |
| Parches | Cambios en memoria al motor donde su código cuesta demasiado | `player/patches` |

Dentro no hay navegador, ni árbol DOM, ni maquetación HTML. Los archivos
del juego no se modifican nunca: los parches sustituyen funciones en
memoria una vez cargados los scripts y plugins del juego.

## Medido en la consola de referencia

Anbernic RG35XX SP (Allwinner H700, Mali-G31, 640x480), muOS.

| | NW.js / motor de navegador | Este reproductor |
| --- | --- | --- |
| Memoria, Fear & Hunger en un mapa | 750 MB, más de 1 GB en combate | de 220 a 275 MB |
| Plugin de luces, por paso de lógica | unos 40 ms en la CPU | lo dibuja la GPU |
| Fear & Hunger, mapa grande | no arranca | unos 39 fotogramas por segundo |
| Fear & Hunger 2, mapa grande | no arranca | de 22 a 24 fotogramas por segundo |

Las cifras, cómo se tomaron y sus límites están en
`docs/designs/native-rpgmaker-mv-player.md` (en inglés). Las mediciones de
viabilidad anteriores están en `docs/history/feasibility-study.md`.

## Qué funciona

- Juegos de MV con el renderizador WebGL, con sus plugins, sin tocarlos.
- Partidas en el formato del propio juego, en su carpeta `www/save`; una
  partida guardada en un PC continúa en la consola.
- Imágenes y sonidos cifrados (`.rpgmvp`, `.rpgmvo`).
- Vídeos, donde el sistema tenga `ffmpeg`; la app de Android trae el suyo.
- Mandos, teclado y pantalla táctil. Un menú de ajustes dentro del juego
  (botón menú + X, o F1, o el botón MENU en pantalla táctil): contador de
  fotogramas, qué tecla pulsa cada botón del mando y un editor en pantalla
  de los controles táctiles. Ambos se guardan por juego.
- Una lista de juegos para elegir entre los encontrados, añadir otros y
  quitar los que ya no quieras (sus archivos no se borran).

## Qué no

- RPG Maker MZ.
- Sonido `.m4a`, cifrado o no.
- Los efectos de sonido que dependen del tono o de puntos de bucle exactos
  se aproximan.

## Instalar y usar

El reproductor se distribuye listo para ejecutar; no hay que compilar nada.

Hace falta tu propia copia del juego. El reproductor solo usa la carpeta
`www` del juego (la que tiene `index.html`), que viene en las descargas
para Windows y para Linux de un juego de MV. Copia la carpeta entera del
juego: la lista también encuentra un juego por su `.exe`.

### Descarga

Los paquetes están en la página de versiones del proyecto:
<https://github.com/Mazer-R/RPGM-PP/releases/latest>

| Sistema | Archivo |
| --- | --- |
| Móvil o tableta Android (ARM de 64 bits, Android 8.0 o posterior) | `mvplayer-android-arm64.apk` |
| Consola con muOS (familia Anbernic RG35XX y parecidas) | `mvplayer-muos.tar.gz` |
| Linux de escritorio, procesador Intel o AMD | `mvplayer-linux-x86_64.tar.gz` |
| Linux de escritorio, ARM de 64 bits (Raspberry Pi 4 o 5, portátiles y placas ARM) | `mvplayer-linux-aarch64.tar.gz` |

### Android

1. Descarga `mvplayer-android-arm64.apk` en el dispositivo (o cópialo) y
   ábrelo desde el gestor de archivos. La primera vez, Android pide permiso
   para instalar desde esa app: permítelo y vuelve atrás. La app no está en
   ninguna tienda y va firmada con una clave de pruebas, así que Play
   Protect puede preguntar una vez más. Con un ordenador y la depuración
   USB se hace lo mismo con `adb install -r mvplayer-android-arm64.apk`.
2. Abre "RPG Maker MV Player". Muestra la pantalla del sistema de "acceso a
   todos los archivos": permítelo y vuelve a abrir la app. Sin eso no puede
   leer los juegos.
3. Copia cada juego al dispositivo, con un cable USB o un gestor de
   archivos. La app busca en la carpeta `RPGMV`, en la raíz del
   almacenamiento compartido, una carpeta por juego con su `www` dentro:
   `RPGMV/<Juego>/www`. La app crea esa carpeta una vez permitido el acceso.
4. Toca un juego para elegirlo y vuelve a tocarlo para empezar; los últimos
   jugados salen primero. Un juego guardado en cualquier otro sitio del
   dispositivo se añade con la línea "Add a game" de la lista: entra en la
   carpeta del juego y elige su `.exe`. Para quitar un juego de la lista,
   elígelo y toca la cruz al final de su línea; vuelve a tocarla para
   confirmar. Sus archivos se quedan donde están.

Sin mando, la pantalla muestra una cruceta y tres botones. El botón MENU,
arriba a la derecha, abre los ajustes; "TOUCH CONTROLS" permite mover,
cambiar de tamaño, añadir y quitar botones (un juego que necesita la tecla
T recibe un botón T). Atrás es cancelar; mantenido un segundo vuelve a la
lista. Los vídeos los decodifica un `ffmpeg` que va dentro de la app; aún
no se ha visto en la pantalla de un móvil.

Para actualizar, instala el APK nuevo sobre el anterior; los juegos, las
partidas y los ajustes se conservan. Para quitar el reproductor, desinstala
la app; la carpeta `RPGMV`, con los juegos y sus partidas, se queda hasta
que la borres.

### Consolas con muOS

El paquete se extrae en la tarjeta SD que contiene las carpetas `MUOS` y
`ROMS` (la primera tarjeta), en su raíz. Añade `MUOS/emulator/mvplayer`,
`MUOS/application/RPG Maker MV` y `ROMS/RPGMV`, y no toca nada más.

1. Apaga la consola, saca la tarjeta y ponla en un ordenador.
2. Extrae el archivo en la raíz de la tarjeta, de modo que sus carpetas
   `MUOS` y `ROMS` se combinen con las que ya hay. En Linux o macOS, con la
   ruta de la tarjeta en lugar de `/ruta/a/la/tarjeta`:

   ```sh
   tar -xzf mvplayer-muos.tar.gz -C /ruta/a/la/tarjeta
   ```

   En Windows, 7-Zip abre el archivo (dos veces: el `.gz` y luego el `.tar`
   de dentro); arrastra las carpetas `MUOS` y `ROMS` a la tarjeta y acepta
   combinar las carpetas.
3. Copia cada juego a `ROMS/RPGMV/<Juego>/www` en la tarjeta.
4. Vuelve a poner la tarjeta y enciende la consola: Apps y después "RPG
   Maker MV". Elige un juego con A; los últimos jugados salen primero. Un
   juego guardado en cualquier otra carpeta de las tarjetas se añade con la
   línea "Add a game" de la lista: entra en la carpeta del juego y elige su
   `.exe`. X quita el juego elegido de la lista (X otra vez para confirmar,
   B para dejarlo); sus archivos siguen en la tarjeta.

Con SSH activado en la consola, el mismo archivo se puede copiar por la red
y extraer allí con `tar -xzf mvplayer-muos.tar.gz -C /mnt/mmc`. Un juego
también funciona desde `/opt/mvplayer/games/<Juego>/www`, en el
almacenamiento interno, donde carga más rápido.

| Botones | Qué hacen |
| --- | --- |
| Menú mantenido + Start | Salir del juego, de vuelta a la lista |
| Menú mantenido + X | Ajustes del reproductor: contador de fotogramas, qué tecla pulsa cada botón |
| Menú mantenido + Select | Mostrar u ocultar los fotogramas por segundo |

Los vídeos usan el `ffmpeg` que muOS ya trae.

Para actualizar, extrae el archivo nuevo sobre el anterior; la lista de
juegos y las partidas se conservan. Para quitar el reproductor, borra
`MUOS/emulator/mvplayer` y `MUOS/application/RPG Maker MV` de la tarjeta.

### Linux de escritorio (x86-64 y ARM de 64 bits)

Los pasos son los mismos para los dos; solo cambia el archivo. El paquete
x86-64 se ha probado en un PC de escritorio; el de ARM de 64 bits solo se
ha ejecutado en un contenedor, sin pantalla. Los dos necesitan glibc 2.35 o
posterior (Ubuntu 22.04, Debian 12, Fedora 36, o posteriores).

1. Extrae el archivo donde quieras dentro de tu carpeta personal y entra
   en él:

   ```sh
   tar -xzf mvplayer-linux-x86_64.tar.gz
   cd mvplayer-linux-x86_64
   ```

2. Comprueba que el sistema tiene las bibliotecas que el reproductor
   espera; enumera las que falten, para instalarlas con el gestor de
   paquetes del sistema:

   ```sh
   ./mvplayer.sh --check-libs
   ```

3. Arráncalo:

   ```sh
   ./mvplayer.sh
   ```

   La línea "Add a game" de la lista muestra tus carpetas: entra en la
   carpeta del juego y elige su `.exe` (o el `index.html` de su carpeta
   `www`). Los juegos añadidos se recuerdan, y los últimos jugados salen
   primero. Supr (o X en un mando, o la cruz al final de la línea elegida
   con el ratón) quita un juego de la lista, tras volver a preguntar; sus
   archivos se quedan donde están. Un juego también se puede arrancar
   directamente: `./mvplayer.sh "/ruta/al juego/Game.exe"`.
4. Opcional: `./mvplayer.sh --install-launcher` añade "RPG Maker MV Player"
   al menú de aplicaciones del escritorio.
5. Opcional, para los vídeos de un juego: instala `ffmpeg` con el gestor de
   paquetes del sistema (`sudo apt install ffmpeg`, `sudo dnf install
   ffmpeg`, `sudo pacman -S ffmpeg`). Sin él, el juego sigue como si cada
   vídeo hubiera terminado al instante.

Teclas: flechas para moverse, Z o Intro para confirmar, X o Esc para
cancelar, F1 para los ajustes del reproductor, F2 para los fotogramas por
segundo. También funciona un mando. El reproductor se abre en una ventana
que se puede redimensionar; F11 alterna entre la ventana y la pantalla
completa. El paquete trae sus propias SDL2, Cairo y FreeType y necesita sus
archivos juntos: arráncalo siempre con `mvplayer.sh`. Hay más detalles en
el `README.txt` que lleva dentro (en inglés).

Para actualizar, extrae el archivo nuevo en lugar de la carpeta anterior;
la lista de juegos se guarda en `~/.config/mvplayer/games.txt` y las
partidas en el `www/save` de cada juego. Para quitar el reproductor, borra
su carpeta, ese archivo y, si instalaste el lanzador,
`~/.local/share/applications/mvplayer.desktop`.

## Parches

`player/patches/index.json` los enumera y dice cuándo se aplica cada uno.
Se apagan todos con `--no-patches`, o por juego nombrándolos bajo `"off"`
en el `save/mvplayer-patches.json` del juego.

| Parche | Se aplica a | Qué cambia |
| --- | --- | --- |
| `gpuLights` | Juegos con el plugin TerraxLighting | La máscara de oscuridad la dibuja la GPU en lugar de la CPU |
| `eventCulling` | MV | Los eventos lejos del jugador no se actualizan en cada paso |
| `eventLookup` | MV | Buscar los eventos de una casilla ya no recorre todos los eventos |
| `preloadOnce` | MV | Las imágenes de un evento se piden solo la primera vez que arranca su lista de comandos |
| `framePacing` | MV | Como mucho dos pasos de lógica por fotograma |
| `leanState` | MV | Las escrituras que no cambian nada no provocan un refresco del mapa |
| `commonEventThrottle` | MV | Los eventos comunes paralelos que son comprobaciones puras, y cuestan lo bastante, se ejecutan una vez cada seis pasos |
| `equipCache` | MV | La lista de equipo de un personaje solo se rehace cuando cambia un hueco |

## Estructura del repositorio

```
player/
  src/engine/      anfitrión de V8: contextos, carga de scripts, perfilado
  src/bindings/    WebGL, Canvas 2D, sonido y vídeo, vistos desde JavaScript
  src/platform/    ventana, entrada, mezclador, vídeo, archivos, menú de ajustes
  js/              el sustituto del navegador y la lista de juegos
  patches/         los parches y su índice
  packaging/       paquetes para muOS, Linux de escritorio y Android
  tests/           pruebas nativas, de JavaScript y en la consola
  tools/           scripts de compilación, compilación de V8, utilidades
docs/designs/      el documento de diseño, con todos los resultados
docs/history/      el estudio de viabilidad y sus experimentos
```

## Compilar

Las compilaciones se hacen en contenedores; las imágenes están descritas en
los Dockerfile de `player/tools/build` y `player/tools/v8`. V8 se compila
una vez por plataforma (horas) y no se guarda en git.

| Plataforma | V8 | Reproductor | Paquete |
| --- | --- | --- | --- |
| Linux ARM64 | `tools/v8/build.sh` | `tools/build/build.sh` | `packaging/muos/build-package.sh` (muOS), `packaging/linux/build-package.sh aarch64` (escritorio) |
| Linux x86-64 | `tools/v8/build-x64.sh` | `tools/build/build-x64.sh` | `packaging/linux/build-package.sh x86_64` |
| Android (arm64-v8a) | `tools/v8/build-android.sh` | `tools/build/build-android-deps.sh`, `tools/build/build-android-ffmpeg.sh` y después `tools/build/build-android.sh` | `packaging/android/build-apk.sh` |

Por ejemplo, la compilación para la consola, desde la raíz del repositorio:

```sh
docker run --rm -v "$PWD/player":/work/player mvp-player-build sh /work/player/tools/build/build.sh
```

Cada paquete tiene sus propias notas (en inglés):
`player/packaging/android/README.md`, `player/packaging/linux/README.txt`.

## Ejecutar

```sh
mvplayer --game <ruta>                 # un juego: su carpeta www, la que la contiene o su .exe
mvplayer --pick <carpeta-juegos> [...] # la lista de juegos
mvplayer --game <ruta> --run <script>  # con un script de observación, para pruebas
```

`--fps` arranca con el contador de fotogramas; `--no-patches` ejecuta sin
los parches. El registro de cada ejecución es el `www/save/mvplayer.log`
del juego.

Dónde van los juegos en cada plataforma está en "Instalar y usar".

## Pruebas

```sh
# Pruebas nativas, en la imagen de compilación
docker run --rm -v "$PWD/player":/work/player mvp-player-build sh /work/player/tools/build/test.sh

# Pruebas de JavaScript, con Node
for t in player/tests/js/*.test.js player/tests/patches/*.test.js; do node "$t"; done
```

`player/tests/device` contiene scripts que se ejecutan junto a un juego
real en la consola (`--run`) y registran mediciones: un paseo, un combate,
un vídeo, el coste de cada evento común.

## Archivos del juego

No se incluyen datos de ningún juego, ni scripts del motor, ni plugins, y
no deben subirse. Usa tu propia copia del juego.

## Licencia

GPL-3.0-or-later: véase `LICENSE`. La licencia cubre solo el reproductor;
los juegos, los scripts de su motor y sus plugins son de sus autores.

El reproductor se enlaza con V8 (BSD de 3 cláusulas), SDL2 (zlib), Cairo
(LGPL 2.1 o MPL 1.1), pixman (MIT), FreeType (FTL), libpng y stb_vorbis
(dominio público o MIT), y arranca `ffmpeg` como programa aparte. El paquete
de Android lleva una compilación de FFmpeg (LGPL 2.1 o posterior) para eso.

## Agradecimientos

A Miro Haverinen, el creador de Fear & Hunger, por inspirarme a crear esto
para poder jugar a sus juegos.
