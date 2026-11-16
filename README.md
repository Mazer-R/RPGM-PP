# rpgmaker-player

A native player for RPG Maker MV games, without the Chromium-based NW.js
player the games ship with. It is written for low-memory Linux handhelds
(reference device: Anbernic RG35XX SP, 1 GB RAM, muOS) and is also built for
Linux x86-64 and Android.

<!-- MOTIVATION (EN): put the GIF and the reason for this project here.
     The GIF is at docs/images/console-to-potato.gif, for example:
     ![A console turning into a potato](docs/images/console-to-potato.gif)
-->

**Status: experimental.** Two games have been played on the reference
console, Fear & Hunger and Fear & Hunger 2: Termina. Everything else is
untested. RPG Maker MZ games do not run.

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
| Video | The system's `ffmpeg` program, read through pipes | `player/src/platform/video.cpp` |
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
measurements are in `concepts_brief.md`.

## What works

- MV games on the WebGL renderer, with their plugins, unchanged.
- Saves in the game's own format, in the game's `www/save` folder; a save
  made on a PC continues on the console.
- Encrypted images and sounds (`.rpgmvp`, `.rpgmvo`).
- Videos, where the system has `ffmpeg`.
- Controllers, keyboard and touch. A settings menu inside the game (menu
  button + X, or F1, or the MENU button on a touch screen): frame counter,
  which key each controller button presses, and an on-screen editor for
  the touch controls. Both are kept per game.
- A game list, to choose among the games found.

## What does not

- RPG Maker MZ.
- `.m4a` sound, encrypted or not.
- Video on Android (there is no `ffmpeg` program to start).
- Sound effects that rely on pitch or exact loop points are approximated.

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
  packaging/       muOS, Linux x86-64 and Android packages
  tests/           native, JavaScript and on-device tests
  tools/           build scripts, V8 build, helpers
docs/designs/      the design document, with every result
lab/               the feasibility experiments
concepts_brief.md  the idea and the first measurements
```

## Building

Builds run in containers; the images are described by the Dockerfiles in
`player/tools/build` and `player/tools/v8`. V8 is built once per target
(hours) and is not kept in git.

| Target | V8 | Player | Package |
| --- | --- | --- | --- |
| ARM64 Linux (console) | `tools/v8/build.sh` | `tools/build/build.sh` | `packaging/muos/build-package.sh` |
| Linux x86-64 | `tools/v8/build-x64.sh` | `tools/build/build-x64.sh` | `packaging/linux-x86_64/build-package.sh` |
| Android (arm64-v8a) | `tools/v8/build-android.sh` | `tools/build/build-android-deps.sh`, then `tools/build/build-android.sh` | `packaging/android/build-apk.sh` |

For example, the console build, from the repository's root:

```sh
docker run --rm -v "$PWD/player":/work/player mvp-player-build sh /work/player/tools/build/build.sh
```

The ARM64 binary needs a 64-bit system with glibc 2.34 or newer, SDL2,
Cairo, FreeType and OpenGL ES 2. Each package has its own notes:
`player/packaging/android/README.md`, `player/packaging/linux-x86_64/README.txt`.

## Running

```sh
mvplayer --game <path>                 # a game: its www folder, the folder holding it, or its .exe
mvplayer --pick <games-dir> [...]      # the game list
mvplayer --game <path> --run <script>  # with a watch script, for tests
```

`--fps` starts with the frame counter on; `--no-patches` runs without the
patches. The log of a run is the game's `www/save/mvplayer.log`.

Where games go:

- **muOS**: `ROMS/RPGMV/<Game>/www` on the card, or
  `/opt/mvplayer/games/<Game>/www` on internal storage.
- **Android**: `RPGMV/<Game>/www` in shared storage.
- **Linux x86-64**: anywhere; add the game from the list.

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
or MIT), and starts `ffmpeg` as a separate program.

---

# rpgmaker-player (español)

Un reproductor nativo de juegos de RPG Maker MV, sin el reproductor NW.js
basado en Chromium con el que se distribuyen. Está escrito para consolas
Linux con poca memoria (dispositivo de referencia: Anbernic RG35XX SP, 1 GB
de RAM, muOS) y se compila también para Linux x86-64 y Android.

<!-- MOTIVACIÓN (ES): aquí van el GIF y el porqué de este proyecto.
     El GIF está en docs/images/console-to-potato.gif, por ejemplo:
     ![Una consola que se convierte en patata](docs/images/console-to-potato.gif)
-->

**Estado: experimental.** En la consola de referencia se ha jugado a dos
juegos, Fear & Hunger y Fear & Hunger 2: Termina. Todo lo demás está sin
probar. Los juegos de RPG Maker MZ no funcionan.

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
| Vídeo | El programa `ffmpeg` del sistema, leído por tuberías | `player/src/platform/video.cpp` |
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
viabilidad anteriores están en `concepts_brief.md`.

## Qué funciona

- Juegos de MV con el renderizador WebGL, con sus plugins, sin tocarlos.
- Partidas en el formato del propio juego, en su carpeta `www/save`; una
  partida guardada en un PC continúa en la consola.
- Imágenes y sonidos cifrados (`.rpgmvp`, `.rpgmvo`).
- Vídeos, donde el sistema tenga `ffmpeg`.
- Mandos, teclado y pantalla táctil. Un menú de ajustes dentro del juego
  (botón menú + X, o F1, o el botón MENU en pantalla táctil): contador de
  fotogramas, qué tecla pulsa cada botón del mando y un editor en pantalla
  de los controles táctiles. Ambos se guardan por juego.
- Una lista de juegos para elegir entre los encontrados.

## Qué no

- RPG Maker MZ.
- Sonido `.m4a`, cifrado o no.
- Vídeo en Android (no hay programa `ffmpeg` que arrancar).
- Los efectos de sonido que dependen del tono o de puntos de bucle exactos
  se aproximan.

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
  packaging/       paquetes para muOS, Linux x86-64 y Android
  tests/           pruebas nativas, de JavaScript y en la consola
  tools/           scripts de compilación, compilación de V8, utilidades
docs/designs/      el documento de diseño, con todos los resultados
lab/               los experimentos de viabilidad
concepts_brief.md  la idea y las primeras mediciones
```

## Compilar

Las compilaciones se hacen en contenedores; las imágenes están descritas en
los Dockerfile de `player/tools/build` y `player/tools/v8`. V8 se compila
una vez por plataforma (horas) y no se guarda en git.

| Plataforma | V8 | Reproductor | Paquete |
| --- | --- | --- | --- |
| Linux ARM64 (consola) | `tools/v8/build.sh` | `tools/build/build.sh` | `packaging/muos/build-package.sh` |
| Linux x86-64 | `tools/v8/build-x64.sh` | `tools/build/build-x64.sh` | `packaging/linux-x86_64/build-package.sh` |
| Android (arm64-v8a) | `tools/v8/build-android.sh` | `tools/build/build-android-deps.sh` y después `tools/build/build-android.sh` | `packaging/android/build-apk.sh` |

Por ejemplo, la compilación para la consola, desde la raíz del repositorio:

```sh
docker run --rm -v "$PWD/player":/work/player mvp-player-build sh /work/player/tools/build/build.sh
```

El binario ARM64 necesita un sistema de 64 bits con glibc 2.34 o posterior,
SDL2, Cairo, FreeType y OpenGL ES 2. Cada paquete tiene sus propias notas
(en inglés): `player/packaging/android/README.md`,
`player/packaging/linux-x86_64/README.txt`.

## Ejecutar

```sh
mvplayer --game <ruta>                 # un juego: su carpeta www, la que la contiene o su .exe
mvplayer --pick <carpeta-juegos> [...] # la lista de juegos
mvplayer --game <ruta> --run <script>  # con un script de observación, para pruebas
```

`--fps` arranca con el contador de fotogramas; `--no-patches` ejecuta sin
los parches. El registro de cada ejecución es el `www/save/mvplayer.log`
del juego.

Dónde van los juegos:

- **muOS**: `ROMS/RPGMV/<Juego>/www` en la tarjeta, o
  `/opt/mvplayer/games/<Juego>/www` en el almacenamiento interno.
- **Android**: `RPGMV/<Juego>/www` en el almacenamiento compartido.
- **Linux x86-64**: en cualquier sitio; el juego se añade desde la lista.

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
(dominio público o MIT), y arranca `ffmpeg` como programa aparte.
