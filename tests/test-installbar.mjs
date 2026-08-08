import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const OUT = SHOTS;
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8166,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const mk=(n,c)=>({name:n,mimeType:'image/png',buffer:png(500,600,c)});
const j=o=>JSON.stringify(o);

// beforeinstallprompt never fires in headless Chromium, so stand one in. It is
// an ordinary event with prompt()/userChoice on it — the app only ever calls
// those two, so a stub exercises the real path.
const fakePrompt = () => {
  const e = new Event('beforeinstallprompt');
  e.prompt = () => { window.__prompted = true; };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
};

const b=await chromium.launch({executablePath: CHROME});
const errs=[];
const open = async (opts={}) => {
  const ctx = await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
  const p = await ctx.newPage();
await autoEnter(p);
  p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
  if (opts.standalone) await p.emulateMedia({ media:'screen' });
  await p.addInitScript(({standalone}) => {
    window.__prompted = false;
    if (standalone) {
      // Pretend the app was launched from the home screen.
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }
        : real(q));
    }
  }, { standalone: !!opts.standalone });
  await p.goto('http://localhost:8166/');
  await p.waitForTimeout(400);
  return { ctx, p };
};

console.log('== the bar is not there until it has something to offer ==');
{
  const { p } = await open();
  console.log('  at load, before any prompt:', await p.evaluate(()=>document.getElementById('installbar').hidden) ? 'hidden ✓' : 'SHOWN ✗');
  await p.evaluate(fakePrompt);
  await p.waitForTimeout(200);
  console.log('  once the browser offers one :', await p.evaluate(()=>!document.getElementById('installbar').hidden) ? 'shown ✓' : 'HIDDEN ✗');
  console.log('  contents:', j(await p.evaluate(()=>({
    title: document.querySelector('.installbar-text strong').textContent,
    sub: document.querySelector('.installbar-text span').textContent,
    subFits: (()=>{const s=document.querySelector('.installbar-text span');return s.scrollWidth<=s.clientWidth+1;})(),
    action: document.getElementById('btn-install').textContent.trim(),
    dismiss: document.getElementById('btn-install-x').getAttribute('aria-label'),
    height: Math.round(document.getElementById('installbar').getBoundingClientRect().height)}))));
  await p.locator('#installbar').screenshot({path:`${OUT}/installbar.png`});

  await p.click('#btn-install');
  await p.waitForTimeout(300);
  console.log('  Install calls the browser prompt:', await p.evaluate(()=>window.__prompted) ? '✓' : '✗');
  console.log('  and the bar steps aside after:', await p.evaluate(()=>document.getElementById('installbar').hidden) ? '✓' : '✗');
}

console.log('\n== dismissing it ==');
{
  const { p } = await open();
  await p.evaluate(fakePrompt); await p.waitForTimeout(200);
  await p.click('#btn-install-x'); await p.waitForTimeout(200);
  console.log('  gone after Not now:', await p.evaluate(()=>document.getElementById('installbar').hidden) ? '✓' : '✗');
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(fakePrompt); await p.waitForTimeout(200);
  console.log('  stays gone on the next visit:', await p.evaluate(()=>document.getElementById('installbar').hidden) ? '✓' : '✗');
}

console.log('\n== once installed ==');
{
  const { p } = await open({ standalone: true });
  await p.evaluate(fakePrompt); await p.waitForTimeout(200);
  console.log('  never shown when running standalone:', await p.evaluate(()=>document.getElementById('installbar').hidden) ? '✓' : '✗');
  console.log('  the app starts at the pages:', j(await p.evaluate(()=>({
    firstThing: document.querySelector('.pagesbar').getBoundingClientRect().top}))));
}

console.log('\n== export moved into the dock ==');
{
  const { p } = await open();
  await p.setInputFiles('#file-input',[mk('a.png',[220,40,40]),mk('b.png',[40,200,90])]);
  await p.waitForFunction(()=>document.querySelectorAll('.film').length===2);
  await p.waitForTimeout(400);
  console.log('  nothing above the pages:', j(await p.evaluate(()=>({
    installbarHidden: document.getElementById('installbar').hidden,
    pagesTop: Math.round(document.querySelector('.pagesbar').getBoundingClientRect().top)}))));
  console.log('  no export in a top bar:', await p.evaluate(()=>!document.querySelector('.installbar #btn-export')) ? '✓' : '✗');
  await p.click('.dock-item[data-drawer="export"]');
  await p.waitForTimeout(300);
  console.log('  it lives in the Export drawer:', j(await p.evaluate(()=>{
    const e=document.getElementById('btn-export');
    const panel=document.getElementById('dp-export');
    const r=e.getBoundingClientRect(), pr=panel.getBoundingClientRect();
    return { inPanel: panel.contains(e), visible: r.width>0,
             fitsWithoutScrolling: panel.scrollWidth <= panel.clientWidth + 2,
             size:`${Math.round(r.width)}x${Math.round(r.height)}` };})));
  await p.locator('.dock').screenshot({path:`${OUT}/export-drawer.png`});

  const dl = p.waitForEvent('download', {timeout:6000}).catch(()=>null);
  await p.click('#btn-export');
  const got = await dl;
  await p.waitForTimeout(600);
  console.log('  and it still exports:', got ? `✓ ${got.suggestedFilename()}` : `(no download event) toast: ${await p.textContent('#toast')}`);

  // disabled with nothing to export
  const { p: p2 } = await open();
  await p2.click('.dock-item[data-drawer="export"]');
  await p2.waitForTimeout(300);
  console.log('  disabled on an empty deck:', await p2.evaluate(()=>document.getElementById('btn-export').disabled) ? '✓' : '✗');
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
