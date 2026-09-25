/* Pop out's controls: holding on what should pop out, the edge set by hand
 * (Hair, Feather, Shift edge, and Remove colour, which takes a colour such as
 * sky back out of the cut), and a popped-out tile that turns without its
 * cutout being made again.
 *
 * Two tiles stacked, the 1x2 layout on a square page, as in test-effects: flat
 * blue above, and below a building — a beige block with rows of dark windows
 * on a pale sky — whose top runs past the shared edge. The detector knows no
 * buildings (asked, it finds nothing in this one, where it calls a red disc a
 * frisbee and flat grey a bed), which is what this is for: with nothing
 * detected Pop out must not guess, and a hold is how the building is chosen.
 *
 * Where things land, in fractions of the page. The bottom tile runs from 0.5
 * to 1; the photo, a page wide and 1.25 tall, from 0.125 to 1.375. The block's
 * top is at 0.385, 0.115 past the tile's edge, and it runs from 0.21 to 0.79
 * across. Everything is read at x = 0.35, which is between two columns of
 * windows, so what is over the blue there is the block's own beige.
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

const SKY = [159, 195, 224];
const WALL = [200, 162, 122];
const GLASS = [58, 74, 90];
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
// 960x1200, as it was drawn when the detector was asked about it.
const building = png(960, 1200, (x, y) => {
  if (x < 200 || x >= 760 || y < 250) return SKY;
  for (let wy = 320; wy < 1100; wy += 130) {
    for (let wx = 250; wx < 700; wx += 110) if (x >= wx && x < wx + 60 && y >= wy && y < wy + 80) return GLASS;
  }
  return WALL;
});
const blue = png(1200, 600, () => BLUE);

const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true });
const p = await ctx.newPage();
await autoEnter(p);
// Counts every read back off a canvas, which is what making a cutout costs:
// a popped-out tile turning should need none.
await p.addInitScript(() => {
  window.readBacks = 0;
  for (const C of [CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D].filter(Boolean)) {
    const read = C.prototype.getImageData;
    C.prototype.getImageData = function counted(...args) { window.readBacks += 1; return read.apply(this, args); };
  }
});
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
// MediaPipe says it has made its CPU delegate through console.error.
p.on('console', (m) => { if (m.type() === 'error' && !/^INFO: /.test(m.text())) errs.push(m.text()); });
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
await p.setInputFiles('#file-input', [{ name: 'building.png', mimeType: 'image/png', buffer: building }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 30000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

const near = (a, want, tol = 14) => a.every((v, i) => Math.abs(v - want[i]) <= tol);
const at = (points) => p.evaluate((pts) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  return pts.map(([fx, fy]) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3));
}, points);
// Down the column at x = 0.35 from above the block's top to the tile's
// edge: where the blue stops, and over how many pixels it turns to beige.
const column = () => p.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const x = Math.round(c.width * 0.35);
  const y0 = Math.round(c.height * 0.3);
  const y1 = Math.round(c.height * 0.49);
  const d = g.getImageData(x, y0, 1, y1 - y0).data;
  // 0 for the blue, 1 for the beige, by the blue channel (200 against 122).
  const mix = [];
  for (let i = 0; i < y1 - y0; i++) mix.push((200 - d[i * 4 + 2]) / (200 - 122));
  const from = mix.findIndex((m) => m > 0.1);
  const to = mix.findIndex((m) => m > 0.9);
  // Where the neighbour's blue stops, whatever replaces it: pushed out, the
  // edge takes in the photo's own sky round the block, which is pale blue
  // and would not count as beige.
  let reach = -1;
  for (let i = 0; i < y1 - y0; i++) {
    if (Math.abs(d[i * 4] - 40) + Math.abs(d[i * 4 + 1] - 90) + Math.abs(d[i * 4 + 2] - 200) > 30) { reach = i; break; }
  }
  return {
    top: reach < 0 ? null : (y0 + reach) / c.height,
    spread: from < 0 || to < 0 ? null : to - from,
    height: c.height,
  };
});

// Measured again before every press rather than once. The sheet a tile opens
// is as tall as what is in it — the effects panel more than the bar it covers —
// and the preview gives up the difference, so a box taken before the tile was
// chosen is a box the canvas has since moved out of.
let box = await p.locator('#canvas').boundingBox();
const fresh = async () => { box = await p.locator('#canvas').boundingBox(); };
const settle = () => p.waitForFunction(() => !/Finding/.test(document.getElementById('pop-note').textContent), null, { timeout: 60000 })
  .then(() => p.waitForTimeout(400));
const hold = async (fx, fy, ms = 700) => {
  await fresh();
  await p.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await p.mouse.down();
  await p.waitForTimeout(ms);
  await p.mouse.up();
};

await fresh();
await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.9);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="effects"]');
await p.click('.effect-item[data-effect="popOut"]');
await settle();
const guessed = (await at([[0.35, 0.47]]))[0];
check(near(guessed, BLUE) && /Hold on what should pop out/.test(await p.textContent('#pop-note')),
  'with nothing detected, Pop out does not guess: it asks for a hold', `over the blue ${guessed.join(',')}; "${await p.textContent('#pop-note')}"`);

/* -------------------------------------------------------------------- hold */

// A tap is not a hold: nothing is chosen.
await hold(0.35, 0.8, 120);
await p.waitForTimeout(600);
check(near((await at([[0.35, 0.47]]))[0], BLUE), 'a tap is not a hold, and chooses nothing');

await hold(0.35, 0.8);
await settle();
const held = await at([[0.35, 0.47], [0.1, 0.47], [0.9, 0.47]]);
check(near(held[0], WALL) && near(held[1], BLUE) && near(held[2], BLUE), 'a hold on the building makes it the subject, and it pops out over the tile above',
  held.map((c) => c.join(',')).join(' / '));
const plain = await column();
check(plain.top !== null && Math.abs(plain.top - 0.385) < 0.01 && plain.spread <= 3, 'its top where the photo puts it, with a clean edge',
  `top ${plain.top?.toFixed(3)}, ${plain.spread}px from blue to beige`);

// A hold that moves is a drag, and chooses nothing.
await fresh();
await p.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.8);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.75, { steps: 4 });
await p.waitForTimeout(700);
await p.mouse.up();
await p.waitForTimeout(400);
check(!/Finding/.test(await p.textContent('#pop-note')), 'a press that moves is a drag, not a hold');
await p.click('#btn-undo');
await p.waitForTimeout(300);

/* ------------------------------------------------------------------ edge */

await fresh();
await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.9);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="effects"]');
await p.waitForTimeout(200);
await p.click('#pop-edge');
await p.waitForTimeout(200);
const tools = await p.$$eval('#edge-tools .adjust-tool', (els) => els.map((e) => e.dataset.edge));
check(await p.locator('#effect-edge').isVisible() && tools.join() === 'hair,feather,shift,remove', 'Edge opens with Hair, Feather, Shift edge and Remove colour', tools.join(', '));
check(await p.locator('#edge-reset').isDisabled(), 'Reset has nothing to put back on an untouched edge');

const slide = async (tool, value) => {
  await p.click(`#edge-tools .adjust-tool[data-edge="${tool}"]`);
  await p.evaluate((v) => {
    const el = document.getElementById('edge');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await p.waitForTimeout(700);
};
await slide('shift', 100);
const out = await column();
await slide('shift', -100);
const inside = await column();
check(out.top < plain.top && inside.top > plain.top, 'Shift edge moves it out, and in',
  `top ${out.top.toFixed(3)} out, ${plain.top.toFixed(3)} as cut, ${inside.top.toFixed(3)} in`);
await slide('shift', 0);
await slide('feather', 100);
const soft = await column();
check(soft.spread >= plain.spread + 4, 'Feather softens it', `${soft.spread}px from blue to beige, against ${plain.spread}px`);
check(!(await p.locator('#edge-reset').isDisabled()) && await p.locator('#pop-edge').evaluate((el) => el.classList.contains('is-set')),
  'and the panel shows the edge has been changed');

await p.click('#btn-undo');
await p.waitForTimeout(400);
const undone = await column();
check(undone.spread <= plain.spread + 1, 'undo takes the feather off', `${undone.spread}px`);
await p.click('#btn-redo');
await p.waitForTimeout(400);

await p.reload();
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(1500);
const reopened = await column();
check(Math.abs(reopened.spread - soft.spread) <= 1 && near((await at([[0.35, 0.47]]))[0], WALL),
  'the chosen subject and its edge survive closing and reopening the app', `${reopened.spread}px`);

/* ---------------------------------------------------------- remove colour */

await fresh();
await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.9);
await p.waitForTimeout(300);
await p.click('.dock-item[data-tile="effects"]');
await p.waitForTimeout(200);
await p.click('#pop-edge');
await p.click('#edge-reset');
await p.waitForTimeout(500);
await p.click('#edge-tools .adjust-tool[data-edge="remove"]');
await p.waitForTimeout(200);
const auto = await p.$eval('#edge-key', (el) => getComputedStyle(el).getPropertyValue('--key').match(/\d+/g).map(Number));
check(await p.locator('#edge-key').isVisible() && near(auto, SKY, 6), 'Remove colour starts on the colour most often just outside the subject: the sky',
  `rgb(${auto.join(',')})`);

// Pushed out, the edge brings the sky round the block with it; Remove colour
// takes it off again, and leaves the wall.
await slide('shift', 100);
const withSky = await column();
await slide('remove', 60);
const skyGone = await column();
const wall = (await at([[0.35, 0.47]]))[0];
check(withSky.top < plain.top - 0.003 && skyGone.top >= plain.top - 0.002 && near(wall, WALL),
  'it takes the sky back off a pushed-out edge, and leaves the wall', `blue stops at ${withSky.top.toFixed(3)} with the sky, ${skyGone.top.toFixed(3)} without; wall ${wall.join(',')}`);

// A tap picks the colour instead: a window's glass, the top row of which is
// over the blue at x = 0.29.
const glassBefore = (await at([[0.29, 0.47]]))[0];
await fresh();
await p.mouse.click(box.x + box.width * 0.29, box.y + box.height * 0.6);
await p.waitForTimeout(900);
const picked = await p.$eval('#edge-key', (el) => getComputedStyle(el).getPropertyValue('--key').match(/\d+/g).map(Number));
const glassAfter = (await at([[0.29, 0.47]]))[0];
check(near(picked, GLASS, 10) && near(glassBefore, GLASS) && near(glassAfter, BLUE),
  'a tap on the photo picks the colour to remove, and the windows go', `picked rgb(${picked.join(',')}); over the blue ${glassBefore.join(',')} then ${glassAfter.join(',')}`);
check(!/Finding/.test(await p.textContent('#pop-note')), 'and picking a colour chose no new subject');
await p.click('#edge-reset');
await p.waitForTimeout(600);
await p.click('#edge-done');
await p.click('#dock-back');
await p.click('#dock-back');

/* -------------------------------------------------------------- turning */

// Every step of the angle slider changes the zoom the cover clamp needs, and
// the cutout used to be made again at each new size.
await fresh();
await p.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.9);
await p.waitForTimeout(300);
await p.click('.dock-item[data-tile="rotate"]');
await p.waitForTimeout(300);
const turn = await p.evaluate(async () => {
  const el = document.getElementById('angle');
  const before = window.readBacks;
  const times = [];
  for (let k = 1; k <= 20; k++) {
    const t = performance.now();
    el.value = String(k);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    times.push(performance.now() - t);
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { reads: window.readBacks - before, median: times.sort((a, b) => a - b)[10] };
});
check(turn.reads === 0, 'turning a popped-out photo does not make its cutout again', `${turn.reads} reads off a canvas in 20 steps, median step ${turn.median.toFixed(1)}ms`);

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
