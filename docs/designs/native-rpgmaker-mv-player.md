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
measurements behind this design are recorded in `concepts_brief.md`,
sections 10 to 28, and the experiments that produced them are in `lab/`.

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
    (`player/tests/device/stage1.js`) presented 230 frames at a median of
    16.67 ms with none over 20 ms; the window is up 15 ms after start and V8
    26 ms after start. A script that throws
    (`player/tests/device/stage1_error.js`) is reported in the log with its
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
    (`player/tests/device/stage2_webgl.js`) uses it the way PIXI does:
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
    (`player/tests/device/stage2_canvas.js`) draws a gradient, additive
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
    `player/tests/device/stage2_title_watch.js` checks the result.
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
        (`player/tests/device/stage3_input_watch.js`) that feeds key codes
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
JavaScript layer (about 700 lines in `lab/minimal/run.js`) is the starting
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
native module in `lab/out/node-screen-test.txt`):

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

*   `concepts_brief.md`: the feasibility study. Sections 10 to 28 hold
    every measurement this design relies on, with its limits.
*   `lab/`: the experiments. `lab/minimal/run.js` is the JavaScript layer
    the player's browser layer starts from; `lab/overlays/` holds the three
    patches; `lab/device-*.sh` are the measurement runs on the console.
*   `lab/out/` (not in git): raw output of the measurements, including
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
`lab/` and are not modified, except where a file is copied from them as a
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
    file back. Based on `lab/device-gles-run.sh`.

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
    (`lab/out/gl-*.out`): buffers, textures, framebuffers, shaders and
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
    `lab/minimal/run.js`.

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
*   **Proposed Changes**: Copied from `lab/overlays/event-culling-v3.js`:
    lists of nearby events, far sprites detached, deferred page refresh.

##### 62. `player/js/patches/fear-and-hunger-1.4.1/gpu-lights.js` (Create)

*   **Type / Scope**: JavaScript, stage 3.
*   **Proposed Changes**: Copied from `lab/overlays/gpu-lights.js`: the
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
    against the goals. Based on `lab/device-gpu-lights.sh`.

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
