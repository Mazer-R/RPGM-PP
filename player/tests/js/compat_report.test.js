// Tests for js/compat-report.js, run with Node:
//   node tests/js/compat_report.test.js
//
// Before a game starts, the player reads the game's own scripts and notes
// what they ask of a browser, of the desktop player and of Node, so that
// everything the player does not have is known at once, in one place,
// instead of one failure at a time.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function survey(scripts, has) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '..', '..', 'js', 'compat-report.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const answers = Object.assign({ global: () => false, document: () => false, navigator: () => false, module: () => false, element: () => false }, has);
  return JSON.parse(JSON.stringify(sandbox.__compatReport.survey(scripts, answers)));
}
const names = (found) => found.map((item) => item.what);

const tests = {
  'what a script asks of the page, the window and the browser is noted when the player lacks it'() {
    const found = survey([{ file: 'A.js', text: 'document.querySelector("#x"); window.matchMedia("x"); navigator.clipboard.writeText("a"); localStorage.setItem("a", 1);' }]);
    assert.deepStrictEqual(names(found).sort(), ['document.querySelector', 'localStorage', 'navigator.clipboard', 'window.matchMedia']);
  },

  'and is not when the player has it'() {
    const found = survey([{ file: 'A.js', text: 'document.createElement("canvas"); window.innerWidth; fetch("a"); navigator.userAgent;' }],
      { document: (name) => name === 'createElement', global: (name) => name === 'innerWidth' || name === 'fetch', navigator: (name) => name === 'userAgent' });
    assert.deepStrictEqual(found, []);
  },

  'a module the player does not provide is noted; one it provides is not'() {
    const found = survey([{ file: 'Steam.js', text: "var gw = require('./greenworks'); var fs = require('fs'); const os = require(\"os\");" }],
      { module: (name) => name === 'fs' });
    assert.deepStrictEqual(names(found).sort(), ["require('./greenworks')", "require('os')"]);
  },

  'a class the game makes itself is the game\'s own, whichever file defines it'() {
    const found = survey([
      { file: 'Core.js', text: 'function Sprite_Extra() {} class Window_Extra {} var Helper = function () {};' },
      { file: 'Use.js', text: 'new Sprite_Extra(); new Window_Extra(); new Helper(); new WebSocket("ws://x"); new Sprite(); new Date();' },
    ], { global: (name) => name === 'Sprite' || name === 'Date' });
    assert.deepStrictEqual(names(found), ['new WebSocket']);
  },

  'what a script asks of an element or a canvas is noted when no element has it'() {
    const found = survey([{ file: 'A.js', text: 'el.getBoundingClientRect(); canvas.toDataURL(); ctx.drawImage(a, 0, 0);' }], { element: (name) => name === 'drawImage' });
    assert.deepStrictEqual(names(found).sort(), ['.getBoundingClientRect', '.toDataURL']);
  },

  'each thing is listed once, with every file that names it, the most named first'() {
    const found = survey([
      { file: 'A.js', text: 'document.querySelector("a"); document.querySelector("b"); alert("x");' },
      { file: 'B.js', text: 'document.querySelector("c");' },
    ]);
    assert.deepStrictEqual(found, [{ what: 'document.querySelector', files: ['A.js', 'B.js'] }, { what: 'alert', files: ['A.js'] }]);
  },

  'a script that names nothing of the sort gives an empty list'() {
    assert.deepStrictEqual(survey([{ file: 'A.js', text: 'var a = 1 + 2; $gameParty.gainGold(3);' }]), []);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try {
    test();
    console.log('ok   ' + name);
  } catch (error) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     '));
  }
}
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
