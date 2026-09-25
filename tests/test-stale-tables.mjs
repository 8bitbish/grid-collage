/* The colour tables a build reads are that build's own.
 *
 * colour-tables.png grew rows for White and Black point in 2026.09.25h, and
 * an installed app opened on that build was handed the table it had cached
 * from the one before — the service worker answers from its cache first,
 * and the file carried no stamp. The new app read rows the old file did not
 * have, the correction came back as nothing less its bias, and both tools
 * took every photo most of the way to black. Desktop tests never saw it:
 * they start with an empty cache.
 *
 * The old file is made here from the current one, cut to the seven colour
 * tools' rows it held, which were byte for byte the same. Two cases:
 *
 * - The old file still answers at the unstamped address, as a cache would.
 *   The app must ask under its stamp, and so never see it.
 * - Every address answers with the old file, as a cache that ignored the
 *   stamp would. The app must refuse it, and draw White and Black point on
 *   their curves alone, which are right on greys, rather than read it.
 *
 * Read on the preview's grey bands: Black point +50 takes 170 to 161 and
 * White point +50 takes 100 to 114. On 2026.09.25h, handed the old file,
 * they came to 34 and 0.
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

// Four grey bands, as test-adjust's photo has, bigger than the tile.
function bands(w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = [30, 100, 170, 230][Math.floor((x / w) * 4)];
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });

// The file as 2026.09.25g shipped it: the first 7 x 10 x 13 rows.
const maker = await b.newPage();
const oldTables = Buffer.from(await maker.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, 7 * 10 * 13);
  c.getContext('2d').drawImage(bmp, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  return new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result.split(',')[1]); f.readAsDataURL(blob); });
}, fs.readFileSync(path.join(ROOT, 'colour-tables.png')).toString('base64')), 'base64');
await maker.close();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

async function run(how, staleEverywhere) {
  // With the app's own worker out of the way, so every fetch of the table
  // meets the route: Playwright cannot see what a service worker answers.
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await autoEnter(p);
  const asked = [];
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.route('**/colour-tables.png*', (route) => {
    const url = route.request().url();
    asked.push(url);
    if (staleEverywhere || !url.includes('?')) route.fulfill({ status: 200, contentType: 'image/png', body: oldTables });
    else route.continue();
  });
  await p.goto(`http://localhost:${PORT}/`);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.setInputFiles('#file-input', [{ name: 'bands.png', mimeType: 'image/png', buffer: bands(1440, 1440) }]);
  await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const read = () => p.evaluate(() => {
    const c = document.getElementById('canvas');
    const g = c.getContext('2d');
    return [0.125, 0.375, 0.625, 0.875].map((x) => g.getImageData(Math.round(c.width * x), Math.round(c.height * 0.5), 1, 1).data[0]);
  });
  const box = await p.locator('#canvas').boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
  await p.click('.dock-item[data-tile="adjust"]');
  await p.waitForTimeout(200);
  const slide = async (id, v) => {
    await p.click(`.adjust-tool[data-adjust="${id}"]`);
    await p.evaluate((v) => {
      const el = document.getElementById('adjust');
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, v);
    // Long enough for the table to arrive and the tile to be drawn again.
    await p.waitForTimeout(1500);
  };
  await slide('blackPoint', 50);
  const bp = await read();
  await slide('blackPoint', 0);
  await slide('whitePoint', 50);
  const wp = await read();
  check(bp[2] > 130 && bp[2] < 165, `${how}: Black point +50 darkens 170 a little, not to black`, `170 -> ${bp[2]}`);
  check(wp[1] > 105 && wp[1] < 130, `${how}: White point +50 lifts 100, not to black`, `100 -> ${wp[1]}`);
  if (!staleEverywhere) {
    check(asked.length > 0 && asked.every((u) => /colour-tables\.png\?v=/.test(u)), `${how}: the table is asked for under the build's stamp`, asked.map((u) => u.split('/').pop()).join(', '));
  }
  check(!errs.length, `${how}: no errors`, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await run('the old table left at the unstamped address', false);
await run('the old table at every address', true);

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
