/* Compare beside a playing clip.
 *
 * A clip on the page plays, and while it plays its own paint loop redraws the
 * whole page every frame. That loop had its own shorter list of how to draw,
 * without Compare in it, so the photo beside the clip showed as it came for a
 * frame at most and then went back to edited: Compare did nothing, as far as
 * anyone could see. Reported on a phone with a photo and a clip in a grid.
 *
 * So: the 2x1 layout, a flat grey photo on the left brightened a long way,
 * clip.webm on the right, playing. Compare is held on for over a second —
 * dozens of the clip's frames — and the photo must read as it came throughout,
 * and as edited again once Compare is off.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { png } from './image.mjs';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webm': 'video/webm' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

const GREY = 100;

// The Adjust test's reason: WebGL only through SwiftShader here.
const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true });
const p = await ctx.newPage();
await autoEnter(p);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`http://localhost:${PORT}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

await p.setInputFiles('#file-input', [{ name: 'grey.png', mimeType: 'image/png', buffer: png(1200, 1200, [GREY, GREY, GREY]) }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x1"]');
await p.click('#float-close');
await p.setInputFiles('#file-input', [path.join(ROOT, 'tests/fixtures/clip.webm')]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 15000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
if (await p.locator('#dock-drawer').isVisible()) await p.click('#float-close');
await p.click('#btn-photos');
await p.locator('.pm-pick[aria-label*="clip.webm"]').first().click();
await p.keyboard.press('Escape');
await p.waitForTimeout(600);

// The photo's tile, well inside it, and the clip's.
const read = () => p.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const at = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3);
  return { photo: at(0.25, 0.5)[0], clip: at(0.75, 0.5) };
});
const playing = await p.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused));
check(playing, 'the clip beside the photo is playing');

const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('#tile-tabs [data-tile="adjust"]');
await p.waitForTimeout(200);
await p.click('.setting[data-adjust="brightness"]');
await p.evaluate(() => {
  const el = document.getElementById('adjust');
  el.value = '80';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(500);
const edited = (await read()).photo;
check(edited > GREY + 30, 'Brightness lifts the photo', `${GREY} to ${edited}`);

await p.click('#btn-compare');
// Sampled over more than a second, every 100ms: dozens of the clip's frames,
// each of which redraws the page.
const during = [];
for (let k = 0; k < 12; k++) {
  await p.waitForTimeout(100);
  during.push((await read()).photo);
}
check(during.every((v) => Math.abs(v - GREY) <= 2), 'with Compare on, the photo stays as it came while the clip plays',
  `read ${during.join(' ')}`);
await p.click('#btn-compare');
await p.waitForTimeout(400);
const after = (await read()).photo;
check(Math.abs(after - edited) <= 2, 'and Compare off puts the edit back', `${after}`);

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
