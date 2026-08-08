import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const OUT = SHOTS;
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8164,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const mk=(n,c)=>({name:n,mimeType:'image/png',buffer:png(500,500,c)});
const j=o=>JSON.stringify(o);

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate=(v)=>{window.__buzz.push(v);return true;}; });
await p.goto('http://localhost:8164/'); await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.waitForTimeout(400);

const sample=(fx,fy)=>p.evaluate(([x,y])=>{const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(Math.round(c.width*x),Math.round(c.height*y),1,1).data;
  return `${d[0]},${d[1]},${d[2]}`;},[fx,fy]);

console.log('== the button, before anything is imported ==');
console.log('  sits left of the pages:', j(await p.evaluate(()=>{
  const btn=document.getElementById('btn-photos').getBoundingClientRect();
  const strip=document.getElementById('filmstrip').getBoundingClientRect();
  return { btnLeft:Math.round(btn.left), stripLeft:Math.round(strip.left), leftOfStrip: btn.right<=strip.left+1 };})));
console.log('  count reads:', await p.textContent('#photos-count'),
            '| flagged as empty:', await p.evaluate(()=>document.getElementById('btn-photos').classList.contains('is-empty')));
console.log('  no Photos item left in the dock:', await p.evaluate(()=>!document.querySelector('.dock-item[data-drawer="photos"]')));

await p.setInputFiles('#file-input',[mk('a.png',[220,40,40]),mk('b.png',[40,200,90]),mk('c.png',[50,90,230]),mk('d.png',[240,190,40])]);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);
await p.waitForTimeout(400);
console.log('\n== with four photos ==');
console.log('  count reads:', await p.textContent('#photos-count'),
            '| still flagged empty:', await p.evaluate(()=>document.getElementById('btn-photos').classList.contains('is-empty')));

// the button stays put as the strip scrolls
for (let i=0;i<8;i++){ await p.click('.film-add'); await p.waitForTimeout(60); }
await p.waitForTimeout(400);
const before=await p.evaluate(()=>document.getElementById('btn-photos').getBoundingClientRect().left);
await p.evaluate(()=>{document.getElementById('filmstrip').scrollLeft=999;});
await p.waitForTimeout(200);
const after=await p.evaluate(()=>document.getElementById('btn-photos').getBoundingClientRect().left);
console.log('  pinned while the strip scrolls:', before===after ? `✓ (${Math.round(before)}px)` : `✗ moved ${before} -> ${after}`);

console.log('\n== the modal ==');
await p.evaluate(()=>{window.__buzz=[];});
await p.click('#btn-photos');
await p.waitForTimeout(350);
console.log('  opens:', await p.locator('#photos-modal').isVisible(),
            '| aria-expanded:', await p.getAttribute('#btn-photos','aria-expanded'),
            '| buzzed:', j(await p.evaluate(()=>window.__buzz)));
console.log('  shows every photo:', await p.locator('.pm-item').count());
console.log('  head order (l→r):', j(await p.evaluate(()=>{
  const l=document.getElementById('pm-close').getBoundingClientRect();
  const t=document.querySelector('.pm-head h2').getBoundingClientRect();
  const a=document.getElementById('pm-add').getBoundingClientRect();
  return { close:Math.round(l.left), title:Math.round(t.left), add:Math.round(a.left),
           closeIsLeftmost: l.left<t.left && t.left<a.left,
           addIsRightmost: a.right > t.right };})));
console.log('  focus starts on the way out:', await p.evaluate(()=>document.activeElement.id));
await p.locator('.pm-card').screenshot({path:`${OUT}/library.png`});

// place a photo: badge updates, modal stays open
console.log('\n== placing from the library ==');
await p.evaluate(()=>{window.__buzz=[];});
await p.locator('.pm-pick').nth(1).click();
await p.waitForTimeout(350);
console.log('  stays open:', await p.locator('#photos-modal').isVisible());
console.log('  badge appeared:', await p.locator('.pm-item').nth(1).locator('.pm-badge').count() ? '✓' : '✗',
            '| reads', await p.locator('.pm-item').nth(1).locator('.pm-badge').textContent().catch(()=>'-'));
console.log('  buzzed:', j(await p.evaluate(()=>window.__buzz)));

// add more from inside
const chooser = p.waitForEvent('filechooser');
await p.click('#pm-add');
const fc = await chooser;
await fc.setFiles([mk('e.png',[200,60,210])]);
await p.waitForFunction(()=>document.querySelectorAll('.pm-item').length===5, {timeout:5000});
console.log('  Add brings in more, live:', await p.locator('.pm-item').count(), 'items | count badge:', await p.textContent('#photos-count'));

// remove one
await p.locator('.pm-x').nth(4).click();
await p.waitForTimeout(350);
console.log('  removing works:', await p.locator('.pm-item').count(), 'left | count badge:', await p.textContent('#photos-count'));

// close
await p.click('#pm-close');
await p.waitForTimeout(300);
console.log('  left button closes:', !(await p.locator('#photos-modal').isVisible()),
            '| aria-expanded:', await p.getAttribute('#btn-photos','aria-expanded'),
            '| focus returned to:', await p.evaluate(()=>document.activeElement.id));

// and the photo really landed on the page
await p.click('.film'); await p.waitForTimeout(400);
console.log('  the placement took:', await sample(0.5,0.5));

console.log('\n== other ways out ==');
await p.click('#btn-photos'); await p.waitForTimeout(300);
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
console.log('  Escape closes:', !(await p.locator('#photos-modal').isVisible()));
// The card is full-bleed on a phone, so there is no backdrop to tap there.
// Only a wide window has one beside the card.
await p.setViewportSize({width:1200,height:900}); await p.waitForTimeout(300);
await p.click('#btn-photos'); await p.waitForTimeout(300);
console.log('  card is a panel on a wide window:', j(await p.evaluate(()=>{
  const c=document.querySelector('.pm-card').getBoundingClientRect();
  return {width:Math.round(c.width), gapEachSide:Math.round(c.left)};})));
await p.mouse.click(80, 500);   // the dimmed area beside the card
await p.waitForTimeout(250);
console.log('  backdrop closes:', !(await p.locator('#photos-modal').isVisible()));
await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(300);

console.log('\n== empty library ==');
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
await p.click('#btn-photos'); await p.waitForTimeout(300);
console.log('  says so:', (await p.textContent('#pm-empty')).trim().split('\n')[0]);
await p.locator('.pm-card').screenshot({path:`${OUT}/library-empty.png`});

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
