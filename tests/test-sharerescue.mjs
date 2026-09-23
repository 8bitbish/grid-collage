/* The share sheet launches the app and hands it nothing.
 *
 * This is not hypothetical. Chrome 153 on Android strips the files out of the
 * share POST before the multipart body is built, so the worker parses a
 * well-formed form with no parts in it whatsoever (crbug 548571656). Every
 * gallery app reproduces it — Google Photos, the stock camera, F-Stop — and
 * no manifest change reaches it, because the photos are gone before any of
 * this code runs.
 *
 * What the app used to do was nothing at all: land on the grid, import
 * nothing, say nothing, which reads as a broken app rather than an empty
 * share. What it does now is say what arrived and offer the picker, which
 * reaches the same photos through a door the bug does not touch.
 *
 * No autoEnter here. It walks the app off the homepage the moment it sees
 * one, and the homepage is where all of this happens.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('not found');return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8181,r));

function png(w,h,rgb){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=rgb[0];raw[o+1]=rgb[1];raw[o+2]=rgb[2];}}
  const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=tbl[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const body=Buffer.concat([Buffer.from(t),d]);
    const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([l,body,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const rescued=[[220,40,40],[40,200,90]].map((c,i)=>({name:`rescued-${i}.png`,mimeType:'image/png',buffer:png(500,500,c)}));

let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra!==''?` — ${extra}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));

await p.goto('http://localhost:8181/');
await p.waitForFunction(()=>navigator.serviceWorker.controller!==null||performance.now()>8000,{timeout:12000});
await p.waitForTimeout(600);
ok('the worker is in charge, so the share target answers',
   await p.evaluate(()=>!!navigator.serviceWorker.controller));

const bar = () => p.evaluate(()=>({
  up: !document.getElementById('sharebar').hidden,
  says: document.getElementById('share-count').textContent.trim(),
  pick: !document.getElementById('share-pick').hidden,
  fresh: !document.getElementById('share-new').hidden,
  drop: document.getElementById('share-drop').textContent.trim(),
  hint: document.getElementById('home-hint').textContent.trim(),
  picking: document.body.classList.contains('is-picking'),
  tiles: document.querySelectorAll('#home-grid .tile').length,
}));

// Two carousels, so the rescue has something to choose between. That is the
// case that used to end in silence on a grid full of projects.
const backHome = async () => {
  await p.click('#btn-home');
  await p.waitForFunction(()=>document.body.classList.contains('on-home'),{timeout:12000});
  await p.waitForTimeout(500);
};
await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:12000});
await backHome();
await p.click('#btn-new');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:12000});
await backHome();
console.log('\n== the grid to come back to ==');
ok('carousels waiting', (await bar()).tiles === 2, (await bar()).tiles);

// Exactly what Chrome 153 sends: a share POST with no parts in the body.
const emptyShare = async (withText) => {
  await Promise.all([
    p.waitForNavigation({ timeout: 20000 }).catch(()=>{}),
    p.evaluate((withText) => {
      const form = document.createElement('form');
      form.method = 'POST'; form.action = 'share-target'; form.enctype = 'multipart/form-data';
      if (withText) {
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = 'text'; i.value = 'https://photos.app.goo.gl/x';
        form.appendChild(i);
      }
      document.body.appendChild(form);
      form.submit();
    }, withText),
  ]);
  await p.waitForTimeout(1800);
};

console.log('\n== the share sheet sends an empty form ==');
await emptyShare(false);
let st = await bar();
ok('the app says so rather than going quiet', st.up);
ok('and says what happened', st.says === 'Nothing came through', st.says);
ok('the picker is offered', st.pick);
ok('"New carousel" is not — there is nothing to put in it', !st.fresh);
ok('backing out reads as backing out', st.drop === 'Not now', st.drop);
ok('the hint names the culprit', /browser/i.test(st.hint), `"${st.hint}"`);
ok('the tiles are not targets, since nothing is waiting', !st.picking);
ok('it stayed on the grid', await p.evaluate(()=>document.body.classList.contains('on-home')));
ok('no ?share left on the url', !(await p.url()).includes('share'), await p.url());
ok('and it imported nothing behind the bar',
   await p.evaluate(()=>document.getElementById('photos-count').textContent==='0'));

console.log('\n== choosing the photos by hand instead ==');
const [chooser] = await Promise.all([
  p.waitForEvent('filechooser', { timeout: 15000 }),
  p.click('#share-pick'),
]);
ok('the picker takes more than one', chooser.isMultiple());
await chooser.setFiles(rescued);
await p.waitForFunction(()=>document.body.classList.contains('is-picking'),{timeout:15000});
st = await bar();
ok('it asks where they go, exactly as a working share does',
   st.says === 'Add 2 photos to…', st.says);
ok('and the tiles become targets', st.picking);
ok('the picker offer has gone', !st.pick);
ok('"New carousel" is back', st.fresh);

console.log('\n== and they actually land ==');
await p.click('#share-new');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:12000});
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:30000})
  .catch(()=>{});
ok('both rescued photos imported',
   await p.evaluate(()=>document.getElementById('photos-count').textContent==='2'),
   await p.evaluate(()=>document.getElementById('photos-count').textContent));
ok('pages built for them', await p.evaluate(()=>document.querySelectorAll('.film').length)===2,
   await p.evaluate(()=>document.querySelectorAll('.film').length));
const px = await p.evaluate(()=>{const c=document.getElementById('canvas');const g=c.getContext('2d');
  const d=g.getImageData(Math.round(c.width*0.5),Math.round(c.height*0.5),1,1).data;return `${d[0]},${d[1]},${d[2]}`;});
ok('and the first one renders, so this is a real import', px==='220,40,40', px);
ok('the bar is gone', await p.evaluate(()=>document.getElementById('sharebar').hidden));

console.log('\n== a share carrying text but no photos reads differently ==');
await backHome();
await emptyShare(true);
st = await bar();
ok('the browser is not blamed for this one', st.says === 'No photos in that share', st.says);
ok('the picker is still offered', st.pick);

console.log('\n== backing out ==');
await p.click('#share-drop');
await p.waitForTimeout(400);
st = await bar();
ok('the bar goes', !st.up);
ok('the version line comes back', /^v\d/.test(st.hint), `"${st.hint}"`);
ok('and the carousels are untouched', st.tiles === 3, st.tiles);

console.log(`\nerrors: ${errs.length?errs.join('\n'):'none'}`);
console.log(`\n${fails?`${fails} failed`:'all passed'}`);
await b.close(); srv.close();
process.exit(fails || errs.length ? 1 : 0);
