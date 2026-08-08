/* A genuine HEIC, made by libheif's own encoder, with four known quadrant
   colours so a decode can be checked against something rather than just
   "it didn't throw". */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.wasm':'application/wasm',
         '.webmanifest':'application/manifest+json','.png':'image/png'};
let served=[];
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  served.push(u);
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8201,r));
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

const heic = fs.readFileSync('fixtures/photo.heic');
console.log('the fixture:', heic.length, 'bytes,', heic.subarray(8,12).toString(), 'brand');

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8201/');
await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});

console.log('\n== nothing is fetched until a HEIC turns up ==');
served = [];
await p.setInputFiles('#file-input', [{ name:'plain.png', mimeType:'image/png',
  buffer: fs.readFileSync(path.join(ROOT,'icons/icon-192.png')) }]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:15000});
await p.waitForTimeout(500);
ok('no decoder downloaded for a PNG', !served.some(u=>u.includes('libheif')), j(served));

console.log('\n== the HEIC that started this ==');
served = [];
const t0 = Date.now();
await p.setInputFiles('#file-input', [{ name:'1000068733.jpg', mimeType:'image/jpeg', buffer: heic }]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:30000})
  .then(()=>ok('it imported', true))
  .catch(()=>ok('it imported', false, 'never arrived'));
const took = Date.now()-t0;
await p.waitForTimeout(800);
console.log('  took', took, 'ms including the one-off download');
console.log('  fetched:', j(served.filter(u=>u.includes('libheif'))));
ok('the decoder was fetched, both halves of it',
   served.some(u=>u.endsWith('libheif.js')) && served.some(u=>u.endsWith('libheif.wasm')));

console.log('\n== and it is the right picture ==');
await p.click('#btn-photos');
await p.waitForTimeout(600);
const quads = await p.evaluate(()=>{
  // By name, not by position: the library sorts by date taken, so "the last
  // one" is whatever the sort decided, not the one just imported.
  const pick = [...document.querySelectorAll('.pm-pick')]
    .find((el)=>/1000068733/.test(el.getAttribute('aria-label')||''));
  if (!pick) return { error: 'not in the library' };
  const img = pick.querySelector('img');
  if (!img.naturalWidth) return { error: 'thumbnail not loaded' };
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const g = c.getContext('2d');
  const at=(x,y)=>{const d=g.getImageData(Math.floor(x),Math.floor(y),1,1).data;return [d[0],d[1],d[2]];};
  const w=c.width, h=c.height;
  return { size:`${w}x${h}`, tl:at(w*0.25,h*0.25), tr:at(w*0.75,h*0.25), bl:at(w*0.25,h*0.75), br:at(w*0.75,h*0.75) };
});
console.log('  thumbnail:', j(quads));
const near=(got,want)=>got.every((v,i)=>Math.abs(v-want[i])<28);
ok('top left is red',    near(quads.tl,[220,40,40]),  j(quads.tl));
ok('top right is green', near(quads.tr,[40,200,90]),  j(quads.tr));
ok('bottom left is blue',near(quads.bl,[50,90,230]),  j(quads.bl));
ok('bottom right is yellow', near(quads.br,[250,200,40]), j(quads.br));
await p.locator('.pm-card').screenshot({path:`${OUT}/heic-library.png`});
await p.click('#pm-close');
await p.waitForTimeout(300);

console.log('\n== a second HEIC does not re-download it ==');
served = [];
const t1 = Date.now();
await p.setInputFiles('#file-input', [{ name:'another.heic', mimeType:'', buffer: heic }]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='3',{timeout:30000});
await p.waitForTimeout(500);
console.log('  took', Date.now()-t1, 'ms');
ok('nothing refetched', !served.some(u=>u.includes('libheif')), j(served));

console.log('\n== what actually got stored ==');
const rows = await p.evaluate(async ()=>{
  const d=await new Promise((res)=>{const q=indexedDB.open('grid-collage');q.onsuccess=()=>res(q.result);});
  const all=await new Promise((res)=>{const r=d.transaction('photos','readonly').objectStore('photos').getAll();
    r.onsuccess=()=>res(r.result);});
  // Read the first bytes back out of each stored blob.
  return Promise.all(all.map(async (r)=>{
    const head=new Uint8Array(await r.blob.slice(0,12).arrayBuffer());
    const ftyp=String.fromCharCode(...head.slice(4,8));
    return { name:r.name, type:r.blob.type,
             magic: head[0]===0xff&&head[1]===0xd8 ? 'JPEG' : (ftyp==='ftyp' ? 'HEIC' : 'other'),
             kb: Math.round(r.blob.size/1024) };
  }));
});
console.log(' ', j(rows));
ok('the HEICs were re-encoded, not kept as HEIC',
   rows.filter(r=>/heic|1000068733/.test(r.name)).every(r=>r.magic==='JPEG'), j(rows.map(r=>r.magic)));

console.log('\n== so a relaunch never needs the decoder again ==');
await p.click('#btn-home');
await p.waitForTimeout(500);
await p.reload();
await p.waitForSelector('#home-grid .tile',{timeout:10000});
served = [];
await p.click('#home-grid .tile');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:20000});
await p.waitForTimeout(1200);
ok('all three photos back', await p.evaluate(()=>document.getElementById('photos-count').textContent==='3'),
   await p.evaluate(()=>document.getElementById('photos-count').textContent));
ok('and no decoder was touched', !served.some(u=>u.includes('libheif')), j(served));

console.log('\n== offline, before it has ever been fetched ==');
{
  const c2=await b.newContext({viewport:{width:390,height:844}});
  const q=await c2.newPage();
  await q.goto('http://localhost:8201/');
  await q.click('#home-first');
  await q.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
  await c2.setOffline(true);
  await q.setInputFiles('#file-input', [{ name:'cold.heic', mimeType:'image/heic', buffer: heic }]);
  await q.waitForTimeout(2500);
  const msg = await q.evaluate(()=>document.getElementById('toast').textContent);
  console.log('  toast:', j(msg));
  ok('it says the decoder needs a connection', /connection/.test(msg), msg);
  await c2.setOffline(false);
  await c2.close();
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
