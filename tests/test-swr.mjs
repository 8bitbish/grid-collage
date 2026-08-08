// Does an edited asset actually reach a returning visitor without a version bump?
import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/grid-collage';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

let override = null; // { pathname, body }
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (override && url === override.pathname) {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(override.body);
    return;
  }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8127, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext();
const page = await context.newPage();
await autoEnter(page);

await page.goto('http://localhost:8127/');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
console.log('visit 1 topbar colour:', await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor));

// Ship a "new deploy" — same filename, different content, CACHE untouched.
override = { pathname: '/styles.css', body: fs.readFileSync(`${ROOT}/styles.css`, 'utf8').replace('--surface: #16161c;', '--surface: #003300;') };

await page.reload();
const second = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor);
console.log('visit 2 topbar colour:', second, '(still old — served from cache, refreshed behind the scenes)');

await page.reload();
const third = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor);
console.log('visit 3 topbar colour:', third, third === 'rgb(0, 51, 0)' ? '✓ picked up the new deploy' : '✗ STILL STALE');

await browser.close();
server.close();
