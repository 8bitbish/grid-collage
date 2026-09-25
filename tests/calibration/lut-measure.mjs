/* Reads a colour chart back: for each patch, the colour that went in and the
 * colour that came out, averaged over the middle of the patch, clear of the
 * edges a JPEG's halved colour smears across.
 *
 *   node lut-measure.mjs <lut.json> <full|black|white> <copy> [<copy> ...]
 *
 * Prints, per copy, how far the colours moved on average, and writes
 * <copy>.lut.json beside each: [[r, g, b, R, G, B], ...] in 0..255.
 */
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';
import fs from 'node:fs';
const [layoutFile, which, ...copies] = process.argv.slice(2);
const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'))[which];
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
for (const copy of copies) {
  const pairs = await p.evaluate(async ({ b64, mime, layout }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return layout.map(({ rgb, cx, cy, r }) => {
      const half = Math.max(1, Math.floor((r * bmp.width * 0.4) / 2));
      const x = Math.round(cx * bmp.width) - half, y = Math.round(cy * bmp.height) - half;
      const d = g.getImageData(x, y, half * 2, half * 2).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
      const k = d.length / 4;
      return [...rgb, ...sum.map((s) => +(s / k).toFixed(2))];
    });
  }, { b64: fs.readFileSync(copy).toString('base64'), mime: /png$/i.test(copy) ? 'image/png' : 'image/jpeg', layout });
  fs.writeFileSync(`${copy}.lut.json`, JSON.stringify(pairs));
  const moved = pairs.reduce((t, q) => t + Math.hypot(q[3] - q[0], q[4] - q[1], q[5] - q[2]), 0) / pairs.length;
  console.log(`${copy.split('/').pop()}: ${pairs.length} patches, moved ${moved.toFixed(1)} on average`);
}
await b.close();
