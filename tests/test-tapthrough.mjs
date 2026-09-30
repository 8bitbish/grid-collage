/* A tap on the photo is not a press on the buttons it brings up.

   Choosing a tile puts its actions on it, bottom centre, and on a
   touchscreen the click that ends a tap is aimed where the finger lifts. A
   tap near the bottom of a tile chose it and pressed whatever had just
   appeared under the finger: Delete, as often as not, so the photo went on
   its first touch. It happened choosing a tile from nothing and moving from
   one tile to the next alike. Touch taps here, not mouse clicks, because a
   mouse click is aimed where it went down and never showed it. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import { png } from './image.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;

let fails=0;
const ok=(what,pass,detail='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${what}${detail?` — ${detail}`:''}`); };

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);
await p.setInputFiles('#file-input',[
  {name:'red.png',mimeType:'image/png',buffer:png(600,600,[200,40,40])},
  {name:'blue.png',mimeType:'image/png',buffer:png(600,600,[40,60,200])},
]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2');
await p.waitForTimeout(600);

const rest = () => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
// Read a third of the way down each tile, off the middle, where an empty tile
// draws its +.
const tiles = () => p.evaluate(() => {
  const c = document.getElementById('canvas'), g = c.getContext('2d');
  return [0.25, 0.75].map((x) => {
    const d = g.getImageData(Math.round(c.width * x), Math.round(c.height * 0.3), 1, 1).data;
    return d[0] > 200 && d[1] > 200 && d[2] > 200 ? 'empty' : d[0] > 150 && d[2] < 100 ? 'red' : d[2] > 150 ? 'blue' : '?';
  }).join(' ');
});
const chosen = async () => {
  const pill = await p.locator('#tile-actions').boundingBox(), c = await p.locator('#canvas').boundingBox();
  if (!pill || !c || !(await p.locator('#tile-actions').isVisible())) return 'none';
  return pill.x + pill.width / 2 < c.x + c.width / 2 ? 'left' : 'right';
};
// Where a tile's Delete will be once it is chosen, worked out from the page as
// it is now: bottom centre of the tile, 12 up, Delete the last of three. With
// a tile already chosen the pill is on screen to measure the height off.
const deleteSpot = async (fx) => {
  const c = await p.locator('#canvas').boundingBox();
  const pill = (await p.locator('#tile-actions').isVisible()) ? await p.locator('#tile-actions').boundingBox() : null;
  const bottom = pill ? pill.y + pill.height : c.y + c.height - 12;
  return { x: c.x + c.width * fx + 47, y: bottom - 26 };
};

await p.click('.dock-item[data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x1"]');
await rest();
await p.click('#float-close');
await rest();
await p.click('#btn-photos');
await p.locator('.pm-pick[aria-label*="blue.png"]').first().click();
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await rest();
ok('two tiles, red and blue', await tiles() === 'red blue', await tiles());
// Which of the tile's actions a click reached, whether or not it was let act.
await p.evaluate(() => { window.__reached = []; document.addEventListener('click', (e) => { const b = e.target.closest('#tile-actions [data-tile]'); if (b) window.__reached.push(b.dataset.tile); }, true); });
const reached = () => p.evaluate(() => { const r = window.__reached; window.__reached = []; return r.join(','); });

console.log('\n== a tap that chooses a tile ==');
{
  let at = await deleteSpot(0.25);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(600);
  ok('choosing a tile from nothing, where its Delete comes up, keeps the photo', await tiles() === 'red blue', await tiles());
  ok('and chooses the tile', await chosen() === 'left', await chosen());
  ok('though the tap\'s click did land on Delete, which came up under the finger', await reached() === 'delete', await reached());

  at = await deleteSpot(0.75);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(600);
  ok('moving to the next tile the same way keeps its photo too', await tiles() === 'red blue', await tiles());
  ok('its click landing on Delete as well', await reached() === 'delete');
  ok('and moves the tools to it', await chosen() === 'right' && await p.locator('#dp-tile').isVisible(), await chosen());
}

console.log('\n== Delete is still Delete ==');
{
  const del = await p.locator('#tile-actions [data-tile="delete"]').boundingBox();
  await p.touchscreen.tap(del.x + del.width / 2, del.y + del.height / 2);
  await p.waitForTimeout(500);
  ok('a tap on Delete itself takes the photo off', await tiles() === 'red empty', await tiles());
  await p.click('#btn-undo');
  await p.waitForTimeout(400);
  await rest();
  ok('and undo puts it back', await tiles() === 'red blue', await tiles());
  const c = await p.locator('#canvas').boundingBox();
  await p.touchscreen.tap(c.x + c.width * 0.75, c.y + c.height * 0.4);
  await p.waitForTimeout(500);
  await p.focus('#tile-actions [data-tile="delete"]');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  ok('from the keyboard too, which has no press to go by', await tiles() === 'red empty', await tiles());
}

await p.screenshot({ path: path.join(SHOTS, 'tapthrough.png') });
ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
