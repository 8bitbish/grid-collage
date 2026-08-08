import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8148,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const files=[[220,60,90],[60,170,120],[70,110,220]].map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(600,600,c)}));

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:420,height:860},hasTouch:true,isMobile:true,deviceScaleFactor:2});
// record every buzz the app asks for
await ctx.addInitScript(() => {
  window.__buzz = [];
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (p) => { window.__buzz.push(JSON.stringify(p)); return true; },
  });
});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:8148/');
await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===3);

const drain=async()=>{const v=await p.evaluate(()=>{const b=window.__buzz.slice(); window.__buzz.length=0; return b;}); return v;};
await drain();

console.log('API present to the app:', await p.evaluate(()=>typeof navigator.vibrate));

// page turn
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(350);
console.log('turning a page      ->', (await drain()).join(', ') || '(nothing)');

// picking a page up and dropping it somewhere new
const cdp=await ctx.newCDPSession(p);
const touch=(t,pts)=>cdp.send('Input.dispatchTouchEvent',{type:t,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
const f0=await p.locator('.film').nth(0).boundingBox();
const f1=await p.locator('.film').nth(1).boundingBox();
const step=f1.x-f0.x;
await touch('touchStart',[[f0.x+f0.width/2, f0.y+f0.height/2]]);
await p.waitForTimeout(260);
console.log('picking a page up   ->', (await drain()).join(', ') || '(nothing)');
await touch('touchMove',[[f0.x+f0.width/2+step*2, f0.y+f0.height/2]]);
await p.waitForTimeout(120);
await touch('touchEnd',[]);
await p.waitForTimeout(400);
console.log('dropping it         ->', (await drain()).join(', ') || '(nothing)');

// hitting the page limit
await p.evaluate(async () => {
  for (let i = 0; i < 25; i++) {
    const add = document.querySelector('.film-add');
    if (!add || add.disabled) break;
    add.click();
    await new Promise(r => setTimeout(r, 5));
  }
});
await p.waitForTimeout(200);
await drain();
await p.evaluate(()=>{const a=document.querySelector('.film-add'); if(a) a.disabled=false; a && a.click();});
await p.waitForTimeout(150);
console.log('past the 20 limit   ->', (await drain()).join(', ') || '(nothing)');

// an angle clicking square under two fingers, and only once
await p.evaluate(()=>{ for (let i=0;i<30;i++){ const a=document.querySelector('.film-add'); if(!a||a.disabled) break; } });
await p.click('.film');
await p.waitForTimeout(300);
const cbox = await p.locator('#canvas').boundingBox();
const cx = cbox.x+cbox.width/2, cy = cbox.y+cbox.height/2;
await p.mouse.click(cx, cy);           // select the tile
await p.waitForTimeout(250);
await drain();
await touch('touchStart',[[cx-70,cy],[cx+70,cy]]);
let buzzes = 0;
for (let s2=1; s2<=32; s2++) {
  const a=(s2*2.9*Math.PI)/180;
  await touch('touchMove',[[cx-70*Math.cos(a), cy-70*Math.sin(a)],[cx+70*Math.cos(a), cy+70*Math.sin(a)]]);
}
const snapBuzz = await drain();
await touch('touchEnd',[]);
await p.waitForTimeout(200);
console.log('angle clicking square ->', snapBuzz.join(', ') || '(nothing)',
  snapBuzz.length === 1 ? '✓ once, not per frame' : `(${snapBuzz.length} times)`);
console.log(errs.length?'✗ ERRORS: '+errs.join(' | '):'✓ no page errors');
await b.close(); srv.close();
