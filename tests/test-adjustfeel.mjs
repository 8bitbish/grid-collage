/* How Adjust feels under the thumb, measured.

   The dial draws a line for every value and ticks once for every value the
   finger crosses, so the lines and the buzzes count the same thing. The row
   of settings above it chooses as it passes rather than when it stops: the
   setting under the needle is lit and on the dial straight away, and the dial
   slides in from the side the row is moving to. */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './paths.mjs';
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
await p.addInitScript(()=>{ window.__buzz=[]; navigator.vibrate=(v)=>{ window.__buzz.push(v); return true; }; });
await p.goto(`http://localhost:${PORT}/`);
await p.setInputFiles('#file-input',[{name:'grey.png',mimeType:'image/png',buffer:png(600,600,[120,120,120])}]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1');
await p.waitForTimeout(600);
const rest = () => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(300); await rest();
ok('a photo opens on Adjust', await p.locator('#tile-adjust').isVisible());

console.log('== a line for every number ==');
{
  // Separate runs of drawn pixels along one row of the ruler, just above its
  // bottom, where even the shortest line reaches. The dial moves 6pt a value,
  // the spacing its lines always had, each line now one value rather than two.
  const runs = await p.evaluate(() => {
    const c = document.querySelector('#adjust-slide .dial-ruler'); const g = c.getContext('2d');
    const y = c.height - 4; const d = g.getImageData(0, y, c.width, 1).data;
    let n = 0, on = false; for (let x = 0; x < c.width; x++) { const lit = d[x * 4 + 3] > 40; if (lit && !on) n += 1; on = lit; }
    return { n, width: c.clientWidth };
  });
  const expect = runs.width / 6;
  ok('one line per value across the dial', Math.abs(runs.n - expect) <= 3, `${runs.n} lines across ${runs.width}pt, ${expect.toFixed(0)} values`);
}

console.log('\n== a tick for every number crossed ==');
{
  const t = await p.locator('#adjust-slide .dial-track').boundingBox();
  const y = t.y + t.height / 2, x = t.x + t.width / 2;
  await p.evaluate(() => { window.__buzz = []; });
  await p.mouse.move(x, y); await p.mouse.down();
  for (let k = 1; k <= 20; k++) await p.mouse.move(x - k * 6, y);
  await p.mouse.up(); await rest();
  const buzz = await p.evaluate(() => window.__buzz);
  const val = await p.textContent('#adjust-val');
  const ticks = buzz.filter((v) => v === 4).length;
  // 120pt is twenty values of travel, less the one nought's notch holds.
  ok('the dial reads +19', val === '+19', val);
  ok('one tick for each value crossed', ticks >= 17 && ticks <= 19, `${ticks} ticks, ${JSON.stringify(buzz)}`);
}

console.log('\n== nought is a notch, not a pull ==');
{
  // Back to nought first, by the Reset in the floating pill.
  if (await p.locator('#btn-reset').isVisible()) { await p.click('#btn-reset'); await p.waitForTimeout(300); await rest(); }
  const t = await p.locator('#adjust-slide .dial-track').boundingBox();
  const y = t.y + t.height / 2, x = t.x + t.width / 2;
  const val = () => p.textContent('#adjust-val');
  await p.evaluate(() => { window.__buzz = []; });
  await p.mouse.move(x, y); await p.mouse.down();
  const at = {};
  for (const dx of [2, 4, 6, 12, 18, 24]) { await p.mouse.move(x - dx, y); at[dx] = await val(); }
  // Back to one, then held there with a thumb's tremor, a point either way
  // over the line between one and two: the value must not move and nothing
  // may buzz.
  await p.mouse.move(x - 12, y); const before = (await p.evaluate(() => window.__buzz.length));
  for (let i = 0; i < 8; i++) { await p.mouse.move(x - 15 + (i % 2 ? 1 : -1), y); await p.waitForTimeout(16); }
  const heldAt = await val(); const heldBuzz = (await p.evaluate(() => window.__buzz.length)) - before;
  // And back through nought to the other side.
  const back = {};
  for (const dx of [6, 3, 0, -3, -6, -12, -18]) { await p.mouse.move(x - dx, y); back[dx] = await val(); }
  await p.mouse.up(); await rest();
  const buzz = await p.evaluate(() => window.__buzz);
  ok('nought holds for the first 6pt of travel', at[2] === '0' && at[4] === '0' && at[6] === '0', JSON.stringify(at));
  ok('then one, two, three come a line at a time', at[12] === '+1' && at[18] === '+2' && at[24] === '+3', JSON.stringify(at));
  ok('a finger resting on one stays on one and stays quiet', heldAt === '+1' && heldBuzz === 0, `${heldAt}, ${heldBuzz} buzzes while held`);
  ok('coming back, nought catches and holds either side of it', back[3] === '0' && back[0] === '0' && back[-3] === '0', JSON.stringify(back));
  ok('and the other side starts at one as well', back[-12] === '\u22121' && back[-18] === '\u22122', JSON.stringify(back));
  ok('landing on nought gives its own firmer tick', buzz.includes(6), JSON.stringify(buzz));
  if (await p.locator('#btn-reset').isVisible()) { await p.click('#btn-reset'); await p.waitForTimeout(300); await rest(); }
}

console.log('\n== the row chooses as it passes ==');
{
  const before = await p.textContent('#adjust-name');
  // A real finger dragging the row left, 8pt a frame, read back each frame:
  // the row takes 140ms after it stops to settle, so anything seen here is
  // happening while it moves.
  const r = await p.locator('#adjust-reel').boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const y = r.y + r.height / 2, x0 = r.x + r.width / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  const seen = [];
  for (let k = 1; k <= 20; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - k * 8, y }] });
    await p.waitForTimeout(16);
    seen.push(await p.evaluate(() => {
      const a = document.getElementById('adjust-slide').getAnimations().find((x) => x.playState === 'running');
      const mid = document.getElementById('adjust-reel').getBoundingClientRect(); const cx = mid.left + mid.width / 2;
      const under = document.elementFromPoint(cx, mid.top + mid.height / 2)?.closest('.setting, .reel-echo');
      return {
        name: document.getElementById('adjust-name').textContent,
        underLit: !!under && under.classList.contains('is-active'),
        from: a ? a.effect.getKeyframes()[0].transform : null,
      };
    }));
  }
  const names = [...new Set(seen.map((x) => x.name))];
  ok('the dial changed setting while the finger was still moving the row', names.length >= 2 && names[0] === before, names.join(' → '));
  ok('whatever is under the needle is lit as it passes', seen.filter((x) => x.underLit).length >= seen.length - 2, `${seen.filter((x) => x.underLit).length} of ${seen.length} frames`);
  const slides = seen.map((x) => x.from).filter(Boolean);
  ok('the dial slid in from the right, the way the row was going', slides.length > 0 && slides.every((t) => /translateX\(\d/.test(t)), slides[0] || 'no slide seen');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400); await rest();
  const landed = await p.evaluate(() => document.querySelector('#adjust-tools .is-active').querySelector('.setting-name').textContent);
  ok('once the row stops, what it stopped on is the setting', landed === await p.textContent('#adjust-name'), landed);
}

console.log('\n== a flick carries, a slow let-go does not ==');
{
  const r = await p.locator('#adjust-reel').boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const y = r.y + r.height / 2, x0 = r.x + r.width * 0.8;
  const centred = () => p.evaluate(() => {
    const s = document.getElementById('adjust-reel'); const mid = s.scrollLeft + s.clientWidth / 2;
    const all = [...s.querySelectorAll('.setting, .reel-echo')];
    return Math.min(...all.map((el) => Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid)));
  });
  const swipe = async (dx, frames, pauseBeforeLift) => {
    const s0 = await p.evaluate(() => document.getElementById('adjust-reel').scrollLeft);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let k = 1; k <= frames; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - (dx * k) / frames, y }] }); await p.waitForTimeout(16); }
    if (pauseBeforeLift) await p.waitForTimeout(pauseBeforeLift);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // Followed frame by frame until it lands. Once it has, the row may hop by
    // a whole copy of itself from an echo onto the real settings — the same
    // place, drawn from the other copy — so the flight is read up to there.
    const trail = await p.evaluate(() => new Promise((res) => {
      const s = document.getElementById('adjust-reel'); const out = [s.scrollLeft]; const t0 = performance.now();
      const tick = () => { out.push(s.scrollLeft); if (performance.now() - t0 < 1300) requestAnimationFrame(tick); else res(out); };
      requestAnimationFrame(tick);
    }));
    await rest();
    const copy = await p.evaluate(() => document.getElementById('adjust-tools').scrollWidth || 0);
    let end = trail.length - 1;
    for (let i = 1; i < trail.length; i++) if (Math.abs(trail[i] - trail[i - 1]) > 400) { end = i - 1; break; }
    return { dragged: trail[0] - s0, after: trail[end] - trail[0] };
  };
  const step = await p.evaluate(() => { const a = document.querySelectorAll('#adjust-tools .setting'); return a[1].offsetLeft - a[0].offsetLeft; });
  // A small movement: 60pt over five frames, the size of a nudge to the next
  // setting. It must not be carried two along.
  const small = await swipe(60, 5, 0);
  ok('a small movement lands on the next setting, not two along', Math.abs(small.dragged + small.after) <= step * 1.5, `dragged ${small.dragged.toFixed(0)}pt, then ${small.after.toFixed(0)}pt more, a setting is ${step.toFixed(0)}pt`);
  const fast = await swipe(150, 5, 0);
  ok('a quick flick still carries on past where the finger left it', fast.after > step * 0.75, `dragged ${fast.dragged.toFixed(0)}pt, then flew ${fast.after.toFixed(0)}pt more`);
  ok('and lands on the middle of a setting', (await centred()) < 1, `${(await centred()).toFixed(2)}pt off`);
  const slow = await swipe(150, 5, 150);
  ok('a drag that stopped before it lifted only glides onto the nearest setting', Math.abs(slow.after) <= step / 2 + 1, `${slow.after.toFixed(0)}pt after letting go`);
  ok('and lands in the middle too', (await centred()) < 1, `${(await centred()).toFixed(2)}pt off`);
  // Faster still goes further: speed, not a fixed hop, decides how far.
  const faster = await swipe(240, 4, 0);
  ok('a harder flick goes further than a quick one, across several', faster.after > fast.after && faster.after > step * 2, `${faster.after.toFixed(0)}pt against ${fast.after.toFixed(0)}pt`);
  ok('the row pans no page itself: no native scroll, so no scroll indicator', await p.evaluate(() => getComputedStyle(document.getElementById('adjust-reel')).touchAction === 'pan-y'));
  // A tap on a setting to either side still chooses it.
  const target = await p.evaluate(() => { const s = document.getElementById('adjust-reel'); const mid = s.getBoundingClientRect(); const el = document.elementFromPoint(mid.left + mid.width / 2 + 120, mid.top + mid.height / 2)?.closest('.setting, .reel-echo'); return el ? el.querySelector('.setting-name').textContent : null; });
  await p.touchscreen.tap(r.x + r.width / 2 + 120, y);
  await p.waitForTimeout(700); await rest();
  ok('a tap still chooses the setting it lands on', target && (await p.textContent('#adjust-name')) === target, `${target} → ${await p.textContent('#adjust-name')}`);
}

ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
