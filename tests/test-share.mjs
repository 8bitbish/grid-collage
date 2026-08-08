import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('not found');return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8138,r));

const _pages = (pg) => pg.evaluate(()=>document.querySelectorAll('.film').length);
const _photos = (pg) => pg.evaluate(()=>document.querySelectorAll('.pm-item').length);
const _current = (pg) => pg.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1);
const _openDrawer = (pg, name) => pg.click(`.dock-item[data-drawer="${name}"]`);
function png(w,h,[r0,g0,b0]){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=r0;raw[o+2+x*3]=g0;raw[o+3+x*3]=b0;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const files=[[220,40,40],[40,200,90],[50,90,230]].map((c,i)=>({name:`gallery-${i}.png`,mimeType:'image/png',buffer:png(600,800,c)}));

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:1200,height:900}});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));

await p.goto('http://localhost:8138/');
// manifest must actually declare the share target
const st = await p.evaluate(async () => {
  const res = await fetch(document.querySelector('link[rel=manifest]').href);
  const m = await res.json();
  return m.share_target;
});
console.log('manifest share_target:', JSON.stringify(st));

// service worker must be in control before it can answer the POST
await p.evaluate(()=>navigator.serviceWorker.ready);
await p.reload();
await p.waitForFunction(()=>navigator.serviceWorker.controller!==null,null,{timeout:15000});
console.log('service worker controlling:', await p.evaluate(()=>!!navigator.serviceWorker.controller));

// build and submit a real multipart POST navigation, like the OS share sheet does
await p.evaluate(() => {
  const f = document.createElement('form');
  f.id = 'sharef'; f.method = 'POST'; f.action = './share-target'; f.enctype = 'multipart/form-data';
  const i = document.createElement('input');
  i.type = 'file'; i.name = 'photos'; i.multiple = true; i.id = 'sharefiles';
  f.appendChild(i); document.body.appendChild(f);
});
await p.setInputFiles('#sharefiles', files);
await Promise.all([
  p.waitForNavigation({ waitUntil: 'load' }),
  p.evaluate(() => document.getElementById('sharef').submit()),
]);
console.log('landed on:', (await p.url()).replace('http://localhost:8138',''));

await p.waitForFunction(()=>document.querySelectorAll('.pm-item').length===3,null,{timeout:30000});
console.log('✓ photos imported from the share:', await _photos(p));
console.log('✓ pages built:', await _pages(p));

const rendered = await p.evaluate(()=>{const c=document.getElementById('canvas');const g=c.getContext('2d');
  const d=g.getImageData(c.width*0.5,c.height*0.5,1,1).data;return `${d[0]},${d[1]},${d[2]}`;});
console.log('✓ first page renders the shared photo:', rendered, rendered==='220,40,40'?'(correct one)':'(UNEXPECTED)');

console.log('✓ url cleaned of ?share:', !(await p.url()).includes('share') ? 'yes' : 'NO');
const inbox = await p.evaluate(async()=>{ const c=await caches.open('grid-collage-share-inbox'); return (await c.keys()).length; });
console.log('✓ inbox drained after import:', inbox, inbox===0?'(empty)':'(LEFTOVERS)');

// what's actually stored?
console.log('stored deck before reload:', await p.evaluate(()=>{
  const raw = localStorage.getItem('grid-collage:deck');
  if (!raw) return 'NOTHING IN localStorage';
  const d = JSON.parse(raw);
  return `${d.pages.length} pages, current ${d.current}`;
}));

// a reload must not re-import
await p.reload();
await p.waitForFunction(()=>document.querySelectorAll('.pm-item').length>0,null,{timeout:20000});
console.log('✓ after reload (no re-import):', await _photos(p), 'photos,', await _pages(p), 'pages');

// the shell cache survived the share
const caches_ = await p.evaluate(async()=>(await caches.keys()));
console.log('✓ caches present:', caches_.join(', '));

console.log(errs.length?'✗ ERRORS:\n'+errs.join('\n'):'✓ no page errors');
await b.close(); srv.close();
