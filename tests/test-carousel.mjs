import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = '/home/user/grid-collage';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8132, r));

const _pages = (pg) => pg.evaluate(()=>document.querySelectorAll('.film').length);
const _photos = (pg) => pg.evaluate(()=>document.querySelectorAll('.pm-item').length);
const _current = (pg) => pg.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1);
const _openDrawer = (pg, name) => pg.click(`.dock-item[data-drawer="${name}"]`);

// distinct solid-ish colour per photo so we can tell pages apart
function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r; raw[off + 2 + x * 3] = g; raw[off + 3 + x * 3] = b;
    }
  }
  const TABLE = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const COLOURS = [[220, 40, 40], [40, 200, 90], [50, 90, 230], [240, 190, 40], [200, 60, 210], [40, 210, 210]];
const files = COLOURS.map((c, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png(400, 500, c) }));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
await autoEnter(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://localhost:8132/');
await page.evaluate(() => localStorage.clear());
await page.reload();

const pageCount = () => _pages(page);
const pager = () => _current(page);
const photoCount = () => _photos(page);

console.log('start —', await pager(), '| photos', await photoCount());

// 1. import six photos: should auto-build six single-image pages
await page.setInputFiles('#file-input', files);
await page.waitForFunction(() => document.querySelectorAll('.film').length===6);
console.log('✓ imported 6 photos ->', await pageCount(), 'pages,', await photoCount(), 'in tray');

// 2. filmstrip thumbnails rendered and each is different
const thumbs = await page.evaluate(() => [...document.querySelectorAll('.film canvas')].map((c) => {
  const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return `${d[0]},${d[1]},${d[2]}`;
}));
console.log('✓ filmstrip thumbs:', thumbs.join(' | '));
console.log('  all distinct:', new Set(thumbs).size === thumbs.length ? '✓' : '✗');

// 3. navigate
await page.locator('.film').nth(1).click();
await page.waitForTimeout(350);
console.log('✓ filmstrip click ->', await pager());
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(350);
console.log('✓ ArrowRight ->', await pager());

// 4. swipe on the canvas (nothing selected)
const box = await page.locator('#canvas').boundingBox();
const cy = box.y + box.height / 2;
await page.mouse.move(box.x + box.width * 0.7, cy);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.7 - 120, cy, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('✓ swipe left ->', await pager());
await page.mouse.move(box.x + box.width * 0.3, cy);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.3 + 120, cy, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('✓ swipe right ->', await pager());

// 5. change this page's layout to a collage, then fill from the tray
await _openDrawer(page, 'layout');
await page.click('.layout-btn[data-id="2x2"]');
const cellsNow = await page.evaluate(() => document.querySelectorAll('.layout-btn.is-active').length);
console.log('✓ layout switched to 2x2 (active buttons:', cellsNow + ')');

// tap library photos to fill the empty tiles
await page.click('#dock-back');
await page.click('#btn-photos');
await page.waitForTimeout(250);
for (let i = 0; i < 3; i++) { await page.locator('.pm-item').nth(i + 1).click(); await page.waitForTimeout(150); }
const badges = await page.evaluate(() => [...document.querySelectorAll('.pm-badge')].map((b) => b.textContent));
console.log('✓ tray usage badges after filling:', badges.join(','));

// 6. aim at a specific tile, then pick the photo for it. Dragging a photo
// onto a tile went with the tray — the library is a modal over the canvas,
// so there is nothing to drop onto. You select the tile and choose instead.
await page.click('#pm-close');
await page.waitForTimeout(250);
await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
await page.waitForTimeout(250);
await page.click('#btn-photos');
await page.waitForTimeout(250);
await page.locator('.pm-item').nth(5).click();
await page.waitForTimeout(250);
console.log('✓ chose a photo for the selected tile; badges now:',
  (await page.evaluate(() => [...document.querySelectorAll('.pm-badge')].map((b) => b.textContent))).join(','));
await page.click('#pm-close');
await page.waitForTimeout(250);

// 7. selection is the mode: tap a tile, swipe must NOT change page
await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
const selected = await page.locator('#dp-tile').isVisible();
const before = await pager();
await page.mouse.move(box.x + box.width * 0.7, cy);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.7 - 150, cy, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('✓ tile selected:', selected, '| page after swipe-while-selected:', await pager(), before === (await pager()) ? '(unchanged ✓)' : '(CHANGED ✗)');
await page.keyboard.press('Escape');

// 8. reorder pages by dragging the filmstrip
const firstBefore = thumbs[0];
// A real pointer drag, not dragTo: the strip reorders on pointer events and a
// single jump-to-target move is nothing a mouse ever produces.
{
  const a = await page.locator('.film').nth(0).boundingBox();
  const d = await page.locator('.film').nth(3).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(d.x + d.width / 2, a.y + a.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const afterOrder = await page.evaluate(() => [...document.querySelectorAll('.film canvas')].map((c) => {
  const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return `${d[0]},${d[1]},${d[2]}`;
}));
console.log('✓ reordered: page1 was', firstBefore, '-> now', afterOrder[0], firstBefore !== afterOrder[0] ? '(moved ✓)' : '(NOT MOVED ✗)');

// 9. add pages up to the cap
for (let i = 0; i < 20; i++) {
  const add = page.locator('.film-add');
  if (await add.isDisabled()) break;
  await add.click();
}
console.log('✓ page cap:', await pageCount(), 'pages, add button disabled:', await page.locator('.film-add').isDisabled());

// 10. delete a page
await _openDrawer(page, 'page');
await page.click('#btn-delete-page');
await page.click('#dock-back');
console.log('✓ after delete:', await pageCount(), 'pages');

// 11. shape is deck-wide
await _openDrawer(page, 'shape');
console.log('✓ shape drawer open:', await page.locator('#ratios').isVisible(), '| settings list hidden:', !(await page.locator('#dock-root').isVisible()));
await page.click('#ratios button[data-id="4:5"]');
const shape = await page.evaluate(() => (canvas.width / canvas.height).toFixed(3));
console.log('✓ deck ratio 4:5 applied to canvas:', shape);
const thumbShape = await page.evaluate(() => {
  const c = document.querySelector('.film canvas');
  return (c.width / c.height).toFixed(3);
});
// Against the deck ratio, not the preview canvas: the preview backing store is
// a whole number of device pixels, so it rounds to within half a pixel of it.
console.log('✓ filmstrip thumbs follow the deck ratio:', thumbShape,
  thumbShape === (4/5).toFixed(3) ? '✓' : '✗',
  '| preview within a pixel:', Math.abs(shape - thumbShape) < 0.002 ? '✓' : `✗ (${shape})`);

// 12. export — desktop has no share sheet, so expect numbered downloads
const downloads = [];
page.on('download', (d) => downloads.push(d.suggestedFilename()));
// The shape drawer is still open from the ratio check; step back out first.
await page.click('#dock-back');
await page.waitForTimeout(250);
await page.click('.dock-item[data-drawer="export"]');
await page.waitForTimeout(300);
await page.click('#btn-export');
await page.waitForTimeout(6000);
console.log('✓ export produced', downloads.length, 'files:', downloads.slice(0, 6).join(', ') + (downloads.length > 6 ? ' …' : ''));
console.log('  numbered in order:', downloads.every((n, i) => n === `${String(i + 1).padStart(2, '0')}.jpg`) ? '✓' : '✗ ' + downloads.join(','));

await page.screenshot({ path: '/tmp/shot-carousel.png' });
console.log(errors.length ? '✗ ERRORS:\n' + errors.join('\n') : '✓ no page errors');

await browser.close();
server.close();
