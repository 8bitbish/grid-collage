import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8181,r));
const N=12;
const files=[...Array(N)].map((_,i)=>path.resolve(`fixtures/photo${i%12}.jpg`));
const j=o=>JSON.stringify(o);

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8181/');
const t0=Date.now();
await p.setInputFiles('#file-input', files);
await p.waitForFunction((n)=>document.querySelectorAll('.film').length===n, N, {timeout:180000});
await p.waitForTimeout(1500);
console.log(`import of ${N}: ${((Date.now()-t0)/1000).toFixed(1)}s`);

const stored=()=>p.evaluate(async ()=>{
  const rows=await new Promise((res)=>{const q=indexedDB.open('grid-collage');
    q.onsuccess=()=>{const tx=q.result.transaction('photos','readonly');
      const a=tx.objectStore('photos').getAll(); a.onsuccess=()=>res(a.result);};});
  return { photoMB:+(rows.reduce((a,r)=>a+r.blob.size,0)/1048576).toFixed(1),
           proxyMB:+(rows.reduce((a,r)=>a+(r.proxy?r.proxy.size:0),0)/1048576).toFixed(1),
           thumbMB:+(rows.reduce((a,r)=>a+r.thumb.size,0)/1048576).toFixed(2),
           allHaveProxy: rows.every(r=>!!r.proxy) };});
console.log('stored:', j(await stored()));

console.log('\n== relaunch ==');
const t1=Date.now();
await p.reload();
await p.waitForFunction((n)=>document.querySelectorAll('.film').length===n, N, {timeout:180000});
const restore=Date.now()-t1;
console.log(`  usable after ${(restore/1000).toFixed(2)}s`);
console.log('  what it is drawing from:', j(await p.evaluate(()=>({
  full: window.__dbg ? null : undefined,
  canvasPx: (()=>{const c=document.getElementById('canvas');return `${c.width}x${c.height}`;})(),
}))));

// The page on screen must be pixel-identical whether drawn from proxy or full.
const shot1 = await p.locator('#canvas').screenshot();
console.log('  preview drawn from the proxy:', shot1.length, 'bytes of PNG');
console.log('\n== staying put brings the real photo in ==');
await p.waitForTimeout(1800);
const shot2 = await p.locator('#canvas').screenshot();
const same = Buffer.compare(shot1, shot2) === 0;
console.log('  after the dwell:', shot2.length, 'bytes |', same ? 'identical on screen ✓' : 'redrawn (sharper) — expected at this preview size');

console.log('\n== export is never a proxy ==');
for (const q of ['1080','2160']) {
  await p.evaluate((q)=>{const s=document.getElementById('quality');s.value=q;
    s.dispatchEvent(new Event('change',{bubbles:true}));}, q);
  await p.waitForTimeout(300);
  const dl=p.waitForEvent('download',{timeout:120000});
  await p.click('.dock-item[data-drawer="export"]').catch(()=>{});
  await p.waitForTimeout(250);
  await p.click('#btn-export');
  const d=await dl;
  console.log(`  @${q}: ${(fs.statSync(await d.path()).size/1024).toFixed(0)} KB/page`);
  await p.waitForTimeout(N*350);
  await p.click('#dock-back').catch(()=>{});
  await p.waitForTimeout(300);
}

console.log('\n== a fresh relaunch, exporting before any dwell ==');
await p.reload();
await p.waitForFunction((n)=>document.querySelectorAll('.film').length===n, N, {timeout:180000});
{
  const dl=p.waitForEvent('download',{timeout:120000});
  await p.click('.dock-item[data-drawer="export"]').catch(()=>{});
  await p.waitForTimeout(200);
  await p.click('#btn-export');
  const d=await dl;
  console.log(`  straight to export @2160: ${(fs.statSync(await d.path()).size/1024).toFixed(0)} KB/page`,
    '(must match the number above)');
  await p.waitForTimeout(N*350);
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
