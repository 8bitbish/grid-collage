/* A clip's Trim, as the AF design has it: always playing, a handle that
   parks the tile on its frame, and a hold that closes the strip in on two
   seconds for finer work.

   The fixture is red for its first second and blue for two more, 3.07s in
   all, so where the tile is parked can be read off its colour, and the
   player's own clock says whether it is running. The hold is the part most
   worth measuring rather than looking at: the same drag has to move the cut
   less once the strip has closed in, and that is a number. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,r));
const PORT=srv.address().port;

let fails=0;
const ok=(what,pass,detail='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${what}${detail?` — ${detail}`:''}`); };
const WHOLE = 3.07;

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await p.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate=(v)=>{ window.__buzz.push(v); return true; }; });
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);
await p.setInputFiles('#file-input',[{name:'clip.webm',mimeType:'video/webm',buffer:fs.readFileSync(path.join(ROOT,'tests/fixtures/clip.webm'))}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
await p.waitForTimeout(1000);

const rest = () => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const video = () => p.evaluate(() => { const v = document.querySelector('#players video'); return v ? { t: v.currentTime, paused: v.paused, muted: v.muted } : null; });
const read = (id) => p.textContent(`#${id}`);
const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(400);
await rest();

console.log('== a clip opens on Trim, and it is always playing ==');
{
  ok('Trim is open', await p.locator('#tile-trim').isVisible());
  const tabs = await p.$$eval('#tile-tabs .dock-tab:not([hidden])', (els) => els.map((e) => e.textContent.trim()));
  ok('its foot is Back, Trim and Crop, and the sound', tabs.join() === 'Trim,Crop' && await p.locator('#btn-sound').isVisible(), tabs.join());
  ok('with no Play button anywhere', await p.evaluate(() => ![...document.querySelectorAll('#dock-drawer button')]
    .some((el) => el.offsetParent && /play/i.test(`${el.getAttribute('aria-label') || ''} ${el.textContent}`))));
  ok('the sheet keeps its 16 at the top, since Trim opens on words', await p.evaluate(() => getComputedStyle(document.getElementById('dock-drawer')).paddingTop) === '16px');
  ok('the row reads in, length, out', (await read('trim-from')) === '0:00' && (await read('trim-span')) === '3.1 s' && (await read('trim-to')) === '0:03.1',
    `${await read('trim-from')} · ${await read('trim-span')} · ${await read('trim-to')}`);
  const v1 = await video(); await p.waitForTimeout(500); const v2 = await video();
  ok('the clip is running', !!v1 && !v2.paused && v2.t !== v1.t, `${v1 && v1.t.toFixed(2)} -> ${v2 && v2.t.toFixed(2)}`);
  const heads = [];
  for (let k = 0; k < 4; k++) { heads.push(await p.evaluate(() => getComputedStyle(document.getElementById('trim-playhead')).left)); await p.waitForTimeout(250); }
  ok('and the playhead goes along the strip with it', new Set(heads).size > 1 && await p.locator('#trim-playhead').isVisible(), heads.join(' '));
  ok('nothing floats over the sheet until something is cut', await p.locator('#sheet-float').isHidden());
  ok('and nothing on the tile says how long the clip is, twice', await p.evaluate(() =>
    ![...document.querySelectorAll('#track > *:not(canvas)')].some((el) => !el.hidden && el.offsetParent && /\d:\d\d/.test(el.textContent))));
}

console.log('\n== dragging a handle parks the tile on its frame ==');
const strip = await p.locator('#trim-strip').boundingBox();
const handle = await p.locator('#trim-start').boundingBox();
const y = handle.y + handle.height / 2;
let x = handle.x + handle.width / 2;
const perPxWhole = WHOLE / strip.width;
{
  await p.mouse.move(x, y);
  await p.mouse.down();
  // Quickly, a pixel or more each frame, so this is a drag and not a hold.
  const to = x + strip.width * 0.5;
  for (let k = 1; k <= 10; k++) { await p.mouse.move(x + ((to - x) * k) / 10, y); await p.waitForTimeout(16); }
  x = to;
  await p.waitForTimeout(150);
  const v = await video();
  const cut = await p.evaluate(() => { const d = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('grid-collage:deck:')))); return d.pages[0].cells[0].t0; });
  ok('the cut moved to half way', Math.abs(cut - WHOLE / 2) < 0.12, cut.toFixed(2));
  ok('the loop paused, on the frame under the handle', v.paused && Math.abs(v.t - cut) < 0.1, `paused ${v.paused} at ${v.t.toFixed(2)}`);
  ok('the time being set is lit in the row', await p.evaluate(() => document.getElementById('trim-from').classList.contains('is-lit') && !document.getElementById('trim-to').classList.contains('is-lit')));
  const chip = await p.locator('#frame-time').boundingBox();
  const tile = await p.evaluate(() => { const c = document.getElementById('canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; });
  ok('its time is on the tile, top centre, 12 down', !!chip && (await read('frame-time')) === (await read('trim-from'))
    && Math.abs(chip.x + chip.width / 2 - (tile.left + tile.width / 2)) < 1.5 && Math.abs(chip.y - tile.top - 12) < 1.5,
    chip ? `${await read('frame-time')} at ${(chip.y - tile.top).toFixed(1)} down` : 'not there');
  ok('Reset arrives with the first cut, alone — a clip has nothing to compare', await p.locator('#btn-reset').isVisible() && await p.locator('#btn-compare').isHidden());
  ok('and the playhead stands down while the tile is parked', await p.locator('#trim-playhead').isHidden());
}

console.log('\n== held still, the strip closes in ==');
{
  await p.evaluate(() => { window.__buzz = []; });
  await p.waitForTimeout(700);
  const held = await read('trim-held');
  ok('half a second still, and the strip is two seconds wide in tenths', await p.locator('#trim-ruler').isVisible() && await p.locator('#trim-held').isVisible());
  ok('the time gains a digit', /^0:0\d\.\d\d$/.test(held), held);
  ok('with a tick to say so', await p.evaluate(() => window.__buzz.length === 1 && window.__buzz[0] === 4), await p.evaluate(() => JSON.stringify(window.__buzz)));
  ok('and the frame is still on the tile, to the hundredth', (await read('frame-time')) === held);
  const cut = () => p.evaluate(() => { const d = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('grid-collage:deck:')))); return d.pages[0].cells[0].t0; });
  const before = await cut();
  await p.mouse.move(x + 20, y, { steps: 5 });
  await p.waitForTimeout(100);
  const moved = (await cut()) - before;
  // Two seconds across the strip rather than the whole clip, so 20px moves
  // the cut 2/3.07 of what it would have.
  ok('the same drag now moves the cut less', Math.abs(moved - 20 * 2 / strip.width) < 0.03 && moved < 20 * perPxWhole * 0.8,
    `20px moved it ${moved.toFixed(3)}s, against ${(20 * perPxWhole).toFixed(3)}s at the whole clip`);
  await p.mouse.up();
  await p.waitForTimeout(350);
  await rest();
  ok('letting go puts the strip back to the whole clip', await p.locator('#trim-ruler').isHidden() && await p.locator('#trim-read').isVisible());
  const a = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('trim-strip')).getPropertyValue('--a')));
  const t0 = await cut();
  ok('with the handle where the cut is on it', Math.abs(a - (t0 / WHOLE) * strip.width) < 2, `${a.toFixed(1)}px for ${t0.toFixed(2)}s`);
  await p.waitForTimeout(400);
  const v = await video();
  ok('and the cut plays, from its start, round and round', !v.paused && v.t >= t0 - 0.05, `at ${v.t.toFixed(2)}`);
  ok('the time on the tile goes with the finger', await p.locator('#frame-time').isHidden());
}

console.log('\n== Reset takes the whole clip back ==');
{
  await p.click('#btn-reset');
  await p.waitForTimeout(300);
  await rest();
  ok('the whole clip again', (await read('trim-from')) === '0:00' && (await read('trim-to')) === '0:03.1');
  ok('and nothing floats any more', await p.locator('#sheet-float').isHidden());
}

console.log('\n== the sound toggle ==');
{
  ok('a clip starts with its sound on', await p.getAttribute('#btn-sound', 'aria-pressed') === 'true');
  await p.click('#btn-sound');
  await p.waitForTimeout(150);
  const deck = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('grid-collage:deck:')))).pages[0].cells[0]);
  ok('a tap mutes it, the speaker crossed out', await p.getAttribute('#btn-sound', 'aria-pressed') === 'false'
    && await p.locator('#btn-sound .sound-off').isVisible() && await p.locator('#btn-sound .sound-on').isHidden());
  ok('and the tile remembers it', deck.muted === true, JSON.stringify(deck));
  ok('the preview is muted either way: it never plays sound', (await video()).muted);
  await p.click('#btn-undo');
  await p.waitForTimeout(300);
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(400);
  ok('and one undo puts it back on', await p.getAttribute('#btn-sound', 'aria-pressed') === 'true');
}

await p.screenshot({ path: path.join(SHOTS, 'trimhold.png') });
ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
