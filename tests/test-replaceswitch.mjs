/* Replace stays open from one tile to the next.

   Replace opens on a tile with the reel, or the tray opened out of it, on the
   photo already in that tile. Tapping another tile used to leave Replace for
   the tool it came from, so choosing a photo for each tile of a page was four
   steps a tile: choose the tile, Replace, choose, back out. Another tile is now
   a tap on that tile and Replace carries on for it — reel or tray as it was,
   on whatever that tile holds — and choosing changes that tile alone.

   An empty tile tapped while choosing is given a copy of the photo in the
   tile just left, which keeps it too, and the picker does not move: it is
   already on that photo, so choosing a neighbour of it for the new tile is
   one tap.

   Taps are made both ways. A touch tap's click lands where the finger lifts,
   which is what PR #69 was about; nothing comes up under the finger here, and
   the photos either side are sampled after every tap to show nothing was
   pressed by accident. */
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

// Enough photos that the tray scrolls, each a flat colour far enough from the
// others to be told apart by sampling one pixel of the page.
const N = 24;
const COLOURS = [...Array(N)].map((_, k) => {
  const h = (k * 360) / N, l = k % 2 ? 0.35 : 0.6;
  const f = (n) => { const a = 0.8 * Math.min(l, 1 - l); const q = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)))); };
  return [f(0), f(8), f(4)];
});
const name = (k) => `p${k}.png`;

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);
await p.setInputFiles('#file-input', COLOURS.map((c, k) => ({ name: name(k), mimeType: 'image/png', buffer: png(300, 300, c) })));
await p.waitForFunction((n)=>document.getElementById('photos-count').textContent===String(n), N);
await p.waitForTimeout(600);

const rest = async () => {
  await p.waitForTimeout(120);
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
};
// Which photo a tile is showing, by the nearest of the colours at its middle.
const CENTRES = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const tile = (i) => p.evaluate(([[x, y], cols]) => {
  const c = document.getElementById('canvas');
  const d = c.getContext('2d').getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data;
  let best = -1, bestD = Infinity;
  cols.forEach((k, n) => { const e = Math.hypot(d[0] - k[0], d[1] - k[1], d[2] - k[2]); if (e < bestD) { bestD = e; best = n; } });
  return bestD < 30 ? best : `none (${d[0]},${d[1]},${d[2]})`;
}, [CENTRES[i], COLOURS]);
const tiles = async () => [await tile(0), await tile(1), await tile(2), await tile(3)];
const at = async (i) => {
  const c = await p.locator('#canvas').boundingBox();
  return { x: c.x + c.width * CENTRES[i][0], y: c.y + c.height * CENTRES[i][1] };
};
const touchTile = async (i) => { const { x, y } = await at(i); await p.touchscreen.tap(x, y); await rest(); };
const clickTile = async (i) => { const { x, y } = await at(i); await p.mouse.click(x, y); await rest(); };

// What the picker has marked as the tile's photo, and whether it is where it
// is shown: under the reel's centre, or inside the tray's scrolled window.
const picker = () => p.evaluate(() => {
  const tray = !document.getElementById('choose-tray').hidden;
  const box = document.getElementById(tray ? 'tray-grid' : 'choose-reel');
  // The reel's own buttons, not the echoes either side of them, which copy
  // the mark but are not what is chosen.
  const list = tray ? box : document.getElementById('choose-strip');
  const on = list.querySelector(':scope > .is-current');
  const r = box.getBoundingClientRect();
  const e = on && on.getBoundingClientRect();
  return {
    open: !document.getElementById('tile-replace').hidden && !document.getElementById('dock-drawer').hidden,
    tray,
    current: on ? on.getAttribute('aria-label') : null,
    marked: list.querySelectorAll(':scope > .is-current').length,
    centred: !!e && Math.abs((e.left + e.right) / 2 - (r.left + r.width / 2)) < 4,
    inView: !!e && e.top >= r.top - 1 && e.bottom <= r.bottom + 1,
    scroll: tray ? box.scrollTop : box.scrollLeft,
    actions: !document.getElementById('tile-actions').hidden,
  };
});
// The tray's own controls, only there while Replace is.
const press = async (sel) => {
  if (await p.locator(sel).isHidden()) { ok(`${sel} there to press`, false); return; }
  await p.click(sel);
  await rest();
};
const choose = async (k) => {
  // Not a crash when Replace has gone, which is how this fails without the
  // change: the assertions after it say so instead.
  if (!(await picker()).open) { ok(`Replace still open to choose ${name(k)} in`, false); return; }
  const tray = !(await p.locator('#choose-tray').isHidden());
  await p.click(tray ? `#tray-grid [aria-label="${name(k)}"]` : `#choose-strip [aria-label="${name(k)}"]`);
  await p.waitForTimeout(300);
  await rest();
};

// The first page as four tiles: p0 where it was, p9 and p5 put in the first
// two by hand, the other two left empty.
{
  await p.click('.dock-item[data-drawer="layout"]');
  await p.click('.layout-btn[data-id="2x2"]');
  await rest();
  await p.click('#float-close');
  await rest();
  await clickTile(1);
  await choose(5);
  await p.click('#float-close');
  await rest();
  await clickTile(0);
  await p.click('#tile-actions [data-tile="replace"]');
  await rest();
  await choose(9);
  await p.click('#float-close');
  await rest();
}
ok('a page of four: p9 and p5 on top, two empty tiles below', JSON.stringify((await tiles()).slice(0, 2)) === '[9,5]'
  && typeof (await tile(2)) === 'string' && typeof (await tile(3)) === 'string', JSON.stringify(await tiles()));

console.log('== Replace opens on the photo already in the tile ==');
{
  await clickTile(0);
  await p.click('#tile-actions [data-tile="replace"]');
  await rest();
  let s = await picker();
  ok('the reel opens on p9, the tile\'s own photo, marked once and under the centre',
    s.open && !s.tray && s.current === name(9) && s.marked === 1 && s.centred, JSON.stringify(s));
  await press('#choose-open');
  s = await picker();
  ok('the tray opened out of it has p9 marked and in view', s.tray && s.current === name(9) && s.inView, JSON.stringify(s));
  await press('#tray-fold');
  await p.keyboard.press('Escape');
  await rest();
  await p.click('#float-close');
  await rest();
  await clickTile(1);
  await p.click('#tile-actions [data-tile="replace"]');
  await rest();
  s = await picker();
  ok('and opened on the other tile, on p5', s.open && s.current === name(5) && s.centred, JSON.stringify(s));
}

console.log('\n== another tile is a tap on it, and Replace carries on for it (reel) ==');
{
  await touchTile(0);
  let s = await picker();
  ok('a touch tap on the other tile keeps Replace open, still the reel', s.open && !s.tray, JSON.stringify(s));
  ok('with p9, that tile\'s photo, marked and under the centre', s.current === name(9) && s.marked === 1 && s.centred, s.current);
  ok('and the tile\'s actions still out of the way', !s.actions);
  ok('neither photo changed by the move', JSON.stringify((await tiles()).slice(0, 2)) === '[9,5]', JSON.stringify(await tiles()));
  await choose(12);
  ok('choosing p12 puts it in that tile and only that one', JSON.stringify((await tiles()).slice(0, 2)) === '[12,5]', JSON.stringify(await tiles()));
  await clickTile(1);
  s = await picker();
  ok('a mouse click back on the first tile: the reel, on p5', s.open && !s.tray && s.current === name(5) && s.centred, JSON.stringify(s));
  await choose(3);
  ok('and p3 chosen goes to it alone', JSON.stringify((await tiles()).slice(0, 2)) === '[12,3]', JSON.stringify(await tiles()));
}

console.log('\n== the same in the tray ==');
{
  await press('#choose-open');
  await touchTile(0);
  let s = await picker();
  ok('a tap on another tile keeps the tray open', s.open && s.tray, JSON.stringify(s));
  ok('with p12, that tile\'s photo, marked and in view', s.current === name(12) && s.marked === 1 && s.inView, s.current);
  await choose(20);
  ok('choosing p20 from the tray changes that tile alone', JSON.stringify((await tiles()).slice(0, 2)) === '[20,3]', JSON.stringify(await tiles()));
}

console.log('\n== an empty tile gets a copy of the photo just left (tray) ==');
{
  // Somewhere in the middle of the grid, so a jump either way would show.
  await p.evaluate(() => {
    const g = document.getElementById('tray-grid');
    const on = g.querySelector('.is-current');
    if (on) g.scrollTop = Math.max(0, on.offsetTop - g.clientHeight / 2);
  });
  await p.waitForTimeout(200);
  const before = await picker();
  ok('the tray has somewhere to scroll to (or this proves nothing)', await p.evaluate(() => {
    const g = document.getElementById('tray-grid'); return g.scrollHeight > g.clientHeight + 20; }));
  await touchTile(2);
  const s = await picker();
  ok('the empty tile now shows p20, a copy, and the tile left keeps it', JSON.stringify(await tiles()) === JSON.stringify([20, 3, 20, await tile(3)])
    && typeof (await tile(3)) === 'string', JSON.stringify(await tiles()));
  ok('Replace is still open on the tray', s.open && s.tray, JSON.stringify(s));
  ok('marking p20 for the new tile', s.current === name(20) && s.marked === 1 && s.inView, s.current);
  ok('and the tray has not moved', Math.abs(s.scroll - before.scroll) < 1, `${before.scroll} → ${s.scroll}`);
  await choose(21);
  ok('a neighbour chosen from there goes to the new tile, and the first keeps p20',
    JSON.stringify((await tiles()).slice(0, 3)) === '[20,3,21]', JSON.stringify(await tiles()));
}

console.log('\n== and on the reel ==');
{
  await press('#tray-fold');
  let s = await picker();
  const before = s;
  ok('folded back to the reel, on p21', s.open && !s.tray && s.current === name(21) && s.centred, JSON.stringify(s));
  await clickTile(3);
  s = await picker();
  ok('a click on the last empty tile copies p21 into it', JSON.stringify(await tiles()) === '[20,3,21,21]', JSON.stringify(await tiles()));
  ok('the reel stays open, on p21, where it was', s.open && !s.tray && s.current === name(21) && s.centred
    && Math.abs(s.scroll - before.scroll) < 1, `${before.scroll} → ${s.scroll}`);
  await choose(22);
  ok('and choosing p22 changes that tile alone', JSON.stringify(await tiles()) === '[20,3,21,22]', JSON.stringify(await tiles()));
}

console.log('\n== each tile\'s choosing is its own step to undo ==');
{
  // Choosing coalesces, so the copy and a quick choice after it may be one
  // step; what has to hold is that the step stops at the tile.
  await p.keyboard.press('Escape');
  await rest();
  await p.click('#btn-undo');
  await rest();
  const t = await tiles();
  ok('one undo takes back the last tile\'s choosing and nothing of the others', JSON.stringify(t.slice(0, 3)) === '[20,3,21]' && t[3] !== 22,
    JSON.stringify(t));
}

await p.screenshot({ path: path.join(SHOTS, 'replaceswitch.png') });
ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
