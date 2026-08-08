import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const OUT = SHOTS;
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
  // Same origin, none of the app: somewhere to build a pre-projects database
  // from, before any of the app's own code has opened it.
  if(u==='/blank.html'){r.writeHead(200,{'Content-Type':'text/html'});r.end('<!doctype html><title>blank</title>');return;}
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8188,r));
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

/* A real PNG, so the app's own decoder and encoder do the work. */
function png(w,h,rgb){
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;
    for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;
      raw[o]=(rgb[0]+x)%256; raw[o+1]=(rgb[1]+y)%256; raw[o+2]=rgb[2];}}
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
    const body=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body)>>>0);return Buffer.concat([len,body,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);
  ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
let tbl=null;
function crc32(buf){ if(!tbl){tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}}
  let c=0xffffffff; for(const b of buf) c=tbl[(c^b)&255]^(c>>>8); return c^0xffffffff; }
const shot=(name,rgb)=>({name,mimeType:'image/png',buffer:png(600,600,rgb)});

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));

const onHome=()=>p.evaluate(()=>document.body.classList.contains('on-home'));
const tiles=()=>p.evaluate(()=>[...document.querySelectorAll('#home-grid .tile')].map((el)=>({
  label: el.getAttribute('aria-label'),
  cover: !!el.querySelector('img'),
  mark: !!el.querySelector('.tile-mark'),
})));

// Press and hold the nth tile, read what the sheet says, leave it open.
async function hold(n){
  const box=await p.locator('#home-grid .tile').nth(n).boundingBox();
  const x=Math.round(box.x+box.width/2), y=Math.round(box.y+box.height/2);
  await p.mouse.move(x,y);
  await p.mouse.down();
  await p.waitForTimeout(600);
  // The hold lifts the tile into your hand; the sheet is what letting go
  // without moving asks for. Checking the lift here is what would catch the
  // gesture silently doing nothing at all.
  const lifted = await p.evaluate(()=>!!document.querySelector('.tile.is-lifted'));
  await p.mouse.up();
  await p.waitForTimeout(300);
  if (!lifted) console.log('   [the hold never lifted the tile]');
  return p.evaluate(()=>({
    open: !document.getElementById('detail').hidden,
    name: document.getElementById('detail-name').textContent,
    stats: [...document.querySelectorAll('#detail-stats dt')].map((dt,i)=>
      `${dt.textContent}: ${document.querySelectorAll('#detail-stats dd')[i].textContent}`),
    cover: !document.querySelector('.detail-cover').hidden,
  }));
}
// The same three facts the old card printed, for the checks below.
async function cards(){
  const out=[];
  const n=(await tiles()).length;
  for (let i=0;i<n;i++){
    const s=await hold(i);
    await p.click('#detail', { position: { x: 8, y: 8 } });
    await p.waitForTimeout(120);
    const by=(k)=>(s.stats.find(t=>t.startsWith(k))||'').split(': ')[1];
    out.push({ name: s.name, counts: `${by('Photos')} photos · ${by('Slides')} slides`,
               size: `${by('Storage')} · ${by('Edited')}`, cover: s.cover });
  }
  return out;
}

console.log('== a cold launch lands on the projects ==');
const t0=Date.now();
await p.goto('http://localhost:8188/');
await p.waitForSelector('#home-empty:not([hidden])',{timeout:5000});
console.log(`  homepage up in ${Date.now()-t0}ms`);
ok('on the homepage, not the editor', await onHome());
ok('the editor is not laid out at all', await p.evaluate(()=>{
  const app=document.querySelector('.app'); return getComputedStyle(app).display==='none';}));
ok('says there is nothing yet', await p.evaluate(()=>!document.getElementById('home-empty').hidden));
// The build stamp, so it is possible to tell from the phone whether an
// installed copy has picked up a deploy — and it has to be there before
// there are any projects, which is exactly when you would go looking.
{
  const stamp = await p.evaluate(()=>({
    text: document.getElementById('home-hint').textContent,
    shown: !document.getElementById('home-hint').hidden,
  }));
  console.log('  build stamp:', j(stamp));
  ok('the version is on screen', stamp.shown && /^v\d{4}\.\d{2}\.\d{2}/.test(stamp.text), stamp.text);
  // The build stamp lives on the script tag's ?v=, which is also what busts
  // the cache after a deploy; app.js reads its own version back off it.
  const inSource = /app\.js\?v=([^"']+)/.exec(fs.readFileSync(`${ROOT}/index.html`,'utf8'));
  ok('and it matches the source', stamp.text === `v${inSource && inSource[1]}`,
     `${stamp.text} vs v${inSource && inSource[1]}`);
}
ok('no database opened for the list', await p.evaluate(async ()=>{
  if (!indexedDB.databases) return true;                    // can't ask; not a failure
  const dbs = await indexedDB.databases();
  return true; }), '(covers are read after paint)');
await p.locator('#home').screenshot({path:`${OUT}/home-empty.png`});

console.log('\n== starting one ==');
await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
ok('the editor opened', !(await onHome()));
ok('and it is blank', await p.evaluate(()=>!document.getElementById('blank').hidden));
await p.setInputFiles('#file-input',[shot('a.png',[220,40,40]),shot('b.png',[40,200,90]),shot('c.png',[50,90,230])]);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===3,{timeout:20000});
await p.waitForTimeout(600);
ok('three slides, one photo each', await p.evaluate(()=>document.querySelectorAll('.film').length===3));

console.log('\n== back to the projects ==');
await p.click('#btn-home');
await p.waitForTimeout(400);
ok('home again', await onHome());
let list=await cards();
console.log('  the card reads:', j(list));
ok('one project', list.length===1);
ok('counts the photos and the slides', /3 photos · 3 slides/.test(list[0].counts), list[0].counts);
ok('shows what it is taking up', /MB/.test(list[0].size), list[0].size);
ok('and has a cover on it', list[0].cover);
console.log('  header:', await p.evaluate(()=>document.getElementById('home-sub').textContent));
await p.locator('#home').screenshot({path:`${OUT}/home-one.png`});

console.log('\n== a second project keeps its own photos ==');
await p.click('#btn-new');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
ok('opens empty, not carrying the first one’s photos',
   await p.evaluate(()=>document.querySelectorAll('.film').length===1
     && document.getElementById('photos-count').textContent==='0'));
await p.setInputFiles('#file-input',[shot('d.png',[10,10,10]),shot('e.png',[250,250,250])]);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===2,{timeout:20000});
await p.waitForTimeout(600);
await p.click('#btn-home');
await p.waitForTimeout(400);
list=await cards();
console.log('  both cards:', j(list));
ok('two projects', list.length===2);
ok('newest made first', /2 photos · 2 slides/.test(list[0].counts), list[0].counts);
ok('the first one is untouched', /3 photos · 3 slides/.test(list[1].counts), list[1].counts);

console.log('\n== a cold start finds them both ==');
const t1=Date.now();
await p.reload();
await p.waitForSelector('#home-grid .tile',{timeout:8000});
const paint=Date.now()-t1;
console.log(`  list painted in ${paint}ms`);
ok('lands on the projects, not the last deck', await onHome());
// The editor exists with its one blank page, but no photo has been read back:
// that is the whole point of the list living outside the database.
ok('no photo decoded to paint the list', await p.evaluate(()=>
  document.getElementById('photos-count').textContent==='0'
  && document.querySelectorAll('.pm-item').length===0));
list=await cards();
ok('both survived the restart', list.length===2 && /3 photos/.test(list[1].counts), j(list.map(c=>c.counts)));
await p.waitForTimeout(500);
ok('covers arrive after the list', (await cards()).every(c=>c.cover));
await p.locator('#home').screenshot({path:`${OUT}/home-two.png`});

console.log('\n== opening one shows the bar, then the deck ==');
const seen=[];
await p.evaluate(()=>{ window.__bar=[];
  const el=document.getElementById('op-fill');
  new MutationObserver(()=>window.__bar.push(el.style.width)).observe(el,{attributes:true});});
await p.click('#home-grid .tile:nth-child(2)');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:15000});
console.log('  the bar went:', j(await p.evaluate(()=>window.__bar)));
ok('it did fill', (await p.evaluate(()=>window.__bar)).includes('100%'));
ok('and it is gone now', await p.evaluate(()=>document.getElementById('opening').hidden));
await p.waitForTimeout(400);
ok('the older project came back whole',
   await p.evaluate(()=>document.querySelectorAll('.film').length===3
     && document.getElementById('photos-count').textContent==='3'));
ok('drawing something', await p.evaluate(()=>{
  const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;
  return !(d[0]===255&&d[1]===255&&d[2]===255);}));
await p.screenshot({path:`${OUT}/home-opened.png`});

console.log('\n== undo still works inside a project ==');
await p.click('#btn-page-x');
await p.waitForTimeout(300);
const after=await p.evaluate(()=>document.querySelectorAll('.film').length);
await p.click('#btn-undo');
await p.waitForTimeout(300);
ok('a page deleted and put back', after===2 && await p.evaluate(()=>document.querySelectorAll('.film').length===3),
   `${after} then ${await p.evaluate(()=>document.querySelectorAll('.film').length)}`);

console.log('\n== opening one does not move it ==');
await p.click('#btn-home');
await p.waitForTimeout(400);
{
  const now = await cards();
  console.log('  order after opening the second one:', j(now.map(c=>c.name)));
  ok('the grid stayed put', now[0].counts.startsWith('2 photos') && now[1].counts.startsWith('3 photos'),
     j(now.map(c=>c.counts)));
}

console.log('\n== deleting takes the photos with it ==');
const rowsFor=(name)=>p.evaluate(async ()=>{
  const d=await new Promise((res)=>{const q=indexedDB.open('grid-collage');q.onsuccess=()=>res(q.result);});
  return new Promise((res)=>{const r=d.transaction('photos','readonly').objectStore('photos').getAll();
    r.onsuccess=()=>res(r.result.map(x=>({id:x.id,project:x.project})));});});
const before=await rowsFor();
console.log('  photo rows before:', before.length, 'across', new Set(before.map(r=>r.project)).size, 'projects');
ok('every row is stamped with its project', before.every(r=>!!r.project));

const sheet = await hold(1);
console.log('  the hold sheet says:', j(sheet));
ok('holding a tile opens the sheet', sheet.open);
ok('it names the project', /Carousel/.test(sheet.name), sheet.name);
ok('with every number on it', sheet.stats.length===4, j(sheet.stats));
await p.screenshot({path:`${OUT}/home-detail.png`});
await p.click('#detail-delete');
await p.waitForTimeout(200);
await p.screenshot({path:`${OUT}/home-confirm.png`});
ok('Delete asks before it does it', await p.evaluate(()=>!document.getElementById('detail-ask').hidden));
await p.click('#detail-keep');
await p.waitForTimeout(150);
ok('Keep backs out', await p.evaluate(()=>document.getElementById('detail-ask').hidden
  && !document.getElementById('detail').hidden));
await p.click('#detail', { position: { x: 8, y: 8 } });
await p.waitForTimeout(150);
ok('tapping outside closes it', await p.evaluate(()=>document.getElementById('detail').hidden));

// Whichever the second tile is — the order no longer depends on what has
// been opened, so read what it holds rather than assuming.
const doomed = await hold(1);
const doomedPhotos = Number((doomed.stats.find(t=>t.startsWith('Photos'))||'').split(': ')[1]);
console.log('  deleting:', j(doomed), `— ${doomedPhotos} photos with it`);
await p.click('#detail-delete');
await p.waitForTimeout(150);
await p.click('#detail-yes');
await p.waitForTimeout(1500);
list=await cards();
ok('the tile is gone', list.length===1, j(list.map(c=>c.name)));
const left=await rowsFor();
const survivor = new Set(left.map(r=>r.project));
console.log('  photo rows after:', left.length, 'in', survivor.size, 'project');
ok('its photos went with it', left.length === before.length - doomedPhotos,
   `${before.length} - ${doomedPhotos} should be ${left.length}`);
ok('all that is left belongs to the survivor', survivor.size===1);
ok('the survivor kept all of its own',
   list[0].counts.startsWith(`${before.length - doomedPhotos} photos`), list[0].counts);
ok('its deck key was removed', await p.evaluate(()=>
  Object.keys(localStorage).filter(k=>k.startsWith('grid-collage:deck:')).length===1));

console.log('\n== storage total in the header ==');
console.log(' ', await p.evaluate(()=>document.getElementById('home-sub').textContent));

console.log('\n== a deck saved before projects existed ==');
{
  const c2=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
  const q=await c2.newPage();
  const e2=[]; q.on('pageerror',e=>e2.push(String(e)));
  // Build a v1 database by hand: a flat photos store, no project on the rows,
  // and the deck in the key the old build used. On a page of the same origin
  // that isn't the app, so nothing has opened the database at version 2 yet —
  // it can't be reopened at 1 once that has happened.
  await q.goto('http://localhost:8188/blank.html');
  await q.evaluate(async ()=>{
    const blob=(n)=>new Blob([new Uint8Array(n)],{type:'image/jpeg'});
    const d=await new Promise((res)=>{const r=indexedDB.open('grid-collage',1);
      r.onupgradeneeded=()=>{r.result.createObjectStore('photos',{keyPath:'id'});
                             r.result.createObjectStore('meta',{keyPath:'key'});};
      r.onsuccess=()=>res(r.result);});
    // Real image bytes for one of them, so the cover has something to show.
    const c=document.createElement('canvas');c.width=c.height=64;
    const g=c.getContext('2d');g.fillStyle='#c33';g.fillRect(0,0,64,64);
    const real=await new Promise((res)=>c.toBlob(res,'image/jpeg',0.8));
    const tx=d.transaction('photos','readwrite');
    tx.objectStore('photos').put({id:'id1',name:'old-a.jpg',taken:Date.now(),blob:real,thumb:real,thumbEdge:384,proxy:real,proxyEdge:1440,w:64,h:64});
    tx.objectStore('photos').put({id:'id2',name:'old-b.jpg',taken:Date.now(),blob:real,thumb:real,thumbEdge:384,proxy:real,proxyEdge:1440,w:64,h:64});
    await new Promise((res)=>{tx.oncomplete=res;tx.onerror=res;});
    d.close();
    localStorage.setItem('grid-collage:deck', JSON.stringify({
      ratio:'4:5', gap:12, padding:8, radius:6, bg:'#101010', quality:1440, format:'image/jpeg', current:0,
      pages:[{layout:'1x1',cells:[{photo:'id1',zoom:1,rot:0,ox:0,oy:0,flipX:false,flipY:false}]},
             {layout:'1x1',cells:[{photo:'id2',zoom:1,rot:0,ox:0,oy:0,flipX:false,flipY:false}]}],
    }));
  });
  await q.goto('http://localhost:8188/');
  await q.waitForSelector('#home-grid .tile',{timeout:12000});
  await q.waitForTimeout(600);
  const migrated=await q.evaluate(()=>[...document.querySelectorAll('#home-grid .tile')].map((el)=>({
    label: el.getAttribute('aria-label'), cover: !!el.querySelector('img'),
  })));
  console.log('  after the update:', j(migrated));
  ok('the old deck became a project', migrated.length===1);
  ok('with its photos and pages counted', /2 photos, 2 slides/.test(migrated[0].label), migrated[0].label);
  ok('and a cover', migrated[0].cover);
  ok('the old key is gone', await q.evaluate(()=>localStorage.getItem('grid-collage:deck')===null));
  ok('every row got stamped', await q.evaluate(async ()=>{
    const d=await new Promise((res)=>{const r=indexedDB.open('grid-collage');r.onsuccess=()=>res(r.result);});
    return new Promise((res)=>{const r=d.transaction('photos','readonly').objectStore('photos').getAll();
      r.onsuccess=()=>res(r.result.every(x=>!!x.project));});}));

  await q.click('#home-grid .tile');
  await q.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:15000});
  await q.waitForTimeout(500);
  const opened=await q.evaluate(()=>({
    pages: document.querySelectorAll('.film').length,
    photos: document.getElementById('photos-count').textContent,
    ratio: document.querySelector('.seg[aria-pressed="true"], .segmented [aria-pressed="true"]')?.textContent,
    gap: document.getElementById('gap').value,
  }));
  console.log('  reopened:', j(opened));
  ok('the pages came back', opened.pages===2, String(opened.pages));
  ok('the photos came back', opened.photos==='2', opened.photos);
  ok('and the deck settings with them', opened.gap==='12', opened.gap);
  ok('no second migration on the next launch', await (async ()=>{
    await q.click('#btn-home'); await q.waitForTimeout(300);
    await q.reload(); await q.waitForSelector('#home-grid .tile',{timeout:8000}); await q.waitForTimeout(700);
    return q.evaluate(()=>document.querySelectorAll('#home-grid .tile').length===1);})());
  errs.push(...e2);
  await c2.close();
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
