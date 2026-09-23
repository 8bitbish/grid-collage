/* The homepage tile crops a cover about its middle, whatever shape the deck is.
 *
 * The tile is 3:4 and the cover is drawn at the deck's own ratio. A cover wider
 * than the tile was always cropped evenly at the sides; one taller than it lost
 * everything it had to lose off the bottom, because the tile's grid row grew to
 * the image's height and object-fit never had anything to crop.
 *
 * Driven through the real app: projects seeded into localStorage, covers into
 * the app's own database, and the homepage left to render them. Each cover is
 * three bands of equal height — red, green, blue — so a centred crop shows as
 * much red at the top of the tile as blue at the bottom, and it is read back
 * off a screenshot rather than off the layout.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(8243, r));
let fails = 0;
const ok = (label, pass, extra = '') => { if (!pass) fails += 1; console.log(`  ${pass ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`); };

// Named after the deck ratios the app offers that sit either side of 3:4.
const DECKS = [
  { id: 'pj-tall', name: 'Tall', w: 9, h: 16 },
  { id: 'pj-wide', name: 'Wide', w: 16, h: 9 },
  { id: 'pj-square', name: 'Square', w: 1, h: 1 },
];

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

await p.goto('http://localhost:8243/');
await p.waitForFunction(() => document.body.classList.contains('on-home'));
// The app has opened its database by now, so the stores exist to write into.
await p.evaluate(async (decks) => {
  const now = Date.now();
  localStorage.setItem('grid-collage:projects', JSON.stringify(decks.map((d, i) => ({
    id: d.id, name: d.name, created: now - i, updated: now - i, photos: 1, pages: 1, bytes: 0, cover: null,
  }))));
  const blobs = await Promise.all(decks.map((d) => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = Math.round((400 * d.h) / d.w);
    const x = c.getContext('2d');
    ['#f00', '#0f0', '#00f'].forEach((col, i) => {
      x.fillStyle = col;
      x.fillRect(0, Math.round((c.height * i) / 3), c.width, Math.ceil(c.height / 3));
    });
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }));
  const db = await new Promise((res, rej) => { const q = indexedDB.open('grid-collage'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  await new Promise((res) => {
    const tx = db.transaction('covers', 'readwrite');
    decks.forEach((d, i) => tx.objectStore('covers').put({ id: d.id, blob: blobs[i] }));
    tx.oncomplete = res;
  });
  db.close();
}, DECKS);
await p.reload();
await p.waitForFunction((n) => document.querySelectorAll('#home-grid .tile img').length === n
  && [...document.querySelectorAll('#home-grid .tile img')].every((i) => i.complete && i.naturalWidth), DECKS.length);

// Rows down the middle of a tile, sorted into the three bands.
async function bands(box) {
  const png = (await p.screenshot({ clip: box })).toString('base64');
  return p.evaluate(async (src) => {
    const im = new Image(); im.src = `data:image/png;base64,${src}`; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(Math.floor(im.width / 2), 0, 1, im.height).data;
    const n = { red: 0, green: 0, blue: 0 };
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, bl] = [d[i], d[i + 1], d[i + 2]];
      if (r > 200 && g < 60 && bl < 60) n.red += 1;
      else if (g > 200 && r < 60 && bl < 60) n.green += 1;
      else if (bl > 200 && r < 60 && g < 60) n.blue += 1;
    }
    return n;
  }, png);
}

for (const d of DECKS) {
  const m = await p.evaluate((id) => {
    const tile = document.querySelector(`#home-grid .tile[data-id="${id}"]`);
    const t = tile.getBoundingClientRect(), i = tile.querySelector('img').getBoundingClientRect();
    return { box: { x: t.left, y: t.top, width: t.width, height: t.height },
      over: [t.top - i.top, i.bottom - t.bottom, t.left - i.left, i.right - t.right].map((v) => Math.round(v)) };
  }, d.id);
  console.log(`${d.name} ${d.w}:${d.h}`);
  ok('the image box is the tile, no bigger', m.over.every((v) => v === 0), `overhang t/b/l/r ${m.over.join('/')}`);
  const n = await bands(m.box);
  const tall = d.h / d.w > 4 / 3;
  if (tall) {
    // Two device pixels of slack for where the band edges round.
    ok('cropped evenly top and bottom', Math.abs(n.red - n.blue) <= 2, `red ${n.red} rows, blue ${n.blue}`);
    ok('all three bands still showing', n.green > 0 && n.red > 0 && n.blue > 0, JSON.stringify(n));
  } else {
    // No taller than the tile, so nothing is cropped vertically and the three
    // bands keep their equal share.
    ok('uncropped top to bottom, bands equal', Math.max(n.red, n.green, n.blue) - Math.min(n.red, n.green, n.blue) <= 2, JSON.stringify(n));
  }
}

await p.screenshot({ path: path.join(SHOTS, 'homecover.png') });
ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
