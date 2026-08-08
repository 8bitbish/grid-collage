/* A clip is a still almost everywhere it appears — the filmstrip, the slides
   either side, the project cover, the moment before it starts playing. This
   is about which still, and about never showing black instead of one.

   clip.webm is red for its first second and blue for the two after, so the
   file's own first frame and the first frame of a trim at 1.5s are tellable
   apart on sight. */
import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT='/home/user/grid-collage';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0];
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});
  r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8217,r));

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

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});

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
  await p.goto('http://localhost:8217/');
  await p.waitForTimeout(1400);
  await p.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',buffer:clip}]);
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
  await p.waitForTimeout(2200);
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
  await p.waitForTimeout(500);
  if (await p.evaluate(()=>document.getElementById('tile-trim').hidden)) {
    await p.click('#tile-trim-btn');
    await p.waitForTimeout(400);
  }
  await p.evaluate((s)=>{const el=document.getElementById('trim-start');
    el.value=String(Math.round((s/3.07)*1000));
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));}, seconds);
  await p.waitForTimeout(2200);
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
  await p.waitForTimeout(2500);
  const cover=await p.evaluate(()=>{
    const img=document.querySelector('.tile img'); if(!img||!img.naturalWidth) return null;
    const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const g=c.getContext('2d'); g.drawImage(img,0,0);
    const d=g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
    return [d[0],d[1],d[2]];});
  ok('so does the cover on the homepage', name(cover)==='blue', name(cover));

  // Back in, and it is still the trimmed frame rather than a stale one.
  await p.click('.tile');
  await p.waitForTimeout(2500);
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
  await p.waitForTimeout(2200);
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
  await p.waitForTimeout(1200);
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
