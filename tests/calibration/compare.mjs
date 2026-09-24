/* How far Grid Collage's edits are from Google's, setting by setting.
 *
 *   node compare.mjs <ours results.json> [google.json]
 *
 * The grey steps are what the curves are built from; the colour patches test
 * the colour model on its own. Both in levels, RMS and worst.
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
