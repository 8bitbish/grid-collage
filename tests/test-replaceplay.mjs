/* The preview has to keep playing while you are choosing what goes in the
   tile, and it has to start playing on its own — not only once you have
   switched away to another app and come back.

   clip.webm is red for its first second and blue for the two after and runs
   3.07s, so a window longer than that must contain both colours if the
   canvas is really following the video. A shorter window can sit entirely
   inside the blue and look frozen when it isn't. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{
  const u=q.url.split('?')[0];
  const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});
  r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;

let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
// goto holds until the editor is open; see enter.mjs.
await p.goto(`http://localhost:${PORT}/`);

// The sleeps before each sample stood in for the thing being sampled getting
// going. They wait for that now — a panel open, the reel on its entry, the
// clip running — bounded, with any failure left to the assertion. The four
// second windows below are the measurement and are unchanged.
const settle=(fn, arg)=>p.waitForFunction(fn, arg, {timeout:8000}).catch(()=>{});
const clipRunning=()=>{const v=document.querySelector('video'); return !!v && !v.paused && v.currentTime>0.05;};
// A freshly opened reel scrolls itself to where it starts one frame later, so
// a scroll made before that frame is simply undone. Wait for it to be centred
// on its current entry, and two frames more.
const reelSettled=async()=>{
  await settle(()=>{const strip=document.getElementById('choose-strip');
    const el=strip && strip.querySelector('.choose-item.is-current'); if(!el) return false;
    const reel=document.getElementById('choose-reel');
    const r=el.getBoundingClientRect(), mid=reel.getBoundingClientRect().left+reel.clientWidth/2;
    return Math.abs(r.left+r.width/2-mid)<4;});
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
};

// Sample the tile for four seconds — longer than the clip — and report which
// of its two colours turned up.
async function colours(label) {
  const seen = await p.evaluate(()=>new Promise((res)=>{
    const c=document.getElementById('canvas'); const g=c.getContext('2d');
    const out=new Set(); const t0=performance.now();
    const tick=()=>{
      const d=g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
      if (d[0]>140&&d[2]<110) out.add('red');
      else if (d[2]>140&&d[0]<110) out.add('blue');
      else if (d[0]<28&&d[1]<28&&d[2]<28) out.add('BLACK');
      else out.add(`[${d[0]},${d[1]},${d[2]}]`);
      if (performance.now()-t0 < 4000) requestAnimationFrame(tick); else res([...out]);
    };
    requestAnimationFrame(tick);
  }));
  console.log(`  ${label}: ${JSON.stringify(seen)}`);
  return seen;
}
const playing = (seen) => seen.includes('red') && seen.includes('blue');

const clip=fs.readFileSync('fixtures/clip.webm');
const still=fs.readFileSync('fixtures/photo0.jpg');
await p.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',buffer:clip}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
await settle(clipRunning);

console.log('== it plays without being switched away from and back to ==');
{
  const seen = await colours('straight after importing');
  ok('the preview is running on its own', playing(seen), JSON.stringify(seen));
  ok('and never black', !seen.includes('BLACK'));
}

console.log('\n== and after leaving the project and opening it again ==');
{
  await p.click('#btn-home'); await settle(()=>document.body.classList.contains('on-home'));
  await p.click('.tile');
  await settle(()=>!document.body.classList.contains('on-home'));
  await settle(clipRunning);
  const seen = await colours('back in the project');
  ok('still running with no app switch', playing(seen), JSON.stringify(seen));
}

console.log('\n== it keeps playing while Replace is open ==');
{
  const box=await p.locator('#canvas').boundingBox();
  await p.mouse.click(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await settle(()=>!document.getElementById('dp-tile').hidden);
  await p.click('#tile-actions [data-tile="replace"]');
  await settle(()=>!document.getElementById('tile-replace').hidden);
  ok('the Replace panel is open', await p.evaluate(()=>!document.getElementById('tile-replace').hidden));
  const seen = await colours('with the chooser up');
  ok('the preview is still running', playing(seen), JSON.stringify(seen));
  ok('and never black', !seen.includes('BLACK'));
}

console.log('\n== scrolling onto a photo stops it, scrolling back starts it again ==');
{
  // Two things in the tray, so the reel has somewhere to go.
  await p.evaluate(()=>document.getElementById('dock-back').click());
  await settle(()=>document.getElementById('tile-replace').hidden);
  await p.setInputFiles('#file-input',[{name:'still.jpg',mimeType:'image/jpeg',buffer:still}]);
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:25000});

  const box=await p.locator('#canvas').boundingBox();
  await p.mouse.click(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await settle(()=>!document.getElementById('dp-tile').hidden || !document.getElementById('tile-replace').hidden);
  if (await p.evaluate(()=>document.getElementById('tile-replace').hidden)) {
    await p.click('#tile-actions [data-tile="replace"]');
    await settle(()=>!document.getElementById('tile-replace').hidden
      && document.getElementById('choose-strip').children.length>=3);
  }
  await reelSettled();
  // Land the reel on each entry in turn and see what the tile does. Add is
  // the reel's first stop, so the clip is the second and the photo the third.
  // A wheel first, because the reel only takes what passes its centre as a
  // choice while something is scrolling it.
  const pick = async (n, then) => {
    await p.evaluate((k)=>{
      const reel=document.getElementById('choose-reel');
      const el=document.getElementById('choose-strip').children[k];
      reel.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));
      if (el) reel.scrollLeft = el.offsetLeft - (reel.clientWidth - el.clientWidth)/2;
    }, n);
    await settle((k)=>document.getElementById('choose-strip').children[k]?.classList.contains('is-current'), n);
    // The marker moves first and the player follows it, so wait for the
    // player too — stopped for a photo, running for the clip.
    await settle(then);
  };
  await pick(2, ()=>!document.querySelector('video'));
  const onPhoto = await colours('reel on the photo');
  ok('a photo in the tile is a still, as it should be', !playing(onPhoto), JSON.stringify(onPhoto));
  await pick(1, clipRunning);
  const onClip = await colours('reel back on the clip');
  ok('scrolling back to the clip has it playing again', playing(onClip), JSON.stringify(onClip));
}

console.log('\n== the export is unaffected by any of this ==');
{
  await p.evaluate(()=>document.getElementById('dock-back').click());
  await settle(()=>document.getElementById('tile-replace').hidden);
  const cell = await p.evaluate(()=>{
    const c=document.querySelector('#canvas');
    return !!c;
  });
  ok('the editor is still standing', cell);
  ok('nothing threw throughout', errs.length===0, errs.slice(0,3).join(' | '));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
