/* A clip filmed on its side comes out the right way up.
   A phone films portrait by storing landscape pixels and a rotation in the
   container. The video element honours it, so the preview was always right;
   the export decodes frames itself, and drew them on their side and then
   stretched them into a box measured upright. Nothing about the preview
   shows it, which is why this reads the exported file back with ffmpeg
   rather than looking at the page.

   fixtures/rotated.mp4 is VP9 so this Chromium can decode it: 640×360 coded,
   rotated 90°, so it plays as 360×640. Upright it is red over blue with a
   120×120 white square centred at (180, 400). A 1:1 export at 1080 covers it
   at 3×, which puts the square at 360×360 from (360, 600). */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };
const red=([r,,b])=>r>200&&b<60, blue=([r,,b])=>b>200&&r<60;

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,acceptDownloads:true});
const p=await ctx.newPage();
// A desktop Chrome with a share sheet would take that route and never download.
await p.addInitScript(()=>{ Object.defineProperty(navigator,'canShare',{value:undefined}); });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);
await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});

console.log('== it arrives the right way up ==');
await p.setInputFiles('#file-input',[{name:'rotated.mp4',mimeType:'video/mp4',buffer:fs.readFileSync('fixtures/rotated.mp4')}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
await p.waitForTimeout(1200);
const shown = await p.evaluate(()=>{
  const c=document.getElementById('canvas'); const g=c.getContext('2d');
  const at=(fy)=>[...g.getImageData(Math.floor(c.width/2),Math.floor(c.height*fy),1,1).data.slice(0,3)];
  return { top:at(0.1), bottom:at(0.9), ratio:c.width/c.height };
});
console.log('  preview:', j(shown));
ok('the preview is red over blue', red(shown.top) && blue(shown.bottom), j(shown));

console.log('\n== and leaves the same way ==');
await p.click('#btn-export-open');
await p.waitForTimeout(300);
const dl=p.waitForEvent('download',{timeout:120000});
await p.click('#btn-export');
await p.click('#export-share', { timeout: 120000 });
const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rotated-')),'01.mp4');
await (await dl).saveAs(file);

const { width:W, height:H } = JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v',
  '-show_entries','stream=width,height','-of','json',file]).toString()).streams[0];
const raw=execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',file,'-frames:v','1',
  '-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:1<<28});
const px=(x,y)=>{const o=(y*W+x)*3;return [raw[o],raw[o+1],raw[o+2]];};
console.log('  export:', `${W}x${H}`);
ok('it is the square page it was asked for', W===1080 && H===1080, `${W}x${H}`);

const top=px(W/2|0, H*0.1|0), bottom=px(W/2|0, H*0.9|0);
console.log('  top', j(top), 'bottom', j(bottom));
// On its side, the colours ran left to right and both of these were red.
ok('red is on top', red(top), j(top));
ok('blue is underneath', blue(bottom), j(bottom));

let x0=W,x1=-1,y0=H,y1=-1;
for(let y=0;y<H;y+=1) for(let x=0;x<W;x+=1){const [r,g,bl]=px(x,y);
  if(r>200&&g>200&&bl>200){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
const sw=x1-x0+1, sh=y1-y0+1;
console.log('  white square:', `${sw}×${sh} at (${x0}, ${y0})`);
// Before the fix this was 202×636: turned, then squeezed by 9/16 twice over.
ok('the square is still square', Math.abs(sw/sh-1)<0.03, `${sw}×${sh}`);
ok('and the size it should be', Math.abs(sw-360)<8 && Math.abs(sh-360)<8, `${sw}×${sh}`);
ok('where it should be', Math.abs(x0-360)<8 && Math.abs(y0-600)<8, `(${x0}, ${y0})`);
ok('no unhandled error', errs.length===0, j(errs.slice(0,2)));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
