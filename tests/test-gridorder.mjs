/* Dragging a tile to a new place, and what that does to the order from then
   on. Driven through real pointer events, hold and all. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const OUT = SHOTS;
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8203,r));
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

function png(w,h,rgb){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=rgb[0];raw[o+1]=rgb[1];raw[o+2]=rgb[2];}}
  const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=tbl[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const body=Buffer.concat([Buffer.from(t),d]);
    const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([l,body,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8203/');

// Seven carousels, each one photo, named in the order they were made.
for (let i=0;i<7;i++){
  await p.click(i===0 ? '#home-first' : '#btn-new');
  await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:15000});
  await p.setInputFiles('#file-input',[{name:`c${i}.png`,mimeType:'image/png',
    buffer:png(300,300,[30+i*30, 200-i*20, 120])}]);
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
  await p.waitForTimeout(300);
  await p.click('#btn-home');
  await p.waitForTimeout(350);
}
await p.waitForTimeout(500);

const order=()=>p.evaluate(()=>[...document.querySelectorAll('#home-grid .tile')]
  .map(el=>(el.getAttribute('aria-label')||'').split(' —')[0]));
const stored=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('grid-collage:projects')).map(x=>x.name));

console.log('== made in order, newest first ==');
let now = await order();
console.log(' ', j(now));
ok('seven of them', now.length===7);
ok('newest first', now[0]==='Carousel 7' && now[6]==='Carousel 1', j([now[0], now[6]]));
ok('no custom order yet', await p.evaluate(()=>localStorage.getItem('grid-collage:custom-order')===null));

// Press, hold past the threshold, drag, release.
async function drag(fromIndex, toIndex) {
  const boxes = await p.evaluate(()=>[...document.querySelectorAll('#home-grid .tile')]
    .map(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2, y:r.y+r.height/2};}));
  const a = boxes[fromIndex], z = boxes[toIndex];
  await p.mouse.move(Math.round(a.x), Math.round(a.y));
  await p.mouse.down();
  await p.waitForTimeout(650);                       // past the hold
  const lifted = await p.evaluate(()=>!!document.querySelector('.tile.is-lifted'));
  // In steps, the way a finger travels.
  for (let s=1;s<=8;s++){
    await p.mouse.move(Math.round(a.x+(z.x-a.x)*s/8), Math.round(a.y+(z.y-a.y)*s/8));
    await p.waitForTimeout(25);
  }
  const shot = `${OUT}/grid-drag.png`;
  if (fromIndex===0) await p.screenshot({path:shot});
  await p.mouse.up();
  await p.waitForTimeout(600);
  return lifted;
}

console.log('\n== hold and let go, without moving: still the details ==');
{
  const box = await p.locator('#home-grid .tile').first().boundingBox();
  await p.mouse.move(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await p.mouse.down();
  await p.waitForTimeout(650);
  ok('the tile lifts', await p.evaluate(()=>!!document.querySelector('.tile.is-lifted')));
  await p.mouse.up();
  await p.waitForTimeout(400);
  ok('and releasing opens the sheet', await p.evaluate(()=>!document.getElementById('detail').hidden));
  ok('nothing moved', j(await order())===j(now), j(await order()));
  ok('no custom order set by a mere look',
     await p.evaluate(()=>localStorage.getItem('grid-collage:custom-order')===null));
  await p.click('#detail', { position: { x: 8, y: 8 } });
  await p.waitForTimeout(250);
}

console.log('\n== drag the first one to the fourth slot ==');
const wasLifted = await drag(0, 3);
ok('it lifted for the drag', wasLifted);
now = await order();
console.log(' ', j(now));
ok('Carousel 7 moved to the fourth place', now[3]==='Carousel 7', j(now));
ok('the others closed up behind it',
   j(now.slice(0,3))===j(['Carousel 6','Carousel 5','Carousel 4']), j(now.slice(0,3)));
ok('the tail is untouched', j(now.slice(4))===j(['Carousel 3','Carousel 2','Carousel 1']), j(now.slice(4)));
ok('the order is now yours', await p.evaluate(()=>localStorage.getItem('grid-collage:custom-order')==='1'));
ok('and it is what was written down', j(await stored())===j(now), j(await stored()));

console.log('\n== it survives a relaunch ==');
await p.reload();
await p.waitForSelector('#home-grid .tile',{timeout:10000});
await p.waitForTimeout(600);
ok('same order after a reload', j(await order())===j(now), j(await order()));

console.log('\n== dragging across a row ==');
const before = await order();
await drag(6, 1);           // last tile, third row, up to the second slot
now = await order();
console.log('  before:', j(before));
console.log('  after: ', j(now));
ok('it landed in the second slot', now[1]===before[6], `${now[1]} vs ${before[6]}`);
ok('still seven', now.length===7);
ok('none lost', j([...now].sort())===j([...before].sort()));

console.log('\n== a new one still arrives at the front ==');
await p.click('#btn-new');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:10000});
await p.click('#btn-home');
await p.waitForTimeout(500);
const withNew = await order();
console.log(' ', j(withNew));
ok('the new one is first', withNew[0]==='Carousel 8', withNew[0]);
ok('and everything else kept its place', j(withNew.slice(1))===j(now), j(withNew.slice(1)));

console.log('\n== opening one still does not move it ==');
await p.click('#home-grid .tile:nth-child(3)');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:15000});
await p.waitForTimeout(600);
await p.click('#btn-home');
await p.waitForTimeout(500);
ok('the grid stayed put', j(await order())===j(withNew), j(await order()));

console.log('\n== a tap still opens ==');
{
  const name = (await order())[2];
  await p.click('#home-grid .tile:nth-child(3)');
  await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:15000});
  await p.waitForTimeout(400);
  ok('into the one that was tapped', await p.evaluate(()=>!document.body.classList.contains('on-home')), name);
  await p.click('#btn-home');
  await p.waitForTimeout(400);
}

console.log('\n== dropping it back where it started changes nothing ==');
{
  const was = await order();
  const boxes = await p.evaluate(()=>[...document.querySelectorAll('#home-grid .tile')]
    .map(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2, y:r.y+r.height/2};}));
  const a = boxes[2];
  await p.mouse.move(Math.round(a.x), Math.round(a.y));
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.move(Math.round(a.x+30), Math.round(a.y+10));
  await p.waitForTimeout(60);
  await p.mouse.move(Math.round(a.x), Math.round(a.y));
  await p.waitForTimeout(60);
  await p.mouse.up();
  await p.waitForTimeout(600);
  ok('order unchanged', j(await order())===j(was), j(await order()));
  ok('and no sheet was opened by the wander',
     await p.evaluate(()=>document.getElementById('detail').hidden));
  ok('nothing left lifted', await p.evaluate(()=>!document.querySelector('.tile.is-lifted')));
  ok('no transforms left behind', await p.evaluate(()=>
    [...document.querySelectorAll('#home-grid .tile')].every(el=>!el.style.transform)));
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
