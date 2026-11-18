// Tests for js/pointer.js, run with Node:
//   node tests/js/pointer.test.js
//
// A finger on the screen outside the player's own controls, or the mouse on
// a desktop, reaches the game as the mouse events a page receives. Both
// engines listen for them on the document: a press moves the character to
// that place or chooses what is under it, and the right button cancels.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function page() {
  const seen = [];
  function Event(type, init) { this.type = type; Object.assign(this, init); }
  Event.prototype.preventDefault = function () {};
  const canvas = { tagName: 'CANVAS', width: 816, height: 624, offsetLeft: 0, offsetTop: 0, style: {} };
  const sandbox = {
    Event,
    player: {},
    console: { error: (text) => seen.push('error ' + text) },
    document: { body: { tagName: 'BODY' }, dispatchEvent: (e) => seen.push(['document', e.type, e.button, e.pageX, e.pageY, e.target.tagName].join(' ')) },
    dispatchEvent: (e) => seen.push(['window', e.type].join(' ')),
    __browser: { screenCanvas: () => canvas },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'js', 'pointer.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return { player: sandbox.player, seen, sandbox, canvas };
}
const toDocument = (seen) => seen.filter((line) => line.indexOf('document') === 0);

const tests = {
  'a press, a move and a lift become the left button\'s mouse events on the document'() {
    const p = page();
    p.player.onPointer(0, 100, 51);
    p.player.onPointer(1, 120, 60);
    p.player.onPointer(2, 120, 60);
    assert.deepStrictEqual(toDocument(p.seen), [
      'document mousedown 0 100 51 CANVAS',
      'document mousemove 0 120 60 CANVAS',
      'document mouseup 0 120 60 CANVAS',
    ]);
  },

  'the window gets them too, as a real event reaches both'() {
    const p = page();
    p.player.onPointer(0, 1, 1);
    assert.ok(p.seen.includes('window mousedown'));
  },

  'the mouse moving with no button down is a move, for the engine that follows it'() {
    const p = page();
    p.player.onPointer(3, 10, 20);
    assert.deepStrictEqual(toDocument(p.seen), ['document mousemove 0 10 20 CANVAS']);
  },

  'the events carry what the engines read: page and client positions, and no touches'() {
    const p = page();
    let event = null;
    p.sandbox.document.dispatchEvent = (e) => { event = e; };
    p.player.onPointer(0, 30, 40);
    assert.deepStrictEqual([event.pageX, event.pageY, event.clientX, event.clientY, event.button, event.buttons], [30, 40, 30, 40, 0, 1]);
    p.player.onPointer(2, 30, 40);
    assert.strictEqual(event.buttons, 0);
  },

  'the place is the one the engine turns back into the touched place, however it believes its canvas is shown'() {
    // The engine set its canvas to be shown smaller than it is, and 16 page
    // pixels in: it will take (pageX - offsetLeft) / scale as the place.
    const p = page();
    Object.assign(p.canvas, { offsetLeft: 16, offsetTop: 12, style: { width: '784.5px', height: '600px' } });
    let event = null;
    p.sandbox.document.dispatchEvent = (e) => { event = e; };
    p.player.onPointer(0, 200, 150);
    const scale = 600 / 624;
    assert.strictEqual(Math.round((event.pageX - 16) / (784.5 / 816)), 200);
    assert.strictEqual(Math.round((event.pageY - 12) / scale), 150);
  },

  'before the game has a canvas, the page itself is the target'() {
    const p = page();
    p.sandbox.__browser.screenCanvas = () => null;
    p.player.onPointer(0, 1, 2);
    assert.deepStrictEqual(toDocument(p.seen), ['document mousedown 0 1 2 BODY']);
  },

  'the events are mouse events, a kind of event, for the libraries that ask'() {
    const p = page();
    let event = null;
    p.sandbox.document.dispatchEvent = (e) => { event = e; };
    p.player.onPointer(0, 1, 2);
    assert.ok(event instanceof p.sandbox.MouseEvent);
    assert.ok(event instanceof p.sandbox.Event);
    assert.strictEqual(event.type, 'mousedown');
  },

  'a listener on the document that fails does not keep the event from the window'() {
    const p = page();
    p.sandbox.document.dispatchEvent = () => { throw new Error('boom'); };
    p.player.onPointer(0, 1, 2);
    assert.ok(p.seen.includes('window mousedown'), p.seen.join(' | '));
  },

  'a listener that fails does not stop the player'() {
    const p = page();
    p.sandbox.document.dispatchEvent = () => { throw new Error('boom'); };
    p.player.onPointer(0, 1, 2);
    assert.ok(p.seen.some((line) => /error .*boom/.test(line)), p.seen.join(' | '));
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log('ok   ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + String(error && error.message).split('\n').join('\n     '));
  }
}
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
