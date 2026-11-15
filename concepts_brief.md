# Native RPG Maker MV Runtime for Low-RAM Linux Handhelds

* **Author:** mcerezo
* **Date:** 2026-11-15

## Overview

RPG Maker MV and MZ games ship inside NW.js, which is a full Chromium browser
plus Node. That browser uses hundreds of MB of RAM across several processes
and has no build that fits a 1 GB ARM handheld such as the Anbernic RG35XX
family running muOS.

The concept is a native Linux program that runs these games without Chromium
and without a JVM. It embeds a small JavaScript engine (QuickJS is the first
candidate), runs the game's own JavaScript (the RPG Maker core scripts, the
bundled PIXI.js, and third-party plugins) and provides only the browser
features those scripts call: WebGL drawn through OpenGL ES 2.0, Canvas 2D,
Web Audio, and a small set of window/document objects. Windowing, input and
audio output go through SDL2.

The reference target is the commercial MV game Fear & Hunger, playable without
crashes on a 1 GB RG35XX-series device under muOS. Priorities are stability,
then RAM use, then speed. The project is personal and has one developer whose
strongest language is Java.

Status of the facts below: there is no code yet, and the reviewers could not
open URLs or inspect the game or the device. Every statement about external
projects, the hardware, muOS, the RPG Maker engines and Fear & Hunger comes
from memory and is **unverified** until checked. Numbers are estimates.

## Analysis

Six independent reviewers examined the concept. They agreed that emulating
browser APIs under unmodified game scripts is a defensible place to cut, and
that setting aside the JVM and the "replace PIXI with a native renderer"
option was reasonable. They also agreed the concept cannot be started as
written. It depends on one unmeasured assumption, leaves several blocking
decisions open, and has no measurable definition of success.

### 1. Feasibility is unproven and must be measured first

* **JavaScript speed without a JIT is the main risk.** QuickJS interprets
  code; it does not compile it to machine code. Keeping PIXI and all plugin
  logic in JavaScript means the per-frame work stays in the interpreter no
  matter how fast the native drawing code is. MV advances game logic in fixed
  1/60 s steps, so if one step takes longer than about 16 ms the game runs in
  slow motion. Speed is therefore a hard floor, not a third priority.
  Estimates of 30-100 ms of JavaScript per frame on a busy map on this CPU are
  unverified. This has to be measured on the device before any drawing or
  audio code is written.
* **A cheaper route has not been ruled out.** An embedded web engine such as
  WPE WebKit with the `cog` launcher would run the game with full
  compatibility and a JIT, with no emulation work. Whether it runs on muOS's
  graphics stack and how much RAM it needs are unverified. Existing projects
  (Kawariki, JoiPlay, PortMaster ports) should be searched first. No reviewer
  knew of an MV player that avoids Chromium, and none could confirm that none
  exists.
* **The RAM goal has no baseline.** "Substantially less than NW.js" cannot be
  tested. NW.js probably does not run on muOS at all, so the value may be
  "possible at all" instead of "less RAM". The goal needs an absolute
  on-device budget derived from the free RAM actually available under muOS.
* **The list of browser APIs to emulate does not exist.** "Only the APIs the
  game uses" is unbounded until someone records them. A missing API becomes a
  JavaScript error and then MV's error screen, which counts as a crash.

### 2. Scope is too wide for one developer

* **MZ is a second project.** MZ uses a newer PIXI, WebAssembly for effect
  animations (QuickJS has no WebAssembly), a different save format and
  IndexedDB. None of that helps the reference game.
* **"Any Linux machine with GLES2" is a compatibility promise** across GPU
  drivers that a solo developer cannot keep. Desktop Linux is still needed,
  but as the development and test host.
* **"Unmodified JavaScript" conflicts with stability.** Reproducing every
  plugin quirk is open-ended. Reviewers proposed a narrower rule: game files
  on disk are never edited, but the runtime may patch scripts in memory
  through a per-game overlay kept outside the game folder, and may replace
  known bundled libraries (for example the save-compression library) with
  native versions that expose the same functions.

### 3. Open decisions that block starting

* **Does the runtime present itself as NW.js or as a browser?** MV checks for
  Node's `require` and `process`. As NW.js it saves files to `www/save/`; as
  a browser it saves to localStorage. The concept said localStorage, which
  breaks save exchange with the PC copy and breaks plugins that call Node's
  `fs` module. Reviewers recommend presenting as NW.js with a small sandboxed
  `fs`/`path`/`process` shim.
* **C++ or Rust.** The code that passes JavaScript values to native code needs
  manual reference counting in C/C++ with QuickJS, which produces
  use-after-free crashes. Reviewers split: two favoured Rust, one C++17 with
  sanitizers, one said to decide after the engine and canvas library are
  chosen.
* **Canvas 2D is the largest and least bounded component.** MV draws all text,
  windows and gauges through it, and uses blend modes, clipping, gradients
  and pixel read-back. Text needs outlined glyphs and accurate width
  measurement or word wrap changes. Reviewers recommend one CPU rasteriser
  that implements only the recorded subset.
* **Web Audio should not be emulated as a general API.** MV uses one fixed
  arrangement of audio nodes; implementing that arrangement over a native
  mixer is far smaller than a general node graph.
* **WebGL is close to GLES2 but not identical.** Image flipping and alpha
  premultiplication on upload, stencil buffer configuration, and shader
  precision on Mali each need explicit handling and tests.
* **The "minimal DOM" is larger than it sounds.** MV shows its loading
  overlay, error message and video through DOM elements. A do-nothing video
  stub hangs the game because MV waits for the video's `ended` event.

### 4. The lighting plugin is the worst case

Fear & Hunger is believed to use a lighting plugin that redraws a full-screen
canvas every frame with radial gradients and additive blending, then uploads
it as a texture. The plugin's identity and behaviour are unverified. This
scene must be part of the speed measurement, and the plan needs a fallback:
an optimised native gradient path, a half-resolution light mask, or a native
replacement for that one plugin.

### 5. RAM costs that do not go away with Chromium

* **Images exist up to three times** in the browser model: the decoded image,
  MV's canvas copy, and the GPU texture. On Mali the GPU texture comes out of
  the same 1 GB. The runtime should keep only the texture and rebuild CPU
  pixels on demand.
* **Fully decoded audio** costs about 21 MB per minute of stereo music. The
  runtime should stream music from the compressed file.
* **There is no memory accounting.** On a 1 GB device with probably no swap,
  running out of memory ends in a silent kill by the kernel. The runtime
  needs one ledger covering the JavaScript heap, pixels, textures and audio,
  a hard budget, and a defined response when the budget is reached.

### 6. Success is not defined

"Playable", "without crashes" and "substantially less RAM" cannot be tested.
Fear & Hunger restricts saving (unverified), so one crash can cost an hour of
progress. The design needs: a named scripted play route plus a soak test of
two hours or more; a list of what counts as a crash (segfault, out-of-memory
kill, MV error screen, soft-lock, save corruption, audio dropouts); a
frame-rate floor; a peak memory ceiling on the device; start-up time limits;
and save files that load on the PC copy and survive power loss.

### 7. Nothing in the concept covers debugging

* A missing or wrong browser API is the dominant failure. Every host object
  should log the first access to an unknown property with the JavaScript
  stack.
* The handheld needs a runtime-owned error screen and a log file on the SD
  card; the runtime must never exit silently.
* Native crashes need a signal handler that writes a backtrace, and a
  watchdog that dumps the JavaScript stack when the main loop stalls.
* The developer's machine is macOS, which has no native OpenGL ES 2.0. A
  Linux virtual machine or a cheap Linux box is needed as the main
  development host.
* Recording and replaying input with a controlled clock and random seed gives
  a regression suite, a soak driver and a bug-report format.

### 8. Player experience on muOS is unspecified

* "RG35XX-series" covers different hardware; one model and one muOS version
  must be named.
* There is no install and launch description. It should follow PortMaster
  packaging conventions.
* Games written on Windows reference files with the wrong letter case; the
  runtime needs case-insensitive file lookup.
* MV's default 816x624 picture on a 640x480 panel shrinks text to about 22 px
  in a very dark game.
* MV reads both keyboard events and the Gamepad API; presenting both doubles
  every input.
* Save writes must be atomic (write to a temporary file, flush, rename, keep
  a backup) because handhelds are powered off abruptly.
* Sleep, resume and power-off behaviour must be defined.
* The runtime ships no game data, no RPG Maker scripts and no plugins, and
  includes no tool that unpacks executables or removes copy protection.

### 9. Device facts are unknown

The cross-compile cannot be specified until these are read off the device:
64-bit userland, C library and version, which SDL2 video backend works, which
GPU driver and extensions are present, swap, SD-card filesystem, free RAM
with the frontend running, and SSH access.

### 10. Prior-art search (2026-11-15, web search only)

A short web search, not an exhaustive one, found the following. Each item is
what the search results reported, not something tested here.

* No Chromium-free player for MV or MZ turned up. The Linux tools found
  (`rpgmakermlinux-cicpoffs`, a macOS launcher) swap in a native NW.js build
  and still run Chromium. EasyRPG covers only RPG Maker 2000 and 2003.
* No PortMaster port of Fear & Hunger or of any MV game turned up. The
  PortMaster port list itself was not checked directly.
* WPE WebKit can draw straight to the display through DRM/KMS with no
  Wayland compositor (a built-in platform from version 2.54 according to one
  source; `cog` is the older launcher with an experimental DRM plug-in).
* WPE cannot run without a working GPU driver.
* Reports on Mali boards include `cog` leaking file descriptors on the DRM
  path until it crashes, and `cog` falling back to CPU rendering.
* No RAM figures for WPE on a 1 GB device were found.

Consequence: the web-engine route depends on whether muOS on the reference
device exposes DRM/KMS and GBM, or only the vendor Mali driver on the plain
framebuffer. That is a device fact and has to be read off the device.

### 11. Facts read from the game files (2026-11-15)

Read from the author's copy, "Fear & Hunger Ver.1.4.1", by listing the
archive and extracting only its scripts and image headers. These replace the
matching "unverified" statements above. Nothing was run.

**Engine and packaging**

* RPG Maker MV core 1.6.0 with PIXI 4.5.4, plus `pixi-tilemap` and
  `pixi-picture`.
* A plain `www/` folder next to the Windows NW.js files. No packed
  executable to open.
* Images and audio are not encrypted (2,076 PNG, 433 OGG).
* Screen size is 816x624. Rendering mode is "auto", so PIXI picks WebGL when
  it is available.
* One video, `movies/intro.webm` (2.3 MB). A video answer is needed, even if
  it is "skip it".
* About 78,000 lines of core and library JavaScript and 55,000 lines of
  plugins.

**Plugins (48 enabled, 9 disabled)**

* The lighting plugin is TerraxLighting (1,889 lines). It is the only plugin
  that uses radial gradients, and one of two that set canvas blend modes.
* Only 2 enabled plugins name `PIXI.` directly (TerraxLighting and
  FilterController). This is a text count; plugins that extend MV's sprite
  and window classes still depend on PIXI without naming it. It weakens the
  reason given for rejecting the "high cut" but does not overturn it.
* 11 plugins call Node's `require` (`fs`, `path`, `nw.gui`) or `process`.
  The runtime has to present itself as NW.js or supply those modules.
* A Steam plugin (Archeia_Steamworks) is enabled and loads `greenworks`,
  which ships only as Windows binaries. It needs a stub.
* No plugin uses pixel read-back (`getImageData`), localStorage,
  WebAssembly, workers, IndexedDB or `fetch`.
* TDDP_FluidTimestep is enabled. It changes how game time advances per
  frame, so the "slow motion below 60 logic steps per second" concern has to
  be re-checked against this plugin.
* Keyboard-remapping and mouse-disabling plugins are present; input mapping
  needs a look at their settings.

**Content memory**

* All images decoded to 4 bytes per pixel total about 4.6 GB, against 495 MB
  on disk. Only a fraction is loaded at once, but the per-image cost is high.
* Battle sprites (`sv_actors`, 268 files) account for 3.1 GB of that. The
  largest are 2079x1386, about 11.5 MB each decoded. 278 images are wider or
  taller than 2048 pixels; none exceeds 4096.
* The game sets MV's image cache limit to 10 megapixels (about 40 MB decoded).
  Four large battle sprites alone are 46 MB, before any second copy.
* Ambient sound loops (`bgs`) total 123 MB compressed; the largest single
  file is 11.4 MB. Decoded fully into memory the way a browser does, one
  such file would take a few hundred MB. Streaming audio is required on a
  1 GB device, in either route.

**Other archives in the folder, not inspected**

* `FearGame2.rar` could not be listed with the tools on this machine.
* `Parche F&H.rar` is an overlay of `www/` files (images, audio, 69 plugin
  files). Its contents were not compared with the base game.

### 12. Web-engine experiment in a container (2026-11-15)

The reference device is now named: Anbernic RG35XX SP. Its muOS version and
graphics stack are still unread, so the experiment ran on the author's
computer instead.

**Setup.** A Debian 13 ARM64 container with WPE WebKit 2.48.3 and the `cog`
0.18.4 launcher, headless, with software OpenGL (Mesa llvmpipe). The game is
served over local HTTP with its files untouched. A small injected script
drives title, new game, first map, then a forced battle against troop 1, and
reports the scene, frame rate and time per logic step. Memory is read from
the container's cgroup. Files are in `lab/`; logs are in `lab/out/`.

**What worked**

* The game boots under WPE in browser mode with no Node shim. It reaches the
  pre-title scene, the title, the first map and a battle, with PIXI on WebGL.
* No missing-file requests, so no letter-case problems on this route.
* Two script errors at load, neither fatal: the Steam plugin fails on the
  missing `require`, and one plugin has a syntax error.

**Memory (program memory, excluding disk cache)**

| Point | Memory |
| --- | --- |
| WPE with a blank page | about 100 MB |
| 5 s after starting the game | about 500 MB |
| Title and first map | about 740-760 MB |
| Battle | about 1,040-1,060 MB, peak 1,196 MB |

* With a 1 GB limit the browser's page process is killed for memory as the
  battle starts. With a 3 GB limit the run completes.
* The browser itself is about 100 MB. The other 650 to 1,000 MB appears when
  the game loads, so it is game content as a browser holds it, plus the
  JavaScript heap. The premise "the browser is the RAM problem" is wrong for
  this game: removing the browser saves about 100 MB out of 1,000.

**Limits of this measurement**

* Software OpenGL keeps textures in ordinary RAM and adds its own overhead.
  On the device, Mali textures also come out of the same 1 GB, but the exact
  amount will differ. The split between images, audio and JavaScript heap
  was not measured.
* The battle was forced from the new-game state; a real battle may load
  different sprites.
* Speed on this computer says nothing about the device: logic steps took
  about 7 ms on a CPU many times faster than a Cortex-A53.
* Audio never started (the audio context stayed suspended without a user
  gesture), so decoded-audio memory may be under-counted.
* The device's 1 GB also has to hold muOS itself, so the real budget is
  lower than the 1 GB limit used here.

**Verdict.** The web-engine route, unchanged, does not fit a 1 GB device for
this game. It could fit only with content reductions (smaller battle
sprites, streamed audio), and those reductions are the same ones a custom
runtime would need. The next measurement is where the 650-1,000 MB goes.

### 13. Where the memory goes (2026-11-15)

Same container as section 12. The injected script now tracks every image,
canvas and decoded audio buffer the page creates and sums their sizes.
Separate probe pages (`lab/probes/`) load one thing at a time.

**Measured parts (first map, about 750 MB in total)**

| Part | Size | How it was measured |
| --- | --- | --- |
| Browser with a blank page | about 100 MB | blank-page run |
| Database files parsed into objects | about 90 MB | probe that only loads them |
| One WebGL context (software OpenGL) | about 45 MB | probe |
| Compiling all game scripts | about 10 MB | probe |
| Decoded images | 30 MB (52 MB in battle) | pixel count of live images |
| Canvases | 49-75 MB | pixel count of live canvases |
| GPU textures | 4-34 MB | PIXI's texture list |
| Decoded audio | 35-46 MB by sample count; 40 MB (map) to 120 MB (battle) by comparing runs with and without audio | both |
| Not attributed | about 300 MB (map), about 450 MB (battle) | remainder |

* The database is the surprise. `Troops.json` (12.5 MB) and
  `CommonEvents.json` (5.8 MB) hold 361,000 event commands. MV loads them at
  boot and keeps them for the whole session. Any runtime that runs the game's
  scripts unchanged pays this, in any JavaScript engine.
* Images, canvases and textures together are 100 to 160 MB. They are not the
  main cost in these scenes, contrary to what section 5 assumed.
* Switching PIXI from WebGL to its canvas renderer did not change the total.
* Turning off the JavaScript JIT lowered the total by about 60 to 100 MB.
* About 40% of the memory could not be attributed. WPE does not report the
  size of the JavaScript heap. The likely contents are live game objects,
  the browser's own copies of decoded images, and per-canvas overhead (the
  game creates 190 to 430 canvases), but this is a guess. A heap snapshot in
  Chrome's developer tools would settle it.

**Map size, events and the "load 50x50 tiles around the player" idea**

The author reports that on low-power systems walking on the map is already
unplayable, and proposed drawing and loading only a 50x50 tile window around
the player to save memory.

* MV already draws only the tiles on screen (about 17x13 at this
  resolution). The tile data of the largest map (145x105) is under 1 MB.
  A tile window would save almost no memory and no drawing time.
* What grows with map size is events. The median map has 127 events; eight
  maps have 400 to 572. MV updates every event on the map every frame and
  keeps a sprite for each, however far it is from the player. Many events
  also run "parallel" command lists every frame (up to 100 on one map).
* The useful form of the idea is therefore to skip updating and drawing
  events far from the player. Risk: events that are meant to act off-screen
  (chasing enemies, timers, parallel logic) would change behaviour, so each
  kind needs a rule.
* Time per logic step on the start map, which has only 4 events, was about
  7 ms on the author's computer. On a Cortex-A53 that is likely several times
  longer, which would exceed the 16 ms budget before any large map is
  loaded. The step time on a 500-event map and its split between events,
  lighting and drawing have not been measured yet.

### 14. Where the frame time goes (2026-11-15)

Same container. The injected script jumps from a new game straight to a
chosen map and times the engine's logic step, its drawing step, and the
WebGL calls inside the drawing step. Audio was off. Times are per frame on
the author's computer (Apple Silicon), with the JavaScript JIT on unless
stated.

| Map | Events | Logic | Drawing | Inside WebGL calls |
| --- | --- | --- | --- | --- |
| 10 (start) | 4 | 0.4-0.6 ms | 9.5-9.9 ms | 9.4 ms |
| 110 | 572 | 1.8-2.3 ms | 12.2-12.9 ms | 12.1 ms |
| 184 | 517 | 2.6 ms | 13.6 ms | not split |
| 93 | 412 | 1.7 ms | 13.0 ms | not split |
| 110, JIT off | 572 | 6.9-10.2 ms | 11.8-12.1 ms | 11.5 ms |

* **The drawing time is an artefact of this setup.** Nearly all of it is
  inside `drawElements`, which here is a CPU rasteriser standing in for a
  GPU. The JavaScript that prepares each frame's drawing takes 0.1 to 0.6
  ms. These runs say nothing about drawing speed on the Mali GPU.
* **Logic grows with event count.** From 4 to 572 events the logic step
  grows about five times. The largest part is updating the per-event
  sprites (1.4 of 2.3 ms on map 110); the events' own update is 0.2 to
  0.7 ms. The maps were entered from a new game, so events that only become
  active later in the story were idle, and real play may cost more.
* **The JIT matters about as much as the event count.** With the JIT off,
  logic on map 110 is three to five times slower (7 to 10 ms on this
  computer).
* **What this implies for the device, as an estimate only.** If a Cortex-A53
  core is around eight times slower than this computer (not measured), map
  110 costs about 15-20 ms of logic per frame with a JIT and 55-80 ms
  without one, against a 16.7 ms budget. An interpreter-only engine such as
  QuickJS would be at least as slow as the "JIT off" row. This supports the
  reviewers' main objection to the custom runtime with QuickJS, and it makes
  "skip far-away events and their sprites" the change most likely to matter
  on large maps in either route.
* The lighting plugin's own update could not be timed separately (its class
  is private to the plugin), and it may not have been active on these maps
  in a new-game state.

### 15. Event-culling prototype (2026-11-15)

`lab/overlays/event-culling.js` is an in-memory patch, loaded next to the
game without editing its files. It skips the per-frame update of events more
than 4 tiles outside the screen, and the update of their sprites. Events with
a parallel command list, events that are starting or locked, and events on a
forced move route keep running.

Logic time per frame on the author's computer, same method as section 14:

| Map | Events | JIT on, before -> after | JIT off, before -> after |
| --- | --- | --- | --- |
| 110 | 572 | 2.4 -> 2.1 ms | 12.0 -> 8.2 ms (-32%) |
| 184 | 517 | 1.7 -> 1.9 ms | 15.8 -> 9.1 ms (-43%) |
| 93 | 412 | 1.5 -> 1.5 ms | 10.4 -> 7.3 ms (-30%) |

* About three quarters of event and sprite updates were skipped.
* With the JIT on, the saving is within the run-to-run noise of about
  0.3 ms. With the JIT off, it removes 30 to 43% of the logic time.
* It is not enough alone. With the JIT off, 7 to 9 ms remain on this
  computer. Part of that is still the loop that visits every sprite to decide
  to skip it (2 to 3.6 ms); removing far sprites from the scene entirely
  would cut that further. The rest is outside events and sprites.
* Only speed was measured. Whether the game still behaves correctly was not
  tested: enemies that should chase from off-screen, events that move on
  their own while unseen, and animations that should be mid-cycle when they
  come into view may all differ.

### 16. JavaScript heap snapshot (2026-11-15) — corrects sections 12 and 13

The game was run in a Chromium-based browser (Brave 157, headless, temporary
profile) on the author's computer, driven through the developer-tools
protocol by `lab/chrome-heap.mjs`. After a forced garbage collection, the
script read the JavaScript heap size and took a heap snapshot at the title,
on the first map and in the forced battle.

| Point | JavaScript heap in use | Page process memory |
| --- | --- | --- |
| Database files only (probe page) | 25 MB | not comparable |
| Title | 32 MB | about 380 MB |
| First map | 33 MB | about 880 MB |
| Battle | 34 MB | about 940 MB |

* The whole game state, including the 361,000 event commands, is about
  33 MB of JavaScript heap: 1.3 million objects, mostly plain objects and
  arrays. It does not grow between scenes.
* The page process uses 25 times that. The memory that sections 12 and 13
  could not attribute is therefore **not** game objects. It is memory the
  browser itself allocates outside the JavaScript heap to hold and display
  media: decoded images, canvas backing stores, decoded audio, and copies
  made for the GPU.
* By pixel and sample counts (section 13) that media is 150 to 250 MB. The
  browsers spend three to four times as much holding it.

**Statements this corrects**

* Section 12 said that removing the browser would save about 100 MB out of
  1,000. That counted only the empty browser. Most of the remaining memory
  is also browser overhead, on top of roughly 35 MB of game objects and 150
  to 250 MB of media.
* Section 13 listed the parsed database as about 90 MB. That was the growth
  of the whole WebKit process when loading it; the objects themselves are
  about 25 MB in this engine.
* Section 13 guessed that the unattributed 40% was "live game objects". It
  is not.

**Limits**

* A different browser engine and operating system from the container runs,
  so process sizes are indicative only. The heap figure is for V8; another
  JavaScript engine may use more for the same objects.
* Which browser subsystem holds the extra memory (image cache, canvases,
  audio, compositor) was not measured.

### 17. Minimal runtime without a browser (2026-11-15)

`lab/minimal/run.js` runs the game's own scripts in a bare JavaScript engine
(Node 22, so V8) with no browser. About 250 lines of stand-in objects replace
the browser: a document and elements, a canvas context that accepts every
call and draws nothing, images that read only their size from the PNG header,
file-backed `XMLHttpRequest`, and local storage. PIXI runs in its canvas
mode. Two bundled libraries (the FPS meter and the inline-video helper) are
replaced by empty stand-ins. Audio is off. Game files are not modified.

**Result.** The unmodified game boots through the pre-title scene and title
and runs a map, with all enabled plugins loaded. The only load errors are the
same two seen in the browsers.

Whole-process memory and logic time per step on the author's computer:

| Map | Events | Process memory | JIT on | JIT off | JIT off + culling |
| --- | --- | --- | --- | --- | --- |
| 10 (start) | 4 | 141 MB | 0.34 ms | 0.60 ms | 0.61 ms |
| 93 | 412 | 151-178 MB | 0.99 ms | 4.39 ms | 2.91 ms |
| 110 | 572 | 167-181 MB | 0.80 ms | 3.02 ms | 1.94 ms |
| 184 | 517 | 167-179 MB | 0.87 ms | 3.58 ms | 2.72 ms |

* **Memory.** The whole process is 140 to 180 MB with the game running on a
  map, against 750 MB or more in a browser. The JavaScript heap is 65 to
  73 MB (higher than the 33 MB seen in section 16; the stand-in objects and
  PIXI's canvas mode account for part of the difference). No pixels or audio
  are held, so real media must be added on top: by section 13's counts,
  roughly 100 to 250 MB depending on the scene and on whether audio is
  streamed.
* **Logic time.** Lower than inside WPE (section 14: 2.3 ms with JIT, 12 ms
  without, on map 110). Inside a browser the logic step also pays for real
  canvas and DOM calls, and the engines differ. Here those calls cost
  nothing, so these figures are a floor, not a prediction.
* **Without a JIT the engine is 3 to 4.5 times slower on large maps**, and
  culling recovers 20 to 35% of that.
* **Estimate for the device, not a measurement.** At about eight times
  slower per core, large maps would cost 6 to 8 ms per step with a JIT,
  24 to 35 ms without, and 16 to 23 ms without a JIT but with culling,
  against a 16.7 ms budget. QuickJS was not tested; these "JIT off" figures
  are V8's interpreter, and QuickJS may be slower or faster.

**What this does not show**

* Drawing. Nothing is rendered, so the cost of PIXI's WebGL path, of real
  Canvas 2D text and of the lighting plugin is absent.
* Correct behaviour. The game reaches a map and steps without errors; no
  one has checked that it plays correctly.
* Linux on ARM. The run was on macOS; process memory on the device will
  differ somewhat.

### 18. Minimal runtime with real drawing (2026-11-15)

The minimal runner from section 17 was given a real Canvas 2D implementation
(the `canvas` package for Node, backed by the Cairo library) in place of the
do-nothing stand-ins. Images are really decoded, text is really drawn with
the game's font, and PIXI's canvas mode composes each frame on the CPU. It
ran in an ARM64 Linux container limited to 1 GB of memory and one CPU core.
Audio is still off and there is no GPU path. Files: `lab/minimal/`.

**Result.** The unmodified game draws correct frames with no browser. Two
saved frames were inspected by eye: the character-selection screen (portraits,
window frame, outlined text in the game font) and map 184 (tiles, objects,
and the lighting plugin's darkness with a radial light). Frames are saved in
`lab/out/shots/`.

Per frame on the author's computer, whole-process memory in the container:

| Map | Events | Memory | Logic, JIT / no JIT | Drawing | With culling (no JIT): logic / drawing |
| --- | --- | --- | --- | --- | --- |
| 10 (start) | 4 | 229 MB | 2.9 ms / not run | 5.7 ms | not run |
| 93 | 412 | 226-267 MB | 2.8 / 4.6 ms | 3.7-4.0 ms | 3.7 / 3.5 ms |
| 110 | 572 | 247-290 MB | 3.0 / 5.1 ms | 4.2-4.6 ms | 3.9 / 3.8 ms |
| 184 (lighting on) | 517 | 254-282 MB | 2.6 / 5.3 ms | 3.8-4.1 ms | 4.2 / 3.4 ms |

* **Memory.** 230 to 290 MB for the whole process with real decoded images
  and real canvases, inside a 1 GB limit. The same scenes took 750 MB or
  more in a browser. Audio is not included; streamed audio would add little,
  fully decoded audio 40 to 120 MB.
* **Logic costs more than in section 17** (about 3 ms against 1 ms with a
  JIT) because the logic step includes real canvas work: text, gauges and
  the lighting mask.
* **CPU drawing is too slow for the device.** Drawing takes 3.3 to 5.7 ms
  per frame here. At eight times slower that is 26 to 46 ms for drawing
  alone, so a whole frame would take 50 to 80 ms: roughly 12 to 20 frames
  per second. This is an estimate. The device needs the GPU path (PIXI's
  WebGL renderer over OpenGL ES), which this experiment does not cover.
* **A browser quirk that had to be reproduced.** Map 184 first failed with
  "invalid arguments". The lighting plugin calls `createRadialGradient` with
  a value that is not a number, about 100 times per second. Browsers convert
  such arguments to numbers before the call; the canvas library does not.
  After adding that conversion to the runner the map works. Every native
  function a custom runtime exposes will need the same argument conversion
  rules browsers apply.

**What this does not show**

* The GPU path, audio, input, saving, or video.
* Behaviour over time: each run lasted under a minute from a new game.
* Anything on the device.

### 19. Minimal runtime through WebGL (2026-11-15)

The runner from section 18 was also given a WebGL implementation for Node
(the `gl` package, "headless-gl", compiled from source for ARM64 Linux), so
PIXI uses its WebGL renderer. In this container WebGL is executed by a
software OpenGL under a virtual display, so **no timing from this section
applies to the device**. The purpose was to find out whether the game's
WebGL path works without a browser and what it needs. Files:
`lab/minimal/Dockerfile.gl`, `lab/minimal/with-display.sh`.

**Result: partly working.**

| Scene | Through WebGL | Process memory (1 GB limit) |
| --- | --- | --- |
| Character selection (map 10) | correct, identical to the CPU frame | 355 MB |
| Map 110 (572 events) | drawn: 46% of pixels lit, against 39% on the CPU path | 456 MB |
| Map 184 (lighting active) | **black frame**; cause not found | 457 MB |
| Map 93 | **black frame**; cause not found | 406 MB |

* After start-up the game uses 35 distinct WebGL functions, at 120 to 190
  calls per frame. The list is in `lab/out/gl-*.out`. This is the first
  version of the "which browser functions does the game use" list for the
  graphics layer.
* Memory is higher than on the CPU path (355 to 457 MB against 230 to
  290 MB) because the software OpenGL keeps its own copy of every texture in
  ordinary memory. A real GPU driver also takes texture memory from the same
  1 GB on this device, so this is closer to the real cost than section 18.

**Faults found on the way, and what each one says**

1. *Crash on a failed shader.* When a shader fails to compile, PIXI goes on
   to link the program anyway, and the WebGL library aborts the process. A
   custom runtime must survive that sequence.
2. *A reserved word.* Five of PIXI's shaders use a local variable named
   `sample`. That is legal in the shader language WebGL and OpenGL ES 2.0
   use, but reserved in the desktop OpenGL underneath this library. The
   runner renames it. A real OpenGL ES 2.0 driver should not need this.
3. *The whole map goes through a filter in WebGL mode.* The engine applies a
   tone filter to the entire map, which means drawing the map into an
   off-screen texture first. Pictures and windows do not go through it,
   which is why the selection screen worked while maps were black.
4. *Array uniforms looked up by bare name.* PIXI asks for an array uniform
   as `m`; this library only answers to `m[0]`. Browsers and OpenGL ES accept
   both. The filter was left with zeros and drew black. With the standard
   behaviour added in the runner, map 110 draws.
5. *Still open.* Maps 184 and 93 remain black through WebGL although they
   draw correctly on the CPU path. No WebGL errors are reported and the
   off-screen framebuffers are complete. The cause was not found; it may be
   another gap in this library or a real problem in the WebGL path.

**What this means**

* The WebGL path is not proven. One map draws, two do not.
* Each fault above cost an investigation of its own, on a library that
  already claims to implement WebGL. Writing the WebGL layer from scratch
  over OpenGL ES, as the original concept proposed, will meet the same
  class of problems. The reviewers' warning that WebGL is "not a
  pass-through" is confirmed by experience here.
* Reusing an existing, tested WebGL-over-OpenGL-ES implementation is
  preferable to writing one.

## Goals vs. Non-Goals

* **In-Scope Goals (proposed, pending the measurements below):**
    * Run Fear & Hunger (RPG Maker MV, the exact core version it ships) on one
      named 1 GB RG35XX model under one named muOS version.
    * Never edit game files on disk.
    * Present the runtime to the game as NW.js, with save files that load on
      the PC copy and the reverse.
    * Meet numeric floors for stability, frame rate and peak memory, to be set
      after measurement.
    * Desktop Linux build as the development and test host.
    * Error screen, log file and crash report on the device.
* **Out-of-Scope Non-Goals:**
    * RPG Maker MZ in the first version (later phase with its own API
      recording and a WebAssembly decision).
    * MV 1.2 and earlier.
    * A compatibility promise for arbitrary Linux machines or GPU drivers.
    * General plugin compatibility beyond the reference game.
    * HTML/CSS parsing or layout, network access, WebGL2, web workers,
      WebAssembly, IndexedDB, developer tools, non-Linux hosts.
    * Video playback, unless the API recording shows the game needs it.
    * Unpacking packed executables or bypassing copy protection.

## Alternatives Weighed

* **JVM with Rhino or GraalJS.** Set aside because of JVM heap size and JIT
  warm-up on a 1 GB Cortex-A53; Rhino also interprets and may lack the
  JavaScript features the scripts need. Stated as an assertion so far; it
  becomes a tested claim once a minimal JVM running the MV core is measured
  on the device.
* **Replace PIXI and the core rendering scripts with a native renderer, run
  only game logic ("high cut").** Set aside because plugins call PIXI
  directly. To be confirmed by counting how many of the game's plugins
  reference PIXI.
* **Keep PIXI but replace measured hot paths with native code ("mid cut").**
  Not rejected. Held as the fallback if interpreter speed is close to but
  over the limit.
* **Embedded web engine (WPE WebKit with `cog`, or a stripped single-process
  Chromium).** Not yet tested. If it runs the game acceptably on the device,
  the case for a custom runtime is gone unless the project is done for the
  sake of building it.
* **Stock NW.js with tuned flags, plus zram or swap.** Not yet tested;
  near-zero cost to try.
* **A larger JavaScript engine (JavaScriptCore, V8 with or without JIT,
  Hermes).** Held as the fallback if QuickJS is too slow. Most of NW.js's RAM
  is the browser, so a bare JIT engine may still meet the memory goal.

## Key Decisions & Staging for Next Steps

**Position after the lab measurements (sections 11 to 16)**

* The starting premise holds for memory, in a different form than first
  stated. The game needs about 35 MB of JavaScript objects and 150 to 250 MB
  of decoded media. A browser uses 750 to 1,050 MB to run it. The gap is
  browser overhead, and it is larger than the empty browser's 100 MB.
* A minimal runtime without a browser was built and measured (sections 17
  and 18). The unmodified game boots, runs maps and draws correct frames in
  230 to 290 MB of process memory inside a 1 GB limit, against 750 MB or
  more in a browser. Audio and the GPU path are not built.
* Drawing on the CPU is estimated at 12 to 20 frames per second on the
  device. The GPU path is required. A first attempt (section 19) runs but
  draws two of four test maps black, and it is the largest remaining
  unknown.
* The engine choice decides the frame rate on large maps. With a JIT the
  logic step has room to spare even at eight times slower. Without a JIT it
  is over budget on large maps unless event culling and further cuts are
  added. On a 64-bit ARM Linux device a JIT engine (V8 or JavaScriptCore) is
  available, so the custom runtime should embed one of those, with QuickJS
  only as a fallback.
* The web-engine route runs the game today but does not fit in 1 GB
  unchanged. It might be made to fit by tuning the browser's caches and by
  shrinking media, which was not tried.
* Skipping far-away events helps per-frame logic by 30 to 43% without a JIT
  and is worth keeping in either route.
* Nothing has been measured on the device. Drawing speed on the Mali GPU,
  whether WPE can display there at all, and real CPU speed are all unknown.

**Next steps, in order**

1. Install muOS on the RG35XX SP and read the device facts (section 9).
2. Done (section 16): the heap snapshot shows the unattributed memory is
   browser overhead, not game objects.
3. Try WPE on the device. If it cannot display or cannot be tuned under the
   memory budget, build the custom shell around a JIT engine, not QuickJS.
4. Done (section 17): a minimal runtime runs the game's logic without a
   browser in 140 to 180 MB.
5. Done on the CPU (section 18): the minimal runtime draws correct frames.
6. Started (section 19): the WebGL path runs without a browser but two of
   four test maps draw black. Find the cause, then time the path on the
   device. Speed cannot be judged on the author's computer.
7. Add streamed audio, input and file saves to the minimal runtime.
8. Test whether event culling keeps the game's behaviour intact.

**Decided during ideation**

* Target is MV first; the reference game is Fear & Hunger.
* Reference platform is a 1 GB RG35XX-series device on muOS.
* No JVM and no Chromium in the runtime.
* Priority order is stability, RAM, speed, applied only above hard floors for
  all three.

* MV only. MZ is out of the first version (decided 2026-11-15).
* Measure before designing. The embedded web engine route (WPE WebKit) is
  tried first; the custom runtime is built only if that route fails on the
  device or misses the memory budget (decided 2026-11-15).

**Recommended by reviewers, awaiting the author's decision**

* Present as NW.js and make PC save compatibility a goal.
* Allow in-memory patching through a per-game overlay.
* Treat desktop Linux as the primary development host.

**Open, to be settled by measurement before any runtime code**

Order agreed on 2026-11-15: steps 1 and 2, then step 6 (the web-engine
attempt), then the rest only if step 6 fails.

Pass/fail rule for step 6, to be given numbers once step 2 reports free RAM:
the game reaches the first map and a battle on the device, with GPU
rendering, without being killed for memory, and with logic at full speed.

1. Read the game folder: core and PIXI versions, plugin list, whether assets
   are encrypted, resolution, packaging.
2. Read the device: the facts listed in section 9, and in particular whether
   `/dev/dri/card0` and GBM exist.
3. On desktop, run the game in NW.js with the JIT disabled and CPU throttled,
   and record script time per frame on a lit map.
4. On desktop, record every browser API the game touches along a fixed route.
   This list is the scope document.
5. Measure NW.js memory on desktop for the same scene, split into browser,
   JavaScript heap, GPU and audio.
6. Search for existing projects and time-box a WPE/cog attempt on the device.
7. Run the real MV scripts and plugins under QuickJS on the device with
   drawing and audio stubbed out, against a time limit written down before
   measuring (reviewers proposed 12 ms per logic step; one proposed 33 ms).
8. Then fix, in this order: JavaScript engine, Canvas 2D library, language
   (C++ or Rust), and numeric success criteria.

**Reviewer disagreements carried forward**

* Language default: Rust versus C++17 with sanitizers.
* Kill threshold for the speed test: 12 ms versus 33 ms per logic step.
* Behaviour on a missing API in the player build: always fail loudly versus
  log quietly.
