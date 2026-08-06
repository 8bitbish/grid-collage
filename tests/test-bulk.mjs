/* Selecting a folder's worth of files at once. What it costs while it runs
   and what it leaves behind — decoders held, decoded pixels held — because
   both of those are what kills a tab on a phone rather than a desktop. */
import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT='/home/user/grid-collage';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0];
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});
  r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8229,r));

let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

// Counts every decoder and every decoded bitmap the page makes, and every one
// it gives back. Installed before the app runs.
const METERS = () => {
  window.__made = 0;
  window.__live = new Set();
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) {
    const el = create.call(this, tag, ...rest);
    if (String(tag).toLowerCase() === 'video') { window.__made++; window.__live.add(new WeakRef(el)); }
    return el;
  };
  // Decoded pixels are not on the JS heap and do not show up in any figure
  // the page can read, so they are counted as they are made and unmade.
  window.__px = 0; window.__peakPx = 0; window.__bitmaps = 0; window.__bm = [];
  const cib = window.createImageBitmap;
  window.createImageBitmap = async function (...a) {
    const bm = await cib.apply(this, a);
    const n = bm.width * bm.height * 4;
    bm.__n = n; window.__px += n; window.__bitmaps++;
    window.__bm.push({ ref: new WeakRef(bm), edge: Math.max(bm.width, bm.height) });
    if (window.__px > window.__peakPx) window.__peakPx = window.__px;
    return bm;
  };
  // The largest thing still decoded and not closed — how the test tells a
  // page that has been read back up to size from one still on its thumbnail.
  window.__biggestLive = () => window.__bm
    .filter((r) => { const b = r.ref.deref(); return b && b.__n; })
    .reduce((m, r) => Math.max(m, r.edge), 0);
  const close = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function () {
    if (this.__n) { window.__px -= this.__n; this.__n = 0; }
    return close.call(this);
  };
};

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});

async function bulk(label, files) {
  const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
  const p=await ctx.newPage();
  await autoEnter(p);
  await p.addInitScript(METERS);
  let dead=false; const errs=[];
  p.on('crash',()=>{dead=true;});
  p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.goto('http://localhost:8229/');
  await p.waitForTimeout(1400);

  const t0=Date.now();
  await p.setInputFiles('#file-input', files);
  let finished=true;
  try {
    await p.waitForFunction((n)=>document.getElementById('photos-count').textContent===String(n),
      files.length, {timeout:180000});
  } catch { finished=false; }
  const secs=((Date.now()-t0)/1000).toFixed(1);
  await p.waitForTimeout(2500);
  // Give anything unreferenced a chance to go before counting what is held.
  await p.evaluate(()=>{ const junk=[]; for(let i=0;i<40;i++) junk.push(new ArrayBuffer(1e6)); junk.length=0; });
  await p.waitForTimeout(2500);

  const m = dead ? null : await p.evaluate(()=>({
    decodersMade: window.__made,
    decodersHeld: [...window.__live].map(r=>r.deref()).filter(Boolean).length,
    heldMB: +(window.__px/1048576).toFixed(0),
    peakMB: +(window.__peakPx/1048576).toFixed(0),
    bitmaps: window.__bitmaps,
    biggestLiveEdge: window.__biggestLive(),
    count: document.getElementById('photos-count').textContent,
  })).catch(()=>null);
  console.log(`  ${label}: ${secs}s ${JSON.stringify(m)}${dead?' *** CRASHED ***':''}`);
  return { p, ctx, m, dead, finished, errs, secs:+secs };
}

// Passed as paths, not buffers: Playwright refuses to inline more than 50MB
// and two dozen 12MP photos is well past that.
const STAGE='/tmp/bulkstage';
fs.rmSync(STAGE,{recursive:true,force:true}); fs.mkdirSync(STAGE,{recursive:true});
const stage=(name, from)=>{ const to=path.join(STAGE,name);
  if(!fs.existsSync(to)) fs.copyFileSync(from,to); return to; };
const clips = (n) => Array.from({length:n},(_,i)=>
  stage(`clip${i}.webm`, `fixtures/many/clip${i%12}.webm`));
const photos = (n) => Array.from({length:n},(_,i)=>
  stage(`photo${i}.jpg`, `fixtures/photo${i%12}.jpg`));

console.log('== 40 clips at 1080x1920 ==');
{
  const r = await bulk('40 clips', clips(40));
  ok('it survives', !r.dead);
  ok('all forty arrive', r.finished, r.m && r.m.count);
  // One decoder is the preview player; the rest were frame grabs and must
  // have been handed back.
  ok('it is not holding a decoder per clip', r.m && r.m.decodersHeld <= 4,
    r.m && `${r.m.decodersHeld} held of ${r.m.decodersMade} made`);
  // 40 posters at full size would be 330MB. At proxy size it is a fraction.
  // Was 316MB held, 321MB peak, before any of this.
  ok('and not holding a full-size poster per clip', r.m && r.m.heldMB < 60,
    r.m && `${r.m.heldMB}MB held`);
  ok('nor spiking on the way there', r.m && r.m.peakMB < 120, r.m && `peak ${r.m.peakMB}MB`);
  ok('nothing threw', r.errs.length===0, r.errs.slice(0,2).join(' | '));
  await r.ctx.close();
}

console.log('\n== 24 photos, 12MP each ==');
{
  const r = await bulk('24 photos', photos(24));
  ok('it survives', !r.dead);
  ok('all twenty-four arrive', r.finished, r.m && r.m.count);
  // 24 twelve-megapixel photos held at full size is 1.1GB of pixels.
  // Was 1116MB held, 1134MB peak. That is the crash.
  ok('it is not holding every photo at full size', r.m && r.m.heldMB < 120,
    r.m && `${r.m.heldMB}MB held`);
  ok('nor spiking on the way there', r.m && r.m.peakMB < 220, r.m && `peak ${r.m.peakMB}MB`);
  ok('nothing threw', r.errs.length===0, r.errs.slice(0,2).join(' | '));
  await r.ctx.close();
}

console.log('\n== a mixed pile, the way a camera roll actually is ==');
{
  const mix = [];
  const ph=photos(12), cl=clips(12);
  for (let i=0;i<12;i++){ mix.push(ph[i]); mix.push(cl[i]); }
  const r = await bulk('12 photos + 12 clips', mix);
  ok('it survives', !r.dead);
  ok('all twenty-four arrive', r.finished, r.m && r.m.count);
  ok('decoders handed back', r.m && r.m.decodersHeld <= 4,
    r.m && `${r.m.decodersHeld} held of ${r.m.decodersMade} made`);
  // Was 653MB held, 661MB peak.
  ok('pixels held stay sane', r.m && r.m.heldMB < 120, r.m && `${r.m.heldMB}MB`);
  ok('and the spike with them', r.m && r.m.peakMB < 180, r.m && `peak ${r.m.peakMB}MB`);
  ok('nothing threw', r.errs.length===0, r.errs.slice(0,2).join(' | '));

  // And the deck it built is usable.
  const pages = await r.p.evaluate(()=>document.querySelectorAll('.film').length);
  console.log('  pages built:', pages);
  ok('it laid them out', pages > 1, String(pages));
  await r.ctx.close();
}

console.log('\n== a slide far down the deck is read back up when you reach it ==');
{
  // Twenty photos, so the last page is well outside anything kept at size.
  const r = await bulk('20 photos', photos(20));
  const resting = r.m.biggestLiveEdge;
  console.log('  biggest thing decoded while sitting on page 1:', resting);

  // Swipe to the end and let it settle.
  await r.p.evaluate(()=>{const f=document.querySelectorAll('.film'); f[f.length-1].click();});
  await r.p.waitForTimeout(3000);
  const arrived = await r.p.evaluate(()=>window.__biggestLive());
  const drawn = await r.p.evaluate(()=>{
    const c=document.getElementById('canvas'); const g=c.getContext('2d');
    // Not blank, and not the page background either.
    const d=g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
    return { w:c.width, painted: !(d[0]===255&&d[1]===255&&d[2]===255) };
  });
  console.log('  after arriving at the last page:', arrived, JSON.stringify(drawn));
  ok('the last page is actually drawn', drawn.painted && drawn.w>0);
  ok('and it was read back up to size, not left on a thumbnail',
    arrived >= 1000, `biggest live edge ${arrived}px`);
  ok('nothing threw', r.errs.length===0, r.errs.slice(0,2).join(' | '));
  await r.ctx.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
