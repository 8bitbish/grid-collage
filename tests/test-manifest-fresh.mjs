// A changed manifest must reach the browser on the very next load, or an
// installed app never learns about a new share target.
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
let override=null;
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
  if(override && u.endsWith('.webmanifest')){r.writeHead(200,{'Content-Type':'application/manifest+json'});r.end(override);return;}
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8139,r));
let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
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
// This used to print what it saw and leave the reading to a person, so it exited
// 0 whatever came back and the runner could not count it. The expectations were
// already written in the log lines; they are assertions now.
const first=await readManifest();
console.log('visit 1 (sw controlling):', first);
ok('the shipped manifest declares the share target', first==='has share_target', first);

// simulate deploying a manifest WITHOUT the share target, then one WITH it
const real = fs.readFileSync(`${ROOT}/manifest.webmanifest`,'utf8');
const stripped = JSON.stringify({ ...JSON.parse(real), share_target: undefined });
override = stripped;
await p.reload();
const without=await readManifest();
console.log('after deploying a manifest without it:', without);
ok('a changed manifest is seen on the very next load', without==='NO share_target', without);

override = real;
await p.reload();
const back=await readManifest();
console.log('after deploying one with it back:', back);
ok('and so is putting it back', back==='has share_target', back);

// still available offline
await ctx.setOffline(true);
await p.reload();
const offline = await p.evaluate(async()=>{
  try { const c = await caches.open('grid-collage-v1');
        const r = await c.match(new URL('manifest.webmanifest', location.href).href);
        return r ? 'cached copy present' : 'MISSING'; } catch(e){ return 'err '+e; }
});
console.log('offline fallback:', offline);
ok('a copy is kept for when there is no connection', offline==='cached copy present', offline);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
