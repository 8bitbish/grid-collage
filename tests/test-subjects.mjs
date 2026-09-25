/* Pop out's subjects: choosing them by tapping, and how sharp the cut is.
 *
 * Two tiles stacked, the 1x2 layout on a square page, as in test-effects: flat
 * blue in the top one, and in the bottom one a photo with two subjects — a red
 * disc and a yellow one, side by side on grey, both running past the tile's
 * top edge. So which subjects are chosen can be read straight off the blue
 * tile: red over it where the red disc pokes up, yellow where the yellow one
 * does, and blue where a disc is not chosen.
 *
 * The photo is 2400x3000, bigger than the 1440px copy the app keeps for
 * drawing, because that copy is what the cut used to be made from, and it
 * showed: a high-resolution photo came out with its edge soft and stepped. The
 * export at the end is at 2160 and measures how many pixels the edge takes to
 * go from blue to red.
 *
 * Where things land, in fractions of the page. The bottom tile runs from 0.5
 * to 1, and the photo, a page wide and 1.25 pages tall, from 0.125 to 1.375.
 * The discs are centred 0.4 down it — 0.625 down the page — with a radius of
 * 0.2 of its width, at 0.28 and 0.72 across: each reaches 0.425, three
 * fortieths past the top edge, and a gap of 0.04 separates them.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

const GREY = [128, 128, 128];
const RED = [210, 50, 50];
const YELLOW = [230, 190, 40];
const BLUE = [40, 90, 200];

function png(w, h, draw) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const c = draw(x, y);
      raw[o + 1 + x * 3] = c[0]; raw[o + 2 + x * 3] = c[1]; raw[o + 3 + x * 3] = c[2];
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
const W = 2400; const H = 3000; const R = 0.2 * W;
const two = png(W, H, (x, y) => {
  if ((x - 0.28 * W) ** 2 + (y - 0.4 * H) ** 2 < R * R) return RED;
  if ((x - 0.72 * W) ** 2 + (y - 0.4 * H) ** 2 < R * R) return YELLOW;
  return GREY;
});
const blue = png(1200, 600, () => BLUE);

const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, acceptDownloads: true });
const p = await ctx.newPage();
await autoEnter(p);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
// MediaPipe says it has made its CPU delegate through console.error.
p.on('console', (m) => { if (m.type() === 'error' && !/^INFO: /.test(m.text())) errs.push(m.text()); });
const modelFetches = [];
p.on('request', (q) => { if (/\/vendor\/mediapipe\/.*\.tflite/.test(q.url())) modelFetches.push(path.basename(new URL(q.url()).pathname)); });
await p.goto(`http://localhost:${PORT}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

await p.setInputFiles('#file-input', [{ name: 'blue.png', mimeType: 'image/png', buffer: blue }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="1x2"]');
await p.click('#dock-back');
await p.setInputFiles('#file-input', [{ name: 'two.png', mimeType: 'image/png', buffer: two }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 30000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
// Reopened, so the photo comes back as the 1440px copy the app draws from,
// which is what the cut used to be made from on any deck but a fresh one.
await p.reload();
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(600);

const at = (points) => p.evaluate((pts) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  return pts.map(([fx, fy]) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3));
}, points);
const near = (a, want, tol = 14) => a.every((v, i) => Math.abs(v - want[i]) <= tol);
// Just above the shared edge, over each disc.
const chosen = async () => {
  const [left, right] = await at([[0.28, 0.47], [0.72, 0.47]]);
  return { red: near(left, RED), yellow: near(right, YELLOW), left, right, blue: near(left, BLUE) && near(right, BLUE) };
};
const say = (c) => `over the red ${c.left.join(',')}, over the yellow ${c.right.join(',')}`;

// Measured again before every press rather than once. The sheet a tile opens
// is as tall as what is in it — the effects panel more than the bar it covers —
// and the preview gives up the difference, so a box taken before the tile was
// chosen is a box the canvas has since moved out of.
let box = await p.locator('#canvas').boundingBox();
const fresh = async () => { box = await p.locator('#canvas').boundingBox(); };
const tap = async (fx, fy) => { await fresh(); return p.mouse.click(box.x + box.width * fx, box.y + box.height * fy); };
const settle = () => p.waitForFunction(() => !/Finding/.test(document.getElementById('pop-note').textContent), null, { timeout: 60000 })
  .then(() => p.waitForTimeout(300));

await tap(0.5, 0.9);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="effects"]');
await p.click('.effect-item[data-effect="popOut"]');
await settle();
const first = await chosen();
check(first.red || first.yellow, 'Pop out finds at least one of the two by itself', say(first));

/* ---------------------------------------------------------------- choosing */

await p.click('#pop-pick');
await p.waitForTimeout(200);
check(await p.getAttribute('#pop-pick', 'aria-pressed') === 'true' && /Tap/.test(await p.textContent('#pop-note')),
  'Subjects turns choosing on, and says what a tap does', await p.textContent('#pop-note'));
const tint = (await at([[0.28, 0.7]]))[0];
if (first.red) check(!near(tint, RED, 4) && tint[0] > 200, 'a chosen subject is tinted while choosing', tint.join(','));

// Get to the red alone, whichever the detector chose: a tap on a chosen disc
// takes it away, a tap on the other adds it.
if (!first.red) { await tap(0.28, 0.7); await settle(); }
if (first.yellow) { await tap(0.72, 0.7); await settle(); }
const redOnly = await chosen();
check(redOnly.red && near(redOnly.right, BLUE), 'a tap takes a subject away, and it stops popping out', say(redOnly));

await tap(0.72, 0.7);
await settle();
const both = await chosen();
check(both.red && both.yellow, 'a tap on the other adds it: two subjects pop out at once', say(both));

await tap(0.28, 0.7);
await settle();
const yellowOnly = await chosen();
check(near(yellowOnly.left, BLUE) && yellowOnly.yellow, 'and either can be taken away on its own', say(yellowOnly));

// A drag while choosing still moves the photo rather than choosing.
const before = await chosen();
await fresh();
await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.9);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(400);
check(!(await p.textContent('#pop-note')).includes('Finding'), 'a drag while choosing moves the photo instead of choosing');
await p.click('#btn-undo');
await p.waitForTimeout(300);
const undone = await chosen();
check(undone.yellow === before.yellow && near(undone.left, BLUE), 'and undoing the drag puts it back', say(undone));

// Undo lets go of the tile, and choosing with it.
check(!(await p.locator('#tile-effects').isVisible()), 'undo lets go of the tile, and stops choosing');
await tap(0.5, 0.9);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="effects"]');
await p.waitForTimeout(200);
check(await p.getAttribute('#pop-pick', 'aria-pressed') === 'false', 'coming back to the panel, it is not choosing');
await p.click('#pop-pick');
await tap(0.28, 0.7);
await settle();
await p.click('#pop-pick');
await p.waitForTimeout(200);
check(await p.getAttribute('#pop-pick', 'aria-pressed') === 'false', 'Subjects again stops choosing');
const kept = await chosen();
check(kept.red && kept.yellow, 'both chosen again', say(kept));

/* ----------------------------------------------------------------- reopen */

// Given time for the cut to be stored, which happens after it is drawn.
await p.waitForTimeout(1500);
const fetched = modelFetches.length;
await p.reload();
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(1500);
const reopened = await chosen();
check(reopened.red && reopened.yellow, 'the subjects chosen survive closing and reopening the app', say(reopened));
check(modelFetches.length === fetched, 'without running the model again', `${modelFetches.length - fetched} model files fetched`);

/* ------------------------------------------------------------ a clean edge */

// Along a row just above the shared edge, through the red disc's left side,
// in a 2160px export: how many pixels it takes to get from blue to red. The
// disc there is a circle's edge crossed at a slant of about 70°, so even a
// perfect cut spreads a one-pixel edge over a pixel or so of this row.
await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#quality', '2160');
await p.selectOption('#format', 'image/png');
const got = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await p.click('#btn-export');
const download = await got;
if (!download) check(false, 'the export arrives');
else {
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  const edge = await p.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const y = Math.round(bmp.height * 0.49);
    const row = g.getImageData(0, y, Math.round(bmp.width * 0.3), 1).data;
    // How red each pixel is, 0 for the blue and 1 for the red, by its red.
    const mix = [];
    for (let x = 0; x < row.length / 4; x++) mix.push((row[x * 4] - 40) / (210 - 40));
    const from = mix.findIndex((m) => m > 0.1);
    const to = mix.findIndex((m) => m > 0.9);
    return { width: bmp.width, from, to, spread: to - from };
  }, bytes);
  check(edge.width === 2160, 'the export is at 2160', String(edge.width));
  check(edge.from > 0 && edge.spread >= 0 && edge.spread <= 3, 'the edge over the neighbour is sharp: blue to red in 3px or fewer',
    `${edge.spread}px, from x=${edge.from} to x=${edge.to}`);
}

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
