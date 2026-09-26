/* Which clip a slide's sound comes from, and muting as the way to choose.

   Two clips side by side on one slide, each with a sound of its own and a
   length of its own: voice3s.webm is three seconds of 440Hz, voice2s.webm two
   of 880Hz. Both carry Opus, which an MP4 can hold as it is, so their sound
   goes into the export copied rather than re-encoded — the one route this
   Chromium can take, having no AAC encoder of its own. How long the exported
   sound runs then says which clip it came from.

   The export takes the longest clip that has not been muted, and none at all
   when every clip is muted. The file is read back with the app's own
   mediabunny, in the page, so nothing outside the suite is needed. */
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
const clip=(name)=>({name,mimeType:'video/webm',buffer:fs.readFileSync(path.join(ROOT,'tests/fixtures',name))});

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,acceptDownloads:true});
const p=await ctx.newPage();
// No share sheet, as on a desktop, so the export arrives as a download.
await p.addInitScript(()=>{ Object.defineProperty(navigator,'canShare',{value:undefined}); });
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(`http://localhost:${PORT}/`);

// The long clip first, on a page split in two, and the short one into the gap.
await p.setInputFiles('#file-input',[clip('voice3s.webm')]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='1',{timeout:20000});
await p.click('.chip[data-drawer="layout"]');
await p.click('.layout-btn[data-id="2x1"]');
await p.click('#dock-back');
await p.setInputFiles('#file-input',[clip('voice2s.webm')]);
await p.waitForFunction(()=>document.getElementById('photos-count').textContent==='2',{timeout:20000});
await p.waitForTimeout(800);
const rest = () => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
await rest();
const box = await p.locator('#canvas').boundingBox();

// Export the slide and say how long its sound runs, if it has any.
async function exportedSound() {
  await rest();
  await p.click('.dock-item[data-drawer="export"]');
  const dl = p.waitForEvent('download', { timeout: 120000 });
  await p.click('#btn-export');
  const saved = await dl;
  const bytes = fs.readFileSync(await saved.path()).toString('base64');
  await p.keyboard.press('Escape');
  return p.evaluate(async (b64) => {
    const MB = await import('./vendor/mediabunny.mjs');
    const blob = await (await fetch(`data:video/mp4;base64,${b64}`)).blob();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const audio = await input.getPrimaryAudioTrack();
    const out = { sound: audio ? Math.round((await audio.computeDuration()) * 100) / 100 : null, codec: audio ? await audio.getCodec() : null };
    input.dispose();
    return out;
  }, bytes);
}

async function mute(fx) {
  await p.mouse.click(box.x + box.width * fx, box.y + box.height / 2);
  await p.waitForTimeout(400);
  await rest();
  await p.click('#btn-sound');
  await p.waitForTimeout(150);
  const muted = await p.getAttribute('#btn-sound', 'aria-pressed') === 'false';
  await p.click('#dock-back');
  await p.waitForTimeout(300);
  return muted;
}

console.log('== both clips heard: the longer one is the sound ==');
{
  const got = await exportedSound();
  ok('the slide has the three second clip\'s sound', !!got.sound && Math.abs(got.sound - 3) < 0.15, JSON.stringify(got));
}

console.log('\n== the longer one muted: the other one is heard instead ==');
{
  ok('the left clip is muted', await mute(0.25));
  const got = await exportedSound();
  ok('the slide has the two second clip\'s sound', !!got.sound && Math.abs(got.sound - 2) < 0.15, JSON.stringify(got));
}

console.log('\n== both muted: a silent slide ==');
{
  ok('the right clip is muted too', await mute(0.75));
  const got = await exportedSound();
  ok('the slide has no sound at all', got.sound === null, JSON.stringify(got));
}

console.log('\n== the preview never plays either ==');
ok('every player is muted, as it always was', await p.evaluate(() => [...document.querySelectorAll('#players video')].every((v) => v.muted)));

ok('no page errors', errs.length === 0, errs.join(' | ') || 'clean');
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
