import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8165,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const mk=(n,c)=>({name:n,mimeType:'image/png',buffer:png(500,600,c)});
const j=o=>JSON.stringify(o);

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
let p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate=(v)=>{window.__buzz.push(v);return true;}; });
await p.goto('http://localhost:8165/'); await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input',[mk('a.png',[220,40,40]),mk('b.png',[40,200,90]),mk('c.png',[50,90,230]),mk('d.png',[240,190,40])]);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);
await p.waitForTimeout(500);

let p2ctx=null;
async function ctx2Setup(){
  p2ctx = await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
  const np = await p2ctx.newPage();
  await autoEnter(np);
  np.on('pageerror',e=>errs.push(String(e)));
  np.on('console',m=>m.type()==='error'&&errs.push(m.text()));
  await np.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate=(v)=>{window.__buzz.push(v);return true;}; });
  await np.goto('http://localhost:8165/');
  await np.setInputFiles('#file-input',[mk('a.png',[220,40,40]),mk('b.png',[40,200,90]),mk('c.png',[50,90,230]),mk('d.png',[240,190,40])]);
  p = np; ctx = p2ctx;
}

const thumbs=()=>p.evaluate(()=>[...document.querySelectorAll('.film canvas')].map(c=>{
  const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
  return `${d[0]},${d[1]},${d[2]}`;}));
// A tile that is not on the current slide or one either side is drawn from
// its proxy rather than the original, so a flat colour can come back a unit
// or two out — JPEG, not a wrong picture. Sampling has to allow for that.
// That the original does come back is asserted where it matters, on the
// slide you are actually looking at, after the dwell.
const near=(a,b,slack=3)=>{const x=String(a).split(',').map(Number), y=String(b).split(',').map(Number);
  return x.length===3&&y.length===3&&x.every((v,i)=>Math.abs(v-y[i])<=slack);};
const sameList=(a,b)=>a.length===b.length&&a.every((v,i)=>near(v,b[i]));
const pages=()=>p.evaluate(()=>document.querySelectorAll('.film').length);
const buzzes=()=>p.evaluate(()=>{const b=window.__buzz;window.__buzz=[];return b;});

console.log('== the bar ==');
console.log('  order across:', j(await p.evaluate(()=>{
  const lib=document.getElementById('btn-photos').getBoundingClientRect();
  const strip=document.getElementById('filmstrip').getBoundingClientRect();
  const end=document.querySelector('.pagesbar-end').getBoundingClientRect();
  return { library:Math.round(lib.left), strip:Math.round(strip.left), undoRedo:Math.round(end.left),
           inOrder: lib.right<=strip.left+1 && strip.right<=end.left+1,
           barWidth:Math.round(document.querySelector('.pagesbar').getBoundingClientRect().width) };})));
console.log('  nothing above the pages bar:', j(await p.evaluate(()=>({
  installbarHidden: document.getElementById('installbar').hidden,
  pagesTop: Math.round(document.querySelector('.pagesbar').getBoundingClientRect().top)}))));
console.log('  redo disabled at rest:', await p.evaluate(()=>document.getElementById('btn-redo').disabled));
await p.locator('.pagesbar').screenshot({path:`${OUT}/pagesbar.png`});

console.log('\n== the strip still scrolls between them ==');
for (let i=0;i<10;i++){ await p.click('.film-add'); await p.waitForTimeout(50); }
await p.waitForTimeout(400);
const geom = await p.evaluate(()=>{
  const s=document.getElementById('filmstrip');
  return { scrollable: s.scrollWidth > s.clientWidth + 2, slack: Math.round(s.scrollWidth - s.clientWidth) };});
console.log('  strip overflows:', j(geom));
const fixedBefore = await p.evaluate(()=>({
  lib: Math.round(document.getElementById('btn-photos').getBoundingClientRect().left),
  end: Math.round(document.querySelector('.pagesbar-end').getBoundingClientRect().left)}));
// drag the strip sideways with a finger
{
  const cdp=await ctx.newCDPSession(p);
  const box=await p.locator('#filmstrip').boundingBox();
  const y=Math.round(box.y+box.height/2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y}]});
  for (const x of [270,230,190,150,120]) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
    await p.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(400);
}
const scrolled = await p.evaluate(()=>Math.round(document.getElementById('filmstrip').scrollLeft));
const fixedAfter = await p.evaluate(()=>({
  lib: Math.round(document.getElementById('btn-photos').getBoundingClientRect().left),
  end: Math.round(document.querySelector('.pagesbar-end').getBoundingClientRect().left)}));
console.log('  a finger drag scrolled it to', scrolled, scrolled>0 ? '✓' : '✗ did not scroll');
console.log('  both ends stayed put:', j(fixedBefore)===j(fixedAfter) ? '✓' : `✗ ${j(fixedBefore)} -> ${j(fixedAfter)}`);
console.log('  no page still got lifted by the drag:',
  await p.evaluate(()=>!document.querySelector('.film.is-lifted')) ? '✓' : '✗');

console.log('\n== the cross on the page itself ==');
// A clean context: photos live in IndexedDB, so clearing localStorage alone
// leaves the previous run's library behind and the page count won't match.
await ctx2Setup();
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);
await p.waitForTimeout(600);
console.log('  none on the thumbnails:', await p.evaluate(()=>document.querySelectorAll('.film-x').length===0) ? '✓' : '✗');
console.log('  sits on the page top-right:', j(await p.evaluate(()=>{
  const c=document.getElementById('canvas').getBoundingClientRect();
  const x=document.getElementById('btn-page-x').getBoundingClientRect();
  return { page:[Math.round(c.left),Math.round(c.top),Math.round(c.right)],
           btn:[Math.round(x.left),Math.round(x.top)],
           insideTopRight: x.right<=c.right && x.top>=c.top && x.left>c.left+c.width/2,
           size:`${Math.round(x.width)}x${Math.round(x.height)}` };})));
await p.locator('.stage').screenshot({path:`${OUT}/page-cross.png`});

// it tracks the page when the deck changes shape
await p.click('.dock-item[data-drawer="shape"]'); await p.waitForTimeout(250);
await p.locator('#ratios button', {hasText:'9:16'}).first().click();
await p.waitForTimeout(500);
await p.click('#dock-back'); await p.waitForTimeout(300);
console.log('  follows the page at 9:16:', j(await p.evaluate(()=>{
  const c=document.getElementById('canvas').getBoundingClientRect();
  const x=document.getElementById('btn-page-x').getBoundingClientRect();
  return { hugsCorner: Math.abs(x.right-(c.right-8))<2 && Math.abs(x.top-(c.top+8))<2,
           pageWidth:Math.round(c.width) };})));
await p.click('.dock-item[data-drawer="shape"]'); await p.waitForTimeout(200);
await p.locator('#ratios button', {hasText:'1:1'}).first().click();
await p.waitForTimeout(400); await p.click('#dock-back'); await p.waitForTimeout(300);

// it steps aside while a tile is selected, and while a page turns
const box=await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(350);
console.log('  hidden while a tile is selected:', await p.evaluate(()=>document.getElementById('btn-page-x').hidden) ? '✓' : '✗');
await p.keyboard.press('Escape'); await p.waitForTimeout(350);
console.log('  back after deselecting:', await p.evaluate(()=>!document.getElementById('btn-page-x').hidden) ? '✓' : '✗');

const before=await thumbs();
await p.evaluate(()=>{window.__buzz=[];});
console.log('  current page is', await p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1));
await p.click('#btn-page-x');
await p.waitForTimeout(450);
console.log('  deleting it:', await pages(), 'left |', j(await thumbs()),
            sameList(await thumbs(), before.slice(1)) ? '✓ the current one went' : '✗');
console.log('  buzzed:', j(await buzzes()));
await p.click('#btn-undo'); await p.waitForTimeout(450);
console.log('  undo brings it back:', await pages(), sameList(await thumbs(), before) ? '✓' : '✗');

// it must not eat a swipe that starts on the page
{
  const cdp=await ctx.newCDPSession(p);
  const b2=await p.locator('#canvas').boundingBox();
  const y=Math.round(b2.y+b2.height/2);
  const from=await p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current')));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.round(b2.x+b2.width*0.8),y}]});
  for (const dx of [-30,-70,-110,-150]) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(b2.x+b2.width*0.8+dx),y}]});
    await p.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(600);
  const to=await p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current')));
  console.log('  a swipe across the page still turns it:', from, '->', to, to>from ? '✓' : '✗');
}

// deleting the only page leaves a blank one, not zero
console.log('\n== the last page ==');
while (await pages() > 1) { await p.click('#btn-page-x'); await p.waitForTimeout(250); }
await p.click('#btn-page-x');
await p.waitForTimeout(400);
console.log('  deleting the last leaves a blank page:', await pages());

console.log('\n== undo/redo still work from their new home ==');
await p.evaluate(()=>{window.__buzz=[];});
console.log('  undo enabled:', await p.evaluate(()=>!document.getElementById('btn-undo').disabled));
await p.click('#btn-undo'); await p.waitForTimeout(350);
console.log('  after undo:', await pages(), 'pages | buzzed:', j(await buzzes()));
await p.click('#btn-redo'); await p.waitForTimeout(350);
console.log('  after redo:', await pages(), 'pages');

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
