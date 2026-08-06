// The guarantee: at no rotation, zoom or pan may the background show through
// a filled tile. Driven through the real app's gesture path.
import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/grid-collage';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8131, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ hasTouch: true, viewport: { width: 1000, height: 900 } });
const page = await context.newPage();
await autoEnter(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:8131/');
await page.evaluate(() => localStorage.clear());
await page.reload();

// A 2x1 grid with no gap or padding: the left tile is exactly the left half.
await page.click('.dock-item[data-drawer="layout"]');
await page.click('.layout-btn[data-id="2x1"]');
await page.click('#dock-back');
// the sliders live inside dock drawers now, so drive them directly
await page.evaluate(() => {
  for (const id of ['gap', 'padding', 'radius']) {
    const el = document.getElementById(id);
    el.value = 0;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
// Pure red background — any red pixel inside the tile is a leak.
await page.evaluate(() => {
  const bg = document.getElementById('bg');
  bg.value = '#ff0000';
  bg.dispatchEvent(new Event('input', { bubbles: true }));
});


// A tall photo, so the aspect mismatch with a square-ish tile is severe.
const jpg = fs.readFileSync('/tmp/grid-collage-big-top-4x5.jpg');
await page.setInputFiles('#file-input', [{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg }]);
await page.waitForFunction(() => document.querySelectorAll('.pm-item').length===1);

const cdp = await context.newCDPSession(page);
const box = await page.locator('#canvas').boundingBox();
const cx = box.x + box.width * 0.25;
const cy = box.y + box.height * 0.5;
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })),
});

await touch('touchStart', [[cx, cy]]);
await touch('touchEnd', []);

// Count background pixels inside the left tile.
const leakCount = () => page.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const w = Math.floor(c.width / 2) - 2;
  const d = g.getImageData(1, 1, w, c.height - 2).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 240 && d[i + 1] < 30 && d[i + 2] < 30) n += 1;
  }
  return n;
});

const readAngle = () => page.textContent('#cell-angle');
let worst = 0;
const failures = [];

// Sweep rotation in small twists, checking after each, and shove the photo
// hard against its limits with a one-finger drag at every step.
let total = 0;
for (let step = 0; step < 44; step++) {
  await touch('touchStart', [[cx - 70, cy], [cx + 70, cy]]);
  const a = (8 * Math.PI) / 180;
  await touch('touchMove', [
    [cx - 70 * Math.cos(a), cy - 70 * Math.sin(a)],
    [cx + 70 * Math.cos(a), cy + 70 * Math.sin(a)],
  ]);
  await touch('touchEnd', []);

  // Try to drag the photo out of its tile in four directions.
  for (const [dx, dy] of [[400, 0], [-400, 0], [0, 400], [0, -400]]) {
    await touch('touchStart', [[cx, cy]]);
    await touch('touchMove', [[cx + dx, cy + dy]]);
    await touch('touchEnd', []);
    total += 1;
    const leaked = await leakCount();
    worst = Math.max(worst, leaked);
    if (leaked > 0) failures.push({ angle: await readAngle(), drag: [dx, dy], leaked });
  }
}

console.log(`checked ${total} rotate+drag combinations across a full turn`);
console.log('worst background bleed inside the tile:', worst, 'pixels');
if (failures.length) console.log('FAILURES:', JSON.stringify(failures.slice(0, 6), null, 2));
console.log('final angle reported:', await readAngle());
await page.screenshot({ path: '/tmp/shot-cover.png' });
console.log(errors.length ? '✗ ERRORS: ' + errors.join('\n') : '✓ no page errors');

await browser.close();
server.close();
