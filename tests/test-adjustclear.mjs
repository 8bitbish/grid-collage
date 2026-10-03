/* Adjust: holding the dial clears the photo of what floats over it.
 *
 * Close, Compare and Reset hang over the photo and the tile's own actions sit
 * on it. Pressed on the dial — moving or not, by mouse or by touch — they must
 * be out of sight and out of the way of a tap; let go of, or cancelled, or the
 * window losing focus mid-press, they must be back. The keyboard never
 * presses, so it must never hide them.
 *
 * Measured, not inferred: the opacity each one actually has once the fade has
 * run, and what elementFromPoint finds where Close is.
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
const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, hasTouch: true });
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
const canvas = await p.locator('#canvas').boundingBox();
await p.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
await p.waitForTimeout(200);
await p.click('#tile-tabs [data-tile="adjust"]');
await p.waitForTimeout(600);

// What is over the photo, each with its opacity as drawn, and whether a tap
// on Close would reach Close.
const over = () => p.evaluate(() => {
  const shown = (el) => !el.hidden && el.getClientRects().length > 0;
  const alpha = (el) => { let a = 1; for (let n = el; n && n !== document; n = n.parentElement) a *= Number(getComputedStyle(n).opacity); return a; };
  const close = document.getElementById('float-close').getBoundingClientRect();
  const hit = document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);
  return {
    row: shown(document.getElementById('float-row')) ? alpha(document.getElementById('float-row')) : null,
    pill: shown(document.getElementById('sheet-float')) ? alpha(document.getElementById('sheet-float')) : null,
    actions: shown(document.getElementById('tile-actions')) ? alpha(document.getElementById('tile-actions')) : null,
    closeTakesTap: !!hit && !!hit.closest('#float-close'),
    value: document.getElementById('adjust').value,
  };
});
const say = (o) => `row ${o.row}, pill ${o.pill}, actions ${o.actions}, Close ${o.closeTakesTap ? 'takes taps' : 'does not'}`;
const clear = (o) => o.row === 0 && o.actions === 0 && (o.pill === null || o.pill === 0) && !o.closeTakesTap;
const back = (o) => o.row === 1 && o.actions === 1 && (o.pill === null || o.pill === 1) && o.closeTakesTap;

const rest = await over();
check(back(rest) && rest.pill === null, 'at rest, Close and the tile\'s actions are over the photo', say(rest));

const track = await p.locator('#adjust-slide .dial-track').boundingBox();
const tx = track.x + track.width / 2, ty = track.y + track.height / 2;

// Mouse, pressed and held still: a plain photo, so nothing has changed yet.
await p.mouse.move(tx, ty);
await p.mouse.down();
await p.waitForTimeout(300);
const held = await over();
check(clear(held), 'held still with the mouse, the photo is clear', say(held));
check(held.value === '0', 'and holding alone changed nothing', `value ${held.value}`);

// Dragged while held: the first change brings Compare and Reset in, which
// must arrive already out of sight rather than flashing up over the photo.
for (let i = 1; i <= 10; i += 1) { await p.mouse.move(tx - i * 6, ty); await p.waitForTimeout(16); }
await p.waitForTimeout(60);
const early = await over();
check(early.pill !== null && early.pill === 0, 'Compare and Reset arriving mid-drag arrive out of sight', `${say(early)}, value ${early.value}`);
await p.waitForTimeout(300);
const dragged = await over();
check(clear(dragged) && dragged.value !== '0', 'dragged, it stays clear while the value moves', `${say(dragged)}, value ${dragged.value}`);

await p.mouse.up();
await p.waitForTimeout(350);
const up = await over();
check(back(up) && up.pill === 1, 'let go, everything is back and takes taps again', say(up));

// Dialled back to nought while held, the pill has nothing left to do and goes.
// It normally leaves as a picture of itself fading out over the dock, which
// here would be the one thing showing on the photo.
const kids = () => p.$eval('#dock', (d) => d.children.length);
const settled = await kids();
await p.mouse.move(tx, ty);
await p.mouse.down();
let ghost = 0;
// Ten steps of 6 is the 9 the drag above made plus nought's notch.
for (let i = 1; i <= 10; i += 1) {
  await p.mouse.move(tx + i * 6, ty);
  await p.waitForTimeout(16);
  ghost = Math.max(ghost, await kids() - settled);
}
const nought = await over();
await p.mouse.up();
await p.waitForTimeout(350);
check(nought.value === '0' && nought.pill === null && ghost === 0, 'dialled back to nought while held, the pill goes without a ghost', `value ${nought.value}, pill ${nought.pill}, ${ghost} extra in the dock`);
// Put the edit back for what follows, so Compare and Reset are there.
await p.mouse.move(tx, ty);
await p.mouse.down();
for (let i = 1; i <= 10; i += 1) { await p.mouse.move(tx - i * 6, ty); await p.waitForTimeout(16); }
await p.mouse.up();
await p.waitForTimeout(350);

// Touch, through CDP so the finger can be held down and then lifted or
// cancelled — Playwright's touchscreen only taps.
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });

await touch('touchStart', tx, ty);
await p.waitForTimeout(300);
const finger = await over();
check(clear(finger), 'a finger held still on the dial clears it too', say(finger));
await touch('touchMove', tx + 30, ty);
await p.waitForTimeout(100);
await touch('touchEnd');
await p.waitForTimeout(350);
const lifted = await over();
check(back(lifted), 'lifted, everything is back', say(lifted));

await touch('touchStart', tx, ty);
await p.waitForTimeout(250);
await touch('touchCancel');
await p.waitForTimeout(350);
const cancelled = await over();
check(back(cancelled), 'a cancelled touch cannot leave it hidden', say(cancelled));

// The window losing focus mid-press, as an incoming call or a switch of app
// would: the release may never arrive at the dial.
await p.mouse.move(tx, ty);
await p.mouse.down();
await p.waitForTimeout(200);
const before = await over();
await p.evaluate(() => window.dispatchEvent(new Event('blur')));
await p.waitForTimeout(350);
const blurred = await over();
check(clear(before) && back(blurred), 'losing focus mid-press brings everything back', `${say(before)} -> ${say(blurred)}`);
await p.mouse.up();
await p.waitForTimeout(200);

// The keyboard never presses, so it never hides.
await p.focus('#adjust');
const from = await p.$eval('#adjust', (e) => e.value);
await p.keyboard.down('ArrowRight');
await p.waitForTimeout(350);
const keyed = await over();
await p.keyboard.up('ArrowRight');
check(back(keyed) && keyed.value !== from, 'the arrow keys move the setting and hide nothing', `${say(keyed)}, ${from} -> ${keyed.value}`);

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
