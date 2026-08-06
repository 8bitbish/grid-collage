/* Video, as far as this environment can take it.
   Playwright's Chromium has no WebCodecs and cannot decode H.264, so the
   encode itself is out of reach here — see probe-video.mjs. What IS testable
   is everything around it, and that a deck of photos never pays for any of
   it. The fixture is VP8/WebM because that is what this browser can play. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
let served=[];
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  served.push(u);
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8205,r));
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

function png(w,h,rgb){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=rgb[0];raw[o+1]=rgb[1];raw[o+2]=rgb[2];}}
  const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=tbl[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const body=Buffer.concat([Buffer.from(t),d]);
    const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([l,body,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}

const webm = fs.readFileSync('fixtures/clip.webm');   // red for 1s, then blue
const mp4  = fs.readFileSync('fixtures/clip.mp4');    // H.264 — unplayable here

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8205/');
await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});

console.log('== the doors video has to come through ==');
// The whole pipeline is useless if the picker never offers a clip, which is
// exactly what shipped the first time: everything handled video except the
// one attribute that lets it be chosen.
{
  const accept = await p.evaluate(()=>document.getElementById('file-input').getAttribute('accept'));
  console.log('  file picker accepts:', j(accept));
  ok('the picker offers video', /video\/\*/.test(accept || ''), accept);

  const share = await p.evaluate(async ()=>{
    const res = await fetch('./manifest.webmanifest');
    const m = await res.json();
    return m.share_target.params.files[0].accept;
  });
  console.log('  share sheet accepts:', j(share));
  ok('the share sheet offers the app for a video', share.includes('video/*'), j(share));
  ok('and for the types a phone actually hands over',
     share.includes('video/mp4') && share.includes('video/quicktime'), j(share));
}

console.log('\n== a video imports like anything else ==');
served=[];
await p.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',buffer:webm}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000})
  .then(()=>ok('it got in', true)).catch(()=>ok('it got in', false, 'never arrived'));
await p.waitForTimeout(600);
ok('nothing was downloaded to do it', !served.some(u=>u.includes('mediabunny')), j(served.filter(u=>u.includes('vendor'))));

const rec = await p.evaluate(async ()=>{
  const d=await new Promise((res)=>{const q=indexedDB.open('grid-collage');q.onsuccess=()=>res(q.result);});
  const all=await new Promise((res)=>{const r=d.transaction('photos','readonly').objectStore('photos').getAll();
    r.onsuccess=()=>res(r.result);});
  const v=all[0];
  return { kind:v.kind, duration:Math.round((v.duration||0)*10)/10, w:v.w, h:v.h,
           storedType:v.blob.type, storedKB:Math.round(v.blob.size/1024),
           thumbKB:Math.round(v.thumb.size/1024) };
});
console.log('  stored as:', j(rec));
ok('kept as a video', rec.kind==='video');
ok('with its length', rec.duration>2.5 && rec.duration<3.5, String(rec.duration));
ok('at its own size', rec.w===640 && rec.h===640, `${rec.w}x${rec.h}`);
ok('the original file untouched', rec.storedType==='video/webm', rec.storedType);
ok('and a poster thumbnail beside it', rec.thumbKB>0 && rec.thumbKB<80, `${rec.thumbKB}KB`);

console.log('\n== the poster is frame one, not any old frame ==');
await p.click('#btn-photos');
await p.waitForTimeout(600);
const tile = await p.evaluate(()=>{
  const el=document.querySelector('.pm-item');
  const img=el.querySelector('img');
  const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
  c.getContext('2d').drawImage(img,0,0);
  const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
  return { colour:[d[0],d[1],d[2]], clip: (el.querySelector('.pm-clip')||{}).textContent,
           marked: el.classList.contains('is-video') };
});
console.log('  library tile:', j(tile));
// The clip opens red and turns blue after a second.
ok('the poster is the opening frame, red', Math.abs(tile.colour[0]-220)<40 && tile.colour[2]<80, j(tile.colour));
ok('it is marked as a video', tile.marked);
ok('and shows how long it runs', /^0:0[23]$/.test(tile.clip||''), tile.clip);
await p.locator('.pm-card').screenshot({path:`${OUT}/video-library.png`});
await p.click('#pm-close');
await p.waitForTimeout(300);

console.log('\n== it composes like a photo ==');
ok('drawn on the slide', await p.evaluate(()=>{
  const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
  return Math.abs(d[0]-220)<40 && d[2]<80;}));
// Into a collage, with a photo beside it.
await p.setInputFiles('#file-input',[{name:'still.png',mimeType:'image/png',buffer:png(400,400,[40,200,90])}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:15000});
await p.waitForTimeout(500);
await p.click('.dock-item[data-drawer="layout"]');
await p.waitForTimeout(300);
await p.click('.layout-btn:nth-child(2)');     // 2x1: video left, empty right
await p.waitForTimeout(700);
// Changing the layout opens a slot; it does not fill it. Put the photo in
// the way a person would.
await p.click('#btn-photos');
await p.waitForTimeout(500);
await p.click('.pm-pick[aria-label*="still.png"]');
await p.waitForTimeout(700);
await p.click('#pm-close').catch(()=>{});
await p.waitForTimeout(400);
const pair = await p.evaluate(()=>{
  const c=document.getElementById('canvas'); const g=c.getContext('2d');
  const at=(fx)=>{const d=g.getImageData(Math.floor(c.width*fx),Math.floor(c.height/2),1,1).data;return [d[0],d[1],d[2]];};
  return { left:at(0.25), right:at(0.75) };
});
console.log('  side by side:', j(pair));
ok('video on the left', Math.abs(pair.left[0]-220)<45, j(pair.left));
ok('photo on the right', pair.right[1]>150 && pair.right[0]<90, j(pair.right));
await p.screenshot({path:`${OUT}/video-collage.png`});

console.log('\n== it survives a relaunch ==');
await p.click('#btn-home');
await p.waitForTimeout(500);
await p.reload();
await p.waitForSelector('#home-grid .tile',{timeout:10000});
served=[];
await p.click('#home-grid .tile');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:20000});
await p.waitForTimeout(900);
ok('both back', await p.evaluate(()=>document.getElementById('photos-count').textContent==='2'),
   await p.evaluate(()=>document.getElementById('photos-count').textContent));
ok('still known to be a video', await p.evaluate(async ()=>{
  const d=await new Promise((res)=>{const q=indexedDB.open('grid-collage');q.onsuccess=()=>res(q.result);});
  const all=await new Promise((res)=>{const r=d.transaction('photos','readonly').objectStore('photos').getAll();
    r.onsuccess=()=>res(r.result);});
  return all.some(x=>x.kind==='video');}));
ok('and opening it downloaded no decoder', !served.some(u=>u.includes('mediabunny')), j(served));
ok('the slide still draws', await p.evaluate(()=>{
  const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(Math.floor(c.width*0.25),Math.floor(c.height/2),1,1).data;
  return Math.abs(d[0]-220)<45;}));

console.log('\n== exporting a deck with no video touches none of it ==');
{
  const c2=await b.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  const q=await c2.newPage();
  await q.goto('http://localhost:8205/');
  await q.click('#home-first');
  await q.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
  await q.setInputFiles('#file-input',[{name:'a.png',mimeType:'image/png',buffer:png(400,400,[200,60,60])}]);
  await q.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:15000});
  await q.waitForTimeout(400);
  served=[];
  await q.click('.dock-item[data-drawer="export"]'); await q.waitForTimeout(300);
  const dl = q.waitForEvent('download',{timeout:30000}).catch(()=>null);
  await q.click('#btn-export');
  await dl;
  await q.waitForTimeout(800);
  ok('mediabunny never fetched for a photo deck', !served.some(u=>u.includes('mediabunny')), j(served));
  await c2.close();
}

console.log('\n== exporting a video deck, in a browser that cannot encode ==');
// The point here is not that it works — it cannot, there is no WebCodecs in
// this build — but that it fails the way it is meant to: the decoder is
// asked for, the failure is caught, and a still goes out in its place rather
// than the slide vanishing.
served=[];
await p.click('.dock-item[data-drawer="export"]');
await p.waitForTimeout(300);
await p.click('#btn-export');
await p.waitForTimeout(9000);
const after = await p.evaluate(()=>({
  toast: document.getElementById('toast').textContent,
  opening: document.getElementById('opening').hidden,
}));
console.log('  asked for:', j(served.filter(u=>u.includes('vendor'))));
console.log('  ended with:', j(after));
ok('it did reach for the encoder', served.some(u=>u.includes('mediabunny')), j(served.filter(u=>u.includes('vendor'))));
ok('the progress overlay was put away', after.opening);
ok('and it said the slide went out as a still', /still/i.test(after.toast), after.toast);
ok('no unhandled error', errs.length===0, j(errs.slice(0,2)));

console.log('\n== an H.264 mp4, which this browser cannot even play ==');
{
  await p.click('#btn-home').catch(()=>{});
  await p.waitForTimeout(400);
  await p.click('#btn-new');
  await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:10000});
  await p.setInputFiles('#file-input',[{name:'clip.mp4',mimeType:'video/mp4',buffer:mp4}]);
  await p.waitForTimeout(3000);
  const msg = await p.evaluate(()=>document.getElementById('toast').textContent);
  const count = await p.evaluate(()=>document.getElementById('photos-count').textContent);
  console.log('  count:', count, '| toast:', j(msg));
  // Whatever happens it must be a clean, explained refusal — never a crash.
  ok('handled without an error', errs.length===0, j(errs.slice(0,2)));
  // On a phone this imports. Here it cannot, and the only acceptable
  // outcome is being told exactly that.
  ok('either it imported or it said the browser cannot play it',
     count==='1' || /can't play/.test(msg), `${count} / ${msg}`);
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
