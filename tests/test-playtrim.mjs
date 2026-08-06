/* The slide plays, and the clip can be cut. Both of these are testable here
   in a way the encode is not: the fixture is a VP8 clip that is red for its
   first second and blue for the next two, so what the canvas is showing at
   any moment says exactly where in the clip the preview is. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
         '.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8210,r));
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(l,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${l}${extra?` — ${extra}`:''}`); };

function png(w,h,rgb){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=rgb[0];raw[o+1]=rgb[1];raw[o+2]=rgb[2];}}
  const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=tbl[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const body=Buffer.concat([Buffer.from(t),d]);
    const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([l,body,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}

const webm = fs.readFileSync('fixtures/clip.webm');

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8210/');
await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
await p.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',buffer:webm}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
await p.waitForTimeout(900);

// What colour the middle of the slide is right now.
const middle=()=>p.evaluate(()=>{
  const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
  return [d[0],d[1],d[2]];});
const isRed=(c)=>c[0]>150 && c[2]<90;
const isBlue=(c)=>c[2]>150 && c[0]<90;
const playhead=()=>p.evaluate(()=>{
  const v=document.querySelector('video');
  return v ? Math.round(v.currentTime*100)/100 : null;});

console.log('== the slide plays ==');
{
  const seen=[];
  for (let i=0;i<14;i++){ seen.push(await middle()); await p.waitForTimeout(200); }
  const reds=seen.filter(isRed).length, blues=seen.filter(isBlue).length;
  console.log('  colours over ~2.8s:', j(seen.map(c=>isRed(c)?'red':isBlue(c)?'blue':j(c))));
  ok('a video element is attached', await p.evaluate(()=>!!document.querySelector('video')));
  ok('it is not paused', await p.evaluate(()=>{const v=document.querySelector('video');return v && !v.paused;}));
  // Red for the first second, blue for the rest: seeing both proves the
  // canvas is following the clip rather than showing the poster.
  ok('the canvas shows the opening red', reds>0, String(reds));
  ok('and goes on to the blue', blues>0, String(blues));
  ok('so it is playing, not frozen on the poster', reds>0 && blues>0);
  ok('and it is muted, because nothing asked to hear it',
     await p.evaluate(()=>document.querySelector('video').muted));
}

console.log('\n== it loops rather than stopping at the end ==');
{
  await p.waitForTimeout(1500);
  const t1=await playhead(); await p.waitForTimeout(1800); const t2=await playhead();
  console.log('  playhead:', t1, '->', t2);
  ok('still running after the clip would have ended', t2 !== null && t2 < 3.2);
}

console.log('\n== nothing plays where it should not ==');
{
  await p.click('#btn-photos'); await p.waitForTimeout(600);
  ok('not behind the library', await p.evaluate(()=>!document.querySelector('video')));
  await p.click('#pm-close'); await p.waitForTimeout(700);
  ok('back when it closes', await p.evaluate(()=>!!document.querySelector('video')));
  await p.click('#btn-home'); await p.waitForTimeout(600);
  ok('nothing left running on the homepage', await p.evaluate(()=>!document.querySelector('video')));
  await p.click('#home-grid .tile');
  await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:15000});
  await p.waitForTimeout(1200);
  ok('and it picks up again on the way back in', await p.evaluate(()=>!!document.querySelector('video')));
}

console.log('\n== Trim is offered for a clip, and only for a clip ==');
{
  // Select the tile.
  const box = await p.locator('#canvas').boundingBox();
  await p.mouse.click(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await p.waitForTimeout(600);
  ok('the tile panel opened', await p.evaluate(()=>!document.getElementById('dp-tile').hidden));
  ok('Trim is there for a video', await p.evaluate(()=>!document.getElementById('tile-trim-btn').hidden));

  await p.click('#tile-trim-btn');
  await p.waitForTimeout(500);
  const panel = await p.evaluate(()=>({
    open: !document.getElementById('tile-trim').hidden,
    from: document.getElementById('trim-from').textContent,
    to: document.getElementById('trim-to').textContent,
    span: document.getElementById('trim-span').textContent,
  }));
  console.log('  the panel says:', j(panel));
  ok('the trim panel opened', panel.open);
  ok('and starts on the whole clip', panel.from==='0:00' && /0:03/.test(panel.to), j([panel.from,panel.to]));
  await p.screenshot({path:`${OUT}/trim-panel.png`});
}

console.log('\n== moving the start handle seeks the preview to that frame ==');
{
  // Two thirds in: well past the red, so the frame under the handle is blue.
  await p.evaluate(()=>{
    const el=document.getElementById('trim-start');
    el.value='650';
    el.dispatchEvent(new Event('pointerdown',{bubbles:true}));
    el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await p.waitForTimeout(900);
  const at = await playhead();
  const colour = await middle();
  console.log('  playhead', at, 'colour', j(colour));
  ok('the preview jumped to the handle', at > 1.6, String(at));
  ok('and is holding that frame, not running', await p.evaluate(()=>document.querySelector('video').paused));
  ok('which is past the red, so blue', isBlue(colour), j(colour));
  const read = await p.evaluate(()=>document.getElementById('trim-from').textContent);
  ok('the readout followed', read==='0:02', read);
}

console.log('\n== letting go plays the trimmed clip, from its new start ==');
{
  await p.evaluate(()=>document.getElementById('trim-start').dispatchEvent(new Event('change',{bubbles:true})));
  await p.waitForTimeout(700);
  ok('it is running again', await p.evaluate(()=>{const v=document.querySelector('video');return v && !v.paused;}));
  const seen=[];
  for (let i=0;i<10;i++){ seen.push(await playhead()); await p.waitForTimeout(200); }
  console.log('  playhead over 2s:', j(seen));
  ok('and never goes back before the cut', seen.every(t=>t===null||t>1.9), j(seen));
}

console.log('\n== the trim is on the cell, and it is remembered ==');
{
  const stored = await p.evaluate(()=>{
    const deck = JSON.parse(localStorage.getItem(
      Object.keys(localStorage).find(k=>k.startsWith('grid-collage:deck:'))));
    const cell = deck.pages[0].cells[0];
    return { t0: Math.round(cell.t0*100)/100, t1: Math.round(cell.t1*100)/100 };
  });
  console.log('  saved as:', j(stored));
  ok('the start was written down', stored.t0 > 1.6, String(stored.t0));

  await p.click('#btn-home'); await p.waitForTimeout(500);
  await p.reload();
  await p.waitForSelector('#home-grid .tile',{timeout:10000});
  await p.click('#home-grid .tile');
  await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:20000});
  await p.waitForTimeout(1500);
  const after = await p.evaluate(()=>{
    const v=document.querySelector('video');
    return v ? Math.round(v.currentTime*100)/100 : null;});
  console.log('  playhead after a relaunch:', after);
  ok('and it plays from the cut after a relaunch', after !== null && after > 1.6, String(after));
}

console.log('\n== Whole clip puts it back ==');
{
  const box = await p.locator('#canvas').boundingBox();
  await p.mouse.click(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await p.waitForTimeout(500);
  await p.click('#tile-trim-btn');
  await p.waitForTimeout(400);
  await p.click('#trim-reset');
  await p.waitForTimeout(800);
  const panel = await p.evaluate(()=>({
    from: document.getElementById('trim-from').textContent,
    disabled: document.getElementById('trim-reset').disabled,
  }));
  console.log('  back to:', j(panel));
  ok('the start is at zero again', panel.from==='0:00', panel.from);
  ok('and there is nothing left to reset', panel.disabled);
}

console.log('\n== a photo tile has no Trim ==');
{
  await p.setInputFiles('#file-input',[{name:'still.png',mimeType:'image/png',buffer:png(400,400,[40,200,90])}]);
  await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:15000});
  await p.waitForTimeout(900);
  // The trim sub-panel is still open from the block above, so the dock root
  // (and with it the layout drawer) is out of reach. Walk back to it first.
  for (let i = 0; i < 4; i++) {
    if (await p.evaluate(() => !document.getElementById('dock-root').hidden)) break;
    await p.click('#dock-back');
    await p.waitForTimeout(350);
  }
  // The slide is a full 1x1, so importing does not place the photo anywhere.
  // Open a second tile and put it there, then select that tile.
  await p.click('.dock-item[data-drawer="layout"]');
  await p.waitForTimeout(300);
  await p.click('.layout-btn:nth-child(2)');
  await p.waitForTimeout(600);
  await p.click('#btn-photos');
  await p.waitForTimeout(500);
  await p.click('.pm-pick[aria-label*="still.png"]');
  await p.waitForTimeout(700);
  await p.click('#pm-close').catch(()=>{});
  await p.waitForTimeout(500);
  const box = await p.locator('#canvas').boundingBox();
  // The right-hand tile, which is the photo.
  await p.mouse.click(Math.round(box.x+box.width*0.75), Math.round(box.y+box.height/2));
  await p.waitForTimeout(700);
  console.log('  selected tile holds:', await p.evaluate(()=>{
    const el=document.querySelector('#tile-actions'); return el && !document.getElementById('dp-tile').hidden ? 'a tile' : 'nothing';}));
  const hidden = await p.evaluate(()=>document.getElementById('tile-trim-btn').hidden);
  console.log('  Trim hidden on a photo tile:', hidden);
  ok('Trim is not offered for a still', hidden);
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
