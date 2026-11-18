// The profile screen of the game list, and the achievements under it.
//
// The profile shows the user's potato standing on the grass under a night
// sky, with what has been played. The achievements are not on any menu at
// first: they are under the ground. Striking the ground five times in a row
// (touching it, or pressing "down" on the menu's last line) digs down to
// them; once found they also get a line of their own on the menu.
// The sky has its own secret: knocked at ten times in a row (touched, or
// "up" on the menu's first line), a flying saucer crosses it.
//
// This file draws and takes the input; what it decides is in
// js/profile-view-model.js. It is given what it needs of the list as `ui`
// (see js/picker.js) and never runs while a game does.
(function () {
  'use strict';

  globalThis.__pickerProfile = function (ui) {
    var c2d = ui.c2d, view = ui.view, achievements = ui.achievements, KEY = ui.KEY;
    var INK = ui.colours.INK, MUTED = ui.colours.MUTED, PANEL = ui.colours.PANEL, PANEL_EDGE = ui.colours.PANEL_EDGE;
    var ACCENT = ui.colours.ACCENT;
    var MARGIN = 28, PI = Math.PI;
    // null while the list is shown, else 'profile' or 'cellar'.
    var screen = null;
    var pictures = null;
    function load() {
      if (pictures) return;
      var dir = ui.playerDir + '/js/';
      pictures = { sky: ui.picture(dir + 'profile-sky.png'), avatar: ui.picture(dir + 'avatar.png'), badges: ui.picture(dir + 'achievements.png') };
    }
    function found() { return ui.profile.earned.indexOf('dug-up') >= 0; }
    function draw(image, sx, sy, sw, sh, dx, dy, dw, dh, alpha) {
      c2d.drawImage(ui.canvas(), image.handle, sx, sy, sw, sh, dx, dy, dw, dh, alpha === undefined ? 1 : alpha);
    }
    function rect(x, y, w, h, colour) { c2d.fillRect(ui.canvas(), x, y, w, h, colour, 1); }

    // --- The profile ---------------------------------------------------------
    // The menu: the achievements once they have been found, and going back.
    var chosen = 0;
    function lines() { return (found() ? ['achievements'] : []).concat(['back']); }
    // The sky picture covers the window, its grass along the bottom. The
    // grass is the lowest eighth of the picture.
    var GRASS = 0.126;
    function scene() {
      var W = ui.width(), H = ui.height(), sky = pictures.sky;
      var scale = sky ? Math.max(W / sky.width, H / sky.height) : 1;
      var side = sky ? sky.width * scale : W, ground = H - (sky ? sky.height * scale * GRASS : 60);
      var tall = H > W;
      var big = pictures.avatar && H >= 700 ? 2 : 1;
      return { W: W, H: H, scale: scale, side: side, ground: ground, tall: tall, avatarScale: big,
        avatarX: tall ? W / 2 : Math.max(W * 0.72, W - 190) };
    }
    var digging = view.undug(), holeX = 0;
    function strike(x) {
      holeX = x;
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
    function paintHole(at) {
      var depth = view.depthAt(digging, Date.now());
      if (!depth) return;
      var w = 26 + depth * 16, h = 6 + depth * 6, x = Math.round(holeX - w / 2), y = Math.round(at.ground + 6);
      rect(x - 4, y - 2, w + 8, h + 4, EARTH);
      rect(x, y, w, h, DARK_EARTH);
      for (var i = 0; i < depth * 2; i++) {
        var side = i % 2 ? 1 : -1, far = 10 + (i >> 1) * 9;
        rect(Math.round(holeX + side * (w / 2 + far)), y - 4 - ((i * 5) % 9), 6, 5, CLOD);
      }
    }
    // --- The saucer ------------------------------------------------------------
    var knocking = view.unknocked(), saucerSince = 0;
    function knockSky() {
      knocking = view.knock(knocking, Date.now());
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
      var at = scene(), W = at.W, H = at.H, profile = ui.profile, stats = profile.stats;
      rect(0, 0, W, H, ui.colours.NIGHT);
      if (pictures.sky) draw(pictures.sky, 0, 0, pictures.sky.width, pictures.sky.height, (W - at.side) / 2, H - at.side, at.side, at.side);
      paintSaucer(at);
      paintHole(at);
      if (pictures.avatar) {
        var aw = pictures.avatar.width * at.avatarScale, ah = pictures.avatar.height * at.avatarScale;
        draw(pictures.avatar, 0, 0, pictures.avatar.width, pictures.avatar.height, Math.round(at.avatarX - aw / 2), Math.round(at.ground + 14 - ah), aw, ah);
      }
      var x = MARGIN;
      ui.text('PROFILE', x, 34, 12, MUTED);
      ui.text(ui.fitted(profile.name || 'Potato', 32, W - 2 * x), x, 72, 32, INK);
      var facts = ['Played: ' + view.played(stats.seconds), 'Games on the list: ' + stats.games, 'Saves written: ' + stats.saves];
      facts.forEach(function (fact, i) { ui.text(fact, x, 112 + i * 24, 16, MUTED); });
      var column = Math.min(W - 2 * x, at.tall ? W - 2 * x : 300);
      lines().forEach(function (line, i) {
        var y = 196 + i * 54, on = i === chosen;
        ui.box(x, y, column, 46, 12, on ? ui.colours.CHOSEN : PANEL);
        var label = line === 'back' ? 'Back to the games'
          : 'Achievements   ' + profile.earned.length + ' of ' + achievements.LIST.length;
        ui.text(label, x + 16, y + 30, 19, INK);
      });
      if (ui.touching()) ui.text('Touch a line to open it', x, H - 18, 15, MUTED);
      else ui.hint(ui.hint(x, H - 18, 'A', 'Open'), H - 18, 'B', 'Back');
    }
    function chooseLine() {
      var line = lines()[chosen];
      if (line === 'achievements') openCellar();
      else close();
    }
    function profileKey(keyCode) {
      var count = lines().length;
      if (keyCode === KEY.up) {
        // "Up" with nowhere further to go knocks at the sky.
        if (chosen === 0) return knockSky();
        chosen--;
      }
      else if (keyCode === KEY.down) {
        // "Down" with nowhere further to go strikes the ground.
        if (chosen === count - 1) return strike(scene().avatarX - 110);
        chosen++;
      }
      else if (KEY.ok.indexOf(keyCode) >= 0) return chooseLine();
      else if (KEY.back.indexOf(keyCode) >= 0) return close();
      ui.changed();
    }
    function profilePointer(phase, x, y) {
      if (phase !== 0) return;
      var at = scene(), column = Math.min(at.W - 2 * MARGIN, at.tall ? at.W - 2 * MARGIN : 300);
      var line = Math.floor((y - 196) / 54);
      if (x >= MARGIN && x < MARGIN + column && line >= 0 && line < lines().length && y - 196 - line * 54 < 46) {
        chosen = line;
        ui.changed();
        return chooseLine();
      }
      if (y >= at.ground) strike(x);
      else knockSky();
    }

    // --- The achievements ------------------------------------------------------
    var picked = 0, firstRow = 0, press = null;
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
      var tally = earned.length + ' of ' + list.length;
      ui.text(tally, W - MARGIN - ui.widthOf(tally, 18), 72, 18, MUTED);
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
        press = { y: y, first: firstRow, moved: false };
        var cell = view.cellAt(x, y, grid, firstRow, achievements.LIST.length);
        if (cell >= 0) pick(cell);
        else if (y < 84) { screen = 'profile'; press = null; ui.changed(); }
      } else if (press && phase === 1) {
        var rows = Math.round((press.y - y) / pitch);
        var top = Math.max(0, Math.min(grid.rows - grid.shown, press.first + rows));
        if (top !== firstRow) { firstRow = top; ui.changed(); }
      } else if (phase === 2) {
        press = null;
      }
    }

    // --- For the list ----------------------------------------------------------
    function open() { load(); screen = 'profile'; chosen = 0; digging = view.undug(); ui.changed(); }
    function close() { screen = null; ui.changed(); }
    // The avatar, small, for the list's heading: at x, y, `size` high.
    function paintChip(x, y, size, on) {
      load();
      ui.box(x - 6, y - 6, size + 12, size + 12, 12, on ? ACCENT : PANEL);
      var avatar = pictures.avatar;
      if (!avatar) return;
      var w = avatar.width * size / avatar.height;
      draw(avatar, 0, 0, avatar.width, avatar.height, Math.round(x + (size - w) / 2), y, w, size);
    }
    var closing = 0;
    return {
      isOpen: function () { return !!screen; },
      open: open,
      paint: function () { (screen === 'cellar' ? paintCellar : paintProfile)(); },
      key: function (keyCode) { (screen === 'cellar' ? cellarKey : profileKey)(keyCode); },
      pointer: function (phase, x, y) { (screen === 'cellar' ? cellarPointer : profilePointer)(phase, x, y); },
      // Called each frame: the hole closes by itself, which needs one more
      // picture when it does.
      tick: function () {
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
    };
  };
})();
