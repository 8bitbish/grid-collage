/* Effects: the panel, and Pop out.
 *
 * Measured on the canvas, as the Adjust test is. The photo is built to make
 * that easy: a red disc — the subject — on flat grey, 4:5 so that a square
 * tile crops some of it off the top and bottom. Pop out's frame is measured by
 * sampling either side of where it should be: the page's own white outside it,
 * the grey inside it, and the red of the disc carrying on past it.
 *
 * The subject is found by the real model, not a stand-in, so this also checks
 * the vendored MediaPipe files load and answer from a plain static server — and
 * counts the requests for them, because a reopened deck must never run the
 * model again.
 *
 * Where things should land, in fractions of the square tile. The photo is
 * 1200x1500, so in a tile it is 1.25 tiles tall. With a pop out of the top at
 * depth 20 its frame starts 0.2 down and the photo is centred in the 0.8 below,
 * so it spans -0.025 to 1.225; the disc, centred 0.3 down the photo with a
 * radius of a quarter of its width, sits at 0.35 with its top at 0.10.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webm': 'video/webm',
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
const WHITE = [255, 255, 255];

function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const cx = w / 2; const cy = h * 0.3; const r = w / 4;
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const c = (x - cx) ** 2 + (y - cy) ** 2 < r * r ? RED : GREY;
      raw[o + 1 + x * 3] = c[0]; raw[o + 2 + x * 3] = c[1]; raw[o + 3 + x * 3] = c[2];
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

// The Adjust test's reason applies here too: WebGL only through SwiftShader
// on a machine with no GPU, and the look pipeline is on the path an effect
// draws through.
const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, acceptDownloads: true });
const p = await ctx.newPage();
await autoEnter(p);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
// MediaPipe says it has made its CPU delegate through console.error, every
// time it loads a model. It is a notice, not a failure.
p.on('console', (m) => { if (m.type() === 'error' && !/^INFO: /.test(m.text())) errs.push(m.text()); });
const modelFetches = [];
p.on('request', (q) => { if (/\/vendor\/mediapipe\//.test(q.url())) modelFetches.push(path.basename(new URL(q.url()).pathname)); });
await p.goto(`http://localhost:${PORT}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

await p.setInputFiles('#file-input', [{ name: 'disc.png', mimeType: 'image/png', buffer: png(1200, 1500) }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// The canvas is the single square tile, so fractions of it are fractions of
// the tile. Each point is off any edge by more than the mask's soft border.
const at = (points) => p.evaluate((pts) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  return pts.map(([fx, fy]) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3));
}, points);
const near = (a, want, tol = 12) => a.every((v, i) => Math.abs(v - want[i]) <= tol);
const POINTS = {
  bandOff: [0.1, 0.1],     // above the frame, beside the disc
  bandOn: [0.5, 0.15],     // above the frame, on the disc
  frame: [0.1, 0.5],       // inside the frame, on the grey
  disc: [0.5, 0.4],        // inside the frame, on the disc
  right: [0.95, 0.6],      // near the right edge, on the grey
};
const read = async () => {
  const keys = Object.keys(POINTS);
  const got = await at(keys.map((k) => POINTS[k]));
  return Object.fromEntries(keys.map((k, i) => [k, got[i]]));
};
const show = (r) => Object.entries(r).map(([k, v]) => `${k} ${v.join(',')}`).join('; ');

const before = await read();
check(near(before.bandOff, GREY) && near(before.frame, GREY) && near(before.bandOn, RED),
  'without an effect the tile is the photo, edge to edge', show(before));

/* ------------------------------------------------------------------ panel */

const box = await p.locator('#canvas').boundingBox();
const tapTile = async () => { await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(200); };
await tapTile();
check(await p.locator('#tile-effects-btn').isVisible(), 'a photo tile offers Effects');
await p.click('.dock-item[data-tile="effects"]');
await p.waitForTimeout(200);
const effects = await p.$$eval('.effect-item', (els) => els.map((e) => e.dataset.effect));
check(await p.locator('#tile-effects').isVisible() && effects.includes('popOut'), 'the panel lists the effects', effects.join(', '));
check(await p.locator('#effect-hint').isVisible() && !(await p.locator('#popout-row').isVisible()),
  'with none on, it says what to do rather than showing settings');
check(!modelFetches.length, 'nothing of the model is fetched until an effect asks for it', modelFetches.join(', '));

/* ---------------------------------------------------------------- pop out */

const t0 = Date.now();
await p.click('.effect-item[data-effect="popOut"]');
const found = await p.waitForFunction(() => document.getElementById('pop-depth-name').textContent === 'Depth'
  && document.querySelector('.pop-side[aria-pressed="true"]'), null, { timeout: 60000 }).then(() => true).catch(() => false);
await p.waitForTimeout(300);
check(found, 'turning Pop out on finds the subject', `${Date.now() - t0}ms, fetched ${[...new Set(modelFetches)].join(', ')}`);
const sides = await p.$$eval('.pop-side[aria-pressed="true"]', (els) => els.map((e) => e.dataset.side));
check(sides.join() === 'top', 'it starts on the side the subject comes nearest', sides.join(', '));

const popped = await read();
check(near(popped.bandOff, WHITE, 2), 'the frame pulls in from the top, showing the page behind', show(popped));
check(near(popped.bandOn, RED), 'and the subject carries on past it', `on the disc above the frame: ${popped.bandOn.join(',')}`);
check(near(popped.frame, GREY) && near(popped.disc, RED), 'inside the frame the photo is as it was');

// The filmstrip's thumbnail goes through the same drawPage.
const thumb = await p.evaluate(() => {
  const c = document.querySelector('#filmstrip canvas');
  if (!c) return null;
  const g = c.getContext('2d');
  const px = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3);
  return { off: px(0.1, 0.08), on: px(0.5, 0.15) };
});
check(thumb && near(thumb.off, WHITE, 6) && near(thumb.on, RED, 20), 'the page thumbnail shows it too', thumb ? `${thumb.off} / ${thumb.on}` : 'no thumbnail');

/* ------------------------------------------------------------------ depth */

await p.evaluate(() => {
  const el = document.getElementById('pop-depth');
  el.value = '40';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(300);
const deep = await at([[0.1, 0.35], [0.1, 0.45]]);
check(near(deep[0], WHITE, 2) && near(deep[1], GREY), 'Depth moves the frame: at 40 it starts 0.4 down', `${deep[0]} above, ${deep[1]} below`);

/* ------------------------------------------------------------------ sides */

await p.click('.pop-side[data-side="right"]');
await p.waitForTimeout(300);
const both = await at([POINTS.right, [0.1, 0.35]]);
check(near(both[0], WHITE, 2) && near(both[1], WHITE, 2), 'a second side pulls that edge in as well', `right ${both[0]}, top ${both[1]}`);
await p.click('.pop-side[data-side="right"]');
await p.click('.pop-side[data-side="top"]');
await p.waitForTimeout(300);
const off = await read();
check(near(off.bandOff, GREY) && await p.locator('#effect-hint').isVisible(), 'turning the last side off takes the effect off', show(off));

/* -------------------------------------------------------- undo and restore */

// Back one step, to the top alone at depth 40. The frame then starts 0.4
// down and the photo is centred in the 0.6 below it, spanning 0.075 to 1.325,
// so the disc's top is at 0.2 and its middle at 0.45.
await p.click('#btn-undo');
await p.waitForTimeout(300);
const undone = await at([[0.1, 0.35], POINTS.right]);
check(near(undone[0], WHITE, 2) && near(undone[1], GREY), 'undo puts the effect back as it was', `top ${undone[0]}, right ${undone[1]}`);
const DEEP = [[0.1, 0.35], [0.5, 0.3], [0.1, 0.45]];

const fetchedBefore = modelFetches.length;
await p.reload();
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(1200);
const reopened = await at(DEEP);
check(near(reopened[0], WHITE, 2) && near(reopened[1], RED) && near(reopened[2], GREY),
  'the effect survives closing and reopening the app', reopened.map((c) => c.join(',')).join(' / '));
check(modelFetches.length === fetchedBefore, 'and its subject comes back from storage, not from the model again',
  `${modelFetches.length - fetchedBefore} model requests after reopening`);

/* ------------------------------------------------------------------ export */

await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#format', 'image/png');
const got = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await p.click('#btn-export');
const download = await got;
if (!download) check(false, 'the export arrives');
else {
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  const out = await p.evaluate(async ([b64, pts]) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(Math.round(bmp.width * x), Math.round(bmp.height * y), 1, 1).data].slice(0, 3));
  }, [bytes, DEEP]);
  check(near(out[0], WHITE, 2) && near(out[1], RED) && near(out[2], GREY), 'the exported file has the pop out the preview had',
    out.map((c) => c.join(',')).join(' / '));
}
await p.click('#dock-back');

/* ------------------------------------------------------------ clips opt out */

await p.setInputFiles('#file-input', [path.join(ROOT, 'tests/fixtures/clip.webm')]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 15000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); await p.click('#dock-back'); }
if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x1"]');
await p.click('#dock-back');
await p.click('#btn-photos');
await p.locator('.pm-pick[aria-label*="clip.webm"]').first().click();
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
await p.waitForTimeout(200);
check(!(await p.locator('#tile-effects-btn').isVisible()), 'a clip does not offer Effects');
await p.click('#dock-back');
await p.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
await p.waitForTimeout(200);
check(await p.locator('#tile-effects-btn').isVisible(), 'the photo beside it still does');

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
