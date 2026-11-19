# Native RPG Maker MV Player for Low-Memory Linux Handhelds

*   **Author:** Mazer-R
*   **Status:** Proposed
*   **Date:** 2026-11-15

--------------------------------------------------------------------------------

## Overview

RPG Maker MV games are web pages. Each game ships with NW.js, a desktop
player made of a Chromium browser and Node, which loads the game's own
JavaScript: the engine's core scripts, the PIXI.js drawing library and the
game's plugins.

This design describes a replacement player for one kind of machine: a
handheld Linux console with about 1 GB of memory, a small ARM processor and
a mobile GPU. The player is a native program. It runs the game's JavaScript
unchanged in an embedded JavaScript engine and supplies, by itself, the few
browser and Node features that JavaScript calls. There is no browser inside
it.

The first and only tested target is the game Fear & Hunger (version 1.4.1,
MV core 1.6.0, PIXI 4.5.4) on an Anbernic RG35XX SP running muOS. The
measurements behind this design are recorded in `docs/history/feasibility-study.md`,
sections 10 to 28, and the experiments that produced them are in `docs/history/lab/`.

## The Problem

A person who owns an MV game and one of these handhelds cannot play the game
on it today.

*   **The shipped player does not fit.** Run in a browser engine, this game
    needs 750 MB of memory on a map and more than 1 GB in a battle. The
    console has about 800 MB available and no swap, so the system kills the
    player.
*   **A browser cannot show a picture there.** The console's display is
    driven by the chip maker's Mali driver on a plain framebuffer. Browser
    engines built for embedded devices expect a different display interface
    (DRM/KMS) that this console does not have.
*   **Where the game does start, it is too slow to play.** On every logic
    step the game's lighting plugin fills the whole screen with a radial
    gradient. On this processor that one call takes about 40 ms, more than
    two frames of time, so the game runs in slow motion even on a map with
    four events. Large maps add a second cost: the engine updates every one
    of several hundred events on every step, however far they are from the
    player.

The measurements show that none of this is inherent to the game. Its whole
state is about 35 MB of JavaScript objects. Run without a browser on the
console, the same game uses 220 to 275 MB with real decoded images. With the
lighting drawn by the GPU and far-away events skipped, a logic step takes 4
ms on a small map and 10 to 14 ms on the largest ones.

The proposed solution is therefore a player that keeps the game's code and
removes the browser around it, and that applies a small set of in-memory
adjustments where the game's own code is too expensive for this hardware.

## Goals

*   **The reference game is playable from start to finish on the reference
    console.** Fear & Hunger 1.4.1 runs on the Anbernic RG35XX SP under muOS
    from the player's own copy of the game's `www` folder: title, new game,
    maps, battles, menus, saving and loading.
*   **Full game speed everywhere.** Game time never runs slower than real
    time. The picture is redrawn at least 30 times per second on the largest
    maps and 60 times per second where the map allows it.
*   **Memory stays under 450 MB** of process memory at its peak on the
    console, leaving headroom below the roughly 800 MB available.
*   **Game files are never edited.** Every adjustment the player makes to
    the game is applied in memory, from files kept outside the game folder.
*   **Save files are the same files the desktop player writes.** A save made
    on the PC copy loads on the console and the reverse. A power cut during
    saving cannot destroy an existing save.
*   **A failure explains itself on the console.** When the game or the
    player fails, the screen shows what failed and where the log is. The
    console has no debugger, so the player must produce its own log and
    crash report.
*   **The same player runs on a desktop Linux machine**, so that it can be
    developed and tested without the console.

## Non-Goals

*   **Other games.** Other MV games may work, but only the reference game is
    tested and nothing is promised for the rest.
*   **RPG Maker MZ, and MV versions before 1.5.** MZ uses a newer drawing
    library, WebAssembly and a different save format; it is a separate
    project.
*   **Other consoles and GPU drivers.** The player may run elsewhere, but
    only the reference console is tested.
*   **Being a browser.** No HTML or CSS layout, no network access, no WebGL
    2, no web workers, no WebAssembly, no IndexedDB, no developer tools.
    Only the browser and Node features the reference game calls are
    supplied.
*   **Sixty frames per second on the largest maps.** The measurements leave
    no room for it on this processor.
*   **Pixel-identical output.** The picture must look right to a player;
    it is not required to match the desktop player bit for bit. One known
    difference is accepted from the start: the lighting is updated 20 times
    per second instead of 60.
*   **Distributing or unpacking games.** The player ships no game data,
    engine scripts or plugins, reads only a plain `www` folder, and contains
    nothing that unpacks executables or removes copy protection.

## Open Questions

*   **Does the engine's shader tilemap draw on the console's GPU driver?**
    It did not draw through the software WebGL used in the lab, with no
    error reported. If it fails on the console too, the engine's classic
    tilemap is the fallback, and its cost there has not been measured.
*   **How much processor time does the GPU driver take per frame?** The lab
    timings use a WebGL stand-in that draws nothing. The game issues about
    200 to 800 WebGL calls per frame.
*   **Does the game still behave correctly with the adjustments?** Only
    speed has been measured, always from a new game with the player standing
    still. Enemies that chase from off-screen, events that act while unseen
    and lighting at 20 updates per second have not been observed in play.
*   **Is there enough margin on the largest maps?** On one of the two large
    test maps, two logic steps and one frame preparation take about 32 ms
    against the 33.3 ms that 30 frames per second allows, before driver time
    and audio.
*   **How do battles, menus and the intro video behave on the console?**
    None has been run there.
*   **What does audio cost?** Nothing audio-related has been built or
    measured on the console.
*   **Does SDL2_mixer cover what the game asks of its sound?** It cannot
    change pitch and limits loop points. Whether the game depends on either
    is not known.

### Resolved since this design was written

*   **The V8 build works from an ARM Linux container** (2026-11-15). V8
    12.4.254.21, the version inside Node 22, builds as one static library
    with g++ 12.2 and the system's C++ standard library, using the recipe in
    `player/tools/v8/`. It needed one source patch, kept in
    `player/tools/v8/patches/`: V8 asserts that a small container's element
    type is trivially copyable, and the system library's `std::pair` is not,
    although copying its bytes is valid. A test program linked against the
    library (`player/tools/v8/smoke_test.cc`) runs on the console: a numeric
    loop takes 6.2 s there, against 5.7 s in Node's own build of the same V8
    and 21.5 s in Node with the JIT off, so the JIT is working. The library
    is 70 MB and the test program 29 MB. V8's headers compile as C++17.

*   **Stage 1 runs on the console** (2026-11-15). The player opens the
    screen through SDL2 and OpenGL ES 2 (Mali-G31, 640x480), starts the V8
    built above, runs a script, and writes a log. A test script
    (`player/tests/device/frame_pacing_check.js`) presented 230 frames at a median of
    16.67 ms with none over 20 ms; the window is up 15 ms after start and V8
    26 ms after start. A script that throws
    (`player/tests/device/error_report_check.js`) is reported in the log with its
    file, line and call stack, and the player exits with code 2. The binary
    is 31 MB.

    What differs from the implementation plan below, and why:

    *   **No sysroot and no downloaded headers** (files 6 to 8 of the plan).
        The player is built in a Debian container whose development
        packages provide headers and link-time libraries for SDL2 and
        OpenGL ES 2. The console has its own copies under the same library
        names, so the binary loads the console's copies there. Debian's
        SDL2 is 2.26.5 and the console's is 2.28.5; building against the
        older headers is compatible.
    *   **No toolchain file** (file 2). The container is itself 64-bit ARM
        Linux, so the build is native and needs no cross-compilation.
    *   **Not yet written from stage 1**: settings, the memory ledger, the
        timer queues and the system binding. The host supplies `console`,
        `performance.now`, `requestAnimationFrame` and a small `player`
        object directly until the bindings exist.
    *   **Found while testing**: after a script failed at load, the player
        kept presenting empty frames until it was killed. The main loop now
        ends when no script work can ever run again.

*   **The WebGL binding draws on the console** (2026-11-15), without the
    game yet. `player/src/bindings/webgl_binding.cpp` exposes the WebGL
    constants, generated from the OpenGL ES 2 header, and about ninety
    functions wired to OpenGL ES 2. A hand-written script
    (`player/tests/device/webgl_check.js`) uses it the way PIXI does:
    shaders that declare medium precision, an array uniform looked up by
    its bare name, a texture uploaded with the premultiply flag, blended
    quads from an index buffer, a scene drawn into an 816x624 off-screen
    texture and then to the screen, and pixel read-back. Every check passes
    on the console, at a median of 16.67 ms per frame with 47 WebGL calls
    per frame and no WebGL error.

    Notes for what follows:

    *   Images and canvases as texture sources are not supported yet; that
        form of `texImage2D` arrives with the canvas binding.
    *   The driver reports 10 bits for medium precision and 23 for high, as
        measured before; the binding rewrites every precision qualifier to
        high.
    *   Found while testing: the binding held a reference into the engine
        that outlived it, which crashed the player at exit. It is now
        released before the engine shuts down.
    *   WebGL objects are freed only by the game's explicit delete calls;
        nothing is freed when a wrapper is garbage-collected.

*   **The canvas and image binding draws on the console** (2026-11-15),
    without the game yet. `player/src/bindings/canvas_binding.cpp` provides
    Canvas 2D drawing on Cairo, text through FreeType from a font file, PNG
    decoding, pixel read and write, and hands a canvas or an image to the
    WebGL binding as a texture source. A hand-written script
    (`player/tests/device/canvas_check.js`) draws a gradient, additive
    bars, outlined and filled text and a region of a PNG, reads pixels
    back, and shows the canvas through WebGL. Every check passes on the
    console at a median of 16.67 ms per frame.

    Notes for what follows:

    *   **The binding is the low-level half only.** It takes every parameter
        explicitly. The Canvas 2D object the game sees, with its state, CSS
        colour strings and font shorthand, is to be written in JavaScript on
        top of it. The plan put that parsing in C++ (files 33 and 34);
        JavaScript is smaller and does no per-pixel work.
    *   **Repainting and re-uploading a full 816x624 canvas took 78 ms** on
        the console in this test, most of it the full-size gradient fill
        already known to be slow (brief, section 26). Canvases that change
        every frame must stay small or go to the GPU, as the lights patch
        does.
    *   **PNG decoding is synchronous** on the main thread for now; the plan
        calls for worker threads (file 35).
    *   Surfaces are freed only by explicit calls; nothing is freed when a
        handle is garbage-collected.
    *   **Found while testing, in the deploy script, not the player:** it
        located the muOS menu by command-line text and could match its own
        shell, pausing itself. It now matches by process name. The lab's two
        scripts with the same lookup were corrected too.

*   **Stage 2, the game reaches its title screen (2026-11-15).** The new
    player boots Fear & Hunger on the console to its title screen, drawn
    through the own WebGL and canvas bindings: background art, window frame
    and menu text in the game's font. The JavaScript layers are in
    `player/js/` (`boot.js`, `css.js`, `dom.js`, `canvas2d.js`,
    `desktop.js`); `player/tools/run-game.sh` runs a game on the console and
    `player/tests/device/title_watch.js` checks the result.
    *   **Measured on the console:** title scene 8.0 s after start; 56.9
        frames per second on the title scene; 265 MB resident memory 12 s
        after start (goal: under 450 MB); JavaScript heap 98 MB; about 59
        WebGL calls per frame. The picture was read back and checked by eye.
    *   The game passes through its own map scene before the title
        (`Scene_PretitleMap`), so a map with the lighting plugin was built
        and drawn for six seconds without errors. This is not yet a check of
        map drawing: no picture of it was captured.
    *   **The game draws at its own size.** The WebGL binding gives the game
        an off-screen drawing buffer (816x624, with stencil) in place of the
        screen and copies it to the 640x480 screen each frame, scaled with
        its proportions kept, restoring every piece of OpenGL state it
        touches.
    *   **Everything the player writes stays in the game's `save/` folder:**
        save files, written through the desktop-mode `fs` module, and the
        log (`save/mvplayer.log`). The native side refuses writes anywhere
        else. Save files are written to a temporary file, flushed, and
        renamed, keeping the previous version as `.bak`. Saving itself has
        not been exercised yet: nothing on the title screen saves.
    *   **A game script that fails is logged, not fatal.** One of the game's
        plugins (`physical_attack_animation.js`) has a syntax error inside an
        `eval`, which also fails in a browser; the game runs without it.
    *   **Sound is off:** the page address carries the engine's `noaudio`
        option until the audio service exists. Input is not connected, so
        the title menu cannot be operated yet.
    *   **Deviations:** modules the player does not provide (the game asks
        for the Steam library) are answered with an object whose functions
        return false, and each missing feature is logged once; this is the
        lenient mode only, the strict mode is not built. Bold and italic in
        font descriptions are ignored. File requests for binary data and
        images from `data:` addresses are not provided. An engine error
        ends the player with exit code 3 instead of showing an error screen.

*   **Stage 3, controls (2026-11-15).** `player/src/platform/input.{h,cpp}`
    reads the console's buttons through SDL2's game controller layer and a
    keyboard, and reports both as browser key codes; the page layer turns
    them into `keydown`/`keyup` events, which is the input the engine
    already handles. Layout, following the engine's gamepad defaults: A
    confirms, B cancels, X dashes, Y and Select open the menu, Start
    confirms, L/R page, the d-pad and the left stick move. The menu button
    held plus Start quits the player.
    *   On the console SDL reports the controls as `muOS-Keys`, with a
        layout found in `/usr/lib/gamecontrollerdb.txt` (read when
        `SDL_GAMECONTROLLERCONFIG_FILE` is not set).
    *   **Checked on the console by a script**
        (`player/tests/device/input_watch.js`) that feeds key codes
        through the entry point the native side uses: the title menu cursor
        moved down and up, "new game" started, and the game went through
        its map scene to character selection and the name entry screen
        (`Scene_Title > Scene_Map > Scene_Name`), with pictures read back.
    *   **Not yet checked:** real button presses (the script does not press
        buttons), and whether the labels A/B/X/Y in the system's layout match
        the buttons as printed on the console.

*   **Patches in the player (2026-11-15).** The first hands-on session was
    unplayably slow on maps: about 3 frames per second. Measured with
    `player/tests/device/profile_watch.js`: the lighting plugin's full-screen
    gradient fill cost about 35 ms per logic step, and the engine, trying to
    catch up, ran up to 15 steps per frame (about 520 ms per frame). This is
    the cost the brief predicted; the patches were simply not in the new
    player yet.
    *   `player/patches/` now holds the lab's patches as `gpu-lights.js` and
        `event-culling.js` (with the lighting update every third step), and
        `index.json`, which selects patches by the game's title, engine and
        active plugins. `boot.js` installs them when the engine finishes
        booting. `--no-patches` runs a game without them.
    *   **Measured on the console with the patches:** the map before the
        title 61 frames per second (was 6 to 11); the first maps of a new
        game 42 to 61 frames per second (was 3), with about 4 to 6 ms of
        logic and 5 to 7 ms of drawing per frame; 274 MB resident memory.
    *   **Open:** on the first playable map the rate is about 43 frames per
        second although the JavaScript side uses about 10 ms per frame. The
        rest is outside what was measured (the copy to the screen, the
        buffer swap, or the GPU finishing its work) and has not been
        located. These are small maps; the largest maps have not been run
        in the new player.
    *   The patches' known visual differences from the plugin's own lights
        (listed at the top of `gpu-lights.js`) still apply.

*   **Memory no longer grows from map to map (2026-11-15).** The second
    hands-on session froze when a new map loaded, and the console stopped
    answering. A scripted tour of the maps reachable from the save
    (`player/tests/device/map_tour_watch.js`) showed why: every map change
    added 30 to 60 MB that was never released, reaching 839 MB resident
    with 89 MB left on the console after about a minute. This was the
    deviation recorded above ("surfaces are freed only by explicit calls").
    Three changes:
    *   **Images, canvases and gradients are freed when the game drops
        them.** Each native object is tied to its JavaScript handle with a
        weak reference, and the engine is told how much pixel memory exists
        outside its heap so that it collects such handles in time.
    *   **Freed pixel buffers go back to the system.** The C library's
        threshold for giving large blocks their own mapping is fixed at
        64 KB; with the default, freed blocks were kept and the process only
        grew.
    *   **Images are decoded only when needed.** Loading reads the size from
        the PNG header; the pixels are decoded for a texture upload or a
        canvas draw, and only the most recently used decoded copies are kept
        (32 MB). Before, every image was held twice, decoded and as a
        texture. This replaces the plan's worker-thread decoding for now:
        decoding is still synchronous, at first use.
    *   **Measured on the console,** ten map changes including the four
        largest maps (80x81 and larger, 320 to 344 events): resident memory
        stays between 395 and 426 MB (goal: under 450); textures 76 to
        108 MB; canvases and images 56 to 118 MB.
    *   **Largest maps:** about 13 ms per logic step and 5 to 7 ms of
        drawing, which settles at 30 to 36 frames per second with two logic
        steps per frame (goal: at least 30). The first seconds after a map
        loads are slower, 3 to 20 frames per second, while the engine works
        off the steps it fell behind during loading.
    *   **Watchdog.** A thread notices when no frame has finished for five
        seconds, writes the JavaScript stack at that moment to the log, and
        ends the running script when the player is asked to stop during a
        stall. It did not report the freeze above, which was the system out
        of memory rather than a script loop.
    *   **Also checked by script on the console:** a battle started from a
        new game and from the save file runs through its turns at 35 to 42
        frames per second (`player/tests/device/battle_watch.js`), and a
        game saved by hand produced `file1.rpgsave` and `global.rpgsave` in
        the game's `save/` folder, which the tour then loaded.

*   **A second game, a game list, and packages (2026-11-15).**
    *   **Fear & Hunger 2: Termina (MV 1.6.0, PIXI 4.7.1, 83 active
        plugins) runs.** It needed two fixes in the page layer: element
        lists returned by `getElementsByTagName` now have `item()`, and an
        address starting with `/` is taken from the game folder, as the
        desktop player does. The lighting patches apply to it too (same
        plugin); `patches/index.json` has an entry for it. Measured on the
        console in a ten-minute hands-on session: no errors, median 391 MB
        and at most 427 MB resident, about 22 frames per second on average
        including loads and menus, which is below the goal. Where the time
        goes in this game has not been measured.
    *   **A wrong lead, kept as a warning:** the game first appeared to hang
        after character selection, waiting for an image. The image was
        empty: the archive had been extracted with a tool that silently left
        99 files at zero bytes. Re-extracted with the official tool, nothing
        was wrong with the player.
    *   **Game list.** `mvplayer --pick <dir>...` (`js/picker.js`) lists the
        games found in the given folders, lets the user choose with the
        controls and prints the choice for the program that started it. It
        is drawn on a native canvas, without the page layers.
    *   **muOS package** (`packaging/muos/`): one entry in muOS's Apps menu,
        "RPG Maker MV", whose launch script loops between the list and the
        chosen game. The player goes to `MUOS/emulator/mvplayer`; games are
        looked for in `/opt/mvplayer/games` (internal storage) and in
        `ROMS/RPGMV` on the card. Installed on the console; the list was
        seen working there, and a game started from the menu ran at about 59
        frames per second on the title and first maps. The whole round trip
        (list, game, quit, back to the list) has only been done by hand, not
        by a script.
    *   **Quit combination:** Start must now follow the menu button within
        three seconds. Menu button presses are logged. The log of a real
        session shows the button's press and release both arrive.
    *   **Performance line.** Every ten seconds of play the game's log gets
        one line: scene and map, frames per second, logic steps per frame,
        time per logic step and per drawing step, and the slowest frame.
        Added because one hands-on session ran at 18 frames per second on
        average while the scripted measurement of the largest map, repeated
        the same evening, still gave 8.6 ms per logic step and 60 steps per
        second once settled. **That slow session is not explained yet.**
    *   **Lab tools.** `tools/run-game.sh` and the new `tools/screen_view.py`
        (the console's screen in a browser, read from its framebuffer) work
        over adb or over ssh. The viewer costs the console 13 to 16 % of its
        processor while it runs, so it must not be left open during
        measurements. `run-game.sh` now replaces the paused muOS menu screen
        instead of resuming it, because the resumed screen acted on every
        button press made during the game.
    *   **Linux x86-64 build** (`tools/v8/*-x64*`, `tools/build/*-x64*`,
        `packaging/linux-x86_64/`): cross-compiled from the arm64 container
        against Debian bookworm, packaged with SDL2, Cairo, FreeType and
        their libraries. V8's snapshot must be generated by an x86-64
        `mksnapshot`, run through the build machine's x86-64 emulation: the
        snapshot made by an arm64-hosted `mksnapshot` crashed every program
        in `v8::Isolate::New`, cause not found. **Checked only under
        emulation** (it boots Fear & Hunger to its title screen with a
        software renderer); not yet run on a real x86-64 machine. The window
        is still opened full-screen, as on the console.

*   **Slow real play explained, and the first round of fixes (2026-11-16).**
    The scripted measurements loaded the first save, from the start of the
    game. Real play used later saves, seventeen times larger: 69 parallel
    common events active (about 19,000 commands, 3,000 condition checks and
    1,600 script commands, 27 of the lists with no wait) on a map with 280
    events. There one logic step cost 12.7 ms standing and 15 to 20 ms
    walking, and the engine's catch-up loop turned any delay into a spiral
    (4 to 6 steps per frame, 7 to 11 frames per second).
    *   **Tools added to find it:** a performance line every ten seconds in
        the game's log; a sampling profiler in the host (`player.startProfile`,
        `player.stopProfile`), which the player turns on by itself for the ten
        seconds after a period below 22 frames per second; the previous
        run's log kept as `mvplayer.log.1`; and
        `tests/device/walk_watch.js`, which continues from a chosen save and
        really walks (it picks open directions and confirms when an event
        holds the character).
    *   **Patches added** (all in `player/patches/`, each documented in its
        file): `frame-pacing.js`, at most two logic steps per frame;
        `preload-once.js`, an event's images are requested the first time its
        command list starts, not on every restart of a parallel event;
        `common-event-throttle.js`, the seven "outfit change" common events
        run ten times a second; `lean-state.js`, a write that leaves a
        switch, variable or self switch as it was no longer makes the map
        re-evaluate its events, and events at a position are found with one
        loop instead of a filtered list of every event.
        `tests/patches/lean_state.test.js` (Node, no game files needed)
        pins that last patch's behaviour.
    *   **Measured on the console, save 4, map 37.** Standing: 11 to 32
        frames per second before, 42 to 44 after, at full game speed, slowest
        settled frame 50 ms (was over a second). Walking, by script: 13.2 ms
        per logic step without `lean-state.js`, 12.1 ms with it; in that run
        31,574 writes changed nothing and 3,703 did. The outfit throttle
        gained less than expected (about 0.6 ms per step): those lists
        usually end early.
    *   **In the user's hands, before the last two patches:** 19 to 27
        frames per second walking on that map, 28 to 41 in battle. That is
        better and without stutter, but still under the goal of 30, and at
        two steps per frame the game runs slightly slower than real time
        there.
    *   **What is left is the game's own event logic.** The profile taken
        during real play is dominated by the common events' interpreters and
        their condition checks. Real changes to switches and variables still
        happen about five times per step, so the map still re-evaluates its
        active events every step.
    *   **The ub-mode tools did not apply:** crapper finds no functions in
        this JavaScript (no package.json, function-expression style), dryer
        and mutator do not handle JavaScript or C++. Only the lab's Python
        viewer was scored (its `frame` function: CRAP 42, no tests).

*   **Sound, a game chooser, file names in any case, and an on-screen
    frame rate (2026-11-16).**
    *   **Sound works.** Decision changed with the owner's agreement: not
        SDL2_mixer but the player's own mixer (`src/platform/audio_mixer.cpp`)
        behind the interface in `src/platform/audio.h`, so it can still be
        swapped. Reason: the games play music and an ambience at once, both
        looping, with loop points inside the file and pitch changes on
        effects; SDL2_mixer streams one music only, would hold every other
        long sound decoded in memory, and cannot change pitch. The mixer
        gives each voice its own Ogg Vorbis decoder (stb_vorbis 1.24, public
        domain, vendored in `third_party/stb/`), decodes while playing,
        resamples for pitch, loops between sample positions, ramps volume
        and mixes in SDL2's audio callback.
    *   `js/audio.js` is the part of the Web Audio API the engine uses. No
        sound is decoded into JavaScript: the engine is handed the first
        256 KB of a sound file (it reads the loop points from the header
        itself) and a "decoded buffer" that is only the file's name and
        length. Node tests: `tests/js/audio.test.js`.
    *   **Measured on the console:** output opened through ALSA to the
        system's PipeWire at 44.1 kHz; on the title screen the mixer's
        loudest sample per second was between 0.06 and 0.34 while the engine
        reported the title music playing; 60 frames per second and 244 MB
        there. **Nobody has listened to it yet**; ambiences, effects, fades,
        pitch and loop points are covered only by the Node tests of the
        JavaScript side, not by ear or by a native test. Encrypted audio
        (`.rpgmvo`) and `.m4a` are not supported.
    *   **File names in any case** (`src/platform/files.{h,cpp}`, native test
        `tests/native/files_test.cpp`, run by `tools/build/test.sh`): the
        second game asks for `img/layers/fog1.png` and ships `Fog1.png`;
        it waited for ever when leaving the train. Reads of files, scripts,
        images and sounds now fall back to a case-insensitive lookup, folder
        by folder, with the listings remembered. This is the plan's "file
        service" in its simplest form.
    *   **Choosing a game.** `--game` accepts the game's www folder, the
        folder that holds it, or any file directly inside either (the .exe);
        `--resolve <path>` prints the www folder. The game list takes named
        games (`--games-file`) and can end with an "add a game" line
        (`--can-add`). On the desktop, `mvplayer.sh` with no arguments shows
        the list, opens the system's file dialog (zenity or kdialog) to add
        a game, remembers games in `~/.config/mvplayer/games.txt`, and
        `--install-launcher` adds a menu entry. Checked under emulation with
        a stand-in dialog; not yet on a real desktop.
    *   **Frame rate on screen:** `--fps`, `MVPLAYER_FPS=1`, F2, or the menu
        button plus Select on the console. A small box shows frames per
        second and the longest frame of the last half second, drawn by the
        native present pass from a canvas (`gl.setOverlay`). Seen on the
        console's screen memory.

*   **Patches chosen by what they depend on (2026-11-16).** The list
    (`patches/index.json`) no longer says "this game gets these patches".
    Each line is one patch and says what it needs: the engine, a plugin, or
    one game. Four are engine-wide (event culling, preload once, frame
    pacing, lean state), one follows the lighting plugin, one is for Fear &
    Hunger alone. A third MV game now gets the engine-wide ones without
    being listed.
    *   The decision is a pure function, `js/patch-select.js`, tested with
        Node (`tests/js/patch_select.test.js`, written first). An unknown
        condition keeps a patch out.
    *   **A patch that replaces an engine function outright first checks
        that the function is still the engine's own code** (`sameCode`,
        spacing aside). `lean-state.js` replaces each lookup separately and
        leaves alone any that a plugin rewrote; `event-culling.js` does not
        install at all in that case. Both say so in the log.
    *   **One game can switch patches off** with
        `<game>/save/mvplayer-patches.json`, of the form
        `{ "off": ["framePacing"] }`; a name that is no patch is reported.
        `--no-patches` still turns all of them off.
    *   **Checked** with a new tool, `tools/run-headless.sh` (image
        `tools/build/Dockerfile.headless`): the console's own build of the
        player run on the build machine with a virtual display and Mesa's
        software OpenGL ES, no screen and no sound. Fear & Hunger gets six
        patches, Fear & Hunger 2 five (the same sets as before this change),
        the switched-off patch is left out, `--no-patches` installs none.
        Not checked on the console: it was in use. The risk that an untested
        game misbehaves with an engine-wide patch remains; the two switches
        are the way out.

*   **Logs folder (launch scripts).** A game that fails on a device nobody
    is watching left its only trace in that game's `save/mvplayer.log`,
    overwritten by the next run. Both launch scripts now copy the log of
    every run to one folder, named after the time and the game, with the
    player's exit code as the last line, and keep the newest 30.
    *   muOS: `MUOS/emulator/mvplayer/logs/` on the card. Linux: `logs/`
        next to `mvplayer.sh`, or `~/.config/mvplayer/logs` when that cannot
        be written.
    *   **Checked**: the copying and pruning function run on its own in a
        scratch folder (a game name with spaces and `&`, 35 copies pruned
        to 30, a game with no log skipped). On the console the folder
        exists and the launcher is installed; a full run through the menu
        has not been observed.
*   **Linux package on a real desktop (owner, Manjaro).** The owner played
    Fear & Hunger and "two or three" other games with the x86-64 package and
    reported that all of them work. Which games, and whether that package
    was the one with sound and the file chooser, is not recorded.
*   **What the event interpreter costs, measured.** The assumption that the
    engine interprets thousands of event commands per step, with scripts
    compiled again each time, was wrong for the reference game. A census
    (`tests/device/interpreter_census.js`, from the owner's save on the
    heaviest map) counted about 77 commands per step and no script
    commands, so "prepare the commands once" was dropped.
    *   Tools added for this: the census script; `WALK_PROFILE` in
        `tests/device/walk_watch.js`, which samples a whole walk; `SAVES` in
        `tools/run-headless.sh`, which runs a game from saves kept outside
        the game folder.

*   **Android build (experimental).** The player runs as an Android app
    (arm64-v8a, Android 8.0+): `packaging/android/README.md` has the steps.
    *   V8 12.4.254.21 built for Android with the NDK's clang and libc++
        (`tools/v8/build-android.sh`, same options as the other builds);
        Cairo, pixman, FreeType and libpng with `build-android-deps.sh`;
        SDL2 from source; the package is assembled with the SDK's own tools,
        without Gradle.
    *   One process runs the game list, the game, and the list again
        (`src/platform/android_start.cpp`). For that, V8 is started once per
        process and never shut down, and per-run state (WebGL binding, file
        caches) is reset when a run ends.
    *   Games live in `RPGMV/` on the shared storage and need the "all files
        access" permission. The first design, the app's own folder with no
        permission, failed: on Android 17 not even `adb` can write there.
    *   Touch controls (`platform/touch`): a direction pad and three buttons,
        drawn as rings over the picture; hidden while a controller or
        keyboard is used. Back is cancel; held for a second it leaves the
        game. A press and release within one frame is now stretched to a
        frame on every platform, since the engine only samples keys per frame.
    *   **Checked** on the SDK emulator (Android 17, 16 KB pages, software
        OpenGL ES): list, Fear & Hunger to its title and into the new-game
        screens by simulated taps, back to the list and into the game again
        in the same process, log copies kept. **Not checked**: a real phone,
        real fingers, a controller, speed (the emulator's numbers mean
        nothing), the permission screen itself (granted through `adb`).
*   **Encrypted images and sounds (`.rpgmvp`, `.rpgmvo`).** Games deployed
    with RPG Maker MV's encryption now load. The engine's own unscrambling
    is used, so no key handling was added: the engine is given the start of
    the file, and the true first bytes it works out are passed to native
    code, which reads the rest from disk (`js/file-bytes.js`,
    `platform/files`). Images keep their lazy decoding; an encrypted sound
    is read whole into memory while it plays.
    *   **Checked** with an encrypted copy of Fear & Hunger made by
        `tools/encrypt-game.py`: the title picture is identical headless
        (lit fraction 0.634), and on the Android emulator the title music
        plays (mixer peak 0.34). Not checked with a game that was shipped
        encrypted, nor `.rpgmvm` (m4a), which is not supported.
*   **Wasted work removed after a review of the player's own code.**
    *   A bug: `commonEventThrottle` counted the steps the engine asked
        for, including those `framePacing` drops, so at about 20 frames per
        second some throttled events never got their turn. Each event now
        counts the steps it is offered (test added; it failed before).
    *   Canvas uploads reuse one buffer and convert pixels without
        branches; idle sound decoders are kept open (up to 16) instead of
        reopening the file per effect; the decoded-image cache now drops
        the least recently used; resolved file paths and parsed light
        colours are remembered.
    *   **Not measured**: the gain of these changes. The walk benchmark
        varies too much between identical runs to show it (see below).
        Still open: text drawn as paths, per-call overhead of the WebGL
        binding.
*   **Vertical sync cannot be relaxed on the RG35XX SP (2026-11-16).**
    *   **Tried**: presenting a late frame with swap interval 0, only for
        late frames and then for every frame. The driver accepts the
        request (`SDL_GL_SetSwapInterval(0)` returns success and reads
        back 0) and ignores it.
    *   **Evidence**: frame durations in the 40-second walk of Fear &
        Hunger fall in two peaks, 16-18 ms and 32-34 ms, in all three
        modes; frames presented in 56 s were 1661-1909 with the wait and
        1677-1942 without, inside the run-to-run spread.
    *   **Where the wait is**: about half of the frames return from the
        swap at once and wait inside the next frame's first drawing
        calls, so the time the scripts appear to take includes it. Frames
        whose scripts took about 12 ms still land on 33 ms: the GPU's own
        work on the frame (lights, full-screen passes) pushes them past
        the refresh. Less GPU work per frame is therefore the way to more
        60 fps frames, not the swap interval.
    *   **Outcome**: the option was removed again; no code changed.
    *   **The walk benchmark is too noisy for small gains**: with the
        same build and settings, a run spends between 649 and 2329 logic
        steps on the map (the walk runs into a battle or not) and reports
        11.8-13.1 ms per step. The `eventLookup` patch answered 140
        lookups in such a run, none by scanning every event: correct, and
        too little work on this map to show in the totals.
*   **Videos play, through the system's ffmpeg program (2026-11-16).**
    *   **How**: the player has no decoder. It starts `ffmpeg` as a
        separate program and reads plain RGBA frames (scaled to the
        game's size, 30 per second) from one pipe and plain samples from
        another. Nothing is linked, so any ffmpeg version works and a
        machine without one has no video. The frame is drawn in the
        present pass in place of the game's picture; the sound goes to
        the mixer as a stream, and the pictures follow the sound.
    *   **Never a stuck game**: without ffmpeg, or with a file it cannot
        read, the video element reports the video as loaded and ended at
        once. The engine's error handler is not used: it stops the game
        with a retry screen.
    *   **The console already has it**: muOS ships ffmpeg 4.4.4. It
        decodes the Fear & Hunger intro (VP9 816x624, Opus, 32.8 s) in
        8.1 s on one thread and 3.7 s on four, with a game running at the
        same time.
    *   **Checked**: headless, the intro plays from the engine's own
        `Graphics.playVideo` to its end in 33.0-33.3 s, with sound
        flowing through a dummy sound device, and a screen capture
        matches the file's frame. Unit tests use a script in ffmpeg's
        place.
    *   **Not checked**: on the console itself (it went off the network
        before the run), on a desktop Linux, by ear. Android has no
        video: there is no ffmpeg program to start.
    *   **Linux package**: the start script puts the bundled libraries
        first in the search path; the decoder is started with the path as
        it was before, so the system's ffmpeg loads the system's
        libraries.
*   **Touch controls drawn as what they do (2026-11-16).**
    *   **Why**: plain rings did not say which was the pad and which
        button did what (feedback from a first try on a phone).
    *   **Now**: the direction pad is a cross with an arrowhead on each
        arm; the buttons are rings around a tick (confirm), a cross
        (cancel or menu) and two chevrons (dash). What a finger is on
        lights up. All of it is one fragment shader; no textures or font.
    *   **Checked**: on the Android emulator, idle and with a finger
        held on the pad. Positions and sizes are unchanged.
    *   **Open**: no way yet to move, resize or hide the controls; the
        game list's "A: choose, B: leave" hint sits under the pad and
        names buttons a touch screen does not have.

*   **Per-game controls and an in-game settings menu (2026-11-16)**
    *   **Why**: a game may need a key the player had no control for
        (one needs T), on a phone and on the console alike.
    *   **Menu**: the player's own settings menu opens over a running
        game with the console's menu button + X, the F1 key, or a MENU
        touch control. The game waits meanwhile and gets no keys. Rows:
        resume, frame counter, buttons, touch controls, quit. It is
        native (boxes plus a built-in 5x7 font drawn in the present
        pass), so it does not depend on the game's scripts or fonts.
    *   **Buttons**: each controller button, by its SDL game controller
        name, can be given any key; the triggers (L2, R2) and stick
        clicks count as buttons and start unassigned. Kept per game in
        `save/buttons.txt`. The direction pad is not remappable.
    *   **Touch controls**: can be dragged, resized, removed and added
        for any key on the screen itself; kept per game in
        `save/touch-controls.txt`, measured in units of the screen's
        shorter side from the nearer edge.
    *   **Checked**: unit tests for layouts, editing, the button map
        and the menu; on the Android emulator: adding and moving a T
        button, giving L2 the T key, the frame counter, Back closing
        the menu. All three builds compile.
    *   **Not checked**: the menu on the console (menu + X, the
        triggers) and with a real controller; the frame counter row
        does not show whether it is on, and the choice lasts for the
        run only.
*   **Drawing the lights at half size gives nothing on the RG35XX SP (2026-11-16).**
    *   **Tried**: a "LIGHTS: LOW / HIGH" row in the settings menu; low
        made the `gpuLights` patch render the darkness mask into a
        texture of half the size each way (a quarter of the pixels),
        shown stretched.
    *   **Measured**: character standing still, four periods of 12 s
        alternating low, high, low, high. Fear & Hunger, map 37: 37.7 and
        39.0 frames per second low, 39.7 and 39.7 high. Fear & Hunger 2,
        map 19: 19.0 and 23.7 low, 22.7 and 22.5 high. The first period
        of each run is still warming up; drawing took 8.3-8.5 ms per
        frame either way.
    *   **Why**: the mask already has the game's size (816x624), not the
        screen's, and holds a few lights: filling it is cheap. The frames
        are held back by the scripts (10-18 ms per logic step, 1.5-2
        steps per frame), not by these pixels.
    *   **Outcome**: the option was removed again; no code changed.
*   **Parallel common events cost less, in any MV game (2026-11-16).**
    *   **Found**: in Fear & Hunger 2 a logic step takes 13.2 ms walking
        (maps 19 and 14), 6.3 ms of it in the game's 51 parallel common
        events; the throttle patch only knew Fear & Hunger by title. One
        event that never waits, "SKILLSdemonSeedAVAILABLE", took 1.3 ms
        alone, and questions about actors' equipment were about a tenth
        of the profile's samples. Measured with the new
        `tests/device/common_event_watch.js`.
    *   **`commonEventThrottle` now chooses by itself**: an event that
        is a pure check (conditions on the game's state, switches,
        variables set, skills learnt, calls of events that are pure
        checks too, a variable counted afresh on every run) and is seen
        to cost at least 0.05 ms per step over 120 steps runs once every
        six steps. Events that wait, count, read buttons or the timer,
        show or play anything, or run scripts or plugin commands are
        never chosen. No per-game analysis: lists are read when the game
        starts, time is measured where it runs. Names by game title stay
        for events that are checks in effect only (Fear & Hunger's
        "Outfit change").
    *   **New `equipCache`**: an actor's equipment list is rebuilt only
        after a slot changed (every change goes through three functions
        of the slot); callers still get their own copy, save files are
        unchanged.
    *   **Measured on the RG35XX SP**, Fear & Hunger 2, map 19, standing,
        third ten-second period of each run: logic step 15.7 ms with the
        two switched off, 11.4 ms with them; parallel common events 5.93
        ms against 3.89; the costly check 1.34 ms against 0.22. Eight of
        twelve pure checks were slowed; the equipment list was rebuilt
        336 times for 276,669 questions.
    *   **Checked**: Fear & Hunger still slows its seven named events
        and walks as before; on a fast machine (headless, on the build
        computer) no event reaches the limit, so nothing is slowed.
    *   **Not checked**: a full walk comparison (the walk benchmark is
        too noisy), other games, play by hand.
*   **Short stops while playing: the player's own profiler was one cause (2026-11-16).**
    *   **Reported**: a drop every seven to ten seconds on the RG35XX SP
        in Fear & Hunger 2.
    *   **Found**: whenever a ten-second period ran below 22 frames per
        second, the player started the engine's sampling profiler for
        the log, and starting it stopped the game for 1.5-1.7 s (four
        runs, always at the same point), up to four times per run. It
        is now done only with `--profile-slow`.
    *   **Ruled out**: memory collection (57 pauses and 785 ms in a 74 s
        run; three full ones of about 30 ms, the small ones about 13 ms
        each); reading files, decoding pictures or sound and sending
        textures outside map changes; the game's events in the slow
        frames of an automatic walk. Counted with the new
        `player.memoryPauses()`.
    *   **The ten-second log line now explains itself**: it counts the
        frames over 60 ms and divides the slowest into logic, drawing,
        memory collection and the rest. A played session showed, in
        settled periods, single logic steps of 110-160 ms as the worst
        frame on maps 4, 114 and 15; map changes cost 0.4-1.2 s of
        drawing (textures of 1024x1024 sent to the GPU) and opening the
        menu about 0.5 s.
    *   **After the change**: an automatic walk of 78 s had no frame over
        95 ms in its last 46 s; by hand it was reported as clearly more
        stable.
    *   **Open**: what the 110-160 ms logic steps of real play are (not
        reproduced by the automatic walk; `tests/device/hitch_watch.js`
        names the slowest step, command and event of a slow frame), and
        one or two stops of 110-130 ms per run outside scripts and
        memory.
*   **A desktop Linux package for 64-bit ARM (2026-11-16).**
    *   **What**: `packaging/linux-x86_64/` became `packaging/linux/`;
        `build-package.sh` takes the architecture as `uname -m` names it
        (`x86_64` or `aarch64`) and makes `mvplayer-linux-<arch>.tar.gz`
        with the same start script, notes and bundled libraries. The ARM
        package holds the program that goes to the handhelds.
    *   **Checked**: both packages pass the script's checks (they need
        glibc 2.35). The ARM package, extracted in a clean Debian 12
        arm64 container with a virtual X display, finds all its
        libraries and plays Fear & Hunger's intro video to the end
        through the system's ffmpeg.
    *   **Not checked**: a real ARM desktop, with a real GPU driver.
*   **The game list remembers, adds and browses (2026-11-16).**
    *   **Asked for**: a game chooser that shows the games played last,
        lets new ones be added, and lets the user look through folders
        for a game, saying what to choose.
    *   **Recents**: the list keeps one file of www folders (`--games-file`),
        the game chosen or added last on top, and shows those games first,
        then the others by title. Every platform passes that file now:
        `MUOS/emulator/mvplayer/games.txt`, `RPGMV/mvplayer/games.txt` on
        Android, `~/.config/mvplayer/games.txt` on desktop Linux.
    *   **Adding**: "+ Add a game..." opens a second screen inside the
        list that shows folders, from the places given with `--browse`
        (`/mnt` on muOS, the shared storage on Android, the home folder
        and `/` on desktop Linux). Two lines say what to do: go into the
        game's own folder and choose its .exe, or index.html inside www.
        Shown are folders and the files that can stand for a game (.exe,
        index.html, package.json); a folder that is itself a game offers
        "Add this game: <title>" as its first line.
    *   **One place for each decision**: which game a path points at
        (`ResolveGameDir`) and the remembered list (`RememberGame`) are
        native, in `platform/game_library`; order and browser lines are
        in `js/picker-model.js`. Both have tests. The desktop launcher no
        longer opens a zenity or kdialog file dialog.
    *   **Checked on the RG35XX SP** with scripted key presses and screen
        captures: the list, the browser at `/mnt`, adding a game from its
        own folder, the order afterwards, and the file written. A game
        already in the list vanished after adding another one; fixed,
        with a test.
    *   **Not checked**: on Android and desktop Linux (builds not yet
        made), a folder with hundreds of entries, touch-only use beyond
        the on-screen pad.
*   **A better-looking game list, touched directly (2026-11-16).**
    *   **Why**: on a phone the list was plain text lines worked through
        the on-screen pad ("extremely shabby", from a first try).
    *   **Look**: the chosen game's title picture (`img/titles1` or
        `titles2`, named in the game's `System.json`) fills the
        background under a dark veil; each game is a rounded line with
        its icon (`www/icon/icon.png`), title and folder; "Add a game"
        and the frame-rate switch are lines of the same kind; the
        browser's lines carry folder and file signs and its explanation
        sits in a panel. The system's font is preferred over a game's.
        The title picture is decoded only once the choice has rested on
        a game for eight frames. All of it is drawn on the native canvas
        (paths, gradients, clipped pictures); nothing was added to it.
    *   **Touch and mouse**: in the list the first finger and the left
        mouse button go to the script as they are (`player.onPointer`),
        and the on-screen controls are not shown. Touching a line
        chooses it, lifting there opens it, dragging moves the list. A
        game opens only at a second touch: the first one chooses it, so
        that its title picture is seen.
        Which line is under a point and how far a drag moves are in
        `js/picker-model.js`, with tests.
    *   **Checked**: pictures taken without a screen at a phone's
        proportions (1200x540) and on the RG35XX SP (640x480), list and
        browser, with keys.
    *   **Not checked**: touching and dragging on a real phone or with a
        mouse (no way to send pointer events in the screenless run);
        games with encrypted pictures show no icon or background. On a
        phone it was reported as working, by hand.
*   **The frame-rate setting left the game list (2026-11-16).**
    *   **Why**: the player's settings menu, opened inside a game, already
        switches the frame counter; the list's own line was a second
        place for the same thing.
    *   **Now**: the list has only games and "Add a game". It no longer
        prints `MVPLAYER_FPS`, and the muOS, Android and desktop Linux
        launchers no longer keep a `show-fps` file or pass `--fps`. The
        counter is off when a game starts and is switched in the menu
        (or with F2, or the menu button plus Select), for that run.
        `--fps` and `MVPLAYER_FPS=1` still start a game with it on, for
        tests.
*   **A resizable window on desktop Linux (2026-11-16).**
    *   **Why**: the player took the whole screen everywhere; on a desktop
        it should be an ordinary window.
    *   **Now**: under X11 or Wayland the window is windowed and
        resizable, as large a whole or half multiple of 816x624 as fits
        in 85% of the display, at least 408x312. F11 switches to the
        whole screen and back; `MVPLAYER_FULLSCREEN=1` starts that way
        (the screenless runner sets it). Handhelds and phones are as
        before. A game's picture was already fitted to the screen's size
        on every frame, so it only needed the new size; the touch
        controls and the game list are told (`player.onResize`), and the
        list lays itself out again (`fit` in `js/picker-model.js`, with
        tests).
    *   **Checked** without a screen, in a real X11 window resized with
        xdotool: the list at 816x624, 1000x420 and 520x700, and Fear &
        Hunger's title in a 1100x400 window, its picture centred with
        its proportions. The RG35XX SP still opens 640x480 full screen.
    *   **Not checked**: on a real desktop with a window manager, F11,
        Wayland, a high-density display.
*   **Defects found by a review of the repository, fixed (2026-11-16).**
    *   **Far autorun events never started.** `eventCulling` visited far
        events only when their page was a parallel one; the engine starts
        an autorun event from the event's own update, wherever it is, so a
        scene set to run on entering a map did not run if its event was
        far from the player. Events that move by themselves also stood
        still beyond the patch's 4 tiles, where the engine moves them up
        to half a screen beyond the screen's edges. Both are now visited.
        Cost on the RG35XX SP, walking in Fear & Hunger 2: 67 events
        visited of 219 (65 before), 12.3-12.8 ms per logic step (12.5-12.6
        before): none that can be measured.
    *   **The patch's marks went into save files.** It kept `_labFar`,
        `_labStale` and `_labSelfStarting` in the events, which the engine
        saves. They are now kept beside the events (a WeakMap).
    *   **A state query could write past its memory.** `gl.getParameter`
        asked the driver for any name into one integer; names with
        several values wrote beyond it. Only names whose number and kind
        of values are known are asked for now; others give null.
    *   **Pixel buffers went to the driver unmeasured.** `readPixels` and
        the long forms of `texImage2D` and `texSubImage2D` passed a
        script's bytes on without checking that they hold the image. The
        bytes needed are worked out from size, format, type and row
        alignment, and a shorter buffer is refused.
    *   **Android ran arguments from shared storage.** The test file
        `args.txt` was read from `RPGMV/mvplayer`, where any app with file
        access could put one and name a script to run. It is read only
        from the app's own folder now.
    *   **Tests**: `tests/patches/event_culling.test.js` (the patch had
        none) and `tests/native/gl_limits_test.cpp`, over the new
        `bindings/gl_limits`. `tools/build/test.sh` ran the menu test
        twice; each test now runs once.
    *   **Not checked**: an autorun event far from the player in a real
        game (none at hand), a save file compared before and after.
*   **Games can be taken off the list (2026-11-16).**
    *   **Asked for**: removing games from the list, on every platform.
    *   **What it does**: the chosen game leaves the list; its files are
        never touched. It stays off on later runs, also when it sits in
        one of the folders the list looks through (`ROMS/RPGMV`, `RPGMV`),
        until it is added again through "Add a game". The games file
        keeps it as a line starting with `-` (`ForgetGame`,
        `ForgottenGames` in `platform/game_library`); adding or playing a
        game clears that line (`RememberGame`).
    *   **Controls**: X on a controller (which presses Shift by default),
        Delete or Shift on a keyboard; with fingers or the mouse, a cross
        drawn at the end of the chosen game's line. Each asks first: the
        line says "Take it off the list?" and the same press again
        confirms. A or B (or a phone's Back) keep the game; moving to
        another line forgets the question. The Delete key now reaches
        scripts as key code 46.
    *   **Checked** without a screen (arm64 container, 816x624), with
        scripted key presses, taps and captures: asking, taking off,
        keeping, the file written, a game taken off staying hidden on the
        next run, and coming back when added again. Native and model
        tests cover the file format and where the cross is.
    *   **Not checked**: on the RG35XX SP, a real phone, or a desktop
        with a real mouse. A keyboard user reading the hints sees "X
        Remove", but the keyboard's X key leaves the list (as before, the
        hints name controller buttons).

*   **Video on Android (2026-11-17).**
    *   **Before**: the Android build had a stand-in video player that did
        nothing (`video_none.cpp`), because Android has no `ffmpeg` to
        start; a game went on as if each video had ended at once.
    *   **Now**: the package carries its own decoder, the `ffmpeg` program
        cut down to reading WebM, MP4 and Ogg and decoding VP8, VP9, H.264,
        H.265, Theora, Vorbis, Opus, AAC and MP3 (3.9 MB; LGPL parts only;
        `tools/build/build-android-ffmpeg.sh`). It sits in the package's
        library folder as `libffmpeg.so`, the only place an app may start
        a program from. The app finds it next to its own library
        (`VideoPlayer::DecoderBeside`) and the ordinary video player
        (`video.cpp`) is built for Android too; the stand-in is gone. Where
        `posix_spawn` is missing (before Android 9) the decoder is started
        with fork and exec. The APK grows from 10.0 to 11.8 MB.
    *   **Checked**: the same cut-down configuration built for Linux, with
        the player's exact arguments: a game's VP9 + Opus video (985
        pictures, 32 s of sound), an H.264 + AAC one, and one without
        sound. That run found the raw sound output missing from the first
        configuration. On the phone (Zebra TC53E, Android 15): the package
        installs, the decoder is unpacked as a program, the player logs
        that it will use it, and the decoder itself, started from a shell,
        decodes all five videos of Fear & Hunger 2 (`gods.webm`: 182
        pictures, 6.06 s of sound).
        Then inside the app, with `tests/device/video_watch.js` on
        Fear & Hunger 2: `gods.webm` played to its end in 6.7 s, 60
        frames drawn per second, sound at full level, and a capture of
        the screen shows the video's picture.
    *   **Not checked**: the fork-and-exec path, which needs a phone with
        Android 8.

*   **RPG Maker MZ: first run and what it needs (2026-11-18).**
    *   **Test game**: a free MZ game with the engine's stock scripts and
        assets ("Escaper", from itch.io; kept outside git). MZ's layout
        differs from MV's: no `www` folder, the page and `js/` sit next to
        the `.exe`; `index.html` names only `js/main.js`, which adds the
        other scripts to the page itself; PIXI is 5.2.4.
    *   **Rule**: nothing done for MZ may change how an MV game runs. The
        player tells the engine from the game's files and loads a
        different set of layers for each (`js/engine-select.js`): an MV
        game gets exactly the layers it had before MZ existed here; an MZ
        game gets those and then its own, loaded last, which may replace
        parts of the earlier ones. What only MZ needs is not put in the
        shared ones. A test pins MV's list. (Later the same day the MZ
        layers became pieces listed in a profile: see below.)
    *   **Done**: a folder with `index.html` and `js/rmmz_core.js` is a
        game (`ResolveGameDir`, native test). For MZ only: `atob`/`btoa`
        for scripts (`js/base64.js`), which MZ's sound decoder library
        calls while loading; and the page's load event comes after work
        the scripts had already queued (`js/mz.js`), because MZ reads a
        file while loading and refuses to start if the answer is not
        there at load time.
    *   **Why the rule**: the load-event change was first made in the
        shared page code, and Fear & Hunger stopped starting: it has a
        plugin that fails while loading, and with the new order the
        engine learned of it in time to refuse. The shared code is back
        as it was.
    *   **Found, not done**, in the order the engine hits them:
        1.  **WebAssembly.** V8 is built with `v8_enable_webassembly =
            false` on all three targets. MZ needs it for Effekseer (every
            battle and skill animation) and its Vorbis decoder library
            fails while loading without it. Needs V8 rebuilt three times.
        2.  **Web Audio check.** The engine stops with "Your browser does
            not support Web Audio API": it wants `AudioContext`, and its
            `WebAudio` class is not MV's.
        3.  **Fonts.** MZ loads `.woff` files through `FontFace` and
            `document.fonts`; neither exists here, and no font is found.
        4.  **IndexedDB check**, made at start even though a desktop game
            saves through Node's `fs`.
        5.  **PIXI 5 on the WebGL binding**: not reached yet.
    *   **How it was probed**: the game run without a screen in the ARM
        container; past point 1 with a scratch copy whose two WebAssembly
        libraries were replaced by empty stand-ins. Nothing was drawn yet.

*   **RPG Maker MZ on Android: title screen with the real libraries (2026-11-18).**
    *   **One V8 for both engines, with WebAssembly.** Built for Android
        (`v8_enable_webassembly = true`; the library grows from 69 to 88
        MB, the player inside the APK from 32.3 to 40.1 MB, the APK from
        11.8 to 13.9 MB). Before replacing the old one, Fear & Hunger 2
        was measured on a Zebra TC53E with two APKs built from the same
        source, one with each V8, on a new game walking on map 1 for 40 s:

        | | V8 without WebAssembly | V8 with WebAssembly |
        | --- | --- | --- |
        | Frames per second | 60 | 60 |
        | Logic step | 2.44 ms | 2.40 ms |
        | JavaScript heap at the end | 66.9 MB | 66.8 MB |
        | Memory (PSS) 50 s in, first pair of runs | 254 MB | 260 MB |

        Speed is the same. Memory is about 5 MB higher, also seen in the
        game list (77 against 82 MB); runs of the same build differ by
        more than that (one run without WebAssembly read 223 MB), so the
        figure is rough. The handheld and desktop V8 are not rebuilt yet,
        and the handheld, with 1 GB, is where those 5 MB must be checked.
    *   **What the real libraries needed**, all in the MZ layer
        (`js/mz.js`): a `Worker` that can be made and never runs (the
        sound decoder library starts one while loading; the engine only
        uses that decoder where Ogg cannot be played, and the player
        plays Ogg itself); and V8's queued tasks run once a frame
        (`player.runEngineTasks`, new in the host): the promise of
        `WebAssembly.instantiate()` is settled by such a task, and
        Effekseer waits on it before the game starts. An MV game is never
        given either.
    *   **Seen on the phone**: the MZ test game, unmodified, loads its
        twelve scripts, both fonts and Effekseer, and shows its title
        screen correctly (screen capture). Sound is not confirmed by ear.
    *   **Not checked**: anything past the title (new game, maps, battles
        and their Effekseer animations, saving), and MZ on the handheld
        or a desktop.

*   **MZ takes key presses; the menu says whether the frame counter is on (2026-11-18).**
    *   **MZ ignored every key.** Tried by hand on the phone, the MZ game
        stayed on its title. On each key press, click and touch MZ calls
        `play()` on its video element and adds `.catch()` to the result;
        the player's `play()` gave nothing back, so every key press ended
        in an error before reaching the game. Under MZ `play()` now gives
        a promise (`js/mz.js`, tests). The runs without a screen had not
        pressed a key, which is why they missed it; they now do.
    *   **Checked**: with scripted key presses, without a screen and on
        the phone with the real libraries: new game, the first message,
        and walking on map 1; the map is drawn correctly (captures).
    *   **Frame counter row.** The settings menu's row read "FPS COUNTER"
        whatever the state. It now reads "FPS COUNTER: ON" or ": OFF".
        The counter belongs to the scripts, which switch it on each press
        of F2; the input layer follows every F2 it passes on (keyboard,
        menu button + Select, the menu's own row) and starts from the
        `--fps` setting. Native test for the row; seen on the phone.
    *   **Not checked**: MZ battles and their animations, saving and
        loading, sound by ear.

*   **MZ battles: the WebGL calls Effekseer makes (2026-11-18).**
    *   **Seen**: on the phone, the MZ game stopped when a battle began,
        with "GLctx.isEnabled is not a function". Effekseer is compiled
        to WebAssembly and brings its own GL layer, which uses parts of
        WebGL that PIXI never does.
    *   **Added to the binding**: `isEnabled`; the `is*` queries;
        `uniform2i`–`4i` and their array forms; `vertexAttrib1f`–`4f`;
        `hint`, `lineWidth`, `polygonOffset`, `depthRange`,
        `sampleCoverage`; the three `stencil*Separate`; `validateProgram`,
        `detachShader`; `copyTexImage2D`, `copyTexSubImage2D`; and the
        getters for texture, buffer and renderbuffer parameters, shader
        source and attribute offset. These are new functions on the one
        WebGL object; an MV game calls none of them.
    *   **Still missing** of what Effekseer's GL layer names: compressed
        textures, `getUniform`, `getVertexAttrib`, `getAttachedShaders`,
        `getFramebufferAttachmentParameter`, and the WebGL 2 and extension
        calls, which it only uses where the extension is offered.
    *   **Checked**: `tests/device/webgl_state_check.js`, new, calls every
        added function on a real context (it failed on each group before,
        passes now, without a screen). On the phone, a scripted battle
        against the game's first troop runs from start to end: two turns,
        the enemy defeated, back to the map; captures show the
        background, the enemy, the damage number and the status window.
    *   **Not checked**: the Effekseer animations themselves, by eye;
        sound; videos (this game has none).

*   **Layers by capability, switched on by a profile per engine (2026-11-18).**
    *   **Why**: a review of the MZ work found that the "MZ layer" held
        almost nothing about MZ. `atob`, `FontFace`, `Worker`,
        `indexedDB`, a video's `play()` promise and the order of the load
        event are parts of any browser; running V8's queued work is the
        duty of any program that embeds V8; `nw` is the desktop player's
        interface. MZ only happened to be the first to ask. Kept under
        MZ's name they would be rewritten, or missed, for the next game
        that needs one of them, including an MV game with a plugin that
        calls `atob`.
    *   **Now**: each is a file of its own that knows nothing of the
        game's engine (`web-base64.js`, `web-load.js`, `web-fonts.js`,
        `web-storage.js`, `web-workers.js`, `web-media.js`,
        `nw-global.js`, `engine-tasks.js`). `engine-select.js` holds one
        profile per engine: the pieces switched on for its games, loaded
        after the common layers. MZ's profile lists all eight. MV's is
        empty and pinned by a test, so the rule above still holds: a
        piece reaches MV games only when it is put on MV's list on
        purpose, after an MV game has been run with it. Tests also check
        that every piece named exists and that no piece is in no profile.
    *   **What stays tied to an engine**, and so does not belong in a
        piece: the patches, the performance line's hooks, the shortcuts
        for encrypted files and the reading of the engine's error screen.
        Today these exist for MV only; MZ gets none of them yet.
    *   **Checked**: no behaviour was meant to change, and none did.
        Fear & Hunger reaches its title with the same picture (lit
        fraction 0.634); the MZ game starts a new game and walks, as
        before; all JavaScript tests pass.
    *   **Limit of "any game"**: the aim is any RPG Maker MV or MZ game,
        with its plugins. It is not any game built on web technology:
        there is no HTML or CSS layout, WebGL 1 only, and parts of Canvas
        and Web Audio.

*   **A stick to move with on touch screens, and a round pad instead if wanted (2026-11-18).**
    *   **Asked for**: the cross-shaped pad was small, ugly and awkward.
        An octagonal pad was tried and rejected on sight. Decided: a
        stick is the standard control, a round pad the alternative, and
        two directions held together move diagonally where the game
        allows it.
    *   **The stick** has no place of its own while playing: it appears
        under a thumb that lands anywhere in the left half of the screen,
        on no button. Nothing is held until the thumb has moved 0.3 of
        the stick's radius; then one arrow, or two on the diagonals
        (eight even directions). The knob follows the thumb to the
        stick's edge; past it the whole stick comes along, a radius
        behind, so turning back takes effect at once. With no thumb on it
        it is drawn faintly at its own place, which the editor can move
        and resize like any control.
    *   **The pad** is a disc cut in four by its diagonals, with an
        arrowhead in each quarter and a neutral ring in the middle; the
        quarters of the arrows held are lit, two on a diagonal. It stays
        where it is drawn. Radius 0.21 of the screen's shorter side (it
        was 0.17), answering 1.35 radii from its centre (was 1.5).
    *   **Choosing**: the settings menu has a row, "MOVE: STICK" or
        "MOVE: PAD", shown when the touch controls are. The choice is
        part of the game's touch layout (`touch-controls.txt`, the word
        `stick` or `pad`), so it is kept per game; a layout saved before
        this keeps its pad.
    *   **Diagonals**: both controls hold two arrow keys on a diagonal.
        Whether the character then moves diagonally is the game's
        business: RPG Maker moves in four directions unless a plugin adds
        eight.
    *   **Checked**: native tests for the stick (landing, each step of a
        pull, following, lifting, right half ignored, together with a
        button), the switch, the file format and the menu row; the pad's
        eight directions are pinned 20 degrees either side of each
        middle. On the phone: captures of the stick under a swipe with
        its knob pulled, of the menu row, and of the round pad; the saved
        file changes between `stick` and `pad`.
    *   **Not checked**: how it feels in the hand. Handhelds and
        controllers are not affected: the on-screen controls only show
        on a touch screen without a controller or keyboard.

*   **A second MZ game, a commercial one with plugins and encrypted files (2026-11-18).**
    *   **Game**: "Look Outside" (the user's copy, kept outside git): MZ
        1.8.1, PIXI 5.3.12, images and sounds encrypted, 24 plugins
        switched on, Steam's interface (Greenworks), 1.3 GB.
    *   **First run** (without a screen, the two WebAssembly libraries
        replaced by empty stand-ins): stopped while loading its first
        image. MZ encrypts by MV's scheme but keeps the file's name and
        adds an underscore (`Window.png_`, `Theme.ogg_`); the shortcut
        that gives the engine only the start of an encrypted file knew
        MV's names alone, so the image arrived whole, was unscrambled in
        script, and could not be shown from there.
    *   **Done**: the two name patterns are now values the common layer
        reads (MV's by default, unchanged), and `mz-files.js`, a piece of
        MZ's profile, sets MZ's. This is the first piece that belongs to
        one engine rather than to the browser. `web-page.js`, a browser
        piece, makes the elements a page declares with an id findable:
        this game keeps a `<canvas id="refresher">` in its page and
        clears it every second, which failed every second.
    *   **Result**: the game loads its scripts and plugins, both fonts
        (`.ttf` this time) and its encrypted images, plays its pre-title
        scene and shows its title screen correctly (capture). The Steam
        plugin reports that it could not start and the game goes on.
    *   **Seen and left**: "colour not understood: deepskyblue" (a named
        CSS colour missing from the table); PIXI's warning that 32-bit
        index buffers are not offered.
    *   **Not checked**: the game with its real libraries, sound
        (encrypted), anything past the title, and the game on a device.
        The Linux V8 is being rebuilt with WebAssembly for that; its
        build script now reuses a checkout already at the right version,
        which a second run used to trip over.

*   **V8 with WebAssembly on Linux ARM; MZ games with their real libraries (2026-11-18).**
    *   **Built**: V8 for 64-bit ARM Linux with WebAssembly (library 72.6
        to 92.7 MB, player 29.9 to 38.0 MB). It is the one the handheld
        and the ARM desktop package will carry.
    *   **MV first**: Fear & Hunger, a new game walking for 40 s without
        a screen, with a player built on each V8: 2.27 ms a logic step
        without WebAssembly, 2.37 with (the walk is random and the two
        runs took different paths; drawing, done in software there, is
        the same). No difference to act on. The handheld's memory is
        still to be measured.
    *   **MZ, unmodified, without a screen**: "Escaper" runs a whole
        battle with Effekseer loaded through WebAssembly. "Look Outside"
        reaches its title, starts a new game and enters its first map
        with a message showing; no error. A capture taken there is
        black, and it is not known whether that is the game's own dark
        opening or a drawing fault: to be looked at on a screen.
    *   **On the handheld** (RG35XX SP), with the muOS package rebuilt on
        the new V8. Fear & Hunger 2 continued from a save and walked for
        40 s, measured with the old player and the new one:

        | | V8 without WebAssembly | V8 with WebAssembly |
        | --- | --- | --- |
        | Logic step | 9.97 and 10.42 ms (two runs) | 10.37 ms |
        | Memory in use 55 s in | 441 MB | 445 MB |
        | Highest memory | 458 MB | 459 MB |

        Speed is within what two runs of the same player differ by, and
        memory is 4 MB up: the same as on the phone. The new V8 stays.
    *   **MZ on the handheld**: "Escaper", unmodified, reaches its title
        in 2.4 s, starts a new game and runs a whole scripted battle; no
        error; 295 MB of memory. It showed 1502 frames in 60 s, 25 a
        second, which is low for so light a game, and there is no way
        yet to say why: the performance line is not written for MZ.
    *   **x86-64**: V8 rebuilt with WebAssembly too (library 92.4 MB),
        and the three Linux packages made from the new libraries: x86-64
        16 MB, ARM desktop 15 MB, muOS 12 MB; each passes its package
        checks and needs glibc 2.35 as before. The x86-64 player was not
        run here: this machine has no way to run it without a screen.
*   **The performance line for MZ; the frame counter in MZ games (2026-11-18).**
    *   **Performance line.** It was hooked to MV's functions and never
        written for MZ. The measuring is now a meter (a frame begins; run
        and time a logic step; run and time a drawing) that boot.js
        hooks to MV as before, or hands to a piece of the game's profile:
        `mz-perf.js` hooks it to MZ, where a frame is a tick of PIXI's
        ticker and drawing is the PIXI application's render. MV's line is
        unchanged (checked without a screen).
    *   **What it shows on the handheld**, "Escaper" on its first map: 30
        frames a second, two logic steps a frame at 1.5 ms each, and 15
        ms of drawing a frame; in battle 16 to 28 frames a second with 19
        to 43 ms of drawing. So the game is held back by drawing, not by
        its scripts: 3 ms of logic and 15 of drawing do not fit in the
        16.7 ms of a frame, and the screen then shows every other one.
        Fear & Hunger 2, far heavier in scripts, draws in 9 to 12 ms on
        the same machine. Why PIXI 5 costs more here is not known yet.
    *   **Frame counter.** In an MZ game it showed nothing: asked for a
        font before the game had loaded any, the player kept "no font"
        for good and drew an empty black box. It now keeps the answer
        only once there is a font. Seen on the phone: "60 fps" over an MZ
        game. The counter is small on a phone's screen.

*   **Why MZ draws slowly on the handheld, and two patches for it (2026-11-18).**
    *   **Found by reading the engine**, after the performance line
        showed drawing as the cost: MZ draws through filters that MV does
        not have. A filter makes PIXI draw what it covers into a texture
        and copy it back. MZ keeps three colour filters switched on for
        every frame whatever they are set to (on the scene, for fades; on
        the map's or battle's sprites, for brightness; on the layer under
        them, for the tone), gives a sprite one more for good the first
        time it is tinted, and clips every window's contents with a
        filter of its own. A map costs three passes over the whole
        picture; a menu or a battle, those plus one for each open window.
    *   **`idleColorFilters`**: PIXI skips a filter whose `enabled` is
        false, and draws straight to the screen when none is enabled. The
        patch sets it from what the filter was last told: off while its
        hue is 0, its tone all zeros, its blend colour without strength
        and its brightness full, which is when its shader gives back the
        colour it got. It cannot see a script that writes a filter's
        uniforms directly.
    *   **`windowClip`**: the window's filter changes no colour; only its
        bounds matter. The patch takes it off and masks the client area
        with a rectangle of the window's inner size, cut with a scissor.
        It has to be a scissor: PIXI's other mask is the stencil, which
        MZ's window layer already uses for itself.
    *   **Measured without a screen** (software drawing, so only the
        ratio means anything), "Escaper": on its first map, drawing went
        from 18.6 to 9.2 ms a frame, and frames from 47 to 94 a second,
        with the first patch alone. In a battle, with both, 32 to 22 ms
        and 62 to 31 ms in two of three periods; the third, while an
        Effekseer animation plays, stays near 80 ms there. Captures of
        the map and of the battle look as before: text, window contents
        and the fading enemy are in place.
    *   **On the handheld**, the same scripted new game and battle of
        "Escaper", without and with the two patches:

        | | Without | With |
        | --- | --- | --- |
        | First map, frames a second | 29 | 60 |
        | First map, drawing a frame | 15.4 ms | 13.8 ms |
        | Battle, frames a second | 25, then 16 | 34, then 28 |
        | Battle, drawing a frame | 22.9, then 45.1 ms | 17.5, then 24.1 ms |

        The map's drawing time falls little, but it was just over what
        fits in a frame beside the logic, and now it fits: every frame is
        shown instead of every other. Battles gain most in drawing time
        and are still short of 60. Nine captures of each run show the
        same pictures: windows, texts, the enemy flashing white when
        hit, and the Effekseer animations.
    *   **Not checked**: the patches on "Look Outside", whose plugins
        include a filter controller and layered graphics.

*   **Black squares in MZ battles: what is bound must be given back as itself (2026-11-18).**
    *   **Reported**: on the handheld, during battles, black squares over
        the enemies and over the life bars, for a moment.
    *   **Reproduced** with a scripted battle against three enemies and a
        capture of the screen twice a second: one capture in 44 had a
        black square over each enemy (their state icons) and the inside
        of the status window black. It falls between the moment Effekseer
        loads an animation's files and the first time that animation is
        drawn, about a third of a second. The patches were not involved:
        it happens without them.
    *   **Cause**, in the WebGL binding, not in the game: Effekseer's GL
        layer uploads its textures between frames. Around each upload it
        asks which texture is bound, binds its own, and binds the earlier
        one again. `getParameter(TEXTURE_BINDING_2D)` answered with the
        driver's number for the texture, not with the texture object the
        page had bound; binding a number binds nothing. PIXI, which
        remembers what it bound and does not bind it twice, then drew
        with no texture on that unit, which draws black, until MZ told it
        to forget its bindings after the next animation was drawn. The
        logged drawing state (blending, masks, tests) was never disturbed.
    *   **Fix**: the binding remembers the objects the scripts bind
        (textures for each unit, both buffers, the framebuffer, the
        renderbuffer, the program) and gives those back; deleting an
        object unbinds it. An MV game never asks.
    *   **Checked**: the device check gained these cases (each failed
        first). On the handheld, 34 captures 0.12 s apart across the
        first attacks: before, one capture with the squares; after, none,
        with the patches and without (pure black pixels stay at the 1440
        to 1457 of the screen's own borders, against 1740 and 18962 in
        the faulty captures). Fear & Hunger still reaches its title.

*   **A page that names a script it does not have (2026-11-18).**
    *   **Reported**: a game did not start; its log ended with "boot:
        script failed: cordova.js". The game's page names `cordova.js`,
        which only the wrapper of a phone export provides; the file is
        not among the game's files. The player stopped at the first
        script of the page it could not run.
    *   **Now**: a script the page names that is not there is passed
        over with a warning, as a browser does with a file it cannot
        fetch. A script that is there and fails still stops the start.
    *   **Checked** without a screen: Fear & Hunger with `cordova.js`
        added to its page logs the warning, loads its twelve scripts and
        reaches its title with the same picture. Not checked: the game
        it was reported on.

*   **A plugin that sets up the desktop window (2026-11-18).**
    *   **Reported** from a desktop PC, with a third MZ game:
        "win.setResizable is not a function" in a plugin that sets the
        game's resolution, then "Failed to load" for that plugin, and the
        game did not start. The window stand-in answered only what the
        engine itself asks; a plugin asks for more.
    *   **Now**: `nw-window.js`, a piece of MZ's profile, accepts the
        rest of the desktop player's window calls (setResizable, the size
        limits, setPosition, maximize and the like, kiosk mode, always on
        top, and others), which have nothing to change here, and gives
        the list of screens one entry: the area the game is shown in.
        What the window already answered is left as it was.
    *   **Checked**: tests; without a screen, a script calling
        setResizable, setMinimumSize and setPosition on an MZ game is
        accepted and reads the screen's size. Not checked on the game it
        was reported with, which is not on this machine.
    *   **A survey to get ahead of such cases**: a scan of the three
        games at hand for the browser, desktop-player and Node features
        their own scripts name found 61, of which the player lacks 15:
        Steam's interface in nine forms, `confirm()`, Node's `os` and
        `events`, `requestFullscreen`, and three other wrappers. A scan
        only says whether the player has something by that name, and it
        would have found neither this case nor the missing page script.

*   **The desktop player's interface accepts whatever it is asked (2026-11-18).**
    *   **Why**: the missing window call was first fixed by listing some
        thirty calls a plugin might make. A list only holds until the
        next plugin asks for another, and the question came up of
        checking each game's plugins ahead of time.
    *   **Decided**: for the desktop player's interface, and only for
        it, the answer to nearly everything is "accepted, nothing to
        do", because the window is always the player's own. So instead
        of names, a rule: `nw-lenient.js` (in place of the list) makes
        the window, the application, the screens, the shell and anything
        else under `nw` answer what they know as before and accept any
        other call, to any depth (`nw.Clipboard.get().set(...)`), doing
        nothing. Each is written once in the log as "not provided ...
        (accepted: does nothing)". What the window is, rather than does
        (full screen, kiosk mode, title, zoom), is a short list with
        real values.
    *   **Not for the browser's interface**: accepting an unknown call on
        the document, a canvas or sound would let a game go on drawing
        or sounding wrong without a word. Those stay as they are: missing
        until written.
    *   **Known cost**: what comes back from an accepted call counts as
        true in a condition.
    *   **Checked**: tests (any call, said once, known ones untouched,
        depth, real values, waiting on and writing out an absent thing);
        without a screen, a script making such calls on an MZ game, and
        both MZ games still running. Not checked on the game that
        prompted it.
    *   **Not done**: reading a game's plugins before starting it and
        logging at once everything they name that the player lacks.

*   **fetch, for the game's own files (2026-11-18).**
    *   **Reported**: with the two fixes above the third MZ game got
        past its page and its window plugin and stopped at "fetch is not
        defined". The engines read files through XMLHttpRequest; newer
        plugins use fetch.
    *   **Now**: `web-fetch.js`, a browser piece on MZ's profile. It
        reads a file of the game and gives its text, its JSON or its
        bytes, read when asked for. There is no network: an address on
        another machine fails as with no connection, and a file that is
        not there fails as for a page opened from disk. The body as a
        stream is not provided.
    *   **Checked**: tests; without a screen, on an MZ game, a JSON file
        read and parsed, its bytes, and a missing file failing. Not
        checked on the game it was reported with.

*   **A font whose name differs in case from what the game asks for (2026-11-18).**
    *   **Reported**: the third MZ game, now past `fetch`, stopped with
        a load error for one of its fonts, a `.woff2` file.
    *   **Not the format**: a WOFF2 font made from a font at hand loads
        in the same FreeType the packages carry.
    *   **Cause**: every file of a game is looked for whatever the case
        of its name (`FindFile`), since games written on Windows name
        files loosely and Linux does not forgive it. Registering a font
        was the one place that opened the path as written: the player
        said the file was there and then could not open it.
    *   **Fix**: a font is looked for like every other file.
    *   **Checked** without a screen, in a folder that tells cases apart:
        a font stored as `Probe.woff2` and asked for as `probe.WOFF2`
        was found but not registered before, and is registered now. Not
        checked on the game it was reported with.

*   **Read the game and adapt, instead of fixing one failure at a time (2026-11-18).**
    *   **Why**: a third MZ game was being brought up one error per run
        (a missing page script, a window call, `fetch`, a font), each
        answered with a change and a new package. The user called a
        stop: the player should read a game's files and work from what
        it finds.
    *   **Principle**, now applied in two places: what a game needs
        that the player cannot give should cost the game that one thing,
        not its start; and what is missing should be known at once.
    *   **Fonts**: a font that cannot be loaded no longer stops the
        game. The family is given another font: one of the game's other
        font files if one can be used, else one of the system's; with
        none, the game goes on without text in that family. The log says
        which file failed and what took its place. A browser would stop
        there, and so would the engine; here that is judged worse than a
        different typeface. (Why that game's font file does not load is
        still not known: the format loads, and the case of its name is
        handled.)
    *   **A survey at start** (`compat-report.js`): when the game's
        scripts have loaded, its switched-on plugins are read and what
        they name of a browser, of the desktop player and of Node is
        checked against what is really there at that moment, not against
        a list of names. What is missing is written to the log in one
        block, with the files that name it. It changes nothing and stops
        nothing. On the commercial MZ game: 24 plugins read in 43 ms on
        a desktop, two things missing (Steam's interface, Node's `os`).
    *   **Checked**: tests for both; without a screen, an MZ game whose
        main font file was replaced by a file that is no font starts
        with its other font and reaches its title; Fear & Hunger still
        reaches its title (MV's profile has neither piece).
    *   **Limits**: the survey reads plugins, not the engine or scripts
        loaded later; a name in a branch that never runs is still listed;
        a thing the player has by name may be incomplete.
    *   **On the handheld**: the commercial MZ game, copied there, reads
        its 24 plugins in 461 ms (43 ms on a desktop), starts without
        error and shows its title 14.6 s after starting, at 57 frames a
        second with both MZ patches on. Nothing past the title was tried.

*   **Saving in MZ (2026-11-18)**: MZ could save to a slot once. It
    keeps the previous file aside while it writes the new one
    (`fs.renameSync` to a backup name, write, remove the backup), the
    rename did not exist, and every later save to that slot failed:
    the save menu, the autosave after the first, and the options file
    from its second change.
    *   **Change**: `fs.renameSync` in `desktop.js`, over a new native
        `player.renameSaveFile`, which like the other file writes
        refuses any name outside `<game>/save`. MV never calls it.
    *   **Checked**: tests for the calls MZ makes, failing first.
        `tests/device/save_check.js` saves twice to slot 1 and loads it
        through the engine's own save code; without a screen it passes
        on the free and the commercial MZ game and on Fear & Hunger
        (MV), and fails at the second save without the change.
    *   **Not checked**: the save and load menus by hand, on a device,
        or a save made late in a game (larger files).

*   **Touches and the mouse for the game (2026-11-18)**: a finger only
    worked the player's own controls, and the mouse nothing, so what the
    engines do with a touch (walk to a touched place, choose from a menu,
    MZ's on-screen buttons) did not exist, in MV or MZ.
    *   **Change**: a finger that lands on none of the controls is the
        game's until it lifts (`TouchControls::ForGame`): with the stick
        that is the right half, with the pad the whole screen. A desktop's
        left mouse button and its movement go to the game; the right
        button is the Esc key. The place is turned from the screen into
        the game's picture (`platform/fit.h`) and `js/pointer.js`, a layer
        for both engines, makes the mouse events of it, at the page place
        the engine turns back into the touched one whatever it believes
        of its canvas's size. One finger is followed; a finger is told as
        the left button.
    *   **Checked**: tests, native and JavaScript. Without a screen,
        `tests/device/pointer_check.js` passes on an MZ game and on Fear &
        Hunger with its mouse-disabling plugin emptied; as shipped, that
        game ignores the mouse, as its author chose. A real click in a
        1280x720 virtual screen reaches MZ's `TouchInput` at the exact
        place in the 816x624 picture, a click on a side bar does not, and
        the right button cancels.
    *   **Not checked**: a real finger (the path from SDL's finger events
        to `ForGame` has only its unit tests), the mouse wheel (not
        passed), two-finger cancel.

*   **Touch on a phone, after trying it (2026-11-18)**: touching menus
    and walking by touch work with a real finger on the phone, and the
    right hand caused no stray touches. Two things were asked for.
    *   **Controls off**: a row "CONTROLS: ON/OFF" in the settings menu
        takes the stick and the buttons off the screen for a game played
        by touch; every finger is then the game's. The MENU button stays,
        so the row can always be reached again. Kept per game as a line
        "controls off" in `touch-controls.txt`, which older versions pass
        over.
    *   **Orientation on Android**: the list of games is shown upright
        and a game on its side. The start code sets SDL's orientation
        hint before each of the two runs, SDL asks Android when the
        window is made, and the list enlarges itself by the screen's
        shorter side so its text is the same size either way.
    *   **Checked**: tests for the switch, the file and the list's
        layout. The orientation has no test off the device.

*   **A video drawn by the game itself (2026-11-18)**: a free MZ game
    with nine videos plays them through a plugin that puts videos in
    sprites: it hands the video element to PIXI as the source of a
    texture (the splash before the title, a looping video behind the
    title menu) and never makes the element visible. The player could
    only show a video over the game, so PIXI refused the element and the
    game stopped before its title.
    *   **Change**: the element is an `HTMLVideoElement`, says its
        picture's size and how far it has played, and announces what
        PIXI's video resource waits for. `texImage2D` and
        `texSubImage2D` given the element of the open video send the
        picture the native player is at (`VideoPlayer::Frame`), once per
        new picture. Playing a video that has ended, or setting its time
        to the start, opens it again; setting the time to the end ends
        it; there is no seeking. The native player still has one video
        open at a time: videos loaded one after another (the plugin
        preloads all nine) are each told their data is there, and opened
        when played.
    *   **Another gap the same game showed**: `element.classList`, which
        a plugin sets on the canvas at every resize; the start-up survey
        had listed it. Now `web-classes.js`, on MZ's profile.
    *   **Checked**: tests for the element and the class list. Without a
        screen the game shows its 5.9 s splash, then its title with the
        video behind the menu, which ends after 43.4 s and starts again;
        Fear & Hunger's intro video, shown over the game the old way,
        plays as before.
    *   **Limits**: two videos cannot play at once (the later one wins);
        pictures are the size the native player scales to (816x624
        unless the element asks otherwise), not the file's own; not
        tried on a device.

*   **A pointer worked with the pad (2026-11-18)**: on the handheld the
    buttons did nothing in a game whose title menu is three pictures
    that only answer a click; it has no keyboard navigation, by its own
    design, and the handheld has neither mouse nor touch screen.
    *   **Change**: a row "POINTER: ON/OFF" in the settings menu, offered
        where there is no touch screen, kept per game in `pointer.txt`.
        While on, the directions move a cursor (a white cross edged in
        black) instead of reaching the game, slowly at first and faster
        while held, and the confirm button is the left mouse button at
        the cursor's place. Cancel and the other buttons stay the
        game's. `platform/pad_cursor` holds the logic.
    *   **Checked**: tests for the cursor and the menu row. Without a
        screen, with real key presses: the arrows move the cross and do
        not reach the game, confirm arrives as a press and a release at
        the cross's place, cancel arrives as its key.
    *   **Not checked**: by hand on the handheld; whether the speeds
        suit small targets.

*   **What the lighting costs on the handheld now (2026-11-18)**: asked
    whether a setting to handle the lights differently would help weak
    devices. Measured standing still from a save, 20 s with the lights
    as they are (drawn by the GPU, updated every third step) and 20 s
    with the plugin's update skipped and its mask hidden, twice each.
    *   **Fear & Hunger, map 74 (156 events)**: 45.8 and 46.8 frames per
        second with lights, 49.4 and 49.8 without: about 1.3 ms of a
        21 ms frame.
    *   **Fear & Hunger 2, map 19 (224 events)**: 23.3 and 23.4 with,
        27.5 and 27.9 without: about 6.5 ms of a 43 ms frame, nearly
        all of it outside the scripts (logic is 10.6 ms per counted step
        either way), so it is the GPU filling the mask and the multiply
        pass, paid when the frame is handed over.
    *   **Reading**: switching the lights off gives 7% and 19%. It also
        removes the darkness these games are built on. The larger part
        of a frame is still the scripts: two logic steps of about 13.7
        ms in Fear & Hunger 2.
    *   **A switch was tried and removed the same day**: a row "LIGHTS:
        ON/OFF" in the handheld's settings menu, over a patch that made
        the plugin's update do nothing and hid its mask. Through it,
        Fear & Hunger 2 on map 19 gave 23.5 and 23.9 frames per second
        on and 27.6 and 27.0 off. It worked, and it was a different
        game: without the darkness there is no fear. Removed; no code
        of it is left.
    *   **A fixed darkness would give half of that**: with the mask no
        longer recalculated but still laid over the picture, the same
        map gave 25.4 and 25.6 (23.0 and 24.2 as it is, 27.1 and 28.0
        without). Half the cost is deciding and painting the lights,
        half is blending a full-screen layer, which any darkness needs.
        A mode with one ready-made layer and a light around the player
        would therefore gain about 8% and lose the lights of the map.
        Not built.
    *   **The loop's last log line now says** what showing a frame costs
        beyond the game's work: on the handheld 0.3 ms to copy the
        picture to the screen and 4.9 ms to hand it over (which is where
        the GPU's work and the wait for the display are paid).
    *   **Also measured**: the MZ game with videos holds 49 to 55 frames
        per second in a room and 30 once a scene there shows two
        full-screen pictures over a looping video; where that time goes
        was not separated.

*   **Where the scripts' time goes in the heaviest game (2026-11-18)**:
    Fear & Hunger 2, map 19 (224 events, 80 parallel common events), on
    the handheld, standing still from a save, 25 s of V8's profiler with
    every patch on. Shares are of the samples, by where the time is
    spent itself.
    *   **By file**: the engine's objects 35%, PIXI 24%, the engine's
        sprites 9%, the engine's core 5%, a horror-effects plugin 3%,
        the patches themselves about 6% together, the lighting plugin
        under 1%.
    *   **By function**: `Game_CommonEvent.update` 10.6% (and 2.1% in
        the throttle around it), the interpreter's conditional branch
        4.7% and its search for the end of a branch 4.3%,
        `Sprite_Character.update` 3.8%; in PIXI, sending a batch's
        vertices to the driver 5.4% and binding framebuffers 3.1%.
    *   **Reading**: the parallel common events are still the largest
        single thing, about a quarter with the interpreter under them,
        though the pure checks among them already run every sixth step.
        Sprites of events are updated whether or not they are on the
        screen. Nothing was changed.

*   **Running checks only when what they read changes: built, no gain
    in the game it was meant for (2026-11-18)**: a pure check that looks
    at nothing but switches and variables was made to run once and then
    only after one of those is written with a new value, with a run
    every 60 steps as a safety net and its old way given back to any
    event that changes something on such a run. Chosen from the game's
    own command lists, nothing per game.
    *   **Measured on the handheld**, Fear & Hunger 2, map 19: 23.7 and
        23.6 frames per second with it, 23.6 and 23.8 without. It
        worked as designed (about 10,000 runs slept through, 8 woken,
        none given back) on 4 of the 51 active parallel common events:
        only 12 are pure checks, and 8 of those look at actors or items.
    *   **Where the cost is**: twelve "outfit change" events of about
        900 commands each, more than half of it; each walks a tree of
        conditions on an actor's equipment and always ends by setting
        the actor's picture through a script, every seventh step. In
        the first game these are slowed by name; the list is by title
        and does not reach the second. Then about twenty events that
        start with "is this actor in the party?", end at once when not,
        and start again on the next step.
    *   **Not done**: watching the party, equipment, states, skills,
        items and gold as well, and letting an event sleep after a run
        that only evaluated conditions, would cover the second family
        (an estimated 8 to 10% of the logic). The first has no clean
        automatic answer: its runs execute scripts.

*   **Achievements: the rules and the counting (2026-11-18)**: the player
    is to have achievements, shown in a profile outside the games. This
    is the part nobody sees yet: deciding them and counting what they
    are decided from.
    *   **Rule kept**: nothing is checked while a game runs. A run notes
        what was used of the player (a save written, a video played, the
        settings menu opened) as it happens, each a flag or a counter,
        and writes one line to `sessions.log` when it ends. Nothing is
        read from inside the game, so it holds for any game.
    *   **Change**: `platform/session` holds the notes of a run and makes
        its line; `--sessions <file>` names the log, and the three
        launchers pass it. Scripts note through `player.note`. The game
        list folds the lines it has not seen into the counts
        (`js/profile-model.js`), decides the achievements
        (`js/achievements-model.js`: 38 of them, each with a metal and a
        hero, and what some give the avatar) and keeps the result in
        `profile.json`, next to the list of games.
    *   **Checked**: tests for the rules, the folding and the line.
        Without a screen: an MZ and an MV game played with the log on
        left a line each; the list read them, earned four achievements
        and wrote the profile; opened again, it counted nothing twice.
        The three builds compile.
    *   **Not checked**: on the handheld or on a phone. Nothing shows
        the achievements yet: the profile screen is not built.

*   **The profile, and the achievements under it (2026-11-18)**: the
    achievements were being counted and nothing showed them.
    *   **Change**: the user's potato is at the top right of the game
        list; "up" from the first line, or a touch, goes to it and it
        opens the profile: the potato on the grass under a night sky,
        with the time played, the games and the saves. The achievements
        are not on its menu at first. Striking the ground five times in
        a row (a touch on it, or "down" on the menu's last line) digs
        down to them, and finding them is an achievement; once found
        they have a line of their own. They are a grid of pictures, each
        in a frame of bronze, silver or gold; the ones not earned are
        dim, and a secret one shows a question mark. The list says when
        achievements were earned since it was last opened.
        The sky has a secret of its own: knocked at ten times in a row
        (touched, or "up" on the menu's first line), a flying saucer
        crosses it for three seconds, which is one more achievement.
        `js/picker-profile.js` draws and takes the input;
        `js/profile-view-model.js` decides.
    *   **The avatar's pieces are decided, not drawn**: it has seven
        slots (character, clothes, head, face, weapon, accessory,
        companion), wears a burlap sack to begin with, and nineteen
        achievements give it pieces; the table is `PRIZES` in
        `js/achievements-model.js`. The achievement for trying both
        touch controls was dropped; there are 38.
    *   **Checked**: tests for the digging, the grid and the moving
        over it, and for the knocks and the saucer's way across.
        Without a screen, with real key presses, at 640x480 and at
        540x960: the list, the profile, the hole growing, the
        achievements, going back, and the saucer.
    *   **Not checked**: with a finger; on the handheld or a phone. The
        avatar is one fixed potato: its pieces, a name and the prizes of
        the achievements are not built.
*   **A rectangle filled after a path repainted the path (2026-11-18)**:
    found while drawing the achievements, where the outline of the
    chosen one never showed.
    *   **Cause**: in `bindings/canvas_binding.cpp`, `fill` keeps the
        path, as a browser does, and `fillRect`, `clearRect` and
        `drawImage` added their rectangle to that same path instead of
        drawing by themselves. A rectangle filled after a path filled
        the path again in the rectangle's paint; an image drawn then was
        clipped to both.
    *   **Change**: the three put the path aside while they draw and
        bring it back. This is the canvas every game draws on.
    *   **Checked**: four new checks in `tests/device/canvas_check.js`,
        which failed before and pass now; the MV and MZ save checks
        still pass.
    *   **Not checked**: a game where the fault showed, since none was
        known; on the handheld.

*   **The profile's menu: a name, the avatar's pieces, and telling the
    achievements (2026-11-18)**: the profile showed a fixed potato and
    an achievement earned was only a line of text by the list's corner.
    *   **Change**: the profile's menu has a line for the name and one
        for each of the avatar's seven slots. To the sides changes the
        piece of a slot, among the ones everybody starts with and the
        ones the achievements gave; a touch on the line goes to the
        next. The name is typed on a board of letters that works with
        the pad and with a finger. `js/avatar-model.js` holds every
        piece and decides which ones a user has. The seven characters
        have pictures (`js/avatar-<id>.png`): potato, wrinkled potato,
        French fry and potato chip to begin with; sweet potato, avocado
        and golden potato from achievements. An achievement earned is
        told by a banner that comes down from the top with its picture
        and its name, one after another, over the list or the profile
        and never over a game.
    *   **No hints**: the list of achievements says how one is earned
        only once it has been.
    *   **The sky** now takes twenty touches, or ten presses to the
        sides on a line with nothing to change.
    *   **Checked**: tests for the catalogue, the name and the banner's
        timing. Without a screen, with real key presses, at 640x480 and
        at 540x960: the banner, the character changing, the name typed,
        and the achievements for dressing and naming earned.
    *   **Not built**: the other pieces can be chosen and are saved,
        but only the character is drawn: clothes, hats, what is held,
        extras and companions have no pictures yet.
    *   **Not checked**: with a finger; on the handheld or a phone.

*   **A budget for the textures' memory (2026-11-19)**: a game stopped
    the whole handheld, not only itself: it answered a ping and nothing
    else, until it was switched off.
    *   **Cause**: a picture that has been drawn stays in the graphics
        memory as a texture, 2 MB for one the size of the screen. The
        renderer drops a texture only after about a minute undrawn,
        and this game reserves 541 pictures so the engine's image
        cache never lets go of them. A scene that shows a few hundred
        in less than that minute needs them all at once; on the
        handheld the graphics memory is the same 1 GB as everything
        else's, and it has no swap. Showing the reserved pictures one
        after another took the player from 247 MB to 646 MB at the
        two hundredth, still rising.
    *   **Change**: a patch for both engines, `textureBudget`
        (`patches/texture-budget.js`). When the textures take more
        than a share of the device's memory (a quarter, between 96
        and 512 MB; 243 MB on the handheld), the renderer's own
        collector is run with less patience, from thirty seconds
        undrawn down to half a second, until there is room. The
        renderer loads a dropped texture again when it is next drawn.
        What is on the screen is never dropped.
    *   **Checked**: tests with a collector that works as PIXI's does,
        failing first. On the handheld, the same 541 pictures one
        after another: the player stays at about 450 MB to the end.
        An MZ game there: the patch installs, a collection by hand
        frees textures and the game goes on drawing.
    *   **Not checked**: the scene of the game that stopped the
        handheld, played by hand; how long the pause is when a
        dropped picture is drawn again; a scene that needs more than
        the budget on the screen at one time, which still takes it.
    *   **Seen and left**: going from map to map leaves about ten
        more textures managed each time, slowly (118 MB after 22
        maps); the budget now bounds it.

## Critical User Journeys (CUJs)

### CUJ 1: First launch

*   **Given**: The console runs muOS. The player is installed. The owner has
    copied the game's `www` folder from their own copy to the SD card.
*   **When**: The owner selects the game in the muOS menu.
*   **Then**: The title screen appears within 10 seconds. Starting a new
    game reaches the character selection and then the first map, with
    picture, input and sound.

### CUJ 2: Walking a large map

*   **Given**: A game in progress on one of the largest maps, with several
    hundred events and the lighting active.
*   **When**: The owner walks around for several minutes.
*   **Then**: Game time keeps pace with real time. The picture is redrawn at
    least 30 times per second. Process memory stays under 450 MB.

### CUJ 3: Continuing a PC save on the console

*   **Given**: A save file made with the desktop player on a PC, copied into
    the game's `www/save` folder on the SD card.
*   **When**: The owner chooses Continue and loads that save, plays, saves
    again, and copies the file back to the PC.
*   **Then**: The save loads on the console in the state it was left, and
    the save written on the console loads in the desktop player.

### CUJ 4: Power loss while saving

*   **Given**: A game in progress with at least one existing save.
*   **When**: The console loses power at any moment during a save.
*   **Then**: After restarting, at least the previous save still loads.

### CUJ 5: A failure on the console

*   **Given**: The game calls a browser feature the player does not supply,
    or the game's own code throws an error.
*   **When**: The failure happens during play.
*   **Then**: The screen shows the error text, the script and line it came
    from, and the path of the log file. The owner can leave to the muOS menu
    with the console's buttons. The log on the SD card holds the same
    information.

### CUJ 6: Putting the console to sleep

*   **Given**: A game in progress.
*   **When**: The owner presses the power button to sleep, and later wakes
    the console.
*   **Then**: The game continues from where it was, with sound, and without
    a burst of fast-forwarded game time.

## Technical Plan (Architecture)

### Decisions this plan rests on

| Question | Decision | Decided by |
| --- | --- | --- |
| How the JavaScript engine is hosted | A program of our own that embeds V8 directly. Not Node, not JavaScriptCore | Owner |
| Language of the native code | C++ | Owner |
| WebGL for the game | Our own binding, each WebGL call wired straight to OpenGL ES 2. No ANGLE | Owner |
| Canvas 2D | Cairo for drawing, FreeType for text, using the copies installed on the console | Owner |
| Audio | SDL2_mixer first, behind an interface so another library can replace it | Owner |
| A browser feature the player lacks | Two modes: strict (stop and show it) for development, lenient (log and continue) for play | Owner |
| Where V8 comes from | Built from source for 64-bit ARM in a container, with the system's C++ standard library and pinned options | Owner |
| What the game believes it runs in | The desktop player, NW.js | Owner (brief) |
| Platform layer | SDL2 and OpenGL ES 2 from the console's own libraries | Brief |
| Adaptations to the game | In-memory patches, never edits to game files | Brief |

### Shape of the program

The player is one native executable plus a folder of JavaScript files that
ship with it. The split follows one rule: **native code only where a native
resource is owned or where work is done per pixel or per audio sample;
everything else is JavaScript.** The lab followed the same rule and its
JavaScript layer (about 700 lines in `docs/history/lab/minimal/run.js`) is the starting
point for the one described here.

```text
+--------------------------------------------------------------------+
|  Game folder (read-only to the player, except www/save)            |
|  www/index.html  www/js/*.js  www/js/plugins/*.js  www/data  img   |
+----------------------------------+---------------------------------+
                                   | scripts loaded as text, unchanged
+----------------------------------v---------------------------------+
|  V8                                                                |
|                                                                    |
|   game scripts: engine core, PIXI, plugins                         |
|   ---------------------------------------------------------------  |
|   patches (JavaScript, per game): event culling, GPU lights,       |
|                                   lighting rate, plugin stubs      |
|   ---------------------------------------------------------------  |
|   browser layer (JavaScript): window, document, elements, Image,   |
|       XMLHttpRequest, timers, events, navigator, localStorage      |
|   desktop layer (JavaScript): require('fs'), require('path'),      |
|       process, nw.gui stubs                                        |
+-----+---------+----------+----------+---------+----------+---------+
      | bindings (C++): thin, one file per service, no game knowledge
+-----v---+ +---v-----+ +--v------+ +-v-------+ +-v------+ +-v-------+
| WebGL   | | Canvas  | | Images  | | Audio   | | Files  | | Input   |
| -> GLES2| | Cairo + | | PNG     | | iface   | | sandbox| | SDL2    |
|         | | FreeType| | decode  | | -> SDL2 | | + safe | | pad ->  |
|         | |         | |         | |  _mixer | | saves  | | keys    |
+----+----+ +----+----+ +----+----+ +----+----+ +---+----+ +----+----+
     |           |           |           |          |           |
+----v-----------v-----------v-----------v----------v-----------v----+
|  Platform (C++): SDL2 window and GLES2 context, main loop, clock,  |
|  log file, error screen, crash handler, memory ledger              |
+--------------------------------------------------------------------+
```

Dependencies point downwards only. Native services do not include V8
headers, so each can be tested alone on a desktop machine. Bindings contain
no logic beyond converting arguments and managing object lifetimes.

### Components

**Platform.** Opens the SDL2 window and the OpenGL ES 2 context with the
same settings the console's own launch scripts use, and runs the main loop.
It owns the clock handed to JavaScript, the log file, the error screen, the
crash handler and the memory ledger. It is the only part that includes SDL2
headers.

**Engine host.** Creates one V8 isolate and context, loads scripts as
classic global scripts (the engine's save format depends on classes being
reachable from the global object), runs the microtask queue after every
callback, and reports uncaught errors with script name and line. V8's heap
limit is set so that running out of JavaScript memory becomes a catchable
error and not a kill by the system.

**WebGL binding.** Exposes to JavaScript the WebGL 1 functions the game
uses; the lab counted 35 after start-up plus those used while compiling
shaders. Each maps to its OpenGL ES 2 counterpart, with the differences
handled in one place:

*   Shader sources are rewritten to high precision before compiling,
    because the console's medium precision is 10 bits (brief, section 24).
*   An array uniform can be looked up by its bare name or with `[0]`
    (brief, section 19).
*   Image and canvas sources are converted to pixels before upload, with
    the flip and premultiply flags applied by the binding.
*   A shader that fails to compile yields a null shader and a logged
    message; linking a program with it fails cleanly.
*   The context reports the attributes PIXI checks at start-up, including
    an 8-bit stencil buffer.

Every WebGL call goes through one dispatch point, so that a build option
can log calls, check for driver errors after each one, and time them.

This decision replaces a preference stated in the brief. Section 19 of the
brief, written after five faults were met with an existing WebGL library,
said that reusing a tested implementation is preferable to writing one. The
owner chose a binding of our own afterwards, with those faults known. The
risk the brief described remains: each browser behaviour the game relies on
has to be found and reproduced by hand, and one of them, the shader tilemap
that draws nothing in the lab, is still unexplained.

**Canvas binding.** Implements the Canvas 2D context on Cairo image
surfaces, with FreeType supplying glyph outlines so that text can be both
filled and stroked, which the engine does for every string. On top of Cairo
it supplies what a browser adds: the state stack, composite modes, CSS
colour strings, the CSS font shorthand, and conversion of numeric arguments
the way a browser does (the lighting plugin passes non-numbers, brief
section 18). Each canvas tracks whether it has changed since its last
upload.

**Image service.** Decodes PNG files on worker threads and delivers the
result to JavaScript on the main thread, in request order. A decoded image
that has been uploaded to the GPU and is not read again by a canvas
releases its pixels.

**Audio service.** An interface with a small set of operations: play a
streamed track with a loop flag, play a short sound, set volume and pan,
stop, and report position. The first implementation calls SDL2_mixer. The
interface names nothing from SDL2_mixer, so a different implementation can
replace it without changes to the binding or the JavaScript layer. The
JavaScript layer presents the Web Audio objects the engine expects and
translates them to these operations; it reports Web Audio and OGG as
supported so the engine does not fall back to other paths. Operations the
first implementation cannot perform (pitch change, arbitrary loop points)
are accepted and logged once.

**File service.** Reads game files through a case-insensitive lookup built
at start-up, because games made on Windows refer to files with the wrong
letter case. Writes are allowed only under `www/save`. A save is written to
a temporary file, flushed, renamed over the target, and the previous
version is kept as a backup that is tried if the main file fails to load,
because the SD card's exFAT does not make renames crash-safe.

**Input service.** Reads the console's controls through SDL2 and presents
them to the game as keyboard events only, so the engine never sees the same
press twice. One button combination is reserved for the player's own menu
(quit, show log path) and is never passed to the game.

**Browser and desktop layers.** JavaScript that makes the game believe it
runs in the desktop player: the window and document objects, elements,
events, timers, `Image`, `XMLHttpRequest` over local files, and the Node
modules the game and its plugins ask for (`fs`, `path`, `process`, a stub
of `nw.gui`). Any other module request, such as the Steam library, returns
an object that accepts every call.

**Patches.** JavaScript files kept outside the game folder and selected by
the identity of the game (its title and core version). The first set is
the three measured in the brief: event culling, lights drawn through
WebGL, and a lower lighting update rate. Each patch states what it changes
and how to turn it off. The player's own code contains no game or plugin
names; those appear only in patch files.

### The frame

```text
each iteration of the main loop:
  1. read input, queue keyboard events
  2. run due timers and finished image/file loads (their callbacks)
  3. call the engine's frame callback, which runs:
       - one or more logic steps, to keep game time equal to real time
       - one draw: PIXI walks the scene and issues WebGL calls
  4. swap buffers
```

Measured on the console (brief sections 22 to 27, and a screen test from a
native module in `docs/history/lab/out/node-screen-test.txt`):

*   The buffer swap waits for the 60 Hz refresh when a frame is early. When
    a frame is late the swap returns at once, so a 22 ms frame costs
    23.5 ms, not 33.3 ms.
*   With the three patches, a logic step with real canvas work takes about
    4 ms on a small map and 10 to 14 ms on the largest, and preparing a
    draw takes about 3.5 ms.
*   The engine runs two logic steps in a frame when it falls behind. The
    player does not add its own frame skipping.

### Missing features: two modes

Every object the browser layer hands to the game is created through one
mechanism that notices access to a member it does not have.

*   **Strict mode** (development): using a missing function stops the game
    and shows the error screen with the member's name, the script and the
    line.
*   **Lenient mode** (play): the first use is written to the log with the
    script and line, a neutral value is returned, and the game continues.

In both modes a test for existence (`if (window.something)`) answers "no"
without counting as a failure. At exit, both modes write the list of
missing members that were touched. The mode is chosen in the player's
settings file; lenient is the default in the packaged player.

### Memory

One ledger counts the bytes held by decoded images, canvases, GPU textures
and audio. The JavaScript heap is capped separately through V8. The budget
is 450 MB in total. When the ledger passes a first threshold the player
asks the engine to drop its image cache and runs a collection; past a
second threshold it refuses new cache entries; if an allocation still
fails, it shows the error screen and exits without touching save files.
The log records the high-water mark of each category.

### Failures and diagnosis

*   The error screen is drawn by the platform layer, not by the game's own
    page elements, so it works when the game's scripts are broken.
*   The log is a size-capped file on the SD card, next to the game.
*   A handler for fatal signals writes a backtrace, the build identifier
    and the last log lines to a crash file.
*   A watchdog notices a main loop that has stopped for several seconds and
    writes the JavaScript stack to the log.
*   A build option records input and the clock, so a session can be
    replayed on a desktop machine.

### What is carried over from the lab, and what is new

| Piece | Status |
| --- | --- |
| Browser layer in JavaScript | Exists as lab code for the browser mode; the desktop-mode modules are new |
| Event culling, GPU lights, lighting rate patches | Exist as lab code; measured on the console; behaviour in play unchecked |
| Canvas on Cairo | Proven on the console through a Node package; the C++ binding is new |
| WebGL binding | New. The lab used a stand-in that draws nothing, and a software library on the desktop |
| V8 embedding, main loop, timers | New. The lab used Node for all of it |
| Audio, input, saves, error screen, crash handler | New |

## Alternatives Considered

The first group was rejected during the feasibility study and is taken from
the brief's "Alternatives Weighed". The second group was rejected while
drafting this design, when the owner chose among options for each part of
the architecture.

### Rejected during the feasibility study

#### Alternative A: JVM with Rhino or GraalJS (the original idea)

*   **Pros**: Java is the owner's strongest language. The JVM runs on the
    console's processor.
*   **Cons**: Rhino interprets JavaScript. GraalJS compiles it but needs a
    JVM heap of hundreds of MB.
*   **Reason for Rejection**: An interpreter is 3.5 to 4 times too slow on
    this console even when it is V8's (brief, section 22), and the console
    has about 800 MB available for everything. Neither was run directly;
    the rejection rests on the interpreter result and the memory budget.

#### Alternative B: An interpreter-only engine (QuickJS)

*   **Pros**: A few MB of code, easy to embed, no JIT memory.
*   **Cons**: No JIT.
*   **Reason for Rejection**: With the JIT off, a logic step on large maps
    takes 40 to 77 ms on the console against a budget of 16.7 ms (brief,
    section 22). QuickJS itself was not run.

#### Alternative C: An embedded web engine (WPE WebKit)

*   **Pros**: Full compatibility with the game and a JIT, with no browser
    features to write.
*   **Cons**: It needed 750 MB on a map and over 1 GB in a battle (brief,
    section 12). It displays through DRM/KMS, which the console does not
    have (brief, section 20). Its canvas would hit the lighting plugin's
    40 ms gradient unless it were GPU-backed.
*   **Reason for Rejection**: It does not fit in memory and cannot show a
    picture on this console without a new display backend.

#### Alternative D: The stock NW.js player with tuned flags, zram or swap

*   **Pros**: Nothing to build.
*   **Cons**: Same memory need as any browser engine; swap on an SD card is
    slow and wears the card.
*   **Reason for Rejection**: Set aside together with the web-engine route.
    It was not tried.

#### Alternative E: Replace PIXI and the engine's drawing code with a native renderer

*   **Pros**: Less JavaScript runs per frame. No WebGL layer to supply.
*   **Cons**: Every plugin that extends the engine's sprite and window
    classes depends on PIXI, whether or not it names it. The renderer would
    have to reproduce PIXI's behaviour for all of them.
*   **Reason for Rejection**: PIXI's own frame preparation costs about
    3.5 ms per frame on the console with event culling (brief, section 25),
    so there is little to gain for a large compatibility risk.

#### Alternative F: Draw on the processor instead of the GPU

*   **Pros**: No WebGL layer. It already draws correct frames in the lab
    (brief, section 18).
*   **Cons**: Estimated at 12 to 20 frames per second on the console, and
    the lighting plugin's gradient alone takes 40 ms per step.
*   **Reason for Rejection**: It cannot reach full game speed on this
    processor.

#### Alternative G: Load only a window of tiles around the player

*   **Pros**: Simple to describe; it was the owner's first idea for large
    maps.
*   **Cons**: The engine already draws only the tiles on screen, and the
    tile data of the largest map is under 1 MB (brief, section 13).
*   **Reason for Rejection**: It would save almost nothing. What grows with
    map size is events, so the idea became the event-culling patch.

#### Alternative H: Paint the lighting mask smaller, or stamp a cached light image

*   **Pros**: Stays inside Canvas 2D; no WebGL work in the patch.
*   **Cons**: A quarter-size mask still takes about 4 ms per repaint by a
    synthetic test (brief, section 26). Neither variant was built.
*   **Reason for Rejection**: Drawing the lights through WebGL removes the
    cost almost entirely and its picture matched the plugin's in the lab
    (brief, sections 27 and 28). These two remain fallbacks if that patch
    fails on the console's driver.

### Rejected while drafting this design

#### Alternative I: Node as the host

*   **Pros**: The least new code. Its V8 is the one measured on the
    console. It provides the file and path modules the desktop mode needs,
    timers and a module loader. The Canvas 2D package that worked on the
    console is a Node module. A scratch test showed a native module loaded
    by Node holding a steady 60 frames per second on the console's screen
    with up to 13 ms of JavaScript per frame.
*   **Cons**: A 117 MB executable. Node states a minimum kernel of 4.18 and
    the console runs 4.9; it works today without a guarantee for later
    versions. The frame loop has to share Node's event loop. Less control
    over the engine than embedding it.
*   **Reason for Rejection**: The owner chose a program of our own for
    control and independence from Node, accepting more work. Nothing
    measured ruled this option out.

#### Alternative J: A program of our own embedding JavaScriptCore

*   **Pros**: A small, stable C interface. Available prebuilt in Linux
    distributions for 64-bit ARM.
*   **Cons**: Never run on the console: neither that its JIT starts on the
    4.9 kernel nor its speed on the large maps, where there is no margin.
    Its diagnostic tools are less convenient when embedded. The distribution
    builds bring further libraries with them.
*   **Reason for Rejection**: The owner chose V8, the engine all console
    measurements were made with.

#### Alternative K: Rust for the native code

*   **Pros**: The compiler prevents most memory errors, which are the
    costliest kind on a console without a debugger. A Rust library for V8
    is believed to ship V8 prebuilt for 64-bit ARM Linux, which would remove
    the V8 build; this was not confirmed.
*   **Cons**: A steeper learning curve from Java. Sharing state between the
    engine and native code is awkward. The C libraries are reached through
    extra layers.
*   **Reason for Rejection**: The owner chose C++, V8's own language.

#### Alternative L: ANGLE for WebGL, in full or only its shader translator

*   **Pros**: ANGLE is what a browser uses, so it reproduces browser WebGL
    behaviour, including shader validation and translation. Using only the
    translator would cover the part where the lab met the most faults.
*   **Cons**: A large build of the same kind as V8's. Processor time added
    to every call, with 200 to 800 calls per frame and little margin. Not
    known to work on the console's Mali driver. The binding to V8 has to be
    written either way.
*   **Reason for Rejection**: The owner chose a direct binding of our own
    and confirmed that choice when it was set against the brief. The
    advantages listed for it were its small size, no cost per call, and
    being limited to the 35 functions the game uses; the owner did not
    state which of these decided it.

#### Alternative M: Skia, or a drawing library of our own, for Canvas 2D

*   **Pros**: Skia is what a browser's canvas uses and is faster than
    Cairo; it can draw on the GPU. A library of our own would be the
    smallest.
*   **Cons**: Skia is a large build with an interface that changes between
    versions, and adds the most memory of the three. A library of our own
    must get text outlines, edge smoothing, scaling and blend modes right by
    hand.
*   **Reason for Rejection**: The owner chose Cairo with FreeType. It is
    the combination measured on the console, the console already has both
    installed, and canvas work costs under 1 ms per step once the lighting
    is off the canvas. Memory does not separate the options: the pixels of
    the canvases dominate and are the same for all three.

#### Alternative N: An audio mixer of our own, or the miniaudio library

*   **Pros**: Both can change pitch and loop at exact points, which
    SDL2_mixer cannot. A mixer of our own keeps memory bounded by design;
    miniaudio brings mixing, resampling and streaming ready-made.
*   **Cons**: A mixer of our own has to be written and tuned. miniaudio has
    not been tried with the console's audio system.
*   **Reason for Rejection**: The owner chose SDL2_mixer first because the
    console already has it, with the audio service behind an interface so
    that either of these can replace it if the game needs what it lacks.

#### Alternative O: One behaviour for missing browser features

*   **Pros**: Always stopping hides nothing. Always continuing never
    interrupts play. Either is simpler than keeping two modes.
*   **Cons**: Always stopping ends a session over a harmless gap, in a game
    that restricts saving. Always continuing lets an important gap surface
    later, somewhere else, with a misleading symptom.
*   **Reason for Rejection**: The owner chose two modes: strict while
    developing and lenient while playing.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Performance.** The frame-rate and memory targets are stated under
    Goals and checked by `player/tests/device/measure.sh`. They are the
    main risk of this design: on one of the two large test maps the
    measured margin is about 1 ms out of 33, before the GPU driver's own
    time and audio.
*   **Safety of the owner's files.** The player reads only inside the game
    folder and writes only under `www/save`. A script in the game cannot
    reach other files through the `fs` module the player supplies.
*   **Rollback.** The player changes nothing in the game folder except save
    files, so removing the player leaves the game as it was. Each patch has
    a switch in its manifest.

### Additional Resources

*   `docs/history/feasibility-study.md`: the feasibility study. Sections 10 to 28 hold
    every measurement this design relies on, with its limits.
*   `docs/history/lab/`: the experiments. `docs/history/lab/minimal/run.js` is the JavaScript layer
    the player's browser layer starts from; `docs/history/lab/overlays/` holds the three
    patches; `docs/history/lab/device-*.sh` are the measurement runs on the console.
*   `docs/history/lab/out/` (not in git): raw output of the measurements, including
    `node-screen-test.txt` for the frame-pacing test and `gl-*.out` for the
    list of WebGL functions the game uses.

### Future Improvements

*   **Play the intro video** instead of skipping it.
*   **An audio implementation with pitch and exact loop points**, if the
    game turns out to need them.
*   **Release image pixels more aggressively** once they are on the GPU, to
    lower memory further.
*   **Other MV games**, each with its own patch folder and its own list of
    browser features.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

All new code lives under `player/`. The feasibility experiments stay in
`docs/history/lab/` and are not modified, except where a file is copied from them as a
starting point. Paths are relative to the repository root.

Choices made here because they have one practical answer: CMake as the
build system, C++17, one vendored single-header test library for native
tests, Node's built-in test runner for the JavaScript layers on the
development machine, and libpng for PNG decoding because Cairo already
depends on it and the console has it.

The work is ordered in five stages. Each stage ends with something that
runs on the console.

| Stage | Result on the console |
| --- | --- |
| 1 | The player starts, runs a script in V8, clears the screen and writes a log |
| 2 | The game's title screen is drawn through the WebGL and canvas bindings |
| 3 | A map is drawn and walked, with the patches, at the measured speeds |
| 4 | Input from the console's controls, save and load, sound |
| 5 | Error screen, crash file, two modes for missing features, packaging for muOS |

### Target Files to Create/Modify

#### Build and tooling (stage 1)

##### 1. `player/CMakeLists.txt` (Create)

*   **Type / Scope**: Build configuration.
*   **Proposed Changes**: Defines one static library per native service,
    one for the bindings, the `mvplayer` executable and the native tests.
    Options: `MVP_GL_CHECKS` (check for a driver error after every WebGL
    call), `MVP_SANITIZERS` (address and undefined-behaviour checks on the
    desktop build), `MVP_REPLAY` (record and replay input and clock).
    Needed so the same sources build for the desktop and for the console.

##### 2. `player/cmake/toolchain-device.cmake` (Create)

*   **Type / Scope**: Build configuration.
*   **Proposed Changes**: Target settings for the console: 64-bit ARM,
    glibc 2.38, libraries taken from `player/sysroot/`. Needed because the
    console has the libraries but not their headers.

##### 3. `player/tools/v8/Dockerfile` (Create)

*   **Type / Scope**: Container recipe.
*   **Proposed Changes**: A Linux ARM image with the compiler and tools
    needed to build V8. Needed so the V8 build can be repeated identically.

##### 4. `player/tools/v8/args.gn` (Create)

*   **Type / Scope**: V8 build options.
*   **Proposed Changes**: The single list of V8 options: monolithic static
    library, the system's C++ standard library instead of V8's own,
    internationalisation off, and the pointer-compression and sandbox
    settings stated explicitly. The same values are passed to the player's
    build as definitions, because V8 and the code that includes its headers
    must agree on them.

##### 5. `player/tools/v8/build.sh` (Create)

*   **Type / Scope**: Shell script.
*   **Proposed Changes**: Fetches the pinned V8 version, builds it in the
    container and places headers and library under
    `player/third_party/v8/`. Records the V8 version and option list in a
    text file next to the library.

##### 6. `player/tools/sysroot/fetch-sysroot.sh` (Create)

*   **Type / Scope**: Shell script.
*   **Proposed Changes**: Copies from the console, over adb, the shared
    libraries the player links against (SDL2, SDL2_mixer, the Mali GLES and
    EGL library, Cairo, Pixman, FreeType, Fontconfig, libpng, zlib) into
    `player/sysroot/`. Needed so the player links against exactly what the
    console runs.

##### 7. `player/third_party/headers/MANIFEST.md` (Create)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: Lists, for each library above, the version found
    on the console and the upstream release its headers are taken from
    (SDL2 2.28.5, SDL2_mixer 2.6.3, Khronos OpenGL ES 2 and EGL headers,
    Cairo, FreeType 2 as installed, libpng 1.6.43). The headers themselves
    are downloaded by the script below, not committed.

##### 8. `player/tools/sysroot/fetch-headers.sh` (Create)

*   **Type / Scope**: Shell script.
*   **Proposed Changes**: Downloads the header sets named in the manifest
    into `player/third_party/headers/`.

##### 9. `player/tools/deploy.sh` (Create)

*   **Type / Scope**: Shell script.
*   **Proposed Changes**: Copies the built player and its JavaScript folder
    to the console over adb, pauses the muOS menu, runs the player on a
    given game folder, resumes the menu and pulls the log and any crash
    file back. Based on `docs/history/lab/device-gles-run.sh`.

##### 10. `player/third_party/doctest/doctest.h` (Create)

*   **Type / Scope**: Vendored test library, single header.
*   **Proposed Changes**: Added unmodified, with its licence text.

##### 11. `.gitignore` (Modify)

*   **Type / Scope**: Repository configuration.
*   **Proposed Changes**: Ignore `player/build*/`, `player/sysroot/`,
    `player/third_party/v8/` and `player/third_party/headers/*/`. These are
    large, derived, or copied from the console.

##### 12. `README.md` (Modify)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: Add `player/` to the contents list, in both the
    English and the Spanish half.

##### 13. `player/README.md` (Create)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: How to build V8, fetch the sysroot, build for the
    desktop and for the console, deploy, and run the tests.

#### Platform (stage 1; error screen and crash handling in stage 5)

##### 14. `player/src/platform/main.cpp` (Create)

*   **Type / Scope**: C++ program entry.
*   **Proposed Changes**: Reads the game folder and settings path from the
    command line, starts the platform, the engine host and the bindings,
    loads `player/js/boot.js`, runs the main loop, and returns a distinct
    exit code for clean exit, script error, missing feature in strict mode
    and out of memory.

##### 15. `player/src/platform/window.h`, `window.cpp` (Create)

*   **Type / Scope**: C++ module; the only one that includes SDL2 video.
*   **Proposed Changes**: Opens a full-screen SDL2 window with an OpenGL ES
    2 context that has an 8-bit stencil buffer, using the environment
    settings the console's own launch scripts use. Offers `swap()`, the
    drawable size, and a final pass that scales the game's 816x624 frame to
    the 640x480 screen keeping its proportions.

##### 16. `player/src/platform/main_loop.h`, `main_loop.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Runs the fixed order: input, due timers, finished
    loads, the engine's frame callback, swap. Pauses on sleep and on loss
    of focus, and exits within a bounded time on a termination signal.

##### 17. `player/src/platform/clock.h`, `clock.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: The monotonic clock behind `Date.now`,
    `performance.now` and the frame callback's timestamp. Clamps the jump
    after a resume so the game does not fast-forward. In replay builds it
    returns recorded values.

##### 18. `player/src/platform/log.h`, `log.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: A size-capped log file next to the game, with
    rotation, and an in-memory ring of the last lines for the crash file.
    Receives the game's `console` output, uncaught errors and the player's
    own messages.

##### 19. `player/src/platform/settings.h`, `settings.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Reads a small key-value settings file: strict or
    lenient mode, memory budget, log size, key mapping file, patch switches.

##### 20. `player/src/platform/memory_ledger.h`, `memory_ledger.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Counts bytes by category (images, canvases,
    textures, audio), keeps a high-water mark, and calls registered
    handlers when the two thresholds are crossed.

##### 21. `player/src/platform/error_screen.h`, `error_screen.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Draws an error message with OpenGL ES and
    FreeType directly, without V8 or the game's scripts: error text, script
    and line, log path, and how to leave. Needed because the game's own
    error display depends on page elements the player does not draw.

##### 22. `player/src/platform/crash_handler.h`, `crash_handler.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: A handler for fatal signals that writes a
    backtrace, the build identifier and the log ring to a crash file using
    only calls that are safe inside a signal handler.

##### 23. `player/src/platform/watchdog.h`, `watchdog.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: A thread that notices a main loop stalled for
    several seconds and asks V8 to interrupt and report the JavaScript
    stack to the log.

#### Engine host (stage 1)

##### 24. `player/src/engine/host.h`, `host.cpp` (Create)

*   **Type / Scope**: C++ module; owns V8.
*   **Proposed Changes**: Creates the V8 platform, one isolate and one
    context with a heap limit. Loads script files as classic global scripts
    with their real file names. Runs the microtask queue after every
    callback. Turns an uncaught error or rejected promise into a log entry
    with script, line and stack, and into the error screen.

##### 25. `player/src/engine/binding_util.h`, `binding_util.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Shared helpers for bindings: wrapping a native
    object in a JavaScript object, releasing it when collected, reporting
    its size to V8, and converting arguments the way a browser does
    (numbers from strings and booleans, defaults for missing arguments).

##### 26. `player/src/engine/timers.h`, `timers.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Queues behind `setTimeout`, `setInterval` and
    `requestAnimationFrame`, drained by the main loop in order of due time.

##### 27. `player/src/engine/async_queue.h`, `async_queue.cpp` (Create)

*   **Type / Scope**: C++ module.
*   **Proposed Changes**: Hands work to worker threads and delivers results
    to the main thread in the order the work was requested, never from
    inside the call that started it.

#### Native services (no V8 headers; stages 2 to 4)

##### 28. `player/src/services/gl/shader_rewrite.h`, `shader_rewrite.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Rewrites a shader's precision declarations to
    high precision and returns the new source. Text in, text out.

##### 29. `player/src/services/gl/webgl_semantics.h`, `webgl_semantics.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: The behaviour WebGL has and OpenGL ES 2 lacks:
    the flip and premultiply flags applied to pixels before upload; lookup
    of an array uniform by bare name; the context attributes reported to
    the game; a failed shader compile reported without touching the driver
    again; the limits reported for `getParameter`.

##### 30. `player/src/services/canvas/canvas2d.h`, `canvas2d.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: A Canvas 2D context on a Cairo image surface:
    state stack, fill and stroke styles, rectangles, paths, gradients,
    image drawing with source rectangles and scaling, composite modes,
    global alpha, clipping, transforms, pixel read and write. Marks the
    surface changed on every drawing call.

##### 31. `player/src/services/canvas/text.h`, `text.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Text through FreeType: measuring, filling and
    stroking glyph outlines with round joins, and a glyph cache.

##### 32. `player/src/services/canvas/font_registry.h`, `font_registry.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Reads the game's `fonts/gamefont.css` for family
    name and file pairs, loads those font files, and answers the engine's
    "is this font loaded" check.

##### 33. `player/src/services/canvas/css_color.h`, `css_color.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Parses the CSS colour forms the game uses: hex,
    `rgb()`, `rgba()` and named colours.

##### 34. `player/src/services/canvas/css_font.h`, `css_font.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Parses the CSS font shorthand into style, size
    and family.

##### 35. `player/src/services/image/png_decoder.h`, `png_decoder.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Decodes a PNG file to premultiplied RGBA pixels
    with libpng. Called on worker threads.

##### 36. `player/src/services/image/image_store.h`, `image_store.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Owns decoded pixels, reports them to the memory
    ledger, and releases them once uploaded to the GPU unless a canvas has
    read them; re-decodes from disk if they are asked for again.

##### 37. `player/src/services/files/game_files.h`, `game_files.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Builds an index of the game folder at start-up
    and resolves requested paths with percent-decoding and without regard
    to letter case. Refuses any path outside the game folder. Logs each
    corrected name and each miss.

##### 38. `player/src/services/files/save_store.h`, `save_store.cpp` (Create)

*   **Type / Scope**: C++ module, stage 4.
*   **Proposed Changes**: Writes under `www/save` only: temporary file,
    flush, rename, flush of the folder, and a kept backup of the previous
    version. On read, falls back to the backup when the main file is
    missing or truncated.

##### 39. `player/src/services/input/input_service.h`, `input_service.cpp` (Create)

*   **Type / Scope**: C++ module, stage 4.
*   **Proposed Changes**: Reads the console's controls through SDL2 and
    produces key-down and key-up events with the key codes the engine
    expects. Detects the reserved button combination for the player's own
    menu.

##### 40. `player/src/services/input/key_map.h`, `key_map.cpp` (Create)

*   **Type / Scope**: C++ module, stage 4.
*   **Proposed Changes**: Loads the button-to-key mapping from a file, with
    a built-in default for the reference console.

##### 41. `player/src/services/audio/audio_service.h` (Create)

*   **Type / Scope**: C++ interface, stage 4.
*   **Proposed Changes**: The operations the rest of the player may call:
    open, play a streamed track (file, loop flag, volume, pan), play a
    short sound, set volume and pan on a playing voice, stop, query
    position, close. Names nothing from any audio library.

##### 42. `player/src/services/audio/sdl_mixer_audio.h`, `sdl_mixer_audio.cpp` (Create)

*   **Type / Scope**: C++ module, stage 4.
*   **Proposed Changes**: The first implementation of the interface, on
    SDL2_mixer. Music and ambience are streamed from the file; short sounds
    are decoded once and kept within a byte limit. Pitch changes and loop
    points it cannot honour are logged once each.

##### 43. `player/src/services/audio/null_audio.h`, `null_audio.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: A silent implementation of the interface, used
    until stage 4 and in tests.

#### Bindings (V8 to services; stages 2 to 4)

##### 44. `player/src/bindings/dispatch.h` (Create)

*   **Type / Scope**: C++ header, stage 2.
*   **Proposed Changes**: The single point every WebGL call passes through,
    so that build options can log, error-check and time calls.

##### 45. `player/src/bindings/webgl_binding.h`, `webgl_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Exposes the WebGL context object and its
    constants to JavaScript. Covers the functions recorded in the lab
    (`docs/history/lab/out/gl-*.out`): buffers, textures, framebuffers, shaders and
    programs, uniforms, vertex attributes, state, clears, draws, and pixel
    read-back. Accepts images and canvases as texture sources.

##### 46. `player/src/bindings/canvas_binding.h`, `canvas_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Exposes canvas elements and their 2D context to
    JavaScript, and hands a canvas's pixels to the WebGL binding when it is
    used as a texture source.

##### 47. `player/src/bindings/image_binding.h`, `image_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2.
*   **Proposed Changes**: Starts a PNG decode for an image whose source is
    set and delivers the load or error event through the async queue.

##### 48. `player/src/bindings/files_binding.h`, `files_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 2 for reads, stage 4 for saves.
*   **Proposed Changes**: Read text, read bytes, test existence and list a
    folder inside the game folder; write, rename and delete under
    `www/save`. The JavaScript `fs` and `XMLHttpRequest` layers call these.

##### 49. `player/src/bindings/input_binding.h`, `input_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 4.
*   **Proposed Changes**: Delivers key events from the input service to the
    JavaScript event layer.

##### 50. `player/src/bindings/audio_binding.h`, `audio_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 4.
*   **Proposed Changes**: Exposes the audio interface's operations to
    JavaScript.

##### 51. `player/src/bindings/system_binding.h`, `system_binding.cpp` (Create)

*   **Type / Scope**: C++ module, stage 1.
*   **Proposed Changes**: Log, clock, timers, settings, memory figures,
    script loading by path, and exit.

#### JavaScript shipped with the player (stages 2 to 5)

##### 52. `player/js/boot.js` (Create)

*   **Type / Scope**: JavaScript, stage 2.
*   **Proposed Changes**: Installs the browser and desktop layers, reads
    the game's `index.html` for its script list, replaces the two bundled
    helper libraries that are not needed (the frame-rate meter and the
    inline-video helper) with empty stand-ins, loads patches, loads the
    game's scripts in order and fires the page's load event. Based on
    `docs/history/lab/minimal/run.js`.

##### 53. `player/js/browser/window.js`, `document.js`, `elements.js`, `events.js` (Create)

*   **Type / Scope**: JavaScript, stage 2.
*   **Proposed Changes**: The window and document objects, element
    creation, the element tree with only what the engine reads, and event
    listeners and dispatch.

##### 54. `player/js/browser/image.js`, `xhr.js`, `storage.js`, `navigator.js` (Create)

*   **Type / Scope**: JavaScript, stage 2.
*   **Proposed Changes**: `Image` with asynchronous load and error events;
    `XMLHttpRequest` over local files for text and bytes; `localStorage`
    kept in a file; the `navigator` object.

##### 55. `player/js/browser/video.js` (Create)

*   **Type / Scope**: JavaScript, stage 2.
*   **Proposed Changes**: A video element that reports its end at once, so
    the engine's "play movie" does not wait forever. The intro video is
    skipped.

##### 56. `player/js/browser/webaudio.js` (Create)

*   **Type / Scope**: JavaScript, stage 4.
*   **Proposed Changes**: The Web Audio objects the engine creates (context,
    buffer source, gain, panner) translated to the audio interface's
    operations. Reports Web Audio and OGG as supported.

##### 57. `player/js/browser/missing.js` (Create)

*   **Type / Scope**: JavaScript, stage 5.
*   **Proposed Changes**: The one mechanism through which every browser and
    desktop object is created. Notices use of a member that is not
    supplied, lets existence tests answer "no", and applies the strict or
    lenient behaviour. Writes the list of touched missing members at exit.

##### 58. `player/js/desktop/require.js`, `fs.js`, `path.js`, `process.js`, `nw_gui.js`, `stub_module.js` (Create)

*   **Type / Scope**: JavaScript, stage 2; `fs` writes in stage 4.
*   **Proposed Changes**: What makes the game take its desktop-player path:
    a `require` that returns these modules, an `fs` with the synchronous
    read, write, exists, make-folder, rename, delete and list calls routed
    to the file binding, `path`, a `process` object, a stand-in for the
    window module, and an object that accepts every call for any other
    module, such as the Steam library.

##### 59. `player/js/patches/loader.js` (Create)

*   **Type / Scope**: JavaScript, stage 3.
*   **Proposed Changes**: Identifies the game from its title and core
    version, finds its patch folder, and loads each patch at the point its
    manifest names (before the game's scripts, after its plugins, or before
    the first map).

##### 60. `player/js/patches/fear-and-hunger-1.4.1/manifest.json` (Create)

*   **Type / Scope**: Data, stage 3.
*   **Proposed Changes**: The game's identity, the list of patches with
    their load point and settings (culling margin, lighting update rate),
    and a switch to disable each.

##### 61. `player/js/patches/fear-and-hunger-1.4.1/event-culling.js` (Create)

*   **Type / Scope**: JavaScript, stage 3.
*   **Proposed Changes**: Copied from `docs/history/lab/overlays/event-culling-v3.js`:
    lists of nearby events, far sprites detached, deferred page refresh.

##### 62. `player/js/patches/fear-and-hunger-1.4.1/gpu-lights.js` (Create)

*   **Type / Scope**: JavaScript, stage 3.
*   **Proposed Changes**: Copied from `docs/history/lab/overlays/gpu-lights.js`: the
    lighting plugin's painting replaced by sprites drawn through WebGL.

##### 63. `player/js/patches/fear-and-hunger-1.4.1/lighting-rate.js` (Create)

*   **Type / Scope**: JavaScript, stage 3.
*   **Proposed Changes**: Updates the lighting every third logic step.
    Split out of the lab's culling overlay so it can be switched off alone.

#### Packaging (stage 5)

##### 64. `player/packaging/muos/launch.sh` (Create)

*   **Type / Scope**: Shell script.
*   **Proposed Changes**: The script muOS runs to start a game with the
    player: sets the same SDL settings as the system's launch scripts,
    points the player at the game folder, and returns to the menu on exit.

##### 65. `player/packaging/muos/README.md` (Create)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: Where to copy the player and a game's `www`
    folder on the SD card, and how the game appears in the menu.

#### Tests

##### 66. `player/tests/native/test_css_color.cpp`, `test_css_font.cpp` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Each colour and font form the game uses, plus
    malformed input.

##### 67. `player/tests/native/test_canvas2d.cpp` (Create)

*   **Type / Scope**: Unit tests with reference images.
*   **Proposed Changes**: Fills, gradients, image drawing with scaling,
    each composite mode, clipping, and outlined text, compared with
    reference images within a tolerance; text widths compared numerically.

##### 68. `player/tests/native/golden/` (Create)

*   **Type / Scope**: Test data.
*   **Proposed Changes**: Reference images for the canvas tests, produced
    from synthetic drawings in a desktop browser. No game content.

##### 69. `player/tests/native/test_shader_rewrite.cpp`, `test_webgl_semantics.cpp` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Precision rewriting on shaders of the shapes PIXI
    produces; flip and premultiply on sample pixels; array uniform lookup
    by both names; a failed compile followed by a link.

##### 70. `player/tests/native/test_game_files.cpp`, `test_save_store.cpp` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Wrong-case and percent-encoded names, paths that
    try to leave the game folder; a save interrupted at each step of the
    write still leaves a loadable file.

##### 71. `player/tests/native/test_memory_ledger.cpp`, `test_timers.cpp`, `test_host.cpp` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Threshold handlers fire once and in order; timers
    fire in due order; a script error is reported with file and line and
    the microtask queue runs after each callback.

##### 72. `player/tests/js/browser_layer.test.js`, `desktop_fs.test.js`, `missing.test.js`, `patches.test.js` (Create)

*   **Type / Scope**: JavaScript unit tests, run with Node on the
    development machine.
*   **Proposed Changes**: Event dispatch and element behaviour the engine
    relies on; the `fs` calls against a temporary folder; strict and
    lenient behaviour and the existence-test exception; patch selection by
    game identity and each switch.

##### 73. `player/tests/integration/run_route.sh` (Create)

*   **Type / Scope**: Integration test, desktop.
*   **Proposed Changes**: Runs the player on a game folder in strict mode
    with silent audio and a recorded input file through a fixed route
    (title, new game, first map, a large map, menu, save, load), and fails
    on any missing member, script error or crash.

##### 74. `player/tests/device/measure.sh` (Create)

*   **Type / Scope**: Measurement script, console.
*   **Proposed Changes**: Runs the player on the console over adb on the
    two large test maps and reports logic step, frame time and peak memory
    against the goals. Based on `docs/history/lab/device-gpu-lights.sh`.

### Verification Plan

*   **Compilation/Build**: `cmake -S player -B player/build-desktop` and
    `cmake --build player/build-desktop` on a desktop Linux machine;
    the same with `-DCMAKE_TOOLCHAIN_FILE=player/cmake/toolchain-device.cmake`
    into `player/build-device` for the console. The V8 library is built
    once with `player/tools/v8/build.sh`.
*   **Unit Tests**: `ctest --test-dir player/build-desktop` for the native
    tests; `node --test player/tests/js` for the JavaScript layers.
*   **Static Analysis & Linting**: the desktop build with
    `-DMVP_SANITIZERS=ON` must pass all tests with no report; compiler
    warnings are errors in the player's own sources.
*   **Test Coverage Requirement**: every public function of the native
    services has at least one test. No percentage is set: the bindings and
    the platform layer are only exercised by the integration route.
*   **E2E/Integration**: `player/tests/integration/run_route.sh` on the
    desktop with the reference game: zero missing members in strict mode,
    zero script errors, and the saved file loads in the desktop player.
*   **On the console**: `player/tests/device/measure.sh`: on the two large
    test maps, two logic steps and one draw within 33.3 ms at the median,
    and peak process memory under 450 MB. Then the six user journeys by
    hand, and a session of at least two hours in lenient mode with no
    crash, no kill by the system and no growth of memory across map
    changes.

--------------------------------------------------------------------------------

*Drafted with EGM*
