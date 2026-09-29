/* Adjust: a setting tapped twice in quick succession goes back to nought.
 *
 * Measured on the canvas, on flat grey: Brightness and Contrast both moved,
 * then Brightness double-tapped. Brightness must be gone and Contrast kept,
 * two taps well apart must do nothing but choose, and undo must bring
 * Brightness back.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { png } from './image.mjs';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
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

await p.setInputFiles('#file-input', [{ name: 'grey.png', mimeType: 'image/png', buffer: png(1200, 1200, [100, 100, 100]) }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
await p.click('#tile-tabs [data-tile="adjust"]');
await p.waitForTimeout(200);

const level = () => p.evaluate(() => {
  const c = document.getElementById('canvas');
  return c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data[0];
});
const set = async (id, v) => {
  await p.click(`.setting[data-adjust="${id}"]`);
  await p.waitForTimeout(450);
  await p.evaluate((val) => {
    const el = document.getElementById('adjust');
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
  await p.waitForTimeout(800);
};
const isSet = (id) => p.$eval(`.setting[data-adjust="${id}"]`, (e) => e.classList.contains('is-set'));

const plain = await level();
await set('contrast', 40);
const contrastOnly = await level();
await set('brightness', 60);
const both = await level();
check(both > contrastOnly + 20 && await isSet('brightness') && await isSet('contrast'), 'Brightness and Contrast both moved', `${plain} plain, ${contrastOnly} with Contrast, ${both} with both`);

// Two taps well apart only choose it.
await p.click('.setting[data-adjust="brightness"]');
await p.waitForTimeout(700);
await p.click('.setting[data-adjust="brightness"]');
await p.waitForTimeout(500);
check(await isSet('brightness') && Math.abs(await level() - both) <= 1, 'two taps well apart leave it as it is');

// Two in quick succession put it back.
await p.click('.setting[data-adjust="brightness"]');
await p.click('.setting[data-adjust="brightness"]');
await p.waitForTimeout(600);
const zeroed = await level();
check(!(await isSet('brightness')) && await isSet('contrast'), 'a double tap puts Brightness back to nought and leaves Contrast',
  `Brightness ${await isSet('brightness') ? 'still set' : 'nought'}, Contrast ${await isSet('contrast') ? 'kept' : 'gone'}`);
check(Math.abs(zeroed - contrastOnly) <= 1, 'and the photo is as Contrast alone left it', `${zeroed}, ${contrastOnly} with Contrast alone`);
check(await p.$eval('#adjust-name', (e) => e.textContent) === 'Brightness' && await p.$eval('#adjust', (e) => e.value) === '0',
  'the dial is on Brightness, at nought');

await p.click('#btn-undo');
await p.waitForTimeout(600);
check(Math.abs(await level() - both) <= 1, 'undo brings it back', `${await level()}`);

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
