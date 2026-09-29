/* Grain: film grain, measured off the canvas.
 *
 * The photo is three flat bands, black (20), mid-grey (128) and white (235),
 * so the grain's strength at each tone can be read as the spread of levels in
 * each band, and its size as how alike neighbouring pixels are.
 *
 * What it is held to:
 * - at nought the photo is exactly as it came
 * - it moves no band's mean: grain is texture, not a change of tone
 * - it is strongest in the midtones and far weaker at black and white, as
 *   film grain is
 * - it is nearly monochrome: the spread of R-G is a small part of the spread
 *   of brightness
 * - Grain size makes the grains bigger: neighbours two post pixels apart are
 *   more alike
 * - the same grain at any size the look is drawn at, because a look is drawn
 *   at the size the tile shows it and the preview is not the export. Drawn at
 *   1080 and at about half that, the likeness of neighbours two post pixels
 *   apart must agree.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

const BANDS = [20, 128, 235];
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const v = BANDS[Math.min(2, Math.floor((x / w) * 3))];
      raw[o + 1 + x * 3] = v; raw[o + 2 + x * 3] = v; raw[o + 3 + x * 3] = v;
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
const photo = png(1440, 1440);

// The same WebGL as the Adjust test, for the same reason.
const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

// One page at a viewport, the photo in, the Adjust panel open.
async function open(width, height) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: true });
  const p = await ctx.newPage();
  await autoEnter(p);
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://localhost:${PORT}/`);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.setInputFiles('#file-input', [{ name: 'bands.png', mimeType: 'image/png', buffer: photo }]);
  await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const box = await p.locator('#canvas').boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
  await p.click('#tile-tabs [data-tile="adjust"]');
  await p.waitForTimeout(200);
  return { p, errs, ctx };
}
const set = async (p, id, value) => {
  await p.click(`.setting[data-adjust="${id}"]`);
  await p.evaluate((v) => {
    const el = document.getElementById('adjust');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await p.waitForTimeout(400);
};
// Each band's mean and spread of brightness, the spread of R-G in the grey,
// and in the grey how alike pixels `lag` post pixels apart are (the
// correlation of each with its neighbour that far to the right).
const measure = (p, lag = 2) => p.evaluate((lagPost) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const k = c.width / 1080;
  const lagPx = Math.max(1, Math.round(lagPost * k));
  const S = Math.round(120 * k);
  const band = (fx) => {
    const d = g.getImageData(Math.round(c.width * fx - S / 2), Math.round(c.height / 2 - S / 2), S, S).data;
    const y = []; const rg = [];
    for (let i = 0; i < S * S; i++) { y.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]); rg.push(d[i * 4] - d[i * 4 + 1]); }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
    let num = 0; let den = 0; const m = mean(y);
    for (let r = 0; r < S; r++) for (let x = 0; x + lagPx < S; x++) { num += (y[r * S + x] - m) * (y[r * S + x + lagPx] - m); den += (y[r * S + x] - m) ** 2; }
    return { mean: mean(y), sd: sd(y), rg: sd(rg), like: den ? num / den : 0 };
  };
  return { width: c.width, bands: [1 / 6, 1 / 2, 5 / 6].map(band) };
}, lag);
const say = (m) => m.bands.map((x, i) => `${BANDS[i]}: mean ${x.mean.toFixed(1)} sd ${x.sd.toFixed(2)}`).join('; ');

const { p, errs, ctx } = await open(1400, 1500);
const plain = await measure(p);
check(plain.bands.every((x, i) => Math.abs(x.mean - BANDS[i]) < 1 && x.sd < 0.5), 'without grain the bands are flat, as the file is', say(plain));
check(await p.locator('.setting[data-adjust="grain"]').count() === 1 && await p.locator('.setting[data-adjust="grainSize"]').count() === 1,
  'Adjust offers Grain and Grain size');

await set(p, 'grain', 50);
const half = await measure(p);
await set(p, 'grain', 100);
const full = await measure(p);
const [black, grey, white] = full.bands;
check(half.bands[1].sd > 3 && full.bands[1].sd > half.bands[1].sd * 1.6, 'Grain adds grain, and more of it the further it goes',
  `sd in the grey ${half.bands[1].sd.toFixed(2)} at 50, ${grey.sd.toFixed(2)} at 100`);
check(full.bands.every((x, i) => Math.abs(x.mean - BANDS[i]) < 2.5), 'it moves no tone: every band keeps its mean', say(full));
check(grey.sd > black.sd * 2 && grey.sd > white.sd * 2, 'strongest in the midtones, far weaker at black and at white', say(full));
check(grey.rg < grey.sd * 0.35, 'and nearly monochrome', `R-G spread ${grey.rg.toFixed(2)} against brightness ${grey.sd.toFixed(2)}`);

const fine = grey.like;
await set(p, 'grainSize', 100);
const coarse = (await measure(p)).bands[1];
check(coarse.like > fine + 0.15, 'Grain size makes the grains bigger: neighbours two post pixels apart are more alike',
  `correlation ${fine.toFixed(2)} at size 0, ${coarse.like.toFixed(2)} at 100`);
await set(p, 'grainSize', 0);

// Slider moves close together are one step of history, so however many it
// took, undo comes back to the photo as it was.
let undos = 0;
let undone = (await measure(p)).bands[1];
while (undone.sd > 0.5 && undos < 6) {
  await p.click('#btn-undo');
  await p.waitForTimeout(300);
  undos += 1;
  undone = (await measure(p)).bands[1];
}
check(undone.sd < 0.5 && Math.abs(undone.mean - 128) < 1, 'undo takes the grain back off', `${undos} undos, sd ${undone.sd.toFixed(2)}`);

// The same grain drawn at about half the size, on a narrower window.
const small = await open(420, 900);
// At the largest grain, which is 3.5 post pixels and so still more than a
// pixel across when drawn at 420; the finest is under half a pixel there, and
// no drawing that small could show it.
await set(small.p, 'grain', 100);
await set(small.p, 'grainSize', 100);
// Compared at a spacing that is whole pixels at both sizes: two pixels at
// 420 is 5.1 post pixels, and five at 1080 is 5. Two post pixels would be
// 0.78 of a pixel at 420, rounded to one, which is 2.6 post pixels and not
// the same spacing at all.
const smallWidth = await small.p.evaluate(() => document.getElementById('canvas').width);
const smallM = await measure(small.p, (2 * 1080) / smallWidth);
// Undo let go of the tile, so the panel is opened on it again.
const bigBox = await p.locator('#canvas').boundingBox();
await p.mouse.click(bigBox.x + bigBox.width / 2, bigBox.y + bigBox.height / 2);
await p.waitForTimeout(200);
await p.click('#tile-tabs [data-tile="adjust"]');
await p.waitForTimeout(200);
await set(p, 'grain', 100);
await set(p, 'grainSize', 100);
const bigM = await measure(p, 5);
check(bigM.width >= smallM.width * 1.7 && Math.abs(smallM.bands[1].like - bigM.bands[1].like) < 0.1,
  'the same size of grain whatever size the look is drawn at',
  `drawn at ${bigM.width} and ${smallM.width}: correlation five post pixels apart ${bigM.bands[1].like.toFixed(2)} and ${smallM.bands[1].like.toFixed(2)}`);

check(![...errs, ...small.errs].length, 'no errors', [...errs, ...small.errs].slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
