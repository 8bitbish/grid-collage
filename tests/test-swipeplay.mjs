/* A slide with a clip on it has to play smoothly from the moment it lands, not
   start, stop for a beat and then carry on.

   It did stop, on every swipe in either direction. About a second after a
   clip started the tile held one picture for 235–272ms while the element's
   clock ran on underneath, then caught up. The players are never on screen,
   and with nothing waiting on their frames Chromium stopped handing fresh
   ones to drawImage; keeping a requestVideoFrameCallback pending on each is
   what holds it to 17–51ms, which is a 30fps clip repeating a frame on a
   60Hz screen.

   The two clips are test patterns that change on every frame, so a canvas
   that does not change between two painted frames is a canvas that has not
   been given a new picture. clip.webm cannot do this job: it is one flat
   colour for a second at a time, and looks frozen when it is playing. */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
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

// The worst a healthy run came to was 51ms and the stall never came in under
// 235ms, so this sits well clear of both.
const LONGEST_STILL_MS = 150;

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
// Which kind of picture went onto the preview canvas since the last look: a
// still is the poster standing in, a video element is the clip itself. The
// stall is only counted once the clip has taken over, so the wait for its
// first frame is not mistaken for it.
await p.addInitScript(()=>{
  window.__drawnVideo=false;
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(src,...rest){
    if(this.canvas && this.canvas.id==='canvas' && src instanceof HTMLVideoElement) window.__drawnVideo=true;
    return draw.call(this,src,...rest);
  };
});
await p.goto(`http://localhost:${PORT}/`);

const clips=['moving0.webm','moving1.webm'].map(name=>({name,mimeType:'video/webm',
  buffer:fs.readFileSync(path.join(import.meta.dirname,'fixtures',name))}));
await p.setInputFiles('#file-input', clips);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===2,{timeout:30000});
await p.waitForFunction(()=>{const v=document.querySelector('#players video'); return !!v && !v.paused && v.currentTime>0.2;},
  null,{timeout:10000}).catch(()=>{});

const box=await p.locator('#canvas').boundingBox();
const cy=box.y+box.height/2;
const cdp=await ctx.newCDPSession(p);
const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
const frame=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
// Each move waits for its frame, for the reason test-swipe gives: Chrome
// coalesces moves to the frame, and a flick made of two collapsed samples is
// read as a drag.
async function swipe(dir){
  const from=dir>0?320:70, to=dir>0?70:320;
  await touch('touchStart',[[from,cy]]);
  for(let k=1;k<=6;k++){ await touch('touchMove',[[from+(to-from)*k/6,cy]]); await frame(); }
  await touch('touchEnd',[]);
}

// Watch the preview for 2.5s from the swipe: long enough to take in the
// slide, the clip starting, and the second after it where the stall was.
const watch=()=>p.evaluate(()=>new Promise((done)=>{
  const c=document.getElementById('canvas'); const g=c.getContext('2d',{willReadFrequently:true});
  const t0=performance.now(); let last=t0, lastHash=null, slid=false, started=false, still=0, longest=0;
  const pageAt=()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'));
  const tick=()=>{
    const now=performance.now();
    const sliding=document.getElementById('canvas-wrap').classList.contains('is-sliding');
    const d=g.getImageData(0,0,c.width,c.height).data; let h=0;
    for(let i=0;i<d.length;i+=4097) h=(h*31+d[i]+d[i+1]*7+d[i+2]*13)|0;
    // The clip being left is still drawing when this starts watching, and the
    // canvas stands still under the slide by design; neither is the stall.
    if(sliding) slid=true;
    if(slid && !sliding && window.__drawnVideo) started=true;
    if(started){
      if(h===lastHash) still+=now-last; else { longest=Math.max(longest,still); still=0; }
    }
    window.__drawnVideo=false;
    last=now; lastHash=h;
    if(now-t0<2500) { requestAnimationFrame(tick); return; }
    const v=document.querySelector('#players video');
    done({ started, longest:Math.round(Math.max(longest,still)), page:pageAt(),
      playing: !!v && !v.paused && v.currentTime>0.5 });
  };
  requestAnimationFrame(tick);
}));

for (const [label, dir] of [['forward',1],['back',-1],['forward again',1],['back again',-1]]) {
  console.log(`== swipe ${label} ==`);
  const seen=watch(); await swipe(dir); const r=await seen;
  ok('it landed on the other slide', r.page===(dir>0?1:0), `on ${r.page+1}`);
  ok('and the clip there took over from its poster', r.started);
  ok('and is running', r.playing);
  ok(`the tile never held one picture for more than ${LONGEST_STILL_MS}ms`, r.longest<=LONGEST_STILL_MS, `longest ${r.longest}ms`);
}

ok('nothing threw throughout', errs.length===0, errs.slice(0,3).join(' | '));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
