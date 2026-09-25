// Does an edited asset actually reach a returning visitor without a version bump?
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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
await new Promise((r) => server.listen(0,r));
const PORT=server.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext();
const page = await context.newPage();
await autoEnter(page);

let fails = 0;
const ok = (label, pass, extra = '') => { if (!pass) fails += 1; console.log(`  ${pass ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`); };

// The stylesheet's own custom property, read off the root. This used to read
// the background of .topbar, which the markup lost long ago; getComputedStyle
// on null threw before the first line printed, and the test sat on the stale
// list with its question unanswered. A custom property is the stylesheet
// speaking for itself, and no change to the markup can take it away. A
// primitive rather than a role, because a role is an alias whose computed
// value is another property's name rather than the colour this edits.
const surface = () => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--grey-100').trim());

await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
const first = await surface();
console.log('visit 1 --grey-100:', first);
ok('the worker is in control and the stylesheet is the shipped one', first === '#1a1a1a', first);

// Ship a "new deploy" — same filename, different content, no version bump.
// Exactly the deploy CLAUDE.md says never to make, which is why the worker has
// a safety net for it: a static file is answered from the cache and refreshed
// behind the page, so the edit arrives one launch late rather than never.
override = { pathname: '/styles.css', body: fs.readFileSync(`${ROOT}/styles.css`, 'utf8').replace('--grey-100: #1a1a1a;', '--grey-100: #003300;') };

await page.reload();
const second = await surface();
console.log('visit 2 --grey-100:', second, '(the cached copy, refreshed behind the scenes)');

await page.reload();
const third = await surface();
console.log('visit 3 --grey-100:', third);
ok('the edited stylesheet reached the next launch', third === '#003300', third);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
