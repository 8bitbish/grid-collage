/* The icons the tile's tools and the export brought in, measured where they
   are drawn rather than where they are written.

   Every icon here is drawn at about 1.5 CSS px of stroke whatever its size:
   stroke-width is in viewBox units, so a 22px icon asks for 1.7 and a 16px
   one for 2.2, and the browser divides by the scale. Copying a stroke number
   across from Figma, where it is in final pixels, is the easy mistake, and it
   draws 20–28% too heavy. So each one's drawn width is stroke-width times its
   rendered size over 24, and has to land on 1.5. The paths themselves are the
   Figma set's: rasterised against its exports they overlap 98–100%, or 99%+
   for swap and delete once Figma's butt caps are allowed for. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import { png } from './image.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;

let fails=0;
const ok=(what,pass,detail='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${what}${detail?` — ${detail}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);
// A clip on its own page and a photo on the next, so both kinds of tile are
// there to be chosen.
await p.setInputFiles('#file-input',[
  {name:'clip.webm',mimeType:'video/webm',buffer:fs.readFileSync(path.join(ROOT,'tests/fixtures/clip.webm'))},
  {name:'photo.png',mimeType:'image/png',buffer:png(600,600,[90,120,160])},
]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:20000});
await p.waitForTimeout(600);
const rest = () => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

// The drawn stroke of the first visible match, in CSS px.
const drawn = (sel) => p.evaluate((s) => {
  const svg = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length);
  if (!svg) return null;
  const size = svg.getBoundingClientRect().width;
  return { size: Math.round(size), stroke: (parseFloat(getComputedStyle(svg).strokeWidth) * size) / 24 };
}, sel);
const check = async (what, sel, size) => {
  const d = await drawn(sel);
  ok(`${what}: ${size}px, drawn at 1.5`, !!d && d.size === size && Math.abs(d.stroke - 1.5) <= 0.1,
    d ? `${d.size}px, ${d.stroke.toFixed(2)}px of stroke` : 'not on screen');
};
const tap = async (fx, fy) => {
  const box = await p.locator('#canvas').boundingBox();
  await p.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await p.waitForTimeout(300);
  await rest();
};

console.log('== the bar and the export ==');
await check('Export', '#btn-export-open .export-arrow', 22);
await p.click('#btn-export-open');
await rest();
await check('Export as the card\'s close', '#btn-export-open .export-cross', 22);
await p.click('#btn-export-open');
await rest();

console.log('\n== a clip: its actions, its sound, its crop ==');
await tap(0.5, 0.5);
await check('Replace', '#tile-actions [data-tile="replace"] svg', 22);
await check('Swap', '#tile-actions [data-tile="swap"] svg', 22);
await check('Delete', '#tile-actions [data-tile="delete"] svg', 22);
ok('Delete in the one colour kept for loss', await p.evaluate(() => {
  const btn = document.querySelector('#tile-actions [data-tile="delete"]');
  const want = getComputedStyle(document.documentElement).getPropertyValue('--content-danger').trim();
  const probe = document.createElement('i'); probe.style.color = want; document.body.appendChild(probe);
  const same = getComputedStyle(btn).color === getComputedStyle(probe).color; probe.remove(); return same;
}));
await check('Sound', '#btn-sound .sound-on', 22);
await p.click('#btn-sound');
// Once the press has let go: a pressed circle is 92% of itself.
await p.mouse.move(0, 0);
await p.waitForTimeout(250);
await check('Muted', '#btn-sound .sound-off', 22);
await p.click('#btn-sound');
await p.click('#tile-tabs [data-tile="crop"]');
await rest();
await check('Flip', '#btn-flip svg', 22);
await check('Turn left', '#btn-turn-left svg', 22);
await check('Turn right', '#btn-turn-right svg', 22);
await check('Reset, floating', '#btn-reset svg', 22);
await p.click('#tile-actions [data-tile="replace"]');
await rest();
await check('the chevron that opens the tray', '#choose-open svg', 22);
await check('Add from your photos, on the reel', '#choose-strip .is-add svg', 22);
await p.click('#choose-open');
await rest();
await check('Back, over the tray', '#tray-back svg', 22);
await check('the fold', '#tray-fold svg', 22);
await check('Add from your photos, in the tray', '#tray-grid .is-add svg', 22);
await p.click('#tray-back');
await rest();
await p.click('#dock-back');
await rest();

console.log('\n== a photo: Compare, and Adjust\'s settings ==');
const film = p.locator('.film').nth(1);
await film.click();
await p.waitForTimeout(500);
await tap(0.5, 0.5);
await p.click('#tile-tabs [data-tile="crop"]');
await rest();
await check('Compare, floating', '#btn-compare svg', 22);
await p.click('#tile-tabs [data-tile="adjust"]');
await rest();
await check('a setting\'s icon, inside its ring', '.setting.is-active .setting-icon', 16);

await p.screenshot({ path: path.join(SHOTS, 'icons.png') });
ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
