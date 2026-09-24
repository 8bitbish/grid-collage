/* The calibration chart: one image where every region answers one question
 * about how an adjustment works. See README.md for how it is used.
 *
 *   node chart.mjs [dir]     writes chart.png and chart.json (the layout
 *                            measure.mjs reads), default ./out
 *
 * Square at 2160, so Grid Collage can export it pixel for pixel — 1:1, one
 * tile, 2160px — and its edits go through the same measuring as Google's.
 */
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || path.join(import.meta.dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
const { png, layout } = await p.evaluate(async () => {
  const W = 2160, H = 2160, X = 56;
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
  const grey = (v) => `rgb(${v},${v},${v})`;
  const L = {};
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  g.fillStyle = grey(128); g.fillRect(0, 0, W, H);
  // A: every level 0..255, 8px each, for the exact tone curve
  L.ramp = { x: X, y: 40, w: 2048, h: 150, step: 8 };
  for (let v = 0; v < 256; v++) { g.fillStyle = grey(v); g.fillRect(X + v * 8, 40, 8, 150); }
  // B: 32 big flat steps, which survive JPEG and resampling
  L.steps = { x: X, y: 230, w: 64, h: 190, levels: [] };
  for (let i = 0; i < 32; i++) { const v = Math.round(i * 255 / 31); L.steps.levels.push(v); g.fillStyle = grey(v); g.fillRect(X + i * 64, 230, 64, 190); }
  // C: the same 128 patch on four surrounds. A global curve moves all four
  // centres identically; a local operator moves them differently.
  L.local = [];
  [0, 64, 192, 255].forEach((s, i) => {
    const x = X + i * 521, y = 460;
    g.fillStyle = grey(s); g.fillRect(x, y, 486, 380);
    g.fillStyle = grey(128); g.fillRect(x + 153, y + 115, 180, 150);
    L.local.push({ surround: s, x, y, w: 486, h: 380, patch: { x: x + 153, y: y + 115, w: 180, h: 150 } });
  });
  // D: colours at three brightnesses, for hue and saturation behaviour
  const COLOURS = [['red', 220, 40, 40], ['orange', 230, 140, 40], ['yellow', 230, 220, 50], ['green', 50, 180, 70], ['cyan', 40, 190, 200], ['blue', 40, 70, 210], ['magenta', 200, 50, 190], ['skin', 224, 172, 140], ['sky', 120, 170, 230]];
  L.colours = [];
  [1, 0.6, 0.3].forEach((k, row) => COLOURS.forEach(([name, r, gg, bb], i) => {
    const rgb = [r, gg, bb].map((v) => Math.round(v * k));
    const x = X + i * 227, y = 880 + row * 120;
    g.fillStyle = `rgb(${rgb})`; g.fillRect(x, y, 227, 120);
    L.colours.push({ name, scale: k, rgb, x, y, w: 227, h: 120 });
  }));
  // E: detail targets for Sharpen
  const y = 1290, h = 380;
  L.edgeBW = { x: X, y, w: 380, h, lo: 20, hi: 235 };
  g.fillStyle = grey(20); g.fillRect(X, y, 190, h); g.fillStyle = grey(235); g.fillRect(X + 190, y, 190, h);
  L.edgeGrey = { x: 468, y, w: 380, h, lo: 100, hi: 170 };
  g.fillStyle = grey(100); g.fillRect(468, y, 190, h); g.fillStyle = grey(170); g.fillRect(658, y, 190, h);
  L.lines = { x: 880, y, w: 380, h, bg: 128, line: 200, every: 24, first: 12 };
  g.fillStyle = grey(128); g.fillRect(880, y, 380, h); g.fillStyle = grey(200);
  for (let x = 880 + 12; x < 1260; x += 24) g.fillRect(x, y, 1, h);
  // A quarter-cycle phase, or the 2px band samples its sine at the zeros
  L.gratings = { x: 1292, y, w: 400, bandH: 63, periods: [2, 3, 4, 6, 8, 12], mean: 128, amp: 40 };
  L.gratings.periods.forEach((per, i) => {
    for (let x = 0; x < 400; x++) { const v = Math.round(128 + 40 * Math.sin(2 * Math.PI * (x + 0.5) / per + Math.PI / 4)); g.fillStyle = grey(v); g.fillRect(1292 + x, y + i * 63, 1, 63); }
  });
  // Faint noise on 128: does Sharpen have a threshold that leaves grain alone?
  L.noise = { x: 1724, y, w: 380, h, mean: 128, sigma: 3 };
  const img = g.getImageData(1724, y, 380, h);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.max(0, Math.min(255, Math.round(128 + 3 * gauss()))); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 1724, y);
  // F: a scene, for judging by eye: bright sky with a sun and cloud texture
  // over dark textured ground. Local tone mapping shows itself here as a halo
  // along the horizon; a global curve cannot make one.
  L.scene = { x: X, y: 1710, w: 2048, h: 380, horizon: 1710 + 220 };
  const sky = g.createLinearGradient(0, 1710, 0, 1990); sky.addColorStop(0, '#6f9fd8'); sky.addColorStop(1, '#e9f1fb');
  g.fillStyle = sky; g.fillRect(X, 1710, 2048, 280);
  g.fillStyle = '#fffbe8'; g.beginPath(); g.arc(X + 1600, 1790, 46, 0, 7); g.fill();
  for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(255,255,255,${0.15 + 0.2 * rnd()})`; g.beginPath(); g.ellipse(X + rnd() * 2048, 1730 + rnd() * 120, 40 + rnd() * 90, 10 + rnd() * 18, 0, 0, 7); g.fill(); }
  g.fillStyle = '#2a2f22'; g.beginPath(); g.moveTo(X, 1930);
  for (let x = 0; x <= 2048; x += 16) g.lineTo(X + x, 1930 - 30 * Math.sin(x / 170) - 18 * Math.sin(x / 53));
  g.lineTo(X + 2048, 2090); g.lineTo(X, 2090); g.fill();
  const ground = g.getImageData(X, 1880, 2048, 210);
  for (let i = 0; i < ground.data.length; i += 4) { if (ground.data[i] < 80) { const n = 10 * gauss(); ground.data[i] += n; ground.data[i + 1] += n; ground.data[i + 2] += n; } }
  g.putImageData(ground, X, 1880);
  L.sceneSky = { x: X + 200, y: 1850, w: 400, h: 60 };
  L.sceneGround = { x: X + 200, y: 2000, w: 400, h: 70 };
  // Corner marks, to find the chart again if a copy comes back cropped or scaled
  g.fillStyle = '#000'; [[8, 8], [W - 28, 8], [8, H - 28], [W - 28, H - 28]].forEach(([x, yy]) => g.fillRect(x, yy, 20, 20));
  g.fillStyle = grey(235); g.font = '26px sans-serif'; g.fillText('grid-collage calibration chart v2 — 2160×2160', X, 2135);
  L.size = { w: W, h: H };
  const blob = await c.convertToBlob({ type: 'image/png' });
  return { png: [...new Uint8Array(await blob.arrayBuffer())], layout: L };
});
fs.writeFileSync(`${out}/chart.png`, Buffer.from(png));
fs.writeFileSync(`${out}/chart.json`, JSON.stringify(layout, null, 1));
await b.close();
console.log('wrote', `${out}/chart.png`, fs.statSync(`${out}/chart.png`).size, 'bytes');
