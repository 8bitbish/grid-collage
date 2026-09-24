/* A measured curve as the 33 knots an ADJUSTMENTS entry carries.
 *
 *   node knots.mjs <results.json> <name>
 *
 * Every eighth level and white, each averaged over five levels to take the
 * JPEG noise out, forced monotonic, and white pinned where JPEG left it at 254.
 * A monotone cubic through these came within 1.7 levels of all 256 measured.
 */
import fs from 'node:fs';
const [file, name] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'))[name].curve;
const c = raw.slice();
for (let i = 1; i < 256; i++) c[i] = Math.max(c[i], c[i - 1]);
if (c[255] >= 253.5) c[255] = 255;
const knots = [...Array(32)].map((_, i) => i * 8).concat(255).map((k) => {
  if (k === 0 || k === 255) return Math.round(c[k] * 10) / 10;
  const w = c.slice(k - 2, k + 3);
  return Math.round((w.reduce((a, v) => a + v, 0) / w.length) * 10) / 10;
});
console.log(`[${knots.join(', ')}]`);
