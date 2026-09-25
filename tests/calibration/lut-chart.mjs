/* A colour chart: every colour of an n x n x n RGB grid as a flat patch, for
 * reading a colour tool as a lookup table.
 *
 *   node lut-chart.mjs <dir> [n=9]
 *
 * Writes lut.png, with the grid filling the 2160 square, and lut-on-black.png
 * and lut-on-white.png, with the same grid in the middle half on a black or a
 * white surround. A tool that treats every pixel alike moves a patch the same
 * way on all three; one that looks at the photo first does not. Also
 * lut.json: where each patch is and what colour it was, as a fraction of the
 * frame so it reads the same off a 1000px copy.
 */
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';
import fs from 'node:fs'; import path from 'node:path';
const [dir, nArg] = process.argv.slice(2);
const n = Number(nArg || 9);
fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
const out = await p.evaluate(async (n) => {
  const S = 2160, cols = Math.ceil(Math.sqrt(n ** 3));
  const level = (i) => Math.round((i * 255) / (n - 1));
  const colours = [];
  for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let bl = 0; bl < n; bl++) colours.push([level(r), level(g), level(bl)]);
  const draw = async (surround, x0, size) => {
    const c = new OffscreenCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = surround; g.fillRect(0, 0, S, S);
    const cell = size / cols;
    const patches = colours.map((rgb, i) => {
      const x = x0 + (i % cols) * cell, y = x0 + Math.floor(i / cols) * cell;
      g.fillStyle = `rgb(${rgb.join(',')})`;
      g.fillRect(Math.round(x), Math.round(y), Math.round(x + cell) - Math.round(x), Math.round(y + cell) - Math.round(y));
      return { rgb, cx: (x + cell / 2) / S, cy: (y + cell / 2) / S, r: cell / S };
    });
    const blob = await c.convertToBlob({ type: 'image/png' });
    const b64 = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result.split(',')[1]); f.readAsDataURL(blob); });
    return { b64, patches };
  };
  // The full grid's own surround is the grey between rows, never seen.
  return {
    full: await draw('rgb(128,128,128)', 0, S),
    black: await draw('rgb(0,0,0)', S / 4, S / 2),
    white: await draw('rgb(255,255,255)', S / 4, S / 2),
  };
}, n);
fs.writeFileSync(path.join(dir, 'lut.png'), Buffer.from(out.full.b64, 'base64'));
fs.writeFileSync(path.join(dir, 'lut-on-black.png'), Buffer.from(out.black.b64, 'base64'));
fs.writeFileSync(path.join(dir, 'lut-on-white.png'), Buffer.from(out.white.b64, 'base64'));
fs.writeFileSync(path.join(dir, 'lut.json'), JSON.stringify({ n, full: out.full.patches, black: out.black.patches, white: out.white.patches }));
await b.close();
