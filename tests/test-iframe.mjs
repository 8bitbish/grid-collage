import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { TALL } from './image.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

/* The artifact is the app as one self-contained page: no separate requests, so
   no ?v= stamp for app.js to read its own version off, which is why it carries
   data-v instead. See the VERSION comment in app.js.

   Built here from the repository rather than read off disk. It used to be a
   handmade file in a scratch directory belonging to the container this test was
   written in, so it was both unobtainable and free to drift out of date against
   the app it was meant to be a copy of. Generated, it cannot. */
function artifact() {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const stamp = (read('index.html').match(/app\.js\?v=([^"]+)/) || [, 'dev'])[1];
  return read('index.html')
    .replace(/<link rel="stylesheet" href="styles\.css[^"]*">/, `<style>${read('styles.css')}</style>`)
    .replace(/<script src="app\.js[^"]*"><\/script>/,
      `<script data-v="${stamp}">${read('app.js')}</script>`);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/artifact') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(artifact());
    return;
  }
  if (url === '/host') {
    // mimic how an artifact is embedded: sandboxed iframe, no allow-downloads
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
      <iframe src="/artifact" sandbox="allow-scripts allow-forms allow-modals"></iframe>`);
    return;
  }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8125, r));

const png = TALL();
const files = [{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: png }];

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
await autoEnter(page);
const messages = [];
page.on('console', (m) => messages.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => messages.push(`[pageerror] ${e}`));

await page.goto('http://localhost:8125/host');
const frame = page.frames().find((f) => f.url().includes('/artifact'));
console.log('frame found:', !!frame);

await frame.setInputFiles('#file-input', files);
await frame.waitForFunction(() => document.querySelectorAll('.film').length === 1);
console.log('photo loaded inside iframe: yes');

let downloaded = false;
page.on('download', () => { downloaded = true; });
await frame.click('.dock-item[data-drawer="export"]');
await new Promise(r=>setTimeout(r,300));
await frame.click('#btn-export');
await page.waitForTimeout(2500);

console.log('download fired:', downloaded, '(expected false — sandbox blocks it)');
console.log('save sheet shown:', await frame.locator('#sheet').isVisible());
console.log('sheet size label:', await frame.textContent('#sheet-size'));
const img = await frame.evaluate(() => {
  const el = document.getElementById('sheet-img');
  return { src: el.src.slice(0, 5), w: el.naturalWidth, h: el.naturalHeight };
});
console.log('sheet image:', JSON.stringify(img));
console.log('toast said:', JSON.stringify(await frame.textContent('#toast')));
await page.screenshot({ path: '/tmp/shot-sheet.png' });
await frame.click('#sheet-close');
console.log('sheet closes:', !(await frame.locator('#sheet').isVisible()));
console.log('console:', messages.join('\n         ') || '(none)');

await browser.close();
server.close();
