import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
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
await p.goto(`http://localhost:${PORT}/`);
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
await p.click('#tile-actions [data-tile="replace"]');
await p.waitForTimeout(300);

console.log('while choosing :', JSON.stringify(await dims()));
// The pages bar stays: which page the photo is being chosen for still
// matters, and the reel is short enough to leave it room.
console.log('  pages bar stays:', (await dims()).pagesBar!=='none' ? '✓' : '✗');
// Add from your photos is the reel's first stop, then a stop per photo.
console.log('  options offered:', await p.locator('#choose-strip .choose-item').count(),
  (await p.locator('#choose-strip .choose-item').count())===5 ? '✓ Add and four photos' : '✗');
console.log('  current one marked:', await p.locator('#choose-strip .choose-item.is-current').count()===1 ? '✓' : '✗');
console.log('  the tile\'s own actions step aside:', await p.locator('#tile-actions').isHidden() ? '✓' : '✗');

// the reel opens centred on what the tile already holds
const current = () => p.evaluate(()=>[...document.getElementById('choose-strip').children].findIndex(i=>i.classList.contains('is-current')));
console.log('  opens centred on the current photo:', (await current()) === 1 ? '✓' : '✗');
const centredIsMiddle = await p.evaluate(()=>{
  const reel=document.getElementById('choose-reel');
  const el=document.querySelector('#choose-strip .choose-item.is-current');
  const sm=reel.getBoundingClientRect().left+reel.clientWidth/2;
  const em=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2;
  return Math.abs(sm-em) < 4;
});
console.log('  and it sits under the centre:', centredIsMiddle ? '✓' : '✗');
console.log('  drawn larger and ringed:', await p.evaluate(()=>{
  const el=document.querySelector('#choose-strip .choose-item.is-current');
  return Math.round(el.getBoundingClientRect().width)===68 && getComputedStyle(el,'::after').borderTopStyle==='solid';}) ? '✓' : '✗');

// scroll the reel — the centre one changes and the preview follows. As a
// finger scrolls it: the reel only takes what passes under the centre as a
// choice when something is scrolling it, and a wheel is something.
const centreOn = (i) => p.evaluate((k)=>{
  const reel=document.getElementById('choose-reel');
  const el=document.getElementById('choose-strip').children[k];
  reel.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
  reel.scrollLeft = el.offsetLeft - (reel.clientWidth - el.offsetWidth)/2;
}, i);
await p.evaluate(()=>{window.__buzz=[];
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:(x)=>{window.__buzz.push(x);return true;}});});
// A tile that is not on the current slide or one either side is drawn from
// its proxy rather than the original, so a flat colour can come back a unit
// or two out — JPEG, not a wrong picture. Sampling has to allow for that.
// That the original does come back is asserted where it matters, on the
// slide you are actually looking at, after the dwell.
const near=(a,b,slack=3)=>{const x=String(a).split(',').map(Number), y=String(b).split(',').map(Number);
  return x.length===3&&y.length===3&&x.every((v,i)=>Math.abs(v-y[i])<=slack);};
const seen=[];
for (const n of [2,3,4]) {
  await centreOn(n);
  // Until the reel has taken this photo as the centred one, rather than a
  // fixed wait: waiting on the reel's own marker removes the timing from the
  // question, and a scroll the app really does not register still fails on
  // the assertions below.
  await p.waitForFunction((i)=>document.getElementById('choose-strip').children[i]?.classList.contains('is-current'),
    n, {timeout:5000}).catch(()=>{});
  seen.push(await shot());
}
console.log('  preview after scrolling to 2,3,4:', seen.join(' -> '));
console.log('  the middle one is what applies:',
  near(seen[0],'40,190,90') && near(seen[1],'50,90,230') && near(seen[2],'240,190,40') ? '✓' : '✗');
console.log('  marker follows:', (await current()) === 4 ? '✓' : '✗');
const ticks = await p.evaluate(()=>window.__buzz.length);
console.log('  a tick per photo scrolled:', ticks, ticks === 3 ? '✓' : '✗');

// Passing over Add chooses nothing and opens nothing: a picker comes up
// because someone asked for it.
const before = await shot();
await centreOn(0);
await p.waitForTimeout(500);
console.log('  scrolling onto Add leaves the tile as it was:', near(await shot(), before) ? '✓' : '✗');

// tapping one brings it to the middle, and into the tile
await p.locator('#choose-strip .choose-item').nth(1).click();
await p.waitForTimeout(450);
console.log('  tapping an option chooses it:', await shot(), (await shot())==='230,40,40' ? '✓' : '✗');
await p.screenshot({path:'/tmp/shot-chooser.png'});

// back restores the layout
await p.click('#dock-back');
await p.waitForTimeout(300);
const back = await dims();
console.log('after back     :', JSON.stringify(back));
console.log('  pages bar still there:', back.pagesBar!=='none' ? '✓' : '✗',
            '| tile actions again:', await p.locator('#tile-actions').isVisible() ? '✓' : '✗');

// undo walks back through the choices
await p.click('#btn-undo'); await p.waitForTimeout(250);
console.log('undo once ->', await shot());

// deselecting entirely clears the choosing state
// (undo drops the selection, so pick the tile up again first)
await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(250);
await p.click('#tile-actions [data-tile="replace"]');
await p.waitForTimeout(250);
await p.keyboard.press('Escape');
await p.waitForTimeout(250);
const cleared = await dims();
// Fully reset is the dock no taller than it stands with the tile's own tools
// in it, measured on the way back out of the chooser above.
console.log('escape from the chooser:', JSON.stringify(cleared),
  cleared.pagesBar!=='none' && cleared.dock<=back.dock ? '✓ fully reset' : '✗ stuck');

// A scroll made while the reel is opening is kept, not undone. The reel used
// to put itself on its start a frame after it opened, so anything that moved
// it before that frame — a flick on a phone busy opening a long reel, where
// scrolling carries on while the page cannot draw — was put straight back.
await p.keyboard.press('Escape');
await p.waitForTimeout(250);
await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(250);
const kept = await p.evaluate(()=>new Promise((done)=>{
  document.querySelector('#tile-actions [data-tile="replace"]').click();
  const reel=document.getElementById('choose-reel'); const el=document.getElementById('choose-strip').children[3];
  reel.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
  reel.scrollLeft = el.offsetLeft - (reel.clientWidth - el.offsetWidth)/2;
  setTimeout(()=>done([...document.getElementById('choose-strip').children].findIndex((c)=>c.classList.contains('is-current'))), 600);
}));
console.log('  a scroll made as the reel opens is kept:', kept, kept===3 ? '✓' : '✗ undone');
await p.keyboard.press('Escape');

console.log(errs.length?'✗ ERRORS: '+errs.join(' | '):'✓ no page errors');
await b.close(); srv.close();
