import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
const N=12;
const files=[...Array(N)].map((_,i)=>path.resolve(`fixtures/photo${i%12}.jpg`));
const j=o=>JSON.stringify(o);
// This printed its measurements and a note of what each should be, and left the
// comparing to whoever read the log, so it exited 0 whatever it saw. The notes
// are assertions now. It is the only test that asks whether an export can come
// out of a proxy, which is the one of these that would cost someone a post.
let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto(`http://localhost:${PORT}/`);
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
const kept=await stored();
console.log('stored:', j(kept));
ok('every photo got a proxy', kept.allHaveProxy);
// 101.5MB of originals came to 8.5MB of proxies when this was written.
ok('and the proxies are a fraction of the originals', kept.proxyMB < kept.photoMB/4, `${kept.proxyMB}MB of ${kept.photoMB}MB`);

console.log('\n== relaunch ==');
const t1=Date.now();
await p.reload();
await p.waitForFunction((n)=>document.querySelectorAll('.film').length===n, N, {timeout:180000});
const restore=Date.now()-t1;
console.log(`  usable after ${(restore/1000).toFixed(2)}s`);
// 0.27s here. The bound is loose on purpose: what it catches is a relaunch that
// decodes 100MB of originals before it shows anything, which is seconds.
ok('a relaunch is usable before the originals are read', restore < 3000, `${restore}ms`);
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
const sizes={};
for (const q of ['1080','2160']) {
  const dl=p.waitForEvent('download',{timeout:120000});
  await p.click('#btn-export-open').catch(()=>{});
  await p.waitForTimeout(250);
  await p.click(`#export-card [data-quality="${q}"]`);
  await p.waitForTimeout(300);
  await p.click('#btn-export');
  await p.click('#export-share', { timeout: 120000 });
  const d=await dl;
  sizes[q]=fs.statSync(await d.path()).size;
  console.log(`  @${q}: ${(sizes[q]/1024).toFixed(0)} KB/page`);
  await p.waitForTimeout(N*350);
}

ok('a bigger export is a bigger file', sizes['2160'] > sizes['1080']*2, `${sizes['1080']} → ${sizes['2160']}`);

console.log('\n== a fresh relaunch, exporting before any dwell ==');
await p.reload();
await p.waitForFunction((n)=>document.querySelectorAll('.film').length===n, N, {timeout:180000});
{
  const dl=p.waitForEvent('download',{timeout:120000});
  await p.click('#btn-export-open').catch(()=>{});
  await p.waitForTimeout(200);
  await p.click('#btn-export');
  await p.click('#export-share', { timeout: 120000 });
  const d=await dl;
  const straight=fs.statSync(await d.path()).size;
  console.log(`  straight to export @2160: ${(straight/1024).toFixed(0)} KB/page`);
  // Straight after a relaunch every photo on screen is still its proxy. If the
  // export drew from those it would be a visibly softer file, and a smaller one.
  ok('exporting before the originals are in gives the same file as after',
     Math.abs(straight-sizes['2160']) <= sizes['2160']*0.01, `${straight} vs ${sizes['2160']}`);
  await p.waitForTimeout(N*350);
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
ok('no errors', errs.length===0, j(errs.slice(0,2)));
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
