import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { TALL } from './image.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

let requests = 0;
const seen = [];
const server = http.createServer((req, res) => {
  requests += 1;
  seen.push(req.url);
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8126, r));

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext();
const page = await context.newPage();
await autoEnter(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// 1. manifest parses and every icon it names actually resolves
await page.goto('http://localhost:8126/');
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]').href;
  const res = await fetch(href);
  return { ok: res.ok, json: await res.json() };
});
console.log('✓ manifest loads:', manifest.ok, '| name:', manifest.json.name, '| display:', manifest.json.display);
// No orientation member. Declaring one — "any" included — is an active
// request that overrides the device's own rotation lock on Android.
console.log('✓ orientation left to the device:',
  'orientation' in manifest.json ? `✗ declares "${manifest.json.orientation}"` : 'no member ✓');

const iconChecks = await page.evaluate(async (icons) => {
  const out = [];
  for (const i of icons) {
    const res = await fetch(new URL(i.src, location.href));
    out.push(`${i.src} ${res.status} ${i.purpose}`);
  }
  return out;
}, manifest.json.icons);
console.log('✓ icons:', iconChecks.join(' | '));

const apple = await page.evaluate(async () => (await fetch('apple-touch-icon.png')).status);
console.log('✓ apple-touch-icon:', apple);

// 2. service worker registers and takes control
await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.getRegistration().then(() => true), null, { timeout: 15000 })
  .catch(() => {});
const reg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  return { scope: r.scope, active: !!r.active, state: r.active && r.active.state };
});
console.log('✓ service worker:', JSON.stringify(reg));

// 3. reload so the worker controls the page, then confirm the shell is cached
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const cache = await caches.open(keys[0]);
  return { cacheName: keys[0], entries: (await cache.keys()).map((r) => new URL(r.url).pathname).sort() };
});
console.log('✓ cache:', cached.cacheName);
console.log('  entries:', cached.entries.join(' '));

// 4. the real test — kill the network entirely and reload.
// Let the service worker's background revalidation from the online load drain
// first, otherwise those late fetches get blamed on the offline window.
await page.waitForTimeout(4000);
const before = requests;
seen.length = 0;
await context.setOffline(true);
await page.reload();
const offlineState = await page.evaluate(() => ({
  title: document.title,
  layouts: document.querySelectorAll('.layout-btn').length,
  canvas: !!document.getElementById('canvas').getContext('2d'),
  styled: getComputedStyle(document.body).backgroundColor,
  scriptRan: document.querySelectorAll('#ratios button').length,
}));
console.log('✓ OFFLINE reload:', JSON.stringify(offlineState));

// 5. exercise the app offline: add a photo and export
const jpg = TALL();
await page.setInputFiles('#file-input', [
  { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg },
  { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpg },
]);
await page.waitForFunction(() => document.querySelectorAll('.pm-item').length===2);
const dl = page.waitForEvent('download');
await page.click('.dock-item[data-drawer="export"]');
await page.waitForTimeout(300);
await page.click('#btn-export');
const download = await dl;
await download.saveAs('/tmp/offline-export.jpg');
console.log('✓ OFFLINE export:', download.suggestedFilename(), fs.statSync('/tmp/offline-export.jpg').size, 'bytes');
await page.screenshot({ path: '/tmp/shot-offline.png' });

console.log(`  (server saw ${requests - before} requests while offline — expect 0)`);
if (requests - before) console.log('  offending:', seen.join(' '));
console.log(errors.length ? '✗ ERRORS: ' + errors.join('\n') : '✓ no page errors');

await browser.close();
server.close();
