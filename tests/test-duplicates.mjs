/* Importing what is already in the carousel.
 *
 * Sharing an overlapping selection in twice is easy to do, and the tray used
 * to take every file again: a real export had nine photos in it twice over,
 * with nothing on screen to say so. A file already in the carousel — the same
 * name and the same size — is now left out before it is decoded, and the
 * import says how many were.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import { exifJpeg } from './image.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
const j=o=>JSON.stringify(o);
let pass=0, fail=0;
const ok=(label, good, detail='')=>{ good?pass++:fail++; console.log(`  ${good?'✓':'✗'} ${label}${good||!detail?'':` — ${detail}`}`); };

const jpg = (name, when) => ({ name, mimeType:'image/jpeg', buffer: exifJpeg(`2025:05:20 ${when}`) });
const a = jpg('a.jpg', '10:00:00'), bb = jpg('b.jpg', '10:05:00'), c = jpg('c.jpg', '10:10:00');
const d = jpg('d.jpg', '10:15:00');
const clip = { name:'clip.webm', mimeType:'video/webm', buffer: fs.readFileSync(path.join(ROOT, 'tests/fixtures/clip.webm')) };
// The same name as a photo already in the tray, but a different file: a
// second camera, or a phone that restarted its numbering.
const impostor = { name:'a.jpg', mimeType:'image/jpeg',
  buffer: Buffer.concat([exifJpeg('2025:05:20 11:00:00'), Buffer.alloc(64)]) };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto(`http://localhost:${PORT}/`);
await p.waitForTimeout(400);

const count = () => p.evaluate(()=>document.getElementById('photos-count').textContent);
// Everything said since the last look, not only the toast standing at the end,
// so a message that was shown and then replaced still counts as said.
await p.evaluate(()=>{
  window.__said = [];
  const el = document.getElementById('toast-text');
  new MutationObserver(()=>window.__said.push(el.textContent)).observe(el, { childList:true, characterData:true, subtree:true });
});
const said = () => p.evaluate(()=>window.__said.splice(0));
const importing = async (files, expectCount) => {
  await p.setInputFiles('#file-input', files);
  await p.waitForFunction((n)=>document.getElementById('photos-count').textContent===n, expectCount, {timeout:30000})
    .catch(()=>{});
  // The summary is said once progress has cleared, which takes a moment.
  await p.waitForTimeout(1200);
  return said();
};

console.log('== a first import ==');
{
  const heard = await importing([a, bb, c], '3');
  ok('three in the tray', await count() === '3', await count());
  ok('and nothing about duplicates, since there were none', !heard.some((t)=>/already/.test(t)), j(heard));
}

console.log('\n== the same two again, and one new ==');
{
  const heard = await importing([a, bb, d], '4');
  ok('only the new one went in', await count() === '4', await count());
  ok('and it says so', heard.includes('Added 1 · skipped 2 already in this carousel'), j(heard));
}

console.log('\n== nothing new at all ==');
{
  const heard = await importing([a, c], '4');
  ok('the tray is unchanged', await count() === '4', await count());
  ok('and it says why', heard.includes('All 2 are already in this carousel'), j(heard));
  const one = await importing([d], '4');
  ok('one photo says it in the singular', one.includes('That photo is already in this carousel'), j(one));
}

console.log('\n== one file offered twice in the same go ==');
{
  const heard = await importing([clip, clip], '5');
  ok('goes in once', await count() === '5', await count());
  ok('and the second is counted as skipped',
     heard.includes('Added 1 · skipped 1 already in this carousel'), j(heard));
  const again = await importing([clip], '5');
  ok('a video is recognised too', await count() === '5' && again.includes('That video is already in this carousel'), j(again));
}

console.log('\n== the same name is not enough ==');
{
  await importing([impostor], '6');
  ok('a different file called a.jpg still goes in', await count() === '6', await count());
}

console.log('\n== it holds across a reload ==');
{
  await p.reload();
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='6', null, {timeout:30000});
  await p.waitForTimeout(600);
  await p.evaluate(()=>{
    window.__said = [];
    const el = document.getElementById('toast-text');
    new MutationObserver(()=>window.__said.push(el.textContent)).observe(el, { childList:true, characterData:true, subtree:true });
  });
  const heard = await importing([a, bb, c, d, clip], '6');
  ok('nothing doubled after reopening', await count() === '6', await count());
  ok('all five recognised from what was saved', heard.includes('All 5 are already in this carousel'), j(heard));
}

console.log('\n== nothing threw ==');
ok('no page errors', errs.length === 0, j(errs.slice(0,3)));

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
