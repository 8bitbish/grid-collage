/* The order Google Photos applies its tools in when more than one is set,
 * read off copies with two or three sliders set at once.
 *
 *   node order.mjs <single> [<single> ...] --together <dir> [<dir> ...]
 *
 * <single> folders hold one-tool copies of the 13x13x13 chart, read by
 * lut-measure.mjs (<setting>.jpg.lut.json, such as saturation+50); every
 * tool in a combination needs its own. --together folders hold copies of
 * the 9x9x9 chart with several set, brightness+50,warmth+50.jpg.lut.json,
 * as google-web.mjs names them.
 *
 * Each combination is predicted in every order of its own tools by running
 * the 9³ colours through Google's single-tool tables one after another —
 * tetrahedrally, as the app does — and scored against Google's copy: mean
 * and 90th percentile of the RGB distance. Then every global order of the
 * form the pairs pointed to is scored over all of them at once: Warmth and
 * Tint first, the six light tools in any order with Brightness allowed a
 * place of its own when negative, then the three colour tools in any order.
 * A combination's score depends only on the relative order of its own
 * tools, so that is an addition per order, not a prediction.
 *
 * Why tables from Google rather than the app's own tools: the app's tone
 * tools were fitted to greys, and are a few levels off Google's on colours
 * (see the README), which would count against the right order.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const split = args.indexOf('--together');
if (split < 1 || split === args.length - 1) {
  console.error('usage: node order.mjs <single> [<single> ...] --together <dir> [<dir> ...]');
  process.exit(2);
}
const singles = args.slice(0, split);
const together = args.slice(split + 1);

const N = 13;
const LEVELS = [...Array(N)].map((_, i) => Math.round((i * 255) / (N - 1)));
function table(file) {
  const t = new Float64Array(N * N * N * 3);
  for (const e of JSON.parse(fs.readFileSync(file))) {
    const [r, g, b] = e.slice(0, 3).map((v) => LEVELS.indexOf(v));
    t.set(e.slice(3), ((r * N + g) * N + b) * 3);
  }
  const cell = (x) => {
    x = Math.min(255, Math.max(0, x));
    let k = 0;
    while (k < N - 2 && x > LEVELS[k + 1]) k++;
    return [k, (x - LEVELS[k]) / (LEVELS[k + 1] - LEVELS[k])];
  };
  return (rgb) => {
    const [[r, fr], [g, fg], [b, fb]] = rgb.map(cell);
    const at = (dr, dg, db) => { const o = (((r + dr) * N + g + dg) * N + b + db) * 3; return [t[o], t[o + 1], t[o + 2]]; };
    const steps = [[fr, [1, 0, 0]], [fg, [0, 1, 0]], [fb, [0, 0, 1]]].sort((x, y) => y[0] - x[0]);
    const corner = [0, 0, 0];
    let prev = at(0, 0, 0);
    const out = [...prev];
    for (const [f, d] of steps) {
      d.forEach((v, c) => { corner[c] += v; });
      const next = at(...corner);
      for (let c = 0; c < 3; c++) out[c] += f * (next[c] - prev[c]);
      prev = next;
    }
    return out;
  };
}
const tools = {};
const tool = (setting) => {
  if (!tools[setting]) {
    const file = singles.map((d) => path.join(d, `${setting}.jpg.lut.json`)).find((f) => fs.existsSync(f));
    if (!file) return null;
    tools[setting] = table(file);
  }
  return tools[setting];
};
const permutations = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
const score = (pred, copy) => {
  const d = copy.map((q, i) => Math.hypot(pred[i][0] - q[3], pred[i][1] - q[4], pred[i][2] - q[5])).sort((a, b) => a - b);
  return { mean: d.reduce((a, b) => a + b, 0) / d.length, p90: d[Math.floor(d.length * 0.9)] };
};

const combos = [];
for (const dir of together) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jpg.lut.json') && x.includes(',')).sort()) {
    const names = f.replace('.jpg.lut.json', '').split(',');
    const fns = names.map(tool);
    if (fns.includes(null)) { console.log(`${names.join(',')}: no single-tool copy of ${names[fns.indexOf(null)]}`); continue; }
    const copy = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const byOrder = {};
    for (const ord of permutations([...names.keys()])) {
      byOrder[ord.map((i) => names[i]).join('>')] = score(copy.map((q) => ord.reduce((c, i) => fns[i](c), q.slice(0, 3))), copy);
    }
    combos.push({ names, byOrder });
    const ranked = Object.entries(byOrder).sort((a, b) => a[1].mean - b[1].mean);
    console.log(names.join(',').padEnd(44), ranked.map(([o, s]) => `${o.replace(/[+-]\d+/g, '')} ${s.mean.toFixed(1)}/${s.p90.toFixed(1)}`).join('   '));
  }
}

const place = (order, setting) => {
  const [, id, v] = /^([a-zA-Z]+)([+-]\d+)$/.exec(setting);
  return order.indexOf(id === 'brightness' && Number(v) < 0 && order.includes('brightness-') ? 'brightness-' : id);
};
const overall = (order) => combos.reduce((t, { names, byOrder }) => t + byOrder[[...names].sort((a, b) => place(order, a) - place(order, b)).join('>')].mean, 0) / combos.length;
const LIGHT = ['whitePoint', 'highlights', 'shadows', 'blackPoint', 'contrast', 'brightness'];
const TAIL = ['saturation', 'skinTone', 'blueTone'];
const ranked = [];
for (const light of permutations(LIGHT)) {
  const withNegative = [light, ...[...Array(light.length + 1).keys()].map((i) => [...light.slice(0, i), 'brightness-', ...light.slice(i)])];
  for (const lv of withNegative) for (const tail of permutations(TAIL)) {
    const order = ['warmth', 'tint', ...lv, ...tail];
    ranked.push([order, overall(order)]);
  }
}
ranked.sort((a, b) => a[1] - b[1]);
console.log(`\n${combos.length} combinations; the best global orders, mean RGB distance over all of them:`);
ranked.slice(0, 5).forEach(([o, m]) => console.log(`${m.toFixed(2)}  ${o.join(' > ')}`));
const PANEL = ['brightness', 'contrast', 'whitePoint', 'highlights', 'shadows', 'blackPoint', 'saturation', 'warmth', 'tint', 'skinTone', 'blueTone'];
console.log(`${overall(PANEL).toFixed(2)}  the panel's order`);
