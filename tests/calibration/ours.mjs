/* The chart through Grid Collage itself: one 2160px PNG export per setting,
 * named as measure.mjs expects, so ours and Google's measure side by side.
 *
 *   node ours.mjs <dir> [--chart=<file>] highlights-100 shadows+50 ...
 *                                        (or several at once: brightness+50,warmth-25)
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from '../paths.mjs';
import { autoEnter } from '../enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const args = process.argv.slice(2);
const chartArg = args.find((a) => a.startsWith('--chart='));
const [dir, ...settings] = args.filter((a) => a !== chartArg);
if (!dir || !settings.length) { console.error('usage: node ours.mjs <dir> <tool±value> ...'); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const b = await chromium.launch({ executablePath: CHROME, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
await autoEnter(p);
await p.goto(`http://localhost:${srv.address().port}/`);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.setInputFiles('#file-input', [chartArg ? chartArg.slice(8) : path.join(import.meta.dirname, 'out', 'chart.png')]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(800);
await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#quality', '2160');
await p.selectOption('#format', 'image/png');
await p.click('#dock-back');
const box = await p.locator('#canvas').boundingBox();
const slide = (v) => p.evaluate((v) => {
  const el = document.getElementById('adjust');
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
// From wherever the dock happens to be, which after an export is not always
// where it was left.
const openAdjust = async (id) => {
  for (let k = 0; k < 4 && !(await p.locator('#tile-adjust').isVisible()); k++) {
    if (await p.locator('#tile-adjust-btn').isVisible()) await p.click('#tile-adjust-btn');
    else if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
    else await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForTimeout(200);
  }
  await p.click(`.adjust-tool[data-adjust="${id}"]`);
};
// A setting is one tool, shadows+50, or several on the one tile,
// brightness+50,warmth-25, as google-web.mjs takes them.
for (const setting of settings) {
  const sliders = setting.split(',').map((one) => /^([a-zA-Z]+)([+-]\d+)$/.exec(one).slice(1));
  for (const [id, value] of sliders) {
    await openAdjust(id);
    await slide(Number(value));
    await p.waitForTimeout(200);
  }
  for (let k = 0; k < 4 && await p.locator('#dock-drawer').isVisible(); k++) await p.click('#dock-back');
  await p.click('.dock-item[data-drawer="export"]');
  const got = p.waitForEvent('download', { timeout: 60000 });
  await p.click('#btn-export');
  await (await got).saveAs(path.join(dir, `${setting}.png`));
  await p.click('#dock-back');
  for (const [id] of sliders) {
    await openAdjust(id);
    await slide(0);
  }
}
await b.close();
srv.close();
