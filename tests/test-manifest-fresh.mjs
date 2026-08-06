// A changed manifest must reach the browser on the very next load, or an
// installed app never learns about a new share target.
import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/grid-collage';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
let override=null;
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
  if(override && u.endsWith('.webmanifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});r.end(override);return;}
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8139,r));

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext();
const p=await ctx.newPage();
await autoEnter(p);
const readManifest=()=>p.evaluate(async()=>{
  const res=await fetch(document.querySelector('link[rel=manifest]').href,{cache:'no-store'});
  const m=await res.json();
  return m.share_target ? 'has share_target' : 'NO share_target';
});

await p.goto('http://localhost:8139/');
await p.evaluate(()=>navigator.serviceWorker.ready);
await p.reload();
await p.waitForFunction(()=>navigator.serviceWorker.controller!==null);
console.log('visit 1 (sw controlling):', await readManifest());

// simulate deploying a manifest WITHOUT the share target, then one WITH it
const real = fs.readFileSync(`${ROOT}/manifest.webmanifest`,'utf8');
const stripped = JSON.stringify({ ...JSON.parse(real), share_target: undefined });
override = stripped;
await p.reload();
console.log('after deploying a manifest without it:', await readManifest(), '(expect NO share_target immediately)');

override = real;
await p.reload();
console.log('after deploying one with it back:', await readManifest(), '(expect has share_target immediately)');

// still available offline
await ctx.setOffline(true);
await p.reload();
const offline = await p.evaluate(async()=>{
  try { const c = await caches.open('grid-collage-v1');
        const r = await c.match(new URL('manifest.webmanifest', location.href).href);
        return r ? 'cached copy present' : 'MISSING'; } catch(e){ return 'err '+e; }
});
console.log('offline fallback:', offline);
await b.close(); srv.close();
