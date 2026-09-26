/* An edited photo keeps its finest detail wherever its tile lands.
 *
 * An edit is drawn from a look made at the tile's own size, and while the
 * photo covered its tile at a fraction of a pixel that look was resampled a
 * second time on its way onto the page, with a sub-pixel shift. The shift
 * takes out detail two pixels across, whatever the edit: a fox covering its
 * export at 3226.67 wide lost half its 2px detail to Black point +30, which
 * should change nothing but tone.
 *
 * The photo here is grey noise, which is nothing but fine detail, sized so
 * that it covers both the preview's tile and the 2160 export at a fraction of
 * a pixel — and, turned a quarter, still does. Fine detail is read as the RMS
 * of the picture less a 3x3 box blur of itself, across and down separately,
 * since the shift fell on one axis at a time. Black point +30 on noise kept
 * between 80 and 180 only steepens the tone curve, so the edited picture
 * must have at least as much fine detail as the plain one. Before the fix
 * it kept x0.48 across in the preview and x0.33 in the export, and turned a
 * quarter the loss moved to the other axis.
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

// 2600x2161 covers a 2160 square at 2598.80 wide, and turned a quarter at
// 2598.80 tall; bigger than the export, so its look is made smaller than the
// photo, as a phone photo's is.
const W = 2600;
const H = 2161;
function noise() {
  let seed = 7;
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      raw[y * (W + 1) + 1 + x] = 80 + ((seed >>> 16) % 101);
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, acceptDownloads: true });
const p = await ctx.newPage();
await autoEnter(p);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`http://localhost:${srv.address().port}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

await p.setInputFiles('#file-input', [{ name: 'noise.png', mimeType: 'image/png', buffer: noise() }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// Across and down, over the middle half of whatever is read, clear of the
// tile's rounded corners.
const FINE = `(g, w, h) => {
  const d = g.getImageData(0, 0, w, h).data;
  const v = (x, y) => d[(y * w + x) * 4];
  let ax = 0, ay = 0, n = 0;
  for (let y = Math.round(h / 4); y < Math.round(h * 3 / 4); y++) {
    for (let x = Math.round(w / 4); x < Math.round(w * 3 / 4); x++) {
      const c = v(x, y);
      ax += (c - (v(x - 1, y) + c + v(x + 1, y)) / 3) ** 2;
      ay += (c - (v(x, y - 1) + c + v(x, y + 1)) / 3) ** 2;
      n++;
    }
  }
  return { across: Math.sqrt(ax / n), down: Math.sqrt(ay / n) };
}`;
const onScreen = () => p.evaluate((fine) => {
  const c = document.getElementById('canvas');
  return eval(fine)(c.getContext('2d'), c.width, c.height);
}, FINE);
// Back out of whatever tile panel is open to the page's own dock.
const toPage = async () => {
  for (let k = 0; k < 3 && !(await p.locator('.dock-item[data-drawer="export"]').isVisible()); k++) {
    await p.click('#dock-back');
    await p.waitForTimeout(250);
  }
};
const exported = async () => {
  await toPage();
  await p.click('.dock-item[data-drawer="export"]');
  await p.selectOption('#format', 'image/png');
  const got = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await p.click('#btn-export');
  const download = await got;
  await p.click('#dock-back');
  if (!download) return null;
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  return p.evaluate(async ({ b64, fine }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return eval(fine)(g, bmp.width, bmp.height);
  }, { b64: bytes, fine: FINE });
};
const box = await p.locator('#canvas').boundingBox();
const selectTile = async () => {
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
};
const blackPoint = async (value) => {
  await selectTile();
  await p.click('#tile-tabs [data-tile="adjust"]');
  await p.waitForTimeout(200);
  await p.click('.adjust-tool[data-adjust="blackPoint"]');
  await p.evaluate((v) => {
    const el = document.getElementById('adjust');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await p.waitForTimeout(400);
  await toPage();
};
const ratio = (edited, plain) => ({ across: edited.across / plain.across, down: edited.down / plain.down });
const shown = (r) => `across x${r.across.toFixed(2)}, down x${r.down.toFixed(2)}`;
const kept = (r) => r.across >= 0.98 && r.down >= 0.98;

for (const turned of [false, true]) {
  const how = turned ? 'turned a quarter' : 'square';
  if (turned) {
    await selectTile();
    await p.click('#tile-tabs [data-tile="crop"]');
    await p.waitForTimeout(200);
    await p.click('#btn-rot90');
    await p.waitForTimeout(400);
    await toPage();
  }
  await blackPoint(0);
  const plainScreen = await onScreen();
  const plainExport = await exported();
  await blackPoint(30);
  const screen = ratio(await onScreen(), plainScreen);
  check(kept(screen), `${how}, Black point +30 keeps the finest detail in the preview`, shown(screen));
  const file = await exported();
  if (!plainExport || !file) check(false, `${how}, both exports arrive`);
  else {
    const out = ratio(file, plainExport);
    check(kept(out), `${how}, and in the 2160 export`, shown(out));
  }
}

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
