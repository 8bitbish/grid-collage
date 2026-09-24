/* Sharpen on real photographs: Google's copy and ours, region by region and
 * period by period, as a 2160 export would show them.
 *
 *   node real.mjs <photo> <original> <google dir> <ours dir> <out dir> [--map] [--dump]
 *
 * <photo> names one of the photos whose regions are written down below.
 * <google dir> holds the phone's copies as google-android.mjs names them,
 * sharpen+N.jpg (or .png), at whatever N the slider really landed on; <ours
 * dir> the app's exports of the same photo from ours.mjs at the same N,
 * sharpen+N.png. The photos themselves are not kept here, being other
 * people's work, and one of them of a real person; what was measured off
 * them is, in google-phone-real.json.
 *
 * The gratings on the calibration chart told the app how Google's Sharpen
 * treats periodic stripes, and a filter tuned to them came out clearly softer
 * than Google's on a photo of a fox: the fur and gravel, which are nothing
 * like stripes, were lifted far less. This is the measurement that caught it
 * and the one the refit was held to.
 *
 * Each image is brought into the same 2160 square the export draws into —
 * centred, covering it, with the same high-quality smoothing — and read
 * there, since that is the only size anyone sees the app's result at. Two
 * readings:
 *
 * - By region: three bands of the brightness. Fine is the photo less a 3x3
 *   box blur of itself, mid that blur less a 7x7 one, coarse the 7x7 less a
 *   15x15. Each band's RMS on the edited copy over the same on the original
 *   is the boost. Box blurs rather than Gaussians so the numbers can be made
 *   again by hand in anything.
 * - By period, over the whole frame: the transfer function, transfer.mjs.
 *
 * Give it a photo whose cover lands on whole pixels — the fox with 4px off
 * either side, 3864x2592, draws at exactly 3220x2160. An edited tile drawn at
 * a fraction of a pixel is resampled a second time on its way into the
 * export, which takes out all of the finest detail across that axis whatever
 * the edit, and the measurement would be of that. It says so if it sees one.
 *
 * It writes <out>/<photo>.json and a side-by-side crop per region and
 * setting — original, Google's, ours — at 1.6 times, nearest neighbour, in
 * <out>/crops. `--map` draws the regions over the original, to check they
 * sit where they say; `--dump` writes each frame's brightness as raw bytes,
 * 2160 x 2160, for anything that wants to look closer.
 */
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';
import { transfer, PERIODS } from './transfer.mjs';
import fs from 'node:fs'; import path from 'node:path';

const OUT = 2160;
const ZOOM = 1.6;

// Each region as [x, y, w, h] in the 2160 export, chosen by eye from the
// frame: what it is for is in its name. Textured, edge-heavy and smooth
// ground in every photo, since Google treats them differently.
const REGIONS = {
  // US Fish and Wildlife Service, public domain, 3872x2592.
  fox: {
    'face fur': [930, 560, 240, 200],
    'muzzle, whiskers': [640, 1180, 260, 200],
    'body fur': [100, 560, 280, 240],
    gravel: [1700, 1720, 300, 260],
    'soft background': [1620, 60, 400, 260],
    'eye and ear edges': [770, 860, 240, 180],
  },
  // The USFWS director's official portrait, public domain, 3325x4987.
  portrait: {
    'cheek skin': [950, 250, 130, 130],
    'other cheek': [1275, 215, 130, 130],
    hair: [1450, 80, 150, 200],
    'eyes, brows': [1000, 70, 320, 110],
    'shirt fabric': [1400, 900, 300, 200],
    badge: [1140, 1130, 180, 190],
    'soft background': [120, 200, 480, 400],
  },
  // Hoh rainforest, Carl Bubar, public domain, 3672x4896: covers at exactly
  // 2160x2880, so needs no crop. Held back from the refit to check it.
  forest: {
    canopy: [310, 40, 400, 280],
    ferns: [620, 960, 300, 240],
    'branches on sky': [90, 800, 400, 380],
    moss: [1030, 1500, 300, 260],
    'hanging moss': [1690, 1400, 280, 380],
    'leaf edges': [700, 1780, 400, 280],
  },
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [photo, original, googleDir, oursDir, outDir] = args.filter((a) => !a.startsWith('--'));
if (!REGIONS[photo] || !outDir) {
  console.error(`usage: node real.mjs <${Object.keys(REGIONS).join('|')}> <original> <google dir> <ours dir> <out dir> [--map] [--dump]`);
  process.exit(2);
}
const regions = REGIONS[photo];
const copies = Object.fromEntries(fs.readdirSync(googleDir).filter((f) => /^sharpen\+\d+\.(jpg|png)$/.test(f))
  .map((f) => [Number(/\d+/.exec(f)[0]), path.join(googleDir, f)]));
const settings = Object.keys(copies).map(Number).sort((a, b) => a - b);
fs.mkdirSync(path.join(outDir, 'crops'), { recursive: true });

const load = (f) => ({ b64: fs.readFileSync(f).toString('base64'), mime: /png$/i.test(f) ? 'image/png' : 'image/jpeg' });
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();

// Everything that touches pixels runs in the page, so the photo is decoded
// and resampled by the same Chromium the app runs in.
await p.evaluate(() => {
  window.frames_ = {};
  window.frame = async (name, file) => {
    const bmp = await createImageBitmap(await (await fetch(`data:${file.mime};base64,${file.b64}`)).blob());
    const c = new OffscreenCanvas(2160, 2160);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (bmp.width === 2160 && bmp.height === 2160) g.drawImage(bmp, 0, 0);
    else {
      const s = Math.max(2160 / bmp.width, 2160 / bmp.height);
      g.drawImage(bmp, 1080 - (bmp.width * s) / 2, 1080 - (bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    }
    frames_[name] = c;
    return [bmp.width, bmp.height];
  };
  window.bands = (name, [x, y, w, h]) => {
    const M = 7;
    const X = x - M, Y = y - M, W = w + 2 * M, H = h + 2 * M;
    const d = frames_[name].getContext('2d').getImageData(X, Y, W, H).data;
    const L = new Float64Array(W * H);
    for (let i = 0; i < L.length; i += 1) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    const box = (a, r) => {
      const pass = (src, dx, dy) => {
        const out = new Float64Array(W * H);
        for (let row = 0; row < H; row += 1) {
          for (let col = 0; col < W; col += 1) {
            let sum = 0;
            for (let k = -r; k <= r; k += 1) {
              const cc = Math.min(W - 1, Math.max(0, col + k * dx));
              const rr = Math.min(H - 1, Math.max(0, row + k * dy));
              sum += src[rr * W + cc];
            }
            out[row * W + col] = sum / (2 * r + 1);
          }
        }
        return out;
      };
      return pass(pass(a, 1, 0), 0, 1);
    };
    const b1 = box(L, 1), b3 = box(L, 3), b7 = box(L, 7);
    const rms = (f) => {
      let s = 0;
      for (let row = M; row < H - M; row += 1) for (let col = M; col < W - M; col += 1) s += f(row * W + col) ** 2;
      return Math.sqrt(s / (w * h));
    };
    return { fine: rms((i) => L[i] - b1[i]), mid: rms((i) => b1[i] - b3[i]), coarse: rms((i) => b3[i] - b7[i]) };
  };
  window.crop = async (names, [x, y, w, h], labels, zoom) => {
    const pw = Math.round(w * zoom), ph = Math.round(h * zoom), gap = 8, head = 22;
    const c = new OffscreenCanvas(names.length * (pw + gap) + gap, ph + head + gap);
    const g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#eee'; g.font = '14px sans-serif';
    names.forEach((n, i) => {
      const left = gap + i * (pw + gap);
      g.fillText(labels[i], left, 16);
      if (frames_[n]) g.drawImage(frames_[n], x, y, w, h, left, head, pw, ph);
    });
    const blob = await c.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  };
  window.map = async (name, regions) => {
    const c = new OffscreenCanvas(1080, 1080);
    const g = c.getContext('2d');
    g.drawImage(frames_[name], 0, 0, 1080, 1080);
    g.strokeStyle = '#0f0'; g.fillStyle = '#0f0'; g.lineWidth = 2; g.font = '16px sans-serif';
    Object.entries(regions).forEach(([label, [x, y, w, h]]) => {
      g.strokeRect(x / 2, y / 2, w / 2, h / 2);
      g.fillText(label, x / 2 + 4, y / 2 + 18);
    });
    const blob = await c.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  };
  window.luma = (name) => {
    const d = frames_[name].getContext('2d').getImageData(0, 0, 2160, 2160).data;
    const out = new Uint8Array(2160 * 2160);
    for (let i = 0; i < out.length; i += 1) out[i] = Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  };
});

const size = await p.evaluate(({ f }) => frame('original', f), { f: load(original) });
const cover = Math.max(OUT / size[0], OUT / size[1]);
if (!Number.isInteger(Math.round(size[0] * cover * 1e6) / 1e6) || !Number.isInteger(Math.round(size[1] * cover * 1e6) / 1e6)) {
  console.warn(`warning: ${size.join('x')} covers the export at ${(size[0] * cover).toFixed(2)}x${(size[1] * cover).toFixed(2)}, `
    + 'not whole pixels, so the app\'s edited export is resampled a second time and loses its finest detail');
}
const brightness = async (name, file) => {
  const bytes = Buffer.from(await p.evaluate((n) => luma(n), name), 'base64');
  if (flags.has('--dump')) fs.writeFileSync(path.join(outDir, `${photo}-${file}.gray`), bytes);
  return Float64Array.from(bytes);
};
const base0 = await brightness('original', 'original');
if (flags.has('--map')) {
  fs.writeFileSync(path.join(outDir, `${photo}-map.png`), Buffer.from(await p.evaluate(({ r }) => map('original', r), { r: regions })));
}
const base = {};
for (const [label, r] of Object.entries(regions)) base[label] = await p.evaluate(({ r }) => bands('original', r), { r });

const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)]));
const results = { photo, size, frame: OUT, regions, periods: PERIODS, original: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, round(v)])), settings: {} };
const fmt = (v) => v.toFixed(2);
for (const s of settings) {
  await p.evaluate(({ f }) => frame('google', f), { f: load(copies[s]) });
  const google = await brightness('google', `google${s}`);
  const oursFile = path.join(oursDir, `sharpen+${s}.png`);
  const haveOurs = fs.existsSync(oursFile);
  let ours = null;
  if (haveOurs) {
    await p.evaluate(({ f }) => frame('ours', f), { f: load(oursFile) });
    ours = await brightness('ours', `ours${s}`);
  } else await p.evaluate(() => { delete frames_.ours; });
  const tg = transfer(base0, google, OUT, OUT);
  const to = ours && transfer(base0, ours, OUT, OUT);
  results.settings[s] = { transfer: { google: tg.map((v) => +v.toFixed(3)), ours: to && to.map((v) => +v.toFixed(3)) }, regions: {} };
  console.log(`\n${photo}, Sharpen ${s}: boost over the original, Google / ours${haveOurs ? '' : ' (no export of ours)'}`);
  console.log(`${'region'.padEnd(20)} ${'fine'.padEnd(12)} ${'mid'.padEnd(12)} coarse`);
  for (const [label, r] of Object.entries(regions)) {
    const boost = async (name) => {
      const m = await p.evaluate(({ n, r }) => bands(n, r), { n: name, r });
      return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +(v / base[label][k]).toFixed(3)]));
    };
    const g = await boost('google');
    const o = haveOurs ? await boost('ours') : null;
    results.settings[s].regions[label] = { google: g, ours: o };
    const cell = (k) => `${fmt(g[k])} / ${o ? fmt(o[k]) : '—'}`.padEnd(12);
    console.log(`${label.padEnd(20)} ${cell('fine')} ${cell('mid')} ${cell('coarse')}`);
    const png = await p.evaluate(({ r, s, ZOOM }) => crop(['original', 'google', 'ours'], r, ['original', `Google, Sharpen ${s}`, `ours, Sharpen ${s}`], ZOOM), { r, s, ZOOM });
    fs.writeFileSync(path.join(outDir, 'crops', `${photo}-${label.replace(/[^a-z]+/g, '-')}-${s}.png`), Buffer.from(png));
  }
  console.log(`transfer by period  ${PERIODS.map((q) => String(q).padStart(5)).join('')}`);
  console.log(`  Google            ${tg.map((v) => fmt(v).padStart(5)).join('')}`);
  if (to) console.log(`  ours              ${to.map((v) => fmt(v).padStart(5)).join('')}`);
}
fs.writeFileSync(path.join(outDir, `${photo}.json`), JSON.stringify(results, null, 1));
await b.close();
