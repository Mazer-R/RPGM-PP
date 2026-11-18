// The game list. The native player runs this file when it is given --pick.
//
// It shows two kinds of games as one list: those found in the folders in
// player.libraryDirs (a game is a folder that holds the game's own www
// folder, the one with index.html), and those remembered from before, in
// player.libraryGames: the games played or added, the last one first. They
// are shown in that order, the remembered ones on top. The user chooses
// with the controls. The choice is remembered (player.rememberGame) and
// printed as "MVPLAYER_GAME=<www folder>" for the program that started the
// player, which then runs the player again with --game. Leaving without
// choosing exits with code 10.
//
// A game can be taken off the list: X on a controller (or Delete or Shift
// on a keyboard), or the cross at the end of the chosen game's line when
// touched, then the same again to be sure. Its files are left alone. It
// stays off (player.forgetGame, read back as player.forgottenGames), also
// when it is in one of the folders the list looks through, until it is
// added again.
//
// When player.canAddGame is set the list has an "add a game" line. It opens
// a second screen that shows folders, starting from player.browseDirs, and
// says what to look for: the game's own folder, and in it the game's .exe.
// Choosing that file (or index.html, or the line offered when the folder
// shown is itself a game) remembers the game and goes back to the list,
// with the game chosen. What each screen shows is decided in
// picker-model.js.
//
// The list is drawn on a native canvas and shown through WebGL; none of the
// browser stand-in layers are loaded for it.
(function () {
  'use strict';
  var gl = player.gl, c2d = player.canvas;
  // The window's size in pixels, and the size the list is drawn at: for a
  // screen about 480 pixels high, shown enlarged by a whole factor (ZOOM) on
  // denser screens (a phone), so the text stays readable. Set by fitTo(),
  // at the start and whenever the window changes size.
  var SCREEN_W = 0, SCREEN_H = 0, ZOOM = 1, W = 0, H = 0;
  var KEY = { up: 38, down: 40, pageUp: 33, pageDown: 34, ok: [90, 13, 32], back: [88, 27], remove: [16, 46] };
  var EXIT_NOTHING_CHOSEN = 10;

  // --- Find the games -------------------------------------------------------
  function titleOf(www, fallback) {
    var html = player.readTextFile(www + '/index.html') || '';
    var match = /<title>([^<]*)<\/title>/.exec(html);
    if (!match || !match[1].trim()) return fallback;
    return match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  player.loadScript(player.playerDir + '/js/picker-model.js');
  var model = globalThis.__pickerModel;
  var folderName = model.folderOf;
  var found = [], recent = (player.libraryGames || []).slice(), forgotten = (player.forgottenGames || []).slice();
  (player.libraryDirs || []).forEach(function (dir) {
    player.listDir(dir).forEach(function (name) {
      var www = model.gameIn(dir, name, player.fileExists);
      if (www) found.push({ title: titleOf(www, name), www: www });
    });
  });
  // Named after the folder that holds www when the page has no title.
  recent.forEach(function (www) {
    if (player.fileExists(www + '/index.html')) found.push({ title: titleOf(www, folderName(www)), www: www });
  });
  // The lines of the list: the games, then adding one.
  var games = [];
  function listGames() {
    games = model.order(found, recent, forgotten);
    if (player.canAddGame) games.push({ add: true });
  }
  listGames();
  // Puts a game on top of the remembered ones, here and in the file.
  // Also brings back a game that had been taken off the list.
  function remember(www) {
    recent = [www].concat(recent.filter(function (other) { return other !== www; }));
    forgotten = forgotten.filter(function (other) { return other !== www; });
    if (player.rememberGame) player.rememberGame(www);
  }

  // --- Taking a game off the list -------------------------------------------
  // `removing` is the www folder of the chosen game while the list asks
  // whether to take it off, else null. Anything but the same again keeps it.
  var removing = null;
  function askToRemove() {
    var entry = browsing ? null : games[selected];
    if (!entry || !entry.www) return;
    if (removing === entry.www) return forget(entry);
    removing = entry.www;
    note = '';
    changed = true;
  }
  function keepGame() {
    if (removing) { removing = null; changed = true; }
  }
  function forget(game) {
    removing = null;
    recent = recent.filter(function (other) { return other !== game.www; });
    forgotten.push(game.www);
    var saved = player.forgetGame ? player.forgetGame(game.www) : false;
    console.info('picker: took ' + game.www + ' off the list' + (saved ? '' : ', for this time only'));
    note = saved ? 'Taken off the list. Its files are still there.' : 'Taken off, but could not be saved: it will be back.';
    listGames();
    selected = Math.max(0, Math.min(selected, games.length - 1));
    first = Math.max(0, Math.min(first, games.length - visible()));
    move(0);
  }

  // --- Looking through folders for a game to add ---------------------------
  // `browsing` is null while the list is shown; else the folder shown ('' for
  // the list of starting folders) and its lines.
  var roots = (player.browseDirs || []).filter(function (dir) { return player.listFolder(dir).length > 0; });
  if (!roots.length) roots = ['/'];
  var browsing = null, note = '';
  function show(dir) {
    var rows;
    if (dir === '') {
      rows = model.places(roots);
    } else {
      var www = player.resolveGame(dir);
      rows = model.browse(dir, player.listFolder(dir), www ? { title: titleOf(www, folderName(www)), www: www } : null, roots);
    }
    browsing = { dir: dir, rows: rows };
    selected = 0; first = 0; changed = true;
  }
  function startBrowsing() { note = ''; show(roots.length === 1 ? roots[0] : ''); }
  function backToList(www) {
    browsing = null;
    listGames();
    selected = 0; first = 0;
    for (var i = 0; i < games.length; i++) if (www && games[i].www === www) move(i);
    changed = true;
  }
  // Adds the game that `path` (a folder or a file in it) belongs to.
  function add(path) {
    var www = player.resolveGame(path);
    if (!www) {
      note = 'No RPG Maker MV game there. Choose the .exe in the game\'s own folder.';
      changed = true;
      return;
    }
    if (!found.some(function (game) { return game.www === www; })) found.push({ title: titleOf(www, folderName(www)), www: www });
    remember(www);
    console.info('picker: added ' + www);
    note = 'Added. Choose it to play.';
    backToList(www);
  }
  function lines() { return browsing ? browsing.rows : games; }
  function leave(code, answer) {
    if (answer) player.print(answer);
    player.exit(code);
  }
  console.info('picker: ' + games.length + ' lines; folders: ' + (player.libraryDirs || []).join(', '));

  // --- A font ---------------------------------------------------------------
  // The player ships no font of its own. A phone's or a desktop's own font
  // is used when there is one; otherwise the font every RPG Maker MV game
  // carries, lent by the first game that has it.
  var SYSTEM_FONTS = ['/system/fonts/Roboto-Regular.ttf', '/system/fonts/NotoSans-Regular.ttf',
    '/system/fonts/DroidSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'];
  var fontFiles = SYSTEM_FONTS.concat(found.map(function (game) { return game.www + '/fonts/mplus-1m-regular.ttf'; }));
  var hasFont = fontFiles.some(function (file) { return player.fileExists(file) && c2d.registerFont('Picker', file); });

  // --- The games' own pictures ------------------------------------------------
  // A game's icon (www/icon/icon.png) is shown on its line, and the picture
  // of its title screen fills the background while the game is the chosen
  // one. A game that has neither, or keeps them encrypted, does without.
  var art = {};
  function picture(file) {
    var size = player.fileExists(file) ? c2d.imageSize(file) : null;
    var handle = size ? c2d.loadImage(file) : 0;
    return handle ? { handle: handle, width: size[0], height: size[1] } : null;
  }
  function artOf(game) {
    return art[game.www] || (art[game.www] = { icon: picture(game.www + '/icon/icon.png'), cover: null, looked: false });
  }
  // Decoding a title picture takes a moment on a handheld, so it is looked
  // for only once the choice has rested on a game (see frame()).
  function lookForCover(game) {
    var mine = artOf(game);
    mine.looked = true;
    try {
      var system = JSON.parse(player.readTextFile(game.www + '/data/System.json') || '{}');
      [['titles1', system.title1Name], ['titles2', system.title2Name]].some(function (place) {
        if (place[1]) mine.cover = picture(game.www + '/img/' + place[0] + '/' + place[1] + '.png');
        return !!mine.cover;
      });
    } catch (error) { /* the game's data cannot be read: no picture */ }
  }

  // --- Drawing ----------------------------------------------------------------
  var canvas = null;
  // The lines are in a column on the left; the rest of a wide screen shows
  // the background. The browser's lines are lower, under its explanation,
  // and smaller, so that a small screen still shows several.
  var MARGIN = model.MARGIN, COLUMN = 0;
  var LIST = { top: 98, row: 62 }, BROWSE = { top: 166, row: 46 };
  function metrics() { return browsing ? BROWSE : LIST; }
  function visible() { return Math.max(1, Math.floor((H - metrics().top - 40) / metrics().row)); }
  function layout() {
    return { top: metrics().top, row: metrics().row, first: first, count: lines().length, visible: visible(),
      left: MARGIN - 8, width: COLUMN + 16 };
  }
  var selected = 0, first = 0;
  // Fingers or a mouse have been used (or it is a phone): the hints speak of
  // touching, and nothing is said about buttons.
  var touching = !!player.needsFileAccess;
  var INK = [0.96, 0.96, 0.98, 1], MUTED = [0.66, 0.67, 0.74, 1], NIGHT = [0.043, 0.045, 0.063, 1];
  var PANEL = [1, 1, 1, 0.07], PANEL_EDGE = [1, 1, 1, 0.16], ACCENT = [0.80, 0.23, 0.25, 1], ACCENT_DEEP = [0.52, 0.12, 0.16, 1];
  var PI = Math.PI;

  function gradient(x0, y0, x1, y1, stops) {
    var made = c2d.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (stop) { c2d.addColorStop(made, stop[0], stop[1][0], stop[1][1], stop[1][2], stop[1][3]); });
    return made;
  }
  // Over the background picture: dark where the lines are, clearer to the
  // right, and dark again along the bottom, under the hints.
  var VEIL, FLOOR, PLAIN, CHOSEN;
  // Lays the list out for a window of this many pixels.
  function fitTo(width, height) {
    var fitted = model.fit(width, height);
    SCREEN_W = width; SCREEN_H = height;
    ZOOM = fitted.zoom; W = fitted.width; H = fitted.height; COLUMN = fitted.column;
    if (canvas) c2d.destroy(canvas);
    canvas = c2d.create(W, H);
    VEIL = gradient(0, 0, W, 0, [[0, [0.043, 0.045, 0.063, 0.97]], [0.5, [0.043, 0.045, 0.063, 0.84]], [1, [0.043, 0.045, 0.063, 0.30]]]);
    FLOOR = gradient(0, H - 110, 0, H, [[0, [0.043, 0.045, 0.063, 0]], [1, [0.043, 0.045, 0.063, 0.92]]]);
    PLAIN = gradient(0, 0, 0, H, [[0, [0.085, 0.09, 0.13, 1]], [1, NIGHT]]);
    CHOSEN = gradient(MARGIN, 0, MARGIN + COLUMN, 0, [[0, ACCENT], [1, ACCENT_DEEP]]);
  }
  fitTo(gl.drawingBufferWidth, gl.drawingBufferHeight);

  function rounded(x, y, w, h, r) {
    c2d.beginPath(canvas);
    c2d.moveTo(canvas, x + r, y);
    c2d.lineTo(canvas, x + w - r, y);
    c2d.arc(canvas, x + w - r, y + r, r, -PI / 2, 0, false);
    c2d.lineTo(canvas, x + w, y + h - r);
    c2d.arc(canvas, x + w - r, y + h - r, r, 0, PI / 2, false);
    c2d.lineTo(canvas, x + r, y + h);
    c2d.arc(canvas, x + r, y + h - r, r, PI / 2, PI, false);
    c2d.lineTo(canvas, x, y + r);
    c2d.arc(canvas, x + r, y + r, r, PI, PI * 1.5, false);
    c2d.closePath(canvas);
  }
  function box(x, y, w, h, r, paint) { rounded(x, y, w, h, r); c2d.fill(canvas, paint, 1); }
  function line(points, colour, thickness) {
    c2d.beginPath(canvas);
    points.forEach(function (point, i) { (i ? c2d.lineTo : c2d.moveTo)(canvas, point[0], point[1]); });
    c2d.stroke(canvas, colour, 1, thickness, true);
  }
  function text(string, x, y, size, colour) {
    if (!hasFont) return;
    c2d.setFont(canvas, 'Picker', size);
    c2d.fillText(canvas, string, x, y, colour, 1);
  }
  function widthOf(string, size) {
    if (!hasFont) return 0;
    c2d.setFont(canvas, 'Picker', size);
    return c2d.measureText(canvas, string)[0];
  }
  // Shortens a text that would not fit in `width`.
  function fitted(string, size, width) {
    if (!hasFont || widthOf(string, size) <= width) return string;
    while (string.length > 1 && widthOf(string + '...', size) > width) string = string.slice(0, -1);
    return string + '...';
  }
  // A picture filling the rectangle, cut where its shape differs.
  function fill(image, x, y, w, h, alpha) {
    var scale = Math.max(w / image.width, h / image.height), sw = w / scale, sh = h / scale;
    c2d.drawImage(canvas, image.handle, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h, alpha);
  }

  // --- The small pictures on the lines ---
  function plus(cx, cy, colour) {
    line([[cx - 8, cy], [cx + 8, cy]], colour, 2.5);
    line([[cx, cy - 8], [cx, cy + 8]], colour, 2.5);
  }
  function folderSign(x, y, colour) {
    box(x, y + 4, 26, 18, 3, colour);
    box(x, y, 12, 8, 3, colour);
  }
  function fileSign(x, y, colour) {
    line([[x + 4, y], [x + 16, y], [x + 22, y + 6], [x + 22, y + 22], [x + 4, y + 22], [x + 4, y]], colour, 2);
    line([[x + 16, y], [x + 16, y + 6], [x + 22, y + 6]], colour, 2);
  }
  function upSign(x, y, colour) { line([[x + 4, y + 14], [x + 13, y + 5], [x + 22, y + 14]], colour, 2.5); }
  function gameIcon(game, x, y, size, chosen) {
    var mine = artOf(game);
    c2d.save(canvas);
    rounded(x, y, size, size, 9);
    c2d.clip(canvas);
    if (mine.icon) fill(mine.icon, x, y, size, size, 1);
    else c2d.fillRect(canvas, x, y, size, size, chosen ? [1, 1, 1, 0.22] : PANEL_EDGE, 1);
    c2d.restore(canvas);
    c2d.setOperator(canvas, 'source-over');
    if (!mine.icon) {
      var letter = game.title.charAt(0).toUpperCase();
      text(letter, x + (size - widthOf(letter, 22)) / 2, y + size / 2 + 8, 22, INK);
    }
  }
  // A button's letter in a small box, then what the button does. Returns
  // where the next one can start.
  function hint(x, y, button, what) {
    var w = Math.max(22, widthOf(button, 13) + 12);
    box(x, y - 16, w, 22, 6, PANEL_EDGE);
    text(button, x + (w - widthOf(button, 13)) / 2, y, 13, INK);
    text(what, x + w + 8, y, 15, MUTED);
    return x + w + 8 + widthOf(what, 15) + 22;
  }

  // The game whose title picture is behind the list: the chosen one.
  function gameBehind() {
    var chosen = browsing ? null : games[selected];
    return chosen && chosen.www ? chosen : null;
  }
  function paintBackground() {
    c2d.setOperator(canvas, 'source-over');
    var behind = gameBehind(), cover = behind && artOf(behind).cover;
    c2d.fillRect(canvas, 0, 0, W, H, cover ? NIGHT : PLAIN, 1);
    if (cover) {
      fill(cover, 0, 0, W, H, 1);
      c2d.fillRect(canvas, 0, 0, W, H, VEIL, 1);
    }
    c2d.fillRect(canvas, 0, H - 110, W, 110, FLOOR, 1);
  }
  // The button that takes the chosen game off the list, for fingers and the
  // mouse: a cross, in a box that lights up while the list asks to be sure.
  function removeButton(x, y, h, asking) {
    var size = model.REMOVE, left = x + COLUMN - model.REMOVE_GAP - size, top = y + (h - size) / 2;
    box(left, top, size, size, 8, asking ? INK : [1, 1, 1, 0.22]);
    var c = asking ? ACCENT_DEEP : INK, cx = left + size / 2, cy = top + size / 2;
    line([[cx - 7, cy - 7], [cx + 7, cy + 7]], c, 2.5);
    line([[cx + 7, cy - 7], [cx - 7, cy + 7]], c, 2.5);
  }
  function paintGameLine(game, x, y, h, chosen) {
    gameIcon(game, x + 10, y + (h - 44) / 2, 44, chosen);
    var asking = chosen && removing === game.www, button = chosen && touching;
    var room = COLUMN - 86 - (button ? model.REMOVE + model.REMOVE_GAP : 0);
    var under = game.recent && game === games[0] ? 'Played last' : folderName(game.www);
    if (asking) under = touching ? 'Take it off the list? Touch the cross again' : 'Take it off the list? X again: yes, B: no';
    text(fitted(game.title, 21, room), x + 68, y + 26, 21, INK);
    text(fitted(under, 13, room), x + 68, y + 45, 13, asking ? INK : chosen ? [1, 1, 1, 0.78] : MUTED);
    if (button) removeButton(x, y, h, asking);
  }
  function paintListLine(entry, x, y, h, chosen) {
    if (entry.www) return paintGameLine(entry, x, y, h, chosen);
    box(x + 10, y + (h - 44) / 2, 44, 44, 9, chosen ? [1, 1, 1, 0.22] : PANEL_EDGE);
    plus(x + 32, y + h / 2, INK);
    text('Add a game', x + 68, y + 26, 21, INK);
    text(fitted('Look through your folders for it', 13, COLUMN - 86), x + 68, y + 45, 13, chosen ? [1, 1, 1, 0.78] : MUTED);
  }
  function paintBrowseLine(entry, x, y, h, chosen) {
    var colour = chosen ? INK : MUTED, top = y + (h - 24) / 2;
    if (entry.kind === 'game') plus(x + 23, y + h / 2, INK);
    else if (entry.kind === 'file') fileSign(x + 10, top, colour);
    else if (entry.kind === 'folder') folderSign(x + 10, top, colour);
    else upSign(x + 10, top, colour);
    text(fitted(entry.label, 19, COLUMN - 64), x + 50, y + h / 2 + 7, 19, chosen || entry.kind === 'game' ? INK : MUTED);
  }
  function paint() {
    var all = lines(), m = metrics(), VISIBLE = visible(), x = MARGIN;
    paintBackground();
    text('RPG MAKER MV PLAYER', x, 34, 12, MUTED);
    text(browsing ? 'Add a game' : 'Games', x, 72, 32, INK);
    if (browsing) {
      box(x, 86, COLUMN, 50, 10, PANEL);
      text(fitted('Go into the game\'s own folder and choose its .exe (often Game.exe).', 14, COLUMN - 28), x + 14, 107, 14, INK);
      text(fitted('No .exe? Choose index.html, inside the game\'s www folder.', 14, COLUMN - 28), x + 14, 126, 14, MUTED);
      text(fitted(browsing.dir || 'Places', 14, COLUMN), x, 156, 14, MUTED);
      if (!all.length) text('Nothing here.', x + 10, m.top + 28, 18, MUTED);
    } else if (!games.some(function (entry) { return entry.www; })) {
      var words = player.canAddGame
        ? ['No games yet. Choose "Add a game" and point at the game\'s .exe.']
        : ['No games yet. A game is a folder holding its "www" folder, in:'].concat((player.libraryDirs || []).slice(0, 1));
      if (player.needsFileAccess) words.push('Allow "all files access" for this app, then open it again.');
      words.forEach(function (each, i) { text(fitted(each, 15, W - 2 * x), x, m.top + m.row * 2 + 34 + i * 22, 15, MUTED); });
    }
    for (var shown = 0; shown < VISIBLE && first + shown < all.length; shown++) {
      var index = first + shown, y = m.top + shown * m.row, h = m.row - 8, chosen = index === selected;
      box(x, y, COLUMN, h, 12, chosen ? CHOSEN : PANEL);
      (browsing ? paintBrowseLine : paintListLine)(all[index], x, y, h, chosen);
    }
    if (all.length > VISIBLE) {
      // Where the lines shown are among all of them.
      var track = VISIBLE * m.row - 8, piece = Math.max(24, track * VISIBLE / all.length);
      box(x + COLUMN + 8, m.top, 4, track, 2, PANEL);
      box(x + COLUMN + 8, m.top + (track - piece) * first / (all.length - VISIBLE), 4, piece, 2, PANEL_EDGE);
    }
    var at = x;
    if (touching) {
      var how = browsing ? 'Touch a line to open it' : 'Touch a game to choose it, again to play';
      text(how, at, H - 18, 15, MUTED);
      at += widthOf(how, 15) + 22;
    } else {
      at = hint(at, H - 18, 'A', browsing ? 'Open' : 'Choose');
      at = hint(at, H - 18, 'B', browsing ? 'Back' : 'Leave');
      if (gameBehind()) at = hint(at, H - 18, 'X', 'Remove');
    }
    if (note) text(fitted(note, 15, W - at - x), at, H - 18, 15, INK);
  }

  // --- Showing the canvas -------------------------------------------------------
  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
  var program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER,
    'attribute vec2 aPosition; attribute vec2 aCoord; varying vec2 vCoord;' +
    'void main(){ vCoord = aCoord; gl_Position = vec4(aPosition, 0.0, 1.0); }'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER,
    'precision mediump float; varying vec2 vCoord; uniform sampler2D uSampler;' +
    'void main(){ gl_FragColor = texture2D(uSampler, vCoord); }'));
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.bindAttribLocation(program, 1, 'aCoord');
  gl.linkProgram(program);
  gl.useProgram(program);
  var quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  // The canvas's top row is uploaded first, so the top of the quad uses coordinate 0.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  var changed = true;
  // Frames since the choice last moved, for the title picture.
  var rested = 0, restedOn = null;
  function frame() {
    requestAnimationFrame(frame);
    if (newSize) takeNewSize();
    var behind = gameBehind();
    rested = behind === restedOn ? rested + 1 : 0;
    restedOn = behind;
    if (behind && rested === 8 && !artOf(behind).looked) {
      lookForCover(behind);
      changed = true;
    }
    if (changed) {
      changed = false;
      paint();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }
    gl.viewport(0, 0, SCREEN_W, SCREEN_H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // --- Controls -----------------------------------------------------------------
  function move(by) {
    var count = lines().length, VISIBLE = visible();
    if (by) keepGame();
    if (!count) return;
    selected = Math.min(count - 1, Math.max(0, selected + by));
    if (selected < first) first = selected;
    if (selected >= first + VISIBLE) first = selected - VISIBLE + 1;
    changed = true;
  }
  function chooseInBrowser() {
    var line = browsing.rows[selected];
    if (!line) return;
    note = '';
    if (line.kind === 'game' || line.kind === 'file') add(line.path);
    else if (line.kind === 'places') show('');
    else show(line.path);
  }
  function choose() {
    if (browsing) return chooseInBrowser();
    var entry = games[selected];
    note = '';
    if (!entry) return;
    if (entry.add) {
      startBrowsing();
    } else {
      console.info('picker: chose ' + entry.www);
      remember(entry.www);
      leave(0, 'MVPLAYER_GAME=' + entry.www);
    }
  }
  // A finger or the mouse: putting it on a line chooses the line, lifting
  // it there without having moved opens it (a game only if it was already
  // the chosen one: see tapOpens), and moving it up or down moves the list.
  // Positions come in screen pixels.
  var press = null;
  player.onPointer = function (phase, px, py) {
    var x = px / ZOOM, y = py / ZOOM;
    if (!touching) { touching = true; changed = true; }
    if (phase === 0) {
      press = { x: x, y: y, layout: layout(), line: model.lineAt(x, y, layout()), moved: false };
      press.wasChosen = press.line === selected;
      // The cross is drawn on the chosen game only.
      press.remove = press.wasChosen && !!gameBehind() && model.onRemoveButton(x, press.layout);
      if (press.line >= 0 && !press.remove) { selected = press.line; changed = true; }
    } else if (press && phase === 1) {
      if (!model.isTap(press.x, press.y, x, y)) press.moved = true;
      var top = model.dragged(press.layout, y - press.y);
      if (press.moved && top !== first) {
        first = top;
        // The chosen line stays among the ones shown.
        var kept = Math.min(first + visible() - 1, Math.max(first, selected));
        if (kept !== selected) keepGame();
        selected = kept;
        changed = true;
      }
    } else if (press && phase === 2) {
      var tapped = !press.moved && press.line >= 0 && model.lineAt(x, y, layout()) === press.line;
      var remove = tapped && press.remove && model.onRemoveButton(x, layout());
      var opened = tapped && !press.remove && model.tapOpens(lines()[press.line], press.wasChosen);
      press = null;
      if (remove) return askToRemove();
      keepGame();
      if (opened) choose();
    }
  };
  // The window changed size (a desktop's can): the list is laid out again,
  // with the chosen line still among the ones shown.
  // While a window is dragged to a new size the sizes come in a stream:
  // the last one of each frame is the one used (see frame()).
  var newSize = null;
  player.onResize = function (width, height) { newSize = [width, height]; };
  function takeNewSize() {
    var width = newSize[0], height = newSize[1];
    newSize = null;
    if (width < 1 || height < 1 || (width === SCREEN_W && height === SCREEN_H)) return;
    fitTo(width, height);
    press = null;
    move(0);
    first = Math.max(0, Math.min(first, lines().length - visible()));
    changed = true;
  }
  player.onKey = function (keyCode, down) {
    if (!down) return;
    if (touching && keyCode !== 27) { touching = false; changed = true; }
    if (KEY.remove.indexOf(keyCode) >= 0) return askToRemove();
    // While the list asks whether to take a game off, A and B (and a
    // phone's Back) only keep it; the arrows also move.
    if (removing && (KEY.ok.indexOf(keyCode) >= 0 || KEY.back.indexOf(keyCode) >= 0)) return keepGame();
    if (keyCode === KEY.up) move(-1);
    else if (keyCode === KEY.down) move(1);
    else if (keyCode === KEY.pageUp) move(-visible());
    else if (keyCode === KEY.pageDown) move(visible());
    else if (KEY.ok.indexOf(keyCode) >= 0) choose();
    else if (KEY.back.indexOf(keyCode) >= 0) {
      if (browsing) { note = ''; backToList(''); }
      else leave(EXIT_NOTHING_CHOSEN);
    }
  };
  requestAnimationFrame(frame);
})();
