/* Google Photos on an Android emulator, driven over adb, for the tools the
 * web editor does not have — Sharpen above all.
 *
 *   node google-android.mjs edit <dir> <image> <setting> ...
 *     e.g. edit out/emu chart.png sharpen+100 sharpen+50
 *
 * Needs a device listed by `adb devices`: a real phone over wireless
 * debugging, or an emulator (`emulator -avd <name> -no-window -no-snapshot
 * -gpu host`). ANDROID_SERIAL picks one when there are several.
 *
 * Use the real phone for Sharpen. Google Photos' Sharpen is not the same on
 * every device: on an emulator it came out the same whatever the app
 * version, GPU, RAM or core count, and different from a Galaxy S23 Ultra's —
 * finer and noisier (noise 3.0 -> 4.3 at 100, against 2.9). The tone tools
 * matched everywhere.
 *
 * Each setting pushes the image, opens it from the Photos grid the way a
 * person would, finds the tool through the editor's own search, sets the
 * slider by reading the number the editor shows and nudging until it
 * agrees, saves a copy and pulls it back as <dir>/<setting>.jpg. The pushed
 * image and the copy are deleted afterwards, so nothing collects on the
 * device. Opening the editor with an EDIT intent instead looked like it
 * worked and saved nothing, which is why this goes through the grid.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
import { CHROME } from '../paths.mjs';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 1e8 });
const sh = (cmd) => adb('shell', cmd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The screen's size, so the one place that has to tap by position scales
// with it: an emulator is 1080x2400, a Galaxy S23 Ultra 1440x3088.
let SCREEN_W = 1080;
let SCREEN_H = 2400;

// Every node on screen with a label, as { text, desc, cls, x, y } at its centre.
function screen() {
  sh('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1');
  const xml = sh('cat /sdcard/ui.xml');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const g = (a) => (new RegExp(`${a}="([^"]*)"`).exec(n) || [])[1] || '';
    const [x1, y1, x2, y2] = g('bounds').match(/\d+/g).map(Number);
    return { text: g('text'), desc: g('content-desc'), cls: g('class'), x: (x1 + x2) / 2, y: (y1 + y2) / 2, x1, x2 };
  });
}
const find = (nodes, test) => nodes.find((n) => test.test(n.text) || test.test(n.desc));
async function waitFor(test, ms = 60000) {
  const match = typeof test === 'function' ? test : (nodes) => find(nodes, test);
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1500)) {
    const n = match(screen());
    if (n) return n;
  }
  // What was on screen instead, for whoever has to work out why.
  if (process.env.SHOTS) {
    fs.writeFileSync(path.join(process.env.SHOTS, 'stuck.png'), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 1e8 }));
    fs.writeFileSync(path.join(process.env.SHOTS, 'stuck.txt'), screen().filter((n) => n.text || n.desc).map((n) => `${n.text} | ${n.desc} | ${n.cls} | ${n.x},${n.y}`).join('\n'));
  }
  throw new Error(`nothing matching ${test} appeared`);
}
const tap = (n) => sh(`input tap ${Math.round(n.x)} ${Math.round(n.y)}`);

// Whether what Photos is showing is the image that was pushed. It has to be
// checked, not assumed: asked to open a picture it has not finished
// registering, Photos opened one of the phone owner's own photos instead,
// and the run went on into the editor with it. Both are brought to 48x48
// greys — the screen's copy cut from where Photos drew the photo — and
// compared; a different photo is nowhere near.
let browser = null;
async function showing(image, box) {
  browser ||= await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  const shot = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 1e8 }).toString('base64');
  const diff = await page.evaluate(async ({ shot, want, mime, box }) => {
    const load = async (b64, type) => createImageBitmap(await (await fetch(`data:${type};base64,${b64}`)).blob());
    const [screen, target] = await Promise.all([load(shot, 'image/png'), load(want, mime)]);
    const grey = (bmp, sx, sy, sw, sh) => {
      const c = new OffscreenCanvas(48, 48); const g = c.getContext('2d');
      g.drawImage(bmp, sx, sy, sw, sh, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48).data; const out = [];
      for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      return out;
    };
    // Where the photo sits inside the view: fitted, centred.
    const s = Math.min(box.w / target.width, box.h / target.height);
    const w = target.width * s, h = target.height * s;
    const a = grey(screen, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
    const b = grey(target, 0, 0, target.width, target.height);
    return a.reduce((t, v, i) => t + Math.abs(v - b[i]), 0) / a.length;
  }, { shot, want: fs.readFileSync(image).toString('base64'), mime: /png$/i.test(image) ? 'image/png' : 'image/jpeg', box });
  await page.close();
  return diff;
}
const images = () => sh('content query --uri content://media/external/images/media --projection _id:_data')
  .split('\n').map((l) => /_id=(\d+), _data=(.+)$/.exec(l.trim())).filter(Boolean).map(([, id, file]) => ({ id: Number(id), file }));

// The one-off tips the editor shows the first time: dismiss whatever is up.
async function clearTips() {
  for (let k = 0; k < 3; k++) {
    const nodes = screen();
    const tip = find(nodes, /Select to edit|Crop as soon|Tap, circle|Drag from the corners/);
    if (!tip) return;
    // Some end in Done; the first has only an arrow, bottom centre.
    const done = find(nodes, /^Done$/);
    if (done) tap(done); else sh(`input tap ${Math.round(SCREEN_W / 2)} ${Math.round(SCREEN_H * 0.904)}`);
    await sleep(1500);
  }
}

// The slider shows its value as a number beside it while a tool is open.
// Big swipes to get near, then short ones, reading it back each time.
async function setSlider(target) {
  // The control itself, not the tool's name, which is on screen in the
  // search results before the tool has opened.
  const seek = await waitFor((nodes) => nodes.find((n) => /SeekBar/.test(n.cls)));
  const read = () => Number((screen().find((n) => /^-?\d+$/.test(n.text)) || { text: '0' }).text);
  const width = seek.x2 - seek.x1;
  // Units per pixel of swipe: a guess to start, the full range over about the
  // bar's width, then learned from each nudge. The ruler has momentum and the
  // guess alone overshot, settling on 48 for 50.
  let perPx = 100 / (width * 0.9);
  for (let k = 0; k < 30; k++) {
    const now = read();
    if (now === target) return now;
    const want = target - now;
    const dx = Math.sign(want) * Math.max(2, Math.round(Math.abs(want) / perPx));
    // Slowly, so the ruler does not fling on past where the finger stops.
    sh(`input swipe ${Math.round(seek.x)} ${Math.round(seek.y)} ${Math.round(seek.x - dx)} ${Math.round(seek.y)} 900`);
    await sleep(900);
    const moved = read() - now;
    if (moved && Math.sign(moved) === Math.sign(dx)) perPx = Math.abs(moved / dx);
  }
  // The ruler only lands near on some phones: on a Galaxy S23 Ultra it took
  // thirty nudges and settled on 54 for 50. Sharpen's slider is linear, so a
  // copy at 54 measures as well as one at 50 provided it is compared with the
  // app at 54 — which is why the file is named for where it really landed.
  const got = read();
  if (Math.abs(got - target) > 5) throw new Error(`slider settled on ${got}, not ${target}`);
  return got;
}

async function editOne(image, tool, value, saveAs) {
  const name = `${path.basename(image, path.extname(image))}-${Date.now()}${path.extname(image)}`;
  adb('push', image, `/sdcard/Pictures/${name}`);
  sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/${name} >/dev/null`);
  await sleep(2000);
  const pushed = images().find((i) => i.file.endsWith(name));
  if (!pushed) throw new Error('the pushed image never reached the media store');
  try {
    let edit = null;
    for (let attempt = 0; attempt < 2 && !edit; attempt++) {
      await sleep(3000 * (attempt + 1));
      sh(`am start -a android.intent.action.VIEW -d content://media/external/images/media/${pushed.id} -t image/* -p com.google.android.apps.photos >/dev/null`);
      const button = await waitFor(/^Edit$/);
      const view = screen().find((n) => n.desc === 'Photo' || /ImageView/.test(n.cls) && n.x2 - n.x1 > SCREEN_W * 0.8);
      const box = view ? { x: view.x1, y: 0, w: view.x2 - view.x1, h: SCREEN_H } : { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
      const diff = await showing(image, box);
      console.error(`on screen vs pushed image: difference ${diff.toFixed(1)} (under 20 counts as the same)`);
      if (diff < 20) edit = button;
      else { console.error(`Photos is showing something else (difference ${diff.toFixed(0)}); backing out`); sh('input keyevent KEYCODE_BACK'); }
    }
    if (!edit) throw new Error('Photos would not open the pushed image; nothing was edited');
    tap(edit);
    await sleep(2000);
    await clearTips();
    tap(await waitFor(/Open tool search/));
    await waitFor(/Toolbox search box/);
    sh(`input text ${tool}`);
    // The result, not the search box, which by now holds the same word.
    tap(await waitFor((nodes) => nodes.find((n) => /TextView/.test(n.cls) && new RegExp(`^${tool}$`, 'i').test(n.text))));
    await clearTips();
    const landed = await setSlider(value);
    saveAs = saveAs.replace(/[+-]\d+(\.jpg)$/, `${landed >= 0 ? '+' : ''}${landed}$1`);
    tap(await waitFor(/^Done$/));
    const before = new Set(images().map((i) => i.id));
    tap(await waitFor(/Save as copy/, 120000));
    let copy = null;
    for (const until = Date.now() + 180000; !copy && Date.now() < until; await sleep(2000)) copy = images().find((i) => !before.has(i.id));
    if (!copy) {
      if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, 'nocopy.png'), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 1e8 }));
      throw new Error('no copy was saved');
    }
    adb('pull', copy.file, saveAs);
    console.log(path.basename(saveAs));
    sh(`rm "${copy.file}"`);
    sh(`content delete --uri content://media/external/images/media/${copy.id}`);
  } finally {
    sh(`rm "/sdcard/Pictures/${name}"`);
    sh(`content delete --uri content://media/external/images/media/${pushed.id}`);
    sh('input keyevent KEYCODE_HOME');
  }
}

const [cmd, dir, image, ...settings] = process.argv.slice(2);
if (cmd !== 'edit' || !dir || !image || !settings.length) {
  console.error('usage: node google-android.mjs edit <dir> <image> <tool±value> ...');
  process.exit(2);
}
fs.mkdirSync(dir, { recursive: true });
// Nothing touches the device until the arguments have been checked.
[SCREEN_W, SCREEN_H] = (/(\d+)x(\d+)/.exec(sh('wm size')) || [0, 1080, 2400]).slice(1).map(Number);
// Awake for the run, and back to the phone's own setting after it, however
// the run ends: it was left on for good once, on someone's own phone.
sh('svc power stayon true');
// The screen dumps land in shared storage and the media store indexes them,
// so they go too: nothing of the run's should be left on somebody's phone.
process.on('exit', () => {
  try { sh('svc power stayon false'); } catch { /* device gone */ }
  try { sh('rm -f /sdcard/ui.xml; content delete --uri content://media/external/file --where "_data=\'/storage/emulated/0/ui.xml\'"'); } catch { /* device gone */ }
});
for (const setting of settings) {
  const [, tool, value] = /^([a-zA-Z]+)([+-]\d+)$/.exec(setting) || [];
  if (!tool) throw new Error(`not a setting: ${setting}`);
  const label = tool[0].toUpperCase() + tool.slice(1);
  await editOne(image, label, Number(value), path.join(dir, `${setting}.jpg`));
}
if (browser) await browser.close();
