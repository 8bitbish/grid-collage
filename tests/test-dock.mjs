import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8144,r));
function png(w,h,[r0,g0,b0]){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=r0;raw[o+2+x*3]=g0;raw[o+3+x*3]=b0;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const files=[[220,60,90],[60,170,120],[70,110,220],[240,180,60]].map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(800,800,c)}));

const b=await chromium.launch({executablePath: CHROME});
for (const [label, vp, touch, dsf] of [['phone',{width:390,height:844},true,2],['desktop',{width:1440,height:900},false,1]]) {
const ctx=await b.newContext({viewport:vp,hasTouch:touch,isMobile:touch,deviceScaleFactor:dsf});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8144/');
await p.evaluate(()=>localStorage.clear()); await p.reload();
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);
console.log(`\n--- ${label} ---`);

const rootVisible=()=>p.locator('#dock-root').isVisible();
const drawerVisible=()=>p.locator('#dock-drawer').isVisible();
console.log('at rest: settings list shown:', await rootVisible(), '| drawer shown:', await drawerVisible());
console.log('photo count on the library button:', await p.textContent('#photos-count'));
await p.click('#btn-photos');
console.log('  it opens the library, not a drawer:', await p.locator('#photos-modal').isVisible(),
            '| dock untouched:', await rootVisible());
await p.click('#pm-close');

// drill into Layout
await p.click('.dock-item[data-drawer="layout"]');
console.log('tapped Layout -> drawer:', await drawerVisible(), '| layouts visible:', await p.locator('#dp-layout').isVisible(),
            '| options:', await p.locator('.layout-btn').count());
// choose one and check the page changed
await p.click('.layout-btn[data-id="2x2"]');
console.log('  picked 2x2, active layout:', await p.getAttribute('.layout-btn.is-active','data-id'));
await p.click('#dock-back');
console.log('  back -> settings list shown:', await rootVisible());

// each category opens its own controls
for (const [name, sel] of [['shape','#ratios'],['gap','#gap'],['padding','#padding'],
                            ['corners','#radius'],['background','#swatches'],['page','#btn-duplicate'],['export','#quality']]) {
  await p.click(`.dock-item[data-drawer="${name}"]`);
  const ok = await p.locator(sel).isVisible();
  process.stdout.write(`${name}:${ok?'✓':'✗'} `);
  await p.click('#dock-back');
}
console.log('');

// A slider at the top of its range must not be wearing the sideways-scroll
// fade. The readout rides the knob, so at the maximum it hangs past the panel's
// right edge, and that counted as slack to scroll: fade-r went on and masked
// the last 20px of the panel, taking the right half of the knob, half of its
// accent halo and the last digit of the number in the corner with it. Checked
// alongside the fact the panel cannot scroll at all, which is the reason a fade
// there was never right — it promises more to see where there is none.
for (const [name, id] of [['gap','gap'],['padding','padding'],['corners','radius']]) {
  await p.click(`.dock-item[data-drawer="${name}"]`);
  const m = await p.evaluate((id) => {
    const input = document.getElementById(id);
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const panel = input.closest('.dock-slider');
    panel.scrollLeft = 999;
    return { masked: getComputedStyle(panel).maskImage !== 'none', scrolled: panel.scrollLeft,
             over: panel.scrollWidth - panel.clientWidth };
  }, id);
  console.log(`${name} at max -> ${m.over}px past the panel, scrollLeft ${m.scrolled}`,
    !m.masked && m.scrolled === 0 ? '✓ no fade over the knob' : `✗ masked=${m.masked}`);
  await p.click('#dock-back');
}

// selecting a tile opens the tile drawer by itself
const box=await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x+box.width*0.3, box.y+box.height*0.3);
console.log('tapped a tile -> tile drawer:', await p.locator('#dp-tile').isVisible(), '| zoom control:', await p.locator('#zoom').isVisible());
await p.click('#dock-back');
console.log('  back -> deselected, settings list:', await rootVisible());

// preview size in the new shell
const m = await p.evaluate(()=>{
  const c=document.getElementById('canvas'); const w=document.getElementById('canvas-wrap');
  const cb=c.getBoundingClientRect(), wb=w.getBoundingClientRect();
  return {c:`${Math.round(cb.width)}x${Math.round(cb.height)}`, w:`${Math.round(wb.width)}x${Math.round(wb.height)}`,
          ratio:(cb.width/cb.height).toFixed(3), pct:Math.round(cb.width/wb.width*100)};
});
console.log(`preview ${m.c} in ${m.w} = ${m.pct}% of width, ratio ${m.ratio}`);
console.log('page scrolls?', await p.evaluate(()=>document.documentElement.scrollHeight > window.innerHeight + 2) ? 'YES (bad)' : 'no ✓');
await p.screenshot({path:`/tmp/shot-dock-${label}.png`});
console.log(errs.length?'✗ ERRORS: '+errs.join(' | '):'✓ no page errors');
await ctx.close();
}
await b.close(); srv.close();
