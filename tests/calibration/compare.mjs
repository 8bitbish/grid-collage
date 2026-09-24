/* How far Grid Collage's edits are from Google's, setting by setting.
 *
 *   node compare.mjs <ours results.json> [google.json]
 *
 * The grey steps are what the curves are built from; the colour patches test
 * the colour model on its own. Both in levels, RMS and worst.
 *
 * A detail tool gets a second table: each grating's gain, by its fundamental
 * and against the chart as it came (`none`, or `none@blurred` for the
 * blurred one); how far each edge dips below its dark side and rises past
 * its light side; the 1px line's peak and the dip beside it; and the noise
 * patch's spread.
 */
import fs from 'node:fs'; import path from 'node:path';
const ours = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const google = JSON.parse(fs.readFileSync(process.argv[3] || path.join(import.meta.dirname, 'google.json'), 'utf8'));
console.log('setting           grey rms / worst    colour rms / worst');
for (const [name, g] of Object.entries(google)) {
  const o = ours[name];
  if (!o) continue;
  const grey = o.steps.map((s, i) => Math.abs(s.out[1] - g.steps[i].out[1]));
  let sum = 0, worst = 0, where = '';
  o.colours.forEach((c, i) => {
    const e = Math.hypot(...c.out.map((v, j) => v - g.colours[i].out[j])) / Math.sqrt(3);
    sum += e * e;
    if (e > worst) { worst = e; where = `${c.name}@${c.scale}`; }
  });
  const rms = (a) => Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length);
  console.log(name.padEnd(17), `${rms(grey).toFixed(1).padStart(5)} / ${Math.max(...grey).toFixed(1).padStart(4)}`,
    `      ${Math.sqrt(sum / o.colours.length).toFixed(1).padStart(5)} / ${worst.toFixed(1).padStart(4)} (${where})`);
}

const detail = Object.keys(google).filter((name) => ours[name] && google[name].lines && !name.startsWith('none'));
if (detail.length) {
  const gains = (r, base) => r.gratings.map((q, i) => q.fundamental / base.gratings[i].fundamental);
  const edge = (row, lo, hi) => [lo - Math.min(...row), Math.max(...row) - hi];
  const line = (l) => [l[11] - 200, Math.min(...l.slice(12, 17)) - 128];
  const pair = (o, g) => `${o.toFixed(0).padStart(3)}/${g.toFixed(0).padEnd(3)}`;
  console.log('\nsetting              gain by period 2-12px, ours/Google                                 edge 20|235  edge 100|170  line        noise');
  for (const name of detail) {
    const o = ours[name], g = google[name];
    const base = google[name.includes('@blurred') ? 'none@blurred' : 'none'];
    const go = gains(o, base), gg = gains(g, base);
    // A grating the blur has all but erased has no gain worth dividing out.
    const row = go.map((v, i) => (base.gratings[i].fundamental < 4 ? '    —    ' : `${v.toFixed(2)}/${gg[i].toFixed(2)}`)).join(' ');
    const [bu, bo] = edge(o.edgeBW, 20, 235), [gbu, gbo] = edge(g.edgeBW, 20, 235);
    const [cu, co] = edge(o.edgeGrey, 100, 170), [gcu, gco] = edge(g.edgeGrey, 100, 170);
    const [lp, ld] = line(o.lines), [glp, gld] = line(g.lines);
    console.log(name.padEnd(20), row, ` ${pair(bu, gbu)}${pair(bo, gbo)}  ${pair(cu, gcu)}${pair(co, gco)}  ${pair(lp, glp)}${pair(ld, gld)}  ${o.noise.toFixed(2)}/${g.noise.toFixed(2)}`);
  }
  console.log('edges: how far below the dark side and past the light side; line: its peak past 200, then the deepest of the five beside it');
}
