/* Reads edited copies of the chart back into numbers.
 *
 *   node measure.mjs <dir>    every image in <dir>, each named for the setting
 *                             it carries (highlights-100.jpg, sharpen+50.png)
 *
 * Writes <dir>/results.json: per file, the tone curve off all 256 levels of the
 * ramp, the 32 flat steps, the grey patch on each of its four surrounds (the
 * same on all four means the tool is global), every colour patch, the profile
 * across both edges, the gratings' amplitude by period and the noise patch's
 * spread. Prints a summary of each.
 */
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';
import fs from 'node:fs'; import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node measure.mjs <dir>'); process.exit(2); }
const L = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'out', 'chart.json'), 'utf8'));
const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
const results = {};
for (const f of files) {
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
  const mime = /png$/i.test(f) ? 'image/png' : /webp$/i.test(f) ? 'image/webp' : 'image/jpeg';
  results[f.replace(/\.[^.]+$/, '')] = await p.evaluate(async ({ b64, mime, L }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
    const c = new OffscreenCanvas(L.size.w, L.size.h);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, L.size.w, L.size.h);
    // The middle 60% of a patch, clear of JPEG's ringing at its edges.
    const mean = (x, y, w, h) => {
      const ix = Math.round(w * 0.2), iy = Math.round(h * 0.2);
      const d = g.getImageData(x + ix, y + iy, w - 2 * ix, h - 2 * iy).data;
      const s = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
      return s.map((v) => +(v / (d.length / 4)).toFixed(1));
    };
    const row = (x, y, w) => { const d = g.getImageData(x, y, w, 1).data; return [...Array(w)].map((_, i) => d[i * 4 + 1]); };
    const ramp = g.getImageData(L.ramp.x, L.ramp.y + 20, L.ramp.w, L.ramp.h - 40).data;
    const curve = [...Array(256)].map((_, v) => {
      let s = 0, n = 0;
      for (let y = 0; y < L.ramp.h - 40; y++) for (let x = v * 8 + 2; x < v * 8 + 6; x++) { s += ramp[(y * L.ramp.w + x) * 4 + 1]; n++; }
      return +(s / n).toFixed(2);
    });
    const mid = (e) => e.y + e.h / 2;
    const nd = g.getImageData(L.noise.x + 40, L.noise.y + 40, L.noise.w - 80, L.noise.h - 80).data;
    let s1 = 0, s2 = 0, n = 0;
    for (let i = 0; i < nd.length; i += 4) { s1 += nd[i + 1]; s2 += nd[i + 1] ** 2; n++; }
    return {
      size: [bmp.width, bmp.height],
      curve,
      steps: L.steps.levels.map((v, i) => ({ in: v, out: mean(L.steps.x + i * L.steps.w, L.steps.y, L.steps.w, L.steps.h) })),
      local: L.local.map((q) => ({ surround: q.surround, patch: mean(q.patch.x, q.patch.y, q.patch.w, q.patch.h) })),
      colours: L.colours.map((k) => ({ name: k.name, scale: k.scale, in: k.rgb, out: mean(k.x, k.y, k.w, k.h) })),
      edgeGrey: row(L.edgeGrey.x + L.edgeGrey.w / 2 - 10, mid(L.edgeGrey), 20),
      edgeBW: row(L.edgeBW.x + L.edgeBW.w / 2 - 10, mid(L.edgeBW), 20),
      gratings: L.gratings.periods.map((per, i) => {
        const r = row(L.gratings.x + 20, L.gratings.y + i * L.gratings.bandH + L.gratings.bandH / 2, L.gratings.w - 40);
        return { period: per, amp: +((Math.max(...r) - Math.min(...r)) / 2).toFixed(1) };
      }),
      noise: +Math.sqrt(s2 / n - (s1 / n) ** 2).toFixed(2),
    };
  }, { b64, mime, L });
}
await b.close();
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results));

for (const [name, r] of Object.entries(results)) {
  const centres = r.local.map((l) => Math.round(l.patch[1]));
  console.log(`\n== ${name}  (${r.size.join('x')})`);
  console.log('curve     ', [0, 16, 32, 64, 96, 128, 160, 192, 224, 255].map((v) => `${v}:${Math.round(r.curve[v])}`).join(' '));
  console.log('128 on 0/64/192/255 ->', centres.join(' / '), Math.max(...centres) - Math.min(...centres) > 3 ? '  LOCAL' : '  global');
  console.log('edge 20|235', r.edgeBW.join(' '));
  console.log('gratings  ', r.gratings.map((q) => `${q.period}px:${q.amp}`).join(' '), '| noise', r.noise);
}
