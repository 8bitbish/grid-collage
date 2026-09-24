/* Photo edits: the Adjust panel, and the pipeline under it.
 *
 * Measured on the canvas, never taken from the panel's own numbers. The photo
 * is built to make that easy: across the top, four flat grey bands at known
 * levels, so what a tone tool does to each level can be read straight off; and
 * across the bottom, flat red, so a pipeline that turned the picture upside
 * down on its way through the GPU shows as grey where red should be.
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
const RED = [200, 40, 40];

function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const c = y < h / 2 ? Array(3).fill(BANDS[Math.floor((x / w) * 4)]) : RED;
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

await p.setInputFiles('#file-input', [{ name: 'bands.png', mimeType: 'image/png', buffer: png(480, 480) }]);
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

// White point at +3 divides by 0.9895, which moves every level by a known
// amount of about one percent: 30/101/172/232 and red 202,40,40. Anything off
// by more than rounding is the trip through the GPU costing colour — a colour
// space conversion on upload, premultiplied alpha, or a precision problem.
// Not +1 or +2: those are close enough to nought that the slider catches them.
await choose('whitePoint');
await slide(3);
const tiny = await read();
check(near(tiny.bands, [30, 101, 172, 232], 1) && near(tiny.red, [202, 40, 40], 1), 'the GPU round trip is lossless', show(tiny));
check(await p.locator('#adjust-reset').isEnabled(), 'Reset wakes once there is an edit');

/* ------------------------------------------------------------- White point */

await slide(100);
const wpUp = await read();
// Anything from 0.65 up becomes white: 30 -> 46, 100 -> 154, 170 and 230 -> 255.
check(near(wpUp.bands, [46, 154, 255, 255], 3), 'White point +100 stretches the top end to white', show(wpUp));
check(wpUp.red[0] > 250 && wpUp.red[1] > 55 && wpUp.red[1] < 70, 'the bottom of the photo is still the bottom', `red ${wpUp.red.join(',')}`);
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
check(film > 245, 'the page thumbnail shows the edit', `band 3 ${film}`);

await slide(-100);
const wpDown = await read();
// White is drawn at 0.65: 230 -> 150, 30 -> 20.
check(near(wpDown.bands, [20, 65, 111, 150], 3), 'White point -100 greys the whites and leaves black', show(wpDown));

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
// Everything below a quarter goes to black: 30 -> 0, 100 -> 49, 230 stays near.
check(near(bpUp.bands, [0, 49, 142, 222], 3), 'Black point +100 crushes the shadows and keeps white', show(bpUp));
await slide(-100);
const bpDown = await read();
// Black lifted to a quarter: 30 -> 86, 230 -> 236.
check(near(bpDown.bands, [86, 139, 191, 236], 3), 'Black point -100 lifts black and keeps white', show(bpDown));

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

// The red is saturated and has green equal to blue, so its hue is kept exactly
// when green over red and blue over red both stay at the file's 0.2.
const keepsHue = (r) => Math.abs(r.red[1] / r.red[0] - RED[1] / RED[0]) <= 0.01 && Math.abs(r.red[2] - r.red[1]) <= 1;

await choose('highlights');
await slide(-100);
const hiDown = await read();
// The curve's own numbers: 170 -> 140, 230 -> 216, 30 exactly where it was.
check(near(hiDown.bands, [30, 91, 140, 216], 3), 'Highlights -100 pulls the bright tones down', show(hiDown));
check(Math.abs(hiDown.bands[0] - 30) <= 2, 'and leaves the deep shadows alone', `30 -> ${hiDown.bands[0]}`);
check(230 - hiDown.bands[3] < 230 - wpDown.bands[3], 'gentler than White point at -100', `230 -> ${hiDown.bands[3]}, White point ${wpDown.bands[3]}`);
check(keepsHue(hiDown), 'red keeps its hue', `red ${hiDown.red.join(',')}`);

await slide(100);
const hiUp = await read();
check(near(hiUp.bands, [30, 109, 200, 244], 3), 'Highlights +100 brightens the bright tones without clipping them', show(hiUp));
check(Math.abs(hiUp.bands[0] - 30) <= 2, 'and leaves the deep shadows alone', `30 -> ${hiUp.bands[0]}`);
check(hiUp.bands[2] - 170 < wpUp.bands[2] - 170, 'gentler than White point at +100', `170 -> ${hiUp.bands[2]}, White point ${wpUp.bands[2]}`);
check(keepsHue(hiUp), 'red keeps its hue', `red ${hiUp.red.join(',')}`);

await slide(0);
check(near((await read()).bands, BANDS, 1), 'Highlights back at nought is the photo again');

/* ----------------------------------------------------------------- Shadows */

await choose('shadows');
await slide(100);
const shUp = await read();
// 30 -> 47 and 100 -> 128, with 230 exactly where it was.
check(near(shUp.bands, [47, 128, 173, 230], 3), 'Shadows +100 opens up the dark tones', show(shUp));
check(Math.abs(shUp.bands[3] - 230) <= 2, 'and leaves the bright tones alone', `230 -> ${shUp.bands[3]}`);
check(shUp.bands[0] - 30 < bpDown.bands[0] - 30, 'gentler than Black point lifting black', `30 -> ${shUp.bands[0]}, Black point ${bpDown.bands[0]}`);
// The red counts as a mid-tone, halfway between its luma and its red channel,
// so it is lifted by about a tenth: to around 223,45,45. Measured by luma alone
// it was a shadow and went to 255,51,51, which is the neon this guards against.
check(keepsHue(shUp) && shUp.red[0] > 210 && shUp.red[0] < 240, 'red is lifted as a mid-tone, not as a shadow, and keeps its hue', `red ${shUp.red.join(',')}`);

await slide(-100);
const shDown = await read();
check(near(shDown.bands, [13, 72, 167, 230], 3), 'Shadows -100 deepens the dark tones', show(shDown));
check(Math.abs(shDown.bands[3] - 230) <= 2, 'and leaves the bright tones alone', `230 -> ${shDown.bands[3]}`);
check(100 - shDown.bands[1] < 100 - bpUp.bands[1], 'gentler than Black point crushing', `100 -> ${shDown.bands[1]}, Black point ${bpUp.bands[1]}`);
check(keepsHue(shDown), 'red keeps its hue', `red ${shDown.red.join(',')}`);

await slide(0);
check(near((await read()).bands, BANDS, 1) && await p.locator('#adjust-reset').isDisabled(), 'Shadows back at nought is the photo again, with nothing to reset');

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

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
