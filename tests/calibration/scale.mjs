/* Does Sharpen change with the size of the photo, and how?
 *
 *   node scale.mjs make <dir> 1080x1080 2160x2160 4032x3024 [--texture=<sigma>] [--bw]
 *   node scale.mjs measure <dir> <original.png> <edited.jpg> ...
 *   node scale.mjs versus <dir> <original.png> <google.jpg> <ours.png>
 *
 * Google's Sharpen works on a smaller copy of the photo: 1232px across for the
 * 2160 calibration chart, which is 1.5 megapixels. One chart cannot say
 * whether that is always 1.5 megapixels or always the same fraction of the
 * photo, and the two differ by 1.5x in how coarse the detail it sharpens is on
 * a 12MP photo. So the same patch — gratings from 2 to 48px, a hard edge and
 * faint noise, all at their true pixel size — is laid on grey canvases of
 * different sizes. Only the size of the photo changes, so wherever Google's
 * boost peaks moves with it, it is the working copy that moved.
 *
 * `--bw` adds a black and a white square in the top left corner, far from
 * the patch. Without them the patch's own edge, 20|235, is the photo's whole
 * range, and Sharpen's blur estimate stretches every photo to its range
 * before it reads the slopes: with them the same patch reads softer and is
 * sharpened as the calibration chart is.
 *
 * `measure` gives each grating's gain by its fundamental, edited over
 * original; the band it peaks in, in the photo's own pixels, is the answer.
 * It writes the lot to <dir>/scale-results.json too, which is where
 * google-phone-scale.json came from.
 *
 * `versus` asks the question that matters for the app, which never outputs a
 * photo at its own size: drawn into a 2160 square the way an export draws it
 * — centred, covering the tile — does Google's copy look like ours? The
 * original and Google's copy are brought to that geometry with the same
 * smoothing the app uses, and all three are read band by band there.
 */
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';
import fs from 'node:fs'; import path from 'node:path';

// Every period divides the analysis window, so each fundamental is read over
// whole cycles and nothing leaks between them.
const PERIODS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
const WINDOW = 768;
const BAND = { w: WINDOW + 32, h: 60 };
const PATCH = { w: BAND.w, h: PERIODS.length * BAND.h + 140 };

// Self-contained, because it is also run inside the page, where the
// constants above do not exist.
const layoutFor = (W, H, pw, ph, bands, bandH) => {
  const x = Math.round((W - pw) / 2);
  const y = Math.round((H - ph) / 2);
  return { W, H, x, y, bandsY: y, edgeY: y + bands * bandH + 10 };
};

const [cmd, dir, ...rest] = process.argv.slice(2);
if (!cmd || !dir) { console.error('usage: node scale.mjs make <dir> <W>x<H> ... | measure <dir> <original> <edited> ...'); process.exit(2); }
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();

if (cmd === 'make') {
  fs.mkdirSync(dir, { recursive: true });
  // Grain of this spread over the whole surround instead of flat grey, to see
  // whether how busy a photo is changes how hard Sharpen works on it.
  const textureArg = rest.find((a) => a.startsWith('--texture='));
  const texture = textureArg ? Number(textureArg.slice(10)) : 0;
  const bw = rest.includes('--bw');
  for (const size of rest.filter((a) => a !== textureArg && a !== '--bw')) {
    const [W, H] = size.split('x').map(Number);
    const L = layoutFor(W, H, PATCH.w, PATCH.h, PERIODS.length, BAND.h);
    const png = await p.evaluate(async ({ L, PERIODS, BAND, texture, PATCH, bw }) => {
      const c = new OffscreenCanvas(L.W, L.H);
      const g = c.getContext('2d');
      const grey = (v) => `rgb(${v},${v},${v})`;
      g.fillStyle = grey(128); g.fillRect(0, 0, L.W, L.H);
      if (texture) {
        // Blurred a little so it reads as texture at several scales rather
        // than as pixel noise alone, and seeded so it is the same every time.
        let seed = 11;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const small = new OffscreenCanvas(Math.ceil(L.W / 2), Math.ceil(L.H / 2));
        const sg = small.getContext('2d');
        const img = sg.createImageData(small.width, small.height);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
          const v = Math.max(0, Math.min(255, Math.round(128 + texture * n)));
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
        }
        sg.putImageData(img, 0, 0);
        g.imageSmoothingQuality = 'high';
        g.drawImage(small, 0, 0, L.W, L.H);
        g.fillStyle = grey(128); g.fillRect(L.x - 8, L.y - 8, PATCH.w + 16, PATCH.h + 16);
      }
      PERIODS.forEach((per, i) => {
        for (let x = 0; x < BAND.w; x++) {
          g.fillStyle = grey(Math.round(128 + 40 * Math.sin(2 * Math.PI * (x + 0.5) / per + Math.PI / 4)));
          g.fillRect(L.x + x, L.bandsY + i * BAND.h, 1, BAND.h);
        }
      });
      // A hard edge, and faint seeded noise beside it.
      g.fillStyle = grey(20); g.fillRect(L.x, L.edgeY, 200, 120);
      g.fillStyle = grey(235); g.fillRect(L.x + 200, L.edgeY, 200, 120);
      const img = g.getImageData(L.x + 440, L.edgeY, 360, 120);
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < img.data.length; i += 4) {
        const n = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
        const v = Math.max(0, Math.min(255, Math.round(128 + 3 * n)));
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      g.putImageData(img, L.x + 440, L.edgeY);
      g.fillStyle = grey(200); g.font = '20px sans-serif';
      g.fillText(`grid-collage sharpen scale chart ${L.W}x${L.H}`, L.x, L.edgeY + 136);
      if (bw) {
        g.fillStyle = grey(0); g.fillRect(100, 100, 60, 60);
        g.fillStyle = grey(255); g.fillRect(200, 100, 60, 60);
      }
      const blob = await c.convertToBlob({ type: 'image/png' });
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, { L, PERIODS, BAND, texture, PATCH, bw });
    const name = `scale-${W}x${H}${texture ? `-texture${texture}` : ''}${bw ? '-bw' : ''}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(png));
    console.log(name);
  }
} else if (cmd === 'measure') {
  const read = (file) => p.evaluate(async ({ b64, mime, PERIODS, BAND, WINDOW, PATCH, layoutFor }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob());
    const L = new Function(`return (${layoutFor})`)()(bmp.width, bmp.height, PATCH.w, PATCH.h, PERIODS.length, BAND.h);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const fund = PERIODS.map((per, i) => {
      const top = L.bandsY + i * BAND.h + 12;
      const rows = BAND.h - 24;
      const d = g.getImageData(L.x + 16, top, WINDOW, rows).data;
      let cs = 0, sn = 0;
      for (let x = 0; x < WINDOW; x++) {
        let v = 0;
        for (let y = 0; y < rows; y++) v += d[(y * WINDOW + x) * 4 + 1];
        v = v / rows - 128;
        cs += v * Math.cos(2 * Math.PI * (x + 16) / per);
        sn += v * Math.sin(2 * Math.PI * (x + 16) / per);
      }
      return 2 * Math.hypot(cs, sn) / WINDOW;
    });
    const row = g.getImageData(L.x + 190, L.edgeY + 60, 20, 1).data;
    const edge = [...Array(20)].map((_, i) => row[i * 4 + 1]);
    const nd = g.getImageData(L.x + 480, L.edgeY + 20, 280, 80).data;
    let s1 = 0, s2 = 0, n = 0;
    for (let i = 0; i < nd.length; i += 4) { s1 += nd[i + 1]; s2 += nd[i + 1] ** 2; n++; }
    return { size: [bmp.width, bmp.height], fund, edge, noise: Math.sqrt(s2 / n - (s1 / n) ** 2) };
  }, {
    b64: fs.readFileSync(file).toString('base64'),
    mime: /png$/i.test(file) ? 'image/png' : 'image/jpeg',
    PERIODS, BAND, WINDOW, PATCH, layoutFor: layoutFor.toString(),
  });
  const [original, ...edited] = rest;
  const base = await read(original);
  console.log(`${path.basename(original)}  ${base.size.join('x')}  fundamentals ${base.fund.map((v) => v.toFixed(1)).join(' ')}`);
  console.log(`period px        ${PERIODS.map((q) => String(q).padStart(5)).join('')}   noise   edge (20|235)`);
  const results = { periods: PERIODS, [path.basename(original, path.extname(original))]: { ...base, fund: base.fund.map((v) => +v.toFixed(2)), noise: +base.noise.toFixed(2) } };
  for (const f of edited) {
    const r = await read(f);
    const gains = r.fund.map((v, i) => v / base.fund[i]);
    const peak = PERIODS[gains.indexOf(Math.max(...gains))];
    console.log(`${path.basename(f).padEnd(16)} ${gains.map((v) => v.toFixed(2).padStart(5)).join('')}   ${r.noise.toFixed(2)}   ${r.edge.join(' ')}   peak at ${peak}px`);
    results[path.basename(f, path.extname(f))] = { size: r.size, gains: gains.map((v) => +v.toFixed(2)), noise: +r.noise.toFixed(2), edge: r.edge };
  }
  fs.writeFileSync(path.join(dir, 'scale-results.json'), JSON.stringify(results));
}
if (cmd === 'versus') {
  const [original, google, ours] = rest;
  const OUT = 2160;
  const load = (f) => ({ b64: fs.readFileSync(f).toString('base64'), mime: /png$/i.test(f) ? 'image/png' : 'image/jpeg' });
  const res = await p.evaluate(async ({ files, OUT, PERIODS, BAND, WINDOW, PATCH, layoutFor }) => {
    const bmps = await Promise.all(files.map(async (f) => createImageBitmap(await (await fetch(`data:${f.mime};base64,${f.b64}`)).blob())));
    const [orig] = bmps;
    const W = orig.width, H = orig.height;
    const L = new Function(`return (${layoutFor})`)()(W, H, PATCH.w, PATCH.h, PERIODS.length, BAND.h);
    const s = Math.max(OUT / W, OUT / H);
    // As the export draws a photo into a tile: centred, covering it.
    const asExported = (bmp, already) => {
      const c = new OffscreenCanvas(OUT, OUT);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      if (already) g.drawImage(bmp, 0, 0);
      else g.drawImage(bmp, OUT / 2 - (W * s) / 2, OUT / 2 - (H * s) / 2, W * s, H * s);
      return g;
    };
    const gs = [asExported(bmps[0]), asExported(bmps[1]), asExported(bmps[2], bmps[2].width === OUT)];
    const X = (x) => (x - W / 2) * s + OUT / 2;
    const Y = (y) => (y - H / 2) * s + OUT / 2;
    const read = (g) => PERIODS.map((per, i) => {
      const x0 = Math.round(X(L.x + 16)), n = Math.round(WINDOW * s);
      const top = Math.round(Y(L.bandsY + i * BAND.h + 12)), rows = Math.max(4, Math.round((BAND.h - 24) * s));
      const d = g.getImageData(x0, top, n, rows).data;
      let cs = 0, sn = 0, mean = 0;
      const vals = [];
      for (let x = 0; x < n; x++) { let v = 0; for (let y = 0; y < rows; y++) v += d[(y * n + x) * 4 + 1]; vals.push(v / rows); mean += v / rows; }
      mean /= n;
      vals.forEach((v, x) => { cs += (v - mean) * Math.cos(2 * Math.PI * x / (per * s)); sn += (v - mean) * Math.sin(2 * Math.PI * x / (per * s)); });
      return 2 * Math.hypot(cs, sn) / n;
    });
    const [o, gg, us] = gs.map(read);
    return { s, periodsOut: PERIODS.map((q) => q * s), google: gg.map((v, i) => v / o[i]), ours: us.map((v, i) => v / o[i]), base: o };
  }, { files: [load(original), load(google), load(ours)], OUT, PERIODS, BAND, WINDOW, PATCH, layoutFor: layoutFor.toString() });
  console.log(`${path.basename(original)}: drawn at x${res.s.toFixed(3)} into the 2160 export`);
  console.log('period in photo  ' + PERIODS.map((q) => String(q).padStart(6)).join(''));
  console.log('in the export    ' + res.periodsOut.map((q) => q.toFixed(1).padStart(6)).join(''));
  console.log('Google           ' + res.google.map((v) => v.toFixed(2).padStart(6)).join(''));
  console.log('ours             ' + res.ours.map((v) => v.toFixed(2).padStart(6)).join(''));
  // Bands finer than two export pixels cannot be shown at all, so only the
  // ones the export can hold are scored.
  const shown = res.periodsOut.map((q) => q >= 2.5);
  const err = res.google.map((v, i) => Math.abs(v - res.ours[i])).filter((_, i) => shown[i]);
  console.log(`worst gain difference over bands the export can show: ${Math.max(...err).toFixed(2)}`);
}
await b.close();
