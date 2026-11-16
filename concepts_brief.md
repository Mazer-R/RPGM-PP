# Native RPG Maker MV Runtime for Low-RAM Linux Handhelds

* **Author:** mcerezo
* **Date:** 2026-11-15

## Overview

RPG Maker MV games ship inside NW.js, which is a Chromium browser plus Node.
On a 1 GB ARM handheld that player either does not run or cannot hold the
game in memory, and where a browser does run, the game is too slow to play.

The concept is a native Linux program that runs an MV game's own JavaScript
(the engine's core scripts, the bundled PIXI.js and the game's plugins)
without a browser. It embeds a JavaScript engine with a JIT compiler, and
supplies only the browser features those scripts call: WebGL through OpenGL
ES 2, Canvas 2D, audio, and a small set of window and document objects.
Windowing, input and audio output go through SDL2. Game files are never
edited; where the game needs help to run well on the device, the runtime
applies small patches in memory.

The reference target is the commercial MV game Fear & Hunger (version
1.4.1, MV core 1.6.0, PIXI 4.5.4) on an Anbernic RG35XX SP: four Cortex-A53
cores, a Mali-G31 GPU, 973 MB of RAM, running muOS 2502.0 on a 4.9 kernel.
The project is personal and has one developer whose strongest language is
Java.

**What the measurements say, in short**

* A browser needs 750 to 1,050 MB to run this game. The same game runs
  without a browser in 220 to 275 MB on the device, with real decoded images
  and real canvas work. The device has about 800 MB available and no swap.
* The device has no DRM/KMS display interface, only the maker's Mali driver
  on the framebuffer, so an embedded web engine cannot display there as
  shipped. SDL2 and OpenGL ES 2 are present and work from a plain program.
* A JIT is required. Node's V8 runs on the device; without the JIT the
  logic step on large maps takes 40 to 77 ms.
* The game was unplayable on such hardware mainly because of one call: the
  lighting plugin fills the screen with a radial gradient on every step,
  which takes about 40 ms on the device's processor.
* With three in-memory patches (skip far-away map events, draw the lights
  through WebGL, update the lights every third step), two logic steps and
  one frame preparation take about 23 and 32 ms on the two large test maps,
  against the 33.3 ms that 30 drawn frames per second allows. Small maps
  have room for 60.
* Not built or measured yet: the real WebGL layer on the device's driver,
  audio, input, saving, video, and whether the game still plays correctly
  with the patches over a real session.

**How to read this document.** Sections 1 to 9 are the reviewers' findings
on the original idea, written before anything was measured; many of their
"unverified" statements are settled later. Sections 10 to 28 are the
measurements, in the order they were made. Later sections correct earlier
ones where noted. The sections after the analysis state the current
position.

## Analysis

Six independent reviewers examined the original concept, which proposed a
small interpreter-only JavaScript engine (QuickJS). They agreed that
emulating browser APIs under unmodified game scripts is a defensible place
to cut, and that setting aside the JVM and the "replace PIXI with a native
renderer" option was reasonable. They also agreed the concept could not be
started as written: it depended on one unmeasured assumption, left several
blocking decisions open, and had no measurable definition of success.

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
   off-screen framebuffers are complete. Ruled out so far, each by a run
   with that element removed: the lighting plugin's darkness layer (map 184
   stays black with it hidden, while the CPU frame without it is 59% lit),
   and the screen tone (neutral on all three maps, and clearing it changes
   nothing). Neither map uses a parallax background; map 110, which works,
   is the only one with a fog layer. The cause was not found; it may be
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

### 20. Device facts (2026-11-15)

Read from the author's Anbernic RG35XX SP over SSH with
`lab/device-facts.sh`, which only reads. Raw output is in
`lab/out/device-facts.txt`. These replace the "unverified" device statements
in sections 8 and 9.

| Fact | Value |
| --- | --- |
| System | muOS 2502.0 "Pixie" (its `os-release` still says 2410 "Banana") |
| Kernel | Linux 4.9.170, 64-bit ARM, the chip maker's kernel |
| CPU | 4 cores, Cortex-A53 (CPU part 0xd03) |
| Memory | 973 MB total, about 818 MB available with the system idle, no swap |
| Display | `/dev/fb0` (640x480, double-buffered) and `/dev/mali0`; **no `/dev/dri`** |
| Graphics libraries | `libMali`, EGL, OpenGL ES 2 |
| SDL | SDL2 2.28.5, with SDL2_mixer, SDL2_image and SDL2_ttf |
| Audio | ALSA and PulseAudio libraries; PipeWire is running |
| C library | glibc 2.38 (Buildroot), 64-bit userland with a 32-bit loader also present |
| Storage | system on ext4 (3.1 GB free); SD data partition is exFAT through FUSE (45 GB free) |
| Tools | Python 3 present; no Node, no gdb, no strace |

**What this settles**

* **The web-engine route is out as shipped.** There is no DRM/KMS device,
  only the maker's Mali driver on the plain framebuffer. WPE WebKit's
  direct-to-display mode needs DRM/KMS. Using WPE would mean writing a new
  display backend for this driver, which removes the route's "no code to
  write" advantage. Together with its memory use (section 12), this route is
  set aside.
* **The custom runtime's platform choice fits the device.** SDL2 and OpenGL
  ES 2 are present and are what the system's own emulators use. The runtime
  should link the device's own SDL2, which carries the working video driver
  for this Mali setup.
* **The memory budget is about 800 MB with no swap.** The runner measured
  230 to 460 MB on the development machine (sections 18 and 19), so there is
  headroom, pending a measurement on the device.
* **Game files will sit on exFAT.** It ignores letter case, which hides the
  wrong-case asset problem on this device, and it does not make file renames
  crash-safe, so save files need the backup-and-validate scheme from
  section 8.
* **Debugging tools are absent**, so the runtime has to produce its own
  crash reports and logs, as section 7 proposed.

**Still unknown**

* Whether a current Node build starts on a 4.9 kernel (Node states a minimum
  of 4.18). glibc 2.38 is new enough.
* Real speed of the CPU and of the Mali GPU. Nothing has been timed on the
  device yet.

### 21. First measurement on the device (2026-11-15)

The minimal runner (section 17: the game's own scripts in bare Node, with
drawing and audio stubbed out) was copied to the RG35XX SP and run there
over SSH by `lab/device-run.sh`. The bundle holds a Node 22 build for 64-bit
ARM, the runner, and the game's scripts and data only. It uses no display
and no GPU. Raw output: `lab/out/device-run.txt`.

**Quick run: start map (4 events), 20 seconds of measurement each**

| | On the device | On the development machine | Ratio |
| --- | --- | --- | --- |
| Logic step, JIT on | 2.74 ms median, 3.95 ms at the 95th percentile, 16.0 ms worst | 0.34 ms | 8.1x slower |
| Logic step, JIT off | 5.75 ms median, 7.05 ms at the 95th percentile, 9.5 ms worst | 0.60 ms | 9.6x slower |
| Boot to first scene | 2.3-2.4 s | about 0.1 s | |
| Process memory | 142 MB (JIT on), 121 MB (JIT off) | 141 MB | same |
| JavaScript heap | 66-68 MB | 66-67 MB | same |

* **Node 22 starts on this 4.9 kernel**, despite its stated minimum of 4.18.
  A JIT JavaScript engine (V8) therefore runs on the device as it is.
* **The "about eight times slower" assumption used in sections 14 to 18 was
  close**: 8.1 times with a JIT, 9.6 times without.
* **Memory matches the development machine.** With the system idle the
  device reported about 814 MB available before and after.
* On this small map the logic step fits the 16.7 ms budget with room to
  spare in both modes. The worst single step with the JIT on (16 ms) is at
  the budget, most likely a compilation or garbage-collection pause.

**Not yet measured on the device**

* The large maps (110 and 184), with and without event culling. This is the
  same script without the quick flag.
* Anything involving drawing, the GPU or audio.

### 22. Large maps on the device (2026-11-15)

Full run of `lab/device-run.sh` on the RG35XX SP: the same stubbed runner as
section 21, 20 seconds of measurement per case, ten cases. No drawing, GPU
or audio. Raw output: `lab/out/device-run-full.txt`.

Logic step on the device, median (95th percentile):

| Map | Events | JIT on | JIT on + culling | JIT off | JIT off + culling |
| --- | --- | --- | --- | --- | --- |
| 10 (start) | 4 | 2.7 ms (3.8) | not run | 5.9 ms (7.1) | not run |
| 110 | 572 | **17.5 ms** (22.8) | 11.5 ms (15.9) | 64.2 ms (67.8) | 39.5 ms (41.9) |
| 184 | 517 | **20.4 ms** (28.5) | 13.3 ms (21.3), see note | 77.3 ms (101.4) | 53.0 ms (76.8) |

Process memory was 121 to 163 MB in every case, and the device reported
about 813 MB available afterwards.

* **Large maps are over budget on the device even with a JIT.** One logic
  step takes 17 to 20 ms against a budget of 16.7 ms, before any drawing.
  The game would run in slow motion on these maps.
* **The earlier estimate was too optimistic for large maps.** The device is
  about 8 times slower than the development machine on the small map but
  about 22 times slower on map 110 (17.5 ms against 0.8 ms). The likely
  reason is that updating hundreds of scattered objects suits a small
  processor cache badly; this was not investigated. Sections 14, 17 and 18
  projected 6 to 8 ms for this case.
* **Event culling brings the median under budget with a JIT**: 11.5 ms on
  map 110, a 34% saving. That leaves about 5 ms per frame for drawing, and
  the 95th percentile is already at the budget. It is not enough alone.
* **Without a JIT the device is 3.5 to 4 times slower again**, at 40 to
  77 ms per step. An interpreter-only engine is ruled out for this game on
  this device.
* **Note on map 184 with culling.** That run ended on the game-over scene,
  while the run without culling stayed on the map. The culled run advanced
  more game steps in the same time (1,188 against 870), so the player, left
  standing still, may simply have been killed sooner. It may also be a
  change of behaviour caused by culling. This was not investigated, and it
  makes that case's timing unreliable because game-over steps are cheap.

**What this means for the plan**

* A JIT engine is required, and is available: Node's V8 runs on the device.
* Per-frame logic on large maps must come down by roughly half before
  drawing is added. Candidates, none measured yet: remove far sprites from
  the scene instead of visiting them, cull more aggressively, and render
  every second frame so that two logic steps and one draw fit in 33 ms.
* A realistic target for this device is the game at full speed with about
  30 drawn frames per second on large maps, not 60.

### 23. Reducing the logic step on the device (2026-11-15)

All figures in this section were measured on the RG35XX SP with the JIT on,
over 700 logic steps per case, with drawing and audio stubbed out. Raw
output: `lab/out/device-matrix.txt`, `lab/out/device-matrix-v3.txt`,
`lab/out/prof/`.

**The game-over on map 184 is not caused by culling.** Run for a fixed 1,500
steps on the development machine, the game leaves the map at step 865 or 866
with no overlay, with the first overlay and with the second. The player, left
standing where the test places it, dies at the same moment in all three.

**Where the time goes (CPU profile on the device, culling on)**

| Share of logic time | Map 110 | Map 184 |
| --- | --- | --- |
| Lighting plugin rebuilding its darkness mask | 22% | 11% |
| Re-evaluating event page conditions | 9% | 7% |
| Engine object code in total (`rpg_objects.js`) | 36% | 47% |
| Lighting plugin in total | 24% | 13% |

* The lighting plugin rebuilds its mask on every logic step, and that one
  function is the largest single cost on both maps.
* The engine re-evaluates the page conditions of every event on the map on
  every step: about 750 re-evaluations per step on map 110. Something in the
  game changes a switch or variable each step, which marks the whole map for
  refresh.
* On map 184 most of the remaining time is event command lists running.

**Three overlay versions, median logic step (95th percentile)**

| Overlay | Map 110 | Map 184 |
| --- | --- | --- |
| None | 18.0 ms (22.8) | 21.1 ms (29.0) |
| v1: skip far events and their sprites | 11.9 ms (16.4) | 15.0 ms (21.9) |
| v2: keep lists of near events, detach far sprites | 11.3 ms (15.9) | 14.4 ms (21.2) |
| v3: v2 + lazy page refresh | 11.6 ms (16.4) | 14.1 ms (21.2) |
| v3 + lighting mask every 2nd step | 10.5 ms (16.6) | 12.7 ms (19.9) |
| v3 + lighting mask every 3rd step | **8.9 ms** (15.2) | **12.6 ms** (20.0) |

* Map 110 goes from 18.0 to 8.9 ms, about half. Map 184 goes from 21.1 to
  12.6 ms.
* The second version barely improves on the first: visiting far sprites was
  not the remaining cost.
* Lazy page refresh defers three quarters of the re-evaluations but saves
  under 1 ms, so those checks are cheap individually.
* Throttling the lighting mask is the most effective single change after
  culling. It makes light flicker and movement update 20 times per second
  instead of 60; how that looks was not checked.

**What this leaves for drawing**

With the best overlay, the median leaves about 8 ms per frame on map 110 and
4 ms on map 184, and the 95th percentile is at or over the budget on both.
Drawing has not been measured on the device. Drawing every second frame
would give two logic steps and one draw 33 ms to share: about 18 ms of logic
on map 110 and 25 ms on map 184, leaving 15 and 8 ms for the draw.

**Not verified**

* That the game still plays correctly with any of these overlays. Only speed
  and "the scene is still the map" were checked.
* Real play. Every case starts from a new game with the player standing
  still at the centre of the map.

### 24. The GPU on the device (2026-11-15)

`lab/device-gles-test.py` opens the device's screen through SDL2 and its
Mali video driver, the way the system's emulators do, and draws synthetic
workloads with OpenGL ES 2. It is written in Python with `ctypes` against
the device's own libraries, so nothing had to be compiled. The muOS menu is
paused while it runs and resumed afterwards (`lab/device-gles-run.sh`); it
came back both times. No game content is involved. Raw output:
`lab/out/device-gles.txt`.

**What the driver reports**

| Item | Value |
| --- | --- |
| GPU and driver | Mali-G31, OpenGL ES 3.2, driver r20p0 |
| SDL video driver | `mali` (the only one built into the device's SDL2) |
| Largest texture | 8192 pixels |
| Stencil buffer | 8 bits |
| Off-screen framebuffer with a texture | complete |
| Fragment shader precision | `mediump` 10 bits, `highp` 23 bits |

* OpenGL ES works outside the system's emulators, from a plain program
  started over SSH.
* **`mediump` has only 10 bits of precision** in fragment shaders. PIXI's
  shaders declare `mediump`, which is too coarse to address pixels in a
  2048-wide texture and is a known cause of seams between tiles. `highp` is
  available, so the runtime should rewrite shaders to use it. This confirms
  the reviewers' warning in section 3.

**Timings (whole frame, including the buffer swap)**

The swap always waits for the 60 Hz refresh, whatever swap interval is
asked for, so a frame costs 16.7 ms or a multiple of it.

| Workload per frame | Frame time |
| --- | --- |
| Empty frame | 16.7 ms |
| Up to 32 full-screen blended layers straight to the screen | 16.7 ms |
| 64 such layers | 33.4 ms |
| Up to 16 layers into an 816x624 off-screen texture, then scaled to the screen | 16.7 ms |
| 32 layers that way | 33.0 ms |
| Re-uploading an 816x624 texture every frame, plus 4 layers | 16.7 ms |

Where the driver let the draw time be read separately from the wait: 4.0 ms
for 4 layers through the off-screen texture, 5.9 ms for 8 and 10.7 ms for
16, so roughly 0.6 ms per full-screen layer at the game's resolution. In
most cases `glFinish` also waited for the refresh, so those are the only
separate figures.

**What this means**

* The GPU is not the bottleneck. A map scene is a handful of full-screen
  layers (two tile layers, fog, the lighting mask, the tone filter's
  off-screen pass) plus small sprites, well inside what fits in one refresh.
  Re-uploading the lighting mask every frame also fits.
* GPU time runs alongside the processor, so it does not add to the logic
  step in full. What does add is the processor time PIXI spends preparing
  each frame and the driver spends on about 150 calls. That is **not
  measured on the device** yet and is the remaining unknown for frame rate.
* Because every swap waits for the refresh, a frame that misses 16.7 ms
  costs 33.3 ms. With logic at 9 to 13 ms on large maps, the game will
  settle at 30 drawn frames per second there unless logic plus preparation
  fits in 16.7 ms.

**Correction (added while drafting the design, 2026-11-15).** The last
point above is wrong for the game's case. A later test presented frames
from a native program with processor work between them
(`lab/out/node-screen-test.txt`): with 22 ms of work per frame, a frame took
23.5 ms, not 33.3 ms. When a frame is late because of the processor, the
swap returns at once and the frame costs only its overrun. The 33.3 ms
figures in the table above come from cases where the GPU itself was the
cause of the delay. On large maps the game therefore slows gradually with
the time each frame really takes, and does not drop straight to 30 frames
per second.

### 25. PIXI's frame preparation on the device (2026-11-15)

To time the processor side of drawing without a GPU, the stubbed runner was
given a WebGL context that accepts every call and draws nothing
(`lab/minimal/fake-webgl.js`). PIXI then runs its real WebGL renderer: it
walks the scene, builds its batches and sets its uniforms, and only the
driver's work is missing. The context answers PIXI's questions about each
shader program by reading the declarations in the shader source. Measured on
the RG35XX SP with the JIT on, 700 logic steps per case. The console was
reached over USB with `adb` for this run. Raw output:
`lab/out/device-draw-prep.txt`.

Median (95th percentile), per logic step and per drawn frame:

| Map | Overlay | Logic step | Frame preparation | WebGL calls per frame |
| --- | --- | --- | --- | --- |
| 10 (4 events) | none | 2.8 ms (3.8) | 2.7 ms (3.4) | 224 |
| 110 (572 events) | none | 18.2 ms (23.2) | 10.6 ms (11.7) | 244 |
| 110 | v3, light every 3rd step | 9.2 ms (15.2) | 3.3 ms (4.9) | 199 |
| 184 (517 events) | none | 20.7 ms (27.9) | 7.9 ms (9.6) | 269 |
| 184 | v3, light every 3rd step | 12.1 ms (19.8) | 2.9 ms (4.2) | 167 |

* **Culling helps drawing as much as logic.** Detaching far sprites cuts
  frame preparation from 10.6 to 3.3 ms on map 110 and from 7.9 to 2.9 ms
  on map 184.
* **One logic step plus one frame preparation, with the third overlay:**
  12.5 ms on map 110 and 15.0 ms on map 184 at the median, inside the
  16.7 ms refresh. At the 95th percentile they are 20 and 24 ms, which
  misses the refresh.
* **At 30 drawn frames per second** (two logic steps and one draw per 33.3
  ms): 21.7 ms on map 110 and 27.1 ms on map 184 at the median, leaving 6 to
  12 ms of headroom.
* Without an overlay neither map fits either target: 28.8 and 28.6 ms for a
  single step and draw.

**What these figures leave out**

* The driver's own processor time for about 200 calls per frame.
* Real Canvas 2D work, which this runner treats as free: drawing text and
  gauges, and the lighting plugin painting its mask. On the development
  machine that work roughly tripled the logic step (sections 17 and 18).
* Texture uploads, audio, and input.
* Real play. All cases start from a new game with the player standing still.

**Reading**

Full game speed at 30 drawn frames per second on large maps looks reachable
on this device with a JIT engine and the third overlay, but the margin of 6
to 12 ms has to absorb everything in the list above. Sixty frames per second
is within reach only on small maps. This is the best case, not a prediction.

### 26. Real Canvas 2D work on the device (2026-11-15)

Section 25 treated Canvas 2D calls as free. Here the runner on the device
uses a real Canvas 2D library (the `canvas` package, whose ARM64 build
bundles its own Cairo and needs nothing from the system) together with the
do-nothing WebGL context. Text, gauges and the lighting plugin's mask are
really painted on the processor; nothing is composited. The game's images
were copied to the device for this. JIT on. Raw output:
`lab/out/device-real-canvas.txt`.

**Logic step with real canvas work, median (95th percentile)**

| Map | No overlay | v3, light every step | v3, light every 3rd step |
| --- | --- | --- | --- |
| 10 (4 events) | 52.0 ms (53.7) | not run | not run |
| 110 | 70.7 ms (77.4) | 62.0 ms (77.3) | 9.3 ms (63.7) |
| 184 | 58.2 ms (72.0) | 50.3 ms (65.0) | 14.3 ms (55.0) |

Process memory was 217 to 273 MB, in line with section 18.

* **The logic step is 50 to 70 ms, even on the 4-event map.** That is three
  to four frames of time for one step: slow motion everywhere, not only on
  large maps. This matches the author's report that walking was unplayable.
* **One call causes it.** Timing each kind of canvas call on the device
  shows that a single full-screen rectangle filled with a radial gradient,
  issued once per step by the lighting plugin, takes about 40 ms. A second
  full-screen fill in additive mode takes 8.5 ms. Everything else, including
  all text drawing, is under 1 ms per step.
* **Throttling the mask does not fix it.** With the mask repainted every
  third step, two steps take 9 to 14 ms and the third takes 55 to 64 ms, so
  the game stutters and still averages about 27 ms per step.

**Why the fill is slow, measured with a synthetic test**
(`lab/canvas-fill-bench.js`, on the device)

| Canvas size | Gradient fill, additive | Gradient fill, normal | Solid fill, additive | Solid fill, normal |
| --- | --- | --- | --- | --- |
| 866x630 (the plugin's mask) | 58.1 ms | 50.4 ms | 8.3 ms | 0.7 ms |
| 433x315 | 14.6 ms | 12.7 ms | 2.0 ms | 0.2 ms |
| 217x158 | 3.7 ms | 3.2 ms | 0.5 ms | 0.1 ms |

* The cost is computing the gradient for each pixel, not the blend mode: a
  normal-mode gradient fill is almost as slow as an additive one.
* It scales with the number of pixels. At a quarter of the width and height
  the same fill takes 3.7 ms.

**What this means**

* On this device the lighting mask cannot be painted by a processor-side
  Canvas 2D at full size. Three ways out, none built yet: paint the mask at
  a quarter of the size and let the GPU stretch it (about 4 ms per repaint
  by the synthetic test); draw the light once into an image and stamp it
  each step instead of recomputing the gradient; or draw the lights on the
  GPU, where a radial gradient is a few shader instructions.
* A browser on this device would hit the same wall unless its canvas were
  GPU-backed.
* Sections 22 to 25 remain valid for everything except the lighting mask:
  logic and frame preparation fit a 30 frames-per-second target once the
  mask is dealt with.

### 27. Lights drawn through WebGL instead of the canvas (2026-11-15)

`lab/overlays/gpu-lights.js` keeps the lighting plugin's own decisions
(which lights exist, where, in what colour) and replaces only its painting.
The plugin paints its mask with four helpers it adds to Bitmap. While the
plugin updates its mask, the overlay makes those helpers record what they
were asked to draw. Each light then becomes a sprite that stamps one shared,
pre-made radial-gradient texture with additive blending over a rectangle in
the ambient colour; the group is rendered into an off-screen texture that
the plugin's own mask sprite displays. The overlay is original code and the
game's files are not edited.

Measured on the RG35XX SP with real Canvas 2D work, the do-nothing WebGL
context and the JIT on, 600 logic steps per case. Raw output:
`lab/out/device-gpu-lights.txt`, `lab/out/device-gpu-lights-every.txt`.

Logic step, median (95th percentile):

| Map | Mask on the canvas | Lights through WebGL | + culling v3 | + lights every 2nd step | + lights every 3rd step |
| --- | --- | --- | --- | --- | --- |
| 10 (4 events) | 52.2 ms (53.6) | 4.1 ms (5.4) | 4.2 ms (5.4) | not run | not run |
| 110 | 70.3 ms (83.1) | 21.8 ms (29.3) | 14.1 ms (19.2) | 11.8 ms (17.0) | 9.8 ms (15.7) |
| 184 | 58.2 ms (70.6) | 24.0 ms (33.0) | 16.0 ms (23.4) | 14.7 ms (21.8) | 14.1 ms (21.8) |

Frame preparation with culling is 2.7 to 4.4 ms (95th percentile 3.7 to
6.4). Canvas work per step falls from 36-50 ms to under 0.1 ms. Process
memory is 221 to 275 MB.

* **The small map goes from slow motion to comfortable**: one step and one
  draw take about 6.8 ms, well inside a 60 frames-per-second refresh.
* **Large maps reach the 30 frames-per-second target, one of them barely.**
  Two logic steps and one draw, with lights updated every third step: about
  23 ms on map 110 and about 32 ms on map 184, against 33.3 ms.
* These figures include real text and gauge drawing. They still exclude the
  driver's processor time for the WebGL calls, texture uploads and audio.

**Not verified: the picture**

The overlay has only been run against the do-nothing WebGL context, so
nothing has been seen on a screen. It is known to differ from the plugin's
own painting in three ways: every light fades from its colour at the centre
to nothing at its radius (the plugin's inner radius and second colour are
ignored), directional lights are drawn as full circles, and the flashlight
cone is drawn as a round light. In these test runs the plugin issued only
plain radial lights, one or three per step, and no unsupported colours.
Checking the picture needs a real WebGL implementation: the software one in
the container (section 19), or the real runtime on the device.

### 28. The picture with lights drawn through WebGL (2026-11-15)

The container with the software WebGL implementation (section 19) was used
to see what section 27 could not: the picture. Frames were saved for two
maps with the lighting plugin's own painting and with the GPU-lights
overlay, and compared with the processor-drawn reference. Frames are in
`lab/out/shots/`.

**The earlier black frames are explained.** Maps drew black through WebGL
in section 19 and the cause was left open. It is the shader-based tilemap
library the engine uses under WebGL (`pixi-tilemap`): through this software
WebGL its tiles do not appear, and no WebGL error is reported. Map 110 only
seemed to draw because it has a fog layer; what was visible was the fog.
With a diagnostic switch that makes the engine build its classic tilemap
instead (layers painted on canvases and uploaded as textures), both maps
draw through WebGL.

Share of the frame that is not black:

| Map | Processor-drawn reference | WebGL, plugin's painting | WebGL, GPU-lights overlay |
| --- | --- | --- | --- |
| 110 | 39.4% | 50.3% | 49.6% |
| 184 | 17.1% | 17.1% | 16.6% |

(Map 110 differs from its reference because the reference run was shorter
and the fog had drifted less; the two WebGL columns are the like-for-like
comparison.)

* **The overlay reproduces the plugin's lighting in these scenes.** On map
  184, which has three lights, the frame from the overlay and the frame from
  the plugin's own painting were compared by eye and no difference was
  found: same lit area, same falloff, same colours.
* This covers plain round lights only. Directional lights and the flashlight
  cone, which the overlay draws differently by design, did not occur in
  these scenes and remain unchecked.

**Still open**

* Why the shader tilemap does not draw through the software WebGL, and
  whether it draws on the device's real driver. If it does not, the classic
  tilemap is the fallback, and its cost on the device (it paints tile layers
  on the processor when the view scrolls) has not been measured.

## Goals vs. Non-Goals

* **In-Scope Goals:**
    * Run Fear & Hunger 1.4.1 on the Anbernic RG35XX SP under muOS, from the
      player's own copy of the game's `www` folder, with no browser.
    * Full game speed everywhere: at least 30 drawn frames per second on the
      largest maps and 60 where the map allows it.
    * Peak process memory under 450 MB on the device, leaving headroom below
      the roughly 800 MB available.
    * Never edit game files on disk. Adaptations are applied in memory from
      a per-game set of patches kept outside the game folder.
    * Present the runtime to the game as NW.js, with save files that load on
      the PC copy and the reverse, written so that a power cut cannot destroy
      an existing save.
    * Draw through SDL2 and OpenGL ES 2 using the device's own libraries.
    * An error screen, a log file and a crash report on the device, since it
      has no debugger.
    * A desktop Linux build as the development and test host.
* **Future Goals (after the device build is complete, not in the current scope):**
    * An Android build, as a lighter alternative to JoiPlay for phones with
      little memory. Noted on 2026-11-16; nothing has been compiled or
      measured for Android.
        * Expected to carry over: V8, SDL2, OpenGL ES 2, and the player's own
          C++ and JavaScript. Cairo and FreeType must be built with the NDK.
        * New work: packaging as an APK, a V8 build for Android's C library,
          access to the game folder under Android's storage rules, on-screen
          touch controls, and recreating the graphics context when the app
          returns from the background.
        * Assumption to check first: that JoiPlay runs MV games through the
          system WebView. The memory advantage depends on it.
        * Constraint on current work: do not tie the player to fixed file
          paths or to physical buttons, the two things that differ most on
          Android.
* **Out-of-Scope Non-Goals:**
    * RPG Maker MZ, and MV versions before 1.5.
    * Other games, as a promise. They may work; only the reference game is
      tested.
    * Other devices and GPU drivers, as a promise.
    * An interpreter-only JavaScript engine.
    * An embedded web engine.
    * A processor-side renderer as the main drawing path.
    * HTML or CSS layout, network access, WebGL 2, web workers, WebAssembly,
      IndexedDB, developer tools, non-Linux hosts.
    * Unpacking packed executables or bypassing copy protection. The runtime
      ships no game data, engine scripts or plugins.

## Alternatives Weighed

* **JVM with Rhino or GraalJS (the original idea).** Rejected. Rhino
  interprets, and section 22 shows an interpreter is 3.5 to 4 times too slow
  on this device even with V8's. GraalJS needs a JVM heap of hundreds of MB
  on a device with 800 MB available. Neither was measured directly; the
  rejection rests on the interpreter result and on the memory budget.
* **Interpreter-only engine (QuickJS).** Rejected by measurement. With the
  JIT off, the logic step on large maps takes 40 to 77 ms on the device
  against a 16.7 ms budget (section 22). QuickJS itself was not run.
* **Embedded web engine (WPE WebKit).** Rejected. It ran the game in a
  container but needed 750 MB on a map and over 1 GB in a battle (section
  12), and the device has no DRM/KMS interface for it to display through
  (section 20). Its canvas would also hit the lighting plugin's cost unless
  it were GPU-backed (section 26).
* **Stock NW.js with tuned flags, zram or swap.** Not tried. Set aside with
  the web-engine route: the memory need is the same class of problem.
* **Replace PIXI and the engine's rendering scripts with a native renderer
  ("high cut").** Not pursued. Only 2 of 48 enabled plugins name PIXI
  directly (section 11), which weakens the original objection, but PIXI's
  own frame preparation costs only about 3 ms per frame on the device with
  culling (section 25), so there is little to gain.
* **Draw on the processor instead of the GPU.** Rejected for the main path.
  It draws correct frames (section 18) but is estimated at 12 to 20 frames
  per second, and the lighting plugin's gradient alone takes 40 ms.
* **Load only a window of tiles around the player (the author's idea).**
  Not pursued in that form: the engine already draws only the tiles on
  screen and map tile data is under 1 MB (section 13). The useful version
  is to skip far-away events and their sprites, which became the culling
  patch (sections 15 and 23).
* **Paint the lighting mask smaller, or cache the light as an image.** Held
  as fallbacks to drawing the lights through WebGL. A quarter-size mask
  takes about 4 ms by a synthetic test (section 26); neither was built.

## Key Decisions & Staging for Next Steps

**Decided**

* The route is a custom native runtime. No browser, no web engine, no JVM.
* The JavaScript engine has a JIT: V8 or JavaScriptCore. V8 is known to run
  on the device because Node does.
* The platform layer is SDL2 with OpenGL ES 2, linked against the device's
  own libraries.
* Scope is RPG Maker MV only, with Fear & Hunger on the RG35XX SP as the one
  tested target.
* Game files are never edited; adaptations are in-memory patches kept per
  game.
* Three patches are part of the plan because the frame-rate goal depends on
  them: event culling, lights drawn through WebGL, and a lower lighting
  update rate.
* The frame-rate target is 30 drawn frames per second on large maps.
* Shaders are rewritten to high precision, because the device's medium
  precision is only 10 bits (section 24).
* The runtime presents itself to the game as the desktop player (NW.js),
  not as a browser (decided 2026-11-15). The game then saves to files in
  `www/save/`, interchangeable with the PC copy, and follows the code path
  its author tested. The runtime supplies its own small versions of the
  Node functions the game and 11 of its plugins call (section 11): reading,
  writing, checking, creating and deleting files, limited to the game
  folder, plus path handling and window stubs. The lab runs so far
  presented a browser, so this mode is not yet exercised.

**Open, to be settled in design**

* V8 or JavaScriptCore, and how it is embedded (a custom binary, or Node
  itself with native add-ons as a first step).
* Which WebGL-over-OpenGL-ES implementation to reuse. Section 19 shows that
  writing or adopting one is not a pass-through: five separate faults were
  met with a library that already claims WebGL support.
* The Canvas 2D library. Cairo, through the `canvas` package, works on the
  device and costs under 1 ms per step once the lighting mask is taken away
  from it (sections 26 and 27).
* C++ or Rust for the native code. The reviewers split on this.
* Audio. Fully decoded audio costs 40 to 120 MB (section 13), so it should
  be streamed; nothing is built.
* Behaviour when a browser feature the game calls is missing: fail loudly,
  or log and continue.

**Open, only answerable by building the first version**

* Whether the engine's shader tilemap draws on the device's driver. It does
  not draw through the lab's software WebGL (section 28). The fallback is
  the classic tilemap, whose cost on the device is unmeasured.
* The driver's processor time for about 200 to 800 WebGL calls per frame.
* Whether the game plays correctly with the three patches over a real
  session: enemies that chase from off-screen, events that act while
  unseen, and lights updated 20 times per second. So far only speed and
  "the scene is still the map" have been checked, always from a new game
  with the player standing still.
* Directional lights and the flashlight cone in the lights patch.
* Battles, menus and the intro video on the device.

**Proposed order of work**

1. A native shell for the device: SDL2 window, OpenGL ES 2 context, the
   JavaScript engine, and enough of WebGL to show the title screen.
2. The map scene with the shader tilemap or its fallback, measured on the
   device.
3. The three patches, then a real play session to check behaviour.
4. Input from the device's controls, save files, then audio.
5. Error screen, logs and crash reports.

**Reviewer disagreements still open**

* Language: Rust versus C++17 with sanitizers.
* Behaviour on a missing browser feature in the player build.
