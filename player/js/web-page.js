// The elements a page declares itself.
//
// One of the browser pieces a game's profile can switch on (engine-select.js).
// It knows nothing of the game's engine.
//
// The player reads a game's index.html for its scripts only; there is no
// page layout. But a script may look for an element the page declared, by
// its id: one game keeps a <canvas id="refresher"> in its page and clears it
// every second. Every element the page gives an id is made here and put in
// the body, so that document.getElementById finds it. Scripts are left to
// the loader, and the element's other attributes and its place in the page
// mean nothing here.
(function () {
  'use strict';
  var html = player.readTextFile(player.gameDir + '/index.html');
  if (!html) return;
  var tags = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\bid\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/g;
  var match;
  while ((match = tags.exec(html))) {
    var tag = match[1].toLowerCase(), id = match[2] || match[3];
    if (!id || tag === 'script') continue;
    var element = document.createElement(tag);
    element.id = id;
    document.body.appendChild(element);
  }
})();
