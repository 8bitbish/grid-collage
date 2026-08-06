import { chromium } from 'playwright';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const ROOT='/home/user/grid-collage';
const OUT='/tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad/shots';
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8172,r));
const j=o=>JSON.stringify(o);

/* A baseline JPEG, hand-built, with a real EXIF APP1 carrying
   DateTimeOriginal — so the app's parser is tested against bytes it would
   actually meet, not a stub. */
function jpeg(rgb, dateText) {
  const b=[];
  const u8=(...v)=>b.push(...v);
  const u16=(v)=>b.push(v>>8&255, v&255);
  u16(0xffd8);                                            // SOI

  if (dateText) {
    // TIFF: little-endian, IFD0 with one entry (ExifIFD pointer), then the
    // Exif sub-IFD with DateTimeOriginal as a 20-byte ASCII value.
    const tiff=[];
    const t8=(...v)=>tiff.push(...v);
    const t16=(v)=>tiff.push(v&255, v>>8&255);            // little-endian
    const t32=(v)=>tiff.push(v&255, v>>8&255, v>>16&255, v>>24&255);
    t8(0x49,0x49); t16(42); t32(8);                       // header, IFD0 at 8
    t16(1);                                               // one entry
    t16(0x8769); t16(4); t32(1); t32(26);                 // ExifIFD -> offset 26
    t32(0);                                               // no IFD1
    // offset 26: the Exif sub-IFD
    t16(1);
    t16(0x9003); t16(2); t32(20); t32(44);                // DateTimeOriginal @44
    t32(0);
    // offset 44: the string, NUL terminated, 20 bytes
    const s = dateText.padEnd(19, ' ').slice(0,19);
    for (const c of s) tiff.push(c.charCodeAt(0));
    tiff.push(0);
    const app1 = [0x45,0x78,0x69,0x66,0,0, ...tiff];      // "Exif\0\0" + TIFF
    u16(0xffe1); u16(app1.length + 2); u8(...app1);
  }

  // A minimal 8x8 baseline frame. Quality is irrelevant; it only has to decode.
  const q=[]; for(let i=0;i<64;i++) q.push(16);
  u16(0xffdb); u16(67); u8(0); u8(...q);
  u16(0xffc0); u16(11); u8(8); u16(8); u16(8); u8(1); u8(1,0x11,0);
  // Huffman tables: the JPEG standard's example DC/AC luminance tables.
  const dcBits=[0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], dcVals=[0,1,2,3,4,5,6,7,8,9,10,11];
  u16(0xffc4); u16(2+1+16+dcVals.length); u8(0x00); u8(...dcBits); u8(...dcVals);
  const acBits=[0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
  const acVals=[0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
    0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,
    0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,
    0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,
    0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,
    0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,
    0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,
    0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,
    0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
    0xf9,0xfa];
  u16(0xffc4); u16(2+1+16+acVals.length); u8(0x10); u8(...acBits); u8(...acVals);
  u16(0xffda); u16(8); u8(1); u8(1,0x00); u8(0,63,0);
  u8(0xfc, 0xff, 0x00);                                   // a grey block
  u16(0xffd9);
  return Buffer.from(b);
}

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8172/');
await p.waitForTimeout(400);

// Dates chosen relative to now, so the labels are checkable whenever this runs.
const at = (daysAgo, hh) => {
  const d = new Date(Date.now() - daysAgo*86400000);
  const pad=(n)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}:${pad(d.getMonth()+1)}:${pad(d.getDate())} ${pad(hh)}:00:00`;
};
const files = [
  { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpeg(0, at(4, 9)) },
  { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpeg(0, at(0, 8)) },   // today, early
  { name: 'c.jpg', mimeType: 'image/jpeg', buffer: jpeg(0, at(1, 15)) },  // yesterday
  { name: 'd.jpg', mimeType: 'image/jpeg', buffer: jpeg(0, at(0, 20)) },  // today, late
  { name: 'e.jpg', mimeType: 'image/jpeg', buffer: jpeg(0, at(4, 18)) },
];
await p.setInputFiles('#file-input', files);
await p.waitForFunction(()=>document.querySelectorAll('.film').length===5, {timeout:12000});
await p.waitForTimeout(600);

console.log('== the date came out of the EXIF, not the file ==');
console.log(' ', j(await p.evaluate(()=>{
  // The app keeps them in import order; read the dates it parsed.
  const seen = [...document.querySelectorAll('.pm-item')];
  return { imported: document.querySelectorAll('.film').length };
})));
await p.click('#btn-photos');
await p.waitForTimeout(400);

const groups = await p.evaluate(()=>{
  const out=[];
  document.querySelectorAll('#pm-grid > *').forEach((el)=>{
    if (el.classList.contains('pm-day')) out.push({ day: el.textContent, photos: 0 });
    else if (out.length) out[out.length-1].photos = el.querySelectorAll('.pm-item').length;
  });
  return out;});
console.log('  day headers, in order:', j(groups));
console.log('  newest day first:', groups[0] && groups[0].day === 'Today' ? '✓' : '✗');
console.log('  both of today under Today:', groups[0] && groups[0].photos === 2 ? '✓' : '✗');
console.log('  yesterday named, not dated:', groups[1] && groups[1].day === 'Yesterday' ? '✓' : '✗');
console.log('  the older pair share one day:', groups[2] && groups[2].photos === 2 ? '✓' : `✗ ${j(groups[2])}`);
console.log('  three days in all:', groups.length === 3 ? '✓' : `✗ ${groups.length}`);

console.log('\n== within a day, newest first ==');
console.log(' ', j(await p.evaluate(()=>{
  const first = document.querySelector('.pm-row');
  return [...first.querySelectorAll('.pm-pick')].map(el=>el.getAttribute('aria-label'));})));

console.log('\n== how it looks ==');
console.log(' ', j(await p.evaluate(()=>{
  const item = document.querySelector('.pm-item');
  const row = document.querySelector('.pm-row');
  const head = document.querySelector('.pm-day');
  const cs = getComputedStyle(item);
  return { corners: cs.borderRadius, gap: getComputedStyle(row).gap,
           bodyPadding: getComputedStyle(document.querySelector('.pm-body')).padding,
           headerSticky: getComputedStyle(head).position };})));
await p.locator('.pm-card').screenshot({path:`${OUT}/library-days.png`});

console.log('\n== the day survives a restart ==');
await p.click('#pm-close');
await p.reload();
await p.waitForFunction(()=>document.querySelectorAll('.film').length===5, {timeout:12000});
await p.waitForTimeout(700);
await p.click('#btn-photos');
await p.waitForTimeout(400);
const after = await p.evaluate(()=>[...document.querySelectorAll('.pm-day')].map(e=>e.textContent));
console.log('  headers after a reload:', j(after),
            j(after)===j(groups.map(g=>g.day)) ? '✓ same' : '✗ changed');

console.log('\n== a photo with no EXIF at all ==');
await p.click('#pm-close'); await p.waitForTimeout(200);
{
  const chooser = p.waitForEvent('filechooser');
  await p.click('#btn-photos'); await p.waitForTimeout(300);
  await p.click('#pm-add');
  (await chooser).setFiles([{ name: 'plain.jpg', mimeType: 'image/jpeg', buffer: jpeg(0, null) }]);
  await p.waitForFunction(()=>document.querySelectorAll('.pm-item').length===6, {timeout:12000});
  await p.waitForTimeout(400);
  const heads = await p.evaluate(()=>[...document.querySelectorAll('.pm-day')].map(e=>e.textContent));
  console.log('  falls back to the file date:', j(heads), heads[0]==='Today' ? '✓ grouped under today' : '✗');
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
await b.close(); srv.close();
