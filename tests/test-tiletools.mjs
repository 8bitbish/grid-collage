/* A chosen tile's tools and what floats round them, measured at the size of
   the phone the Figma screens are drawn for.

   Compare and Reset float above the sheet rather than sitting in it, and when
   they are there depends on the tool: on Adjust they arrive with the first
   change and leave when everything is back at nought. The page shrinks to
   clear them, which is the part that is easy to get wrong — a pill laid over
   the stage would sit on the photo — so this measures it rather than looking
   at a screenshot of it. */
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
  {name:'grey.png',mimeType:'image/png',buffer:png(600,900,[120,110,100])},
  {name:'blue.png',mimeType:'image/png',buffer:png(600,600,[60,80,120])},
]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2');
await p.waitForTimeout(600);

const rect = (sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el || el.hidden || !el.getClientRects().length) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
const rest = () => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const box = await p.locator('#canvas').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(300);
await rest();

console.log('== Adjust: nothing floats until something changes ==');
{
  ok('a photo opens on Adjust', await p.locator('#tile-adjust').isVisible());
  ok('nothing floats over the sheet on an unedited photo', await p.locator('#sheet-float').isHidden());
  ok('the chosen setting is filled and in the middle of its row', await p.evaluate(() => {
    const on = document.querySelector('.setting.is-active'); const row = document.getElementById('adjust-reel');
    if (!on) return false;
    const a = on.getBoundingClientRect(), r = row.getBoundingClientRect();
    return Math.abs(a.left + a.width / 2 - (r.left + r.width / 2)) < 2 && getComputedStyle(on).backgroundColor !== 'rgba(0, 0, 0, 0)';
  }));
  ok('its ring is an empty track', await p.evaluate(() => parseFloat(document.querySelector('.setting.is-active .ring-fill').style.strokeDasharray) === 0));
}

const before = await rect('#canvas');
console.log('\n== the first change brings Compare and Reset ==');
{
  // A drag on the dial, as a finger makes it: the ruler follows the finger, so
  // dragging it left brings larger numbers under the needle.
  const t = await rect('#adjust-slide .dial-track');
  const y = t.top + t.height / 2, x = t.left + t.width / 2;
  await p.mouse.move(x, y); await p.mouse.down();
  let arrived = null;
  for (let k = 1; k <= 12; k++) {
    await p.mouse.move(x - k * 3, y);
    if (!arrived && await p.locator('#sheet-float').isVisible()) {
      arrived = await p.evaluate(() => document.getElementById('sheet-float').getAnimations().map((a) => {
        const f = a.effect.getKeyframes();
        return { ms: a.effect.getTiming().duration, from: f[0].opacity, rise: f[0].transform };
      }));
    }
  }
  await p.mouse.up();
  await rest();
  ok('the dial reads +12', (await p.textContent('#adjust-val')) === '+12', await p.textContent('#adjust-val'));
  ok('Compare and Reset are there', await p.locator('#btn-compare').isVisible() && await p.locator('#btn-reset').isVisible());
  ok('they arrived fading in and rising 6pt over 180ms', !!arrived && arrived.some((a) => a.ms === 180 && Number(a.from) === 0 && /translateY\(6px\)/.test(a.rise)), JSON.stringify(arrived));

  const pill = await rect('.float-pill');
  const sheet = await rect('#dock-drawer');
  const after = await rect('#canvas');
  ok('the pill sits 8 above the sheet', Math.abs(sheet.top - pill.bottom - 8) < 1, `${(sheet.top - pill.bottom).toFixed(1)}px`);
  ok('in line with its inner edge', Math.abs(sheet.right - 8 - pill.right) < 1, `sheet right ${sheet.right}, pill right ${pill.right}`);
  ok('100 by 52, as Figma draws it', Math.round(pill.width) === 100 && Math.round(pill.height) === 52, `${pill.width} by ${pill.height}`);
  ok('and the page moved up to clear it, rather than being covered', after.bottom <= pill.top && after.top < before.top,
    `page ${before.top}..${before.bottom} -> ${after.top}..${after.bottom}, pill from ${pill.top}`);
  ok('the setting\'s ring shows how far it went', await p.evaluate(() => document.querySelector('.setting.is-active').classList.contains('is-set')
    && parseFloat(document.querySelector('.setting.is-active .ring-fill').style.strokeDasharray) === 12));
}

console.log('\n== Compare shows the original, and says so ==');
{
  await p.click('#btn-compare');
  await p.waitForTimeout(150);
  ok('Compare is on, white', await p.evaluate(() => {
    const el = document.getElementById('btn-compare');
    return el.getAttribute('aria-pressed') === 'true' && getComputedStyle(el).backgroundColor === 'rgb(245, 245, 245)';
  }));
  const chip = await rect('#tile-original');
  const tile = await p.evaluate(() => {
    const c = document.getElementById('canvas'); const r = c.getBoundingClientRect(); const k = r.width / c.width;
    return { left: r.left, top: r.top };
  });
  ok('"Original" is on the tile, 12 in from its corner', !!chip && (await p.textContent('#tile-original')) === 'Original'
    && Math.abs(chip.left - tile.left - 12) < 1.5 && Math.abs(chip.top - tile.top - 12) < 1.5,
    chip ? `at ${(chip.left - tile.left).toFixed(1)}, ${(chip.top - tile.top).toFixed(1)}` : 'not there');
  // Touching the dial ends it: an edit made while the original is on screen
  // would be made blind.
  await p.focus('#adjust'); await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(150);
  ok('an edit turns Compare off', await p.getAttribute('#btn-compare', 'aria-pressed') === 'false' && await p.locator('#tile-original').isHidden());
}

console.log('\n== Reset takes it all back, and the pill goes with it ==');
{
  await p.click('#btn-reset');
  const leaving = await p.evaluate(() => [...document.querySelectorAll('.sheet-float.is-ghost')].map((g) => g.getAnimations()[0]?.effect.getTiming().duration));
  await rest();
  ok('the dial is back at nought', (await p.textContent('#adjust-val')) === '0');
  ok('nothing floats any more', await p.locator('#sheet-float').isHidden());
  ok('it left the way it came, over 180ms', leaving.includes(180), JSON.stringify(leaving));
  const back = await rect('#canvas');
  ok('and the page grew back into the room', Math.abs(back.top - before.top) < 1 && Math.abs(back.height - before.height) < 1, `${before.top} -> ${back.top}`);
  await p.click('#btn-undo');
  await p.waitForTimeout(300);
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(300);
  await rest();
  ok('undoing the Reset brings the edit, and the pill, back', await p.locator('#sheet-float').isVisible());
}

await p.screenshot({ path: path.join(SHOTS, 'tiletools.png') });
ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
