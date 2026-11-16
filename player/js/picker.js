// The game list. The native player runs this file when it is given --pick.
//
// It shows two kinds of games as one list: those found in the folders in
// player.libraryDirs (a game is a folder that holds the game's own www
// folder, the one with index.html), and those named one by one in
// player.libraryGames. The user chooses with the controls. The choice is
// printed as "MVPLAYER_GAME=<www folder>" for the program that started the
// player, which then runs the player again with --game. When
// player.canAddGame is set the list ends with an "add a game" line, which
// prints "MVPLAYER_ADD" instead. Leaving without choosing exits with code 10.
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
  var W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
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
  var games = [];
  (player.libraryDirs || []).forEach(function (dir) {
    player.listDir(dir).forEach(function (name) {
      var www = dir + '/' + name + '/www';
      if (player.fileExists(www + '/index.html')) games.push({ title: titleOf(www, name), www: www });
    });
  });
  (player.libraryGames || []).forEach(function (www) {
    var known = games.some(function (game) { return game.www === www; });
    // Named after the folder that holds www when the page has no title.
    if (!known && player.fileExists(www + '/index.html')) games.push({ title: titleOf(www, www.split('/').slice(-2, -1)[0] || www), www: www });
  });
  games.sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; });
  // The last line of the list, where the program that started the player
  // can take over to let the user point at a new game.
  if (player.canAddGame) games.push({ title: '+ Add a game...', add: true });
  var showFps = !!player.showFps;
  var fpsLine = { setting: true };
  function nameFpsLine() { fpsLine.title = 'Show frames per second: ' + (showFps ? 'yes' : 'no'); }
  nameFpsLine();
  games.push(fpsLine);
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
  var SYSTEM_FONTS = ['/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'];
  var fontFiles = games.filter(function (game) { return game.www; })
    .map(function (game) { return game.www + '/fonts/mplus-1m-regular.ttf'; }).concat(SYSTEM_FONTS);
  var hasFont = fontFiles.some(function (file) { return player.fileExists(file) && c2d.registerFont('Picker', file); });

  // --- Drawing ----------------------------------------------------------------
  var canvas = c2d.create(W, H);
  var ROW = 44, TOP = 96, VISIBLE = Math.max(1, Math.floor((H - TOP - 56) / ROW));
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
    text('RPG Maker MV games', 32, 56, 30, WHITE);
    if (!games.some(function (line) { return line.www; })) {
      text('No games yet. A game is a folder holding its "www" folder, in:', 32, H - 120, 16, GREY);
      (player.libraryDirs || []).forEach(function (dir, i) { text(fitted(dir, 16, W - 64), 32, H - 96 + i * 22, 16, GREY); });
    }
    for (var row = 0; row < VISIBLE && first + row < games.length; row++) {
      var index = first + row, y = TOP + row * ROW;
      if (index === selected) c2d.fillRect(canvas, 20, y, W - 40, ROW - 6, BAR, 1);
      text(fitted(games[index].title, 24, W - 80), 36, y + 28, 24, index === selected ? WHITE : GREY);
    }
    if (games.length > VISIBLE) text((selected + 1) + ' / ' + games.length, W - 110, 56, 18, GREY);
    text('A: choose     B: leave', 32, H - 24, 18, GREY);
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
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // --- Controls -----------------------------------------------------------------
  function move(by) {
    if (!games.length) return;
    selected = Math.min(games.length - 1, Math.max(0, selected + by));
    if (selected < first) first = selected;
    if (selected >= first + VISIBLE) first = selected - VISIBLE + 1;
    changed = true;
  }
  player.onKey = function (keyCode, down) {
    if (!down) return;
    if (keyCode === KEY.up) move(-1);
    else if (keyCode === KEY.down) move(1);
    else if (keyCode === KEY.pageUp) move(-VISIBLE);
    else if (keyCode === KEY.pageDown) move(VISIBLE);
    else if (KEY.ok.indexOf(keyCode) >= 0) {
      var line = games[selected];
      if (line.setting) {
        showFps = !showFps;
        nameFpsLine();
        changed = true;
      } else if (line.add) {
        leave(0, 'MVPLAYER_ADD');
      } else {
        console.info('picker: chose ' + line.www);
        leave(0, 'MVPLAYER_GAME=' + line.www);
      }
    } else if (KEY.back.indexOf(keyCode) >= 0) {
      leave(EXIT_NOTHING_CHOSEN);
    }
  };
  requestAnimationFrame(frame);
})();
