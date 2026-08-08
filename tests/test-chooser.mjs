import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8149,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const COLS=[[230,40,40],[40,190,90],[50,90,230],[240,190,40]];
const files=COLS.map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(600,600,c)}));

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:420,height:860},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:8149/');
await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);

const shot=()=>p.evaluate(()=>{const c=document.getElementById('canvas');const g=c.getContext('2d');
  const d=g.getImageData(c.width>>1,c.height>>1,1,1).data;return `${d[0]},${d[1]},${d[2]}`;});
const dims=()=>p.evaluate(()=>({
  pagesBar: getComputedStyle(document.querySelector('.pagesbar')).display,
  dock: Math.round(document.getElementById('dock').getBoundingClientRect().height),
  canvas: Math.round(document.getElementById('canvas').getBoundingClientRect().width),
}));

console.log('page 1 shows:', await shot());
console.log('before choosing:', JSON.stringify(await dims()));

// select the tile, then Replace
const box=await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(200);
await p.click('.dock-item[data-tile="replace"]');
await p.waitForTimeout(300);

console.log('while choosing :', JSON.stringify(await dims()));
console.log('  pages bar hidden:', (await dims()).pagesBar==='none' ? '✓' : '✗');
console.log('  options offered:', await p.locator('.choose-item').count());
console.log('  current one marked:', await p.locator('.choose-item.is-current').count()===1 ? '✓' : '✗');

// the reel opens centred on what the tile already holds
console.log('  opens centred on the current photo:', await p.evaluate(()=>{
  const items=[...document.querySelectorAll('.choose-item')];
  return items.findIndex(i=>i.classList.contains('is-current'));}) === 0 ? '✓' : '✗');
const centredIsMiddle = await p.evaluate(()=>{
  const strip=document.getElementById('choose-strip');
  const el=strip.querySelector('.choose-item.is-current');
  const sm=strip.getBoundingClientRect().left+strip.clientWidth/2;
  const em=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2;
  return Math.abs(sm-em) < 4;
});
console.log('  and it sits under the marker:', centredIsMiddle ? '✓' : '✗');

// scroll the reel — the centre one changes and the preview follows
await p.evaluate(()=>{window.__buzz=[]; const o=navigator.vibrate;
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:(x)=>{window.__buzz.push(x);return true;}});});
// A tile that is not on the current slide or one either side is drawn from
// its proxy rather than the original, so a flat colour can come back a unit
// or two out — JPEG, not a wrong picture. Sampling has to allow for that.
// That the original does come back is asserted where it matters, on the
// slide you are actually looking at, after the dwell.
const near=(a,b,slack=3)=>{const x=String(a).split(',').map(Number), y=String(b).split(',').map(Number);
  return x.length===3&&y.length===3&&x.every((v,i)=>Math.abs(v-y[i])<=slack);};
const seen=[];
for (const n of [1,2,3]) {
  await p.evaluate((i)=>{
    const strip=document.getElementById('choose-strip');
    const el=strip.children[i];
    strip.scrollLeft = el.offsetLeft - (strip.clientWidth - el.offsetWidth)/2;
  }, n);
  await p.waitForTimeout(200);
  seen.push(await shot());
}
console.log('  preview after scrolling to 2,3,4:', seen.join(' -> '));
console.log('  the middle one is what applies:',
  near(seen[0],'40,190,90') && near(seen[1],'50,90,230') && near(seen[2],'240,190,40') ? '✓' : '✗');
console.log('  marker follows:', await p.evaluate(()=>{
  const items=[...document.querySelectorAll('.choose-item')];
  return items.findIndex(i=>i.classList.contains('is-current'));}) === 3 ? '✓' : '✗');
console.log('  a tick per photo scrolled:', await p.evaluate(()=>window.__buzz.length),
  (await p.evaluate(()=>window.__buzz.length)) === 3 ? '✓' : '✗');

// tapping one brings it to the middle
await p.locator('.choose-item').nth(0).click();
await p.waitForTimeout(450);
console.log('  tapping an option centres it:', await shot(), (await shot())==='230,40,40' ? '✓' : '✗');
await p.screenshot({path:'/tmp/shot-chooser.png'});

// back restores the layout
await p.click('#choose-back');
await p.waitForTimeout(300);
const back = await dims();
console.log('after back     :', JSON.stringify(back));
console.log('  pages bar returns:', back.pagesBar!=='none' ? '✓' : '✗',
            '| tile actions again:', await p.locator('#tile-actions').isVisible() ? '✓' : '✗');

// undo walks back through the choices
await p.click('#btn-undo'); await p.waitForTimeout(250);
console.log('undo once ->', await shot());

// deselecting entirely clears the choosing state
// (undo drops the selection, so pick the tile up again first)
await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(250);
await p.click('.dock-item[data-tile="replace"]');
await p.waitForTimeout(250);
await p.keyboard.press('Escape');
await p.waitForTimeout(250);
const cleared = await dims();
console.log('escape from the chooser:', JSON.stringify(cleared),
  cleared.pagesBar!=='none' && cleared.dock<100 ? '✓ fully reset' : '✗ stuck');

console.log(errs.length?'✗ ERRORS: '+errs.join(' | '):'✓ no page errors');
await b.close(); srv.close();
