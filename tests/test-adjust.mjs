/* Photo edits: the Adjust panel, and the pipeline under it.
 *
 * Measured on the canvas, never taken from the panel's own numbers. The photo
 * is built to make that easy: across the top, four flat grey bands at known
 * levels, so what a tone tool does to each level can be read straight off; and
 * across the bottom, flat red, so a pipeline that turned the picture upside
 * down on its way through the GPU shows as grey where red should be.
 *
 * The tone tools are held to Google Photos itself. GOOGLE below is what Google
 * Photos made of the same four levels, and of the same red, when a calibration
 * chart carrying both was edited there at each setting and read back.
 *
 * Each adjustment adds its own section here as it arrives. The part above them
 * checks what every adjustment relies on: an untouched tile is drawn exactly
 * as before, the GPU round trip is lossless, compare shows the original, and
 * edits survive undo, a reload and an export.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import os from 'node:os'; import { execFileSync } from 'node:child_process';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webm': 'video/webm' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

const BANDS = [30, 100, 170, 230];
// The red patch on the calibration chart, so Google's own answer for it can be
// checked against directly.
const RED = [220, 40, 40];

function png(w, h, bottom = RED) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const c = y < h / 2 ? Array(3).fill(BANDS[Math.floor((x / w) * 4)]) : bottom;
      raw[o + 1 + x * 3] = c[0]; raw[o + 2 + x * 3] = c[1]; raw[o + 3 + x * 3] = c[2];
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

// A headless Chromium on a machine with no GPU only offers WebGL through
// SwiftShader, and recent builds no longer fall back to it unasked.
const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, acceptDownloads: true });
const p = await ctx.newPage();
await autoEnter(p);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`http://localhost:${PORT}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

console.log('WebGL:', await p.evaluate(() => !!document.createElement('canvas').getContext('webgl')));

// Bigger than any tile it is drawn in, as a phone photo is, so its look is
// made at the size of the tile and never scaled up after. At 480px it was
// scaled up half as much again, whose smoothing rang by two levels on its own
// and left Sharpen 100 only four levels past that.
await p.setInputFiles('#file-input', [{ name: 'bands.png', mimeType: 'image/png', buffer: png(1440, 1440) }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// The four bands across the top and the red across the bottom, off the seams.
const read = () => p.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const at = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3);
  return { bands: [0.125, 0.375, 0.625, 0.875].map((x) => at(x, 0.25)[0]), red: at(0.5, 0.75) };
});
const near = (a, want, tol) => a.every((v, i) => Math.abs(v - want[i]) <= tol);
const show = (r) => `bands ${r.bands.join('/')} red ${r.red.join(',')}`;

const untouched = await read();
check(near(untouched.bands, BANDS, 1) && near(untouched.red, RED, 1), 'an untouched tile draws exactly as the file is', show(untouched));

// Open the panel on the tile.
const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
check(await p.locator('#tile-adjust-btn').isVisible(), 'a photo tile offers Adjust');
await p.click('.dock-item[data-tile="adjust"]');
await p.waitForTimeout(200);
const tools = await p.$$eval('.adjust-tool', (els) => els.map((e) => e.dataset.adjust));
check(await p.locator('#tile-adjust').isVisible() && tools.length >= 2, 'the panel opens with a tool per adjustment', tools.join(', '));
check(await p.locator('#adjust-reset').isDisabled(), 'Reset has nothing to put back on an unedited tile');
// Each icon in the middle of its ring. `.dock-item span` once outranked the
// ring's own centring and put every icon five pixels left of it.
const offCentre = await p.$$eval('.adjust-tool .adjust-ring', (rings) => Math.max(...rings.map((r) => {
  const a = r.getBoundingClientRect(), b = r.querySelector('svg').getBoundingClientRect();
  return Math.max(Math.abs(a.x + a.width / 2 - b.x - b.width / 2), Math.abs(a.y + a.height / 2 - b.y - b.height / 2));
})));
check(offCentre <= 0.5, 'every tool\'s icon sits in the middle of its ring', `worst ${offCentre.toFixed(2)}px off`);

const choose = (id) => p.click(`.adjust-tool[data-adjust="${id}"]`);
// A drag, as far as the app can tell: input while moving, change on letting go.
const slide = async (value) => {
  await p.evaluate((v) => {
    const el = document.getElementById('adjust');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await p.waitForTimeout(250);
};

/* ---------------------------------------------- what every tool relies on */

// White point at +3 is six percent of the way to its +50 curve, which moves
// every level by a known amount of a level or two: 30/101/171/232 and red
// 222,40,40. Anything off by more than rounding is the trip through the GPU
// costing colour — a colour space conversion on upload, premultiplied alpha,
// or a precision problem. Not +1 or +2: those are close enough to nought that
// the slider catches them.
await choose('whitePoint');
await slide(3);
const tiny = await read();
check(near(tiny.bands, [30, 101, 171, 232], 1) && near(tiny.red, [222, 40, 40], 1), 'the GPU round trip is lossless', show(tiny));
check(await p.locator('#adjust-reset').isEnabled(), 'Reset wakes once there is an edit');

// What Google Photos made of the bands and the red, read off its own copies of
// the calibration chart. The grey is what the curves are built from, so it has
// to agree to within the chart's JPEG noise. The red is a separate claim — that
// the colour model is Google's too — and White and Black point, which curve
// each channel, are the loosest of it: within a level or two at the moderate
// settings, but saturated colours at ±100 come out up to fifteen levels from
// Google's. At Black point -100 Google also takes about a tenth off the
// colour of a saturated patch — red's 220 comes back as 205 — and at +100
// adds a little; the per-channel model does neither, and nothing tried yet
// accounts for it. The tolerances say how far off each one is, not how far
// off would be acceptable.
const GOOGLE = {
  'whitePoint+100': { bands: [40, 133, 226, 255], red: [255, 53, 53], redTol: 6 },
  'whitePoint-100': { bands: [29, 91, 144, 183], red: [179, 43, 43], redTol: 6 },
  'blackPoint+100': { bands: [0, 43, 148, 225], red: [221, 1, 1], redTol: 10 },
  'blackPoint-100': { bands: [61, 115, 174, 230], red: [205, 69, 69], redTol: 16 },
  'highlights-100': { bands: [30, 96, 147, 204], red: [218, 38, 39], redTol: 3 },
  'highlights+100': { bands: [30, 103, 192, 252], red: [221, 41, 42], redTol: 3 },
  // Lifting Shadows adapts to the photo, and this one — half of it the red,
  // luma 78 — is a dark photo by Google's reckoning. So these are Google's
  // numbers off the same ramp on a mostly dark surround. That chart has no
  // colour patches, so there is no red of Google's to hold this one to.
  'shadows+100': { bands: [90, 161, 188, 230] },
  // And off a mostly bright surround, for the bright photo at the end.
  'shadows+100 bright': { bands: [88, 129, 173, 230] },
  'shadows-100': { bands: [0, 73, 166, 230], red: [167, 9, 8], redTol: 4 },
};
const likeGoogle = (got, key, what) => {
  const want = GOOGLE[key];
  check(near(got.bands, want.bands, 3), `${what}, as Google Photos does`, `${show(got)}; Google ${want.bands.join('/')}`);
  if (want.red) check(near(got.red, want.red, want.redTol), `  and to the red as Google Photos does, within ${want.redTol}`, `red ${got.red.join(',')}; Google ${want.red.join(',')}`);
};

/* ------------------------------------------------------------- White point */

await slide(100);
const wpUp = await read();
likeGoogle(wpUp, 'whitePoint+100', 'White point +100 is a straight gain of a third, white from 192 up');
check(wpUp.red[0] > 250 && wpUp.red[1] < 80, 'the bottom of the photo is still the bottom', `red ${wpUp.red.join(',')}`);
check(await p.$eval('.adjust-tool[data-adjust="whitePoint"]', (e) => e.classList.contains('is-set')), 'the tool shows it is in use');

// Compare: held, the preview shows the photo as it came; let go, the edit.
const cmp = await p.locator('#adjust-compare').boundingBox();
await p.mouse.move(cmp.x + cmp.width / 2, cmp.y + cmp.height / 2);
await p.mouse.down();
await p.waitForTimeout(150);
const held = await read();
await p.mouse.up();
await p.waitForTimeout(150);
const released = await read();
check(near(held.bands, BANDS, 1), 'holding Compare shows the original', show(held));
check(near(released.bands, wpUp.bands, 1), 'letting go brings the edit back', show(released));

// The filmstrip is redrawn on letting go of the slider, so it has the edit too.
const film = await p.evaluate(() => {
  const c = document.querySelector('.film.is-current canvas');
  const d = c.getContext('2d').getImageData(Math.round(c.width * 0.625), Math.round(c.height * 0.25), 1, 1).data;
  return d[0];
});
check(Math.abs(film - wpUp.bands[2]) <= 4, 'the page thumbnail shows the edit', `band 3 ${film}, preview ${wpUp.bands[2]}`);

await slide(-100);
const wpDown = await read();
likeGoogle(wpDown, 'whitePoint-100', 'White point -100 bends the top over, white down to 183');

// Back to nought by hand lands on nought, not one either side of it.
await slide(2);
check(await p.$eval('#adjust', (e) => e.value) === '0', 'the slider catches nought on the way past');
const zero = await read();
check(near(zero.bands, BANDS, 1) && await p.locator('#adjust-reset').isDisabled(), 'nought is the photo again, with nothing left to reset', show(zero));

/* ------------------------------------------------------------- Black point */

await choose('blackPoint');
check(await p.$eval('#adjust-name', (e) => e.textContent) === 'Black point', 'choosing a tool puts the slider on it');
await slide(100);
const bpUp = await read();
likeGoogle(bpUp, 'blackPoint+100', 'Black point +100 sends everything below 64 to black');
await slide(-100);
const bpDown = await read();
likeGoogle(bpDown, 'blackPoint-100', 'Black point -100 lifts black to 41');

/* -------------------------------------------------------- undo and restore */

await p.click('#btn-undo');
await p.waitForTimeout(300);
check(near((await read()).bands, bpUp.bands, 1), 'undo steps back one slider position');
await p.click('#btn-redo');
await p.waitForTimeout(300);
check(near((await read()).bands, bpDown.bands, 1), 'redo puts it back');

await p.reload();
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(800);
const reopened = await read();
check(near(reopened.bands, bpDown.bands, 2), 'the edit survives closing and reopening the app', show(reopened));

/* ------------------------------------------------------------------ export */

await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#format', 'image/png');
const got = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await p.click('#btn-export');
const download = await got;
if (!download) check(false, 'the export arrives');
else {
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  const out = await p.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [0.125, 0.375, 0.625, 0.875].map((x) => g.getImageData(Math.round(bmp.width * x), Math.round(bmp.height * 0.25), 1, 1).data[0]);
  }, bytes);
  check(near(out, bpDown.bands, 2), 'the exported file has the edit the preview had', `bands ${out.join('/')}`);
}
await p.click('#dock-back');

/* ------------------------------------------------------------------- reset */

await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="adjust"]');
await p.waitForTimeout(200);
await p.click('#adjust-reset');
await p.waitForTimeout(300);
check(near((await read()).bands, BANDS, 1), 'Reset puts the photo back as it came');
await p.click('#btn-undo');
await p.waitForTimeout(300);
check(near((await read()).bands, bpDown.bands, 1), 'and Reset can be undone');

/* -------------------------------------------------------------- Highlights */

// Here rather than beside Black point because undo, the reload and the export
// above are all measured against Black point's last two positions, and every
// slider move in between would be one more step of history to walk back over.
// Reset first, so these read the photo as it came and nothing else.
if (!(await p.locator('#tile-adjust').isVisible())) {
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
  await p.click('.dock-item[data-tile="adjust"]');
  await p.waitForTimeout(200);
}
await p.click('#adjust-reset');
await p.waitForTimeout(300);
const plain = await read();
check(near(plain.bands, BANDS, 1) && near(plain.red, RED, 1), 'back to the photo as it came before the tone curves', show(plain));

await choose('highlights');
await slide(-100);
const hiDown = await read();
likeGoogle(hiDown, 'highlights-100', 'Highlights -100 pulls the upper tones in');
check(Math.abs(hiDown.bands[0] - 30) <= 2, 'and leaves the deep shadows alone', `30 -> ${hiDown.bands[0]}`);

await slide(100);
const hiUp = await read();
likeGoogle(hiUp, 'highlights+100', 'Highlights +100 lifts the upper tones until they clip');
check(Math.abs(hiUp.bands[0] - 30) <= 2, 'and leaves the deep shadows alone', `30 -> ${hiUp.bands[0]}`);

await slide(0);
check(near((await read()).bands, BANDS, 1), 'Highlights back at nought is the photo again');

/* ----------------------------------------------------------------- Shadows */

await choose('shadows');
await slide(100);
const shUp = await read();
likeGoogle(shUp, 'shadows+100', 'Shadows +100 on a dark photo lifts right up into the mid-tones');
check(Math.abs(shUp.bands[3] - 230) <= 2, 'and leaves the bright tones alone', `230 -> ${shUp.bands[3]}`);

await slide(-100);
const shDown = await read();
likeGoogle(shDown, 'shadows-100', 'Shadows -100 crushes everything below 32');
check(Math.abs(shDown.bands[3] - 230) <= 2, 'and leaves the bright tones alone', `230 -> ${shDown.bands[3]}`);

await slide(0);
check(near((await read()).bands, BANDS, 1) && await p.locator('#adjust-reset').isDisabled(), 'Shadows back at nought is the photo again, with nothing to reset');

/* ----------------------------------------------------------------- Sharpen */

// Here rather than beside the other tools because every slider position is a
// step in the history, and the undo, reload and export checks above count on
// the black point being the last thing done. From the photo as it came, so
// what sharpening does is measured against nothing else. Undo leaves the dock where it was, so the tile is chosen afresh.
if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); await p.click('#dock-back'); }
if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="adjust"]');
await p.waitForTimeout(200);
// Only if there is something to reset: after the tone curves there is not, and
// a disabled button is one Playwright waits on until it gives up.
if (await p.locator('#adjust-reset').isEnabled()) await p.click('#adjust-reset');
await p.waitForTimeout(300);
await choose('sharpen');
check(await p.$eval('#adjust', (e) => e.min) === '0', 'Sharpen only goes one way');

// A run of pixels across the edge between the 100 and 170 bands. Found by
// scanning, not assumed: the preview is sized to its container, so the edge
// lands wherever half the canvas happens to fall, often between two pixels.
const across = () => p.evaluate(() => {
  const c = document.getElementById('canvas');
  const row = c.getContext('2d').getImageData(0, Math.round(c.height * 0.25), c.width, 1).data;
  const from = Math.round(c.width * 0.4);
  let edge = from;
  while (edge < c.width * 0.6 && row[edge * 4] < 135) edge += 1;
  return [...Array(17)].map((_, i) => row[(edge - 8 + i) * 4]);
});
const plainRun = await across();
await slide(100);
const sharp = await read();
const sharpRun = await across();
await slide(50);
const halfRun = await across();

// Pulled out by how far the run goes past the two bands, in levels.
const past = (run) => ({ under: 100 - Math.min(...run), over: Math.max(...run) - 170 });
const runs = `before ${plainRun.join(' ')} | 100: ${sharpRun.join(' ')}`;
check(near(sharp.bands, BANDS, 1) && near(sharp.red, RED, 1), 'Sharpen 100 leaves flat parts of the photo exactly as they were', show(sharp));
check(past(plainRun).under <= 1 && past(plainRun).over <= 1, 'unsharpened, the edge goes from one band to the other and no further', plainRun.join(' '));
// Sharpen works at Google's working size, 1232px for this 1440px photo, and
// the preview here is smaller still, so the ring lands on the pixels either
// side of the step. This photo reads as a soft one — its steepest step across
// is 70 levels in a range of 200 — and is sharpened harder than the
// calibration chart, whose same edge Google took 10 under and 7 over at 1:1.
// The chart's own section at the end holds Sharpen to Google's numbers.
check(past(sharpRun).under >= 5 && past(sharpRun).over >= 5, 'Sharpen 100 darkens the dark side of an edge and lightens the light side', `${past(sharpRun).under} under, ${past(sharpRun).over} over; ${runs}`);
// Past the ring, next to nothing. A ripple running on across the band is
// what the halo guard is there to stop, but not all of it: Google's own
// 100|170 edge on the chart rises 2 over the band seven pixels out before it
// dips into its ring, and this edge, gentle enough that only the paper's
// guard holds it (see Sharpen's passes), ripples 3 four pixels out.
check(sharpRun.slice(0, 6).every((v) => Math.abs(v - 100) <= 3) && sharpRun.slice(10).every((v) => Math.abs(v - 170) <= 3),
  'the overshoot stays at the edge and the bands are within 3 of flat two pixels off', runs);
const half = past(halfRun);
check(half.under > 1 && half.over > 1 && half.under < past(sharpRun).under && half.over < past(sharpRun).over,
  'Sharpen 50 overshoots, and less than 100 does', `${half.under} under, ${half.over} over`);

// The export carries it too: flat bands untouched, the edge overshooting.
await slide(100);
if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); await p.click('#dock-back'); }
if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#format', 'image/png');
const gotSharp = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await p.click('#btn-export');
const sharpDownload = await gotSharp;
if (!sharpDownload) check(false, 'the sharpened export arrives');
else {
  const bytes = fs.readFileSync(await sharpDownload.path()).toString('base64');
  const out = await p.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const row = g.getImageData(0, Math.round(bmp.height * 0.25), bmp.width, 1).data;
    const run = [...Array(Math.round(bmp.width * 0.2))].map((_, i) => row[(Math.round(bmp.width * 0.4) + i) * 4]);
    return { bands: [0.125, 0.375, 0.625, 0.875].map((x) => row[Math.round(bmp.width * x) * 4]), run };
  }, bytes);
  check(near(out.bands, BANDS, 1) && 100 - Math.min(...out.run) >= 8 && Math.max(...out.run) - 170 >= 8,
    'the exported file is sharpened as the preview was', `bands ${out.bands.join('/')}, edge ${Math.min(...out.run)}..${Math.max(...out.run)}`);
}
await p.click('#dock-back');

// And back to nought, which is the photo again and nothing left to reset.
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="adjust"]');
await p.waitForTimeout(200);
await choose('sharpen');
await slide(0);
const unsharp = await across();
check(unsharp.every((v, i) => Math.abs(v - plainRun[i]) <= 1) && await p.locator('#adjust-reset').isDisabled(),
  'Sharpen back at nought is the photo as it came', unsharp.join(' '));

/* ------------------------------------------------------------ clips opt out */

await p.keyboard.press('Escape');
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
check(!(await p.locator('#tile-adjust-btn').isVisible()), 'a clip does not offer Adjust');
await p.click('#dock-back');
await p.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
await p.waitForTimeout(200);
check(await p.locator('#tile-adjust-btn').isVisible(), 'the photo beside it still does');

/* ------------------------------------------- Shadows on a bright photo */

// The same bands over near-white rather than red, so the median is about 235
// rather than 78. Google lifts a bright photo's shadows much less far: at
// +100 it takes 100 to 129 where the dark photo's went to 161.
// A project of its own, through the homepage the way a person makes one —
// clearing storage and reloading reopened this one, which the app had saved
// again in between.
await p.click('#btn-home');
await p.waitForFunction(() => document.body.classList.contains('on-home'));
await p.click('#btn-new');
await p.waitForFunction(() => !document.body.classList.contains('on-home'));
await p.setInputFiles('#file-input', [{ name: 'bright.png', mimeType: 'image/png', buffer: png(1440, 1440, [240, 240, 240]) }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="adjust"]');
await choose('shadows');
await slide(100);
const bright = await read();
likeGoogle(bright, 'shadows+100 bright', 'Shadows +100 on a bright photo lifts far less');
check(bright.bands[1] < shUp.bands[1] - 20, 'the same setting lifts the dark photo further', `100 -> ${bright.bands[1]} here, ${shUp.bands[1]} on the dark one`);

/* ------------------------------------------- Sharpen against Google's chart */

// The calibration chart, the same chart blurred by σ 2, and scale.mjs's patch
// of gratings on grey with and without a black and a white square, each in a
// project of its own, sharpened and exported at 2160 so it goes through at
// 1:1, as the calibration does. What Google Photos on the phone made of them
// is in calibration/google-phone.json and google-phone-scale.json, every copy
// from google-android.mjs rather than edited by hand.
const googlePhone = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/calibration/google-phone.json'), 'utf8'));
const googleScale = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/calibration/google-phone-scale.json'), 'utf8'));
const chartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-'));
execFileSync(process.execPath, [path.join(ROOT, 'tests/calibration/chart.mjs'), chartDir]);
execFileSync(process.execPath, [path.join(ROOT, 'tests/calibration/scale.mjs'), 'make', chartDir, '2160x2160']);
execFileSync(process.execPath, [path.join(ROOT, 'tests/calibration/scale.mjs'), 'make', chartDir, '2160x2160', '--bw']);
const chartPng = fs.readFileSync(path.join(chartDir, 'chart.png'));
const blurredPng = fs.readFileSync(path.join(chartDir, 'chart-blurred.png'));
const patchPng = fs.readFileSync(path.join(chartDir, 'scale-2160x2160.png'));
const patchBwPng = fs.readFileSync(path.join(chartDir, 'scale-2160x2160-bw.png'));
const layout = JSON.parse(fs.readFileSync(path.join(chartDir, 'chart.json'), 'utf8'));
fs.rmSync(chartDir, { recursive: true, force: true });

// scale.mjs's patch, as it lays it out: ten gratings 60px tall, read over a
// 768px window that every period divides.
const PATCH = { periods: [2, 3, 4, 6, 8, 12, 16, 24, 32, 48], window: 768, bandH: 60, w: 800 };
PATCH.h = PATCH.periods.length * PATCH.bandH + 140;

// Each grating's fundamental, the 100|170 edge, the flat steps and the noise
// patch, read the way measure.mjs reads them — or the patch's gratings, the
// way scale.mjs does. The noise is read again after a q90 JPEG, because every
// copy Google saves is one and it takes a sixth off faint grain.
const sharpenedChart = async (name, buffer, amount, kind = 'chart') => {
  await p.click('#btn-home');
  await p.waitForFunction(() => document.body.classList.contains('on-home'));
  await p.click('#btn-new');
  await p.waitForFunction(() => !document.body.classList.contains('on-home'));
  await p.setInputFiles('#file-input', [{ name, mimeType: 'image/png', buffer }]);
  await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
  await p.click('.dock-item[data-tile="adjust"]');
  await choose('sharpen');
  await slide(amount);
  if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); await p.click('#dock-back'); }
  if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
  await p.click('.dock-item[data-drawer="export"]');
  await p.selectOption('#quality', '2160');
  await p.selectOption('#format', 'image/png');
  const got = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await p.click('#btn-export');
  const download = await got;
  await p.click('#dock-back');
  if (!download) return null;
  return p.evaluate(async ({ b64, L, P, kind }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const fundamental = (x0, y0, w, h, per, from, mean) => {
      const d = g.getImageData(x0, y0, w, h).data;
      let cs = 0, sn = 0;
      for (let x = from; x < w - from; x++) {
        let v = 0;
        for (let y = 0; y < h; y++) v += d[(y * w + x) * 4 + 1];
        v = v / h - mean;
        cs += v * Math.cos((2 * Math.PI * x) / per); sn += v * Math.sin((2 * Math.PI * x) / per);
      }
      return (2 * Math.hypot(cs, sn)) / (w - 2 * from);
    };
    if (kind === 'disc') {
      // The row through the disc's centre, left to right.
      const d = g.getImageData(0, bmp.height / 2, bmp.width, 1).data;
      return { row: [...Array(bmp.width)].map((_, i) => d[i * 4 + 1]) };
    }
    if (kind === 'patch') {
      const x = Math.round((bmp.width - P.w) / 2), y = Math.round((bmp.height - P.h) / 2);
      // From 16px in, as scale.mjs reads it, so its phase is counted the same.
      return { fundamentals: P.periods.map((per, i) => fundamental(x, y + i * P.bandH + 12, P.w, P.bandH - 24, per, 16, 128)) };
    }
    const G = L.gratings;
    const fundamentals = G.periods.map((per, i) => fundamental(G.x, G.y + i * G.bandH + 15, G.w, G.bandH - 30, per, 20, G.mean));
    const e = L.edgeGrey;
    const edge = [...g.getImageData(e.x + e.w / 2 - 10, e.y + e.h / 2, 20, 1).data].filter((_, i) => i % 4 === 1);
    const steps = L.steps.levels.map((_, i) => g.getImageData(L.steps.x + i * L.steps.w + L.steps.w / 2, L.steps.y + L.steps.h / 2, 1, 1).data[1]);
    const spread = (gg) => {
      const d = gg.getImageData(L.noise.x + 40, L.noise.y + 40, L.noise.w - 80, L.noise.h - 80).data;
      let s1 = 0, s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { s1 += d[i + 1]; s2 += d[i + 1] ** 2; n++; }
      return Math.sqrt(s2 / n - (s1 / n) ** 2);
    };
    const jpeg = await createImageBitmap(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
    const jg = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    jg.drawImage(jpeg, 0, 0);
    return { size: bmp.width, fundamentals, edge, steps, noise: spread(g), noiseJpeg: spread(jg) };
  }, { b64: fs.readFileSync(await download.path()).toString('base64'), L: layout, P: PATCH, kind });
};
const gainsOf = (fundamentals, base) => fundamentals.map((v, i) => v / base.gratings[i].fundamental);
const PERIOD = (per) => layout.gratings.periods.indexOf(per);
const MID = [4, 6, 8, 12].map(PERIOD);
const listed = (ours, google, at) => at.map((i) => `${layout.gratings.periods[i]}px ${ours[i].toFixed(2)}/${google[i].toFixed(2)}`).join(', ');

// Google, on the chart as it was: 1.63, 2.28, 1.88 and 1.34 at 4, 6, 8 and
// 12px. The app lifts it less, 1.50, 1.82, 1.68 and 1.34, and that was
// chosen: fitted to three photographs, the chart is where the fit gives. The
// app sharpens as hard as the photo reads soft, and Google does too, but the
// chart reads about as soft as the forest, which Google sharpened half as
// hard. What else Google goes by is not known; see Sharpen's forBlur and
// calibration/README.md. Until the portrait and the forest the app was
// within 0.13 here from 6px up and 0.42 over at 4px, and the forest was
// sharpened half as hard again as Google's.
const SIX_UP = [6, 8, 12].map(PERIOD);
const FOUR = [PERIOD(4)];
const sharpChart = await sharpenedChart('chart.png', chartPng, 100);
const googleSharp = gainsOf(googlePhone['sharpen+100'].gratings.map((q) => q.fundamental), googlePhone.none);
let sharpGains = null;
if (!sharpChart) check(false, 'the sharpened chart export arrives');
else {
  sharpGains = gainsOf(sharpChart.fundamentals, googlePhone.none);
  check(sharpChart.size === 2160 && SIX_UP.every((i) => sharpGains[i] - googleSharp[i] <= 0.15 && googleSharp[i] - sharpGains[i] <= 0.5),
    'Sharpen 100 lifts the chart\'s 6 to 12px gratings no more than 0.15 past Google\'s and no more than 0.5 short', listed(sharpGains, googleSharp, SIX_UP));
  check(FOUR.every((i) => Math.abs(sharpGains[i] - googleSharp[i]) <= 0.2),
    'and the 4px one within 0.2', listed(sharpGains, googleSharp, FOUR));
  check(sharpChart.steps.every((v, i) => Math.abs(v - googlePhone.none.steps[i].out[1]) <= 1),
    'and leaves the middle of every flat step as it was', sharpChart.steps.join(' '));
  // Google's noise patch came out at 3.01, its own q90 JPEG included; the
  // chart as it came reads 3.02, and 2.59 through the same JPEG. This is
  // grain at the pixel, finer than anything in a photograph's own detail,
  // and it is where keeping the finest detail costs most: 3.25 through the
  // JPEG, where trading it had 3.10 and keeping it with the lift at 1.55
  // throughout 3.75. On the photos the app's soft ground came out no
  // grainier than Google's (the fox's soft background 1.20 in the fine band
  // against Google's 1.28), so this holds it to not much worse.
  check(sharpChart.noiseJpeg - googlePhone['sharpen+100'].noise <= 0.8,
    'and the noise patch comes out no more than 0.8 louder than Google\'s once both are JPEGs',
    `${sharpChart.noiseJpeg.toFixed(2)} (${sharpChart.noise.toFixed(2)} before the JPEG); Google ${googlePhone['sharpen+100'].noise}`);
  // Google's rings 10 under and 7 over at this edge. The app's rings 5 and
  // 11 (1 and 4 while the finest detail was traded), and what matters more
  // is that it goes no further out than Google's by much.
  const e = past(sharpChart.edge);
  const ge = past(googlePhone['sharpen+100'].edgeGrey);
  check(e.under <= ge.under + 5 && e.over <= ge.over + 5,
    'the 100|170 edge rings no further than Google\'s does', `${e.under} under, ${e.over} over; Google ${ge.under} under, ${ge.over} over`);
}

// The slider is a straight line: every grating's gain less one at 52 is 52%
// of its gain less one at 100, in Google's copies as in the app.
const halfChart = await sharpenedChart('chart.png', chartPng, 52);
const googleHalf = gainsOf(googlePhone['sharpen+52'].gratings.map((q) => q.fundamental), googlePhone.none);
if (!halfChart) check(false, 'the chart sharpened at 52 arrives');
else {
  const gains = gainsOf(halfChart.fundamentals, googlePhone.none);
  check(SIX_UP.every((i) => gains[i] - googleHalf[i] <= 0.1 && googleHalf[i] - gains[i] <= 0.3),
    'Sharpen 52 lifts the 6 to 12px ones no more than 0.1 past Google\'s and no more than 0.3 short', listed(gains, googleHalf, SIX_UP));
  check(FOUR.every((i) => Math.abs(gains[i] - googleHalf[i]) <= 0.1),
    'and the 4px one within 0.1', listed(gains, googleHalf, FOUR));
  if (sharpGains) {
    check(MID.every((i) => Math.abs((gains[i] - 1) - 0.52 * (sharpGains[i] - 1)) <= 0.02),
      'and by 52% of what 100 lifts them', MID.map((i) => `${layout.gratings.periods[i]}px ${(gains[i] - 1).toFixed(3)} against ${(0.52 * (sharpGains[i] - 1)).toFixed(3)}`).join(', '));
  }
}

// And on the blurred chart: 2.76 and 3.11 at 8 and 12px against the blurred
// chart's own, where the sharp chart got 1.88 and 1.34. The finer gratings
// are all but gone there, and there is nothing left of them to lift. The app
// comes to 2.88 and 3.19: sharpening a soft photo harder is what closed the
// 0.26 it was short at 12px.
const blurredChart = await sharpenedChart('chart-blurred.png', blurredPng, 100);
const googleBlurred = gainsOf(googlePhone['sharpen+100@blurred'].gratings.map((q) => q.fundamental), googlePhone['none@blurred']);
if (!blurredChart) check(false, 'the sharpened blurred chart export arrives');
else {
  const gains = gainsOf(blurredChart.fundamentals, googlePhone['none@blurred']);
  const at = [8, 12].map(PERIOD);
  check(at.every((i) => Math.abs(gains[i] - googleBlurred[i]) <= 0.3),
    'on the blurred chart it lifts the 8 and 12px gratings as Google Photos does, within 0.3', listed(gains, googleBlurred, at));
  if (sharpGains) {
    check(at.every((i) => gains[i] > sharpGains[i] + 0.5),
      'and leans harder on the softer photo, as Google does', at.map((i) => `${layout.gratings.periods[i]}px ${gains[i].toFixed(2)} against ${sharpGains[i].toFixed(2)}`).join(', '));
  }
}

// The same gratings on grey, where they are sharpened less than on the chart
// — 1.56 at 6px against 2.28 — because the patch's own edge is its darkest
// and lightest, and the estimate of how soft a photo is stretches it to its
// range first. A black and a white square far from the patch put it back
// with the chart: 2.31. The app has the patch at 1.66 and the squares take
// it to 2.04, half Google's difference, short for the same reason as the
// chart above; its 4px is 0.15 over Google's on the patch and 0.13 under
// with the squares.
const patchGains = async (name, buffer) => {
  const got = await sharpenedChart(name, buffer, 100, 'patch');
  const base = googleScale[name.replace('.png', '')].none.fundamentals;
  return got && got.fundamentals.map((v, i) => v / base[i]);
};
const SCALE_MID = [4, 6, 8, 12].map((per) => PATCH.periods.indexOf(per));
const scaleList = (ours, google) => SCALE_MID.map((i) => `${PATCH.periods[i]}px ${ours[i].toFixed(2)}/${google[i].toFixed(2)}`).join(', ');
const within = (ours, google) => SCALE_MID.every((i) => Math.abs(ours[i] - google[i]) <= 0.3);
const plainPatch = await patchGains('scale-2160x2160.png', patchPng);
const bwPatch = await patchGains('scale-2160x2160-bw.png', patchBwPng);
if (!plainPatch || !bwPatch) check(false, 'the sharpened patches arrive');
else {
  const gp = googleScale['scale-2160x2160']['sharpen+100'].gains;
  const gb = googleScale['scale-2160x2160-bw']['sharpen+100'].gains;
  check(within(plainPatch, gp),
    'the patch of gratings on grey is lifted as Google lifts it, within 0.3 from 4 to 12px', scaleList(plainPatch, gp));
  check(within(bwPatch, gb),
    'and with a black and a white square beside it, as Google lifts that', scaleList(bwPatch, gb));
  const six = PATCH.periods.indexOf(6);
  check(bwPatch[six] > plainPatch[six] + 0.3,
    'the squares alone make the same gratings sharpen harder, as they did in Google Photos', `6px ${bwPatch[six].toFixed(2)} against ${plainPatch[six].toFixed(2)}`);
}

/* --------------------------------------- Sharpen on a soft, bright edge */

// The softer a photo reads, the harder it is sharpened, and on the blurred
// chart that once drew a dark ring round the sun and a dark line along every
// cloud: 18 levels below the sky just outside the sun, where Google's copy
// dips 2. Nothing above caught it, because the gratings have no flat ground
// beside them to ring into. So: a bright disc on a mid grey, its edge soft as
// a Gaussian of σ 3, exported at 2160 so it goes through at 1:1. The edge
// should come out steeper and ring no more than Google rang at the sun, 2
// under and 3 over, and a level or two for the JPEG it saved. The build that
// drew the ring rings this disc 18 under and 10 over; now 2 and 2, the edge
// 13 levels a pixel at its steepest as it came and 25 sharpened.
const discPng = Buffer.from(await p.evaluate(async () => {
  const N = 2160, R = 300, SIGMA = 3, SKY = 150, SUN = 245;
  // Abramowitz and Stegun 7.1.26, to within 1.5e-7.
  const erf = (x) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
    return x < 0 ? -y : y;
  };
  const c = new OffscreenCanvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2);
      const v = Math.round(SKY + (SUN - SKY) * 0.5 * (1 - erf((r - R) / (SIGMA * Math.SQRT2))));
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())];
}));
const disc = await sharpenedChart('disc.png', discPng, 100, 'disc');
if (!disc) check(false, 'the sharpened disc arrives');
else {
  // Both edges of the row, from the edge's midpoint out 50px into the grey
  // and in 50px into the disc. As it came the edge never leaves 150..245,
  // so anything past those is ring. The ring was close in — 2 to 8px past
  // the midpoint, down to 132 — and read from 20px out, as this first was,
  // the check passed on the build that drew it.
  const outside = [...disc.row.slice(1080 - 350, 1080 - 300), ...disc.row.slice(1080 + 300, 1080 + 350)];
  const inside = [...disc.row.slice(1080 - 300, 1080 - 250), ...disc.row.slice(1080 + 250, 1080 + 300)];
  const under = 150 - Math.min(...outside);
  const over = Math.max(...inside) - 245;
  const edge = disc.row.slice(1080 + 280, 1080 + 320);
  const steepest = Math.max(...edge.slice(1).map((v, i) => Math.abs(v - edge[i])));
  // The disc as it came climbs 13 levels a pixel at its steepest.
  check(steepest >= 18, 'Sharpen 100 steepens a soft edge', `${steepest} levels a pixel at its steepest, against 13 as it came`);
  check(under <= 5 && over <= 5,
    'and a bright disc on grey rings no more than 5 levels either side of it, where Google rang the blurred chart\'s sun 2 and 3',
    `${under} under, ${over} over`);
}

/* ------------------------------------- Sharpen on a photograph's texture */

// The gratings above say how Google treats stripes, and a Sharpen held only
// to them came out clearly softer than Google's on real photographs: on a
// fox through Google Photos on the phone, 12px detail was lifted ×2.03 at
// 100 where the app managed ×1.51, and 2px detail kept ×0.95 where the app
// left ×0.48. The photos cannot be kept here, so this generates a stand-in
// with a photograph's make-up — short strands at every angle over soft
// mottling, most faint and a few strong, so its steepest slopes thin out
// the way a photo's do — and holds the app to what Google did to the fox,
// period by period (calibration/google-phone-real.json, read as
// calibration/transfer.mjs reads it).
//
// 3888x2592, a ten megapixel phone photo's shape, which covers a 2160
// export at exactly 3240 wide: drawn at a fraction of a pixel, an edited
// tile is resampled once more on its way out and loses its finest detail
// whatever the edit, which would be measured instead. Its fortieth steepest
// slopes read σ 1.07 and 1.05 across and down, the fox's 1.15 and 1.08, so
// it is sharpened a little less hard than the fox was.
const { transfer, PERIODS: TRANSFER_PERIODS } = await import('./calibration/transfer.mjs');
const googleReal = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/calibration/google-phone-real.json'), 'utf8'));
const texture = Buffer.from(await p.evaluate(async () => {
  const W = 3888, H = 2592;
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  // Mottling: random greys on grids 16 to 128px apart, bilinearly between.
  const acc = new Float32Array(W * H);
  [[16, 20], [32, 30], [64, 40], [128, 50]].forEach(([s, amp]) => {
    const gw = Math.ceil(W / s) + 2;
    const grid = Float32Array.from({ length: gw * (Math.ceil(H / s) + 2) }, () => rnd() - 0.5);
    for (let y = 0; y < H; y++) {
      const fy = y / s, y0 = Math.floor(fy), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = x / s, x0 = Math.floor(fx), tx = fx - x0, i = y0 * gw + x0;
        const top = grid[i] + tx * (grid[i + 1] - grid[i]);
        const bot = grid[i + gw] + tx * (grid[i + gw + 1] - grid[i + gw]);
        acc[y * W + x] += amp * (top + ty * (bot - top));
      }
    }
  });
  const img = g.createImageData(W, H);
  for (let i = 0; i < acc.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(128 + acc[i])));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let n = 0; n < 90000; n++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, len = 8 + 40 * rnd();
    const v = Math.round(255 * rnd());
    g.strokeStyle = `rgba(${v},${v},${v},${(0.15 + 0.85 * rnd() ** 6).toFixed(3)})`;
    g.lineWidth = 1 + 2.5 * rnd();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * Math.cos(a), y + len * Math.sin(a)); g.stroke();
  }
  // Softened a little, as a lens and a phone's processing leave a photo.
  const k = [0, 1, 2, 3].map((i) => Math.exp(-(i * i) / 2));
  const sum = k[0] + 2 * (k[1] + k[2] + k[3]);
  const im = g.getImageData(0, 0, W, H);
  const src = Float32Array.from({ length: W * H }, (_, i) => im.data[i * 4]);
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = k[0] * src[y * W + x];
    for (let i = 1; i <= 3; i++) v += k[i] * (src[y * W + Math.max(0, x - i)] + src[y * W + Math.min(W - 1, x + i)]);
    tmp[y * W + x] = v / sum;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = k[0] * tmp[y * W + x];
    for (let i = 1; i <= 3; i++) v += k[i] * (tmp[Math.max(0, y - i) * W + x] + tmp[Math.min(H - 1, y + i) * W + x]);
    const o = (y * W + x) * 4;
    im.data[o] = im.data[o + 1] = im.data[o + 2] = Math.round(v / sum);
  }
  g.putImageData(im, 0, 0);
  const u8 = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}), 'base64');

await p.click('#btn-home');
await p.waitForFunction(() => document.body.classList.contains('on-home'));
await p.click('#btn-new');
await p.waitForFunction(() => !document.body.classList.contains('on-home'));
await p.setInputFiles('#file-input', [{ name: 'strands.jpg', mimeType: 'image/jpeg', buffer: texture }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1, null, { timeout: 30000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="adjust"]');
await choose('sharpen');
await slide(100);
if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); await p.click('#dock-back'); }
if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#quality', '2160');
await p.selectOption('#format', 'image/png');
const gotTexture = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await p.click('#btn-export');
const textureDownload = await gotTexture;
await p.click('#dock-back');
if (!textureDownload) check(false, 'the sharpened stand-in arrives');
else {
  // Brightness of the stand-in drawn into the export as the app draws it,
  // centred and covering, and of the export itself.
  const [before, after] = await p.evaluate(async ({ photo, exported }) => {
    const frame = async (b64, mime) => {
      const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
      const g = new OffscreenCanvas(2160, 2160).getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const s = Math.max(2160 / bmp.width, 2160 / bmp.height);
      g.drawImage(bmp, 1080 - (bmp.width * s) / 2, 1080 - (bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      const d = g.getImageData(0, 0, 2160, 2160).data;
      return Array.from({ length: 2160 * 2160 }, (_, i) => Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]));
    };
    return [await frame(photo, 'image/jpeg'), await frame(exported, 'image/png')];
  }, { photo: texture.toString('base64'), exported: fs.readFileSync(await textureDownload.path()).toString('base64') });
  const gains = transfer(Float64Array.from(before), Float64Array.from(after), 2160, 2160);
  const fox = googleReal.fox.settings['100'].transfer;
  const at = (periods) => periods.map((q) => TRANSFER_PERIODS.indexOf(q));
  const shown = (idx) => idx.map((i) => `${TRANSFER_PERIODS[i]}px ${gains[i].toFixed(2)}/${fox[i].toFixed(2)}`).join(', ');
  // Google kept the fox's 2.5 and 3px detail at ×1.09 and ×1.20. Trading it
  // for the copy's, as the gratings once said to, left the stand-in ×0.57
  // and ×0.83.
  const finest = at([2.5, 3]);
  check(finest.every((i) => gains[i] >= 0.9),
    'Sharpen 100 keeps a photograph\'s finest detail rather than trading it away', shown(finest));
  // And from 3 to 24px it lifts as Google lifted the fox, within 0.3. With
  // σ read off the single steepest slope, as it was, the stand-in peaked at
  // 6 to 8px and its 12px detail came out ×1.45 against Google's ×2.03.
  const body = at([3, 4, 5, 6, 8, 10, 12, 16, 24]);
  check(body.every((i) => Math.abs(gains[i] - fox[i]) <= 0.3),
    'and lifts the rest of its detail as Google lifted the fox\'s, within 0.3 from 3 to 24px', shown(body));
}

/* -------------------------------------------------- Tone against Google's */

// Tone is on the phone only, and looks at the whole photo: the same grey 128
// came out of Google's +100 lighter or darker by what was round it. What
// Google made of the calibration chart is in calibration/google-phone-tone.json.
// The chart is toned in a project of its own and exported at 2160, and read
// at the same places: the grey in each of its settings, the 32 steps, and the
// dark ground's coarse texture — a 7px box blur less a 31px one, its RMS over
// the same of the chart as it was.
const googleTone = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/calibration/google-phone-tone.json'), 'utf8'));
const CONTEXTS = {
  background: [1080, 1275], 'strip beside the black block': [30, 650], 'patch on 0': [299, 650], 'patch on 64': [820, 650],
  'patch on 192': [1341, 650], 'patch on 255': [1862, 650], 'surround 0': [100, 650], 'surround 255': [1700, 650],
};
const tonedChart = async (amount) => {
  await p.click('#btn-home');
  await p.waitForFunction(() => document.body.classList.contains('on-home'));
  await p.click('#btn-new');
  await p.waitForFunction(() => !document.body.classList.contains('on-home'));
  await p.setInputFiles('#file-input', [{ name: 'chart.png', mimeType: 'image/png', buffer: chartPng }]);
  await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
  await p.click('.dock-item[data-tile="adjust"]');
  await choose('tone');
  const oneWay = await p.$eval('#adjust', (e) => e.min === '0');
  await slide(amount);
  if (await p.locator('#dp-tile').isVisible()) { await p.click('#dock-back'); await p.click('#dock-back'); }
  if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
  await p.click('.dock-item[data-drawer="export"]');
  await p.selectOption('#quality', '2160');
  await p.selectOption('#format', 'image/png');
  const got = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await p.click('#btn-export');
  const download = await got;
  await p.click('#dock-back');
  if (!download) return null;
  return {
    oneWay,
    ...await p.evaluate(async ({ b64, original, L, points }) => {
      const read = async (data) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        return g;
      };
      const mean = (g, x, y, r) => {
        const d = g.getImageData(x - r, y - r, 2 * r + 1, 2 * r + 1).data;
        const s = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
        return s.map((v) => Math.round(v / (d.length / 4)));
      };
      const band = (g) => {
        const [x, y, w, h] = [256, 1990, 1600, 80];
        const d = g.getImageData(x - 16, y - 16, w + 32, h + 32).data;
        const W = w + 32, H = h + 32;
        // Summed-area table of luma, for both box blurs at once.
        const sat = new Float64Array((W + 1) * (H + 1));
        for (let j = 0; j < H; j++) {
          for (let i = 0; i < W; i++) {
            const o = (j * W + i) * 4;
            sat[(j + 1) * (W + 1) + i + 1] = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]
              + sat[j * (W + 1) + i + 1] + sat[(j + 1) * (W + 1) + i] - sat[j * (W + 1) + i];
          }
        }
        const box = (cx, cy, r) => (sat[(cy + r + 1) * (W + 1) + cx + r + 1] - sat[(cy - r) * (W + 1) + cx + r + 1]
          - sat[(cy + r + 1) * (W + 1) + cx - r] + sat[(cy - r) * (W + 1) + cx - r]) / (2 * r + 1) ** 2;
        let s2 = 0, n = 0;
        for (let j = 16; j < H - 16; j += 2) for (let i = 16; i < W - 16; i += 2) { const v = box(i, j, 3) - box(i, j, 15); s2 += v * v; n++; }
        return Math.sqrt(s2 / n);
      };
      const g = await read(b64);
      const before = await read(original);
      return {
        contexts: Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, mean(g, x, y, 8)])),
        steps: L.steps.levels.map((_, i) => mean(g, L.steps.x + i * L.steps.w + L.steps.w / 2, L.steps.y + L.steps.h / 2, 12)[1]),
        texture: band(g) / band(before),
      };
    }, { b64: fs.readFileSync(await download.path()).toString('base64'), original: chartPng.toString('base64'), L: layout, points: CONTEXTS }),
  };
};
const grey = (rgb) => rgb[1];
const stepsBetween = (toned, google, lo, hi) => layout.steps.levels.map((lv, i) => [lv, toned[i], google[i][1]]).filter(([lv]) => lv >= lo && lv <= hi);
const listedSteps = (rows) => rows.map(([lv, o, g]) => `${lv}:${o}/${g}`).join(' ');

const tone100 = await tonedChart(100);
const google100 = googleTone.chart['tone+100'];
if (!tone100) check(false, 'the toned chart export arrives');
else {
  check(tone100.oneWay, 'Tone only goes one way');
  const bg = grey(tone100.contexts.background);
  check(Math.abs(bg - grey(google100.contexts.background)) <= 4,
    'Tone 100 lifts open grey 128 as Google\'s does, within 4 levels', `${bg} against Google's ${grey(google100.contexts.background)}`);
  // The local part. Google's +100 took the same 128 to 158 in the open, 162
  // on a 64 surround, 146 on 192, 142 on white and 146 in the strip beside
  // the black block, flat across each patch; the app to 155, 159, 147, 152
  // and 153 — the right way round each time, but on white and beside black
  // by a quarter as much. Fitted to the photographs too, the fusion is
  // gentler than the chart alone asked for. On black Google's went to 142
  // and the app's does not follow at all. See Tone in app.js.
  const c = Object.fromEntries(Object.entries(tone100.contexts).map(([k, v]) => [k, grey(v)]));
  check(c['patch on 64'] > bg && c['patch on 192'] < bg - 3 && c['patch on 255'] < bg && c['strip beside the black block'] < bg,
    'and like Google\'s, lifts it further on a dark surround and less on a light one or beside black',
    `open ${bg}, on 64 ${c['patch on 64']}, on 192 ${c['patch on 192']}, on 255 ${c['patch on 255']}, strip ${c['strip beside the black block']}; Google 158, 162, 146, 142, 146`);
  check(c['surround 0'] === 0 && Math.abs(c['surround 255'] - grey(google100.contexts['surround 255'])) <= 3,
    'black stays black and white stays within 3 of where Google\'s put it', `black ${c['surround 0']}, white ${c['surround 255']} against ${grey(google100.contexts['surround 255'])}`);
  // The shadows and middle to within 8 of Google's steps; above that the app
  // is brighter, by as much as 11 at 197, where Google holds its highlights
  // still. Holding them here too cost as much on the colour grid, which
  // Google's lifted, as it saved on the chart.
  const low = stepsBetween(tone100.steps, google100.steps, 16, 156);
  check(low.every(([, o, g]) => Math.abs(o - g) <= 8), 'the steps from 16 to 156 come within 8 levels of Google\'s', listedSteps(low));
  const high = stepsBetween(tone100.steps, google100.steps, 165, 247);
  check(high.every(([, o, g]) => o - g <= 12 && g - o <= 3), 'and from 165 up no more than 12 brighter', listedSteps(high));
  // Detail in the shadows lifted with them, as Google's is: ×1.33 of the
  // ground's coarse texture against ×1.54 here. Held level where the small
  // copy has no pixels, it was ×1.08, the shadows lifted and left flat. On
  // the photographs, which cannot be committed, the app's detail by region
  // came within 0.07 of Google's at +100 everywhere but the portrait's soft
  // background (calibration/google-phone-tone.json), so the chart's ground
  // is held to within 0.25.
  check(tone100.texture > 1.2 && Math.abs(tone100.texture - googleTone.detail['ground band, tone+100']) <= 0.25,
    'and the dark ground\'s texture is lifted with it, within 0.25 of Google\'s',
    `×${tone100.texture.toFixed(2)} against ×${googleTone.detail['ground band, tone+100']}`);
}

const tone54 = await tonedChart(54);
const google54 = googleTone.chart['tone+54'];
if (!tone54) check(false, 'the chart toned at 54 arrives');
else {
  const low = stepsBetween(tone54.steps, google54.steps, 16, 156);
  check(low.every(([, o, g]) => Math.abs(o - g) <= 9), 'Tone 54 comes within 9 levels of Google\'s steps from 16 to 156', listedSteps(low));
  check(tone100 && grey(tone54.contexts.background) < grey(tone100.contexts.background) && grey(tone54.contexts.background) > 136,
    'and lifts open grey less than 100 does, and well clear of nothing', `${grey(tone54.contexts.background)} against ${tone100 && grey(tone100.contexts.background)}; Google 144`);
}

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
