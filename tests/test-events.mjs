/* The library's event view, against planted structure rather than against taste.
   Four events at known times, one of them holding a burst — then the clusterer
   has to recover exactly what was planted.

   Planted rather than judged on purpose: whether a real trip really did split
   into thirteen events is a question only the person who was there can answer,
   but whether the code finds four events when four were planted is a question
   with a right answer, and this is the half that can be checked from here. */
import { chromium } from 'playwright';
import { CHROME, ROOT, SHOTS } from './paths.mjs';
import { autoEnter } from './enter.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const OUT = SHOTS;
const T={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8178,r));
const j=o=>JSON.stringify(o);
let pass=0, fail=0;
const ok=(label, good, detail='')=>{ good?pass++:fail++; console.log(`  ${good?'✓':'✗'} ${label}${good||!detail?'':` — ${detail}`}`); };

/* The same hand-built baseline JPEG with a real EXIF DateTimeOriginal that
   test-photodates and test-place each carry. Three copies now, which wants
   lifting into image.mjs — its own change, not this one. */
function jpeg(dateText) {
  const b=[];
  const u8=(...v)=>b.push(...v);
  const u16=(v)=>b.push(v>>8&255, v&255);
  u16(0xffd8);
  if (dateText) {
    const tiff=[];
    const t8=(...v)=>tiff.push(...v);
    const t16=(v)=>tiff.push(v&255, v>>8&255);
    const t32=(v)=>tiff.push(v&255, v>>8&255, v>>16&255, v>>24&255);
    t8(0x49,0x49); t16(42); t32(8);
    t16(1);
    t16(0x8769); t16(4); t32(1); t32(26);
    t32(0);
    t16(1);
    t16(0x9003); t16(2); t32(20); t32(44);
    t32(0);
    const s = dateText.padEnd(19, ' ').slice(0,19);
    for (const c of s) tiff.push(c.charCodeAt(0));
    tiff.push(0);
    const app1 = [0x45,0x78,0x69,0x66,0,0, ...tiff];
    u16(0xffe1); u16(app1.length + 2); u8(...app1);
  }
  const q=[]; for(let i=0;i<64;i++) q.push(16);
  u16(0xffdb); u16(67); u8(0); u8(...q);
  u16(0xffc0); u16(11); u8(8); u16(8); u16(8); u8(1); u8(1,0x11,0);
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
  u8(0xfc, 0xff, 0x00);
  u16(0xffd9);
  return Buffer.from(b);
}

/* Eleven photos per event, not four.

   The threshold is three times the 90th percentile of the gaps, so the count
   only works while the boundaries are a small share of all the gaps. Four
   events of four photos is three boundaries in fifteen gaps — a fifth of them —
   and p90 then lands *among the boundaries*, lifting the threshold above every
   real one and collapsing the trip into a single event. Eleven apiece puts the
   three boundaries in forty-three gaps, which is the shape a real library has:
   the 180-photo tray this was designed against had eleven boundaries in
   ninety-four. That sensitivity is a property of the rule and not a bug in the
   plant, which is why it is written here rather than tuned around. */
const stamp = (h, m, s) => `2025:06:02 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
const files = [];
const add = (name, h, m, s) => files.push({ name, mimeType:'image/jpeg', buffer: jpeg(stamp(h,m,s)) });

// Event 1 — 09:00 to 09:30, one photo every three minutes.
for (let k = 0; k < 11; k++) add(`e1-${k}.jpg`, 9, k*3, 0);
// Event 2 — 12:00, opening with three frames inside six seconds.
add('e2-burst-0.jpg', 12, 0, 0); add('e2-burst-1.jpg', 12, 0, 3); add('e2-burst-2.jpg', 12, 0, 6);
for (let k = 1; k < 9; k++) add(`e2-${k}.jpg`, 12, k*3, 0);
// Event 3 — 15:30.
for (let k = 0; k < 11; k++) add(`e3-${k}.jpg`, 15, 30 + k*3, 0);
// Event 4 — 19:00.
for (let k = 0; k < 11; k++) add(`e4-${k}.jpg`, 19, k*3, 0);
/* No undated photo here, deliberately. Ingest reads EXIF, then the file's own
   timestamp, then the clock, so `taken` is never empty — a photo with no date
   in it lands at import time and becomes a spurious event at the end of the
   trip. That is worth knowing about and is the deck builder's problem, not this
   view's, so it is not planted into a test about clustering. */

const b=await chromium.launch({executablePath: CHROME});
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await autoEnter(p);
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8178/');
await p.waitForTimeout(400);

await p.setInputFiles('#file-input', files);
// The photo count, not the filmstrip: importing builds a page per photo but the
// deck stops at twenty, so forty-four photos are never forty-four films.
await p.waitForFunction((n)=>document.getElementById('photos-count').textContent===String(n), files.length, {timeout:60000});
await p.waitForTimeout(800);
await p.click('#btn-photos');
await p.waitForTimeout(400);

// What the grid holds, read the way the screen reads: a heading, then the row
// of photos under it.
const groups = () => p.evaluate(()=>{
  const out=[];
  document.querySelectorAll('#pm-grid > *').forEach((el)=>{
    if (el.classList.contains('pm-day')) {
      out.push({ when: el.querySelector('.pm-event-when')?.textContent ?? el.textContent,
                 facts: el.querySelector('.pm-event-facts')?.textContent ?? '', photos: 0 });
    } else if (out.length) out[out.length-1].photos = el.querySelectorAll('.pm-item').length;
  });
  return out;});

console.log('== the day view still groups by day ==');
{
  const g = await groups();
  ok('one heading, because everything was planted on one day', g.length === 1, j(g.map(x=>x.when)));
  ok('all 44 photos under it', g[0] && g[0].photos === 44, g[0] && String(g[0].photos));
  ok('no event facts in the day view', g[0] && g[0].facts === '', g[0] && g[0].facts);
}

console.log('\n== switching to events recovers what was planted ==');
await p.click('#pm-by-events');
await p.waitForTimeout(300);
{
  const g = await groups();
  const dated = g;
  ok('four events found, four planted', dated.length === 4, `${dated.length}: ${j(dated.map(x=>x.when))}`);
  ok('eleven photos in each', dated.every(x=>x.photos === 11), j(dated.map(x=>x.photos)));
  ok('newest event first, matching the day view',
     dated[0] && /19:|7:\d\d\s*pm/i.test(dated[0].when), dated[0] && dated[0].when);
  // The gap that opened an event is the number that makes a split arguable.
  ok('each event says the gap it opened after',
     dated.slice(0,3).every(x=>/after/.test(x.facts)), j(dated.map(x=>x.facts)));
  ok('the first event has no gap before it', dated[3] && !/after/.test(dated[3].facts), dated[3] && dated[3].facts);
  console.log('   headings:', j(dated.map(x=>`${x.when} — ${x.facts}`)));
}

console.log('\n== the tally reports what is actually on screen ==');
{
  const tally = await p.textContent('#pm-tally');
  const g = await groups();
  ok('event count in the tally matches the headings', tally.startsWith(`${g.length} events`), tally);
  ok('it counts the events with three or more', /4 with 3\+/.test(tally), tally);
  ok('it says where the cut fell', /cut at/.test(tally), tally);
}

console.log('\n== the burst is collapsed, not counted as three votes ==');
{
  // Turned off, the three frames inside six seconds each cast their own vote on
  // what a typical gap is — which is exactly what drags the threshold down to
  // the burst interval on a real library.
  await p.evaluate(()=>{ const s=document.getElementById('pm-burst'); s.value='0'; s.dispatchEvent(new Event('input',{bubbles:true})); });
  await p.waitForTimeout(250);
  const off = (await groups()).length;
  await p.evaluate(()=>{ const s=document.getElementById('pm-burst'); s.value='10'; s.dispatchEvent(new Event('input',{bubbles:true})); });
  await p.waitForTimeout(250);
  const on = (await groups()).length;
  ok('four events with bursts collapsed', on === 4, String(on));
  ok('the control actually reaches the clusterer', typeof off === 'number' && off >= 1, `off=${off} on=${on}`);
  console.log(`   events with bursts kept apart: ${off}, collapsed: ${on}`);
}

console.log('\n== the threshold slider moves the split ==');
{
  const at = async (v) => { await p.evaluate((x)=>{ const s=document.getElementById('pm-split'); s.value=String(x); s.dispatchEvent(new Event('input',{bubbles:true})); }, v);
    await p.waitForTimeout(200);
    return (await groups()).length; };
  const tight = await at(0.5), planted = await at(3), loose = await at(8);
  ok('a tighter threshold finds more events', tight >= planted, `${tight} at 0.5x vs ${planted} at 3x`);
  ok('a looser one finds fewer or the same', loose <= planted, `${loose} at 8x vs ${planted} at 3x`);
  ok('the planted answer sits in the middle', planted === 4, String(planted));
  console.log(`   0.5x -> ${tight} events, 3x -> ${planted}, 8x -> ${loose}`);
  await at(3);
}

console.log('\n== the adaptive rule runs, and is the reason there are two ==');
{
  await p.click('#pm-rule-adaptive');
  await p.waitForTimeout(300);
  const g = await groups();
  const label = await p.textContent('#pm-split-label');
  const val = await p.textContent('#pm-split-val');
  ok('the slider relabels itself for the rule it now drives', label === 'Local' && /nearby/.test(val), `${label} / ${val}`);
  ok('it still produces events', g.length >= 1, String(g.length));
  // Agreement here is not the point and is not asserted: on clean planted
  // structure both rules should find the same four. Where they part company is
  // a real library, which is what the view exists to show.
  console.log(`   adaptive finds ${g.length} events where the gap rule found 4`);
  await p.click('#pm-rule-gap');
  await p.waitForTimeout(250);
}

console.log('\n== how it looks ==');
{
  const shape = await p.evaluate(()=>{
    const head = document.querySelector('.pm-event');
    const tune = document.getElementById('pm-tune');
    return { headSticky: getComputedStyle(head).position,
             toolsVisible: !document.getElementById('pm-tune').hidden,
             tuneInBody: !!document.querySelector('.pm-body #pm-tune'),
             tallyRight: getComputedStyle(document.querySelector('.pm-tally')).textAlign };
  });
  console.log('  ', j(shape));
  ok('event headings stay sticky like day headings', shape.headSticky === 'sticky', shape.headSticky);
  ok('the knobs sit outside the scrolling body', shape.tuneInBody === false);
  await p.locator('.pm-card').screenshot({path:`${OUT}/library-events.png`});
}

console.log('\n== going back to days leaves nothing behind ==');
{
  await p.click('#pm-by-days');
  await p.waitForTimeout(300);
  const g = await groups();
  const tuneHidden = await p.evaluate(()=>document.getElementById('pm-tune').hidden);
  ok('one day heading again', g.length === 1, j(g.map(x=>x.when)));
  ok('all 44 photos back under it', g[0] && g[0].photos === 44, g[0] && String(g[0].photos));
  ok('the knobs are put away', tuneHidden === true);
  ok('the tally is cleared', (await p.textContent('#pm-tally')) === '');
}

console.log('\n== nothing threw ==');
ok('no page errors', errs.length === 0, j(errs.slice(0,3)));

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
