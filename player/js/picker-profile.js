// The profile screen of the game list, and the achievements under it.
//
// The profile shows the user's potato standing on the grass under a night
// sky, with what has been played. The achievements are not on any menu at
// first: they are under the ground. Striking the ground five times in a row
// (touching it, or pressing "down" on the menu's last line) digs down to
// them; once found they also get a line of their own on the menu.
// The sky has its own secret: knocked at enough times in a row (touched
// twenty times, or ten presses to the sides on a line with nothing to
// change), a flying saucer crosses it.
//
// The profile's menu gives the potato a name and changes its pieces, one
// line for each slot; which pieces there are is in js/avatar-model.js.
//
// This file draws and takes the input; what it decides is in
// js/profile-view-model.js. It is given what it needs of the list as `ui`
// (see js/picker.js) and never runs while a game does.
(function () {
  'use strict';

  globalThis.__pickerProfile = function (ui) {
    var c2d = ui.c2d, view = ui.view, achievements = ui.achievements, avatars = ui.avatars, KEY = ui.KEY;
    var INK = ui.colours.INK, MUTED = ui.colours.MUTED, PANEL = ui.colours.PANEL, PANEL_EDGE = ui.colours.PANEL_EDGE;
    var ACCENT = ui.colours.ACCENT;
    var MARGIN = 28, PI = Math.PI;
    // null while the list is shown, else 'profile', 'name' or 'cellar'.
    var screen = null;
    var pictures = null;
    function load() {
      if (pictures) return;
      var dir = ui.playerDir + '/js/';
      pictures = { sky: ui.picture(dir + 'profile-sky.png'), badges: ui.picture(dir + 'achievements.png'), characters: {} };
    }
    // A character's picture (js/avatar-<id>.png), looked for once; the plain
    // potato stands in for one that has no picture.
    function character(id) {
      load();
      var known = pictures.characters;
      if (!(id in known)) known[id] = ui.picture(ui.playerDir + '/js/avatar-' + id + '.png');
      return known[id] || (id === 'potato' ? null : character('potato'));
    }
    function found() { return ui.profile.earned.indexOf('dug-up') >= 0; }
    function draw(image, sx, sy, sw, sh, dx, dy, dw, dh, alpha) {
      c2d.drawImage(ui.canvas(), image.handle, sx, sy, sw, sh, dx, dy, dw, dh, alpha === undefined ? 1 : alpha);
    }
    function rect(x, y, w, h, colour) { c2d.fillRect(ui.canvas(), x, y, w, h, colour, 1); }

    // --- The profile ---------------------------------------------------------
    // The menu: the name, a line for each slot of the avatar, the
    // achievements once they have been found, and going back.
    var chosen = 0;
    function lines() {
      var all = [{ kind: 'name' }].concat(achievements.SLOTS.map(function (slot) { return { kind: 'slot', slot: slot }; }));
      if (found()) all.push({ kind: 'achievements' });
      all.push({ kind: 'back' });
      return all;
    }
    function avatar() { return avatars.dressed(ui.profile.avatar, ui.profile.earned); }
    var TOP = 108, PITCH = 34, ROW = 30;
    // The sky picture covers the window, its grass along the bottom. The
    // grass is the lowest eighth of the picture.
    var GRASS = 0.126;
    function scene() {
      var W = ui.width(), H = ui.height(), sky = pictures.sky;
      var scale = sky ? Math.max(W / sky.width, H / sky.height) : 1;
      var side = sky ? sky.width * scale : W, ground = H - (sky ? sky.height * scale * GRASS : 60);
      var tall = H > W;
      return { W: W, H: H, scale: scale, side: side, ground: ground, tall: tall,
        column: Math.min(W - 2 * MARGIN, tall ? W - 2 * MARGIN : 300),
        avatarX: tall ? W / 2 : Math.max(W * 0.72, W - 190) };
    }
    var digging = view.undug();
    // A strike at the one place where the ground gives way. Once the way
    // down has been dug it stays open, and a strike there goes down it.
    function strike() {
      if (found()) return openCellar();
      digging = view.dig(digging, Date.now());
      if (digging.open) {
        digging = view.undug();
        ui.count(function (stats) { stats.dug = true; });
        openCellar();
      }
      ui.changed();
    }
    // The hole: wider and deeper with each strike, earth thrown to its sides.
    var EARTH = [0.30, 0.19, 0.10, 1], DARK_EARTH = [0.16, 0.10, 0.05, 1], CLOD = [0.42, 0.28, 0.15, 1];
    var WOOD = [0.62, 0.43, 0.22, 1], WOOD_SHADE = [0.40, 0.27, 0.13, 1];
    // A red arrow beside the ladder, pointing the way it leads (`down` or
    // up), with its tip at x, y. It bobs, so that it is noticed.
    var ARROW = [0.93, 0.20, 0.20, 1], ARROW_EDGE = [0.25, 0.03, 0.03, 1];
    function bob() { return Math.floor(Date.now() / 420) % 2; }
    function paintArrow(x, y, down) {
      var way = down ? 1 : -1, tip = y + way * bob() * 4, canvas = ui.canvas();
      function shape(grow, colour) {
        c2d.beginPath(canvas);
        c2d.moveTo(canvas, x, tip + way * grow);
        c2d.lineTo(canvas, x - 11 - grow, tip - way * 12);
        c2d.lineTo(canvas, x - 4 - grow, tip - way * 12);
        c2d.lineTo(canvas, x - 4 - grow, tip - way * (26 + grow));
        c2d.lineTo(canvas, x + 4 + grow, tip - way * (26 + grow));
        c2d.lineTo(canvas, x + 4 + grow, tip - way * 12);
        c2d.lineTo(canvas, x + 11 + grow, tip - way * 12);
        c2d.closePath(canvas);
        c2d.fill(canvas, colour, 1);
      }
      shape(2, ARROW_EDGE);
      shape(0, ARROW);
    }
    function paintHole(at) {
      var open = found(), depth = open ? view.STRIKES : view.depthAt(digging, Date.now());
      if (!depth) return;
      var holeX = view.digSpot(at.W).x;
      var w = 26 + depth * 16, h = 6 + depth * 6, x = Math.round(holeX - w / 2), y = Math.round(at.ground + 6);
      if (open) {
        // The way down, once dug, stays: a hole with a ladder standing in it.
        rect(x - 4, y - 2, w + 8, h + 4, EARTH);
        rect(x, y, w, h, DARK_EARTH);
        var left = Math.round(holeX - 15), top = y - 30;
        rect(left, top, 5, h + 30, WOOD);
        rect(left + 25, top, 5, h + 30, WOOD);
        for (var rung = 0; rung < 5; rung++) rect(left + 5, top + 6 + rung * 12, 20, 4, rung % 2 ? WOOD : WOOD_SHADE);
        paintArrow(holeX - 34, top + 22, true);
        return;
      }
      rect(x - 4, y - 2, w + 8, h + 4, EARTH);
      rect(x, y, w, h, DARK_EARTH);
      for (var i = 0; i < depth * 2; i++) {
        var side = i % 2 ? 1 : -1, far = 10 + (i >> 1) * 9;
        rect(Math.round(holeX + side * (w / 2 + far)), y - 4 - ((i * 5) % 9), 6, 5, CLOD);
      }
    }
    // --- The saucer ------------------------------------------------------------
    var knocking = view.unknocked(), saucerSince = 0;
    function knockSky(how) {
      knocking = view.knock(knocking, Date.now(), how);
      if (!knocking.open) return;
      knocking = view.unknocked();
      saucerSince = Date.now();
      ui.count(function (stats) { stats.aliens = true; });
      ui.changed();
    }
    var HULL = [0.72, 0.74, 0.80, 1], HULL_SHADE = [0.44, 0.46, 0.54, 1], DOME = [0.55, 0.92, 1, 0.92];
    var LIGHTS = [[1, 0.86, 0.2, 1], [0.4, 1, 0.5, 1], [1, 0.4, 0.4, 1]];
    function paintSaucer(at) {
      var saucer = view.saucerAt(Date.now(), at.W, saucerSince);
      if (!saucer) return;
      var x = Math.round(saucer.x), y = Math.round(at.H * 0.2 + Math.sin(saucer.along * PI * 5) * 7);
      ui.box(x - 20, y - 24, 40, 32, 14, DOME);
      ui.box(x - 58, y - 6, 116, 22, 11, HULL);
      ui.box(x - 46, y + 8, 92, 8, 4, HULL_SHADE);
      for (var i = 0; i < 5; i++) rect(x - 44 + i * 20, y, 8, 5, LIGHTS[(i + Math.floor(saucer.along * 12)) % 3]);
    }

    function paintProfile() {
      var at = scene(), W = at.W, H = at.H, profile = ui.profile, stats = profile.stats, mine = avatar();
      rect(0, 0, W, H, ui.colours.NIGHT);
      if (pictures.sky) draw(pictures.sky, 0, 0, pictures.sky.width, pictures.sky.height, (W - at.side) / 2, H - at.side, at.side, at.side);
      paintSaucer(at);
      paintHole(at);
      var body = character(mine.character);
      if (body) draw(body, 0, 0, body.width, body.height, Math.round(at.avatarX - body.width / 2), Math.round(at.ground + 14 - body.height), body.width, body.height);
      var x = MARGIN;
      ui.text('PROFILE', x, 34, 12, MUTED);
      ui.text(ui.fitted(profile.name || 'Potato', 32, W - 2 * x), x, 72, 32, INK);
      var facts = view.played(stats.seconds) + ' played   ' + stats.games + ' games   ' + stats.saves + ' saves   ' +
        achievements.points(profile.earned) + ' points';
      ui.text(ui.fitted(facts, 13, W - 2 * x), x, 94, 13, MUTED);
      lines().forEach(function (line, i) {
        var y = TOP + i * PITCH, on = i === chosen;
        ui.box(x, y, at.column, ROW, 9, on ? ui.colours.CHOSEN : PANEL);
        var label, value = '', choices = 0;
        if (line.kind === 'name') { label = 'Name'; value = profile.name || 'not set'; }
        else if (line.kind === 'slot') {
          label = avatars.LABELS[line.slot];
          value = avatars.nameOf(line.slot, mine[line.slot]);
          choices = avatars.owned(line.slot, profile.earned).length;
        }
        else if (line.kind === 'achievements') { label = 'Achievements'; value = profile.earned.length + ' of ' + achievements.LIST.length; }
        else label = 'Back to the games';
        var wide = line.kind === 'back' || line.kind === 'achievements';
        ui.text(label, x + 12, y + 20, wide ? 15 : 13, wide || on ? INK : MUTED);
        var room = at.column - (wide ? 150 : 116);
        if (value) ui.text(ui.fitted(value, 15, room), x + (wide ? 136 : 96), y + 21, 15, INK);
        // More than one piece to choose from: the arrows say so.
        if (on && choices > 1 && !ui.touching()) ui.text('<  >', x + at.column - 12 - ui.widthOf('<  >', 13), y + 20, 13, INK);
      });
      if (ui.touching()) ui.text('Touch a line to change it', x, H - 18, 15, MUTED);
      else ui.hint(ui.hint(x, H - 18, 'A', 'Choose'), H - 18, 'B', 'Back');
    }
    // Puts the next piece (`by` 1) or the one before in a slot.
    function change(slot, by) {
      var now = avatars.next(avatar()[slot], slot, by, ui.profile.earned);
      if (now === avatar()[slot]) return;
      ui.profile.avatar[slot] = now;
      ui.count(function (stats) { stats.dressed = true; });
      ui.changed();
    }
    function chooseLine() {
      var line = lines()[chosen];
      if (line.kind === 'achievements') openCellar();
      else if (line.kind === 'name') openName();
      else if (line.kind === 'slot') change(line.slot, 1);
      else close();
    }
    function profileKey(keyCode) {
      var all = lines(), line = all[chosen];
      if (keyCode === KEY.up) chosen = Math.max(0, chosen - 1);
      else if (keyCode === KEY.down) {
        // "Down" with nowhere further to go strikes the ground.
        if (chosen === all.length - 1) return strike();
        chosen++;
      }
      else if (keyCode === KEY.left || keyCode === KEY.right) {
        // To the sides changes the piece of a slot; where there is nothing
        // to change, it knocks at the sky.
        if (line.kind === 'slot') return change(line.slot, keyCode === KEY.right ? 1 : -1);
        return knockSky('keys');
      }
      else if (KEY.ok.indexOf(keyCode) >= 0) return chooseLine();
      else if (KEY.back.indexOf(keyCode) >= 0) return close();
      ui.changed();
    }
    function profilePointer(phase, x, y) {
      if (phase !== 0) return;
      var at = scene(), line = Math.floor((y - TOP) / PITCH);
      if (x >= MARGIN && x < MARGIN + at.column && line >= 0 && line < lines().length && y - TOP - line * PITCH < ROW) {
        chosen = line;
        ui.changed();
        return chooseLine();
      }
      // The ground gives way at one side only; the rest of it is just grass.
      if (y >= at.ground) { if (view.inDigSpot(x, at.W)) strike(); }
      else knockSky('touch');
    }

    // --- The name -----------------------------------------------------------------
    // Typed on a board of letters, with the pad or a finger.
    var typing = '', key = 0, BOARD_COLUMNS = 6;
    function openName() { screen = 'name'; typing = ui.profile.name || ''; key = 0; ui.changed(); }
    function board() {
      var W = ui.width(), w = Math.min(64, Math.floor((W - 2 * MARGIN) / BOARD_COLUMNS)), h = 46;
      return { columns: BOARD_COLUMNS, rows: Math.ceil(avatars.KEYS.length / BOARD_COLUMNS), shown: 99, cell: w, gap: 0,
        left: Math.round((W - w * BOARD_COLUMNS) / 2), top: 166, w: w, h: h };
    }
    var KEY_LABELS = { space: 'SPACE', del: 'DEL', ok: 'OK' };
    function paintName() {
      var W = ui.width(), H = ui.height(), at = board();
      rect(0, 0, W, H, ui.colours.NIGHT);
      ui.text('PROFILE', MARGIN, 34, 12, MUTED);
      ui.text('Your name', MARGIN, 72, 32, INK);
      ui.box(MARGIN, 96, Math.min(W - 2 * MARGIN, 420), 48, 10, PANEL);
      ui.text(typing + '_', MARGIN + 16, 128, 24, INK);
      avatars.KEYS.forEach(function (each, i) {
        var x = at.left + (i % at.columns) * at.w, y = at.top + Math.floor(i / at.columns) * at.h;
        ui.box(x + 3, y + 3, at.w - 6, at.h - 6, 8, i === key ? ui.colours.CHOSEN : PANEL);
        var label = KEY_LABELS[each] || each, size = label.length > 1 ? 12 : 20;
        ui.text(label, x + (at.w - ui.widthOf(label, size)) / 2, y + at.h / 2 + size / 3, size, INK);
      });
      if (!ui.touching()) ui.hint(ui.hint(MARGIN, H - 18, 'A', 'Type'), H - 18, 'B', 'Cancel');
    }
    function press(which) {
      if (which !== 'ok') { typing = avatars.typed(typing, which); return ui.changed(); }
      ui.profile.name = avatars.tidyName(typing);
      ui.count(function (stats) { if (ui.profile.name) stats.named = true; });
      screen = 'profile';
      ui.changed();
    }
    function nameKey(keyCode) {
      var direction = keyCode === KEY.up ? 'up' : keyCode === KEY.down ? 'down' : keyCode === KEY.left ? 'left' : keyCode === KEY.right ? 'right' : null;
      if (direction) { key = view.step(key, direction, BOARD_COLUMNS, avatars.KEYS.length); return ui.changed(); }
      if (KEY.ok.indexOf(keyCode) >= 0) return press(avatars.KEYS[key]);
      if (KEY.back.indexOf(keyCode) >= 0) { screen = 'profile'; ui.changed(); }
    }
    function namePointer(phase, x, y) {
      if (phase !== 0) return;
      var at = board(), column = Math.floor((x - at.left) / at.w), row = Math.floor((y - at.top) / at.h);
      var index = row * at.columns + column;
      if (x < at.left || y < at.top || column >= at.columns || index >= avatars.KEYS.length) return;
      key = index;
      press(avatars.KEYS[index]);
    }

    // --- The achievements ------------------------------------------------------
    var picked = 0, firstRow = 0, drag = null;
    var SHEET_COLUMNS = 8;
    function openCellar() { screen = 'cellar'; picked = 0; firstRow = 0; ui.changed(); }
    function layout() { return view.grid(ui.width(), ui.height(), achievements.LIST.length); }
    var SOIL = [0.20, 0.13, 0.07, 1], DEEP_SOIL = [0.10, 0.065, 0.035, 1], GRASS_GREEN = [0.16, 0.42, 0.14, 1];
    function paintCellar() {
      var W = ui.width(), H = ui.height(), grid = layout(), earned = ui.profile.earned, list = achievements.LIST;
      rect(0, 0, W, H, DEEP_SOIL);
      rect(0, 0, W, 84, SOIL);
      rect(0, 0, W, 8, GRASS_GREEN);
      ui.text('UNDER THE GROUND', MARGIN, 34, 12, MUTED);
      ui.text('Achievements', MARGIN, 72, 32, INK);
      // The ladder comes down from the profile, at the place it was dug.
      var ladder = Math.round(view.digSpot(W).x - 15);
      rect(ladder, 0, 5, 84, WOOD);
      rect(ladder + 25, 0, 5, 84, WOOD);
      for (var rung = 0; rung < 7; rung++) rect(ladder + 5, 6 + rung * 12, 20, 4, rung % 2 ? WOOD : WOOD_SHADE);
      paintArrow(ladder - 18, 20, false);
      var tally = earned.length + ' of ' + list.length;
      ui.text(tally, ladder - 44 - ui.widthOf(tally, 18), 72, 18, MUTED);
      var pitch = grid.cell + grid.gap;
      for (var row = 0; row < grid.shown; row++) {
        for (var column = 0; column < grid.columns; column++) {
          var index = (firstRow + row) * grid.columns + column;
          if (index >= list.length) break;
          var x = grid.left + column * pitch, y = grid.top + row * pitch;
          var shown = achievements.shown(list[index].id, earned);
          if (index === picked) ui.box(x - 4, y - 4, grid.cell + 8, grid.cell + 8, 8, ACCENT);
          if (list[index].secret && !shown.earned) {
            // A secret one keeps its picture to itself.
            ui.box(x, y, grid.cell, grid.cell, 6, PANEL_EDGE);
            ui.text('?', x + (grid.cell - ui.widthOf('?', 40)) / 2, y + grid.cell / 2 + 14, 40, MUTED);
          } else if (pictures.badges) {
            rect(x, y, grid.cell, grid.cell, DEEP_SOIL);
            draw(pictures.badges, (index % SHEET_COLUMNS) * 96, Math.floor(index / SHEET_COLUMNS) * 96, 96, 96, x, y, grid.cell, grid.cell,
              shown.earned ? 1 : 0.2);
          }
        }
      }
      if (grid.rows > grid.shown) {
        var track = grid.shown * pitch - grid.gap, piece = Math.max(24, track * grid.shown / grid.rows);
        var right = grid.left + grid.columns * pitch;
        ui.box(right, grid.top, 4, track, 2, PANEL);
        ui.box(right, grid.top + (track - piece) * firstRow / (grid.rows - grid.shown), 4, piece, 2, PANEL_EDGE);
      }
      var mine = achievements.shown(list[picked].id, earned), under = grid.top + grid.shown * pitch + 14;
      var name = mine.name + (mine.earned ? '' : '   (not yet)');
      ui.text(ui.fitted(name, 19, W - 2 * MARGIN), MARGIN, under + 6, 19, mine.earned ? INK : MUTED);
      ui.text(ui.fitted(mine.how, 15, W - 2 * MARGIN), MARGIN, under + 28, 15, MUTED);
      if (!ui.touching() && under + 60 < H) ui.hint(MARGIN, H - 18, 'B', 'Back');
    }
    function pick(index) {
      picked = index;
      firstRow = view.firstRow(firstRow, picked, layout().columns, layout().shown);
      ui.changed();
    }
    function cellarKey(keyCode) {
      var grid = layout(), count = achievements.LIST.length;
      var direction = keyCode === KEY.up ? 'up' : keyCode === KEY.down ? 'down' : keyCode === KEY.left ? 'left' : keyCode === KEY.right ? 'right' : null;
      if (direction) return pick(view.step(picked, direction, grid.columns, count));
      if (KEY.back.indexOf(keyCode) >= 0) { screen = 'profile'; ui.changed(); }
    }
    // A touch picks the achievement under it; dragging up or down moves the
    // rows; a touch on the title goes back.
    function cellarPointer(phase, x, y) {
      var grid = layout(), pitch = grid.cell + grid.gap;
      if (phase === 0) {
        drag = { y: y, first: firstRow, moved: false };
        var cell = view.cellAt(x, y, grid, firstRow, achievements.LIST.length);
        if (cell >= 0) pick(cell);
        else if (y < 84) { screen = 'profile'; drag = null; ui.changed(); }
      } else if (drag && phase === 1) {
        var rows = Math.round((drag.y - y) / pitch);
        var top = Math.max(0, Math.min(grid.rows - grid.shown, drag.first + rows));
        if (top !== firstRow) { firstRow = top; ui.changed(); }
      } else if (phase === 2) {
        drag = null;
      }
    }

    // --- For the list ----------------------------------------------------------
    function open() { load(); screen = 'profile'; chosen = 0; digging = view.undug(); ui.changed(); }
    function close() { screen = null; ui.changed(); }
    // The avatar, small, for the list's heading: at x, y, `size` high.
    function paintChip(x, y, size, on) {
      ui.box(x - 6, y - 6, size + 12, size + 12, 12, on ? ACCENT : PANEL);
      var body = character(avatar().character);
      if (!body) return;
      var scale = Math.min(size / body.height, size / body.width), w = body.width * scale, h = body.height * scale;
      draw(body, 0, 0, body.width, body.height, Math.round(x + (size - w) / 2), Math.round(y + size - h), w, h);
    }
    // The picture of an achievement, `size` across, at x, y.
    function paintBadge(id, x, y, size) {
      load();
      var index = -1;
      achievements.LIST.forEach(function (each, i) { if (each.id === id) index = i; });
      if (index < 0 || !pictures.badges) return;
      draw(pictures.badges, (index % SHEET_COLUMNS) * 96, Math.floor(index / SHEET_COLUMNS) * 96, 96, 96, x, y, size, size);
    }
    // The banner that tells an achievement, `shown` of the way down (0 to 1).
    var BANNER = [0.09, 0.10, 0.14, 0.97];
    function paintToast(id, shown) {
      var W = ui.width(), w = Math.min(W - 2 * MARGIN, 340), h = 68, x = Math.round((W - w) / 2), y = Math.round(-h - 4 + shown * (h + 16));
      ui.box(x - 2, y - 2, w + 4, h + 4, 14, PANEL_EDGE);
      ui.box(x, y, w, h, 12, BANNER);
      paintBadge(id, x + 10, y + 10, 48);
      var name = achievements.shown(id, [id]).name;
      ui.text('ACHIEVEMENT', x + 70, y + 26, 11, MUTED);
      ui.text(ui.fitted(name, 19, w - 84), x + 70, y + 50, 19, INK);
    }
    var closing = 0, bobbed = 0;
    return {
      isOpen: function () { return !!screen; },
      open: open,
      paint: function () { (screen === 'cellar' ? paintCellar : screen === 'name' ? paintName : paintProfile)(); },
      key: function (keyCode) { (screen === 'cellar' ? cellarKey : screen === 'name' ? nameKey : profileKey)(keyCode); },
      pointer: function (phase, x, y) { (screen === 'cellar' ? cellarPointer : screen === 'name' ? namePointer : profilePointer)(phase, x, y); },
      // Called each frame: the hole closes by itself, which needs one more
      // picture when it does.
      tick: function () {
        // The arrow by the ladder bobs, wherever a ladder is showing.
        if ((screen === 'cellar' || (screen === 'profile' && found())) && bob() !== bobbed) { bobbed = bob(); ui.changed(); }
        if (screen !== 'profile') return;
        var depth = view.depthAt(digging, Date.now());
        if (depth !== closing) { closing = depth; ui.changed(); }
        // The saucer moves, and one more picture is needed once it has gone.
        if (saucerSince) {
          if (!view.saucerAt(Date.now(), ui.width(), saucerSince)) saucerSince = 0;
          ui.changed();
        }
      },
      paintChip: paintChip,
      paintToast: paintToast,
    };
  };
})();
