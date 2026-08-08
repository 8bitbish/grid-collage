import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8176,r));
const files=[0,1,2,3].map(i=>path.resolve(`fixtures/photo${i}.jpg`));
const j=o=>JSON.stringify(o);

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8176/');
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4,{timeout:60000});
await p.waitForTimeout(1500);

const read=()=>p.evaluate(async ()=>{
  const rows=await new Promise((res)=>{const q=indexedDB.open('grid-collage');
    q.onsuccess=()=>{const tx=q.result.transaction('photos','readonly');
      const a=tx.objectStore('photos').getAll(); a.onsuccess=()=>res(a.result);};});
  return rows.map(r=>({ edge:r.thumbEdge||null, kb:Math.round(r.thumb.size/1024) }));});
console.log('fresh import:', j(await read()));

// Put the library back how an older build left it: 160px thumbs, no thumbEdge.
console.log('\n== an existing library from before this change ==');
await p.evaluate(async ()=>{
  const rows=await new Promise((res)=>{const q=indexedDB.open('grid-collage');
    q.onsuccess=()=>{const tx=q.result.transaction('photos','readonly');
      const a=tx.objectStore('photos').getAll(); a.onsuccess=()=>res(a.result);};});
  for (const r of rows) {
    const bmp=await createImageBitmap(r.blob);
    const k=160/Math.max(bmp.width,bmp.height);
    const c=new OffscreenCanvas(Math.round(bmp.width*k), Math.round(bmp.height*k));
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    const small=await c.convertToBlob({type:'image/jpeg',quality:0.8});
    delete r.thumbEdge; r.thumb=small;
    await new Promise((res)=>{const q=indexedDB.open('grid-collage');
      q.onsuccess=()=>{const tx=q.result.transaction('photos','readwrite');
        tx.objectStore('photos').put(r); tx.oncomplete=res;};});
  }
});
console.log('  downgraded to:', j(await read()));

await p.reload();
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4,{timeout:60000});
console.log('  right after the reload, on screen:', j(await p.evaluate(()=>{
  const i=document.querySelector('.pm-pick img'); return { naturalW: i ? i.naturalWidth : null };})));
// Poll from Node: waitForFunction treats an async predicate's Promise as
// truthy and passes on the first tick, so it can't be used for this.
let upgraded = 0;
for (let i=0;i<40;i++){
  await p.waitForTimeout(500);
  const rows = await read();
  upgraded = rows.filter(r=>r.edge===384).length;
  if (upgraded === 4) break;
}
console.log('  redrawn in the background:', upgraded===4 ? '✓ all four' : `✗ only ${upgraded} of 4`);
console.log('  now stored as:', j(await read()));

await p.click('#btn-photos'); await p.waitForTimeout(600);
console.log('  on screen now:', j(await p.evaluate(()=>{
  const i=document.querySelector('.pm-pick img'); const r=i.getBoundingClientRect();
  return { naturalW:i.naturalWidth, needDevicePx: Math.round(r.width*devicePixelRatio),
           stretch:+(r.width*devicePixelRatio/i.naturalWidth).toFixed(2) };})));
await p.locator('.pm-card').screenshot({path:`${SHOTS}/library-sharp.png`});

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
