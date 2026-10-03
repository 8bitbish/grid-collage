/* Every sheet closes from an X hung above its top left, rather than from a
   Back in its foot, and a tile's tools stay open from one tile to the next.

   The X is the same pill as Compare and Reset, mirrored: 52 square, 8 above
   the sheet and in line with its inner edge. With it there, nothing in a foot
   is Back any more, so the page's tabs start at the edge and the ratio's
   value is centred across the whole foot.

   Tapping another tile while one is being edited used to let go of the first
   and leave the second unchosen, so editing a row of photos took two taps a
   photo. It now opens the second on the same tool.

   On a tall page the tiles reach down to where that row hangs, and a tile's
   own actions, which sit 12 up from its bottom, ended up under Close or under
   Compare and Reset. They go up until they are 8 clear of them. */
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
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
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
const rect = (sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el || el.hidden || !el.getClientRects().length) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
// The pill round the X, which is what has to be square and in line.
const closePill = () => rect('#float-row > .float-pill:first-child');
const sample = (fx, fy) => p.evaluate(([x, y]) => {
  const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data;
  return d[0] > d[2] ? 'red' : 'blue';
}, [fx, fy]);
const tapAt = async (fx, fy = 0.5) => {
  const c = await p.locator('#canvas').boundingBox();
  await p.mouse.click(c.x + c.width * fx, c.y + c.height * fy);
  await p.waitForTimeout(150);
  await rest();
};
const placed = async (what) => {
  const pill = await closePill(), sheet = await rect('#dock-drawer');
  ok(`${what}: Close floats over the sheet's top left`, pill && sheet
    && Math.abs(pill.left - (sheet.left + 8)) < 1 && Math.abs(sheet.top - pill.bottom - 8) < 1,
    pill && sheet ? `pill at ${pill.left},${pill.bottom}, sheet at ${sheet.left},${sheet.top}` : 'missing');
  ok(`${what}: and its pill is a circle, 52 by 52`, pill && Math.abs(pill.width - 52) < 0.5 && Math.abs(pill.height - 52) < 0.5,
    pill ? `${pill.width}×${pill.height}` : 'missing');
};

console.log('== the page\'s own sheets ==');
{
  await p.click('.dock-item[data-drawer="layout"]');
  await rest();
  await placed('Layout');
  ok('nothing of the photo\'s floats with it', await p.locator('#sheet-float').isHidden());
  const foot = await rect('.sheet-foot'), tabs = await rect('#dock-tabs');
  ok('the tabs start at the foot\'s edge, with no Back beside them', foot && tabs && Math.abs(tabs.left - foot.left) < 1,
    `tabs from ${tabs && tabs.left}, foot from ${foot && foot.left}`);
  ok('and no button in any foot says Back', await p.locator('.sheet-foot [aria-label="Back"], #choose-tray [aria-label="Back"]').count() === 0);
  await p.click('.layout-btn[data-id="2x1"]');
  await rest();
  await p.click('#float-close');
  await rest();
  ok('Close shuts the sheet and brings the bar back', await p.locator('#dock-drawer').isHidden()
    && await p.locator('#dock-root').isVisible() && await p.locator('#float-row').isHidden());

  await p.click('.dock-item[data-drawer="shape"]');
  await rest();
  await placed('Ratio');
  const value = await rect('#sheet-value-main'), foot2 = await rect('.sheet-foot');
  ok('the ratio\'s value sits dead centre across the whole foot', value && foot2
    && Math.abs((value.left + value.right) / 2 - (foot2.left + foot2.right) / 2) < 1,
    `${value && (value.left + value.right) / 2} against ${foot2 && (foot2.left + foot2.right) / 2}`);
  // Tall, so the tiles reach down to where the row hangs.
  await p.click('#ratios button[data-id="9:16"]');
  await rest();
  await p.click('#float-close');
  await rest();
}

// The second tile of the pair, filled from the library.
{
  await p.click('#btn-photos');
  await p.locator('.pm-pick[aria-label*="blue.png"]').first().click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  await rest();
}
ok('two tiles, red and blue', await sample(0.25, 0.5) === 'red' && await sample(0.75, 0.5) === 'blue',
  `${await sample(0.25, 0.5)} | ${await sample(0.75, 0.5)}`);

// The chosen tile, told by where its actions sit: bottom centre of it.
const chosen = async () => {
  const pill = await rect('#tile-actions'), c = await rect('#canvas');
  if (!pill || !c) return null;
  return (pill.left + pill.right) / 2 < (c.left + c.right) / 2 ? 'left' : 'right';
};

console.log('\n== another tile is a tap on that tile ==');
{
  await tapAt(0.25);
  ok('the left tile opens on Adjust', await p.locator('#tile-adjust').isVisible() && await chosen() === 'left');
  ok('and Close says it lets go of the tile', await p.getAttribute('#float-close', 'aria-label') === 'Done with this tile');
  await placed('A tile');
  await tapAt(0.75);
  ok('tapping the right one moves the tools to it, still open, still on Adjust',
    await p.locator('#dp-tile').isVisible() && await p.locator('#tile-adjust').isVisible() && await chosen() === 'right', await chosen());
  await p.click('#tile-tabs [data-tile="crop"]');
  await rest();
  await tapAt(0.25);
  ok('and back to the left one on Crop, the tool that was open',
    await p.locator('#tile-crop').isVisible() && await chosen() === 'left', await chosen());
  await p.click('#tile-actions [data-tile="replace"]');
  await rest();
  await tapAt(0.75);
  // Replace carries on for the other tile rather than giving way: see
  // test-replaceswitch. Its actions are out of the way while it does, so
  // which tile is chosen is told by the photo the reel has marked.
  ok('from Replace, another tile stays on Replace, for that tile',
    await p.locator('#tile-replace').isVisible() && await p.getAttribute('#choose-strip > .is-current', 'aria-label') === 'blue.png');
  ok('with neither photo changed by the move', await sample(0.25, 0.5) === 'red' && await sample(0.75, 0.5) === 'blue');
  await p.keyboard.press('Escape');
  await rest();
  ok('and leaving it goes back to the tool Replace came from, on the right',
    await p.locator('#tile-crop').isVisible() && await chosen() === 'right', await chosen());
  await p.click('#tile-tabs [data-tile="adjust"]');
  await rest();
}

console.log('\n== the tile\'s actions keep clear of what floats ==');
{
  // An edit brings Compare and Reset in over the right-hand tile.
  await p.evaluate(() => {
    const a = document.getElementById('adjust'); a.value = 30;
    a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(250);
  await rest();
  const clear = async (what, floatSel) => {
    const acts = await rect('#tile-actions'), f = await rect(floatSel), c = await rect('#canvas');
    const across = acts && f && acts.left < f.right + 8 && f.left < acts.right + 8;
    ok(`${what}: the tile\'s bottom would have put its actions under it`, c && f && c.bottom - 12 > f.top - 8,
      c && f ? `tile ends ${c.bottom}, pill starts ${f.top}` : 'missing');
    ok(`${what}: so they sit 8 clear above it instead`, across && acts.bottom <= f.top - 8 + 0.5,
      acts && f ? `actions end ${acts.bottom}, pill starts ${f.top}` : 'missing');
  };
  ok('Compare and Reset are there', await p.locator('#sheet-float').isVisible());
  await clear('Compare and Reset', '#sheet-float');
  await tapAt(0.25);
  await clear('Close', '#float-row > .float-pill:first-child');
  // Nothing floating over it, a tile's actions go back to 12 up from its bottom.
  await p.click('#float-close');
  await rest();
  await p.click('.dock-item[data-drawer="shape"]');
  await p.click('#ratios button[data-id="1:1"]');
  await rest();
  await p.click('#float-close');
  await rest();
  await tapAt(0.25);
  const acts = await rect('#tile-actions'), c = await rect('#canvas'), f = await closePill();
  ok('on a square page, clear of the row already, they sit 12 up from the tile\'s bottom as before',
    acts && c && f && f.top - 8 >= c.bottom - 12 && Math.abs(c.bottom - acts.bottom - 12) < 3,
    acts && c ? `actions end ${acts.bottom}, page ends ${c.bottom}` : 'missing');
}

await p.screenshot({ path: path.join(SHOTS, 'sheetclose.png') });
ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
