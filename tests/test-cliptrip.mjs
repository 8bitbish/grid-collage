/* A trip's zone, found even when some of its clips are nowhere near a photo.
 *
 * Replayed from a real library: a day shot at +09:00 and looked at from
 * +03:00, with five clips that carry only mvhd — a true instant and no offset.
 * Three of them were filmed among the photos. Two were filmed in the morning,
 * hours before the first photo, so no offset puts them near one. The times of
 * day are the real ones to within a few seconds; the date is not.
 *
 * Scored by the mean, those two cost every offset about the same and pulled
 * the scores together: +9 came to 51.0 minutes and +10.75 to 51.8, the guess
 * was refused as a tie, and every clip stayed on UTC — read as though filmed
 * where it was being looked at, six hours out. Scored by the typical clip,
 * +9 wins by a street and each clip lands beside the photos it was shot with.
 *
 * The viewer's zone is pinned to Europe/Vilnius, which is +03:00 in April,
 * because every number here is a wall clock read in the viewer's zone.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import { exifJpeg } from './image.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import os from 'node:os'; import { execFileSync } from 'node:child_process';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
const j=o=>JSON.stringify(o);
let pass=0, fail=0;
const ok=(label, good, detail='')=>{ good?pass++:fail++; console.log(`  ${good?'✓':'✗'} ${label}${good||!detail?'':` — ${detail}`}`); };

const DAY = '2025-04-10';
const HOUR = 3600000;

// The photos, as the export showed them: the viewer's reading of each EXIF wall
// clock, which is the +09:00 wall clock less three hours.
const shown = `11:20:58 11:23:36 11:25:17 11:24:14 11:23:57 11:26:23 11:42:03 11:44:01 11:44:15 11:45:01
11:49:24 11:54:35 11:57:45 11:59:56 12:01:43 12:00:33 12:00:03 12:01:44 12:10:34 12:12:19 12:19:03 12:24:00
12:23:09 12:22:40 12:26:10 12:29:10 12:29:00 12:26:20 12:30:26 12:30:21 12:30:08 12:31:45 12:33:29 12:32:03
12:32:00 12:41:11 12:40:32 12:34:59 12:44:44 12:44:36 12:41:47 12:48:16 12:45:44 12:45:22 12:49:26 12:50:44
12:49:08 12:53:15 12:52:47 12:51:45 13:06:57 13:05:44 12:57:54 12:56:09 12:55:02 12:53:54 13:09:20 13:07:24
13:07:13 13:10:48 13:10:41 13:09:23 13:18:25 13:17:41 13:12:42 13:19:41 13:19:34 13:18:48 13:21:22 13:21:19
13:20:16 13:24:13 13:23:45 13:21:32 13:27:27 13:27:18 13:25:19 13:31:10 13:30:03 13:30:01 13:33:04 13:31:41
13:36:13 13:34:45 13:33:11 13:39:07 13:38:22 13:36:23 14:51:01 13:52:37 13:51:18 13:51:06 13:47:05 13:43:52
13:43:41 13:43:29 13:42:10 18:25:33 18:21:29 18:10:13 15:20:51 15:20:53 15:20:34 15:20:32 14:53:54 14:51:37
14:51:30 14:51:16 14:51:07`.split(/\s+/);
const exifOf = (hms) => {
  const wall = new Date(Date.parse(`${DAY}T${hms}Z`) + 3 * HOUR).toISOString();
  return `${wall.slice(0, 10).replace(/-/g, ':')} ${wall.slice(11, 19)}`;
};
const photos = shown.map((hms, i) => ({
  name: `p${String(i).padStart(3, '0')}.jpg`, mimeType: 'image/jpeg', buffer: exifJpeg(exifOf(hms)),
}));

// The five clips, at their real mvhd instants.
const CLIPS = [
  ['morning-a', '02:59:28'], ['morning-b', '03:35:28'], ['among-photos', '07:31:45'],
  ['evening-a', '12:29:34'], ['evening-b', '12:29:40'],
];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cliptrip-'));
let haveFfmpeg = true;
const clips = [];
try {
  for (const [name, utc] of CLIPS) {
    const file = path.join(scratch, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i','color=c=gray:s=64x64:d=1',
      '-c:v','libx264','-pix_fmt','yuv420p','-metadata',`creation_time=${DAY}T${utc}Z`, file]);
    clips.push({ name: `${name}.mp4`, mimeType: 'video/mp4', buffer: fs.readFileSync(file) });
  }
} catch { haveFfmpeg = false; }
if (!haveFfmpeg) {
  console.log('skipped: needs ffmpeg to build the clips');
  srv.close();
  process.exit(0);
}

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2,
  timezoneId:'Europe/Vilnius'});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto(`http://localhost:${PORT}/`);
await p.waitForTimeout(400);

const total = photos.length + clips.length;
await p.setInputFiles('#file-input', [...photos, ...clips]);
await p.waitForFunction((n)=>document.getElementById('photos-count').textContent===String(n), total, {timeout:90000});
await p.waitForTimeout(800);
await p.click('#btn-photos');
await p.waitForTimeout(300);

await p.evaluate(()=>document.getElementById('pm-data').click());
await p.waitForTimeout(150);
const text = await p.inputValue('#pm-data-text');
const [head, ...body] = text.trim().split('\n');
const cols = head.split('\t');
const rows = body.map((line)=>Object.fromEntries(line.split('\t').map((v,i)=>[cols[i], v])));
const clip = (name) => rows.find((r)=>r.name === `${name}.mp4`);

console.log('== the viewer is where the export was looked at ==');
ok('+03:00 on the day', await p.evaluate((d)=>new Date(`${d}T12:00:00`).getTimezoneOffset(), DAY) === -180);

console.log('\n== every clip moves by the trip\'s +09:00, not left on UTC ==');
// At +09:00 viewed from +03:00, a clip reads six hours on from its own UTC.
for (const [name, utc] of CLIPS) {
  const want = new Date(Date.parse(`${DAY}T${utc}Z`) + 6 * HOUR).toISOString();
  const row = clip(name);
  ok(`${name} at ${want.slice(11, 19)}`, row && row.takenISO === want, row && row.takenISO);
  ok(`${name} named no offset of its own`, row && row.clipZone === '', row && row.clipZone);
}

console.log('\n== and lands beside the photos it was shot with ==');
{
  // The clip filmed among the photos sits between the two taken either side of
  // it — which its file number said all along.
  const among = clip('among-photos');
  const t = among && Date.parse(among.takenISO);
  const before = Date.parse(`${DAY}T13:31:41Z`), after = Date.parse(`${DAY}T13:33:04Z`);
  ok('between the photos at 13:31:41 and 13:33:04', t > before && t < after, among && among.takenISO);
  const evening = clip('evening-a');
  const gap = evening && (Date.parse(evening.takenISO) - Date.parse(`${DAY}T18:25:33Z`)) / 60000;
  ok('the evening clips four minutes after the last photo', gap > 0 && gap < 5, String(gap));
}

console.log('\n== nothing threw ==');
ok('no page errors', errs.length === 0, j(errs.slice(0,3)));

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); srv.close();
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
