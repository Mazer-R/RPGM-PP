// Drives a Chromium-based browser headless through the DevTools protocol,
// runs the game with the lab harness, and reports JavaScript heap use and a
// heap-snapshot summary at chosen points.
//
// Usage: node chrome-heap.mjs <browser-binary> <profile-dir> <url> <label:seconds>...
// Example point: "map:45" takes a measurement 45 s after navigation.
import { spawn, execSync } from 'node:child_process';
import { createWriteStream, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [browser, profileDir, url, ...pointArgs] = process.argv.slice(2);
const points = pointArgs.map((p) => ({ label: p.split(':')[0], at: Number(p.split(':')[1]) }));
const DEBUG_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => Math.round(bytes / 1048576);

mkdirSync(profileDir, { recursive: true });
const server = spawn('python3', ['serve.py', 'game/www', 'harness.js', '8017'], { stdio: 'ignore' });
const chrome = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--disable-extensions', '--autoplay-policy=no-user-gesture-required',
  '--window-size=816,624', 'about:blank',
], { stdio: 'ignore' });

function cleanup() {
  chrome.kill();
  server.kill();
}
process.on('exit', cleanup);

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser not up yet */ }
    await sleep(200);
  }
  throw new Error('browser did not expose a page target');
}

const ws = new WebSocket(await pageTarget());
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 1;
const pending = new Map();
const listeners = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (listeners.has(msg.method)) {
    listeners.get(msg.method)(msg.params);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

let lastHarnessLine = '';
listeners.set('Runtime.consoleAPICalled', (p) => {
  const text = p.args.map((a) => a.value).join(' ');
  if (text.startsWith('[H] tick')) lastHarnessLine = text;
  if (text.startsWith('[H] phase') || text.startsWith('[H] harness-error')) console.log(text);
});
await send('Runtime.enable');
await send('HeapProfiler.enable');

// Resident memory of the browser's processes, by process type.
function processMemory() {
  const out = execSync('ps -axo rss=,command=').toString().split('\n');
  const byType = {};
  for (const line of out) {
    if (!line.includes(profileDir)) continue;
    const rssKb = Number(line.trim().split(/\s+/)[0]);
    const type = (line.match(/--type=([a-z-]+)/) || [, 'browser'])[1];
    byType[type] = (byType[type] || 0) + Math.round(rssKb / 1024);
  }
  return byType;
}

async function snapshotSummary(label) {
  const file = join(profileDir, `${label}.heapsnapshot`);
  const stream = createWriteStream(file);
  listeners.set('HeapProfiler.addHeapSnapshotChunk', (p) => stream.write(p.chunk));
  await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await new Promise((r) => stream.end(r));
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(file);
  const fields = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const step = fields.length;
  const iType = fields.indexOf('type'), iName = fields.indexOf('name'), iSize = fields.indexOf('self_size');
  const byType = {}, byName = {};
  for (let i = 0; i < snap.nodes.length; i += step) {
    const type = types[snap.nodes[i + iType]];
    const size = snap.nodes[i + iSize];
    byType[type] = (byType[type] || 0) + size;
    if (type === 'object' || type === 'native') {
      const name = type + ':' + snap.strings[snap.nodes[i + iName]].slice(0, 40);
      const entry = byName[name] || (byName[name] = { n: 0, bytes: 0 });
      entry.n++; entry.bytes += size;
    }
  }
  const top = (obj, n, f) => Object.entries(obj).sort((a, b) => f(b[1]) - f(a[1])).slice(0, n);
  return {
    nodes: snap.nodes.length / step,
    byTypeMb: Object.fromEntries(top(byType, 10, (v) => v).map(([k, v]) => [k, mb(v)])),
    topNames: top(byName, 14, (v) => v.bytes).map(([k, v]) => `${k} x${v.n} = ${mb(v.bytes)} MB`),
  };
}

const started = Date.now();
await send('Page.navigate', { url });
for (const point of points) {
  await sleep(Math.max(0, point.at * 1000 - (Date.now() - started)));
  await send('HeapProfiler.collectGarbage');
  const heap = await send('Runtime.getHeapUsage');
  const result = {
    point: point.label,
    harness: lastHarnessLine.slice(0, 120),
    jsHeapUsedMb: mb(heap.usedSize),
    jsHeapTotalMb: mb(heap.totalSize),
    processRssMb: processMemory(),
  };
  if (!process.env.NO_SNAPSHOT) result.snapshot = await snapshotSummary(point.label);
  console.log(JSON.stringify(result, null, 1));
}
ws.close();
cleanup();
process.exit(0);
