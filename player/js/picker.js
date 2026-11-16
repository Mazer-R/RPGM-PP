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
// When player.canAddGame is set the list has an "add a game" line. It opens
// a second screen that shows folders, starting from player.browseDirs, and
// says what to look for: the game's own folder, and in it the game's .exe.
// Choosing that file (or index.html, or the line offered when the folder
// shown is itself a game) remembers the game and goes back to the list,
// with the game chosen. What each screen shows is decided in
// picker-model.js.
//
// The list's last line is a setting: whether games show the frames per
// second. It starts as the player was started (--fps) and, however the list
// is left, its state is printed as "MVPLAYER_FPS=1" or "MVPLAYER_FPS=0", so
// the program that started the player can pass it on and remember it.
//
// The list is drawn on a native canvas and shown through WebGL; none of the
// browser stand-in layers are loaded for it.
(function () {
  'use strict';
  var gl = player.gl, c2d = player.canvas;
  // The list is laid out for a screen about 480 pixels high and shown
  // enlarged by a whole factor on denser screens (a phone), so the text
  // stays readable.
  var SCREEN_W = gl.drawingBufferWidth, SCREEN_H = gl.drawingBufferHeight;
  var ZOOM = Math.max(1, Math.floor(SCREEN_H / 480));
  var W = Math.round(SCREEN_W / ZOOM), H = Math.round(SCREEN_H / ZOOM);
  var KEY = { up: 38, down: 40, pageUp: 33, pageDown: 34, ok: [90, 13, 32], back: [88, 27] };
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
  function folderName(www) { return www.split('/').slice(-2, -1)[0] || www; }
  var found = [], recent = (player.libraryGames || []).slice();
  (player.libraryDirs || []).forEach(function (dir) {
    player.listDir(dir).forEach(function (name) {
      var www = dir + '/' + name + '/www';
      if (player.fileExists(www + '/index.html')) found.push({ title: titleOf(www, name), www: www });
    });
  });
  // Named after the folder that holds www when the page has no title.
  recent.forEach(function (www) {
    if (player.fileExists(www + '/index.html')) found.push({ title: titleOf(www, folderName(www)), www: www });
  });
  var showFps = !!player.showFps;
  var fpsLine = { setting: true };
  function nameFpsLine() { fpsLine.title = 'Show frames per second: ' + (showFps ? 'yes' : 'no'); }
  nameFpsLine();
  // The lines of the list: the games, then adding one, then the setting.
  var games = [];
  function listGames() {
    games = model.order(found, recent);
    if (player.canAddGame) games.push({ title: '+ Add a game...', add: true });
    games.push(fpsLine);
  }
  listGames();
  // Puts a game on top of the remembered ones, here and in the file.
  function remember(www) {
    recent = [www].concat(recent.filter(function (other) { return other !== www; }));
    if (player.rememberGame) player.rememberGame(www);
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
  function labelOf(line) { return browsing ? line.label : line.title; }
  // Leaves the list, always saying how the setting stands.
  function leave(code, answer) {
    player.print('MVPLAYER_FPS=' + (showFps ? 1 : 0));
    if (answer) player.print(answer);
    player.exit(code);
  }
  console.info('picker: ' + games.length + ' lines; folders: ' + (player.libraryDirs || []).join(', '));

  // --- A font ---------------------------------------------------------------
  // The player ships no font of its own. Every RPG Maker MV game carries
  // this one, so the first game that has it lends it to the list. With no
  // game yet, a desktop system's own font is used.
  var SYSTEM_FONTS = ['/system/fonts/Roboto-Regular.ttf', '/system/fonts/NotoSans-Regular.ttf',
    '/system/fonts/DroidSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'];
  var fontFiles = found
    .map(function (game) { return game.www + '/fonts/mplus-1m-regular.ttf'; }).concat(SYSTEM_FONTS);
  var hasFont = fontFiles.some(function (file) { return player.fileExists(file) && c2d.registerFont('Picker', file); });

  // --- Drawing ----------------------------------------------------------------
  var canvas = c2d.create(W, H);
  // The browser's two lines of explanation take the place of one row.
  var ROW = 44, LIST_TOP = 96, BROWSE_TOP = 140;
  function top() { return browsing ? BROWSE_TOP : LIST_TOP; }
  function visible() { return Math.max(1, Math.floor((H - top() - 56) / ROW)); }
  var selected = 0, first = 0;
  var WHITE = [1, 1, 1, 1], GREY = [0.62, 0.62, 0.66, 1], DARK = [0.07, 0.07, 0.09, 1], BAR = [0.55, 0.16, 0.16, 1];

  function text(string, x, y, size, colour) {
    if (!hasFont) return;
    c2d.setFont(canvas, 'Picker', size);
    c2d.fillText(canvas, string, x, y, colour, 1);
  }
  // Shortens a title that would not fit in `width`.
  function fitted(string, size, width) {
    if (!hasFont) return string;
    c2d.setFont(canvas, 'Picker', size);
    if (c2d.measureText(canvas, string)[0] <= width) return string;
    while (string.length > 1 && c2d.measureText(canvas, string + '...')[0] > width) string = string.slice(0, -1);
    return string + '...';
  }
  function paint() {
    c2d.setOperator(canvas, 'source-over');
    c2d.fillRect(canvas, 0, 0, W, H, DARK, 1);
    var all = lines(), TOP = top(), VISIBLE = visible();
    if (browsing) {
      text('Add a game', 32, 56, 30, WHITE);
      text(fitted('Go into the game\'s own folder and choose its .exe (often Game.exe).', 16, W - 64), 32, 84, 16, GREY);
      text(fitted('No .exe? Choose index.html, inside the game\'s www folder.', 16, W - 64), 32, 106, 16, GREY);
      text(fitted(browsing.dir || 'Places', 16, W - 64), 32, 128, 16, WHITE);
      if (!all.length) text('Nothing here.', 36, TOP + 28, 20, GREY);
    } else {
      text('RPG Maker MV games', 32, 56, 30, WHITE);
      if (games.some(function (line) { return line.recent; })) text('Played last, first', 32, 80, 16, GREY);
      if (!games.some(function (line) { return line.www; })) {
        // Shown in the middle, clear of the touch controls in the corners.
        var hint = player.canAddGame
          ? ['No games yet. Choose "+ Add a game..." and point at the game\'s .exe.']
          : ['No games yet. A game is a folder holding its "www" folder, in:'].concat((player.libraryDirs || []).slice(0, 1));
        if (player.needsFileAccess) hint.push('Allow "all files access" for this app, then open it again.');
        hint.forEach(function (line, i) { text(fitted(line, 16, W - 64), 32, TOP + ROW * 3 + i * 22, 16, GREY); });
      }
    }
    for (var row = 0; row < VISIBLE && first + row < all.length; row++) {
      var index = first + row, y = TOP + row * ROW;
      if (index === selected) c2d.fillRect(canvas, 20, y, W - 40, ROW - 6, BAR, 1);
      text(fitted(labelOf(all[index]), 24, W - 80), 36, y + 28, 24, index === selected ? WHITE : GREY);
    }
    if (all.length > VISIBLE) text((selected + 1) + ' / ' + all.length, W - 110, 56, 18, GREY);
    if (note) text(fitted(note, 16, W - 300), 280, H - 24, 16, WHITE);
    text(browsing ? 'A: choose     B: back' : 'A: choose     B: leave', 32, H - 24, 18, GREY);
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
  function frame() {
    requestAnimationFrame(frame);
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
  player.onKey = function (keyCode, down) {
    if (!down) return;
    if (keyCode === KEY.up) move(-1);
    else if (keyCode === KEY.down) move(1);
    else if (keyCode === KEY.pageUp) move(-visible());
    else if (keyCode === KEY.pageDown) move(visible());
    else if (KEY.ok.indexOf(keyCode) >= 0) {
      if (browsing) return chooseInBrowser();
      var line = games[selected];
      note = '';
      if (line.setting) {
        showFps = !showFps;
        nameFpsLine();
        changed = true;
      } else if (line.add) {
        startBrowsing();
      } else {
        console.info('picker: chose ' + line.www);
        remember(line.www);
        leave(0, 'MVPLAYER_GAME=' + line.www);
      }
    } else if (KEY.back.indexOf(keyCode) >= 0) {
      if (browsing) { note = ''; backToList(''); }
      else leave(EXIT_NOTHING_CHOSEN);
    }
  };
  requestAnimationFrame(frame);
})();
