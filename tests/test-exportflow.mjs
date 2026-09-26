/* Export as the Figma design has it: a card of sizes off the button, a screen
   held black while it works, Cancel that stops it, and a share sheet that
   opens only when Share is tapped.

   That last one is the point of the design. A browser lets a page open the
   share sheet only within a few seconds of a tap, and a deck with video takes
   longer than that to render, so sharing at the end of the run failed on the
   slow decks and fell back to saving files one by one. The share sheet here is
   a stand-in that records what it was asked, and when. */
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

// A page with the share sheet swapped for one that writes down each call and
// answers however the test says: resolve, or dismissed.
async function open({ share = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.addInitScript((share) => {
    window.__shares = [];
    window.__answer = 'resolve';
    if (!share) { Object.defineProperty(navigator, 'canShare', { value: undefined }); return; }
    Object.defineProperty(navigator, 'canShare', { value: (d) => !!(d && d.files && d.files.length) });
    Object.defineProperty(navigator, 'share', { value: (d) => {
      window.__shares.push({ at: performance.now(), names: d.files.map((f) => f.name), types: d.files.map((f) => f.type), title: d.title });
      return window.__answer === 'dismiss' ? Promise.reject(new DOMException('dismissed', 'AbortError')) : Promise.resolve();
    } });
  }, share);
  await autoEnter(p);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`http://localhost:${PORT}/`);
  return { ctx, p, errs };
}
const rest = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const stateOf = (p) => p.evaluate(() => (document.getElementById('export-screen').hidden ? 'gone' : document.getElementById('export-screen').dataset.state));

console.log('== the card: only the sizes ==');
{
  const { ctx, p, errs } = await open();
  await p.setInputFiles('#file-input', [0, 1, 2].map((i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png(800, 800, [60 + i * 60, 120, 200 - i * 50]) })));
  await p.waitForFunction(() => document.getElementById('photos-count').textContent === '3');
  await p.waitForTimeout(400);
  await p.click('#btn-export-open');
  await rest(p);
  const card = await p.evaluate(() => {
    const c = document.getElementById('export-card');
    const r = c.getBoundingClientRect(), bar = document.getElementById('dock-root').getBoundingClientRect();
    const sizes = c.querySelector('.export-sizes').getBoundingClientRect();
    return {
      buttons: [...c.querySelectorAll('button')].map((e) => e.textContent.trim()),
      text: c.textContent.replace(/\s+/g, ' ').trim(),
      fields: c.querySelectorAll('select, input').length,
      right: window.innerWidth - r.right, gap: bar.top - r.bottom, width: r.width, sizes: sizes.width,
      go: document.getElementById('btn-export').getBoundingClientRect().width,
    };
  });
  ok('three sizes and Export, and nothing else', card.buttons.join() === '1080,1440,2160,Export' && card.text === '1080 1440 2160 Export' && card.fields === 0, card.text);
  ok('no format to choose: no JPG, no PNG', !/JPG|PNG/i.test(card.text));
  ok('anchored to the right of the screen and 8 above the bar', Math.abs(card.right - 16) < 1 && Math.abs(card.gap - 8) < 1, `${card.right} from the right, ${card.gap} above`);
  ok('as wide as the sizes, with Export taking that width', Math.abs(card.width - card.sizes - 16) < 1 && Math.abs(card.go - card.sizes) < 1, `card ${card.width}, sizes ${card.sizes}, Export ${card.go}`);
  ok('and the button that opened it is a cross now', await p.getAttribute('#btn-export-open', 'aria-expanded') === 'true' && await p.locator('#btn-export-open .export-cross').isVisible());
  ok('1080 is chosen to start with', await p.getAttribute('#export-card [data-quality="1080"]', 'aria-checked') === 'true');
  await p.click('#export-card [data-quality="1440"]');
  ok('a size is chosen with a tap', await p.getAttribute('#export-card [data-quality="1440"]', 'aria-checked') === 'true');
  await p.click('#btn-export-open');
  await rest(p);
  ok('the cross shuts it', await p.locator('#export-card').isHidden() && await p.getAttribute('#btn-export-open', 'aria-expanded') === 'false');

  console.log('\n== Share, and only when it is tapped ==');
  // An empty page on the end, which the export skips and says so.
  await p.click('.film-add');
  await p.waitForTimeout(300);
  await p.click('#btn-export-open');
  await p.click('#btn-export');
  const covered = await p.evaluate(() => {
    const c = document.getElementById('canvas').getBoundingClientRect();
    const at = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return !!at && !!at.closest('#export-screen');
  });
  ok('the screen is held black over everything while it works', covered);
  ok('the empty page is skipped, and said', /Skipping 1 empty page/.test(await p.textContent('#toast')), await p.textContent('#toast'));
  await p.waitForFunction(() => document.getElementById('export-screen').dataset.state === 'ready', null, { timeout: 60000 });
  const ready = { title: await p.textContent('#export-title'), sub: await p.textContent('#export-sub'), share: await p.textContent('#export-share') };
  ok('ready: a tick, and what to do with them', ready.title === '3 slides, ready' && /Instagram/.test(ready.sub) && await p.locator('.export-tick').isVisible(), JSON.stringify(ready));
  ok('with Share and Not now', ready.share === 'Share 3 slides' && await p.locator('#export-later').isVisible());
  await p.waitForTimeout(1500);
  ok('the share sheet has not opened by itself', (await p.evaluate(() => window.__shares.length)) === 0);
  await p.click('#export-share');
  await p.waitForTimeout(300);
  const shared = await p.evaluate(() => window.__shares);
  ok('it opens on the tap, once, with every slide in order', shared.length === 1 && shared[0].names.join() === '01.jpg,02.jpg,03.jpg', JSON.stringify(shared));
  ok('photos go out as JPEGs', shared[0] && shared[0].types.every((t) => t === 'image/jpeg'));
  // Flagged, not changed: a title can make iOS share text rather than the
  // files to some apps. Recorded here so a change to it is a change to this.
  ok('still asked with the title "Carousel"', shared[0] && shared[0].title === 'Carousel');
  ok('shared: a tick, and what was sent', (await stateOf(p)) === 'shared' && (await p.textContent('#export-title')) === 'Shared'
    && (await p.textContent('#export-sub')) === 'Sent all 3 in order');
  await p.click('#export-again');
  await p.waitForTimeout(300);
  ok('Share again asks again', (await p.evaluate(() => window.__shares.length)) === 2);
  await p.click('#export-done');
  ok('Done lifts the black', (await stateOf(p)) === 'gone');

  console.log('\n== dismissed, it goes back to Ready ==');
  await p.evaluate(() => { window.__answer = 'dismiss'; });
  await p.click('#btn-export-open');
  await p.click('#btn-export');
  await p.waitForFunction(() => document.getElementById('export-screen').dataset.state === 'ready', null, { timeout: 60000 });
  await p.click('#export-share');
  await p.waitForTimeout(300);
  ok('the share sheet dismissed is Ready again, nothing lost', (await stateOf(p)) === 'ready' && await p.locator('#export-share').isVisible());
  await p.click('#export-later');
  ok('and Not now lifts the black', (await stateOf(p)) === 'gone');
  ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
  await ctx.close();
}

console.log('\n== with no share sheet, Save, which saves the numbered files ==');
{
  const { ctx, p, errs } = await open({ share: false });
  await p.setInputFiles('#file-input', [0, 1].map((i) => ({ name: `s${i}.png`, mimeType: 'image/png', buffer: png(600, 600, [200, 80 + i * 90, 60]) })));
  await p.waitForFunction(() => document.getElementById('photos-count').textContent === '2');
  await p.waitForTimeout(400);
  const names = [];
  p.on('download', (d) => names.push(d.suggestedFilename()));
  await p.click('#btn-export-open');
  await p.click('#btn-export');
  await p.waitForFunction(() => document.getElementById('export-screen').dataset.state === 'ready', null, { timeout: 60000 });
  ok('the button says Save instead', (await p.textContent('#export-share')) === 'Save 2 slides', await p.textContent('#export-share'));
  await p.waitForTimeout(800);
  ok('and nothing is saved until it is tapped', names.length === 0);
  await p.click('#export-share');
  await p.waitForFunction(() => document.getElementById('export-screen').hidden);
  const until = Date.now() + 5000;
  while (names.length < 2 && Date.now() < until) await p.waitForTimeout(100);
  ok('the files save, numbered, once it is', names.join() === '01.jpg,02.jpg', names.join());
  ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
  await ctx.close();
}

console.log('\n== Cancel really stops ==');
{
  const { ctx, p, errs } = await open();
  // A video slide and a photo after it: long enough to be caught part way.
  await p.setInputFiles('#file-input', [
    { name: 'moving0.webm', mimeType: 'video/webm', buffer: fs.readFileSync(path.join(ROOT, 'tests/fixtures/moving0.webm')) },
    { name: 'after.png', mimeType: 'image/png', buffer: png(600, 600, [40, 160, 90]) },
  ]);
  await p.waitForFunction(() => document.getElementById('photos-count').textContent === '2', null, { timeout: 20000 });
  await p.waitForTimeout(800);

  // At 2160, for more frames to be caught part way through. How long the
  // whole thing takes first, so a stop can be told from an end.
  await p.click('#btn-export-open');
  await p.click('#export-card [data-quality="2160"]');
  let t0 = Date.now();
  await p.click('#btn-export');
  await p.waitForFunction(() => document.getElementById('export-screen').dataset.state === 'ready', null, { timeout: 120000 });
  const whole = Date.now() - t0;
  await p.click('#export-later');

  await p.click('#btn-export-open');
  await p.click('#btn-export');
  // Watching the ring from inside the page, frame by frame, for how far it
  // had got when the black dropped.
  await p.evaluate(() => {
    window.__ring = 0;
    const look = () => {
      if (document.getElementById('export-screen').hidden) return;
      window.__ring = parseFloat(document.getElementById('export-fill').style.strokeDasharray) || 0;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await p.waitForFunction(() => /A video/.test(document.getElementById('export-sub').textContent), null, { timeout: 20000 });
  ok('the video slide says so while it works', (await p.textContent('#export-title')) === 'Exporting slide 1 of 2' && (await p.textContent('#export-count')) === '1/2');
  await p.waitForFunction(() => parseFloat(document.getElementById('export-fill').style.strokeDasharray) > 3, null, { timeout: 20000 });
  t0 = Date.now();
  await p.click('#export-cancel');
  await p.waitForFunction(() => document.getElementById('export-screen').hidden, null, { timeout: 60000 });
  const stopped = Date.now() - t0;
  // The video is the first of two slides, so it fills the ring to 50%. Stopped
  // between its frames, the ring never gets there; stopped only once the slide
  // was done, it would read 50.
  const ring = await p.evaluate(() => window.__ring);
  ok('Cancel stops between the video\'s frames, not at the end of the slide', ring < 45, `the ring stopped at ${ring.toFixed(1)}%`);
  ok('and drops the black well before the run would have ended', stopped < whole / 2, `${stopped}ms after Cancel, against ${whole}ms for the whole export`);
  ok('nothing was shared or saved', (await p.evaluate(() => window.__shares.length)) === 0);
  ok('and it says so', /cancelled/i.test(await p.textContent('#toast')), await p.textContent('#toast'));
  // What was left over from the stopped run — a decoder, a half-written file —
  // must not be in the way of the next.
  await p.click('#btn-export-open');
  await p.click('#btn-export');
  await p.waitForFunction(() => document.getElementById('export-screen').dataset.state === 'ready', null, { timeout: 120000 });
  await p.click('#export-share');
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__shares.map((s) => s.names.join()));
  ok('and the next export runs to the end', after.length === 1 && after[0] === '01.mp4,02.jpg', JSON.stringify(after));
  await p.click('#export-done');
  await p.screenshot({ path: path.join(SHOTS, 'exportflow.png') });
  ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
  await ctx.close();
}

await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
