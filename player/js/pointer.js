// A finger or the mouse on the game's picture, as the mouse events a page
// receives. The native player calls player.onPointer(phase, x, y) with the
// place in the picture's own pixels: phase 0 = pressed, 1 = moved while
// pressed, 2 = let go, 3 = the mouse moved with no button down.
//
// An engine works a place in its picture out of a place on the page, from
// where its canvas is on the page and how large it is shown there, which it
// set itself through the canvas's style. The player shows the picture its
// own way whatever that style says, so the event carries the place on the
// page that the engine will turn back into the place that was touched.
//
// Both engines take a press as "go there" on a map and as a choice on a
// menu, and listen on the document. A finger is told as the mouse's left
// button: the engines treat the two alike, and one finger is followed.
(function () {
  'use strict';
  var browser = globalThis.__browser;
  var TYPES = ['mousedown', 'mousemove', 'mouseup', 'mousemove'];

  // Libraries tell a mouse event from a touch by its kind (PIXI does, and
  // fails on an event that is neither).
  function MouseEvent(type, init) { Event.call(this, type, init); }
  MouseEvent.prototype = Object.create(Event.prototype);
  MouseEvent.prototype.constructor = MouseEvent;
  if (!globalThis.MouseEvent) globalThis.MouseEvent = MouseEvent;

  // How many page pixels one of the canvas's own pixels takes, along `side`.
  function shown(canvas, side) {
    var styled = canvas.style ? parseFloat(canvas.style[side]) : NaN;
    return styled > 0 && canvas[side] > 0 ? styled / canvas[side] : 1;
  }

  player.onPointer = function (phase, x, y) {
    var type = TYPES[phase];
    if (!type) return;
    var canvas = browser.screenCanvas && browser.screenCanvas();
    if (canvas) {
      x = (canvas.offsetLeft || 0) + x * shown(canvas, 'width');
      y = (canvas.offsetTop || 0) + y * shown(canvas, 'height');
    }
    var event = new globalThis.MouseEvent(type, {
      button: 0, buttons: phase === 0 || phase === 1 ? 1 : 0,
      pageX: x, pageY: y, clientX: x, clientY: y, screenX: x, screenY: y,
      target: canvas || document.body,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    });
    // Listeners are on the document or on the window; a real event reaches
    // both, and one that fails does not keep it from the other.
    [document, globalThis].forEach(function (target) {
      try {
        target.dispatchEvent(event);
      } catch (error) {
        console.error('pointer event: ' + (error && (error.stack || error.message) || error));
      }
    });
  };
})();
