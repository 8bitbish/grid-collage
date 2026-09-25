/* Google Photos on the web, driven from here, so a tool can be measured
 * against Google's without a phone and a person in the loop.
 *
 *   node google-web.mjs login     opens Chrome on photos.google.com; sign in
 *                                 there yourself, and it closes once you have
 *   node google-web.mjs check     headless: says whether the session still works
 *   node google-web.mjs edit <dir> <setting> ...
 *                                 uploads the chart, and for each setting —
 *                                 blackPoint+100, shadows-50, or several at
 *                                 once as brightness+50,warmth-25 — saves an edited
 *                                 copy and downloads it as <dir>/<setting>.jpg,
 *                                 ready for measure.mjs. Everything it uploaded
 *                                 or saved is binned afterwards, and the Bin
 *                                 emptied if nothing else is in it.
 *                                 --chart=<file> edits another image instead.
 *
 * The web editor is the same engine as the Android app: Black point +100 from
 * each matched to within a level at all 256 levels of the ramp (mean 0.02),
 * and the colour patches to within JPEG's noise. It has no Sharpen, though.
 *
 * The session lives in a Chrome profile outside the repository, in
 * ~/.grid-collage/google-photos (GOOGLE_PROFILE overrides it). Deleting that
 * folder signs it out. Use a spare account: the chart gets uploaded to it.
 *
 * Real Chrome rather than the suite's Chromium, and without the flag that
 * announces automation, because Google's sign-in refuses browsers it takes
 * for automated ones.
 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL } from 'node:url';

const PROFILE = process.env.GOOGLE_PROFILE || path.join(os.homedir(), '.grid-collage', 'google-photos');
const HOME = 'https://photos.google.com/';

export async function open({ headless = true } = {}) {
  fs.mkdirSync(PROFILE, { recursive: true });
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    viewport: { width: 1400, height: 1000 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

// Signed in is being on Photos itself rather than bounced to the account
// chooser or the product's marketing page.
const signedIn = (url) => url.startsWith(HOME) && !/about|intl|signin/.test(url);

// Only as a command; other scripts import open() and the steps below.
const cmd = import.meta.url === pathToFileURL(process.argv[1]).href ? process.argv[2] : null;

// The editor's Adjust sliders by the names used for them here and in
// ADJUSTMENTS. The editor's own labels, which are what is matched on.
const SLIDERS = {
  hdr: 'HDR effect', brightness: 'Brightness', contrast: 'Contrast', whitePoint: 'White point',
  highlights: 'Highlights', shadows: 'Shadow', blackPoint: 'Black point', saturation: 'Saturation',
  warmth: 'Warmth', tint: 'Tint', skinTone: 'Skin tone', blueTone: 'Blue tone', pop: 'Pop', vignette: 'Vignette',
};

// Google Photos quietly drops an upload identical to a photo it already has,
// so a second run, or a run after one that failed to clean up, uploaded
// nothing. A text chunk naming the moment makes every upload a new file
// without touching a pixel of it.
function unique(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) return png;
  const table = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from(`grid-collage\0${new Date().toISOString()}`)]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc(body), body.length + 4);
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

// Upload by dropping the file on the page, as a person dragging it would: the
// import menu opens the browser's file picker by an API Playwright cannot
// answer. Resolves to the new photo's address.
export async function upload(page, file) {
  await page.goto(HOME);
  await page.waitForTimeout(3000);
  const before = new Set(await page.$$eval('a[href*="/photo/"]', (els) => els.map((e) => e.href)));
  const b64 = unique(fs.readFileSync(file)).toString('base64');
  await page.evaluate(async ({ b64, name }) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: blob.type || 'image/png', lastModified: Date.now() }));
    const at = { clientX: innerWidth / 2, clientY: innerHeight / 2 };
    const target = document.elementFromPoint(at.clientX, at.clientY) || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
      await new Promise((r) => setTimeout(r, 200));
    }
  }, { b64, name: path.basename(file) });
  // Asked once per account. Original quality, or the chart would be
  // recompressed before any edit touched it.
  await page.waitForTimeout(1500);
  const quality = page.getByRole('button', { name: 'Continue' });
  if (await quality.isVisible().catch(() => false)) {
    await page.getByText('Original quality').click();
    await quality.click();
  }
  for (let k = 0; k < 60; k++) {
    const now = await page.$$eval('a[href*="/photo/"]', (els) => els.map((e) => e.href));
    const added = now.find((h) => !before.has(h));
    if (added) return added.split('?')[0];
    await page.waitForTimeout(1000);
  }
  throw new Error('the upload never appeared');
}

// One setting on one photo: into the editor, the sliders set, a copy saved
// and downloaded. Resolves to the copy's address, so it can be binned.
// `sliders` is [[id, value], ...]; more than one is how the order Google
// applies its tools in was read, since each tool alone cannot say it.
export async function editCopy(page, photo, sliders, saveAs) {
  for (const [id] of sliders) if (!SLIDERS[id]) throw new Error(`no slider for ${id}`);
  await page.goto(photo);
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.waitForTimeout(4000);
  await page.locator('[aria-label="Adjust"]').first().click();
  await page.waitForTimeout(2000);
  for (const [id, value] of sliders) {
    const set = await page.evaluate(({ label, value }) => {
      // The sliders carry no labels of their own; their names are the only
      // leaf text in each row, and the two come in the same order.
      const inputs = [...document.querySelectorAll('input[type=range]')].filter((e) => e.offsetParent !== null);
      const sidebar = document.querySelector('[aria-label="Editor sidebar"]');
      const names = [...sidebar.querySelectorAll('*')]
        .filter((e) => e.children.length === 0 && e.offsetParent !== null)
        .map((e) => (e.textContent || '').trim())
        .filter((t) => /^[A-Z][A-Za-z ]+$/.test(t));
      if (names.length !== inputs.length) return `${names.length} names for ${inputs.length} sliders`;
      const el = inputs[names.indexOf(label)];
      if (!el) return `no ${label} among ${names.join(', ')}`;
      // Through the native setter, so the page's own listeners see a change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value / 100));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === String(value / 100) ? null : `slider read back ${el.value}`;
    }, { label: SLIDERS[id], value });
    if (set) throw new Error(`setting ${id} to ${value}: ${set}`);
    await page.waitForTimeout(2500);
  }
  // Save copy lives in the menu beside Save; the edit to the original is
  // never saved, so the next setting starts from the chart as it came.
  await page.locator('[aria-haspopup=menu]:visible').first().click();
  await page.locator('[role=menuitem]:visible', { hasText: 'Save copy' }).first().click();
  // Straight after saving, the address is still the original's /edit; the
  // copy is the first address to name a different photo. Taking the first
  // change for the copy downloaded from inside the editor and binned the
  // wrong photo, and now and then the browser went down mid-download.
  const original = photo.split('/').pop();
  const idOf = () => (/\/photo\/([^/?]+)/.exec(page.url()) || [])[1];
  for (let k = 0; k < 60 && (!idOf() || idOf() === original || /\/edit/.test(page.url())); k++) await page.waitForTimeout(1000);
  const copyId = idOf();
  if (!copyId || copyId === original) throw new Error('the saved copy never opened');
  const copy = `${HOME}photo/${copyId}`;
  // The file itself, fetched from the image server with the session's own
  // cookies, not downloaded through the browser: Chrome quit half a second
  // into a download often enough to fail most runs of more than a setting or
  // two. The viewer shows the copy from an address whose options follow its
  // last '='; '=d' asks for the stored file whole, as Download would.
  await page.goto(copy);
  let src = null;
  for (let k = 0; k < 20 && !src; k++) {
    await page.waitForTimeout(500);
    // The one under the middle of the viewer. The page also keeps the
    // neighbouring photo loaded for swiping to, and the account's avatar is
    // an image from the same servers, so neither size nor host will do.
    src = await page.$$eval('img[src*="usercontent.google.com/pw/"]', (els) => {
      const x = innerWidth / 2, y = innerHeight / 2;
      const here = els.find((e) => { const r = e.getBoundingClientRect(); return e.naturalWidth > 0 && r.left <= x && r.right >= x && r.top <= y && r.bottom >= y; });
      return here ? here.src : null;
    });
  }
  if (!src) throw new Error('the copy never showed its image');
  const file = await page.context().request.get(`${src.replace(/=[^=/]*$/, '')}=d`);
  if (!file.ok()) throw new Error(`fetching the copy: ${file.status()}`);
  fs.writeFileSync(saveAs, await file.body());
  return copy;
}

export async function bin(page, photo) {
  await page.goto(photo);
  await page.waitForTimeout(2500);
  await page.locator('[aria-label="Move to bin"]:visible').first().click();
  // The first time, an explanation to acknowledge with Got it; after that,
  // a plain confirmation. Either one moves it.
  for (let k = 0; k < 3; k++) {
    await page.waitForTimeout(1200);
    const confirm = page.locator('[role=dialog] button:visible, [role=alertdialog] button:visible', { hasText: /^(Got it|Move to bin)$/ });
    if (!(await confirm.count())) break;
    await confirm.last().click();
  }
  await page.waitForTimeout(2000);
}

// Only when the Bin holds exactly what this run put there, photo for photo —
// a Bin item keeps the photo's own id — so nothing the account's owner binned
// is ever deleted for good by this.
export async function emptyBinIf(page, photos) {
  if (!photos.length) return 'nothing to clear';
  const ours = new Set(photos.map((p) => p.split('/').pop()));
  await page.goto(`${HOME}trash`);
  await page.waitForTimeout(3000);
  const inBin = await page.$$eval('a[href*="trash/"]', (els) => els.map((e) => e.getAttribute('href').split('/').pop()));
  if (inBin.length !== ours.size || !inBin.every((id) => ours.has(id))) {
    return `left the Bin alone: it holds ${inBin.length} items, ${inBin.filter((id) => ours.has(id)).length} of them this run's`;
  }
  await page.getByRole('button', { name: /Empty bin/ }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[role=dialog] button:visible, [role=alertdialog] button:visible', { hasText: /Empty bin|Delete/ }).last().click();
  await page.waitForTimeout(3000);
  const after = await page.$$eval('a[href*="trash/"]', (els) => els.length);
  return after ? `the Bin still holds ${after} after emptying` : 'emptied the Bin';
}
if (cmd === 'login') {
  const ctx = await open({ headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(HOME);
  console.log('Sign in in the Chrome window that just opened. It closes by itself once Photos loads.');
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until && !signedIn(page.url())) await page.waitForTimeout(1000);
  // A beat longer, so the cookies of the last redirect are written.
  await page.waitForTimeout(3000);
  console.log(signedIn(page.url()) ? `signed in; session saved in ${PROFILE}` : 'gave up after ten minutes');
  await ctx.close();
} else if (cmd === 'check') {
  const ctx = await open();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(HOME);
  await page.waitForTimeout(4000);
  console.log(signedIn(page.url()) ? 'signed in' : `not signed in (landed on ${page.url()})`);
  await ctx.close();
} else if (cmd === 'edit') {
  const args = process.argv.slice(3);
  const chartArg = args.find((a) => a.startsWith('--chart='));
  const [dir, ...settings] = args.filter((a) => a !== chartArg);
  if (!dir || !settings.length) { console.error('usage: node google-web.mjs edit <dir> <setting> ...'); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await open();
  const page = ctx.pages()[0] || await ctx.newPage();
  const made = [];
  try {
    const chart = await upload(page, chartArg ? chartArg.slice(8) : path.join(import.meta.dirname, 'out', 'chart.png'));
    made.push(chart);
    for (const setting of settings) {
      // brightness+50, or several tools on the one copy: brightness+50,warmth-25
      const sliders = setting.split(',').map((one) => {
        const [, id, value] = /^([a-zA-Z]+)([+-]\d+)$/.exec(one) || [];
        if (!id) throw new Error(`not a setting: ${one}`);
        return [id, Number(value)];
      });
      made.push(await editCopy(page, chart, sliders, path.join(dir, `${setting}.jpg`)));
      console.log(`${setting}.jpg`);
    }
  } finally {
    for (const photo of made) await bin(page, photo).catch((e) => console.error(`could not bin ${photo}: ${e.message}`));
    console.log(await emptyBinIf(page, made).catch((e) => `could not empty the Bin: ${e.message}`));
    await ctx.close();
  }
} else if (cmd) {
  console.error(`no such command: ${cmd}`);
  process.exit(2);
}
