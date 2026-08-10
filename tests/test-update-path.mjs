/* An installed app carries a cached shell. A deploy lands. What does the
   next launch actually render? This is the path that has never been tested,
   and it is the one every phone takes. */
import { chromium } from 'playwright';
import { CHROME, ROOT as REPO, SHOTS } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NEW = REPO;

/* The three builds this installs before the deploy lands. They used to be read
   from /tmp/oldver/<sha>, a directory nothing in the suite created — the fourth
   hardcoded path of the kind paths.mjs exists to end, and the reason every run
   reported "✗ the old build installed" three times: the server 404'd the whole
   old shell, so no worker ever took control and there was nothing installed to
   upgrade from. The rest of the test then passed against the new build, which is
   how it stayed on the failing list looking like a deploy problem.
   Checked out from the history instead, where they have been all along. Kept
   between runs because git archive on three revisions is slower than the test. */
const OLD = path.join(import.meta.dirname, '.oldver');
const SHAS = ['9a0254a', '2d27f57', 'a480308'];
for (const sha of SHAS) {
  const dir = path.join(OLD, sha);
  if (fs.existsSync(path.join(dir, 'index.html'))) continue;
  fs.mkdirSync(dir, { recursive: true });
  // Two processes rather than a shell pipeline, so a failure names itself.
  const tar = execFileSync('git', ['archive', '--format=tar', sha], { cwd: REPO, maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar, maxBuffer: 1 << 28 });
  console.log(`checked out ${sha} into ${path.relative(REPO, dir)}`);
}
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
let ROOT=NEW;
// Read the stamp out of the source rather than writing it down here — a
// hardcoded one turns every version bump into a red test that isn't.
const WANT=(fs.readFileSync(NEW+'/index.html','utf8').match(/app\.js\?v=([^"']+)/)||[])[1];
console.log('this build is', WANT);
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0];
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('not found');return;}
  const body=fs.readFileSync(f);
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream',
    'ETag':'"'+crypto.createHash('sha1').update(body).digest('hex').slice(0,16)+'"','Cache-Control':'no-cache'});
  r.end(body);});
await new Promise(r=>srv.listen(8207,r));
let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});

for (const from of SHAS) {
  console.log(`\n=== installed on ${from}, then this deploy lands ===`);
  ROOT = path.join(OLD, from);
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
  p.on('console',m=>{ if(m.type()==='error' && !/404/.test(m.text())) errs.push('console: '+m.text().slice(0,140)); });

  // Install: load the old build and let its worker cache the shell.
  await p.goto('http://localhost:8207/');
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
  await p.waitForTimeout(1200);
  ok('the old build installed', await p.evaluate(()=>!!navigator.serviceWorker.controller));

  // Deploy.
  ROOT = NEW;
  await p.reload();
  await p.waitForTimeout(2500);

  const first = await p.evaluate(()=>({
    bg: getComputedStyle(document.body).backgroundColor,
    text: (document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,60),
    sheets: document.styleSheets.length,
  }));
  console.log('  first launch after the deploy:', JSON.stringify(first));
  console.log('  errors:', errs.length ? errs.join(' | ') : 'none');
  ok('it is not a blank screen', first.text.length > 0, JSON.stringify(first.text));
  ok('nothing threw', errs.length===0, errs.slice(0,2).join(' | '));

  // ...and the launch after that, once the worker has caught up.
  errs.length = 0;
  await p.reload();
  await p.waitForTimeout(2500);
  const second = await p.evaluate(()=>({
    text: (document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,60),
    version: (document.getElementById('home-hint')||{}).textContent,
  }));
  console.log('  second launch:', JSON.stringify(second));
  ok('still not blank', second.text.length > 0);
  ok('and it is running the new build', (second.version||'') === 'v'+WANT, second.version+' want v'+WANT);
  ok('nothing threw on the second launch either', errs.length===0, errs.slice(0,2).join(' | '));
  await ctx.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
