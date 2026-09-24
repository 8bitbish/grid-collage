/* Runs the browser suite and exits non-zero if anything that was supposed to
 * pass did not.
 *
 * This replaces runall.sh, which listed 21 of the 37 tests and opened by cd-ing
 * into a scratch directory belonging to a different session — so it could not
 * run anywhere, including where it was written.
 *
 *   node tests/run.mjs              every test
 *   node tests/run.mjs swipe tile   just those
 *   JOBS=4 node tests/run.mjs       four at a time
 *   SHARD=2/4 node tests/run.mjs    the second quarter, as one CI machine runs it
 *   RECORD=1 node tests/run.mjs     and write how long each took to durations.json
 *
 * Every test asks the system for a free port, so running them together cannot
 * collide. It is one at a time by default anyway: several import twelve
 * 12-megapixel photos on purpose, and swipe times its flicks against real
 * frames, which four Chromiums on one machine slow down.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CHROME } from './paths.mjs';

const HERE = import.meta.dirname;
const JOBS = Math.max(1, Number(process.env.JOBS) || 1);
const PER_TEST_MS = 400_000;

// What each test needs that is not in git. Derived by reading the tests rather
// than copied from a table — several build the filename in a template literal,
// which is why a plain grep for "photo0.jpg" finds almost nothing.
const NEEDS = {
  bulk: ['fixtures/photo0.jpg', 'fixtures/many/clip0.webm'],
  otherslot: ['fixtures/photo0.jpg'],
  progress: ['fixtures/photo0.jpg'],
  progressive: ['fixtures/photo0.jpg'],
  replaceplay: ['fixtures/photo0.jpg'],
  thumbupgrade: ['fixtures/photo0.jpg'],
  video: ['fixtures/clip.mp4'],
};

// And what each needs on the PATH. rotated reads the exported file back with
// ffmpeg, because the thing it checks is only visible in the file itself.
const TOOLS = {
  rotated: ['ffmpeg', 'ffprobe'],
};
const onPath = (cmd) => (process.env.PATH || '').split(path.delimiter)
  .some((dir) => dir && fs.existsSync(path.join(dir, cmd)));

// In no run list and not run for a long time. They are run anyway — a test
// nobody runs is worth less than a test that fails loudly — but they do not
// fail the suite until somebody has looked at them. See tests/README.md.
// Empty since swr, manifest-fresh and progressive were given assertions; kept
// so the next test found in that state has somewhere honest to go.
const STALE = new Set([]);

const all = fs.readdirSync(HERE)
  .filter((f) => /^test-.+\.mjs$/.test(f))
  .map((f) => f.slice(5, -4))
  .sort();

const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !all.includes(n));
if (unknown.length) {
  console.error(`no such test: ${unknown.join(', ')}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- sharding */

// CI splits the suite across machines, each running its share one at a time.
// Splitting rather than running side by side is deliberate: the tests that
// time gestures against real frames — swipe above all — are measured with a
// machine to themselves, and four Chromiums on one box slow each other's
// frames enough to turn a flick into a drag.
//
// The split is by how long each test takes, not by name, because the times
// are nothing like even: freshness takes a minute and a dozen take a few
// seconds. durations.json holds them, from a sequential CI run; RECORD=1
// refreshes it. It only decides the balance — a stale or missing entry makes
// one machine finish a little later, never a test go unrun — and a test with
// no entry counts as the median.
//
// Longest first, each onto the machine with the least so far, ties to the
// lowest. Every machine computes the same split from the same inputs, so
// between them they run every test exactly once.
const DURATIONS = path.join(HERE, 'durations.json');
const known = (() => {
  try { return JSON.parse(fs.readFileSync(DURATIONS, 'utf8')); } catch { return {}; }
})();

function shard(list, index, count) {
  const times = Object.values(known).sort((a, b) => a - b);
  const median = times.length ? times[times.length >> 1] : 10;
  const cost = (n) => (Number.isFinite(known[n]) ? known[n] : median);
  const load = Array(count).fill(0);
  const mine = [];
  [...list]
    .sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))
    .forEach((n) => {
      const to = load.indexOf(Math.min(...load));
      load[to] += cost(n);
      if (to === index) mine.push(n);
    });
  return { mine: mine.sort(), seconds: load[index] };
}

let names = wanted.length ? all.filter((n) => wanted.includes(n)) : all;
const SHARD = /^(\d+)\/(\d+)$/.exec(process.env.SHARD || '');
if (process.env.SHARD && !SHARD) {
  console.error(`SHARD wants i/n, like 2/4 — got ${process.env.SHARD}`);
  process.exit(2);
}
if (SHARD) {
  const [index, count] = [Number(SHARD[1]) - 1, Number(SHARD[2])];
  if (!(count >= 1 && index >= 0 && index < count)) {
    console.error(`SHARD ${process.env.SHARD} is not one of 1/${count} to ${count}/${count}`);
    process.exit(2);
  }
  const { mine, seconds } = shard(names, index, count);
  console.log(`shard ${index + 1} of ${count}: ${mine.length} of ${names.length} tests, `
    + `about ${seconds}s by durations.json`);
  console.log(`  ${mine.join(' ')}`);
  names = mine;
}

/* ------------------------------------------------------------------ preflight */

try {
  await import('playwright');
} catch {
  console.error('Playwright is not installed. From this directory:\n\n  npm install\n');
  process.exit(2);
}

if (CHROME) {
  console.log(`chromium: ${CHROME}`);
} else {
  console.log('chromium: letting Playwright resolve it (no PLAYWRIGHT_BROWSERS_PATH match)');
  console.log('          if that fails, run: npx playwright install chromium');
}

const missing = new Map();
for (const n of names) {
  const absent = [
    ...(NEEDS[n] || []).filter((rel) => !fs.existsSync(path.join(HERE, rel))),
    ...(TOOLS[n] || []).filter((cmd) => !onPath(cmd)),
  ];
  if (absent.length) missing.set(n, absent);
}

if (missing.size) {
  console.log(`\n${missing.size} test(s) need fixtures that are not in git, or ffmpeg:`);
  for (const [n, absent] of missing) console.log(`  ${n} — ${absent.join(', ')}`);
  console.log('  generate them with: tests/fixtures/make.sh');
  console.log('  that needs ffmpeg with lavfi, libvpx, libvorbis and libx264. The ffmpeg');
  console.log('  bundled with Playwright is built --disable-everything and cannot do it.');
}

const toRun = names.filter((n) => !missing.has(n));
console.log(`\nrunning ${toRun.length} of ${names.length} test(s), ${JOBS} at a time\n`);

/* ----------------------------------------------------------------------- run */

function runOne(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, `test-${name}.mjs`)], {
      cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), PER_TEST_MS);
    child.on('close', (code) => {
      clearTimeout(killer);
      const ticks = (out.match(/✓/g) || []).length;
      const crosses = (out.match(/✗/g) || []).length;
      // Three of these assert nothing — they print observations a person used
      // to read, emit no ✓ or ✗, and so exit 0 whatever they saw. Counting them
      // as passes is how a suite reports green over a test that cannot fail.
      const silent = code === 0 && ticks === 0 && crosses === 0;
      resolve({
        name, code, ticks, crosses, out, silent,
        secs: ((Date.now() - started) / 1000).toFixed(0),
        ok: code === 0 && crosses === 0 && ticks > 0,
      });
    });
  });
}

const results = [];
const queue = [...toRun];
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const r = await runOne(queue.shift());
    results.push(r);
    const mark = r.ok ? '✓' : (r.silent ? '?' : (STALE.has(r.name) ? '·' : '✗'));
    const note = r.silent ? '  (asserts nothing)'
      : (STALE.has(r.name) && !r.ok ? '  (known stale)' : '');
    console.log(`${mark} ${r.name.padEnd(16)} ${String(r.secs).padStart(4)}s  `
      + `exit=${r.code} ✓${r.ticks} ✗${r.crosses}${note}`);
  }
}));

/* ------------------------------------------------------------------- summary */

results.sort((a, b) => a.name.localeCompare(b.name));
const silent = results.filter((r) => r.silent);
const broke = results.filter((r) => !r.ok && !r.silent && !STALE.has(r.name));
const staleBroke = results.filter((r) => !r.ok && !r.silent && STALE.has(r.name));
const passed = results.filter((r) => r.ok);
const assertions = results.reduce((n, r) => n + r.ticks, 0);

if (process.env.RECORD) {
  // Merged into what is there, so a sharded or partial run only updates the
  // tests it ran. Run it one at a time on a quiet machine: under JOBS the
  // numbers are the contention as much as the test.
  const merged = { ...known };
  for (const r of results) merged[r.name] = Number(r.secs);
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  fs.writeFileSync(DURATIONS, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`\nwrote ${results.length} duration(s) to durations.json`);
}

console.log(`\n${passed.length}/${results.length} tests passed, ${assertions} assertions`);

// A failing test's whole output goes into the screenshots CI uploads, because
// the summary below keeps only the lines with a cross on them, and the line
// that explains a cross is usually the one printed just before it.
if (broke.length) fs.mkdirSync(path.join(HERE, 'shots'), { recursive: true });
for (const r of broke) {
  fs.writeFileSync(path.join(HERE, 'shots', `${r.name}.log`), r.out);
  console.log(`\n--- ${r.name} failed ---`);
  console.log(r.out.split('\n').filter((l) => /✗|Error|error:/.test(l)).slice(0, 6).join('\n')
    || r.out.trim().split('\n').slice(-6).join('\n'));
}

if (staleBroke.length) {
  console.log(`\n${staleBroke.length} known-stale test(s) failed and are not counted: `
    + `${staleBroke.map((r) => r.name).join(', ')}`);
  console.log('These are in no run list and have not run in a long time. Fixing or deleting');
  console.log('them is a backlog entry; until then they are reported, not enforced.');
}
if (silent.length) {
  console.log(`\n${silent.length} test(s) asserted nothing and are not counted as passing: `
    + `${silent.map((r) => r.name).join(', ')}`);
  console.log('They print observations and emit no ✓ or ✗, so they exit 0 whatever they see.');
  console.log('Giving them assertions or deleting them is a backlog entry.');
}
if (missing.size) {
  console.log(`\n${missing.size} test(s) were skipped for missing fixtures or ffmpeg: `
    + `${[...missing.keys()].join(', ')}`);
}

process.exit(broke.length ? 1 : 0);
