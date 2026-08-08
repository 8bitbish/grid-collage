/* Importing a pile of files takes several seconds. What does the app say
   while it is happening, and does it stop saying it afterwards? */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0];
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});
  r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8233,r));

let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

const STAGE='/tmp/progstage';
fs.rmSync(STAGE,{recursive:true,force:true}); fs.mkdirSync(STAGE,{recursive:true});
const stage=(name,from)=>{const to=path.join(STAGE,name); fs.copyFileSync(from,to); return to;};
const photos=(n)=>Array.from({length:n},(_,i)=>stage(`p${i}.jpg`,`fixtures/photo${i%12}.jpg`));

const b=await chromium.launch({executablePath: CHROME});

async function open() {
  const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
  const p=await ctx.newPage();
  await autoEnter(p);
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.goto('http://localhost:8233/');
  await p.waitForTimeout(1300);
  return { ctx, p, errs };
}
// Everything about the strip in one read.
const strip = (p) => p.evaluate(()=>{
  const el=document.getElementById('toast');
  const bar=document.getElementById('toast-bar');
  return {
    shown: el.classList.contains('is-visible'),
    progress: el.classList.contains('is-progress'),
    text: (document.getElementById('toast-text').textContent||'').trim(),
    barShown: !bar.hidden,
    pct: parseInt(document.getElementById('toast-fill').style.width, 10) || 0,
  };
});

console.log('== a dozen photos, watched the whole way through ==');
{
  const { ctx, p, errs } = await open();
  const seen=[];
  const watch = (async () => {
    for (let i=0;i<120;i++){ seen.push(await strip(p)); await p.waitForTimeout(60); }
  })();
  await p.setInputFiles('#file-input', photos(12));
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='12',{timeout:120000});
  const atEnd = await strip(p);
  await watch;

  const during = seen.filter(s=>s.progress);
  const pcts = during.map(s=>s.pct);
  const texts = [...new Set(during.map(s=>s.text))];
  console.log('  it said:', JSON.stringify(texts));
  console.log('  the bar went:', JSON.stringify([...new Set(pcts)]));

  ok('a bar appeared', during.length > 0, `${during.length} samples with one`);
  ok('and it was visible while it was there', during.every(s=>s.shown && s.barShown));
  ok('it counted, rather than saying one thing', texts.length > 2, JSON.stringify(texts.slice(0,3)));
  ok('it never went backwards', pcts.every((v,i)=>i===0||v>=pcts[i-1]), JSON.stringify(pcts));
  ok('it started low', Math.min(...pcts) <= 25, String(Math.min(...pcts)));
  ok('and it got to the end', Math.max(...pcts) >= 100, String(Math.max(...pcts)));
  ok('the count matched the pile', texts.some(t=>/of 12/.test(t)), JSON.stringify(texts.slice(0,2)));

  // The last file and the end land in the same tick, so the bar is held at
  // full for a moment rather than being pulled away part-swept.
  console.log('  the moment it finished:', JSON.stringify(atEnd));
  ok('it is showing a finished bar, not a part-done one', atEnd.pct === 100, String(atEnd.pct));
  await p.waitForTimeout(700);
  const settled = await strip(p);
  console.log('  a beat later:', JSON.stringify(settled));
  ok('then the bar goes', !settled.progress && !settled.barShown, JSON.stringify(settled));
  ok('and it says what it did with them', /pages/.test(settled.text), settled.text);
  await p.waitForTimeout(3000);
  const later = await strip(p);
  console.log('  three seconds later:', JSON.stringify(later));
  ok('and the strip has gone', !later.shown, JSON.stringify(later));
  ok('nothing threw', errs.length===0, errs.slice(0,2).join(' | '));
  await ctx.close();
}

console.log('\n== one file on its own does not get a bar ==');
{
  const { ctx, p } = await open();
  const seen=[];
  const watch = (async () => {
    for (let i=0;i<40;i++){ seen.push(await strip(p)); await p.waitForTimeout(60); }
  })();
  await p.setInputFiles('#file-input', photos(1));
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:60000});
  await watch;
  ok('no progress bar for a single photo', seen.every(s=>!s.progress),
    JSON.stringify(seen.filter(s=>s.progress).slice(0,2)));
  await ctx.close();
}

console.log('\n== something unreadable in the pile still gets reported ==');
{
  const { ctx, p } = await open();
  const bad = path.join(STAGE,'broken.jpg');
  fs.writeFileSync(bad, Buffer.from([0xFF,0xD8,0xFF,0xE0, ...Array(500).fill(0x41)]));
  const files = [...photos(5), bad];
  await p.setInputFiles('#file-input', files);
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='5',{timeout:90000});
  await p.waitForTimeout(900);
  const after = await strip(p);
  console.log('  after the import:', JSON.stringify(after));
  ok('the failure is not swallowed by the bar', after.shown && /broken|read|JPEG|damaged/i.test(after.text),
    after.text);
  ok('and the bar is gone', !after.progress);
  await ctx.close();
}

console.log('\n== the message after a bulk import is still the useful one ==');
{
  const { ctx, p } = await open();
  await p.setInputFiles('#file-input', photos(6));
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='6',{timeout:90000});
  await p.waitForTimeout(1000);
  const after = await strip(p);
  console.log('  it ends on:', JSON.stringify(after.text));
  ok('it says what it did with them', /pages|photo/i.test(after.text), after.text);
  await ctx.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
