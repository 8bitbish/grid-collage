/* Google's colour tools as lookup tables, for the app to read.
 *
 *   node colour-tables.mjs <copies dir> [png]
 *
 * <copies dir> holds Google Photos' copies of lut.png (lut-chart.mjs at 13)
 * as google-web.mjs names them, brightness+25.jpg and so on, each already
 * read by lut-measure.mjs into <copy>.lut.json. Writes the tables to
 * colour-tables.png at the repository root, or wherever [png] says.
 *
 * The image is plain RGB, 169 wide: one row of the image per green level
 * of one table, and along it the 13 red levels of each of the 13 blue ones,
 * blue outermost. The tables are stacked tool by tool, in TOOLS's order, and
 * within a tool knot by knot, in KNOTS's order. app.js reads it the same
 * way; change one and change the other.
 *
 * Each entry is the patch's mean over the middle of its square, less the
 * one bias the capture has: at either end of the range a JPEG's noise can
 * only go one way, so a patch Google left at white reads 1.5 levels under
 * it and one at black 0.4 over. Measured on patches Skin tone does not
 * touch, where every other level came back within 0.1 on average. Undone
 * here as the mean of a clipped Gaussian — σ 3.8 at the top and 1.0 at the
 * bottom, the two numbers that reproduce those biases — before rounding
 * to a whole level.
 */
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

export const TOOLS = ['brightness', 'contrast', 'saturation', 'warmth', 'tint', 'skinTone', 'blueTone'];
export const KNOTS = [-100, -75, -50, -37, -25, 25, 37, 50, 75, 100];
export const N = 13;

const [dir, outArg] = process.argv.slice(2);
if (!dir) { console.error('usage: node colour-tables.mjs <copies dir> [png]'); process.exit(2); }
const out = outArg || path.join(import.meta.dirname, '..', '..', 'colour-tables.png');

// The mean a reading of v comes out at when noise of σ is clipped at the
// nearer end of the range, and its inverse by bisection.
const phi = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const clippedMean = (v) => {
  const top = 3.8, bottom = 1.0;
  const d = 255 - v, u = v;
  const over = top * phi(d / top) - d * (1 - Phi(d / top));
  const under = bottom * phi(u / bottom) - u * (1 - Phi(u / bottom));
  return v - over + under;
};
function unclip(m) {
  let lo = -10, hi = 265;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (clippedMean(mid) < m) lo = mid; else hi = mid; }
  return Math.min(255, Math.max(0, (lo + hi) / 2));
}

const W = N * N;
const rows = TOOLS.length * KNOTS.length * N;
const raw = Buffer.alloc((W * 3 + 1) * rows);
TOOLS.forEach((tool, t) => KNOTS.forEach((knot, k) => {
  const file = path.join(dir, `${tool}${knot > 0 ? '+' : ''}${knot}.jpg.lut.json`);
  const pairs = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (pairs.length !== N ** 3) throw new Error(`${file}: ${pairs.length} patches, not ${N ** 3}`);
  pairs.forEach((p, i) => {
    // lut-chart.mjs lays the colours out red outermost, blue innermost.
    const r = Math.floor(i / (N * N)), g = Math.floor(i / N) % N, b = i % N;
    const y = (t * KNOTS.length + k) * N + g;
    const o = y * (W * 3 + 1) + 1 + (b * N + r) * 3;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(unclip(p[3 + c]));
  });
}));

const TB = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TB[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
// Each row filtered the way that leaves it smallest, by the usual measure:
// neighbouring entries differ by a few levels, and so do neighbouring rows.
const plain = Buffer.from(raw);
const stride = W * 3 + 1;
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
for (let y = 0; y < rows; y++) {
  const at = (yy, x) => (yy < 0 || x < 0 ? 0 : plain[yy * stride + 1 + x]);
  let best = null;
  for (let f = 0; f <= 4; f++) {
    const line = Buffer.alloc(stride);
    line[0] = f;
    for (let x = 0; x < W * 3; x++) {
      const v = at(y, x), a = at(y, x - 3), b = at(y - 1, x), c = at(y - 1, x - 3);
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      line[1 + x] = (v - pred) & 255;
    }
    const cost = line.subarray(1).reduce((t, v) => t + (v < 128 ? v : 256 - v), 0);
    if (!best || cost < best.cost) best = { line, cost };
  }
  best.line.copy(raw, y * stride);
}
const head = Buffer.alloc(13);
head.writeUInt32BE(W, 0); head.writeUInt32BE(rows, 4); head[8] = 8; head[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(out, png);
console.log(`${out}: ${W}x${rows}, ${png.length} bytes`);
