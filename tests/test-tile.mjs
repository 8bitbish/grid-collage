import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const ROOT='/home/user/grid-collage';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8146,r));
// left half one colour, right half another, so a flip is visible
function png(w,h,a,bcol){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){const c=x<w/2?a:bcol;
    raw[o+1+x*3]=c[0];raw[o+2+x*3]=c[1];raw[o+3+x*3]=c[2];}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const files=[
  {name:'a.png',mimeType:'image/png',buffer:png(600,600,[230,30,30],[255,220,0])}, // split, for flip
  {name:'b.png',mimeType:'image/png',buffer:png(600,600,[20,200,90],[20,200,90])}, // solid green
];

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1200,height:900},hasTouch:true});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:8146/');
await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.pm-item').length===2);

// no padding, so the square photo fills the square page exactly
await p.evaluate(() => {
  for (const id of ['gap','padding','radius']) {
    const el = document.getElementById(id); el.value = 0;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await p.waitForTimeout(200);

const sample=(fx,fy)=>p.evaluate(([x,y])=>{const c=document.getElementById('canvas');const g=c.getContext('2d');
  const d=g.getImageData(Math.round(c.width*x),Math.round(c.height*y),1,1).data;return `${d[0]},${d[1]},${d[2]}`;},[fx,fy]);

const box=await p.locator('#canvas').boundingBox();
const tapTile=(f)=>p.mouse.click(box.x+box.width*f, box.y+box.height*0.5);

console.log('single tile, left half:', await sample(0.15,0.5), '| right half:', await sample(0.85,0.5));

// select the left tile — the tile bar should open with a cross, not an arrow
await tapTile(0.25);
await p.waitForTimeout(150);
console.log('tile bar open:', await p.locator('#dp-tile').isVisible(),
            '| actions:', await p.locator('#tile-actions .dock-item').count(),
            '| leading button is a cross:', await p.locator('#dock-back-cross').isVisible());

// FLIP
await p.click('.dock-item[data-tile="flip"]');
console.log('flip panel:', await p.locator('#tile-flip').isVisible(), '| leading button back to arrow:', await p.locator('#dock-back-arrow').isVisible());
const beforeFlip = await sample(0.15,0.5);
await p.click('#btn-flip-h');
await p.waitForTimeout(120);
const afterFlip = await sample(0.15,0.5);
console.log(`flip across: ${beforeFlip} -> ${afterFlip}`, beforeFlip!==afterFlip ? '✓ mirrored' : '✗ no change');
await p.click('#dock-back');
console.log('  back -> tile actions again:', await p.locator('#tile-actions').isVisible());

// ROTATE
await p.click('.dock-item[data-tile="rotate"]');
await p.click('#btn-rot90');
await p.waitForTimeout(120);
console.log('turn 90 ->', await p.textContent('#cell-angle'));
await p.evaluate(()=>{const a=document.getElementById('angle'); a.value=-30; a.dispatchEvent(new Event('input',{bubbles:true}));});
await p.waitForTimeout(120);
console.log('angle slider ->', await p.textContent('#cell-angle'));
await p.click('#dock-back');

// RESET puts it back
await p.click('.dock-item[data-tile="reset"]');
await p.waitForTimeout(150);
console.log('reset -> left tile:', await sample(0.15,0.5), '(matches original:', (await sample(0.15,0.5))===beforeFlip ? '✓)' : '✗)');

// SWAP — needs two tiles, so switch this page to a pair and fill the second
await p.keyboard.press('Escape');
await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x1"]');
await p.click('#dock-back');
await p.click('#btn-photos');
// By name, not position: the library is ordered by the day the photo was
// taken now, which for two fixtures made in the same millisecond is not the
// order they were handed over in.
await p.locator('.pm-pick[aria-label*="b.png"]').first().click();   // solid green into the gap
await p.keyboard.press('Escape');
await p.waitForTimeout(250);

const l0=await sample(0.30,0.5), r0=await sample(0.80,0.5);   // off the photo's own colour seam
console.log('two tiles:', l0, '|', r0, r0==='20,200,90' ? '(right is the solid one ✓)' : '(setup wrong ✗)');
await tapTile(0.25);
await p.waitForTimeout(150);
await p.click('.dock-item[data-tile="swap"]');
console.log('swap armed:', await p.evaluate(()=>document.getElementById('canvas-wrap').classList.contains('is-swapping')) ? '✓' : '✗');
await tapTile(0.75);
await p.waitForTimeout(300);
const l1=await sample(0.30,0.5), r1=await sample(0.80,0.5);
console.log(`swap: left ${l0} -> ${l1}, right ${r0} -> ${r1}`, (l1===r0 && r1===l0) ? '✓ exchanged' : '✗');
console.log('  swap mode cleared:', await p.evaluate(()=>!document.getElementById('canvas-wrap').classList.contains('is-swapping')) ? '✓' : '✗');

// undo the swap
await p.click('#btn-undo');
await p.waitForTimeout(250);
console.log('undo swap:', (await sample(0.30,0.5))===l0 ? '✓ back' : '✗');

// DELETE, then the cross deselects
await tapTile(0.25);
await p.waitForTimeout(150);
await p.click('.dock-item[data-tile="delete"]');
await p.waitForTimeout(250);
console.log('delete -> tile empty:', (await sample(0.25,0.5))!==l0 ? '✓' : '✗', '| settings list back:', await p.locator('#dock-root').isVisible());
await p.click('#btn-undo');
await p.waitForTimeout(200);

await tapTile(0.25);
await p.waitForTimeout(150);
await p.click('#dock-back');
await p.waitForTimeout(150);
console.log('cross deselects:', await p.locator('#dock-root').isVisible() ? '✓' : '✗');
await p.screenshot({path:'/tmp/shot-tile.png'});
console.log(errs.length?'✗ ERRORS: '+errs.join(' | '):'✓ no page errors');
await b.close(); srv.close();
