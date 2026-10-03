/* A photo on a slide with a clip goes out at full resolution, as it does on a
   slide without one.

   A still slide reads every photo's original back before it is drawn. A video
   slide did not: it was composed from whatever happened to be decoded, which
   is the 1440px proxy at best, and for a slide more than one away from the
   one on screen the 384px thumbnail the tray drops it to. Exported from the
   end of the deck, the photo beside a clip came out an upscaled thumbnail.

   The photo here is a 4032×3024 checkerboard of 12px squares. On a 2×1 slide
   at 1080 each square lands about four pixels across: the original and the
   proxy both hold it, the thumbnail cannot, and averages it to grey. So how
   much contrast survives in the exported frame says which one was drawn. The
   same slide is exported twice — once from three pages away, once from itself
   with its originals read — and the two have to agree. The file is read back
   with ffmpeg, because this Chromium cannot decode H.264. */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

function png(w,h,at){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){const [r,g,b]=at(x,y);raw[o+1+x*3]=r;raw[o+2+x*3]=g;raw[o+3+x*3]=b;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const BLACK=[20,20,20], WHITE=[235,235,235];
const checker={name:'checker.png',mimeType:'image/png',
  buffer:png(4032,3024,(x,y)=>((Math.floor(x/12)+Math.floor(y/12))%2?WHITE:BLACK))};
const clip={name:'clip.webm',mimeType:'video/webm',buffer:fs.readFileSync(path.join(ROOT,'tests/fixtures/clip.webm'))};

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,acceptDownloads:true});
const p=await ctx.newPage();
// No share sheet, as on a desktop, so the export arrives as a download.
await p.addInitScript(()=>{ Object.defineProperty(navigator,'canShare',{value:undefined}); });
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);

const count=(n)=>p.waitForFunction((n)=>document.getElementById('photos-count').textContent===String(n),n,{timeout:30000});
const rest=()=>p.waitForFunction(()=>document.getAnimations().every((a)=>a.playState!=='running'));

// The clip on the left of a 2×1, the checkerboard into the gap beside it, then
// three empty slides after it, so the first can be left far behind. Empty
// slides are not exported, so the clip's is the only file.
await p.setInputFiles('#file-input',[clip]);
await count(1);
await p.click('.chip[data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x1"]');
await p.click('#float-close');
await p.setInputFiles('#file-input',[checker]);
await count(2);
for (let i=0;i<3;i+=1) { await p.click('.film-add'); await p.waitForTimeout(300); }
await p.waitForTimeout(1500);   // for the tray to drop what is far away
await rest();

const films=()=>p.evaluate(()=>document.querySelectorAll('.film').length);
const current=()=>p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex((f)=>f.classList.contains('is-current'))+1);
console.log('  slides:', await films(), 'on', await current());

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'videophotos-'));
async function exportFirst(tag) {
  await rest();
  await p.click('#btn-export-open');
  await p.waitForTimeout(300);
  const dl=p.waitForEvent('download',{timeout:120000});
  await p.click('#btn-export');
  await p.click('#export-share',{timeout:180000});
  const saved=await dl;
  const file=path.join(dir,`${tag}-${saved.suggestedFilename()}`);
  await saved.saveAs(file);
  return file;
}

// How much of the checkerboard is left: the spread of luminance over the
// middle of the right-hand tile, a frame into the clip.
function contrast(file) {
  const { width:W, height:H } = JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v',
    '-show_entries','stream=width,height','-of','json',file]).toString()).streams[0];
  const raw=execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',file,'-frames:v','1',
    '-f','rawvideo','-pix_fmt','gray','-'],{maxBuffer:1<<28});
  let n=0,s=0,s2=0;
  for(let y=Math.round(H*0.3);y<Math.round(H*0.7);y+=1) for(let x=Math.round(W*0.62);x<Math.round(W*0.88);x+=1){
    const v=raw[y*W+x]; n+=1; s+=v; s2+=v*v; }
  const mean=s/n;
  return { size:`${W}x${H}`, sd:Math.round(Math.sqrt(s2/n-mean*mean)*10)/10, mean:Math.round(mean) };
}

console.log('== exported from three slides away ==');
const farFile=await exportFirst('far');
ok('the first slide is a video', farFile.endsWith('01.mp4'), path.basename(farFile));
const far=contrast(farFile);
console.log('  ', JSON.stringify(far));

console.log('\n== exported from the slide itself, its originals read ==');
await p.locator('.film').nth(0).click();
await p.waitForTimeout(2500);   // past the dwell, so the original is decoded
await rest();
const near=contrast(await exportFirst('near'));
console.log('  ', JSON.stringify(near));

// The checkerboard's two levels are 215 apart, so held it spreads ~100 either
// side of the mean; averaged to grey by a thumbnail it is a few levels.
ok('the photo holds its detail exported from itself', near.sd > 60, `sd ${near.sd}`);
ok('and exactly as much exported from anywhere else', far.sd > near.sd * 0.9, `sd ${far.sd} against ${near.sd}`);
ok('no unhandled error', errs.length===0, JSON.stringify(errs.slice(0,2)));

fs.rmSync(dir,{recursive:true,force:true});
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
