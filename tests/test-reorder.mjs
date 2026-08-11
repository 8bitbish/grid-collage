import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8145,r));
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
const ctx=await b.newContext({viewport:{width:1200,height:900},hasTouch:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:8145/');
await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===5);

const order=()=>p.evaluate(()=>[...document.querySelectorAll('.film canvas')].map(c=>{
  const d=c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data; return d[0]+','+d[1]+','+d[2];}));
const shifts=()=>p.evaluate(()=>[...document.querySelectorAll('.film')].map(el=>{
  const t=getComputedStyle(el).transform;
  return t==='none'?0:Math.round(parseFloat(t.split(',')[4]));}));

console.log('order before:', (await order()).join(' | '));

const a=await p.locator('.film').nth(0).boundingBox();
const c2=await p.locator('.film').nth(1).boundingBox();
const step=Math.round(c2.x-a.x);
console.log('one slot =', step + 'px');

// pick up page 1 with the mouse and drag it two slots right
await p.mouse.move(a.x+a.width/2, a.y+a.height/2);
await p.mouse.down();
await p.mouse.move(a.x+a.width/2+20, a.y+a.height/2, {steps:3});
console.log('lifted:', await p.evaluate(()=>!!document.querySelector('.film.is-lifted')));
await p.mouse.move(a.x+a.width/2+step*2, a.y+a.height/2, {steps:8});
await p.waitForTimeout(60);
const mid = await shifts();
await p.waitForTimeout(320);
const s = await shifts();

console.log('offsets mid-animation :', mid.join(', '));
console.log('offsets once settled  :', s.join(', '));
console.log('  dragged page follows the cursor:', Math.abs(s[0]-step*2) < 14 ? '✓' : `✗ (${s[0]})`);
console.log('  pages 2 and 3 stepped aside a full slot:',
  (Math.abs(s[1]+step)<2 && Math.abs(s[2]+step)<2) ? '✓' : `✗ (${s[1]}, ${s[2]})`);
console.log('  they glided rather than jumped:',
  (mid[2] < 0 && mid[2] > -step) ? `✓ (caught at ${mid[2]} of ${-step})` : `✗ (${mid[2]})`);
console.log('  pages 4 and 5 untouched:', (s[3]===0 && s[4]===0) ? '✓' : `✗ (${s[3]}, ${s[4]})`);
console.log('  the shift is animated:', await p.evaluate(()=>{
  const t=getComputedStyle(document.querySelectorAll('.film')[1]).transitionDuration;
  return t && t!=='0s' ? 'yes ('+t+')' : 'NO';}));
await p.screenshot({path:'/tmp/shot-reorder.png'});

await p.mouse.up();
await p.waitForTimeout(400);
console.log('order after dropping:', (await order()).join(' | '));
console.log('  transforms cleared:', (await shifts()).every(v=>v===0) ? '✓' : '✗');

// undo should put it back
await p.click('#btn-undo');
await p.waitForTimeout(200);
console.log('after undo:', (await order()).join(' | '));

// a plain tap still navigates
await p.locator('.film').nth(3).click();
await p.waitForTimeout(400);
console.log('tap page 4 -> current is',
  await p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1));


// --- touch: long-press to pick up, a quick swipe should scroll not reorder --
const tctx = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const t = await tctx.newPage();
// The touch half needs walking through the projects list as much as the first
// half does. Without this it stayed on the homepage, where a .film has no box
// at all, and the test died on a null bounding box before its first touch.
await autoEnter(t);
t.on('pageerror',e=>errs.push('touch: '+String(e)));
await t.goto('http://localhost:8145/');
await t.evaluate(()=>localStorage.clear()); await t.reload();
await t.setInputFiles('#file-input', files);
await t.waitForFunction(()=>document.querySelectorAll('.film').length===5);
const tOrder=()=>t.evaluate(()=>[...document.querySelectorAll('.film canvas')].map(c=>{
  const d=c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data; return d[0]+','+d[1]+','+d[2];}));
const cdp=await tctx.newCDPSession(t);
const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
const fb=await t.locator('.film').nth(0).boundingBox();
const fy=fb.y+fb.height/2;
const tstep=(await t.locator('.film').nth(1).boundingBox()).x - fb.x;

// quick flick across the strip: must NOT pick anything up
await touch('touchStart',[[fb.x+fb.width/2, fy]]);
await touch('touchMove',[[fb.x+fb.width/2+40, fy]]);
await touch('touchEnd',[]);
console.log('quick swipe on the strip lifted nothing:',
  await t.evaluate(()=>!document.querySelector('.film.is-lifted')) ? '✓' : '✗');

// hold, then drag: should reorder
await touch('touchStart',[[fb.x+fb.width/2, fy]]);
await t.waitForTimeout(260);
console.log('after holding still, page is lifted:', await t.evaluate(()=>!!document.querySelector('.film.is-lifted')) ? '✓' : '✗');
await touch('touchMove',[[fb.x+fb.width/2+tstep*2, fy]]);
await t.waitForTimeout(120);
await touch('touchEnd',[]);
await t.waitForTimeout(400);
console.log('touch reorder result:', (await tOrder()).join(' | '));

// the long-press guards
const guards = await t.evaluate(() => {
  const film = document.querySelector('.film');
  const cs = getComputedStyle(film);
  return {
    userSelect: cs.userSelect || cs.webkitUserSelect,
    callout: cs.webkitTouchCallout || '(unsupported in this engine)',
    touchAction: cs.touchAction,
    selectionEmpty: (window.getSelection() || {}).toString() === '',
  };
});
console.log('long-press guards:', JSON.stringify(guards));

// a context menu on a page must not fire (it would cancel the pointer stream)
// preventDefault stops the menu but the event still propagates, so the thing
// to check is whether the default was cancelled — not whether it fired.
const ctxStopped = await t.evaluate(() => {
  const ev = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
  document.querySelector('.film').dispatchEvent(ev);
  return ev.defaultPrevented;
});
console.log('context menu suppressed on a page:', ctxStopped ? '✓' : '✗ menu would open');

// scroll must be blocked while a page is held
await touch('touchStart',[[fb.x+fb.width/2, fy]]);
await t.waitForTimeout(260);
const blocked = await t.evaluate(() => {
  const ev = new TouchEvent('touchmove', { cancelable: true, bubbles: true });
  document.dispatchEvent(ev);
  return ev.defaultPrevented;
});
console.log('page scrolling blocked while holding:', blocked ? '✓' : '✗');
await touch('touchEnd',[]);
await t.waitForTimeout(300);
const after = await t.evaluate(() => {
  const ev = new TouchEvent('touchmove', { cancelable: true, bubbles: true });
  document.dispatchEvent(ev);
  return ev.defaultPrevented;
});
console.log('and released again afterwards:', after ? '✗ still blocked' : '✓');

console.log(errs.length?'✗ ERRORS: '+errs.join(' | '):'✓ no page errors');
await b.close(); srv.close();
