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
await new Promise((r) => server.listen(0,r));
const PORT=server.address().port;

const png = TALL();
const files = [{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: png }];

let fails = 0;
const ok = (label, pass, extra = '') => { if (!pass) fails += 1; console.log(`  ${pass ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
// Errors raised inside the frame, collected by the frame itself. The page's
// own pageerror and console events are the host's, and said "(none)" here
// whatever the app inside was doing.
await page.addInitScript(() => {
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__errs.push(`unhandled: ${e.reason}`));
});
await autoEnter(page);

await page.goto(`http://localhost:${PORT}/host`);
const frame = page.frames().find((f) => f.url().includes('/artifact'));
ok('the app is in a sandboxed frame', !!frame);

// The editor first, then the photo. This is what made the test pass one run in
// three and read as a real failure: it handed over the file the instant the
// frame loaded, while the app was still on the projects list, and autoEnter
// tapped New a few tens of milliseconds later — which opened an empty project
// and left the photo behind. Waiting for the editor, the framed import worked
// four runs out of four, with nothing thrown inside the frame and the homepage
// rendering normally. The sandbox was never the problem; localStorage throwing
// there is caught everywhere the app touches it.
await frame.waitForFunction(() => !document.body.classList.contains('on-home'), null, { timeout: 10000 })
  .then(() => ok('it opens a project', true))
  .catch(() => ok('it opens a project', false, 'still on the projects list'));

await frame.setInputFiles('#file-input', files);
await frame.waitForFunction(() => document.getElementById('photos-count').textContent === '1', null, { timeout: 15000 })
  .then(() => ok('the photo reaches the tray', true))
  .catch(() => ok('the photo reaches the tray', false, 'tray still empty'));

let downloaded = false;
page.on('download', () => { downloaded = true; });
await frame.click('.dock-item[data-drawer="export"]');
// Export stays disabled until a photo is actually in the tray, and a film
// thumbnail appears a beat before that.
const enabled = await frame.waitForFunction(() => {
  const b = document.getElementById('btn-export');
  return b && !b.disabled;
}, null, { timeout: 15000 }).then(() => true).catch(() => false);
ok('Export is enabled', enabled);
if (enabled) await frame.click('#btn-export');
await page.waitForTimeout(2500);

// A sandbox without allow-downloads swallows a download without a word, so the
// app shows the picture instead, for a long-press save.
ok('no download was attempted', !downloaded);
ok('the save sheet is shown instead', await frame.locator('#sheet').isVisible());
const size = await frame.textContent('#sheet-size');
ok('labelled with what it is', /^\d+×\d+ (JPG|PNG)$/.test(size.trim()), size);
const img = await frame.evaluate(() => {
  const el = document.getElementById('sheet-img');
  return { src: el.src.slice(0, 5), w: el.naturalWidth, h: el.naturalHeight };
});
ok('holding the rendered page', img.src === 'blob:' && img.w === 1080 && img.h === 1080, JSON.stringify(img));
const toast = (await frame.textContent('#toast')).trim();
ok('and it says why', /one page at a time/.test(toast), JSON.stringify(toast));
await page.screenshot({ path: path.join(SHOTS, 'iframe-sheet.png') });
if (await frame.locator('#sheet').isVisible()) {
  await frame.click('#sheet-close');
  ok('the sheet closes', !(await frame.locator('#sheet').isVisible()));
}

const errs = await frame.evaluate(() => window.__errs);
ok('nothing thrown inside the frame', errs.length === 0, JSON.stringify(errs.slice(0, 2)));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
