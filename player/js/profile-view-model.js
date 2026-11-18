// What the profile screen decides without drawing anything: how digging at
// the ground opens the achievements, how the achievements are laid out in a
// grid and how the choice moves over it. Loaded by the game list; tested on
// its own (tests/js/profile_view_model.test.js).
(function () {
  'use strict';

  // --- Digging ---------------------------------------------------------------
  // The achievements are under the profile's ground. Striking the ground
  // (a touch on it, or "down" at the last line of the menu) digs; five
  // strikes one after another open them. Left alone for three seconds, the
  // earth settles and the digging starts again.
  var STRIKES = 5, SETTLES_MS = 3000;
  function undug() { return { depth: 0, last: 0, open: false }; }
  function depthAt(state, now) { return state.depth && now - state.last < SETTLES_MS ? state.depth : 0; }
  // The state after one more at `now` (milliseconds), of the `needed`.
  function oneMore(state, now, needed) {
    var depth = depthAt(state, now) + 1;
    return depth >= needed ? { depth: 0, last: now, open: true } : { depth: depth, last: now, open: false };
  }
  function dig(state, now) { return oneMore(state, now, STRIKES); }
  // The ground gives way in one place only: a strip at the right edge of
  // the window, clear of the menu and of the avatar. `from` is where the
  // strip begins and `x` the middle of the hole.
  var DIG_WIDE = 110;
  function digSpot(width) { return { from: width - DIG_WIDE, x: width - DIG_WIDE / 2 }; }
  function inDigSpot(x, width) { return x >= digSpot(width).from && x < width; }

  // --- The sky ----------------------------------------------------------------
  // The other way round: knocks at the sky in a row call a flying saucer,
  // which crosses the window in three seconds and is gone. A knock is a
  // touch on the sky, twenty of them, or a press to either side where
  // there is nothing to change, ten of them.
  var KNOCKS = { touch: 20, keys: 10 }, CROSSING_MS = 3000;
  function unknocked() { return undug(); }
  function knock(state, now, how) { return oneMore(state, now, KNOCKS[how]); }

  // --- Telling the achievements -------------------------------------------------
  // Each achievement earned is told by a banner that comes down from the
  // top, stays and goes back up, one after another. `since` is when the
  // first began and `count` how many there are; the answer is which one is
  // showing and how far down it is (0 to 1), or null when there is none.
  var TOAST = { slide: 300, stay: 2600 };
  TOAST.whole = 2 * TOAST.slide + TOAST.stay;
  function toast(now, since, count) {
    if (!since || now < since) return null;
    var index = Math.floor((now - since) / TOAST.whole), at = (now - since) % TOAST.whole;
    if (index >= count) return null;
    var shown = at < TOAST.slide ? at / TOAST.slide : at < TOAST.slide + TOAST.stay ? 1 : (TOAST.whole - at) / TOAST.slide;
    return { index: index, shown: shown };
  }
  // Where the saucer is at `now` in a window `width` wide, having been
  // called at `since`: its x, and how far along it is (0 to 1); null when
  // there is none.
  function saucerAt(now, width, since) {
    if (!since || now < since || now >= since + CROSSING_MS) return null;
    var along = (now - since) / CROSSING_MS;
    return { x: -90 + along * (width + 180), along: along };
  }

  // --- The menu's lines ---------------------------------------------------------
  // The lines share the room between `top` and `bottom`: as tall as it
  // allows, so that a finger hits them, up to a limit, and never so small
  // that they cannot be read. `pitch` is from one line to the next and
  // `line` how tall each is drawn.
  var TALLEST = 60, SMALLEST = 30, BETWEEN = 4;
  function menuLines(top, bottom, count) {
    var pitch = Math.max(SMALLEST, Math.min(TALLEST, Math.floor((bottom - top) / count)));
    return { pitch: pitch, line: pitch - (pitch >= 50 ? BETWEEN + 2 : BETWEEN) };
  }

  // --- The grid of achievements -----------------------------------------------
  // The pictures are 96 across and are shown at that size. The grid is
  // centred, with the title above it and the chosen one's words under it.
  var CELL = 96, GAP = 8, MARGIN = 28, TOP = 96, UNDER = 70;
  function grid(width, height, count) {
    var columns = Math.max(2, Math.floor((width - 2 * MARGIN + GAP) / (CELL + GAP)));
    return {
      columns: columns,
      rows: Math.ceil(count / columns),
      shown: Math.max(1, Math.floor((height - TOP - UNDER + GAP) / (CELL + GAP))),
      cell: CELL,
      gap: GAP,
      left: Math.round((width - (columns * CELL + (columns - 1) * GAP)) / 2),
      top: TOP,
    };
  }
  // The index chosen after moving 'left', 'right', 'up' or 'down' from
  // `index` in a grid of `columns` with `count` cells. Moving down onto a
  // last row that is shorter goes to its last cell.
  function step(index, direction, columns, count) {
    if (direction === 'left') return Math.max(0, index - 1);
    if (direction === 'right') return Math.min(count - 1, index + 1);
    if (direction === 'up') return index >= columns ? index - columns : index;
    var lastRow = Math.floor((count - 1) / columns);
    return Math.floor(index / columns) < lastRow ? Math.min(count - 1, index + columns) : index;
  }
  // The first row to show so that the chosen one is among the rows shown.
  function firstRow(first, index, columns, shown) {
    var row = Math.floor(index / columns);
    if (row < first) return row;
    if (row >= first + shown) return row - shown + 1;
    return first;
  }
  // The cell at x, y of a grid whose first row shown is `first`, or -1.
  function cellAt(x, y, layout, first, count) {
    var pitch = layout.cell + layout.gap;
    var column = Math.floor((x - layout.left) / pitch), row = Math.floor((y - layout.top) / pitch);
    if (x < layout.left || y < layout.top || column >= layout.columns || row >= layout.shown) return -1;
    if (x - layout.left - column * pitch >= layout.cell || y - layout.top - row * pitch >= layout.cell) return -1;
    var index = (first + row) * layout.columns + column;
    return index < count ? index : -1;
  }

  // Time played, for the profile: "3 h 20 min".
  function played(seconds) {
    if (!seconds) return 'not yet';
    if (seconds < 60) return 'under a minute';
    var hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
    return (hours ? hours + ' h' : '') + (hours && minutes ? ' ' : '') + (minutes ? minutes + ' min' : '');
  }

  globalThis.__profileView = { undug: undug, dig: dig, depthAt: depthAt, STRIKES: STRIKES, digSpot: digSpot, inDigSpot: inDigSpot, menuLines: menuLines, unknocked: unknocked, knock: knock,
    saucerAt: saucerAt, toast: toast, TOAST: TOAST, grid: grid, step: step,
    firstRow: firstRow, cellAt: cellAt, played: played };
})();
