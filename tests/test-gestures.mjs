/* A dial is one gesture, and a gesture is one undo step.
 *
 * Turning the Grid dial used to change nothing on the page until it had come
 * to rest, and the value dials did the opposite: every tick was saved and
 * pushed its own undo step, run together only if it came within 700ms of the
 * last. Both now follow one rule. While the finger is down the page shows
 * what is under the needle, and nothing is written, to history or to
 * storage. When the finger lifts and the dial has stopped, the gesture
 * becomes a single step holding the page as it was at touchstart, or no step
 * at all if it ended where it began.
 *
 * Driven with real touches through CDP, on a 2x2 page of four photos, after a
 * reload so that the undo history starts empty and the step counts can be
 * read straight off the undo button.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;

function png(w,h,[r0,g0,b0]){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=r0;raw[o+2+x*3]=g0;raw[o+3+x*3]=b0;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const colours=[[220,60,90],[60,170,120],[70,110,220],[240,180,60]];
const file=(i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(800,800,colours[i])});

let pass=0, fail=0;
const ok=(what,good,detail='')=>{ if(good){pass++;console.log(`  ✓ ${what}${detail?` — ${detail}`:''}`);} else {fail++;console.log(`  ✗ ${what}${detail?` — ${detail}`:''}`);} };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
// Every write to storage, counted, so "nothing is saved while the finger is
// down" is a number rather than a hope.
await p.addInitScript(()=>{
  window.__writes=0;
  const set=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){ if(/deck/i.test(k)) window.__writes++; return set.call(this,k,v); };
});
await p.goto(`http://localhost:${PORT}/`);
await p.evaluate(()=>localStorage.clear()); await p.reload();

// One photo, a 2x2 page, and three more to fill it.
await p.setInputFiles('#file-input',[file(0)]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1');
await p.waitForTimeout(400);
await p.click('.dock-root [data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x2"]');
await p.waitForTimeout(500);
await p.click('#dock-back');
await p.setInputFiles('#file-input',[1,2,3].map(file));
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='4');
await p.waitForTimeout(800);
// A reload empties the undo history; the deck comes back from storage.
await p.reload();
await p.waitForFunction(()=>!document.body.classList.contains('on-home') && document.getElementById('photos-count').textContent==='4',{timeout:15000});
await p.waitForTimeout(1200);

const undoable=()=>p.evaluate(()=>!document.getElementById('btn-undo').disabled);
const writes=()=>p.evaluate(()=>window.__writes);
const layoutNow=()=>p.evaluate(()=>document.querySelector('#layouts .is-active')?.dataset.id);
// A fingerprint of the preview, to tell whether the page on screen changed.
const pixels=()=>p.evaluate(()=>{ const c=document.getElementById('canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let h=0; for(let i=0;i<d.length;i+=5) h=(h*31+d[i])|0; return `${c.width}x${c.height}:${h}`; });
const cdp=await ctx.newCDPSession(p);
const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:Math.round(x),y:Math.round(y)}]});
const frame=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));

console.log('\n== the Grid dial ==');
ok('the history starts empty', !(await undoable()));
await p.click('.dock-root [data-drawer="layout"]');
await p.waitForTimeout(600);
const start = await layoutNow();
const startPixels = await pixels();
const reel = await p.locator('#layout-reel').boundingBox();
const ry = reel.y + reel.height/2;
const w0 = await writes();
const seen = new Set([startPixels]);
await touch('touchStart', 330, ry);
// Across four layouts, 54px each, a frame at a time, and then held still.
for (let x=330; x>=114; x-=6) { await touch('touchMove', x, ry); await frame(); seen.add(await pixels()); }
await p.waitForTimeout(500);
ok('the page showed each layout as it passed', seen.size >= 4, `${seen.size - 1} different pages drawn on the way`);
ok('nothing was recorded while the finger was down', !(await undoable()), 'undo still off after 500ms held still');
ok('and nothing was saved', (await writes()) === w0, `${(await writes()) - w0} writes`);
ok('the layout was not chosen yet', (await layoutNow()) === start, `still ${await layoutNow()}`);
await touch('touchEnd');
await p.waitForTimeout(900);
const ended = await layoutNow();
const endedPixels = await pixels();
ok('letting go chose the layout under the needle', ended && ended !== start, `${start} → ${ended}`);
ok('the settled page is the one that was previewed', endedPixels === [...seen].pop(), endedPixels === [...seen].pop() ? 'same pixels' : 'the page changed again on settling');
ok('and it was saved once it settled', (await writes()) > w0);
ok('there is now something to undo', await undoable());
await p.click('#btn-undo');
await p.waitForTimeout(400);
ok('one undo goes back over the whole drag', (await layoutNow()) === start, `back to ${await layoutNow()}`);
ok('and that was the only step', !(await undoable()));
ok('the page is as it was', (await pixels()) === startPixels);

// The same layout chosen directly must be the same picture.
await p.click(`.layout-btn[data-id="${ended}"]`);
await p.waitForTimeout(700);
ok('choosing it directly draws the identical page', (await pixels()) === endedPixels);
await p.click('#btn-undo');
await p.waitForTimeout(400);

console.log('\n== a drag that ends where it began ==');
const w1 = await writes();
await touch('touchStart', 300, ry);
for (let x=300; x>=190; x-=6) { await touch('touchMove', x, ry); await frame(); }
for (let x=190; x<=300; x+=6) { await touch('touchMove', x, ry); await frame(); }
// Stopped, as a finger that has come back does, rather than flung.
await p.waitForTimeout(300);
await touch('touchEnd');
await p.waitForTimeout(900);
ok('it chose nothing', (await layoutNow()) === start, await layoutNow());
ok('recorded nothing', !(await undoable()));
ok('saved nothing', (await writes()) === w1, `${(await writes()) - w1} writes`);
ok('and the page is back as it was', (await pixels()) === startPixels);

console.log('\n== the Padding dial ==');
await p.click('.dock-tab[data-drawer="padding"]');
await p.waitForTimeout(500);
const pad0 = await p.inputValue('#padding');
const track = await p.locator('#dp-padding .dial-track').boundingBox();
const ty = track.y + track.height/2;
const w2 = await writes();
const drawn = new Set([await pixels()]);
await touch('touchStart', 320, ty);
// Right to left is larger. Forty 3px steps are forty units, twenty ticks.
for (let x=320; x>=200; x-=3) { await touch('touchMove', x, ty); await frame(); drawn.add(await pixels()); }
await p.waitForTimeout(300);
const padHeld = await p.inputValue('#padding');
ok('the page followed every tick', drawn.size > 10, `${drawn.size - 1} pages drawn, padding ${pad0} → ${padHeld}`);
ok('nothing was recorded while the finger was down', !(await undoable()));
ok('and nothing was saved', (await writes()) === w2, `${(await writes()) - w2} writes`);
await touch('touchEnd');
await p.waitForTimeout(500);
ok('letting go kept the value', (await p.inputValue('#padding')) === padHeld && padHeld !== pad0, padHeld);
ok('as one step', await undoable());
await p.click('#btn-undo');
await p.waitForTimeout(400);
ok('one undo goes back to where the drag began', (await p.inputValue('#padding')) === pad0, `${await p.inputValue('#padding')}`);
ok('and there was no other', !(await undoable()));

ok('no page errors', errs.length===0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
