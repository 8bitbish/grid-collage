import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const ROOT='/home/user/grid-collage';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8178,r));
function png(w,h,c){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let k=n;for(let j=0;j<8;j++)k=k&1?0xedb88320^(k>>>1):k>>>1;return k;});
  const crc=b=>{let k=0xffffffff;for(const x of b)k=TB[(k^x)&0xff]^(k>>>8);return (k^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(b));return Buffer.concat([l,b,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const files=[...Array(8)].map((_,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(600,750,[30+i*28,90,220-i*22])}));

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8178/');
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===8,{timeout:30000});
await p.waitForTimeout(800);

const cur=()=>p.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current')));
const cdp=await ctx.newCDPSession(p);
const touch=(t,pts)=>cdp.send('Input.dispatchTouchEvent',{type:t,touchPoints:pts.map(([x,y])=>({x,y}))});
const box=await p.locator('#canvas').boundingBox();
const cy=Math.round(box.y+box.height/2);

const flick = async () => {
  await touch('touchStart',[[320,cy]]);
  await touch('touchMove',[[300,cy]]);
  await touch('touchMove',[[265,cy]]);
  await touch('touchEnd',[]);
};

console.log('== six flicks in a row, no waiting between them ==');
console.log('  start on page', await cur()+1);
const t0=Date.now();
for (let i=0;i<6;i++) { await flick(); await p.waitForTimeout(60); }
await p.waitForTimeout(700);
const landed = await cur();
console.log(`  after 6 quick flicks (${Date.now()-t0}ms): page ${landed+1} of 8`);
console.log('  every flick counted:', landed===6 ? '✓' : `✗ only ${landed} turned`);

console.log('\n== and back, one at a time with a pause ==');
for (let i=0;i<3;i++) {
  await touch('touchStart',[[70,cy]]);
  await touch('touchMove',[[90,cy]]);
  await touch('touchMove',[[125,cy]]);
  await touch('touchEnd',[]);
  await p.waitForTimeout(500);
}
console.log('  three unhurried swipes back:', await cur()+1, (await cur())===3 ? '✓' : '✗');

console.log('\n== the deck is left in one piece ==');
console.log('  track reset:', await p.evaluate(()=>document.getElementById('track').style.transform || '(none)'));
console.log('  not stuck mid-slide:', await p.evaluate(()=>!document.getElementById('canvas-wrap').classList.contains('is-sliding')) ? '✓' : '✗');
console.log('  the strip agrees with the canvas:', await p.evaluate(()=>{
  const i=[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'));
  const c=document.getElementById('canvas');
  const d=c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data;
  const t=document.querySelectorAll('.film canvas')[i];
  const e=t.getContext('2d').getImageData(t.width>>1,t.height>>1,1,1).data;
  return Math.abs(d[0]-e[0])<12 && Math.abs(d[2]-e[2])<12 ? '✓ same page' : `✗ canvas ${d[0]},${d[1]},${d[2]} vs thumb ${e[0]},${e[1]},${e[2]}`;}));

console.log('\n== the arrows keys too ==');
for (let i=0;i<4;i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(40); }
await p.waitForTimeout(700);
console.log('  four rapid ArrowRights from page', 4, '->', await cur()+1, (await cur())===7 ? '✓' : `✗`);

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
