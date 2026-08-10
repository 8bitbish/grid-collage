import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8142,r));

const _pages = (pg) => pg.evaluate(()=>document.querySelectorAll('.film').length);
const _photos = (pg) => pg.evaluate(()=>document.querySelectorAll('.pm-item').length);
const _current = (pg) => pg.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1);
const _openDrawer = (pg, name) => pg.click(`.dock-item[data-drawer="${name}"]`);
function png(w,h,[r0,g0,b0]){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=r0;raw[o+2+x*3]=g0;raw[o+3+x*3]=b0;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const cols=[[220,40,40],[40,200,90],[50,90,230],[240,190,40],[200,60,210]];
const files=cols.map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(600,600,c)}));

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:8142/');
await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===5);
const pager=()=>_current(p);
const trackX=()=>p.evaluate(()=>{const t=getComputedStyle(document.getElementById('track')).transform;
  if(t==='none')return 0; return Math.round(parseFloat(t.split(',')[4]));});
const peekVisible=()=>p.evaluate(()=>{
  const el=document.getElementById('canvas-next');
  return getComputedStyle(el).visibility==='visible' && !el.hidden;});

console.log('start:', await pager(), '| track at', await trackX(), '| next page visible:', await peekVisible());

const box=await p.locator('#canvas').boundingBox();
const cy=box.y+box.height/2;
const cdp=await ctx.newCDPSession(p);
const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
// Chrome delivers pointermove aligned to the animation frame, so dispatching
// two moves back to back gets one pointermove carrying the second position —
// or, if the frame has not come round yet, none at all. Both showed up here as
// app bugs that were not: the 1:1 assertion read the track while the second
// move was still queued and saw only the first, and the dawdle-then-flick case
// lost its whole tail to coalescing, leaving one sample where the velocity
// needs two. A move followed by its frame is also closer to what a finger does
// — a real one cannot move twice inside 16ms either.
const move=async(x)=>{ await touch('touchMove',[[x,cy]]);
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); };

// slow drag: track should follow the finger 1:1 and reveal the next page
await touch('touchStart',[[300,cy]]);
await move(280);
await move(220);
const mid = await trackX();
console.log('dragged 80px left -> track at', mid, Math.abs(mid+80)<12 ? '✓ follows the finger' : '✗ not 1:1');
console.log('  neighbouring page revealed:', await peekVisible() ? '✓' : '✗');
await touch('touchEnd',[]);
await p.waitForTimeout(400);
console.log('  released past threshold ->', await pager(), '| track reset to', await trackX());

// short slow drag should spring back, not turn the page
const before = await pager();
await touch('touchStart',[[300,cy]]);
for (const x of [292,285,280,276,274]) { await move(x); await p.waitForTimeout(40); }
await touch('touchEnd',[]);
await p.waitForTimeout(400);
console.log(`short slow drag: ${before} -> ${await pager()}`, before===(await pager())?'✓ sprang back':'✗ turned the page');

// quick flick of the same distance SHOULD turn the page
const before2 = await pager();
// Well short of the distance threshold, but fast: CDP delivers moves with
// tens of ms of jitter, so the displacement has to be big enough that even
// the slowest delivery is still a flick.
await touch('touchStart',[[300,cy]]);
await move(280);
await move(245);
await touch('touchEnd',[]);
await p.waitForTimeout(450);
console.log(`quick flick: ${before2} -> ${await pager()}`, before2!==(await pager())?'✓ flick turned it':'✗ flick ignored');

// dawdle, then flick: the tail of the gesture is what decides
{
  const b3 = await pager();
  await touch('touchStart',[[300,cy]]);
  for (const x of [297,294,292,290,288]) { await move(x); await p.waitForTimeout(70); }
  await move(268);
  await move(240);
  await touch('touchEnd',[]);
  await p.waitForTimeout(450);
  console.log(`slow drag then flick: ${b3} -> ${await pager()}`, b3!==(await pager())?'✓ the flick counted':'✗ averaged away');
}

// rubber band at the first page
for (let i=0;i<8;i++){
  if ((await pager())===1) break;
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(360);
}
console.log('back to start:', await pager());
await touch('touchStart',[[100,cy]]);
await move(220);
const band = await trackX();
console.log(`dragged 120px past the first page -> track at ${band}`, band>0 && band<70 ? '✓ resists' : '✗ no resistance');
await touch('touchEnd',[]);
await p.waitForTimeout(400);
console.log('  settled back to', await trackX(), 'on page', await pager());

// buttons animate too
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(60);
const during = await trackX();
await p.waitForTimeout(400);
console.log('next button mid-animation track offset:', during, during!==0?'✓ animates':'✗ jumps');
console.log('after button:', await pager(), 'track', await trackX());

console.log(errs.length?'✗ ERRORS:\n'+errs.join('\n'):'✓ no page errors');
await b.close(); srv.close();
