// Tests for js/profile-model.js, run with Node:
//   node tests/js/profile_model.test.js
//
// The player appends one line to a log each time a game ends (see
// platform/session.h). The game list reads the lines it has not seen yet and
// folds them into the counts the achievements are decided from. The module
// also reads and writes the profile file, which holds those counts.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const file = path.join(__dirname, '..', '..', 'js', 'profile-model.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const model = sandbox.__profile;
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 86400;
// 2026-11-18 20:00 local, as the native side writes it.
const line = (over) => {
  const fields = Object.assign({ day: 20261118, hour: 20, start: 1795032000, seconds: 600, frames: 36000, code: 0 }, over);
  const game = fields.game === undefined ? '/games/My Game/www' : fields.game;
  delete fields.game;
  return Object.entries(fields).map(([key, value]) => key + '=' + value).join(' ') + ' game=' + game;
};
const after = (...lines) => model.catchUp(model.blank(), lines).stats;

const tests = {
  'a line is read into its fields; the game is the rest of the line, spaces and all'() {
    const session = model.parse(line({ saves: 3, mz: 1 }));
    assert.strictEqual(session.seconds, 600);
    assert.strictEqual(session.saves, 3);
    assert.strictEqual(session.mz, 1);
    assert.strictEqual(session.game, '/games/My Game/www');
  },

  'a line that is not a session is no session'() {
    assert.strictEqual(model.parse(''), null);
    assert.strictEqual(model.parse('garbage'), null);
    assert.strictEqual(model.parse('seconds=abc game=/x'), null);
  },

  'time adds up over sessions, in all and per game, and the longest one is kept'() {
    const stats = after(line({ seconds: 600 }), line({ seconds: 4000, game: '/games/Other/www' }), line({ seconds: 900 }));
    assert.strictEqual(stats.seconds, 5500);
    assert.strictEqual(stats.longestSession, 4000);
    assert.strictEqual(stats.mostInOneGame, 4000);
    assert.strictEqual(after(line({ seconds: 3000 }), line({ seconds: 3000 })).mostInOneGame, 6000);
  },

  'days are counted once each'() {
    const stats = after(line({ day: 20261118 }), line({ day: 20261118 }), line({ day: 20261119 }));
    assert.strictEqual(stats.days, 2);
  },

  'a session of under a minute is a short one'() {
    assert.strictEqual(!!after(line({ seconds: 59 })).shortSession, true);
    assert.strictEqual(!!after(line({ seconds: 60 })).shortSession, false);
  },

  'a slow session is one of over twenty minutes under 20 frames per second'() {
    // 19 frames per second over twenty-five minutes
    assert.strictEqual(!!after(line({ seconds: 1500, frames: 28500 })).slowSession, true);
    assert.strictEqual(!!after(line({ seconds: 1500, frames: 30000 })).slowSession, false);
    // twenty minutes exactly is not over twenty
    assert.strictEqual(!!after(line({ seconds: 1200, frames: 22800 })).slowSession, false);
    assert.strictEqual(!!after(line({ seconds: 1201, frames: 22800 })).slowSession, true);
    // ten slow minutes are someone looking at a menu, not a game played like that
    assert.strictEqual(!!after(line({ seconds: 600, frames: 11400 })).slowSession, false);
  },

  'the small hours are from 2 up to 5'() {
    assert.strictEqual(!!after(line({ hour: 1 })).nightSession, false);
    assert.strictEqual(!!after(line({ hour: 2 })).nightSession, true);
    assert.strictEqual(!!after(line({ hour: 4 })).nightSession, true);
    assert.strictEqual(!!after(line({ hour: 5 })).nightSession, false);
  },

  'coming back is playing again thirty days after the last time'() {
    const start = 1795032000;
    assert.strictEqual(!!after(line({ start }), line({ start: start + 29 * DAY })).cameBack, false);
    assert.strictEqual(!!after(line({ start }), line({ start: start + 30 * DAY })).cameBack, true);
    assert.strictEqual(!!after(line({ start })).cameBack, false);
  },

  'what the session notes becomes counts and flags'() {
    const stats = after(line({ saves: 2, mv: 1, video: 1, settings: 1 }), line({ saves: 3, quick: 1, mz: 1, older: 1, counter: 1,
      remap: 1, pointer: 1, controlsoff: 1, lacked: 1 }));
    assert.strictEqual(stats.saves, 5);
    for (const key of ['playedMv', 'playedMz', 'videoSeen', 'settingsOpened', 'quickSaves', 'loadedOlderSave', 'counterShown',
      'remapped', 'pointerUsed', 'controlsOff', 'carriedOn']) assert.strictEqual(stats[key], true, key);
    assert.strictEqual(!!stats.crashed, false);
  },

  'a game that ends with an error code has crashed'() {
    assert.strictEqual(after(line({ code: 2 })).crashed, true);
  },

  'lines already folded are not folded again, and junk lines are passed over'() {
    const lines = [line({ seconds: 100 }), 'junk', line({ seconds: 200 })];
    const first = model.catchUp(model.blank(), lines);
    assert.strictEqual(first.stats.seconds, 300);
    assert.strictEqual(first.sessionsRead, 3);
    const second = model.catchUp(first, lines.concat([line({ seconds: 50 })]));
    assert.strictEqual(second.stats.seconds, 350);
    assert.strictEqual(second.sessionsRead, 4);
  },

  'a log that is shorter than what was read is a new log, read from its start'() {
    const first = model.catchUp(model.blank(), [line({ seconds: 100 }), line({ seconds: 100 })]);
    assert.strictEqual(model.catchUp(first, [line({ seconds: 7 })]).stats.seconds, 207);
  },

  'the profile is written as text and read back the same'() {
    const profile = model.catchUp(model.blank(), [line({ saves: 1 })]);
    profile.name = 'Manel'; profile.earned = ['dear-diary'];
    assert.deepStrictEqual(plain(model.read(model.write(profile))), plain(profile));
  },

  'a profile that cannot be read, or is of a later kind, is a blank one'() {
    assert.deepStrictEqual(plain(model.read('')), plain(model.blank()));
    assert.deepStrictEqual(plain(model.read('{ not json')), plain(model.blank()));
    assert.deepStrictEqual(plain(model.read('[1,2]')), plain(model.blank()));
    assert.deepStrictEqual(plain(model.read(null)), plain(model.blank()));
  },

  'a profile from an earlier version gets the fields it lacks'() {
    const read = model.read(JSON.stringify({ stats: { seconds: 5 }, earned: ['warm-up'] }));
    assert.strictEqual(read.stats.seconds, 5);
    assert.strictEqual(read.sessionsRead, 0);
    assert.deepStrictEqual(plain(read.earned), ['warm-up']);
    assert.strictEqual(read.name, '');
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n').join('\n     ')); }
}
process.exit(failed ? 1 : 0);
