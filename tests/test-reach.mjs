/* Every control in the dock, measured.
 *
 * The sliders were widened to 44px because a range input is hit-tested on its
 * own box; this test exists because everything standing next to them was still
 * being hit-tested on boxes of 24, 26 and 34. It measures rather than looks: a
 * control that is 30px tall looks perfectly reasonable in a screenshot and is
 * missed by a thumb all the same.
 *
 * 44 is the portrait floor — the number the icon buttons, the sliders and the
 * segments all cite. Landscape has 42px inside the whole drawer, so nothing in
 * it can be 44 and the floor there is 34: it is what the room allows, not what
 * a thumb would like, and it is written down here so a change that quietly took
 * more of it fails.
 *
 * The three panels that pin a control outside their own scroller are checked
 * for that too. A background swatch scrolling out of sight costs a preset; the
 * colour well and the Export button scrolling out of sight cost the only way to
 * reach a colour that is not offered, and the only reason the export panel is
 * there at all.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8180,r));

function png(w,h,[r0,g0,b0]){const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){const o=y*(w*3+1);for(let x=0;x<w;x++){raw[o+1+x*3]=r0;raw[o+2+x*3]=g0;raw[o+3+x*3]=b0;}}
  const TB=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=TB[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const files=[[220,60,90],[60,170,120],[70,110,220],[240,180,60]].map((c,i)=>({name:`p${i}.png`,mimeType:'image/png',buffer:png(800,800,c)}));

let pass=0, fail=0;
const ok=(what,good,detail='')=>{ if(good){pass++;console.log(`  ✓ ${what}${detail?` — ${detail}`:''}`);} else {fail++;console.log(`  ✗ ${what}${detail?` — ${detail}`:''}`);} };

// Each drawer, and what has to be reachable once it is open.
const DRAWERS = [
  ['layout',     '.layout-btn'],
  ['shape',      '#ratios button'],
  ['background', '.swatch, #bg'],
  ['page',       '#dp-page .btn'],
  ['export',     '#dp-export .select, #btn-export'],
];
const SUBS = [
  ['zoom',   '#tile-zoom input'],
  ['rotate', '#btn-rot90'],
  ['flip',   '#tile-flip .btn'],
];

const b=await chromium.launch({executablePath: CHROME});

for (const [label, vp, floor] of [
  ['420x860',           {width:420,height:860}, 44],
  ['390x844',           {width:390,height:844}, 44],
  ['360x640',           {width:360,height:640}, 44],
  ['740x380 landscape', {width:740,height:380}, 34],
]) {
  const ctx=await b.newContext({viewport:vp,hasTouch:true,deviceScaleFactor:2});
  const p=await ctx.newPage();
  await autoEnter(p);
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('http://localhost:8180/');
  await p.evaluate(()=>localStorage.clear()); await p.reload();
  await p.setInputFiles('#file-input', files);
  await p.waitForFunction(()=>document.querySelectorAll('.film').length===4);
  console.log(`\n== ${label}, floor ${floor}px ==`);

  // The smallest side of every control in a drawer, and whether the drawer
  // itself stayed inside the bar it lives in.
  const worst = async (sel) => p.$$eval(sel, (els) => els.filter((e)=>e.getBoundingClientRect().width>0)
    .map((el)=>{const r=el.getBoundingClientRect();
      return {id: el.id || el.dataset.id || el.className, side: Math.round(Math.min(r.width, r.height))};})
    .sort((a,c)=>a.side-c.side)[0]);

  for (const [name, sel] of DRAWERS) {
    await p.click(`.dock-item[data-drawer="${name}"]`);
    const w = await worst(sel);
    ok(`${name}: smallest control`, w && w.side >= floor, `${w ? w.id : 'nothing found'} at ${w ? w.side : '-'}px`);
    await p.click('#dock-back');
  }

  await p.click('.dock-item[data-drawer="gap"]');
  const back = await worst('#dock-back');
  ok('the back button', back.side >= floor, `${back.side}px`);
  await p.click('#dock-back');

  // The two pinned controls, which must be on screen whatever the width.
  await p.click('.dock-item[data-drawer="background"]');
  const well = await p.evaluate(() => {
    const r = document.getElementById('bg').getBoundingClientRect();
    return { right: Math.round(r.right), width: window.innerWidth, scrolls: document.getElementById('dp-background').scrollWidth - document.getElementById('dp-background').clientWidth };
  });
  ok('the colour well is on screen', well.right <= well.width, `right edge ${well.right} of ${well.width}`);
  ok('and the panel around it does not scroll', well.scrolls <= 2, `${well.scrolls}px of slack`);
  await p.click('#dock-back');

  await p.click('.dock-item[data-drawer="export"]');
  const exp = await p.evaluate(() => {
    const r = document.getElementById('btn-export').getBoundingClientRect();
    const panel = document.getElementById('dp-export');
    const cs = getComputedStyle(panel);
    return { right: Math.round(r.right), width: window.innerWidth,
             scrolls: panel.scrollWidth - panel.clientWidth,
             masked: (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none' };
  });
  ok('Export is on screen', exp.right <= exp.width, `right edge ${exp.right} of ${exp.width}`);
  // The panel sets overflow: visible so its settings rail can scroll inside it,
  // which means the panel itself never can — and a row that cannot scroll must
  // not be wearing the sideways-scroll fade. That is the fault 059493d found on
  // the sliders, and the mask would take the right-hand edge of Export with it.
  ok('and the panel around it is not masked', !exp.masked && exp.scrolls <= 2,
     `${exp.scrolls}px of slack, mask ${exp.masked ? 'on' : 'off'}`);
  await p.click('#dock-back');

  // The tile drawer and its sub-panels.
  const box=await p.locator('#canvas').boundingBox();
  await p.mouse.click(Math.round(box.x+box.width*0.3), Math.round(box.y+box.height*0.3));
  await p.waitForSelector('#dp-tile',{state:'visible'});
  const act = await worst('#tile-actions .dock-item');
  ok('tile actions: smallest control', act.side >= floor, `${act.id} at ${act.side}px`);
  for (const [name, sel] of SUBS) {
    await p.click(`.dock-item[data-tile="${name}"]`);
    const w = await worst(sel);
    ok(`tile/${name}: smallest control`, w && w.side >= floor, `${w ? w.id : 'nothing found'} at ${w ? w.side : '-'}px`);
    await p.click('#dock-back');
  }

  // Back once more: inside the tile drawer the first press steps out of a
  // sub-panel and the second lets go of the tile, which is what puts the
  // settings list back.
  await p.click('#dock-back');

  // Nothing may hang out of the bar. A panel that overflows downward is a
  // control pressed against the bottom edge of the screen, which is how the
  // trim panel arrived — 90px of content in 62px of dock.
  for (const name of ['shape','background','page','export']) {
    await p.click(`.dock-item[data-drawer="${name}"]`);
    const fits = await p.evaluate((n) => {
      const dock = document.querySelector('.dock').getBoundingClientRect();
      const panel = document.getElementById(`dp-${n}`).getBoundingClientRect();
      return { over: Math.round(Math.max(0, dock.top - panel.top) + Math.max(0, panel.bottom - dock.bottom)) };
    }, name);
    ok(`${name} sits inside the dock`, fits.over === 0, fits.over ? `${fits.over}px outside` : 'no overflow');
    await p.click('#dock-back');
  }

  await p.screenshot({path: path.join(SHOTS, `reach-${label.split(' ')[0]}.png`)});
  ok('no page errors', errs.length===0, errs.join(' | ') || 'clean');
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
