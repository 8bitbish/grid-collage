import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};

// A server that can be told to "deploy". A real deploy moves the ?v= stamp in
// index.html and ships new bytes behind it, so that is what this does: the
// stamp becomes v2, v3… and app.js picks up a matching marker. sw.js stays
// byte-identical, which is the common case and the one the browser's own
// update check misses.
let version = 1;
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0];
  const f=path.join(ROOT, u==='/' ? 'index.html' : u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  let body = fs.readFileSync(f);
  if (version > 1 && u.endsWith('/app.js')) body = Buffer.concat([body, Buffer.from(`\n/* v${version} */\n`)]);
  if (version > 1 && (u==='/' || u.endsWith('/index.html'))) {
    body = Buffer.from(body.toString('utf8').replace(/(app\.js|styles\.css)\?v=[^"']+/g, `$1?v=test${version}`));
  }
  const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0,16) + '"';
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream','ETag':etag,'Cache-Control':'no-cache'});
  r.end(body);
});
await new Promise(r=>srv.listen(8171,r));

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
const shown = () => p.evaluate(()=>!document.getElementById('update-toast').hidden);

console.log('== first visit ==');
await p.goto('http://localhost:8171/');
await p.waitForFunction(()=>navigator.serviceWorker.controller !== null || performance.now() > 6000, {timeout:9000});
await p.waitForTimeout(1200);
console.log('  worker in charge:', await p.evaluate(()=>!!navigator.serviceWorker.controller));
console.log('  no update offered on a first install:', !(await shown()) ? '✓' : '✗ SHOWN');

console.log('\n== reload with nothing new ==');
await p.reload();
await p.waitForTimeout(1500);
console.log('  still nothing offered:', !(await shown()) ? '✓' : '✗ SHOWN');

console.log('\n== a deploy lands while the app is open ==');
version = 2;
// Without a reload — a reload would simply land on the new build now that
// the files are stamped, and there would be nothing to offer. This is the
// case the toast is actually for: an app sitting open while a deploy goes
// out. Coming back to it is the only moment it can notice.
await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
await p.waitForFunction(()=>!document.getElementById('update-toast').hidden, {timeout:9000})
  .then(()=>console.log('  toast appeared: ✓'))
  .catch(()=>console.log('  toast appeared: ✗ never shown'));
console.log('  what it says:', JSON.stringify(await p.evaluate(()=>({
  title: document.querySelector('.ut-text strong').textContent,
  sub: document.querySelector('.ut-text span').textContent,
  later: document.getElementById('ut-later').textContent,
  now: document.getElementById('ut-now').textContent,
  overTheDock: (()=>{const t=document.getElementById('update-toast').getBoundingClientRect();
    const d=document.querySelector('.dock').getBoundingClientRect();
    return t.bottom <= innerHeight + 1 && t.top < d.bottom;})(),
}))));
await p.locator('#update-toast').screenshot({path:`${SHOTS}/update-toast.png`});

console.log('\n== Later ==');
await p.click('#ut-later');
await p.waitForTimeout(300);
console.log('  dismissed:', !(await shown()) ? '✓' : '✗');
// and it must not come straight back in the same session
await p.evaluate(()=>navigator.serviceWorker.controller && navigator.serviceWorker.ready);
await p.waitForTimeout(1200);
console.log('  stays dismissed:', !(await shown()) ? '✓' : '✗ came back');

console.log('\n== the next visit, after Later ==');
await p.reload();
await p.waitForTimeout(1800);
console.log('  running the version it fetched last time:', await p.evaluate(async ()=>{
  // Stamped, so the URL is not knowable from here — find it in the cache.
  const c = await caches.open('grid-collage-v1');
  const key = (await c.keys()).find((k) => k.url.includes('app.js?v='));
  const r = key ? await c.match(key) : null; const t = r ? await r.text() : '';
  return t.includes('/* v2 */') ? 'v2 ✓' : 'v1 ✗';}));
console.log('  nothing left to offer:', !(await shown()) ? '✓' : '✗ still offering');

console.log('\n== a deploy taken by relaunching, with nothing asked ==');
version = 3;
await p.reload();
await p.waitForTimeout(1800);
console.log('  straight onto the new build:', await p.evaluate(async ()=>{
  const c = await caches.open('grid-collage-v1');
  const key = (await c.keys()).find((k) => k.url.includes('app.js?v='));
  const r = key ? await c.match(key) : null; const t = r ? await r.text() : '';
  return t.includes('/* v3 */') ? 'v3 ✓' : t.includes('/* v2 */') ? 'v2 ✗' : 'v1 ✗';}));
console.log('  and nothing to ask about:', !(await shown()) ? '✓' : '✗ offered anyway');

console.log('\n== another deploy, then Update ==');
version = 4;
// A fresh page means the once-a-minute check starts clean, so coming back
// to it looks again.
await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
await p.waitForFunction(()=>!document.getElementById('update-toast').hidden, {timeout:9000})
  .then(()=>console.log('  offered: ✓')).catch(()=>console.log('  offered: ✗'));
const before = await p.evaluate(()=>performance.timeOrigin);
await p.click('#ut-now');
await p.waitForFunction((t)=>performance.timeOrigin > t, before, {timeout:9000})
  .then(()=>console.log('  the app reloaded: ✓'))
  .catch(()=>console.log('  the app reloaded: ✗'));
await p.waitForTimeout(1500);
console.log('  cache now holds:', await p.evaluate(async ()=>{
  // Stamped, so the URL is not knowable from here — find it in the cache.
  const c = await caches.open('grid-collage-v1');
  const key = (await c.keys()).find((k) => k.url.includes('app.js?v='));
  const r = key ? await c.match(key) : null; const t = r ? await r.text() : '';
  return t.includes('/* v4 */') ? 'v4 ✓' : t.includes('/* v3 */') ? 'v3 ✗' : 'older ✗';}));
console.log('  toast gone after updating:', !(await shown()) ? '✓' : '✗');

console.log('\n== offline still works ==');
await ctx.setOffline(true);
await p.reload().catch(()=>{});
await p.waitForTimeout(1200);
console.log('  app still loads:', await p.evaluate(()=>!!document.getElementById('canvas')) ? '✓' : '✗');
await ctx.setOffline(false);

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
