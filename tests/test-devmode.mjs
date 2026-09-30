/* Dev mode: the panel of switches, and the swipe switches in it changing how
   pages are drawn on the way past without changing what they look like once
   they land.

   The switches exist to be compared on a phone, so the one thing this has to
   hold them to is that none of them is a different picture: a page reached
   with every one of them on reads the same, pixel for pixel, as the same
   page reached with them all off. */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
let fails=0;
const ok=(what,pass,detail='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${what}${detail?` — ${detail}`:''}`); };

// Four colours in four quarters, a different set per photo, so a page drawn
// wrong — the neighbour's picture, a stale one, a half-size copy left in
// place — cannot read the same as the right one.
function quarters(n, c) {
  const raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y++) { const o = y * (n * 3 + 1); for (let x = 0; x < n; x++) {
    const q = c[(y < n / 2 ? 0 : 2) + (x < n / 2 ? 0 : 1)]; raw[o + 1 + x * 3] = q[0]; raw[o + 2 + x * 3] = q[1]; raw[o + 3 + x * 3] = q[2]; } }
  const TB = [...Array(256)].map((_, k) => { let v = k; for (let j = 0; j < 8; j++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v; });
  const crc = (b) => { let v = 0xffffffff; for (const x of b) v = TB[(v ^ x) & 0xff] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const k = Buffer.alloc(4); k.writeUInt32BE(crc(b)); return Buffer.concat([l, b, k]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(n, 0); ih.writeUInt32BE(n, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
const PHOTOS = [
  [[220, 40, 40], [240, 200, 30], [40, 180, 80], [40, 80, 220]],
  [[30, 30, 30], [200, 200, 200], [120, 60, 160], [250, 120, 20]],
  [[90, 200, 210], [210, 90, 150], [20, 110, 60], [160, 150, 40]],
].map((c, i) => ({ name: `q${i}.png`, mimeType: 'image/png', buffer: quarters(600, c) }));

const b = await chromium.launch({ executablePath: CHROME });
async function open(flags, query = '') {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const p = await ctx.newPage(); await autoEnter(p);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript((f) => { try { localStorage.setItem('grid-collage:dev', JSON.stringify(f)); } catch {} }, flags);
  await p.goto(`http://localhost:${PORT}/${query}`);
  return { ctx, p, errs };
}

console.log('== the panel ==');
{
  const { ctx, p, errs } = await open({}, '?dev');
  await p.waitForTimeout(400);
  ok('?dev opens it', await p.locator('#dev-panel').isVisible());
  const rows = await p.locator('#dev-rows .dev-row').count();
  ok('a row for each switch, every one off to begin with', rows >= 8 && (await p.locator('#dev-rows .dev-row[aria-checked="true"]').count()) === 0, `${rows} rows`);
  ok('it says which build it is', /^v/.test(await p.textContent('#dev-build')));
  await p.locator('#dev-rows .dev-row').first().click();
  ok('a tap turns a switch on', (await p.locator('#dev-rows .dev-row').first().getAttribute('aria-checked')) === 'true');
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('grid-collage:dev')));
  ok('and it is kept on this device', stored.meter === true, JSON.stringify(stored));
  await p.click('#dev-close');
  ok('Close puts it away', await p.locator('#dev-panel').isHidden());
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n== the ways in, from the homepage ==');
{
  // The homepage as it opens, not walked through into the editor.
  const home = async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(`http://localhost:${PORT}/`);
    await p.waitForFunction(() => document.body.classList.contains('on-home') && /^v/.test(document.getElementById('home-hint').textContent));
    return { ctx, p, errs };
  };
  {
    const { ctx, p } = await home();
    ok('the version number cannot be selected, so a hold on it is not taken for a selection', await p.evaluate(() => getComputedStyle(document.getElementById('home-hint')).userSelect === 'none'));
    for (let i = 0; i < 4; i++) await p.tap('#home-hint');
    ok('four taps on the version do nothing', await p.locator('#dev-panel').isHidden());
    await p.tap('#home-hint');
    ok('the fifth opens dev mode', await p.locator('#dev-panel').isVisible());
    await ctx.close();
  }
  {
    const { ctx, p } = await home();
    const r = await p.locator('#home-hint').boundingBox();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
    await p.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok('holding the version for most of a second opens it', await p.locator('#dev-panel').isVisible());
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await home();
    // Motion as Android reports it: acceleration without gravity, in m/s².
    const move = (force, n, gap) => p.evaluate(async ({ force, n, gap }) => {
      for (let i = 0; i < n; i++) {
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: force * (i % 2 ? -1 : 1), y: 0, z: 0 }, accelerationIncludingGravity: { x: force, y: 9.81, z: 0 }, interval: 16 }));
        await new Promise((r) => setTimeout(r, gap));
      }
    }, { force, n, gap });
    await move(7, 6, 150);
    ok('moving the phone about does not open it', await p.locator('#dev-panel').isHidden());
    await move(15, 3, 180);
    ok('three firm shakes inside a second do', await p.locator('#dev-panel').isVisible());
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
}

// The same three pages, swiped to the last and back to the second, with the
// switches all off and then all on, and the settled canvas read each time.
async function run(flags) {
  const { ctx, p, errs } = await open(flags);
  await p.setInputFiles('#file-input', PHOTOS);
  await p.waitForFunction(() => document.querySelectorAll('.film').length === 3, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  const box = await p.locator('#canvas').boundingBox(); const cy = box.y + box.height / 2;
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const frame = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const swipe = async (dir) => { const from = dir > 0 ? 330 : 60, to = dir > 0 ? 60 : 330; await touch('touchStart', [[from, cy]]);
    for (let k = 1; k <= 8; k++) { await touch('touchMove', [[from + (to - from) * k / 8, cy]]); await frame(); } await touch('touchEnd', []); await p.waitForTimeout(1500); };
  // Home first, to the start of the deck, then along.
  for (let i = 0; i < 2; i++) await swipe(-1);
  const seen = [];
  for (const d of [1, 1, -1]) { await swipe(d); seen.push(await p.evaluate(() => {
    const c = document.getElementById('canvas'); const g = c.getContext('2d'); const out = [];
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) out.push(...g.getImageData(Math.round(c.width * x / 8), Math.round(c.height * y / 8), 1, 1).data.slice(0, 3));
    return { at: document.querySelector('.film.is-current') ? [...document.querySelectorAll('.film')].indexOf(document.querySelector('.film.is-current')) : -1, px: out, w: c.width };
  })); }
  const meter = await p.evaluate(() => { const m = document.getElementById('dev-meter'); return m.hidden ? '' : m.textContent; });
  await ctx.close();
  return { seen, meter, errs };
}
console.log('\n== every switch on draws the same pages ==');
{
  const off = await run({});
  const on = await run({ meter: true, peekOnce: true, peekAhead: true, peekHalf: true, stillClips: true, landLight: true, clipFrames: true, clipTile: true, clipsHalf: true });
  off.seen.forEach((s, i) => {
    const t = on.seen[i];
    const diff = Math.max(...s.px.map((v, k) => Math.abs(v - t.px[k])));
    ok(`page ${s.at + 1} after swipe ${i + 1} is the same page, the same size, the same pixels`, s.at === t.at && s.w === t.w && diff <= 2, `pages ${s.at + 1}/${t.at + 1}, ${s.w}/${t.w}px, largest difference ${diff}`);
  });
  ok('the frame meter reports the swipe', /^Last swipe: \d+ of \d+ frames late · worst \d+ms$/.test(on.meter), on.meter || 'nothing shown');
  ok('and with the switches off it is not there', off.meter === '');
  ok('no page errors either way', off.errs.length + on.errs.length === 0, [...off.errs, ...on.errs].join(' | '));
}

console.log('\n== a clip redrawn only on its new frames still plays at its own rate ==');
{
  // moving0.webm is a moving test pattern. What is compared is how many
  // different pictures a strip of the canvas shows in a second, painted every
  // refresh and painted only on new frames: the same motion, from fewer
  // copies. (The strip does not change on every one of the clip's frames, so
  // the count is well under 30 either way.)
  const count = async (flags) => {
    const { ctx, p, errs } = await open(flags);
    await p.setInputFiles('#file-input', [{ name: 'moving0.webm', mimeType: 'video/webm', buffer: fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'moving0.webm')) }]);
    await p.waitForFunction(() => { const v = document.querySelector('#players video'); return !!v && !v.paused && v.currentTime > 0.3; }, null, { timeout: 20000 });
    const r = await p.evaluate(() => new Promise((res) => {
      const c = document.getElementById('canvas'); const g = c.getContext('2d'); const seen = new Set(); let paints = 0; const t0 = performance.now();
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) { if (this.canvas === c && src instanceof HTMLVideoElement) paints += 1; return draw.call(this, src, ...rest); };
      const tick = () => { const d = g.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 8, 1).data; seen.add(d.join(',')); if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res({ pictures: seen.size, paints }); };
      requestAnimationFrame(tick);
    }));
    await ctx.close();
    return { ...r, errs };
  };
  const every = await count({});
  const fresh = await count({ clipFrames: true });
  ok('it shows as many different pictures a second as painting every refresh does', fresh.pictures >= every.pictures - 2 && fresh.pictures >= 5, `${fresh.pictures} against ${every.pictures}`);
  ok('while copying the video far fewer times', fresh.paints <= every.paints * 0.7, `${fresh.paints} copies against ${every.paints}`);
  ok('no page errors', every.errs.length + fresh.errs.length === 0);
}

await b.close(); srv.close();
process.exit(fails ? 1 : 0);
