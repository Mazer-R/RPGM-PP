// The player's profile on this device: the counts the achievements are
// decided from, the achievements earned, a name and an avatar. Loaded by
// the game list; tested on its own (tests/js/profile_model.test.js). It
// reads and writes no file itself: it turns text into a profile and back.
//
// The counts come from two places. What happens while a game runs is noted
// by the native side, which appends one line to a log when the game ends
// (platform/session.h):
//   day=20261118 hour=20 start=1795032000 seconds=600 frames=36000 code=0 saves=2 mz=1 game=/games/My Game/www
// `game` is the rest of the line. The list folds the lines it has not seen
// into the counts. What happens in the list itself (games on it, a game
// taken off) the list sets directly.
(function () {
  'use strict';
  var AWAY = 20 * 86400, SLOW_OVER = 20 * 60;

  function blank() {
    return {
      version: 1,
      name: '',
      avatar: {},
      // See js/achievements-model.js for what each count means. perGame,
      // dayList and lastStart are what the counts are worked out from.
      stats: { games: 0, seconds: 0, longestSession: 0, days: 0, mostInOneGame: 0, saves: 0, perGame: {}, dayList: [], lastStart: 0 },
      earned: [],
      // How many lines of the session log are already in the counts.
      sessionsRead: 0,
    };
  }

  // One line of the session log as an object, or null if it is not one.
  function parse(line) {
    var at = String(line || '').indexOf(' game=');
    if (at < 0) return null;
    var session = { game: line.slice(at + 6) };
    var fields = line.slice(0, at).split(' ');
    for (var i = 0; i < fields.length; i++) {
      var pair = fields[i].split('=');
      if (pair.length !== 2 || !/^-?\d+$/.test(pair[1])) return null;
      session[pair[0]] = Number(pair[1]);
    }
    return typeof session.seconds === 'number' && session.game ? session : null;
  }

  // The flags a session can carry, and the count each one sets.
  var FLAGS = {
    mv: 'playedMv', mz: 'playedMz', video: 'videoSeen', settings: 'settingsOpened', quick: 'quickSaves',
    older: 'loadedOlderSave', counter: 'counterShown', remap: 'remapped', pointer: 'pointerUsed',
    controlsoff: 'controlsOff', lacked: 'carriedOn',
  };

  // Adds one session to the counts, in place.
  function fold(stats, session) {
    var seconds = Math.max(0, session.seconds);
    stats.seconds += seconds;
    stats.longestSession = Math.max(stats.longestSession, seconds);
    stats.perGame[session.game] = (stats.perGame[session.game] || 0) + seconds;
    stats.mostInOneGame = Math.max(stats.mostInOneGame, stats.perGame[session.game]);
    if (session.day && stats.dayList.indexOf(session.day) < 0) stats.dayList.push(session.day);
    stats.days = stats.dayList.length;
    stats.saves += session.saves || 0;
    if (seconds < 60) stats.shortSession = true;
    // Over twenty minutes at that speed is a game played like that; less
    // may be a menu left open or a game that did not start.
    if (seconds > SLOW_OVER && (session.frames || 0) / seconds < 20) stats.slowSession = true;
    if (session.hour >= 2 && session.hour < 5) stats.nightSession = true;
    if (session.start && stats.lastStart && session.start - stats.lastStart >= AWAY) stats.cameBack = true;
    if (session.start) stats.lastStart = Math.max(stats.lastStart, session.start);
    if (session.code) stats.crashed = true;
    Object.keys(FLAGS).forEach(function (key) { if (session[key]) stats[FLAGS[key]] = true; });
  }

  // The profile with the lines of the session log it had not seen folded
  // in. A log shorter than what was seen has been started again: it is read
  // from its first line.
  function catchUp(profile, lines) {
    var from = profile.sessionsRead <= lines.length ? profile.sessionsRead : 0;
    for (var i = from; i < lines.length; i++) {
      var session = parse(lines[i]);
      if (session) fold(profile.stats, session);
    }
    profile.sessionsRead = lines.length;
    return profile;
  }

  function write(profile) { return JSON.stringify(profile); }

  // A profile from its text. Text that is not a profile gives a blank one;
  // one written by an earlier version gets the fields it lacks.
  function read(text) {
    var fresh = blank(), saved = null;
    try { saved = JSON.parse(text); } catch (error) { saved = null; }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fresh;
    Object.keys(fresh).forEach(function (key) {
      if (key === 'stats') {
        Object.keys(saved.stats || {}).forEach(function (stat) { fresh.stats[stat] = saved.stats[stat]; });
      } else if (saved[key] !== undefined && key !== 'version') {
        fresh[key] = saved[key];
      }
    });
    return fresh;
  }

  globalThis.__profile = { blank: blank, parse: parse, catchUp: catchUp, read: read, write: write };
})();
