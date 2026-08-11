import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8160,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const mk=(n,c)=>({name:n,mimeType:'image/png',buffer:png(500,500,c)});

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:420,height:860},hasTouch:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));

// stand in for the Vibration API and record every call
await p.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate = (v)=>{ window.__buzz.push(v); return true; }; });
await p.goto('http://localhost:8160/'); await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input',[mk('a.png',[220,60,90]),mk('b.png',[60,170,120]),mk('c.png',[70,110,220])]);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===3);
await p.waitForTimeout(400);

const buzzes=()=>p.evaluate(()=>{const b=window.__buzz;window.__buzz=[];return b;});
const tap=async(sel,n=0)=>{
  const loc=p.locator(sel).nth(n);
  await loc.scrollIntoViewIfNeeded();
  const bx=await loc.boundingBox();
  if(!bx) throw new Error(`no box for ${sel} #${n}`);
  await p.touchscreen.tap(bx.x+bx.width/2, bx.y+bx.height/2); await p.waitForTimeout(250);};

await buzzes();
await tap('.dock-item[data-drawer="layout"]');
console.log('open Layout        ->', JSON.stringify(await buzzes()));
await tap('.layout-btn[data-id="2x2"]');
console.log('pick a layout      ->', JSON.stringify(await buzzes()));
await tap('#dock-back');
console.log('back out           ->', JSON.stringify(await buzzes()));

await tap('.dock-item[data-drawer="background"]');
await buzzes();
await tap('.swatch', 1);
console.log('pick a colour      ->', JSON.stringify(await buzzes()));
await tap('#dock-back'); await buzzes();

// A slider used to stay silent. It has detents now: one buzz for taking hold
// of the knob, one per notch crossed, and the firmer double at either end.
// Twelve notches to a sweep is the number that matters — the step count is 60,
// and buzzing every step is a rattle rather than a control.
await tap('.dock-item[data-drawer="gap"]'); await buzzes();
const s=await p.locator('#gap').boundingBox();
await p.touchscreen.tap(s.x+10, s.y+s.height/2);
await p.waitForTimeout(200);
console.log('touch the track    ->', JSON.stringify(await buzzes()), '(one for the grab)');
{
  const cdp=await ctx.newCDPSession(p);
  const y=Math.round(s.y+s.height/2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.round(s.x+2),y}]});
  for (let x=Math.round(s.x+2); x<s.x+s.width-2; x+=6) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
    await p.waitForTimeout(12);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(250);
  const run=await buzzes();
  const ticks=run.filter(v=>v===4).length;
  const ends=run.filter(v=>Array.isArray(v)).length;
  console.log(`sweep end to end   -> ${run.length} buzzes: 1 grab, ${ticks} ticks, ${ends} at the limit`,
    ticks>=10&&ticks<=13?'✓ a dozen notches':`✗ ${ticks} notches, wanted about 12`);
}
await tap('#dock-back'); await buzzes();

// scrolling the settings row must stay silent
const row=await p.locator('#dock-root').boundingBox();
await p.evaluate(()=>{document.getElementById('dock-root').scrollLeft=0;});
await p.locator('#dock-root').evaluate(el=>el.scrollLeft=0);
{
  const cdp=await ctx.newCDPSession(p);
  const y=Math.round(row.y+row.height/2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y}]});
  for (const x of [280,250,215,180]) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
    await p.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(250);
  console.log('scroll the dock    ->', JSON.stringify(await buzzes()), '(expect none)');
}

// tile bar
const box=await p.locator('#canvas').boundingBox();
await p.touchscreen.tap(box.x+box.width*0.3, box.y+box.height*0.3);
await p.waitForTimeout(300); await buzzes();
await tap('.dock-item[data-tile="rotate"]');
console.log('a tile action      ->', JSON.stringify(await buzzes()));
await tap('#btn-rot90');
console.log('turn 90            ->', JSON.stringify(await buzzes()), '(one tick, not two)');
await tap('#dock-back'); await buzzes();

// the reel still ticks per photo, and not twice for a tap on an option
await tap('.dock-item[data-tile="replace"]');
await p.waitForTimeout(400); await buzzes();
const item=await p.locator('.choose-item').nth(2).boundingBox();
await p.touchscreen.tap(item.x+item.width/2, item.y+item.height/2);
await p.waitForTimeout(600);
const reel=await buzzes();
console.log('tap a reel option  ->', JSON.stringify(reel), '(ticks as it scrolls, no extra tap tick)');
await tap('#choose-back'); await buzzes();

// Deleting is the one thing in the dock a tap cannot take back, and it used to
// feel exactly like picking a colour. A pattern rather than a single number is
// what makes it unmistakable — a longer buzz reads as a slow tap.
{
  const dbl = (v)=>Array.isArray(v) && v.length===4 && v[1]===14;
  await tap('.dock-item[data-tile="delete"]');
  const tile=await buzzes();
  console.log('delete a tile      ->', JSON.stringify(tile), tile.some(dbl)?'✓ the double':'✗ wanted the double');
  if(!tile.some(dbl)) process.exitCode=1;

  // Back out to the settings list however deep the delete left us.
  for (let i=0; i<3 && !(await p.locator('#dock-root').isVisible()); i++) {
    await p.click('#dock-back'); await p.waitForTimeout(200);
  }
  await buzzes();
  await tap('.dock-item[data-drawer="page"]'); await buzzes();
  await tap('#btn-delete-page');
  const pg=await buzzes();
  console.log('delete a page      ->', JSON.stringify(pg), pg.some(dbl)?'✓ the double':'✗ wanted the double');
  if(!pg.some(dbl)) process.exitCode=1;
  await tap('#dock-back'); await buzzes();
}

// A select is answered in a picker of the system's own, so the tap never lands
// on anything the dock can hear. The buzz belongs to the answer coming back.
{
  await tap('.dock-item[data-drawer="export"]'); await buzzes();
  await p.selectOption('#format','image/png');
  await p.waitForTimeout(200);
  const sel=await buzzes();
  console.log('choose a format    ->', JSON.stringify(sel), sel.length===1?'✓ one tick':'✗ wanted one tick');
  if(sel.length!==1) process.exitCode=1;
  await tap('#dock-back'); await buzzes();
}

console.log('errors:', errs.length?errs.join(' | '):'none');
await ctx.close();

// The trim handles are the one pair in the app that can refuse to move while a
// thumb keeps pushing, and a screen cannot say so fast enough to be useful.
// Its own context, because this wants a clip rather than three photos.
{
  const c2=await b.newContext({viewport:{width:420,height:860},hasTouch:true});
  const q=await c2.newPage();
  await q.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate=(v)=>{window.__buzz.push(v);return true;}; });
  await q.goto('http://localhost:8160/');
  await q.click('#home-first');
  await q.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
  await q.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',
    buffer:fs.readFileSync(path.join(import.meta.dirname,'fixtures','clip.webm'))}]);
  await q.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
  await q.waitForTimeout(1200);
  const box=await q.locator('#canvas').boundingBox();
  await q.mouse.click(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await q.waitForTimeout(500);
  await q.click('#tile-trim-btn');
  await q.waitForTimeout(400);
  await q.evaluate(()=>{window.__buzz=[];});

  // Drive the start handle past the end one, which it is not allowed to pass.
  const bar=await q.locator('#trim-start').boundingBox();
  const y=Math.round(bar.y+bar.height/2);
  await q.mouse.move(bar.x+4, y);
  await q.mouse.down();
  for (let x=Math.round(bar.x+4); x<bar.x+bar.width; x+=10) { await q.mouse.move(x,y); await q.waitForTimeout(8); }
  await q.mouse.up();
  await q.waitForTimeout(300);
  const run=await q.evaluate(()=>{const v=window.__buzz;window.__buzz=[];return v;});
  const limits=run.filter(v=>Array.isArray(v)&&v[2]===45).length;
  console.log(`push a handle past the other -> ${JSON.stringify(run)}`,
    limits===1?'✓ one buzz for arriving, not one a frame':`✗ ${limits} limit buzzes, wanted 1`);
  if(limits!==1) process.exitCode=1;
  await c2.close();
}

await b.close(); srv.close();
