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
  // bottom, where even the shortest line reaches. The dial moves 3pt a value.
  const runs = await p.evaluate(() => {
    const c = document.querySelector('#adjust-slide .dial-ruler'); const g = c.getContext('2d');
    const y = c.height - 4; const d = g.getImageData(0, y, c.width, 1).data;
    let n = 0, on = false; for (let x = 0; x < c.width; x++) { const lit = d[x * 4 + 3] > 40; if (lit && !on) n += 1; on = lit; }
    return { n, width: c.clientWidth };
  });
  const expect = runs.width / 3;
  ok('one line per value across the dial', Math.abs(runs.n - expect) <= 3, `${runs.n} lines across ${runs.width}pt, ${expect.toFixed(0)} values`);
}

console.log('\n== a tick for every number crossed ==');
{
  const t = await p.locator('#adjust-slide .dial-track').boundingBox();
  const y = t.y + t.height / 2, x = t.x + t.width / 2;
  await p.evaluate(() => { window.__buzz = []; });
  await p.mouse.move(x, y); await p.mouse.down();
  for (let k = 1; k <= 20; k++) await p.mouse.move(x - k * 3, y);
  await p.mouse.up(); await rest();
  const buzz = await p.evaluate(() => window.__buzz);
  const val = await p.textContent('#adjust-val');
  const ticks = buzz.filter((v) => v === 4).length;
  // The first two values from nought snap back to it, so +20 is 18 crossings.
  ok('the dial reads +20', val === '+20', val);
  ok('one tick for each value crossed', ticks >= 17 && ticks <= 20, `${ticks} ticks, ${JSON.stringify(buzz)}`);
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

ok('no page errors', errs.length === 0, errs.join(' | '));
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
