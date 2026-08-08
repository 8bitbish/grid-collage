/* How quickly a deploy reaches the screen, and what it costs to be quick.
   The old answer was "two launches" — the first one ran the cached build
   while downloading the new one for next time. These are the properties
   that stop it going back to that. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';

const NEW='/home/user/grid-collage';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
let ROOT=NEW;
let offline=false;
const srv=http.createServer((q,r)=>{
  if(offline){ r.destroy(); return; }
  const u=q.url.split('?')[0];
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('not found');return;}
  const body=fs.readFileSync(f);
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream',
    'ETag':'"'+crypto.createHash('sha1').update(body).digest('hex').slice(0,16)+'"','Cache-Control':'no-cache'});
  r.end(body);});
await new Promise(r=>srv.listen(8213,r));

let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };
const html=fs.readFileSync(NEW+'/index.html','utf8');
const V=(html.match(/app\.js\?v=([^"']+)/)||[])[1];

console.log('== the stamps agree with each other ==');
{
  const js=(html.match(/app\.js\?v=([^"']+)/)||[])[1];
  const css=(html.match(/styles\.css\?v=([^"']+)/)||[])[1];
  ok('app.js is stamped', !!js, js);
  ok('styles.css is stamped', !!css, css);
  ok('and both carry the same build', js===css, `${js} vs ${css}`);
  // The version on the homepage has to be the one that busted the cache. A
  // label that disagreed would claim the new build was running when it was
  // the old one — worse than showing nothing at all.
  ok('app.js reads its version off that stamp, not a second copy',
    /document\.currentScript/.test(fs.readFileSync(NEW+'/app.js','utf8')));
}

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});

console.log('\n== a deploy shows up on the first launch, not the second ==');
for (const from of ['9a0254a','2d27f57','a480308']) {
  ROOT=`/tmp/oldver/${from}`;
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.goto('http://localhost:8213/');
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
  await p.waitForTimeout(1200);

  ROOT=NEW;                                     // the deploy lands
  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(900);
  const shown=await p.evaluate(()=>(document.getElementById('home-hint')||{}).textContent);
  ok(`installed on ${from} → one launch`, shown==='v'+V, `${shown}, wanted v${V}`);
  ok(`  and nothing threw on the way`, errs.length===0, errs.slice(0,2).join(' | '));
  await ctx.close();
}

console.log('\n== being quick has not cost offline ==');
{
  ROOT=NEW;
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  await p.goto('http://localhost:8213/');
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
  await p.waitForTimeout(2000);
  offline=true;
  await p.reload({waitUntil:'load'}).catch(()=>{});
  await p.waitForTimeout(1500);
  const dark=await p.evaluate(()=>({
    text:(document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,40),
    styled:getComputedStyle(document.body).backgroundColor,
    version:(document.getElementById('home-hint')||{}).textContent,
  }));
  console.log('  with the network gone:', JSON.stringify(dark));
  ok('it still opens', dark.text.length>0);
  ok('with its stylesheet', dark.styled==='rgb(13, 13, 16)', dark.styled);
  ok('and its script', dark.version==='v'+V, dark.version);
  offline=false;
  await ctx.close();
}

console.log('\n== the cache does not collect every build ever shipped ==');
{
  ROOT='/tmp/oldver/a480308';
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  await p.goto('http://localhost:8213/');
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
  await p.waitForTimeout(1200);
  ROOT=NEW;
  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(2500);
  await p.reload({waitUntil:'load'});
  await p.waitForTimeout(2000);
  const kept=await p.evaluate(async()=>{
    const c=await caches.open('grid-collage-v1');
    return (await c.keys()).map(r=>new URL(r.url).pathname+new URL(r.url).search)
      .filter(u=>/app\.js|styles\.css/.test(u));
  });
  console.log('  cached copies of the core files:', JSON.stringify(kept));
  const appJs=kept.filter(u=>u.includes('app.js'));
  ok('one app.js per build, not one per deploy', appJs.length<=2, JSON.stringify(appJs));
  ok('and the one it is running is among them', appJs.some(u=>u.includes(V)), JSON.stringify(appJs));
  await ctx.close();
}

console.log('\n== an app left open picks it up without being told ==');
{
  ROOT=NEW;
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  await p.goto('http://localhost:8213/');
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
  await p.waitForTimeout(1800);

  fs.rmSync('/tmp/newver',{recursive:true,force:true});
  fs.cpSync(NEW,'/tmp/newver',{recursive:true});
  fs.writeFileSync('/tmp/newver/index.html',
    fs.readFileSync('/tmp/newver/index.html','utf8').replaceAll(V,'9999.99.99z'));
  ROOT='/tmp/newver';

  const t0=Date.now();
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  let took=null;
  try {
    await p.waitForFunction(()=>(document.getElementById('home-hint')||{}).textContent==='v9999.99.99z',{timeout:8000});
    took=Date.now()-t0;
  } catch { /* fell through */ }
  console.log('  after coming back to it:', took===null?'still on the old build':took+'ms');
  ok('it takes the update itself, on the homepage', took!==null, took+'ms');
  await ctx.close();
}

console.log('\n== but never out from under someone mid-edit ==');
{
  ROOT=NEW;
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  await p.goto('http://localhost:8213/');
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
  await p.waitForTimeout(1500);
  await p.click('#btn-new');
  await p.waitForTimeout(1200);
  const inProject=await p.evaluate(()=>!document.body.classList.contains('on-home'));
  ok('a project is open', inProject);

  ROOT='/tmp/newver';
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(3000);
  const after=await p.evaluate(()=>({
    stillHere:!document.body.classList.contains('on-home'),
    asked:!document.getElementById('update-toast').hidden,
  }));
  console.log('  ', JSON.stringify(after));
  ok('it does not reload out from under the editor', after.stillHere);
  ok('it asks instead', after.asked);
  await ctx.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
