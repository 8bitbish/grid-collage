/* When a clip says it was recorded, against what the app used to believe.
 *
 * The app used to date a video from the file's own timestamp, which is when it
 * was exported rather than when it was shot — measured thirty-two hours out on
 * a real Samsung clip. This drives the whole path in a real browser: the
 * container is read, the clip is placed by what the rest of the tray says about
 * the trip, and a later clip carrying its own offset moves it again.
 *
 * The timezone is pinned to Europe/London, because every number below is a wall
 * clock read in the viewer's zone and the assertions would otherwise depend on
 * where this happens to run.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import { exifJpeg } from './image.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import os from 'node:os'; import { execFileSync } from 'node:child_process';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8179,r));
const j=o=>JSON.stringify(o);
let pass=0, fail=0;
const ok=(label, good, detail='')=>{ good?pass++:fail++; console.log(`  ${good?'✓':'✗'} ${label}${good||!detail?'':` — ${detail}`}`); };

// Two clips, generated rather than committed: a couple of kilobytes each, and
// the point is their metadata rather than their pixels.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cliptime-'));
const MVHD_ONLY = path.join(scratch, 'samsung-like.mp4');
const WITH_OFFSET = path.join(scratch, 'phone-like.mov');
let haveFfmpeg = true;
try {
  // Only mvhd, the way an Android clip arrives: a true instant and no offset,
  // so the wall clock it was shot at is not in the file at all.
  execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i','color=c=red:s=64x64:d=1',
    '-c:v','libx264','-pix_fmt','yuv420p','-metadata','creation_time=2025-03-16T11:07:33Z', MVHD_ONLY]);
  // And one carrying its own offset in a QuickTime date atom, the way an
  // iPhone or a DJI does.
  execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1',
    '-c:v','libx264','-pix_fmt','yuv420p','-f','mov','-metadata','date=2025-04-17T17:07:56+0300',
    '-metadata','creation_time=2025-04-17T14:07:56Z', WITH_OFFSET]);
} catch { haveFfmpeg = false; }

if (!haveFfmpeg) {
  console.log('skipped: needs ffmpeg to build the two clips');
  srv.close();
  process.exit(0);
}

// Far from either clip's real capture time, so using it is unmistakable. This
// is the value the app used to take.
const MTIME = new Date('2025-06-20T15:30:00Z');
fs.utimesSync(MVHD_ONLY, MTIME, MTIME);
fs.utimesSync(WITH_OFFSET, MTIME, MTIME);

const clipFile = (p, type) => ({ name: path.basename(p), mimeType: type, buffer: fs.readFileSync(p) });

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2,
  timezoneId:'Europe/London'});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8179/');
await p.waitForTimeout(400);

// Everything the app knows, read back off the Data export rather than guessed
// at from the screen.
const rows = async () => {
  await p.evaluate(()=>document.getElementById('pm-data').click());
  await p.waitForTimeout(150);
  const text = await p.inputValue('#pm-data-text');
  const [head, ...body] = text.trim().split('\n');
  const cols = head.split('\t');
  return body.map((line)=>Object.fromEntries(line.split('\t').map((v,i)=>[cols[i], v])));
};
const byName = (all, part) => all.find((r)=>r.name.includes(part));

console.log('== a clip with only mvhd, beside photos from the same afternoon ==');
// Photos at 13:05 and 13:10 local. The clip's mvhd says 11:07:33 UTC, so the
// trip was two hours ahead of UTC and the clip belongs at 13:07:33.
await p.setInputFiles('#file-input', [
  { name:'p1.jpg', mimeType:'image/jpeg', buffer: exifJpeg('2025:03:16 13:05:00') },
  { name:'p2.jpg', mimeType:'image/jpeg', buffer: exifJpeg('2025:03:16 13:10:00') },
  clipFile(MVHD_ONLY, 'video/mp4'),
]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='3', null, {timeout:60000});
await p.waitForTimeout(600);
await p.click('#btn-photos');
await p.waitForTimeout(300);
{
  const all = await rows();
  const clip = byName(all, 'samsung-like');
  ok('the clip was read as a video', clip && clip.kind === 'video', clip && clip.kind);
  ok('its own UTC came off mvhd', clip && clip.clipUtc === '2025-03-16T11:07:33.000Z', clip && clip.clipUtc);
  ok('it named no offset, so the tray had to supply one', clip && clip.clipZone === '', clip && clip.clipZone);
  ok('it is NOT the file date the app used to take',
     clip && !clip.takenISO.startsWith('2025-06-20'), clip && clip.takenISO);
  // London is on GMT in March, so a 13:07:33 wall clock is 13:07:33Z.
  ok('placed at 13:07:33, two hours on from its UTC, beside the photos',
     clip && clip.takenISO === '2025-03-16T13:07:33.000Z', clip && clip.takenISO);
  console.log('   photos:', j(all.filter(r=>r.kind==='photo').map(r=>r.takenISO)));
  console.log('   clip:  ', clip && clip.takenISO);
}

console.log('\n== the clip and the photos now land in one event ==');
{
  await p.click('#pm-by-events');
  await p.waitForTimeout(300);
  const groups = await p.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#pm-grid > *').forEach((el)=>{
      if (el.classList.contains('pm-day')) out.push(0);
      else if (out.length) out[out.length-1] = el.querySelectorAll('.pm-item').length;
    });
    return out;});
  ok('one event holding all three', groups.length === 1 && groups[0] === 3, j(groups));
  await p.click('#pm-by-days');
  await p.waitForTimeout(200);
}

console.log('\n== a clip carrying its own offset is taken at its word ==');
await p.setInputFiles('#file-input', [clipFile(WITH_OFFSET, 'video/quicktime')]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='4', null, {timeout:60000});
await p.waitForTimeout(600);
{
  const all = await rows();
  const clip = byName(all, 'phone-like');
  ok('the offset it named was read', clip && clip.clipZone === '3', clip && clip.clipZone);
  // 17:07:56 in London in April is BST, so 16:07:56Z.
  ok('placed at the wall clock it names, 17:07:56',
     clip && clip.takenISO === '2025-04-17T16:07:56.000Z', clip && clip.takenISO);
  ok('not the file date either', clip && !clip.takenISO.startsWith('2025-06-20'), clip && clip.takenISO);
}

console.log('\n== and it re-places the clip that had no offset of its own ==');
{
  // A clip that stated its offset is better evidence than photos lined up
  // against it, and a trip is almost always one zone throughout — so the first
  // clip moves from the guessed +2 to the stated +3.
  const all = await rows();
  const clip = byName(all, 'samsung-like');
  ok('the first clip shifted to the stated offset',
     clip && clip.takenISO === '2025-03-16T14:07:33.000Z', clip && clip.takenISO);
  ok('its own UTC is untouched, so it can be placed again',
     clip && clip.clipUtc === '2025-03-16T11:07:33.000Z', clip && clip.clipUtc);
}

console.log('\n== it survives a reload ==');
{
  await p.click('#pm-close');
  await p.reload();
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='4', null, {timeout:30000});
  await p.waitForTimeout(800);
  await p.click('#btn-photos');
  await p.waitForTimeout(300);
  const all = await rows();
  const clip = byName(all, 'samsung-like');
  const other = byName(all, 'phone-like');
  ok('the clip kept its place', clip && clip.takenISO === '2025-03-16T14:07:33.000Z', clip && clip.takenISO);
  ok('and its UTC came back off the database', clip && clip.clipUtc === '2025-03-16T11:07:33.000Z', clip && clip.clipUtc);
  ok('so did the stated offset', other && other.clipZone === '3', other && other.clipZone);
}

console.log('\n== nothing threw ==');
ok('no page errors', errs.length === 0, j(errs.slice(0,3)));

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); srv.close();
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
