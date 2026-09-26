/* A clip is a still almost everywhere it appears — the filmstrip, the slides
   either side, the project cover, the moment before it starts playing. This
   is about which still, and about never showing black instead of one.

   clip.webm is red for its first second and blue for the two after, so the
   file's own first frame and the first frame of a trim at 1.5s are tellable
   apart on sight. */
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
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;

let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };
const name=(c)=>{
  if(!c) return 'nothing';
  if (c[0]>140&&c[1]<110&&c[2]<110) return 'red';
  if (c[2]>140&&c[0]<110) return 'blue';
  if (c[0]<28&&c[1]<28&&c[2]<28) return 'BLACK';
  return `[${c}]`;
};
const clip=fs.readFileSync('fixtures/clip.webm');
// What the fixed sleeps here stood in for: the still being redrawn, the cover
// rebuilt, the clip starting. Each wait below is for the state the assertion
// after it expects, bounded at about twice the sleep it replaces so a slow
// machine has room, and a bound that runs out leaves the failing to that
// assertion. The sampling loops that watch a tile for a second or two are
// what the test is measuring, and stay as they were.
async function until(check, ms=5000){
  const end=Date.now()+ms;
  while(Date.now()<end){ if(await check()) return true; await new Promise(r=>setTimeout(r,50)); }
  return false;
}
const drawn=(c)=>['red','blue'].includes(name(c));

const b=await chromium.launch({executablePath: CHROME});

// ---------------------------------------------------------------------------
async function open(blockFrames) {
  const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
  const p=await ctx.newPage();
  await autoEnter(p);
  if (blockFrames) {
    // Hold every player in the state it is in before it has presented a
    // frame — the state a real phone sits in while a big clip spins up, and
    // the one that used to draw as a black rectangle.
    await p.addInitScript(()=>{
      HTMLVideoElement.prototype.requestVideoFrameCallback = function(){ return 0; };
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, fn, opts){
        if (this instanceof HTMLVideoElement && type==='canplay') return;
        return add.call(this, type, fn, opts);
      };
    });
  }
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  // goto holds until the editor is open; see enter.mjs.
  await p.goto(`http://localhost:${PORT}/`);
  await p.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',buffer:clip}]);
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
  await until(async()=>drawn(await film(p)) && drawn(await mid(p)) && await p.evaluate(()=>{
    const i=document.querySelector('.pm-pick img'); return !!i && (i.getAttribute('src')||'').startsWith('blob:');}));
  return { ctx, p, errs };
}
const mid=(p)=>p.evaluate(()=>{const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
  return [d[0],d[1],d[2]];});
const film=(p)=>p.evaluate(()=>{const c=document.querySelector('.film canvas'); if(!c) return null;
  const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
  return [d[0],d[1],d[2]];});
async function trimTo(p, seconds) {
  const box=await p.locator('#canvas').boundingBox();
  await p.mouse.click(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await p.waitForFunction(()=>!document.getElementById('dp-tile').hidden,null,{timeout:5000}).catch(()=>{});
  if (await p.evaluate(()=>document.getElementById('tile-trim').hidden)) {
    await p.click('#tile-tabs [data-tile="trim"]');
    await p.waitForFunction(()=>!document.getElementById('tile-trim').hidden,null,{timeout:5000}).catch(()=>{});
  }
  const before=name(await film(p));
  await p.evaluate((s)=>{const el=document.getElementById('trim-start');
    el.value=String(Math.round((s/3.07)*1000));
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));}, seconds);
  await until(async()=>{ const now=name(await film(p)); return drawn(await film(p)) && now!==before; });
}

// ---------------------------------------------------------------------------
console.log('== untrimmed, the still is the file\'s first frame ==');
{
  const { ctx, p } = await open(false);
  ok('the filmstrip shows it', name(await film(p))==='red', name(await film(p)));
  const lib = await p.evaluate(()=>{const i=document.querySelector('.pm-pick img');
    return i ? i.getAttribute('src')||'' : '';});
  ok('the library has a thumbnail for it too', lib.startsWith('blob:'), lib.slice(0,12));
  await ctx.close();
}

console.log('\n== trim it, and every still moves to the first frame of the trim ==');
{
  const { ctx, p, errs } = await open(false);
  await trimTo(p, 1.5);
  console.log('  the cut is at', await p.evaluate(()=>document.getElementById('trim-from').textContent));
  ok('the filmstrip follows the cut', name(await film(p))==='blue', name(await film(p)));

  await p.click('#btn-home');
  // The homepage shows first and the new cover lands on it a moment later —
  // encoding it is not worth holding the tap up for — so this waits for the
  // tile's picture to become the cut, not merely for there to be one.
  const coverNow=()=>p.evaluate(()=>{
    const img=document.querySelector('.tile img'); if(!img||!img.complete||!img.naturalWidth) return null;
    const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const g=c.getContext('2d'); g.drawImage(img,0,0);
    const d=g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
    return [d[0],d[1],d[2]];});
  await until(async()=>name(await coverNow())==='blue');
  const cover=await p.evaluate(()=>{
    const img=document.querySelector('.tile img'); if(!img||!img.naturalWidth) return null;
    const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const g=c.getContext('2d'); g.drawImage(img,0,0);
    const d=g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
    return [d[0],d[1],d[2]];});
  ok('so does the cover on the homepage', name(cover)==='blue', name(cover));

  // Back in, and it is still the trimmed frame rather than a stale one.
  await p.click('.tile');
  await until(async()=>!(await p.evaluate(()=>document.body.classList.contains('on-home')))
    && name(await film(p))==='blue');
  ok('and it survives closing and reopening the project', name(await film(p))==='blue', name(await film(p)));
  ok('nothing threw', errs.length===0, errs.slice(0,2).join(' | '));
  await ctx.close();
}

console.log('\n== put the cut back and the still goes back with it ==');
{
  const { ctx, p } = await open(false);
  await trimTo(p, 1.5);
  ok('moved to the trim', name(await film(p))==='blue', name(await film(p)));
  await p.click('#trim-reset');
  await until(async()=>name(await film(p))==='red');
  ok('Whole clip puts the first frame back', name(await film(p))==='red', name(await film(p)));
  await ctx.close();
}

console.log('\n== a clip that has not managed a frame yet shows its still, not black ==');
{
  const { ctx, p, errs } = await open(true);
  // Untrimmed first: the tile must be the file's opening frame throughout.
  const seen=[];
  for (let i=0;i<14;i++){ seen.push(name(await mid(p))); await p.waitForTimeout(80); }
  console.log('  the tile over ~1.1s:', JSON.stringify([...new Set(seen)]));
  ok('never black', !seen.includes('BLACK'), JSON.stringify(seen.filter(s=>s==='BLACK').slice(0,3)));
  ok('it holds the still the whole time', seen.every(s=>s==='red'), JSON.stringify([...new Set(seen)]));

  // And with a trim, it holds the trim's frame — not the file's, not black.
  await trimTo(p, 1.5);
  await until(async()=>name(await mid(p))==='blue');
  const after=[];
  for (let i=0;i<10;i++){ after.push(name(await mid(p))); await p.waitForTimeout(80); }
  console.log('  after trimming:', JSON.stringify([...new Set(after)]));
  ok('still never black', !after.includes('BLACK'));
  ok('and it is the frame the cut lands on', after.every(s=>s==='blue'), JSON.stringify([...new Set(after)]));
  ok('nothing threw', errs.length===0, errs.slice(0,2).join(' | '));
  await ctx.close();
}

console.log('\n== and when it can play, it does ==');
{
  const { ctx, p } = await open(false);
  await until(()=>p.evaluate(()=>{const v=document.querySelector('video'); return !!v && !v.paused && v.currentTime>0.1;}));
  const seen=[];
  for (let i=0;i<24;i++){ seen.push(name(await mid(p))); await p.waitForTimeout(90); }
  const kinds=[...new Set(seen)];
  console.log('  the tile over ~2.2s:', JSON.stringify(kinds));
  ok('it is moving, not frozen on the poster', kinds.length>1, JSON.stringify(kinds));
  ok('and never black while it moves', !seen.includes('BLACK'));
  await ctx.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
