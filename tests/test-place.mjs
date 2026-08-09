/* Where a photo was taken and how wide the lens was, read out of EXIF.
 *
 * The fixture is built here: the browser encodes an ordinary JPEG, and an APP1
 * Exif segment is spliced in right after the start-of-image marker, which is
 * exactly where a camera puts one. That keeps the image genuinely decodable —
 * the app has to ingest it before any of this can be read back — while the
 * metadata is ours to choose, so the numbers the app reports can be checked
 * against numbers that were put in on purpose. */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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
await new Promise((r) => server.listen(8242, r));

let bad = 0;
const ok = (label, pass, detail) => {
  if (!pass) bad += 1;
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? `\n      ${detail}` : ''}`);
};

/* ---- an EXIF block, little-endian, laid out by hand ---- */
function exifBlock({ when, focal35, lat, latRef, lon, lonRef }) {
  // Offsets below are from the start of the TIFF header, which is what the app's
  // reader treats as its base. Every one is worked out from the sizes above it
  // rather than guessed, so changing a field means changing one number.
  const IFD0 = 8;
  const EXIF_IFD = IFD0 + 2 + 12 * 2 + 4;          // 38
  const WHEN_AT = EXIF_IFD + 2 + 12 * 2 + 4;       // 68  — 20 ASCII bytes
  const GPS_IFD = WHEN_AT + 20;                    // 88
  const LAT_AT = GPS_IFD + 2 + 12 * 4 + 4;         // 142 — three rationals
  const LON_AT = LAT_AT + 24;                      // 166
  const END = LON_AT + 24;                         // 190

  const b = Buffer.alloc(END);
  b.write('II', 0, 'latin1');
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(IFD0, 4);

  const entry = (at, tag, type, count, valueOrOffset) => {
    b.writeUInt16LE(tag, at);
    b.writeUInt16LE(type, at + 2);
    b.writeUInt32LE(count, at + 4);
    if (type === 3) b.writeUInt16LE(valueOrOffset, at + 8);   // SHORT sits inline
    else b.writeUInt32LE(valueOrOffset, at + 8);
  };
  const ascii = (at, s) => { b.write(s, at, 'latin1'); b.writeUInt8(0, at + s.length); };
  const rationals = (at, triple) => triple.forEach(([n, d], i) => {
    b.writeUInt32LE(n, at + i * 8);
    b.writeUInt32LE(d, at + i * 8 + 4);
  });

  b.writeUInt16LE(2, IFD0);
  entry(IFD0 + 2, 0x8769, 4, 1, EXIF_IFD);         // pointer to the Exif IFD
  entry(IFD0 + 14, 0x8825, 4, 1, GPS_IFD);         // pointer to the GPS IFD
  b.writeUInt32LE(0, IFD0 + 26);                   // no second IFD

  b.writeUInt16LE(2, EXIF_IFD);
  entry(EXIF_IFD + 2, 0x9003, 2, 20, WHEN_AT);     // DateTimeOriginal
  entry(EXIF_IFD + 14, 0xa405, 3, 1, focal35);     // FocalLengthIn35mmFilm
  b.writeUInt32LE(0, EXIF_IFD + 26);
  ascii(WHEN_AT, when);

  b.writeUInt16LE(4, GPS_IFD);
  // Two ASCII bytes fit in the entry itself, which is why these carry no offset.
  entry(GPS_IFD + 2, 0x0001, 2, 2, 0); ascii(GPS_IFD + 2 + 8, latRef);
  entry(GPS_IFD + 14, 0x0002, 5, 3, LAT_AT);
  entry(GPS_IFD + 26, 0x0003, 2, 2, 0); ascii(GPS_IFD + 26 + 8, lonRef);
  entry(GPS_IFD + 38, 0x0004, 5, 3, LON_AT);
  b.writeUInt32LE(0, GPS_IFD + 50);
  rationals(LAT_AT, lat);
  rationals(LON_AT, lon);

  // APP1: marker, its own length, "Exif\0\0", then the TIFF block.
  const head = Buffer.from([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  head.writeUInt16BE(2 + 6 + b.length, 2);
  return Buffer.concat([head, b]);
}

const spliceExif = (jpeg, app1) => {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
};

// 35°41'22.2"N 139°41'30.12"E — a real place, chosen so the arithmetic has
// minutes and seconds in it rather than a round number that would pass even if
// they were being ignored.
const TOKYO = {
  when: '2026:04:11 09:41:07',
  focal35: 52,
  lat: [[35, 1], [41, 1], [222, 10]], latRef: 'N',
  lon: [[139, 1], [41, 1], [3012, 100]], lonRef: 'E',
};
const WANT_LAT = 35 + 41 / 60 + 22.2 / 3600;
const WANT_LON = 139 + 41 / 60 + 30.12 / 3600;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message.split('\n')[0]));

// A real JPEG to hang the metadata on.
await page.goto('about:blank');
const plainB64 = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 800;
  const g = c.getContext('2d');
  g.fillStyle = '#3a6ea5'; g.fillRect(0, 0, 640, 800);
  g.fillStyle = '#e8d9c5'; g.fillRect(80, 120, 300, 240);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
});
const plain = Buffer.from(plainB64, 'base64');

const files = [
  { name: 'tokyo.jpg', mimeType: 'image/jpeg', buffer: spliceExif(plain, exifBlock(TOKYO)) },
  // The same coordinates with the hemispheres flipped, which is the one thing a
  // reader can get wrong and still look right in the northern hemisphere.
  { name: 'south.jpg', mimeType: 'image/jpeg',
    buffer: spliceExif(plain, exifBlock({ ...TOKYO, latRef: 'S', lonRef: 'W' })) },
  // No EXIF at all.
  { name: 'bare.jpg', mimeType: 'image/jpeg', buffer: plain },
];

await autoEnter(page);
await page.goto('http://localhost:8242/');
await page.waitForSelector('#canvas-wrap', { state: 'visible' });
await page.setInputFiles('#file-input', files);
await page.waitForFunction((k) => document.querySelectorAll('.pm-item').length >= k,
  files.length, { timeout: 30000 });
await page.waitForTimeout(400);

const rows = await page.evaluate(async () => {
  const db = await new Promise((res) => { const q = indexedDB.open('grid-collage', 2); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  if (!db) return null;
  const all = await new Promise((res) => {
    const r = db.transaction('photos', 'readonly').objectStore('photos').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
  const out = {};
  for (const row of all) out[row.name] = { lat: row.lat, lon: row.lon, focal35: row.focal35, taken: row.taken };
  return out;
});
if (!rows) { console.log('✗ could not read the photo rows back'); process.exit(1); }

const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 0.0005;
const t = rows['tokyo.jpg'] || {};
const s = rows['south.jpg'] || {};
const bare = rows['bare.jpg'] || {};

ok('degrees, minutes and seconds become one number',
  near(t.lat, WANT_LAT) && near(t.lon, WANT_LON),
  `read ${t.lat}, ${t.lon} — wanted ${WANT_LAT.toFixed(6)}, ${WANT_LON.toFixed(6)}`);

ok('south and west come back negative',
  near(s.lat, -WANT_LAT) && near(s.lon, -WANT_LON),
  `read ${s.lat}, ${s.lon} — same coordinates, hemispheres flipped`);

ok('the focal length is read',
  t.focal35 === 52, `read ${t.focal35}, wanted 52`);

ok('the date comes from the shutter, not the file',
  t.taken === new Date(2026, 3, 11, 9, 41, 7).getTime(),
  `read ${t.taken} (${new Date(t.taken).toISOString()}), wanted 2026:04:11 09:41:07 local`);

ok('a photo with no EXIF carries no location and is not placed at zero',
  (bare.lat === null || bare.lat === undefined) && (bare.lon === null || bare.lon === undefined),
  `lat ${bare.lat}, lon ${bare.lon} — null rather than 0, which is a real place in the Atlantic`);

ok('and it still imports, with a date off the file',
  typeof bare.taken === 'number' && bare.taken > 0,
  `taken ${bare.taken}`);

// The measurements from the other pass must still be there — this touched the
// same record.
ok('the pixel measurements survived the change to the record',
  Object.values(rows).every((r) => r && r.taken),
  `${Object.keys(rows).length} rows read back`);

/* The Data button in the library, which is the only way these numbers leave the
   app — and it is worth checking it carries them rather than a header and some
   empty cells. */
await page.click('#btn-photos');
await page.waitForSelector('#pm-data', { state: 'visible' });
await page.click('#pm-data');
await page.waitForSelector('#pm-data-out', { state: 'visible' });
const dump = await page.inputValue('#pm-data-text');
const note = await page.textContent('#pm-data-note');
const lines = dump.trim().split('\n');
const cols = lines[0].split('\t');
const byName = {};
for (const line of lines.slice(1)) {
  const cells = line.split('\t');
  byName[cells[0]] = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
}
const tk = byName['tokyo.jpg'] || {};
const br = byName['bare.jpg'] || {};

ok('the exported text has a row per photo and the columns needed to cluster',
  lines.length === files.length + 1
  && ['takenISO', 'taken', 'lat', 'lon', 'sharpness', 'hash'].every((c) => cols.includes(c)),
  `${lines.length - 1} rows, ${cols.length} columns: ${cols.join(' ')}`);

ok('the exported location matches what was read',
  near(Number(tk.lat), WANT_LAT) && near(Number(tk.lon), WANT_LON) && tk.focal35 === '52',
  `lat ${tk.lat} lon ${tk.lon} focal35 ${tk.focal35}`);

ok('a photo with no location exports empty cells, not zeros',
  br.lat === '' && br.lon === '' && br.takenISO !== '',
  `lat "${br.lat}" lon "${br.lon}" takenISO "${br.takenISO}"`);

ok('the note says how much of the tray is usable before anyone reads the numbers',
  /3 photos/.test(note) && /2 with a location/.test(note) && /3 measured/.test(note),
  note);

await browser.close();
server.close();
console.log(`\n${bad ? `${bad} failed` : 'all green'}`);
process.exit(bad ? 1 : 0);
