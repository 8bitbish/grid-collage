/* The colour tools: Brightness, Contrast, Saturation, Warmth, Tint, Skin tone
 * and Blue tone, held to Google Photos.
 *
 * Each is drawn from a table of Google's own output for 13 x 13 x 13 colours
 * (colour-tables.png; see tests/calibration/README.md). The photo here is
 * eight flat colours that are not among those 2197 — skin, orange, sky,
 * green, red, purple, grey and a pale yellow, all from the 9 x 9 x 9 chart
 * that was put through Google Photos separately — so what is checked is the
 * table and the interpolation between its colours both, against Google's
 * answer for colours the table never saw.
 *
 * GOOGLE is what Google Photos made of those eight at +100, read off its
 * copies of the 9³ chart (Tint's off the copy on black, the same colours).
 * Measured on the canvas, never taken from the panel's own numbers.
 *
 * Also: the tables are not fetched until a colour tool is wanted, a tile
 * drawn before they arrive is drawn again once they have, and an export
 * waits for them.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

const COLOURS = {
  skin: [223, 159, 128], orange: [223, 128, 64], sky: [96, 159, 223], green: [64, 159, 64],
  red: [191, 32, 32], purple: [159, 64, 191], grey: [128, 128, 128], pale: [223, 223, 159],
};
const NAMES = Object.keys(COLOURS);
const GOOGLE = {
  brightness: { skin: [255, 218, 199], orange: [255, 197, 147], sky: [178, 229, 255], green: [133, 250, 135], red: [254, 98, 100], purple: [240, 146, 255], grey: [214, 214, 214], pale: [251, 252, 186] },
  contrast: { skin: [255, 192, 161], orange: [255, 153, 80], sky: [121, 190, 255], green: [70, 194, 72], red: [211, 5, 5], purple: [186, 53, 230], grey: [154, 154, 154], pale: [247, 247, 177] },
  saturation: { skin: [255, 145, 94], orange: [253, 113, 15], sky: [57, 160, 253], green: [11, 173, 12], red: [238, 4, 5], purple: [192, 39, 241], grey: [128, 128, 128], pale: [226, 226, 102] },
  warmth: { skin: [255, 153, 78], orange: [255, 121, 8], sky: [133, 153, 164], green: [103, 153, 6], red: [213, 29, 1], purple: [188, 60, 147], grey: [167, 122, 67], pale: [243, 219, 129] },
  tint: { skin: [254, 144, 158], orange: [254, 113, 96], sky: [132, 144, 254], green: [101, 144, 99], red: [211, 25, 48], purple: [185, 53, 216], grey: [166, 113, 163], pale: [240, 215, 174] },
  skinTone: { skin: [249, 151, 106], orange: [255, 116, 23], sky: [95, 159, 223], green: [64, 159, 65], red: [192, 32, 32], purple: [159, 64, 190], grey: [128, 128, 127], pale: [223, 223, 159] },
  blueTone: { skin: [224, 159, 129], orange: [223, 128, 64], sky: [0, 110, 221], green: [64, 159, 65], red: [192, 32, 32], purple: [159, 64, 190], grey: [128, 128, 128], pale: [223, 223, 159] },
};

// Four across, two down, 1440 square, so on the default 1:1 page each patch
// is a quarter of the width and half the height of the tile.
function png(w = 1440, h = 1440) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = COLOURS[NAMES[Math.floor((x / w) * 4) + 4 * Math.floor((y / h) * 2)]];
      raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
// No service worker: it keeps the tables in its cache and answers for them
// itself, where neither the count of requests nor the held-back one below
// could see.
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
const p = await ctx.newPage();
await autoEnter(p);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let fetched = 0;
p.on('request', (r) => { if (r.url().includes('colour-tables.png')) fetched += 1; });
await p.goto(`http://localhost:${PORT}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

await p.setInputFiles('#file-input', [{ name: 'colours.png', mimeType: 'image/png', buffer: png() }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

const readCanvas = () => p.evaluate((names) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  return Object.fromEntries(names.map((n, i) => {
    const x = Math.round(c.width * (0.125 + 0.25 * (i % 4)));
    const y = Math.round(c.height * (0.25 + 0.5 * Math.floor(i / 4)));
    return [n, [...g.getImageData(x, y, 1, 1).data].slice(0, 3)];
  }));
}, NAMES);
const off = (got, want) => Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
const offAll = (got, want) => NAMES.map((n) => off(got[n], want[n]));

const plain = await readCanvas();
check(Math.max(...offAll(plain, COLOURS)) <= 1, 'the eight colours draw as they are', NAMES.map((n) => plain[n].join(',')).join(' '));
check(fetched === 0, 'nothing has fetched the colour tables yet', `${fetched} requests`);

const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('#tile-tabs [data-tile="adjust"]');
await p.waitForTimeout(200);
const tools = await p.$$eval('.adjust-tool', (els) => els.map((e) => e.dataset.adjust));
const WANT = ['brightness', 'contrast', 'whitePoint', 'highlights', 'shadows', 'blackPoint', 'saturation', 'warmth', 'tint', 'skinTone', 'blueTone'];
check(WANT.every((id, i) => tools.indexOf(id) >= 0 && (i === 0 || tools.indexOf(id) > tools.indexOf(WANT[i - 1]))),
  'the panel lists them in Google\'s order, among the tone tools', tools.join(', '));

const choose = (id) => p.click(`.adjust-tool[data-adjust="${id}"]`);
const slide = async (value) => {
  await p.evaluate((v) => {
    const el = document.getElementById('adjust');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await p.waitForTimeout(300);
};

await choose('warmth');
check(await p.$eval('#adjust', (e) => `${e.min}..${e.max}`) === '-100..100', 'a colour tool runs from -100 to +100');
// However soon the slider moves, the tile ends up with the tables in it:
// drawn without them if they are not here yet, and again once they are.
await slide(100);
await p.waitForFunction((want) => {
  const c = document.getElementById('canvas');
  const d = c.getContext('2d').getImageData(Math.round(c.width * 0.625), Math.round(c.height * 0.75), 1, 1).data;
  return Math.abs(d[0] - want[0]) + Math.abs(d[1] - want[1]) + Math.abs(d[2] - want[2]) < 12;
}, GOOGLE.warmth.grey, { timeout: 15000 }).catch(() => null);
check(fetched === 1, 'choosing a colour tool fetched the tables, once', `${fetched} requests`);
await slide(0);

// A tool that went missing or ran as some other tool would miss by tens of
// levels. Within 4 on average is the table and its interpolation working;
// the worst single colour is red under Skin tone, 15 out, at the edge of
// skin's band where the table's 13 levels are coarsest.
for (const [id, want] of Object.entries(GOOGLE)) {
  await choose(id);
  await slide(100);
  const got = await readCanvas();
  const e = offAll(got, want);
  const mean = e.reduce((t, x) => t + x, 0) / e.length;
  const moved = offAll(want, COLOURS).reduce((t, x) => t + x, 0) / e.length;
  check(mean <= 4 && Math.max(...e) <= 16, `${id} +100 lands where Google's did`,
    `${mean.toFixed(1)} levels out on average, ${Math.max(...e).toFixed(1)} at worst, on a move of ${moved.toFixed(1)}`);
  await slide(0);
}
// White point and Black point are curves, read off greys, with Google's
// tables correcting the colour they carry (FIX in app.js); Highlights is a
// curve whose own rule already carries colour as Google does. What Google
// made of the same eight at ±100, off its copies of the 9³ chart, which
// the tables never saw. White and Black point's rules alone came out 5.6
// to 11.3 levels out on average on these eight, and 18 at worst; with the
// tables, 1.3 to 2.9. Highlights, 0.9 and 1.0. The worst single
// colour is red under Black point +100, 10 out: its green and blue fall
// between the grid's 21 and 43, just where +100 bends everything below 64
// to black, and the table cuts that corner.
const CURVED = {
  'whitePoint+100': { skin: [255, 208, 182], orange: [255, 166, 98], sky: [139, 205, 255], green: [85, 211, 86], red: [255, 43, 42], purple: [211, 86, 252], grey: [171, 171, 171], pale: [253, 254, 212] },
  'whitePoint-100': { skin: [184, 136, 114], orange: [185, 114, 68], sky: [89, 137, 185], green: [66, 138, 65], red: [160, 36, 36], purple: [134, 63, 157], grey: [114, 114, 114], pale: [181, 180, 134] },
  'blackPoint+100': { skin: [228, 131, 88], orange: [231, 88, 10], sky: [36, 133, 230], green: [9, 135, 10], red: [165, 0, 0], purple: [138, 4, 187], grey: [88, 88, 88], pale: [217, 216, 124] },
  'blackPoint-100': { skin: [216, 166, 143], orange: [213, 139, 90], sky: [114, 164, 213], green: [89, 162, 89], red: [185, 62, 63], purple: [161, 87, 184], grey: [138, 138, 138], pale: [223, 223, 173] },
  'highlights+100': { skin: [246, 181, 151], orange: [236, 141, 77], sky: [110, 174, 238], green: [73, 168, 74], red: [193, 33, 33], purple: [161, 66, 192], grey: [137, 137, 136], pale: [252, 252, 188] },
  'highlights-100': { skin: [201, 136, 106], orange: [209, 114, 50], sky: [79, 143, 207], green: [53, 148, 54], red: [191, 31, 31], purple: [156, 61, 187], grey: [119, 119, 118], pale: [193, 193, 129] },
};
for (const [setting, want] of Object.entries(CURVED)) {
  const [, id, value] = /^([a-zA-Z]+)([+-]\d+)$/.exec(setting);
  await choose(id);
  await slide(Number(value));
  const got = await readCanvas();
  const e = offAll(got, want);
  const mean = e.reduce((t, x) => t + x, 0) / e.length;
  check(mean <= 3 && Math.max(...e) <= 12, `${id} ${value} lands where Google's did on colours`,
    `${mean.toFixed(1)} levels out on average, ${Math.max(...e).toFixed(1)} at worst`);
  await slide(0);
}

// Tools set together run in the order Google runs them, which is not the
// panel's (see RUN_ORDER in app.js). What Google Photos made of the same
// eight colours with two sliders set at once, off its copies of the 9³
// chart. In the panel's order these came out 34, 12, 8.8 and 8.1 levels
// out on average, and Saturation with Blue tone 49 at worst on the sky;
// in Google's, 4.2, 2.8, 2.8 and 4.1, and 17 at worst on the sky, which is
// the edge of Blue tone's band.
//
// Brightness with White point is held to 6 rather than 5. With White
// point's table it came out 5.1 on these eight, from 4.3: orange and green
// much nearer Google's (6.4 to 2.2, 5.1 to 1.4), red and purple further
// (1.4 to 8.6, 1.4 to 5.4), because Google does not quite chain the two and
// the rule alone happened to sit near where it lands on those. Over the
// whole 9³ chart the pair came nearer, 6.8 levels out on average to 5.4.
const TOGETHER = {
  'brightness+50,whitePoint-50': { skin: [254, 197, 170], orange: [253, 171, 113], sky: [141, 201, 253], green: [110, 205, 111], red: [239, 67, 67], purple: [206, 106, 238], grey: [174, 174, 173], pale: [240, 239, 182] },
  'brightness+50,warmth+50': { skin: [254, 199, 158], orange: [254, 171, 91], sky: [164, 211, 253], green: [133, 217, 77], red: [255, 68, 51], purple: [245, 110, 238], grey: [208, 181, 151], pale: [253, 246, 168] },
  'brightness+50,contrast-50': { skin: [255, 199, 172], orange: [255, 173, 115], sky: [144, 204, 254], green: [111, 213, 111], red: [255, 77, 77], purple: [220, 115, 252], grey: [180, 180, 180], pale: [243, 244, 178] },
  'saturation+50,blueTone+50': { skin: [238, 154, 117], orange: [236, 124, 48], sky: [67, 149, 233], green: [46, 163, 48], red: [207, 23, 23], purple: [169, 56, 206], grey: [128, 128, 129], pale: [225, 224, 142] },
};
for (const [setting, want] of Object.entries(TOGETHER)) {
  const sliders = setting.split(',').map((one) => /^([a-zA-Z]+)([+-]\d+)$/.exec(one).slice(1));
  for (const [id, value] of sliders) {
    await choose(id);
    await slide(Number(value));
  }
  const got = await readCanvas();
  const e = offAll(got, want);
  const mean = e.reduce((t, x) => t + x, 0) / e.length;
  check(mean <= (setting.includes('whitePoint') ? 6 : 5) && Math.max(...e) <= 18, `${setting.replace(',', ' with ')} lands where Google's did`,
    `${mean.toFixed(1)} levels out on average, ${Math.max(...e).toFixed(1)} at worst`);
  for (const [id] of sliders) {
    await choose(id);
    await slide(0);
  }
}

const back = await readCanvas();
check(Math.max(...offAll(back, COLOURS)) <= 1, 'every tool back at nought is the photo again');

// An export waits for the tables rather than going out without them. A
// fresh load of the same project has not fetched them, and here they are
// held back three seconds, as a slow connection would, so an export that
// did not wait would go out before they came: served straight away they
// arrived before the export began, and it passed without the wait.
await choose('warmth');
await slide(100);
await p.click('#dock-back');
await p.waitForTimeout(300);
await p.route('**/colour-tables.png*', async (route) => {
  await new Promise((r) => setTimeout(r, 3000));
  await route.continue();
});
await p.reload();
await p.waitForTimeout(500);
fetched = 0;
for (let k = 0; k < 3 && !(await p.locator('.dock-item[data-drawer="export"]').isVisible()); k++) {
  await p.click('#dock-back').catch(() => {});
  await p.waitForTimeout(250);
}
await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#format', 'image/png');
const got = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await p.click('#btn-export');
const download = await got;
if (!download) check(false, 'the export arrives');
else {
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  const grey = await p.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [...g.getImageData(Math.round(bmp.width * 0.625), Math.round(bmp.height * 0.75), 1, 1).data].slice(0, 3);
  }, bytes);
  check(off(grey, GOOGLE.warmth.grey) <= 3, 'an export straight after opening waits for the tables', `grey ${grey.join(',')}, Google ${GOOGLE.warmth.grey.join(',')}`);
}

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
