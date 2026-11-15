// First-stage check, run by the player on the handheld: the engine is up,
// the screen shows frames paced by the display, promises resolve, and the
// log receives messages. Cycles the screen colour for a few seconds, reports
// how regular the frames were, and exits.
console.log('stage 1 script running on V8 ' + player.v8Version);

var FRAMES = 240;
var intervals = [];
var last = null;
var promiseResolved = false;
Promise.resolve().then(function () { promiseResolved = true; });

function frame(now) {
  if (last !== null) intervals.push(now - last);
  last = now;
  var n = intervals.length;
  // A slow colour cycle, so a person looking at the screen sees it change.
  player.setClearColor(0.5 + 0.5 * Math.sin(n / 20), 0.5 + 0.5 * Math.sin(n / 31 + 2), 0.5 + 0.5 * Math.sin(n / 43 + 4));
  if (n < FRAMES) {
    requestAnimationFrame(frame);
    return;
  }
  var sorted = intervals.slice(10).sort(function (a, b) { return a - b; });
  var over20 = sorted.filter(function (v) { return v > 20; }).length;
  console.log('frames: ' + sorted.length +
      ', interval median ' + sorted[sorted.length >> 1].toFixed(2) + ' ms' +
      ', p95 ' + sorted[Math.floor(sorted.length * 0.95)].toFixed(2) + ' ms' +
      ', max ' + sorted[sorted.length - 1].toFixed(2) + ' ms' +
      ', over 20 ms: ' + over20);
  console.log('promise resolved before first frame: ' + promiseResolved);
  player.exit(promiseResolved && over20 === 0 ? 0 : 3);
}
requestAnimationFrame(frame);
