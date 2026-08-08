import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8137,r));

const _pages = (pg) => pg.evaluate(()=>document.querySelectorAll('.film').length);
const _photos = (pg) => pg.evaluate(()=>document.querySelectorAll('.pm-item').length);
const _current = (pg) => pg.evaluate(()=>[...document.querySelectorAll('.film')].findIndex(f=>f.classList.contains('is-current'))+1);
const _openDrawer = (pg, name) => pg.click(`.dock-item[data-drawer="${name}"]`);
function png(w,h,[r0,g0,b0]){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=r0;raw[o+2+x*3]=g0;raw[o+3+x*3]=b0;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const cols=[[220,40,40],[40,200,90],[50,90,230],[240,190,40]];
const files=cols.map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(500,500,c)}));

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:1400,height:960}});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8137/');
const pages=()=>_pages(p);
const photos=()=>_photos(p);
const undoOn=async()=>!(await p.locator('#btn-undo').isDisabled());
const redoOn=async()=>!(await p.locator('#btn-redo').isDisabled());

console.log('fresh start — undo enabled:', await undoOn(), '(expect false)');

await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);
console.log('after import:', await pages(), 'pages,', await photos(), 'photos | undo enabled:', await undoOn());

// delete a page, undo it
await p.click('.dock-item[data-drawer="page"]'); await p.click('#btn-delete-page'); await p.click('#dock-back');
const afterDelete = await pages();
await p.click('#btn-undo');
console.log(`delete page: ${afterDelete} -> undo -> ${await pages()}`, (await pages())===4?'✓':'✗');
await p.click('#btn-redo');
console.log(`redo -> ${await pages()}`, (await pages())===3?'✓':'✗');
await p.click('#btn-undo');

// remove a photo from the tray (destructive: also clears its tile) then undo
await p.click('#btn-photos');
await p.waitForTimeout(250);
await p.locator('.pm-item .pm-x').first().click();
await p.waitForTimeout(250);
await p.click('#pm-close');
console.log(`remove photo: ${await photos()} photos left`);
await p.click('#btn-undo');
console.log(`undo -> ${await photos()} photos`, (await photos())===4?'✓ photo came back':'✗');
const restoredRender = await p.evaluate(()=>{const c=document.getElementById('canvas');const g=c.getContext('2d');
  const d=g.getImageData(c.width*0.5,c.height*0.5,1,1).data; return `${d[0]},${d[1]},${d[2]}`;});
// A tile that is not on the current slide or one either side is drawn from
// its proxy rather than the original, so a flat colour can come back a unit
// or two out — JPEG, not a wrong picture. Sampling has to allow for that.
// That the original does come back is asserted where it matters, on the
// slide you are actually looking at, after the dwell.
const near=(a,b,slack=3)=>{const x=String(a).split(',').map(Number), y=String(b).split(',').map(Number);
  return x.length===3&&y.length===3&&x.every((v,i)=>Math.abs(v-y[i])<=slack);};
console.log('  and its page renders again:', restoredRender, near(restoredRender,'220,40,40')?'✓':'✗');
// The slide you are on settles back to the original itself, not a proxy of
// it — the point of drawing from a proxy at all is that it is temporary.
await p.waitForTimeout(1600);
const settled = await p.evaluate(()=>{const c=document.getElementById('canvas');const g=c.getContext('2d');
  const d=g.getImageData(c.width*0.5,c.height*0.5,1,1).data; return `${d[0]},${d[1]},${d[2]}`;});
console.log('  and settles to the original, exactly:', settled, settled==='220,40,40'?'✓':'✗');

// keyboard
await p.click('.dock-item[data-drawer="page"]'); await p.click('#btn-delete-page'); await p.click('#dock-back');
await p.keyboard.press('Control+z');
console.log('Ctrl+Z:', await pages(), (await pages())===4?'✓':'✗');
await p.keyboard.press('Control+Shift+z');
console.log('Ctrl+Shift+Z:', await pages(), (await pages())===3?'✓':'✗');
await p.keyboard.press('Control+z');

// a slider drag must be ONE undo step, not one per tick
const before = await p.evaluate(()=>document.getElementById('gap').value);
await p.evaluate(()=>{
  const s=document.getElementById('gap');
  s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  for(let v=24;v<=80;v+=2){ s.value=v; s.dispatchEvent(new Event('input',{bubbles:true})); }
  s.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
});
const dragged = await p.evaluate(()=>document.getElementById('gap').value);
await p.click('#btn-undo');
const undone = await p.evaluate(()=>document.getElementById('gap').value);
console.log(`gap ${before} -> drag -> ${dragged} -> one undo -> ${undone}`, undone===before?'✓ single step':'✗ multiple steps');

// undo past the beginning is safe
for (let i=0;i<60;i++) { if (!(await undoOn())) break; await p.click('#btn-undo'); }
console.log('after exhausting undo — enabled:', await undoOn(), '| pages:', await pages(), '| redo enabled:', await redoOn());

// and redo forward again
for (let i=0;i<40;i++) { if (!(await redoOn())) break; await p.click('#btn-redo'); }
console.log('after exhausting redo — pages:', await pages(), 'photos:', await photos());

// new edit clears the redo stack
if (await undoOn()) await p.click('#btn-undo');
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="3x3"]');
console.log('new edit clears redo:', !(await redoOn())?'✓':'✗');

console.log(errs.length?'✗ ERRORS:\n'+errs.join('\n'):'✓ no page errors');
await b.close(); srv.close();
