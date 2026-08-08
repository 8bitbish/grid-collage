/* Files that a strict decoder turns down. The point is twofold: the ones
   that can be read should be read, and the ones that can't should say why
   rather than "couldn't read it". */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';

const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8199,r));
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails+=1; console.log(`  ${pass?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`); };

function png(w,h,rgb){
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;
    raw[o]=rgb[0];raw[o+1]=rgb[1];raw[o+2]=rgb[2];}}
  const tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;tbl[n]=c;}
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=tbl[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const body=Buffer.concat([Buffer.from(t),d]);
    const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([l,body,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}

// A real JPEG, made by the browser, so the truncation below cuts genuine
// entropy-coded data rather than a hand-rolled approximation of it.
const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
const warns=[]; p.on('console',m=>{ if(m.type()==='warning') warns.push(m.text()); if(m.type()==='error') errs.push(m.text()); });
await p.goto('http://localhost:8199/');

const realJpeg = Buffer.from(await p.evaluate(async ()=>{
  const c=document.createElement('canvas'); c.width=c.height=700;
  const g=c.getContext('2d');
  // Noise, so the compressed data is long and a cut lands mid-scan.
  const d=g.createImageData(700,700);
  for(let i=0;i<d.data.length;i+=4){ d.data[i]=(i*7)%256; d.data[i+1]=(i*13)%256; d.data[i+2]=(i*29)%256; d.data[i+3]=255; }
  g.putImageData(d,0,0);
  const blob=await new Promise((r)=>c.toBlob(r,'image/jpeg',0.9));
  return [...new Uint8Array(await blob.arrayBuffer())];
}));
console.log('a real JPEG:', realJpeg.length, 'bytes');

// Chop the last fifth off: the header, the tables and most of the scan are
// there, but there is no EOI and the data stops mid-stream. This is what a
// half-finished save or a cut-short download leaves behind.
const truncated = realJpeg.subarray(0, Math.floor(realJpeg.length * 0.8));
const heicish = Buffer.concat([Buffer.from([0,0,0,0x20]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
const mp4ish  = Buffer.concat([Buffer.from([0,0,0,0x20]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

const CASES = [
  { label: 'a JPEG cut short — the case a strict decoder refuses',
    file: { name: 'insta_truncated.jpg', mimeType: 'image/jpeg', buffer: truncated }, expect: 'imported' },
  { label: 'a plain PNG, as a control',
    file: { name: 'fine.png', mimeType: 'image/png', buffer: png(400,400,[90,150,220]) }, expect: 'imported' },
  { label: 'a WEBP wearing a .jpg name',
    file: { name: 'saved.jpg', mimeType: 'image/jpeg', buffer: null }, expect: 'imported', webp: true },
  { label: 'a JPEG the picker gave no type for',
    file: { name: 'no_type.jpg', mimeType: '', buffer: realJpeg }, expect: 'imported' },
  { label: 'an empty file',
    file: { name: 'zero.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) }, expect: 'empty' },
  { label: 'HEIC calling itself a jpg',
    file: { name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: heicish }, expect: 'HEIC' },
  // Sniffed as video now, so it goes down the video path and fails there —
  // 76 bytes of box header is not a film.
  { label: 'a broken video calling itself a jpg',
    file: { name: 'clip.jpg', mimeType: 'image/jpeg', buffer: mp4ish }, expect: "can't play" },
  { label: 'something that is not an image at all',
    file: { name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('just some text, at length, honestly') },
    expect: 'recognise' },
];

// A real WEBP, again from the browser.
CASES[2].file.buffer = Buffer.from(await p.evaluate(async ()=>{
  const c=document.createElement('canvas'); c.width=c.height=300;
  const g=c.getContext('2d'); g.fillStyle='#3a7'; g.fillRect(0,0,300,300);
  const blob=await new Promise((r)=>c.toBlob(r,'image/webp',0.9));
  return [...new Uint8Array(await blob.arrayBuffer())];
}));

await p.click('#home-first');
await p.waitForFunction(()=>!document.body.classList.contains('on-home'),{timeout:8000});

for (const c of CASES) {
  const before = Number(await p.evaluate(()=>document.getElementById('photos-count').textContent));
  warns.length = 0;
  await p.setInputFiles('#file-input', [c.file]);
  await p.waitForTimeout(1800);
  const after = Number(await p.evaluate(()=>document.getElementById('photos-count').textContent));
  const msg = await p.evaluate(()=>document.getElementById('toast').textContent);
  const grew = after > before;

  console.log(`\n${c.label}`);
  console.log(`  count ${before} -> ${after} | toast: ${JSON.stringify(msg)}`);
  if (c.expect === 'imported') {
    ok('it got in', grew);
    if (grew) {
      const px = await p.evaluate(()=>{
        const cv=document.getElementById('canvas');
        const d=cv.getContext('2d').getImageData(Math.floor(cv.width/2), Math.floor(cv.height/2), 1, 1).data;
        return `${d[0]},${d[1]},${d[2]}`;});
      console.log('  and it draws:', px);
    }
  } else {
    ok('it was turned down', !grew);
    ok(`and said why (${c.expect})`, new RegExp(c.expect, 'i').test(msg), msg);
    // The toast is gone in three seconds; the console entry is what you can
    // read back, so it has to actually be there.
    ok('with the file details on the console', warns.some(w=>/Import failed/.test(w)),
       JSON.stringify(warns.slice(0, 2)));
  }
}

console.log('\n== the console record ==');
console.log(' ', warns.filter(w=>/Import failed/.test(w)).length, 'failures logged with the file details');

console.log('\n== a non-image alone no longer vanishes silently ==');
{
  // The strip holds a text node and a progress bar now, so clear the text
  // rather than the element — emptying the element takes the bar with it.
  await p.evaluate(()=>{ document.getElementById('toast-text').textContent=''; });
  const before = Number(await p.evaluate(()=>document.getElementById('photos-count').textContent));
  await p.setInputFiles('#file-input', [{ name:'doc.pdf', mimeType:'application/pdf', buffer: Buffer.from('%PDF-1.4 hello') }]);
  await p.waitForTimeout(900);
  const msg = await p.evaluate(()=>document.getElementById('toast').textContent);
  const after = Number(await p.evaluate(()=>document.getElementById('photos-count').textContent));
  console.log('  toast:', JSON.stringify(msg));
  ok('nothing imported', after === before);
  ok('and it said so', /isn't a photo or a video/.test(msg), msg);
}

console.log('\nerrors:', errs.length?errs.join(' | '):'none');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await b.close(); srv.close();
process.exit(fails?1:0);
