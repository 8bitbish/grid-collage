import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8167,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const COLOURS=[[220,40,40],[40,200,90],[50,90,230],[240,190,40],[200,60,210],[40,210,210],[250,120,20],[120,60,200]];
const files=COLOURS.map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(400,500,c)}));
const j=o=>JSON.stringify(o);

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8167/');
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===8);
await p.waitForTimeout(600);

const cdp=await ctx.newCDPSession(p);
const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y])=>({x,y}))});
const order=()=>p.evaluate(()=>[...document.querySelectorAll('.film canvas')].map(c=>{
  const d=c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data; return `${d[0]},${d[1]},${d[2]}`;}));
const geom=()=>p.evaluate(()=>{
  const s=document.getElementById('filmstrip').getBoundingClientRect();
  const lib=document.getElementById('btn-photos').getBoundingClientRect();
  const end=document.querySelector('.pagesbar-end').getBoundingClientRect();
  return { stripLeft:Math.round(s.left), stripRight:Math.round(s.right), stripWidth:Math.round(s.width),
           libWidth:Math.round(lib.width), endWidth:Math.round(end.width) };});

console.log('== at rest ==');
const rest = await geom();
console.log(' ', j(rest));
await p.evaluate(()=>{ window.__restFirst = Math.round(document.querySelector('.film').getBoundingClientRect().left); });

console.log('\n== while a page is held ==');
const fb=await p.locator('.film').nth(1).boundingBox();
const fy=Math.round(fb.y+fb.height/2);
let fx=Math.round(fb.x+fb.width/2);
await touch('touchStart',[[fx,fy]]);
await p.waitForTimeout(260);                       // past the hold
console.log('  page lifted:', await p.evaluate(()=>!!document.querySelector('.film.is-lifted')) ? '✓' : '✗');
// No settle wait: the ends go in one frame, so everything below must already
// be true. Sampling the pages repeatedly over the next 300ms catches any
// drift an animation would have introduced.
const drift = [];
for (let i=0;i<10;i++) {
  drift.push(await p.evaluate(()=>Math.round(document.querySelector('.film').getBoundingClientRect().left)));
  await p.waitForTimeout(30);
}
// Against where the page actually sat before the drag, not a number written
// down when the bar had one fewer button on it.
const restFirst = await p.evaluate(()=>window.__restFirst);
console.log('  first page over 300ms:', j([...new Set(drift)]), `(at rest ${restFirst})`,
            new Set(drift).size===1 && Math.abs(drift[0]-restFirst)<=2 ? '✓ never moved' : '✗ drifted');
const held = await geom();
console.log(' ', j(held));
console.log('  ends folded away:', held.libWidth===0 && held.endWidth===0 ? '✓' : '✗');
console.log('  strip gained:', held.stripWidth - rest.stripWidth, 'px',
            held.stripWidth > rest.stripWidth ? '✓' : '✗');
await p.locator('.pagesbar').screenshot({path:`${OUT}/drag-room.png`});

// the page must still be under the finger after the fold moved the strip
const underFinger = await p.evaluate((fx)=>{
  const el=document.querySelector('.film.is-lifted').getBoundingClientRect();
  return { left:Math.round(el.left), right:Math.round(el.right), holds: fx>=el.left-2 && fx<=el.right+2 };
}, fx);
console.log('  still under the finger after the fold:', j(underFinger));
// And the pages either side must not have travelled: a page moving while the
// finger is still would change the slot being aimed at.
console.log('  the other pages held their place:', j(await p.evaluate(()=>{
  const r=[...document.querySelectorAll('.film')].map(f=>Math.round(f.getBoundingClientRect().left));
  return { firstPage:r[0], expected: window.__restFirst, still: Math.abs(r[0]-window.__restFirst)<=2 };})));

console.log('\n== resting against the right edge scrolls the strip ==');
const scroll0 = await p.evaluate(()=>Math.round(document.getElementById('filmstrip').scrollLeft));
fx = 384;                                          // hard against the right end
await touch('touchMove',[[fx,fy]]);
await p.waitForTimeout(700);                       // finger perfectly still
const scroll1 = await p.evaluate(()=>Math.round(document.getElementById('filmstrip').scrollLeft));
console.log('  held still for 700ms:', scroll0, '->', scroll1, scroll1>scroll0 ? `✓ (+${scroll1-scroll0}px)` : '✗ did not move');
const held2 = await p.evaluate((fx)=>{
  const el=document.querySelector('.film.is-lifted').getBoundingClientRect();
  return { holds: fx>=el.left-30 && fx<=el.right+30, left:Math.round(el.left) };}, fx);
console.log('  page still tracks the finger while it scrolls:', j(held2));

console.log('\n== and back the other way ==');
fx = 8;
await touch('touchMove',[[fx,fy]]);
await p.waitForTimeout(700);
const scroll2 = await p.evaluate(()=>Math.round(document.getElementById('filmstrip').scrollLeft));
console.log('  held at the left edge:', scroll1, '->', scroll2, scroll2<scroll1 ? `✓ (${scroll2-scroll1}px)` : '✗');
console.log('  stops at the start rather than running past:', scroll2 >= 0 ? `✓ (${scroll2})` : '✗');

console.log('\n== scrolled to the very end, then picked up ==');
{
  await touch('touchEnd',[]);
  await p.waitForTimeout(600);
  await p.evaluate(()=>{document.getElementById('filmstrip').scrollLeft=99999;});
  await p.waitForTimeout(250);
  const was = await p.evaluate(()=>({
    scroll: Math.round(document.getElementById('filmstrip').scrollLeft),
    pages: [...document.querySelectorAll('.film')].map(f=>Math.round(f.getBoundingClientRect().left))}));
  const lastBox = await p.locator('.film').last().boundingBox();
  const ly = Math.round(lastBox.y+lastBox.height/2);
  await touch('touchStart',[[Math.round(lastBox.x+lastBox.width/2), ly]]);
  await p.waitForTimeout(300);
  const now = await p.evaluate(()=>({
    scroll: Math.round(document.getElementById('filmstrip').scrollLeft),
    lifted: [...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-lifted')),
    pages: [...document.querySelectorAll('.film')].map(f=>Math.round(f.getBoundingClientRect().left))}));
  console.log('  scroll held:', was.scroll, '->', now.scroll, was.scroll===now.scroll ? '✓' : `✗ clamped by ${was.scroll-now.scroll}`);
  const shifted = was.pages.map((v,i)=>now.pages[i]-v).filter((_,i)=>i!==now.lifted);
  console.log('  pages left behind:', j([...new Set(shifted)]),
              new Set(shifted).size===1 && shifted[0]===0 ? '✓ no jolt' : '✗ jolted');

  // and the strip must not grow while held against the end
  const runaway = [];
  await touch('touchMove',[[384, ly]]);
  for (let i=0;i<5;i++) {
    await p.waitForTimeout(300);
    runaway.push(await p.evaluate(()=>Math.round(document.getElementById('filmstrip').scrollLeft)));
  }
  console.log('  held at the end for 1.5s:', j(runaway),
              new Set(runaway).size===1 ? '✓ stops at the end' : '✗ keeps scrolling');
  await touch('touchEnd',[]);
  await p.waitForTimeout(600);
  await p.evaluate(()=>{document.getElementById('filmstrip').scrollLeft=0;});
  await p.waitForTimeout(300);
}

console.log('\n== dropping it ==');
await touch('touchStart',[[Math.round(fb.x+fb.width/2), fy]]);
await p.waitForTimeout(300);
const before = await order();
// carry it to the far end and let go
fx = 384;
await touch('touchMove',[[fx,fy]]);
await p.waitForTimeout(900);
await touch('touchEnd',[]);
await p.waitForTimeout(600);
const after = await order();
console.log('  moved:', before[1], '->', after.indexOf(before[1]) !== 1 ? `now at ${after.indexOf(before[1])} ✓` : 'unmoved ✗');
console.log('  same pages, reordered:', before.slice().sort().join()===after.slice().sort().join() ? '✓' : '✗');
const backAgain = await geom();
console.log('  ends came back:', j(backAgain));
console.log('  bar as it was:', j(backAgain)===j(rest) ? '✓' : `✗ was ${j(rest)}`);
console.log('  no page left lifted:', await p.evaluate(()=>!document.querySelector('.film.is-lifted')) ? '✓' : '✗');
console.log('  no transforms left behind:', await p.evaluate(()=>
  [...document.querySelectorAll('.film')].every(f=>!f.style.transform)) ? '✓' : '✗');

console.log('\n== a plain tap is still a tap ==');
const t0=await p.locator('.film').nth(3).boundingBox();
await p.touchscreen.tap(t0.x+t0.width/2, t0.y+t0.height/2);
await p.waitForTimeout(500);
console.log('  current page:', await p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1));
console.log('  ends still there:', j(await geom())===j(rest) ? '✓' : '✗');

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
