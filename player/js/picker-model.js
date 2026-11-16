// What the game list (picker.js) decides without drawing anything: the
// order of the games, and what the "add a game" browser shows for a folder.
// Kept apart so that it can be tested without the player.
(function () {
  'use strict';

  // found:  [{ title, www }], every game known, in any order.
  // recent: www folders, the one played or added last first.
  // Returns the games played before first, in that order, each marked
  // `recent`, then the others by title; a game found twice appears once.
  function order(found, recent) {
    var byWww = {}, rest = [];
    found.forEach(function (game) {
      game.recent = false;  // decided afresh on every call
      if (!byWww[game.www]) { byWww[game.www] = game; rest.push(game); }
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

  globalThis.__pickerModel = { order: order, browse: browse, places: places };
})();
