/* Effects: the panel, and Pop out.
 *
 * Measured on the canvas, as the Adjust test is. Two tiles stacked, the 1x2
 * layout on a square page: flat blue in the top one, and in the bottom one the
 * subject — a red disc on flat grey. The disc photo is 4:5 in a tile twice as
 * wide as it is tall, so the tile shows a band across its middle and the disc
 * runs past the tile's top and bottom edges. Popping it out of the top should
 * put the red over the blue tile above, and nowhere else.
 *
 * The subject is found by the real model, not a stand-in, so this also checks
 * the vendored MediaPipe files load and answer from a plain static server — and
 * counts the requests for them, because a reopened deck must never run the
 * model again.
 *
 * Where things land, in fractions of the page. The bottom tile runs from 0.5 to
 * 1. The photo is a page wide and 1.25 pages tall, centred on the tile, so it
 * spans 0.125 to 1.375; the disc, centred in it with a radius of 0.3 of its
 * width, runs from 0.45 to 1.05 — a twentieth of the page past the top edge,
 * over the blue, and off the page at the bottom.
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
const disc = png(1200, 1500, (x, y) => ((x - 600) ** 2 + (y - 750) ** 2 < 360 ** 2 ? RED : GREY));
const blue = png(1200, 600, () => BLUE);

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

// Blue first, alone; then the two-tile layout; then the disc, which goes
// into the empty tile.
await p.setInputFiles('#file-input', [{ name: 'blue.png', mimeType: 'image/png', buffer: blue }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="1x2"]');
await p.click('#dock-back');
await p.setInputFiles('#file-input', [{ name: 'disc.png', mimeType: 'image/png', buffer: disc }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

const at = (points) => p.evaluate((pts) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  return pts.map(([fx, fy]) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3));
}, points);
const near = (a, want, tol = 12) => a.every((v, i) => Math.abs(v - want[i]) <= tol);
// Each point is off any edge by more than the cut's soft border.
const POINTS = {
  over: [0.5, 0.475],      // in the blue tile, just above the disc's tile
  clear: [0.5, 0.43],      // in the blue tile, above where the disc reaches
  beside: [0.1, 0.475],    // in the blue tile, level with the disc but off it
  grey: [0.1, 0.75],       // the disc's own tile, beside the disc
  disc: [0.5, 0.75],       // the disc's own tile, on the disc
};
const read = async () => {
  const keys = Object.keys(POINTS);
  const got = await at(keys.map((k) => POINTS[k]));
  return Object.fromEntries(keys.map((k, i) => [k, got[i]]));
};
const show = (r) => Object.entries(r).map(([k, v]) => `${k} ${v.join(',')}`).join('; ');
const asBefore = (r) => near(r.over, BLUE) && near(r.clear, BLUE) && near(r.beside, BLUE) && near(r.grey, GREY) && near(r.disc, RED);
const poppedOut = (r) => near(r.over, RED) && near(r.clear, BLUE, 2) && near(r.beside, BLUE, 2) && near(r.grey, GREY) && near(r.disc, RED);

const before = await read();
check(asBefore(before), 'without an effect each tile shows only its own photo', show(before));

/* ------------------------------------------------------------------ panel */

const box = await p.locator('#canvas').boundingBox();
const tapTile = async () => { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8); await p.waitForTimeout(200); };
await tapTile();
check(await p.locator('#tile-tabs [data-tile="effects"]').isVisible(), 'a photo tile offers Effects');
await p.click('#tile-tabs [data-tile="effects"]');
await p.waitForTimeout(200);
const effects = await p.$$eval('.effect-item', (els) => els.map((e) => e.dataset.effect));
check(await p.locator('#tile-effects').isVisible() && effects.includes('popOut'), 'the panel lists the effects', effects.join(', '));
check(await p.locator('#effect-hint').isVisible() && !(await p.locator('#popout-row').isVisible()),
  'with none on, it says what to do rather than showing settings');
check(!modelFetches.length, 'nothing of the model is fetched until an effect asks for it', modelFetches.join(', '));

/* ---------------------------------------------------------------- pop out */

const t0 = Date.now();
await p.click('.effect-item[data-effect="popOut"]');
const found = await p.waitForFunction(() => !/Finding/.test(document.getElementById('pop-note').textContent)
  && document.querySelector('.pop-side[aria-pressed="true"]'), null, { timeout: 60000 }).then(() => true).catch(() => false);
await p.waitForTimeout(300);
check(found, 'turning Pop out on finds the subject', `${Date.now() - t0}ms, fetched ${[...new Set(modelFetches)].join(', ')}`);
const sides = await p.$$eval('.pop-side[aria-pressed="true"]', (els) => els.map((e) => e.dataset.side));
check(sides.join() === 'top', 'it starts on the side the subject comes nearest', sides.join(', '));

const popped = await read();
check(poppedOut(popped), 'the subject carries on over the tile above, and nothing else does', show(popped));
check(near(popped.over, RED, 3), 'drawn without a shadow or a fringe: the red over the blue is the red', popped.over.join(','));
check(/over the photos/.test(await p.textContent('#pop-note')), 'the panel says what it is doing', await p.textContent('#pop-note'));

// The filmstrip's thumbnail goes through the same drawPage.
const thumb = await p.evaluate(() => {
  const c = document.querySelector('#filmstrip canvas');
  if (!c) return null;
  const g = c.getContext('2d');
  const px = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3);
  return { over: px(0.5, 0.475), clear: px(0.5, 0.4) };
});
check(thumb && near(thumb.over, RED, 30) && near(thumb.clear, BLUE, 6), 'the page thumbnail shows it too',
  thumb ? `${thumb.over} / ${thumb.clear}` : 'no thumbnail');

/* ------------------------------------------------------------------ sides */

// The bottom of the tile is the bottom of the page, so there is nothing to
// show there, and the left has no subject past it: either alone does nothing,
// and the panel has to say why.
await p.click('.pop-side[data-side="left"]');
await p.click('.pop-side[data-side="top"]');
await p.waitForTimeout(300);
const leftOnly = await read();
check(asBefore(leftOnly), 'a side the subject does not cross shows nothing past it', show(leftOnly));
check(/Move or zoom/.test(await p.textContent('#pop-note')), 'and the panel says to move or zoom the photo', await p.textContent('#pop-note'));
await p.click('.pop-side[data-side="left"]');
await p.waitForTimeout(300);
check(await p.locator('#effect-hint').isVisible() && asBefore(await read()), 'turning the last side off takes the effect off');

/* -------------------------------------------------------- undo and restore */

// Back two steps: past the left going off, to left and top both on — which
// shows the same as the top alone.
await p.click('#btn-undo');
await p.waitForTimeout(300);
await p.click('#btn-undo');
await p.waitForTimeout(300);
const undone = await read();
check(poppedOut(undone), 'undo puts the effect back as it was', show(undone));

const fetchedBefore = modelFetches.length;
await p.reload();
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(1200);
const reopened = await read();
check(poppedOut(reopened), 'the effect survives closing and reopening the app', show(reopened));
check(modelFetches.length === fetchedBefore, 'and its subject comes back from storage, not from the model again',
  `${modelFetches.length - fetchedBefore} model requests after reopening`);

/* ------------------------------------------------------------------ export */

await p.click('#btn-export-open');
const got = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await p.click('#btn-export');
await p.click('#export-share', { timeout: 120000 });
const download = await got;
if (!download) check(false, 'the export arrives');
else {
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  const out = await p.evaluate(async ([b64, pts]) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return pts.map(([x, y]) => [...g.getImageData(Math.round(bmp.width * x), Math.round(bmp.height * y), 1, 1).data].slice(0, 3));
  }, [bytes, Object.values(POINTS)]);
  const got = Object.fromEntries(Object.keys(POINTS).map((k, i) => [k, out[i]]));
  check(poppedOut(got), 'the exported file has the pop out the preview had', show(got));
}

/* ------------------------------------------------------------ clips opt out */

// A third tile, empty, and the clip put into it, as test-adjust does it.
await p.setInputFiles('#file-input', [path.join(ROOT, 'tests/fixtures/clip.webm')]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 3, null, { timeout: 15000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.locator('#filmstrip canvas').first().click();
await p.waitForTimeout(400);
if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); }
if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="1x3"]');
await p.click('#dock-back');
await p.click('#btn-photos');
await p.locator('.pm-pick[aria-label*="clip.webm"]').first().click();
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.84);
await p.waitForTimeout(300);
check(await p.locator('#tile-tabs [data-tile="trim"]').isVisible() && !(await p.locator('#tile-tabs [data-tile="effects"]').isVisible()), 'a clip does not offer Effects');
await p.click('#dock-back');
// The page is still growing back into the room the sheet gave up, and a tap
// mid-flight lands wherever the animation has got to.
await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5);
await p.waitForTimeout(300);
check(await p.locator('#tile-tabs [data-tile="effects"]').isVisible(), 'the photo above it still does');

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
