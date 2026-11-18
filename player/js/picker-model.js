// What the game list (picker.js) decides without drawing anything: the
// order of the games, and what the "add a game" browser shows for a folder.
// Kept apart so that it can be tested without the player.
(function () {
  'use strict';

  // found:     [{ title, www }], every game known, in any order.
  // recent:    www folders, the one played or added last first.
  // forgotten: www folders of games taken off the list (may be left out).
  // Returns the games played before first, in that order, each marked
  // `recent`, then the others by title; a game found twice appears once,
  // a game taken off not at all.
  function order(found, recent, forgotten) {
    var byWww = {}, rest = [], off = {};
    (forgotten || []).forEach(function (www) { off[www] = true; });
    found.forEach(function (game) {
      game.recent = false;  // decided afresh on every call
      if (!byWww[game.www] && !off[game.www]) { byWww[game.www] = game; rest.push(game); }
    });
    var first = [];
    recent.forEach(function (www) {
      var game = byWww[www];
      if (!game || game.recent) return;
      game.recent = true;
      first.push(game);
    });
    rest = rest.filter(function (game) { return !game.recent; });
    rest.sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; });
    return first.concat(rest);
  }

  // A file that can stand for a game: choosing it adds the game it belongs
  // to. A Windows game has its .exe next to its www folder; index.html is
  // inside www; package.json is next to www or inside it.
  function standsForGame(name) {
    return /\.exe$/i.test(name) || /^index\.html$/i.test(name) || /^package\.json$/i.test(name);
  }
  function parentOf(dir) {
    var slash = dir.lastIndexOf('/');
    return slash <= 0 ? '/' : dir.slice(0, slash);
  }
  function join(dir, name) { return (dir === '/' ? '' : dir) + '/' + name; }

  // The lines for folder `dir`. names: what the folder holds, folders
  // ending in "/". game: { title, www } when the folder itself is a game's
  // folder, else null. roots: the folders the browser may start from.
  // Each line is { kind, label, path }; kinds: 'game' (add the game at
  // path), 'up' and 'folder' (show path), 'places' (show the roots), 'file'
  // (add the game the file at path belongs to).
  function browse(dir, names, game, roots) {
    var rows = [];
    if (game) rows.push({ kind: 'game', label: 'Add this game: ' + game.title, path: game.www });
    if (roots.indexOf(dir) < 0) rows.push({ kind: 'up', label: '.. (up one folder)', path: parentOf(dir) });
    else if (roots.length > 1) rows.push({ kind: 'places', label: '.. (other places)', path: '' });
    names.forEach(function (name) {
      if (name.slice(-1) === '/') rows.push({ kind: 'folder', label: name, path: join(dir, name.slice(0, -1)) });
      else if (standsForGame(name)) rows.push({ kind: 'file', label: name, path: join(dir, name) });
    });
    return rows;
  }

  // The lines that offer the folders the browser may start from.
  function places(roots) {
    return roots.map(function (root) { return { kind: 'folder', label: root, path: root }; });
  }

  // --- Fingers and the mouse ------------------------------------------------
  // layout: { top, row, first, count, visible, left, width }: where the
  // lines are drawn (from `top` down, each `row` high, between `left` and
  // `left + width`), which line is on top, how many there are and how many
  // fit.
  // The line under the point x, y, or -1.
  function lineAt(x, y, layout) {
    if (x < layout.left || x >= layout.left + layout.width || y < layout.top) return -1;
    var shown = Math.floor((y - layout.top) / layout.row);
    var line = layout.first + shown;
    return shown < layout.visible && line < layout.count ? line : -1;
  }
  // The line on top after the finger has moved `pixels` down (negative: up)
  // since it was put down, when `layout.first` was on top.
  function dragged(layout, pixels) {
    var last = Math.max(0, layout.count - layout.visible);
    return Math.min(last, Math.max(0, layout.first - Math.round(pixels / layout.row)));
  }
  // Whether the point x is on the button at the right end of a line, the
  // one that takes the chosen game off the list. REMOVE is its size; it
  // sits REMOVE_GAP from the line's end, and the finger may miss it by as
  // much again.
  var REMOVE = 36, REMOVE_GAP = 10;
  function onRemoveButton(x, layout) {
    var lineEnd = layout.left + layout.width - 8;
    return x >= lineEnd - REMOVE_GAP - REMOVE - REMOVE_GAP && x < lineEnd;
  }
  var TAP_SLACK = 12;
  function isTap(x0, y0, x1, y1) { return Math.abs(x1 - x0) <= TAP_SLACK && Math.abs(y1 - y0) <= TAP_SLACK; }

  // Whether lifting a finger from a line opens it. A game in the list (a line
  // with a www folder) opens only when it was already the chosen one: the
  // first touch chooses it, which puts its title picture behind the list.
  function tapOpens(entry, wasChosen) { return !entry.www || wasChosen; }

  // How the list is laid out in a window of this many pixels. It is drawn
  // for a screen about 480 high and shown enlarged by a whole factor (zoom)
  // on denser ones, so the text stays readable; width and height are the
  // size it is drawn at. The lines are in a column on the left, at least
  // 520 wide where there is room, half the width on a wide screen.
  var MARGIN = 28;
  function fit(screenWidth, screenHeight) {
    var zoom = Math.max(1, Math.floor(screenHeight / 480));
    var width = Math.round(screenWidth / zoom), height = Math.round(screenHeight / zoom);
    return { zoom: zoom, width: width, height: height, column: Math.min(width - 2 * MARGIN, Math.max(520, Math.round(width * 0.5))) };
  }

  // The game in the folder `name` of a games folder, or null: an MV game is
  // the www folder inside it, an MZ game is the folder itself, with the
  // engine's script next to its page. fileExists(path) says what is there.
  function gameIn(dir, name, fileExists) {
    var folder = dir + '/' + name;
    if (fileExists(folder + '/www/index.html')) return folder + '/www';
    if (fileExists(folder + '/index.html') && fileExists(folder + '/js/rmmz_core.js')) return folder;
    return null;
  }

  // The name of a game's own folder: for an MV game the one that holds www.
  function folderOf(game) {
    var parts = game.split('/');
    if (parts[parts.length - 1] === 'www') parts.pop();
    return parts[parts.length - 1] || game;
  }

  globalThis.__pickerModel = { gameIn: gameIn, folderOf: folderOf, order: order, browse: browse, places: places, lineAt: lineAt, dragged: dragged, onRemoveButton: onRemoveButton, REMOVE: REMOVE, REMOVE_GAP: REMOVE_GAP, isTap: isTap, tapOpens: tapOpens, fit: fit, MARGIN: MARGIN };
})();
