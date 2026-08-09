/* The numbers taken at import, checked against images whose answers are known.
   Nothing here needs a fixture: every case is generated in process, which is
   also how a sharp and a deliberately blurred copy of the same frame can be
   compared without a camera. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(8241, r));

let bad = 0;
const ok = (label, pass, detail) => {
  if (!pass) bad += 1;
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? `\n      ${detail}` : ''}`);
};

/* A PNG writer that takes a per-pixel function, so each case can describe the
   image it wants rather than being handed one. */
function png(w, h, at) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const off = y * (w * 3 + 1);
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = at(x, y);
      raw[off + 1 + x * 3] = r; raw[off + 2 + x * 3] = g; raw[off + 3 + x * 3] = b;
    }
  }
  const TABLE = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SIZE = 900;
// Hard-edged checks: maximum high-frequency detail, so the sharp end of the scale.
const checks = (n) => (x, y) => ((Math.floor(x / n) + Math.floor(y / n)) % 2
  ? [235, 235, 235] : [20, 20, 20]);
// The same pattern with the edges smeared over `r` pixels — a blur, done in the
// generator, so the only difference from the above is high-frequency detail.
const blurred = (n, r) => (x, y) => {
  let t = 0;
  let c = 0;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      t += checks(n)(Math.max(0, x + dx), Math.max(0, y + dy))[0];
      c += 1;
    }
  }
  const v = Math.round(t / c);
  return [v, v, v];
};
const flat = (rgb) => () => rgb;
// Large-scale structure, the way a photograph has it: nothing here changes much
// between neighbouring pixels, which is the condition a perceptual hash is built
// for.
// A grid of big patches at varied brightnesses. Deliberately not a gradient: a
// picture that only ever gets brighter to the right compares the same way at
// every step, so its dHash comes out as sixty-four zeros and so does a flat
// colour's — which is how the first version of this test managed to call two
// unrelated images identical.
const patch = (bx, by) => 40 + (Math.abs((bx * 73856093) ^ (by * 19349663)) % 200);
const scene = (dx) => (x, y) => {
  const v = patch(Math.floor((x + dx) / 100), Math.floor(y / 100));
  return [v, v, v];
};
// Sharp in the middle, smooth outside: a subject with a soft background.
const centreSharp = (x, y) => {
  const d = Math.hypot(x - SIZE / 2, y - SIZE / 2);
  return d < SIZE * 0.22 ? checks(6)(x, y) : blurred(6, 5)(x, y);
};

const cases = {
  sharp: png(SIZE, SIZE, checks(6)),
  soft: png(SIZE, SIZE, blurred(6, 5)),
  sky: png(SIZE, SIZE, flat([120, 160, 210])),
  subject: png(SIZE, SIZE, centreSharp),
  bright: png(SIZE, SIZE, flat([252, 252, 252])),
  dark: png(SIZE, SIZE, flat([2, 2, 2])),
  warm: png(SIZE, SIZE, flat([210, 120, 40])),
  cool: png(SIZE, SIZE, flat([40, 120, 210])),
  // Shifted by two pixels: a different file, the same moment.
  sharpShifted: png(SIZE, SIZE, (x, y) => checks(6)(x + 2, y)),
  // A photograph's worth of structure — a graded sky, a dark mass low left, a
  // bright block high right — and the same thing moved three pixels. This is the
  // pair that stands in for two frames of one burst.
  scene: png(SIZE, SIZE, scene(0)),
  sceneShifted: png(SIZE, SIZE, scene(3)),
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message.split('\n')[0]));
await autoEnter(page);
await page.goto('http://localhost:8241/');
await page.waitForSelector('#canvas-wrap', { state: 'visible' });

const names = Object.keys(cases);
await page.setInputFiles('#file-input', names.map((n) => ({
  name: `${n}.png`, mimeType: 'image/png', buffer: cases[n],
})));
await page.waitForFunction((k) => document.querySelectorAll('.pm-item').length >= k,
  names.length, { timeout: 30000 });
await page.waitForTimeout(400);

// Pull the measurements back out by filename, so each case is named in the output.
const stats = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('.pm-item')) {
    const name = el.getAttribute('data-name') || '';
    if (name) out[name.replace(/\.png$/, '')] = null;
  }
  return out;
});

// The tray is not exposed on the DOM, so read it from where the app keeps it.
const measured = await page.evaluate(async () => {
  // Every photo row is written to IndexedDB with its stats, which is also the
  // thing worth proving: that what was measured is what gets stored.
  const db = await new Promise((res) => { const q = indexedDB.open('grid-collage', 2); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  if (!db) return null;
  const rows = await new Promise((res) => {
    const r = db.transaction('photos', 'readonly').objectStore('photos').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
  const out = {};
  for (const row of rows) out[String(row.name).replace(/\.png$/, '')] = row.stats;
  return out;
});

if (!measured) {
  console.log('✗ could not read the photo rows back');
  process.exit(1);
}
const m = (n) => measured[n] || {};
const present = names.filter((n) => measured[n] && measured[n].hash);
ok('every photo was measured and the numbers were persisted',
  present.length === names.length,
  `${present.length}/${names.length} rows came back with stats, read out of IndexedDB`);

ok('a sharp frame outscores a blurred copy of itself',
  m('sharp').sharpness > m('soft').sharpness * 3,
  `sharp ${m('sharp').sharpness} vs soft ${m('soft').sharpness}`
  + ` — ${(m('sharp').sharpness / Math.max(1, m('soft').sharpness)).toFixed(1)}x`);

ok('a flat sky scores low without being blurred, so this is a ranking and not a verdict',
  m('sky').sharpness < m('soft').sharpness,
  `sky ${m('sky').sharpness} vs soft ${m('soft').sharpness} vs sharp ${m('sharp').sharpness}`);

ok('a sharp subject on a soft background reads as a subject',
  m('subject').focusFalloff > 2 && m('sharp').focusFalloff < 2,
  `centre-to-edge falloff: subject ${m('subject').focusFalloff}, evenly sharp ${m('sharp').focusFalloff}`);

ok('clipped highlights and shadows are found',
  m('bright').clipHi > 0.9 && m('dark').clipLo > 0.9
  && m('sharp').clipHi < 0.9 && m('sharp').clipLo < 0.9,
  `bright clipHi ${m('bright').clipHi}, dark clipLo ${m('dark').clipLo},`
  + ` checks ${m('sharp').clipHi}/${m('sharp').clipLo}`);

ok('warm and cool separate, and point opposite ways in hue',
  m('warm').warm > 100 && m('cool').warm < -100
  && Math.sign(m('warm').hueY) !== Math.sign(m('cool').hueY),
  `warm ${m('warm').warm} (hueX ${m('warm').hueX}, hueY ${m('warm').hueY}),`
  + ` cool ${m('cool').warm} (hueX ${m('cool').hueX}, hueY ${m('cool').hueY})`);

ok('a flat colour has no contrast and a busy frame has plenty',
  m('sky').lumSpread < 5 && m('sharp').lumSpread > 50,
  `flat sky spread ${m('sky').lumSpread}, checks ${m('sharp').lumSpread}`);

// The pair that matters for burst detection.
const dist = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1;
  return n;
};
const near = dist(m('scene').hash, m('sceneShifted').hash);
const far = dist(m('scene').hash, m('warm').hash);
ok('a three-pixel shift of the same scene hashes close, a different image does not',
  near < 10 && far > near && far >= 8,
  `same moment ${near} bits apart, different image ${far} bits apart, out of 64`
  + `\n      scene ${m('scene').hash}\n      moved ${m('sceneShifted').hash}`);

// Recorded rather than asserted, because it is a property of the hash and not a
// fault: a fine checkerboard aliases when it is reduced to 9x8, so shifting one
// changes the hash far more than moving a photograph does. Nothing in a camera
// roll looks like this, but it is worth knowing before anyone tests a perceptual
// hash with a test pattern and concludes it is broken.
console.log(`  for contrast, a 6px checkerboard shifted 2px is `
  + `${dist(m('sharp').hash, m('sharpShifted').hash)} bits apart — aliasing, not resemblance`);

ok('the hash is 64 bits',
  Object.values(measured).every((s) => s && s.hash && s.hash.length === 64),
  `lengths ${[...new Set(Object.values(measured).map((s) => s && s.hash && s.hash.length))].join(',')}`);

// What it costs. The claim being checked is that importing pays no second
// decode, so the figure worth knowing is the added time per photo.
const cost = await page.evaluate(async () => {
  const c = new OffscreenCanvas(4032, 3024);
  const g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, 4032, 3024);
  for (let i = 0; i < 4032; i += 12) { g.fillStyle = i % 24 ? '#111' : '#eee'; g.fillRect(i, 0, 6, 3024); }
  const bmp = await createImageBitmap(c);
  const t0 = performance.now();
  const runs = 5;
  for (let i = 0; i < runs; i += 1) window.__measure ? window.__measure(bmp) : null;
  return { supported: !!window.__measure, ms: (performance.now() - t0) / runs, w: bmp.width, h: bmp.height };
});
if (cost.supported) {
  console.log(`  measuring a ${cost.w}x${cost.h} bitmap costs ${cost.ms.toFixed(1)}ms`);
} else {
  console.log('  (measure is private to the app, so its cost is reported by test-bulk rather than here)');
}

await page.screenshot({ path: `${SHOTS}/measure.png` }).catch(() => {});
await browser.close();
server.close();
console.log(`\n${bad ? `${bad} failed` : 'all green'}`);
process.exit(bad ? 1 : 0);
