/* Where do shared photos land? Three routes: into the project you already
   have open, into the only one there could be, and — the new one — into
   whichever tile you tap. Driven through the real service worker share
   target, so the files arrive the way the phone delivers them. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8198,r));
const j=o=>JSON.stringify(o);
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

function png(w,h,rgb){
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;
    raw[o]=rgb[0];raw[o+1]=rgb[1];raw[o+2]=rgb[2];}}
  const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=tbl[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const body=Buffer.concat([Buffer.from(t),d]);
    const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([l,body,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const file=(n,rgb)=>({name:n,mimeType:'image/png',buffer:png(500,500,rgb)});

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));

await p.goto('http://localhost:8198/');
await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
await p.waitForTimeout(600);
ok('the worker is in charge, so the share target works',
   await p.evaluate(()=>!!navigator.serviceWorker.controller));

// A real multipart form POST that the browser navigates, which is exactly
// what the phone's share sheet does — not a fetch. It matters: the navigation
// reloads the app, so nothing survives from before the share.
const goShare = async (names, rgbs) => {
  await Promise.all([
    p.waitForNavigation({ timeout: 20000 }).catch(()=>{}),
    p.evaluate(async ([names, rgbs]) => {
      const dt = new DataTransfer();
      for (let i = 0; i < names.length; i += 1) {
        const c = document.createElement('canvas'); c.width = c.height = 200;
        const g = c.getContext('2d');
        g.fillStyle = `rgb(${rgbs[i].join(',')})`; g.fillRect(0, 0, 200, 200);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        dt.items.add(new File([blob], names[i], { type: 'image/png' }));
      }
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'share-target';
      form.enctype = 'multipart/form-data';
      const input = document.createElement('input');
      input.type = 'file'; input.name = 'photos'; input.multiple = true;
      input.files = dt.files;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    }, [names, rgbs]),
  ]);
  await p.waitForTimeout(1600);
};

console.log('\n== nothing to choose between: it just makes one ==');
await goShare(['s1.png'], [[220, 40, 40]]);
ok('landed in the editor, not on the grid',
   await p.evaluate(()=>!document.body.classList.contains('on-home')));
ok('no chooser was shown', await p.evaluate(()=>document.getElementById('sharebar').hidden));
ok('the photo is in', await p.evaluate(()=>document.getElementById('photos-count').textContent==='1'),
   await p.evaluate(()=>document.getElementById('photos-count').textContent));

console.log('\n== sharing from inside a project ==');
// The share target is a POST the browser navigates to, so the app reloads
// however it was left — there is no "still open" project to fall back on.
// That is why the chooser has to exist rather than being a nicety.
await goShare(['s2.png'], [[40, 200, 90]]);
console.log('  after the share we are on:',
  await p.evaluate(()=>document.body.classList.contains('on-home') ? 'the grid' : 'the editor'));
ok('it asks even with one carousel — "join it" or "start another" is the question',
   await p.evaluate(()=>!document.getElementById('sharebar').hidden));
await p.click('#home-grid .tile');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:12000});
await p.waitForTimeout(1400);
ok('tapping the one carousel put them in it',
   await p.evaluate(()=>document.getElementById('photos-count').textContent==='2'),
   await p.evaluate(()=>document.getElementById('photos-count').textContent));
ok('and made no second project', await p.evaluate(()=>
  JSON.parse(localStorage.getItem('grid-collage:projects')).length===1));

console.log('\n== a second carousel, then a share from the grid ==');
await p.click('#btn-home');
await p.waitForTimeout(400);
await p.click('#btn-new');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});
await p.setInputFiles('#file-input',[file('own.png',[50,90,230])]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:15000});
await p.waitForTimeout(500);
await p.click('#btn-home');
await p.waitForTimeout(500);
ok('two carousels now', await p.evaluate(()=>document.querySelectorAll('#home-grid .tile').length===2));

const wasBefore = await p.evaluate(()=>JSON.parse(localStorage.getItem('grid-collage:projects'))
  .map(x=>({name:x.name, photos:x.photos})));
console.log('  before the share:', j(wasBefore));
await goShare(['pick1.png','pick2.png'], [[255,180,0],[10,10,10]]);
ok('this time it stops on the grid', await p.evaluate(()=>document.body.classList.contains('on-home')));
ok('and asks', await p.evaluate(()=>!document.getElementById('sharebar').hidden));
console.log('  the bar says:', j(await p.evaluate(()=>document.getElementById('share-count').textContent)));
ok('counting what is waiting',
   /Add 2 photos to/.test(await p.evaluate(()=>document.getElementById('share-count').textContent)));
ok('the tiles are marked as targets', await p.evaluate(()=>document.body.classList.contains('is-picking')));
console.log('  the hint says:', j(await p.evaluate(()=>document.getElementById('home-hint').textContent)));
await p.screenshot({path:`${OUT}/share-pick.png`});

console.log('\n== the hold is off while it is asking ==');
{
  const box=await p.locator('#home-grid .tile').first().boundingBox();
  await p.mouse.move(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await p.mouse.down();
  await p.waitForTimeout(700);
  const opened = await p.evaluate(()=>!document.getElementById('detail').hidden);
  await p.mouse.up();
  await p.waitForTimeout(1600);
  ok('no details sheet came up', !opened);
  // ...and that same press counted as the tap that places them.
  ok('the press placed them instead', await p.evaluate(()=>!document.body.classList.contains('on-home')));
}
const where = await p.evaluate(()=>({
  photos: Number(document.getElementById('photos-count').textContent),
  films: document.querySelectorAll('.film').length,
}));
// The tile I pressed was the first one, which is whichever project was
// touched most recently — the list is ordered by that.
const target = wasBefore[0];
console.log('  landed in:', j(where), '| expected', target.name, 'at', target.photos, '+ 2');
ok('the tapped carousel got both', where.photos === target.photos + 2,
   `${target.photos} -> ${where.photos}`);

console.log('\n== the other carousel is untouched ==');
await p.click('#btn-home');
await p.waitForTimeout(600);
const counts = await p.evaluate(()=>JSON.parse(localStorage.getItem('grid-collage:projects'))
  .map(x=>({name:x.name, photos:x.photos})));
console.log(' ', j(counts));
const other = wasBefore[1];
const otherNow = counts.find(c=>c.name===other.name);
ok('the one I did not tap is exactly as it was',
   otherNow && otherNow.photos === other.photos, `${other.photos} -> ${otherNow && otherNow.photos}`);
ok('and the one I did tap gained the two',
   counts.find(c=>c.name===target.name).photos === target.photos + 2);

console.log('\n== New carousel takes them instead ==');
await goShare(['n1.png'], [[120, 20, 200]]);
ok('asked again', await p.evaluate(()=>!document.getElementById('sharebar').hidden));
await p.click('#share-new');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:10000});
await p.waitForTimeout(1200);
ok('a third carousel, holding just that photo',
   await p.evaluate(()=>document.getElementById('photos-count').textContent==='1'),
   await p.evaluate(()=>document.getElementById('photos-count').textContent));
ok('three projects now', await p.evaluate(()=>
  JSON.parse(localStorage.getItem('grid-collage:projects')).length===3));

console.log('\n== Discard ==');
await p.click('#btn-home');
await p.waitForTimeout(400);
await goShare(['d1.png','d2.png'], [[0,120,120],[200,200,0]]);
ok('asked', await p.evaluate(()=>!document.getElementById('sharebar').hidden));
const before = await p.evaluate(()=>JSON.parse(localStorage.getItem('grid-collage:projects')).map(x=>x.photos));
await p.click('#share-drop');
await p.waitForTimeout(300);
ok('the bar is gone', await p.evaluate(()=>document.getElementById('sharebar').hidden));
ok('and it says so', /discarded/.test(await p.evaluate(()=>document.getElementById('home-sub').textContent)),
   await p.evaluate(()=>document.getElementById('home-sub').textContent));
ok('still on the grid', await p.evaluate(()=>document.body.classList.contains('on-home')));
const after = await p.evaluate(()=>JSON.parse(localStorage.getItem('grid-collage:projects')).map(x=>x.photos));
ok('nothing was added anywhere', j(before)===j(after), `${j(before)} -> ${j(after)}`);
await p.waitForTimeout(2800);
ok('the header puts itself back',
   /project/.test(await p.evaluate(()=>document.getElementById('home-sub').textContent)),
   await p.evaluate(()=>document.getElementById('home-sub').textContent));
// The hold lifts the tile; letting go without moving is what asks for the
// details. Both halves have to come back once the share bar is gone.
{
  const box=await p.locator('#home-grid .tile').first().boundingBox();
  await p.mouse.move(Math.round(box.x+box.width/2), Math.round(box.y+box.height/2));
  await p.mouse.down(); await p.waitForTimeout(700);
  const lifted = await p.evaluate(()=>!!document.querySelector('.tile.is-lifted'));
  await p.mouse.up(); await p.waitForTimeout(400);
  const open = await p.evaluate(()=>!document.getElementById('detail').hidden);
  ok('the tile lifts again after discarding', lifted);
  ok('and releasing still opens the details', open);
  await p.click('#detail', { position: { x: 8, y: 8 } }).catch(()=>{});
  await p.waitForTimeout(200);
}

console.log('\n== the inbox was drained either way ==');
ok('nothing left in the share cache', await p.evaluate(async ()=>{
  const c = await caches.open('grid-collage-share-inbox');
  return (await c.keys()).length === 0;}));
ok('no ?share left on the url', !(await p.url()).includes('share'), await p.url());

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
