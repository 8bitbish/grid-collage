/* Pop out's matting: ViTMatte on the GPU, deciding the edge MagicTouch drew.
 *
 * WebGPU only, so this needs a browser with a real adapter — the full
 * Chromium build rather than the headless shell the rest of the suite uses,
 * which has none. Where there is no adapter it says so and asserts nothing,
 * and the runner reports it as asserting nothing rather than as passing. The
 * rest of the suite covers the cut every browser without WebGPU gets.
 *
 * The same two stacked tiles as test-effects: flat blue above, and below a red
 * disc on grey running past the shared edge. In a 2160px export, just past
 * the disc's edge and over the blue, the neighbour shows clean — no haze of
 * the old background, which is what an out-of-focus edge left as a wide soft
 * ramp looks like — and the disc's own edge, flat and in focus, still goes
 * from blue to red in a few pixels.
 *
 * What this cannot check is the point of matting: that real strands of hair
 * and fur are kept. It was tried, with thin red strands drawn standing up off
 * the disc, and ViTMatte took them for background — 0.00 across a strand
 * sitting well inside the unsure band — because flat lines on flat grey are
 * not what hair looks like to it. On real photos it keeps them, which was
 * looked at at 100% in 2160px exports; those photos are not ours to commit.
 *
 * Where things land, in export pixels. The photo, 2400x3000, is drawn 2160
 * wide from y=270; the disc, centred at (1200, 1200) with a radius of 480,
 * lands centred at (1080, 1350), its top at 918 — 162px past the tile's top
 * edge at 1080.
 */
import { chromium } from 'playwright';
import { ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const PORT = srv.address().port;

let b;
try {
  b = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
} catch (err) {
  console.log(`skipped: the full Chromium build is not installed here (${String(err.message).split('\n')[0]})`);
  srv.close();
  process.exit(0);
}
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, hasTouch: true, acceptDownloads: true });
const p = await ctx.newPage();
await autoEnter(p);
// This build has a share sheet, and an export would wait on it forever.
await p.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
await p.goto(`http://localhost:${PORT}/`);
// The same test the app makes: SwiftShader, Chrome's software WebGPU, is what
// a CI machine offers, and the app does not matte on it.
const adapter = await p.evaluate(async () => {
  const a = navigator.gpu && await navigator.gpu.requestAdapter();
  if (!a) return 'none';
  const info = a.info || {};
  const soft = a.isFallbackAdapter || info.isFallbackAdapter || /swiftshader/i.test(`${info.vendor} ${info.architecture} ${info.description}`);
  return soft ? `software (${info.vendor} ${info.architecture})` : 'real';
});
if (adapter !== 'real') {
  console.log(`skipped: no hardware WebGPU adapter here (${adapter}), so the app does not matte`);
  await b.close();
  srv.close();
  process.exit(0);
}

const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
// MediaPipe says it has made its CPU delegate through console.error.
p.on('console', (m) => { if (m.type() === 'error' && !/^INFO: /.test(m.text())) errs.push(m.text()); });
const fetched = [];
p.on('request', (q) => { if (/vitmatte|onnxruntime/.test(q.url())) fetched.push(path.basename(new URL(q.url()).pathname)); });
await p.evaluate(() => localStorage.clear());
await p.reload();

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};

function png(w, h, draw) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const c = draw(x, y);
      raw[o + 1 + x * 3] = c[0]; raw[o + 2 + x * 3] = c[1]; raw[o + 3 + x * 3] = c[2];
    }
  }
  const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}
const GREY = [128, 128, 128];
const RED = [210, 50, 50];
const BLUE = [40, 90, 200];
const disc = png(2400, 3000, (x, y) => ((x - 1200) ** 2 + (y - 1200) ** 2 < 480 ** 2 ? RED : GREY));
const blue = png(1200, 600, () => BLUE);

await p.setInputFiles('#file-input', [{ name: 'blue.png', mimeType: 'image/png', buffer: blue }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 1);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="1x2"]');
await p.click('#dock-back');
await p.setInputFiles('#file-input', [{ name: 'strands.png', mimeType: 'image/png', buffer: disc }]);
await p.waitForFunction(() => document.querySelectorAll('.pm-item').length === 2, null, { timeout: 30000 });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.9);
await p.waitForTimeout(300);
await p.click('.dock-item[data-tile="effects"]');
const t0 = Date.now();
await p.click('.effect-item[data-effect="popOut"]');
await p.waitForFunction(() => !/Finding/.test(document.getElementById('pop-note').textContent), null, { timeout: 120000 });
await p.waitForTimeout(500);
check(fetched.some((f) => /vitmatte/.test(f)) && fetched.some((f) => /ort/.test(f)), 'with WebGPU here, the subject is matted by ViTMatte',
  `${Date.now() - t0}ms, fetched ${[...new Set(fetched)].join(', ')}`);

await p.click('#dock-back');
await p.click('#dock-back');
if (await p.locator('#dock-drawer').isVisible()) await p.click('#dock-back');
await p.click('.dock-item[data-drawer="export"]');
await p.selectOption('#quality', '2160');
await p.selectOption('#format', 'image/png');
const got = p.waitForEvent('download', { timeout: 120000 }).catch(() => null);
await p.click('#btn-export');
const download = await got;
if (!download) check(false, 'the export arrives');
else {
  const bytes = fs.readFileSync(await download.path()).toString('base64');
  const m = await p.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
    // How red, 0 for the blue and 1 for the red, by the red channel.
    const red = (px) => (px[0] - 40) / (210 - 40);
    // Just past the disc: ten photo pixels above its top, and either side of
    // it along the tile's edge.
    const clear = [at(1080, 905), at(560, 1075), at(1600, 1075)];
    // The disc's own edge, off to the side where no strand is, along a row
    // still over the blue: from blue to red, in pixels.
    const row = g.getImageData(700, 1060, 300, 1).data;
    const mix = [];
    for (let x = 0; x < 300; x++) mix.push(red([row[x * 4]]));
    const from = mix.findIndex((v) => v > 0.1);
    const to = mix.findIndex((v) => v > 0.9);
    return { width: bmp.width, clear, from, to };
  }, bytes);
  check(m.width === 2160, 'the export is at 2160', String(m.width));
  check(m.clear.every((px) => px.every((v, i) => Math.abs(v - BLUE[i]) <= 14)), 'just past the subject the neighbour shows clean, with no haze',
    m.clear.map((px) => px.join(',')).join(' / '));
  check(m.from > 0 && m.to - m.from <= 4, 'and the disc\'s own flat edge stays sharp', `${m.to - m.from}px from blue to red`);
}

check(!errs.length, 'no errors', errs.slice(0, 3).join(' | '));

await b.close();
srv.close();
process.exit(failures ? 1 : 0);
