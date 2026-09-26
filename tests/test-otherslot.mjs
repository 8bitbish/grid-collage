/* Choosing a photo for one slot leaves the clip playing in another.
   With a clip in one slot and the Replace reel sliding through photos for the
   slot beside it, the clip used to flicker back to its first frame: every
   photo the reel landed on redrew the preview, and that redraw drew the clip
   as its still. When the clip's own next frame was late behind a 12MP decode,
   the still stayed on screen. So the photos here are the 12MP fixtures, and
   the canvas is sampled between frames as well as on them, because what it
   holds between paints is what is on screen until the next one.

   clip.webm is red for its first second and blue after, so red in the clip's
   slot while the clip is well past its first second can only be the still.
   Well past, because what is drawn trails currentTime by a frame or two: with
   the line at 1.1s, the clip's own last red frames, drawn at 1.2s, counted as
   the still once a run on a build that has no flicker at all. */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:420,height:860},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
const settle=(fn, arg)=>p.waitForFunction(fn, arg, {timeout:15000}).catch(()=>{});

await p.goto(`http://localhost:${PORT}/`);
await p.setInputFiles('#file-input', path.resolve('fixtures/clip.webm'));
await settle(()=>document.getElementById('photos-count').textContent==='1');

// Two slots side by side, the clip on the left.
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn:nth-child(2)');
await p.click('#dock-back').catch(()=>{});
await p.setInputFiles('#file-input', [0,1,2,3].map((i)=>path.resolve(`fixtures/photo${i}.jpg`)));
await settle(()=>document.getElementById('photos-count').textContent==='5');

// Tapping the empty slot fills it; tapping it again picks it up.
const box=await p.locator('#canvas').boundingBox();
const right={x:box.x+box.width*0.75, y:box.y+box.height/2};
await p.mouse.click(right.x, right.y);
await p.waitForFunction(()=>!document.getElementById('dp-tile').hidden,null,{timeout:2000}).catch(()=>{});
if (!(await p.evaluate(()=>!document.getElementById('dp-tile').hidden))) await p.mouse.click(right.x, right.y);
await settle(()=>!document.getElementById('dp-tile').hidden);
await p.click('#tile-actions [data-tile="replace"]');
await settle(()=>!document.getElementById('tile-replace').hidden
  && document.getElementById('choose-strip').children.length===6);

console.log('== the clip keeps playing while the slot beside it is chosen for ==');
await settle(()=>{const v=document.querySelector('video'); return v && v.currentTime>1.4 && v.currentTime<1.6;});
const run = await p.evaluate(()=>new Promise((done)=>{
  const c=document.getElementById('canvas'); const g=c.getContext('2d');
  const strip=document.getElementById('choose-strip');
  const reel=document.getElementById('choose-reel');
  const t0=performance.now(); let step=0; let since=null; const spans=[]; let samples=0; let landed=0;
  // The four photos, a quarter of a second each. Add is the reel's first stop
  // and the clip its second, so the slot being chosen for never becomes the
  // clip here. A wheel with each, as the reel only chooses while scrolled.
  const timer=setInterval(()=>{ step+=1; const el=strip.children[2+(step%4)];
    reel.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));
    reel.scrollLeft=el.offsetLeft-(reel.clientWidth-el.offsetWidth)/2; landed+=1; }, 250);
  const look=()=>{
    const v=document.querySelector('video'); if(!v) return;
    const d=g.getImageData(Math.floor(c.width*0.25),Math.floor(c.height/2),1,1).data; samples+=1;
    const still=d[0]>140&&d[2]<110&&v.currentTime>1.35&&v.currentTime<2.9;
    const now=performance.now();
    if(still&&since===null) since=now;
    if(!still&&since!==null){ spans.push(Math.round(now-since)); since=null; }
  };
  const poll=setInterval(look,4);
  const tick=()=>{ look(); if(performance.now()-t0<1600) requestAnimationFrame(tick);
    else { clearInterval(timer); clearInterval(poll); if(since!==null) spans.push(Math.round(performance.now()-since)); done({spans,samples,landed}); } };
  requestAnimationFrame(tick);
}));
console.log(`  ${run.landed} landings, ${run.samples} samples; the still showed ${run.spans.length} times`,
  run.spans.length ? `(${run.spans.join('ms, ')}ms)` : '');
ok('the reel moved the whole time', run.landed>=5, String(run.landed));
ok('and was sampled throughout', run.samples>=50, String(run.samples));
ok('the clip never dropped back to its still', run.spans.length===0, JSON.stringify(run.spans));
ok('still playing at the end', await p.evaluate(()=>{const v=document.querySelector('video'); return !!v && !v.paused;}));
ok('nothing threw', errs.length===0, errs.slice(0,2).join(' | '));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
