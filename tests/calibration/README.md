# Calibration against Google Photos

The Adjust tools are meant to do what Google Photos' do, and nothing public says
how Google's work — no paper, blog post or patent covers White point,
Highlights, Shadows or Black point. So they were measured instead: one chart,
edited in Google Photos at a spread of settings, read back into numbers, and the
app built to reproduce them. This folder is how, so the next tool can be matched
the same way and the ones here can be checked again.

## The chart

`node chart.mjs` writes `out/chart.png` (2160×2160), `out/chart-blurred.png`,
`out/chart-clipped.png` and `out/chart.json`, the layout the other scripts
read. It is deterministic — the noise is seeded — so it is regenerated rather
than kept in git. The blurred chart is the same through a canvas `blur(2px)`,
byte for byte the copy Google's Sharpen was tried on (`@blurred`); made in a
browser with SwiftShader instead it comes out a touch sharper, and Sharpen
notices. The clipped one is the chart held to 20..235 (`@clipped`), which is
how Sharpen's blur estimate was caught stretching each photo to its range.
Every region answers one question:

| region | what it tells you |
| --- | --- |
| ramp, all 256 levels | the tool's exact tone curve |
| 32 flat steps | the same, in patches big enough to survive JPEG |
| a 128 grey patch on black, 64, 192 and white surrounds | global or local: a global curve moves all four patches the same |
| 9 colours at 3 brightnesses | the colour model — equal shift, ratio, per channel, Lab… |
| hard edges, 1px lines, gratings of 2–12px, faint noise | a detail tool's radius, frequency response and noise handling |
| a sky over dark ground | halos, by eye |

Square and 2160 on purpose: Grid Collage exports it pixel for pixel at 1:1 with
one tile, so its edits go through exactly the same measuring.

## Doing it without a phone

Google Photos on the web is the same editor as the Android app: Highlights -100
and Black point +100 from each matched to within a level at all 256 levels, and
the colour patches to within JPEG's noise. `google-web.mjs` drives it.

1. `node google-web.mjs login` opens Chrome; sign in there yourself, once. The
   session is kept in `~/.grid-collage/google-photos`, outside the repository;
   deleting that folder signs it out. Use an account you do not mind charts
   being uploaded to.
2. `node google-web.mjs edit <folder> shadows+100 whitePoint-25 …` uploads the
   chart, saves an edited copy per setting and fetches it into
   `<folder>/<setting>.jpg`. `--chart=<file>` edits another image instead.
   Everything it uploaded or saved is binned afterwards, and the Bin emptied
   only if it holds exactly those photos, id for id.
3. Measure the folder as below.

What it cannot do: the web editor has no Sharpen, and the copies come back at
1000px, which reads the ramp to within about a tenth of a level of the full-size
Android copies but would blur a detail tool's edges. Sharpen was measured from
the phone.

## Doing it on a phone

1. Put `out/chart.png` on a phone and open it in Google Photos.
2. For each setting: Edit → Adjust → one tool → Save as copy, putting the tool
   back to nought before the next.
3. Name each copy for its setting — `highlights-100.jpg`, `sharpen+50.jpg` — in
   one folder.
4. `node measure.mjs <folder>` writes `<folder>/results.json` and prints each.
5. `node knots.mjs <folder>/results.json <setting>` gives the 33 knots an
   `ADJUSTMENTS` entry's `curves` takes.
6. `node ours.mjs <dir> <setting> …` exports the chart through the app at the
   same settings, `--chart=out/chart-blurred.png` for `@blurred` and
   `--chart=out/chart-clipped.png` for `@clipped`; measure that folder too,
   then `node compare.mjs <dir>/results.json [google-phone.json]` sets the
   two side by side. For a detail tool it adds a second table: each grating's
   gain by its fundamental, both edges' dip and rise, the 1px line and the
   noise.

`google.json` is everything read off Google's copies — 46 of them: every tone
tool at every quarter of the slider, Shadows lifting on a dark and on a bright
photo (`@dark`, `@bright`), and Sharpen at 25 to 100 and on a blurred chart
(`@blurred`, with `none@blurred` the blurred chart as it came, and `none` the
chart itself). The ±50 and ±100 tone settings and all of Sharpen are the Android
app's, at full size; the rest are the web's. The JPEGs themselves are not kept.
Sharpen's entries were measured again when measure.mjs learned to read each
grating's fundamental and the 1px lines, and every field already there came out
identical.

### Driving the phone from here

`google-android.mjs` does those steps over adb, for any image and setting:

    ANDROID_SERIAL=<device> node google-android.mjs edit <dir> <image> sharpen+100 …

It pushes the image, opens it from the Photos viewer, checks that what Photos
shows is the image it pushed before touching anything, sets the slider by
reading the number the editor shows, saves a copy and pulls it back, and
deletes both from the device, and the screen dumps it read the editor
from with them. The slider lands within 5 of the number asked for on a
Galaxy S23 Ultra, usually 2, so each copy is named for the value it really
landed on. Use the phone, not an emulator: Google's Sharpen on an emulator is
finer and noisier, whatever the app version or GPU.

`google-phone.json` is Sharpen as that phone (Photos 7.93) does it, every copy
made this way and each one repeatable: the chart at 25, 52, 77 and 100, the
blurred chart and the clipped one at 100, and `none` and `none@blurred` from
`google.json` as the bases. **This is the reference now.** The first,
hand-made copies of the chart in `google.json` are not what the same phone
makes of the same chart today — at 100 the 2px grating was ×1.01 where it is
now ×0.15, and 12px ×1.51 where it is ×1.34 — while the hand-made blurred copy
matches its automated one to the last digit. Nothing yet says why.

`scale.mjs` asks what one chart at one size cannot: `make` lays the same patch
of gratings from 2 to 48px, a hard edge and faint noise on grey canvases of
any size (`--texture=<spread>` for grain round it, `--bw` for a black and a
white square in the corner), `measure` reads each grating's gain and writes
`scale-results.json`, and `versus` sets Google's copy beside the app's as a
2160 export would draw them. `google-phone-scale.json` is what the phone made
of the patch at 1080², 2160² and 4032×3024, on grain of three spreads, and
with the squares.

### Real photographs

A chart says what a tool does to stripes and steps. Sharpen fitted to them
came out clearly softer than Google's on real photographs, so it is now held
to those first. `real.mjs` does the measuring:

    node real.mjs <photo> <original> <google dir> <ours dir> <out dir> [--map] [--dump]

It draws the original, the phone's copy and the app's export into the same
2160 square an export draws into, and reads them two ways: in regions chosen
by eye (fur, gravel, skin, hair, fabric, soft background, hard edges), the
RMS of three bands of detail — fine, the photo less a 3x3 box blur; mid, that
less a 7x7; coarse, that less a 15x15 — each over the original's; and over
the whole frame, the transfer function, `transfer.mjs`: the gain at each
period from the cross-spectrum of copy and original, so detail the edit
invents rather than lifts does not count. It writes side-by-side crops at
1.6×, original / Google / ours, for looking at.

Two things to know before measuring:

- **Give it a photo whose cover lands on whole pixels.** An edited tile drawn
  at a fraction of a pixel is resampled a second time on its way into the
  export, and that alone takes out all of the finest detail across the axis
  it falls on — 2px detail across came back cancelled completely, 3px
  halved, with Black point +30 as much as with Sharpen. The fox at 3872x2592
  covers at 3226.67 wide; 4px off either side, 3864x2592, covers at exactly
  3220. `real.mjs` warns when it sees one. The crops were taken in PNG, and
  Google's copies cropped identically. (That is a bug in how the app draws an
  edited tile, not in Sharpen, and is open below.)
- **The photos are not kept here.** They are other people's work, and the
  portrait is of a real person. What was read off them is, in
  `google-phone-real.json`: each photo's source and crop, the regions, and at
  each setting Google's transfer function and region boosts.

`google-phone-real.json` holds three photographs, each at three settings of
Sharpen: a red fox (US Fish and Wildlife Service, public domain, 3872x2592:
fur, whiskers, gravel, soft background) at 25, 52 and 100; the USFWS
director's official portrait (public domain, 3325x4987: skin, hair, fabric,
a badge, bokeh) at 25, 52 and 100; and a rainforest looking up a mossy trunk
into the canopy (Hoh rainforest, Carl Bubar, public domain, 3672x4896:
canopy against the sky, ferns, moss, hanging moss, a leaf's edges) at 25, 54
and 100. The forest covers the 2160 square at exactly 2160x2880 and needs no
crop. The odd settings are where the phone's slider really landed:
`google-android.mjs` accepts it within 5 of the value asked for and names the
copy for where it stopped, and the app is exported at the same value to
compare. The forest was held back from the fit that followed, to check it.

## What was found

Measured in September 2026, Google Photos for Android and on the web.

- **All four tone tools are global.** The 128 patch came out identical on every
  surround at every setting, and the noise and the 1px line moved exactly as the
  curve would move them. No local tone mapping.
- **Highlights** moves all three channels by the same amount, worked out from
  Rec.709 luma. It predicted every colour patch to within about a level, JPEG's
  own noise; ratio, per-channel, Lab and Oklab were ten to twenty times further
  off.
- **Shadows** is the same but 30% of the way from that equal shift towards
  scaling every channel by one ratio (0.26–0.33 in each file), which is why a
  lifted dark colour comes out more saturated.
- **White point and Black point** curve each channel on their own, as Levels
  does. Black point up is deeper blacks, the way this app had guessed.
- **Only lifting Shadows looks at the photo.** The same ramp on surrounds from
  12 to 240 gave one dark curve for every chart with a median of 120 or below,
  one bright curve for every chart of 130 or above, and a quick change between
  (weight on the dark curve 0.98, 0.94, 0.74, 0.23 at medians 122 to 128). At
  +100 the dark curve takes 96 to 160, the bright one to 128. White point,
  Black point, Highlights and lowering Shadows came out the same on every
  surround, to a tenth of a level.
- **No setting is a straight line from its neighbours.** Interpolated from
  ±50 and ±100, White and Black point at ±25 and ±75 were up to eight levels
  off, so the app carries every quarter of the slider.
- **Sharpen** is Polyblur (Delbracio et al., the algorithm Google Research
  published for it) — a Gaussian blur of σ undone by the polynomial `p(K)` —
  run on a working copy of 1.5 megapixels and adapting to each photo through
  the paper's blur estimate. From the phone's own copies:

  - *The copy is 1.5 megapixels whatever the photo's size.* On scale.mjs's
    patch the boost peaked at 3.5px on a 1080² photo, 6px at 2160² and 9px at
    4032×3024 (1×, 1.75× and 2.85×, as 1.5 megapixels predicts), and the
    1080² one peaked at 3 and 4px of its own, as if taken up to 1232² rather
    than worked on at its own size. The copy is taken with plain bilinear
    lookups: averaged over each copy pixel instead, the 4px grating's lift was
    lost (×0.81 against Google's ×1.62).
  - *The slider is a straight line.* Each grating's gain at 25, 52 and 77 is
    1 + s × (its gain at 100 − 1) to within 0.02; the 2px grating goes 0.79,
    0.55, 0.35 and 0.15, which is 1 − 0.85s.
  - *Detail finer than the copy is partly replaced by the copy's own.* At
    4032×3024 the 2, 3 and 4px gratings came back ×0.53, ×0.60 and ×0.76,
    which a lift made on a 1424px copy and added to the photo cannot do on its
    own: brought back up, it has almost nothing at those periods.
  - *The blur estimate stretches each photo to its own range first, and that
    is why the chart and the patch differ.* The same phone sharpened the same
    gratings ×2.28 at 6px on the calibration chart and ×1.56 on the patch, and
    the patch's boost sat finer too (4px ×1.42 against ×1.63, 12px ×1.13
    against ×1.34), which is what a smaller σ does. It is one number for the
    whole photo — the gain was the same in every 48px of every band, to 0.02 —
    and grain does not move it: grain of three spreads round the patch left
    the patch identical to the last digit. The paper's estimate stretches the
    brightness so its outermost hundredth of a percent sits at 0 and 255, then
    reads the steepest slope. The patch's darkest and lightest are its own
    20|235 edge, so that edge is stretched to a step across the whole range,
    127.5 levels a pixel in a central difference — the steepest anything can
    be — where the chart has black and white elsewhere and the same edge reads
    107.5. Two phone edits tested it both ways. A black and a white square,
    60px, in the patch's far corner took its 6px grating to ×2.31, the chart's
    ×2.28 (4px ×1.76, 8px ×1.98, 12px ×1.41). The chart held to 20..235 went
    down to ×1.69 (4px ×1.43, 8px ×1.43, 12px ×1.17), most of the way to the
    patch; the rest is below.
  - *σ from that slope.* Fitted with everything else, σ = √((96.4/f)² −
    0.45²) in pixels of the copy puts the chart's 107.5 at 0.77, the patch's
    127.5 at 0.61 and the blurred chart's 60 at 1.54. The paper's 89.8 and
    0.764 would put the chart at 0.34 and the patch at nothing. (Fitted to the
    fox and the charts alone it had come out at 81 and 0.38, the same curve
    1.19 times smaller; see below for why.)
  - *The blur is stretched along the gentlest direction.* The patch's
    steepest slopes run across (its edge) and its gentlest down, and on grain
    round it Google lifted detail running up and down more than detail running
    across: ×2.12 at 8px against ×1.77.
  - *Faint grain is lifted less than the gratings.* Read off its spectrum,
    the chart's noise patch was lifted ×1.3 at 6 to 8px, where the gratings
    were lifted ×2.28 and ×1.88, and it came out at 3.01 against 3.02 as it
    came (both as Google's own q90 JPEGs; the chart through the same JPEG
    reads 2.59). Colour was untouched.

  Then real photographs, through `real.mjs`, which the charts had not
  prepared anyone for:

  - *On a photograph Google keeps the finest detail and lifts it.* Across the
    whole fox at 100, 2px detail came back ×0.95, 3px ×1.20 and 4px ×1.38
    (periods in the 2160 export). The app, having copied the charts' finest
    gratings by moving the photo half way to its copy, had ×0.48, ×0.67 and
    ×1.03, and the fur looked flat beside Google's. The chart's 2px grating
    ×0.15 is stripes beating against Google's copy's grid, which a photo has
    none of.
  - *Its boost peaks at coarser detail on a photograph than on a chart.* The
    fox's peaked at 12px of the export, ×2.03, in every region alike — face,
    body fur, gravel, soft background, legs — and the portrait's at 10 to 12px
    too: 5.6 pixels of Google's copy on the fox and 4.5 to 5.4 on the
    portrait, where the chart's peaked at 3.4. The app, reading σ from the
    steepest slope, put the fox's at 8px.
  - *That is the estimate reading a photo softer than its single steepest
    slope.* A chart's steepest slope is shared by hundreds of pixels along its
    edges (216 on the chart, 136 on the 2160 patch, 42 on the 4032x3024 one);
    a photograph's is one pixel — on the fox the only one within 5% of it.
    The fortieth steepest leaves every chart and patch where it was and reads
    the fox at σ 0.97 and 0.91 across and down, against 0.66 and 0.59 from the
    steepest, and the portrait at 0.80 and 1.00 (on the curve of the time; on
    today's, 1.19 times those). That moved the app's peak on
    the fox from 8 to 10px and halved its distance from Google's (below).
    Whether Google counts pixels, takes a percentile or does something else
    that comes to the same on these two photos is not known.
  - *The halo guard matters more on photographs than on charts.* In a model
    of the passes that matched the app's exports to 0.01, taking it away put
    every region of the fox three times as far from Google's (0.37 RMS against
    0.13 at 100): the mid-sized detail in the gravel went ×2.12 where Google's
    is ×1.41. (That was with the lift at 1.55 throughout, which the guard was
    also holding down; see the next part for how much of it went.)
  - *The slider is still a straight line.* The fox's transfer at 25 and 52 is
    that at 100 scaled down, to within 0.015 from 3 to 48px. Not the finest:
    2.5px sits at ×1.07 to ×1.09 at every setting, and 2px goes ×1.09, ×1.03,
    ×0.95 — some of which may be Google's own JPEG.

  Then the portrait at 52 and 100 and the forest, which the app fitted to the
  fox sharpened half as hard again as Google did (the forest's boost ×1.62 at
  6px of the export where Google's peaked at ×1.34 at 8 to 10px). Three
  things, each measured with a Python model of the passes that matched the
  app's exports to within 0.05 on every period:

  - *Google's change to a photograph is mostly one fixed filter.* Fitting
    the best shift-invariant filter from the original to the change, it
    accounts for 87% of what Google added to the fox, 74% on the portrait and
    59% on the forest. Of what the app added it accounted for 63%, 56% and
    51%: the halo guard, shared with each pixel's neighbours and taken a fifth
    further, was tearing through texture, leaving the fur lifted in bright
    flecks where Google lifts every strand a little. The paper's guard, pixel
    by pixel, restores it (86% on the fox in the model), but the charts' hard
    edges need the stronger one. So the guard is chosen by how steep the
    photo through K is: the paper's below 14 levels a pixel, the shared one
    from 23, blended between — the steepest of each pixel and its four
    neighbours, so the pixel beside an edge counts as at one. The app now
    comes to 84%, 75% and 65%.
  - *Google sharpens a photo harder the softer it reads.* Fitted photo by
    photo at one shape and guard, the lift each photo wanted was 1.15 times
    the polynomial's for the fox, 0.78 for the portrait and 0.56 for the
    forest, in the order of their σ; the patches, which read sharpest, 0.66
    to 0.76, the blurred chart about twice. Proportional to σ fitted as well
    as any power of it (0.93 to 1.03), so the lift is the polynomial's times
    1.18σ, σ the geometric mean across and down. Polyblur has nothing that
    does this; in the paper σ moves only where the boost peaks.
  - *And σ reads 1.19 times larger than the curve fitted to the fox.* Each
    fitted on its own, the three photos put the peak of Google's boost at a σ
    1.2 to 1.7 times what 81 and 0.38 read; with one strength for everything,
    that curve had been standing in for a strength that ought to vary.

  - *And a soft edge does not ring.* On the blurred chart Google steepened
    the sun's edge and its 20|235 edge with no ring at all (2 under at the
    sun, none at the edge) while lifting its 12px grating ×3.11, which a
    fixed filter cannot do; on the sharp chart, the same 100|170 edge rings
    10 and 7. Sharpened as hard as the blurred chart reads soft, the app drew
    a dark ring round the sun, 18 below the sky, and a line along every
    cloud. The paper's guard leaves exactly that: beside a smooth edge it
    catches the climb out of the dip, where the slope turns against the
    photo's, and leaves the way down. So wherever the paper's test, made
    against the copy itself, pulls back a pixel within two, the lift is held
    to the range of the copy round it less 2 levels, save that a crest may
    rise and a trough sink by four times their depth. A flat ground has no
    slope to turn against, so a hard edge between flat grounds still rings;
    a grating has no reversal, so it is not held. A bright disc on grey with
    an edge soft as σ 3 now comes out steeper (25 levels a pixel from 13)
    with no ring either side, where it had 18 under; test-adjust holds it to
    5.
  - *And never more than twice the polynomial.* The blurred chart, at 1.97,
    is the softest thing measured; σ can read 3, which would be 3.5 times
    over on nothing but extrapolation. The fox blurred by σ 2 reads 2.18
    and 1.92, and is capped from 2.42.

  Fitted to the fox, the portrait and the charts together, and not to the
  forest, the forest then came out 0.067 from Google's transfer function at
  100 (RMS, 3 to 24px of the export), where the app fitted to the fox had it
  0.177 off and the app before that 0.126. The calibration chart is what
  gave: it reads about as soft as the forest, σ 0.83 to the forest's 0.80,
  and Google lifted it twice as hard, so no law in σ serves both, and three
  photographs were taken over one chart.

  What was built: a working copy of 1.5 megapixels up or down, taken with
  bilinear lookups; the blur estimate read off it once per decode, across and
  down separately, from the fortieth steepest slope each way, each turned
  into σ as above; grain split off with a 3x3 bilateral filter of 2.9 levels,
  39% of it handed back (on a photograph it barely acts: neighbours in the
  copy differ by far more than 2.9 levels); the three bands and a fixed
  polynomial, α 8.2 and b 1.94, lifted 1.18σ times over; the paper's halo
  guard in texture and, at hard edges, the same guard with the photo's slope
  taken through the blur, the blend shared with each pixel's four neighbours
  and taken a fifth further; and the lift added to the photo as it is. All of
  it is worked out once per photo and size, and the slider scales the result.
  The constants were fitted to the phone's copies with a Python model of the
  same passes, not kept here, which agreed with the app's own exports to
  within 0.05 on every period of every photo; `app.js` has what each piece is
  for and what it measured.

How close the app now is, from `compare.mjs`:

| | grey steps, worst | colour patches, RMS / worst |
| --- | --- | --- |
| Highlights, all eight | 1 level | 0.6–0.9 / 1.8 |
| Shadows, lowering, all four | 1 level | 0.9–2.1 / 6.4 |
| Shadows +25 to +100, dark and bright photos | 1 level | — |
| White point, all eight | 1 level | 0.7–4.5 / 10.8 |
| Black point, all eight | 1–4 levels | 1.4–5.7 / 12.5 |

And Sharpen. Real photographs first, since they are what it is for, through
`real.mjs`. How far the app is from Google on each, as RMS: the transfer
function from 3 to 24px of the export, and every region's boost in all three
bands. "Before" is the app fitted to the fox alone, "earlier" the one fitted
to the charts before that.

| | transfer at 25 / 52 / 100 | regions at 25 / 52 / 100 |
| --- | --- | --- |
| fox, now | 0.030 / 0.060 / 0.114 | 0.040 / 0.065 / 0.112 |
| before | 0.034 / 0.076 / 0.155 | 0.050 / 0.084 / 0.129 |
| earlier | 0.083 / 0.188 / 0.359 | 0.093 / 0.175 / 0.274 |
| portrait, now | 0.023 / 0.035 / 0.056 | 0.030 / 0.047 / 0.080 |
| before | 0.031 / 0.047 / 0.069 | 0.036 / 0.071 / 0.097 |
| earlier | 0.039 / 0.110 / 0.222 | 0.058 / 0.125 / 0.180 |
| forest (54 for 52), now | 0.033 / 0.049 / 0.065 | 0.026 / 0.050 / 0.083 |
| before | 0.074 / 0.124 / 0.177 | 0.054 / 0.109 / 0.195 |
| earlier | 0.040 / 0.072 / 0.126 | 0.043 / 0.071 / 0.108 |

The forest was not in the fit. Each region at 100, Google's / the app's
(before), as first fitted; holding soft edges (below) moved none of these by
more than 0.02:

| fox at 100 | fine | mid | coarse |
| --- | --- | --- | --- |
| face fur | 1.30 / 1.29 (1.22) | 1.65 / 1.75 (1.68) | 1.77 / 1.80 (1.81) |
| muzzle, whiskers | 1.38 / 1.33 (1.36) | 1.75 / 1.76 (1.77) | 1.78 / 1.69 (1.73) |
| body fur | 1.50 / 1.37 (1.33) | 1.95 / 1.91 (1.83) | 1.86 / 1.68 (1.57) |
| gravel | 1.11 / 1.21 (1.17) | 1.42 / 1.76 (1.71) | 1.38 / 1.42 (1.33) |
| soft background | 1.28 / 1.20 (1.14) | 1.58 / 1.65 (1.51) | 1.70 / 1.67 (1.51) |
| eye and ear edges | 1.33 / 1.30 (1.27) | 1.66 / 1.74 (1.74) | 1.67 / 1.66 (1.69) |

| portrait at 100 | fine | mid | coarse |
| --- | --- | --- | --- |
| cheek skin | 1.26 / 1.32 (1.32) | 1.56 / 1.75 (1.72) | 1.43 / 1.45 (1.38) |
| other cheek | 1.41 / 1.33 (1.34) | 1.79 / 1.79 (1.83) | 1.82 / 1.77 (1.79) |
| hair | 1.46 / 1.34 (1.32) | 1.84 / 1.78 (1.75) | 1.76 / 1.69 (1.67) |
| eyes, brows | 1.40 / 1.38 (1.45) | 1.66 / 1.71 (1.78) | 1.59 / 1.56 (1.53) |
| shirt fabric | 1.21 / 1.30 (1.32) | 1.53 / 1.75 (1.73) | 1.41 / 1.53 (1.44) |
| badge | 1.44 / 1.48 (1.62) | 1.54 / 1.56 (1.66) | 1.43 / 1.41 (1.46) |
| soft background | 1.07 / 1.11 (1.07) | 1.37 / 1.45 (1.34) | 1.51 / 1.59 (1.48) |

| forest at 100 | fine | mid | coarse |
| --- | --- | --- | --- |
| canopy | 1.20 / 1.32 (1.56) | 1.30 / 1.36 (1.54) | 1.21 / 1.17 (1.21) |
| ferns | 1.34 / 1.30 (1.47) | 1.51 / 1.50 (1.67) | 1.38 / 1.28 (1.34) |
| branches on sky | 1.19 / 1.29 (1.50) | 1.30 / 1.35 (1.52) | 1.19 / 1.15 (1.20) |
| moss | 1.42 / 1.30 (1.50) | 1.63 / 1.59 (1.83) | 1.46 / 1.32 (1.45) |
| hanging moss | 1.12 / 1.27 (1.46) | 1.24 / 1.34 (1.48) | 1.16 / 1.14 (1.16) |
| leaf edges | 1.18 / 1.25 (1.39) | 1.37 / 1.45 (1.57) | 1.24 / 1.18 (1.20) |

The transfer function over the whole frame, by period in the 2160 export:

| | 2 | 2.5 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 24 | 32 | 48 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fox 25, Google | 1.09 | 1.07 | 1.05 | 1.08 | 1.12 | 1.15 | 1.20 | 1.24 | 1.26 | 1.21 | 1.10 | 1.05 | 1.02 |
| now | 1.00 | 1.01 | 1.03 | 1.08 | 1.12 | 1.17 | 1.25 | 1.27 | 1.25 | 1.17 | 1.07 | 1.03 | 1.01 |
| before | 1.00 | 1.00 | 1.02 | 1.05 | 1.10 | 1.15 | 1.25 | 1.26 | 1.23 | 1.15 | 1.07 | 1.03 | 1.01 |
| fox 52, Google | 1.03 | 1.08 | 1.10 | 1.20 | 1.26 | 1.32 | 1.43 | 1.52 | 1.55 | 1.45 | 1.22 | 1.11 | 1.04 |
| now | 0.99 | 1.01 | 1.05 | 1.15 | 1.25 | 1.35 | 1.52 | 1.57 | 1.52 | 1.35 | 1.15 | 1.07 | 1.03 |
| before | 0.99 | 1.00 | 1.04 | 1.10 | 1.20 | 1.31 | 1.51 | 1.54 | 1.48 | 1.32 | 1.14 | 1.06 | 1.02 |
| fox 100, Google | 0.95 | 1.09 | 1.20 | 1.38 | 1.50 | 1.61 | 1.81 | 1.97 | 2.03 | 1.84 | 1.42 | 1.21 | 1.07 |
| now | 0.97 | 1.01 | 1.09 | 1.27 | 1.46 | 1.64 | 1.97 | 2.06 | 1.98 | 1.66 | 1.28 | 1.14 | 1.05 |
| before | 0.95 | 0.98 | 1.05 | 1.17 | 1.34 | 1.57 | 1.93 | 1.99 | 1.89 | 1.59 | 1.26 | 1.12 | 1.04 |
| portrait 25, Google | 0.89 | 0.96 | 1.00 | 1.06 | 1.09 | 1.11 | 1.14 | 1.15 | 1.15 | 1.10 | 1.05 | 1.03 | 1.01 |
| now | 1.00 | 1.00 | 1.02 | 1.06 | 1.10 | 1.14 | 1.19 | 1.19 | 1.17 | 1.11 | 1.05 | 1.02 | 1.01 |
| before | 0.99 | 1.00 | 1.02 | 1.05 | 1.09 | 1.15 | 1.21 | 1.19 | 1.16 | 1.10 | 1.04 | 1.02 | 1.01 |
| portrait 52, Google | 0.85 | 0.94 | 1.03 | 1.16 | 1.22 | 1.26 | 1.31 | 1.33 | 1.32 | 1.23 | 1.11 | 1.06 | 1.02 |
| now | 0.99 | 1.01 | 1.05 | 1.13 | 1.21 | 1.29 | 1.40 | 1.40 | 1.36 | 1.22 | 1.10 | 1.05 | 1.01 |
| before | 0.99 | 1.01 | 1.04 | 1.11 | 1.19 | 1.30 | 1.41 | 1.38 | 1.33 | 1.20 | 1.08 | 1.05 | 1.01 |
| portrait 100, Google | 0.79 | 0.93 | 1.09 | 1.30 | 1.41 | 1.49 | 1.58 | 1.61 | 1.60 | 1.42 | 1.20 | 1.10 | 1.04 |
| now | 0.99 | 1.02 | 1.09 | 1.25 | 1.40 | 1.53 | 1.73 | 1.72 | 1.66 | 1.41 | 1.18 | 1.09 | 1.03 |
| before | 0.99 | 1.02 | 1.08 | 1.20 | 1.34 | 1.52 | 1.71 | 1.67 | 1.59 | 1.36 | 1.15 | 1.08 | 1.02 |
| forest 25, Google | 0.97 | 1.00 | 1.01 | 1.03 | 1.04 | 1.06 | 1.08 | 1.08 | 1.07 | 1.04 | 1.01 | 1.00 | 1.00 |
| now | 1.01 | 1.03 | 1.04 | 1.06 | 1.09 | 1.12 | 1.12 | 1.10 | 1.07 | 1.04 | 1.01 | 1.00 | 1.00 |
| before | 1.03 | 1.05 | 1.06 | 1.10 | 1.16 | 1.19 | 1.17 | 1.13 | 1.09 | 1.05 | 1.01 | 1.00 | 1.00 |
| forest 54, Google | 0.91 | 1.00 | 1.04 | 1.09 | 1.12 | 1.14 | 1.18 | 1.18 | 1.16 | 1.10 | 1.03 | 1.01 | 0.99 |
| now | 1.05 | 1.07 | 1.08 | 1.12 | 1.18 | 1.24 | 1.25 | 1.20 | 1.15 | 1.08 | 1.02 | 1.01 | 1.00 |
| before | 1.07 | 1.11 | 1.12 | 1.19 | 1.31 | 1.37 | 1.34 | 1.26 | 1.18 | 1.09 | 1.02 | 1.00 | 0.99 |
| forest 100, Google | 0.84 | 1.01 | 1.09 | 1.18 | 1.23 | 1.28 | 1.34 | 1.34 | 1.29 | 1.18 | 1.06 | 1.02 | 0.99 |
| now | 1.08 | 1.12 | 1.14 | 1.19 | 1.31 | 1.41 | 1.44 | 1.35 | 1.25 | 1.13 | 1.04 | 1.01 | 0.99 |
| before | 1.07 | 1.14 | 1.18 | 1.30 | 1.50 | 1.62 | 1.58 | 1.44 | 1.30 | 1.15 | 1.03 | 0.99 | 0.98 |

What is still off is the shape and the content. Google's lift is broader than
any one Polyblur makes — on the fox still ×1.84 at 16px and ×1.42 at 24px,
where the app's is ×1.66 and ×1.28 — and it is not the same everywhere in a
photo: the fox's gravel got less from Google at 6 to 8px than its fur did,
where the app treats them alike and so lifts the gravel's mid band ×1.76
against Google's ×1.42. The forest's dark hanging moss and its canopy against
the sky are lifted more than Google lifts them (fine band ×1.27 and ×1.32
against ×1.12 and ×1.20), and its sunlit moss less. See below.

Then the charts, exported through the app at 2160 and read as before (gain by
each grating's fundamental against the chart as it came; ours / the phone's,
and in brackets the app fitted to the fox alone):

| | 4px | 6px | 8px | 12px | 20\|235 edge, dip, rise | 100\|170 edge, dip, rise | 1px line peak | noise, ours raw → after q90 JPEG / Google's |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 1.12 / 1.16 (1.26) | 1.21 / 1.32 (1.35) | 1.17 / 1.22 (1.25) | 1.09 / 1.08 (1.11) | 3, 9 / 3, 2 (1, 8) | 1, 3 / 2, 1 (0, 2) | +6 / +5 (+12) | 3.09 → 2.67 / 2.60 (2.82) |
| 52 | 1.26 / 1.33 (1.55) | 1.43 / 1.68 (1.73) | 1.36 / 1.47 (1.53) | 1.18 / 1.18 (1.23) | 7, 18 / 5, 4 (2, 16) | 2, 6 / 6, 3 (1, 5) | +12 / +11 (+24) | 3.27 → 2.90 / 2.74 (3.12) |
| 77 | 1.38 / 1.48 (1.81) | 1.63 / 1.99 (2.08) | 1.53 / 1.68 (1.78) | 1.26 / 1.26 (1.34) | 10, 20 / 8, 7 (4, 20) | 3, 9 / 8, 4 (1, 7) | +18 / +17 (+33) | 3.42 → 3.08 / 2.89 (3.43) |
| 100 | 1.50 / 1.63 (2.05) | 1.82 / 2.28 (2.40) | 1.68 / 1.88 (2.01) | 1.34 / 1.34 (1.44) | 14, 20 / 11, 9 (5, 20) | 4, 11 / 10, 7 (2, 9) | +24 / +22 (+38) | 3.56 → 3.25 / 3.01 (3.75) |
| 100, blurred chart | — | — | 2.88 / 2.76 (2.94) | 3.19 / 3.11 (2.89) | 3, 4 / −1, 0 (5, 20) | 2, 3 / 4, 3 (2, 6) | −46 / −47 | 0.97 → 0.98 / 0.87 (0.86) |
| 100, clipped chart | 1.40 / 1.44 (1.74) | 1.46 / 1.69 (1.72) | 1.33 / 1.43 (1.47) | 1.15 / 1.17 (1.20) | 12, 20 / 8, 10 (4, 20) | 4, 10 / 7, 8 (1, 10) | +15 / +13 (+27) | 3.41 → 3.08 / 2.68 (3.63) |

A rise of 20 at the 20|235 edge is as far as it can go: that is white. The 2
and 3px gratings at 100 are 1.01 / 0.15 and 1.19 / 1.07. The chart is now
lifted less than Google lifts it from 4 to 8px, 0.46 short at 6px at 100,
where it was within 0.13 from 6px up and over at 4px: the price of the
forest. In return the 1px line, the noise patch and the 4px grating are
nearer Google's than they have been, and the blurred chart is within 0.12.
Sharpened that hard, the blurred chart's edges first rang 20 each way at
100|170 and 10 under and to white at 20|235, and drew a dark ring round the
sun 18 levels below the sky; holding soft edges (see What was found) took
them to what is in the table, and the sun to 2.3 under and 3.7 over against
Google's 2 and 3.4.

scale.mjs's patch at three sizes, each drawn into a 2160 export as the app
draws it (`scale.mjs versus`), gain by period in the photo's own pixels; ours
/ Google's (the app fitted to the fox alone):

| | 2px | 3px | 4px | 6px | 8px | 12px | 16px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1080², ×2 | 1.56 / 0.92 (1.73) | 1.54 / 1.40 (1.59) | 1.41 / 1.39 (1.42) | 1.19 / 1.17 (1.18) | 1.11 / 1.08 (1.09) | 1.04 / 1.02 (1.03) | 1.02 / 1.01 (1.02) |
| 2160², ×1 | 1.00 / 0.41 (1.00) | 1.22 / 0.93 (1.26) | 1.57 / 1.42 (1.73) | 1.66 / 1.56 (1.72) | 1.46 / 1.35 (1.47) | 1.21 / 1.13 (1.20) | 1.11 / 1.06 (1.10) |
| 2160² with the squares | 1.01 / 0.42 (1.01) | 1.24 / 1.12 (1.25) | 1.63 / 1.76 (2.05) | 2.04 / 2.31 (2.40) | 1.87 / 1.98 (2.01) | 1.43 / 1.41 (1.44) | 1.23 / 1.19 (1.22) |
| 4032×3024, ×0.71 | 1.22 / 0.52 (1.28) | 0.99 / 0.59 (0.99) | 1.08 / 0.76 (1.09) | 1.44 / 1.33 (1.61) | 1.66 / 1.68 (1.81) | 1.49 / 1.48 (1.53) | 1.29 / 1.27 (1.30) |

From 6 to 12px the app is within 0.15 of the phone on every patch bar the
squares' 6px, 0.27 short; at 4px it is 0.02 to 0.32 over on the plain patches
and 0.13 under with the squares. The squares still make the patch
sharpen harder, ×2.04 against ×1.66 at 6px, but by half what they did in
Google's copies — the same shortfall as the chart's.

The grey is as close as the measurement can see. The colour at White and Black
point ±100 is not: Google also takes about a tenth off a saturated colour at
Black point -100 and adds a little at +100, which the per-channel model does not
do and nothing tried yet explains.

### Tone

Tone is on the phone only, runs 0 to 100, and is the one tool here that looks
at the whole picture before it touches a pixel. Measured from five copies,
every one made by `google-android.mjs`: the chart at +54 and +100, and at +100
the 9×9×9 colour grid from `lut-chart.mjs` filling the frame, in the middle
half on black, and in the middle half on white (read with `lut-measure.mjs`).
What they said is in `google-phone-tone.json`. The phone was locked for the
rest of the work, so no photograph has been through Google's Tone yet — see
Still open.

**Local, and not a blur.** The chart's grey 128 came out of +100 as 158 in
the open, 142 as a patch on black, 162 on 64, 146 on 192 and 142 on white, and
146 in the strip between the black block and the chart's edge — each flat
across the patch to within a level, and the black beside it untouched. No tone
curve does that, and neither does anything built on a blur of the brightness,
which would grade each patch from its middle out. The colour grid said the
same louder: grey 32 came out 33 filling the frame, 80 on black and 23 on
white.

**Exposure fusion.** HDR+ tone maps by fusing the photo with brighter copies
of itself (Hasinoff et al. 2016, after Mertens et al. 2007): each pixel of each
exposure weighted by how near the middle of the range it sits, and the
exposures blended band by band through Laplacian pyramids. Tried as it is on
the chart, with one copy two stops brighter, it put those five patches at 156,
150, 168, 145 and 145: the right way round each time, which nothing else tried
managed. It never takes a pixel below itself, and it leaves black black.

**How much brighter depends on the photo.** Fitted to each copy on its own,
the full grid wanted a gain of about 1.3, white 1, the chart 4, and black more
than anything would give. What orders them is the mean of each pixel's
brightest channel — 198, 241, 134 and 50 — and not mean luma, on which the
chart (123) and the full grid (128) are all but equal. A straight line in stops
does it: 5.8 stops per 255 below a mean of 223, the slider's share of that to
the power 1.64 (from +54 against +100).

**The brightest channel, not luma.** Pure blue at 128 went to 158 on the full
grid; by luma it is a dark colour, 9, and would have been lifted several times
over. Rebuilding each grid patch's colour from Google's own change of one
brightness and scaling the channels by it, the brightest channel came 5.9, 8.8
and 7.6 from Google's colour on the three layouts, luma 7.8, 14.7 and 10.1,
an equal shift in luma 9.7, 13.9 and 8.3.

**Detail follows the exposures, not the curve.** The fusion runs on a copy
192 pixels across and is kept as a bilateral grid — the mean change in each
12-pixel region at each twelfth of the range — and every pixel of the photo is
looked up in it at its own brightness, so each region gets its own curve and an
edge between two stays an edge. On that copy a region's texture has been
averaged away, so its pixels reach a level or two, and what the curve does
either side of those has to be supplied. Held level, the chart's dark ground
came out with its coarse texture ×1.08 where Google's was ×1.33 (a 7px box
blur less a 31px one, RMS over the original's): the shadows lifted and left
flat. Following the curve a flat field comes out on gave the ground ×1.42 but
the grey noise patch ×0.49, where Google's kept about 0.9. Following instead
the two exposures' own slopes, weighted as fusion blends them — which is how a
Laplacian fusion carries fine detail — gave ×1.47 and ×1.11.

What the app now makes of the five, RMS over the chart's flat places and
colours and over every patch of the grids, at 1080:

| | app | leaving it alone |
| --- | --- | --- |
| chart +100 | 9.7 | 23.7 |
| chart +54 | 7.4 | 12.9 |
| grid, full, +100 | 8.8 | 12.0 |
| grid on black, +100 | 17.4 | 22.9 |
| grid on white, +100 | 10.7 | 10.7 |

The steps from 16 to 156 are within 8 levels of Google's at +100 and 9 at +54.
Above that the app is up to 11 brighter at +100 (197 to 208, where Google's
stays at 197) and 13 at +54: Google holds the chart's highlights still. Fading
the change out towards white took the chart at +54 from 7.4 to 6.3–6.7 but cost
as much on the full grid, whose highlights Google did lift (191 to 197), so it
was not kept. Tried and not kept either: fusion on luma (the full grid 15.6
against 9.4), three or more exposures, a narrower weight above the middle than
below, a global curve after the fusion (fitted to the chart's greys it cost the
grids more than it gave the chart), and the copy at 360 across with three or
four levels (no better than 192 with two).

Timings, on a generated 12MP photo in a phone's 780px preview in headless
Chromium, each step read back from the canvas so the GPU's part counts: drag
steps 47–83ms (median 53) against White point's 40–62 (42) and Sharpen's
44–88 (50) in the same run; the first move off nought 0.37–0.49s; a 2160
export 0.72s against White point's 0.60.

## Still open

- **What Shadows' change-over actually keys on.** Median is close but not it:
  the calibration chart and a plain surround of 128 share a median and came
  out at slightly different points of the change, so a photo with a median
  near 128 is lifted up to six levels differently from Google at +100.
  Everything with a median below about 122 or above 130 matches to a level.
- **How hard to sharpen a very soft photo.** Past the blurred chart's σ
  nothing has been measured, so the strength stops there, at twice the
  polynomial. A genuinely out-of-focus photo through the phone would say
  whether Google goes on.
- **What else sets how hard Google sharpens.** The strength follows σ on
  the three photos, the patches and the blurred chart, but the calibration
  chart reads about as soft as the forest and was sharpened twice as hard, so
  the app is 0.46 short of it at 6px. Something besides the steepest slopes —
  how much of the frame is flat, how busy it is, its hard edges — must count.
  Fitted with the chart counted three times over, the model came within half
  the distance of it and of the squared patch, but the forest's distance from
  Google rose by a third and the fox's by a sixth, so it was not kept. A photo
  that reads as sharp as the chart with big flat areas, or the chart with its
  flat grey filled with texture, through the phone would say which.
- **The shape of Sharpen's lift on a photograph.** Google's is broader than
  one Polyblur gives at any σ: on the fox it is ×1.38 at 4px and still ×1.42
  at 24px where the app's is ×1.27 and ×1.28. Fitting the three bands' weights freely matched it (about 0.04 over
  25, 52 and 100), but with weights that would ruin the charts, and a second
  lift at a larger σ that only a photo sees (the charts' two σ being equal)
  bought 0.13 → 0.12 for twice the passes, so neither was kept.
- **And its content.** In the same photo Google gave the fox's gravel less
  at 6 to 8px than its fur (×1.25 against ×1.72 at 6px). The app treats
  every part of a photo alike and so lifts the gravel's mid band ×1.76
  against ×1.42 — the largest miss, and it shows as a slightly grittier
  gravel in the crops. The forest has the same thing the other way: Google
  lifted its dark hanging moss and its canopy against the sky less than the
  app does, and its sunlit moss more, and brightening next to a bright
  patch it hardly did at all. In the model, the grain split's fall-off raised from 2.9 to 12 levels
  with a fifth handed back took the gravel from ×1.78 to ×1.62 but the fox
  as a whole only from 0.132 to 0.118 RMS, and would have cost the chart's
  noise patch; a guard of 2.0 times rather than 1.2, to ×1.70, and it took
  every ring off the chart's hard edges. Neither was kept. The earlier
  finding that grain round the scale patch was lifted more than its gratings
  was read off the spectrum's power, which counts aliasing and noise as lift.
  On the photos, read by the transfer function, which does not, most of the
  difference went with reading σ from the fortieth steepest slope, and what
  is left is this.
- **How Google really reads a photo's softness.** The fortieth steepest slope
  fits the three photos and leaves every chart where it was, but three
  photos cannot tell it from a percentile or from something else that comes
  to the same on them, and the 4032x3024 patch, whose edge is only 42 copy
  pixels at its steepest, allows nothing past the forty-first.
- **Edited tiles drawn at a fraction of a pixel.** An edited tile is rendered
  at the tile's size rounded to a whole pixel and then drawn at the unrounded
  size, so unless the cover lands on whole pixels it is resampled a second
  time with a sub-pixel shift: the fox's export lost all of its 2px detail
  across and half its 3px, with Black point +30 as with Sharpen. Unedited
  tiles are not affected. Most photos will not land on whole pixels. This is
  a fault in drawing a look, not in any one tool, and wants fixing on its
  own.
- **Small photos.** The app takes a photo under 1.5 megapixels up to the
  copy, as Google evidently does, but the 1080² patch's 2px grating comes out
  ×1.56 where Google's is ×0.92 (×1.44 while the finest detail was traded),
  and that is 4px in a 2160 export. Carrying σ
  up from the photo's own size, and coming back down with a box rather than
  bilinearly, were both further off.
- **The rest of the chart.** Held to 20..235, the chart reads the same
  steepest slope as the patch and the app sharpens the two nearly alike (6px
  ×1.46 and ×1.66), but Google took the clipped chart to ×1.69 and the patch
  to ×1.56: something else on the chart — its colour, text, 1px lines or the
  scene — makes Google sharpen it harder, the same thing as the first item
  here.
- **Sharpen's hard edges and single lines.** At 100 the chart's 20|235 edge
  rings 14 under and to white over against Google's 11 and 9, the 100|170
  edge 4 and 11 against 10 and 7, and the blurred chart's 20|235 edge rings
  3 and 4 where Google's does not ring at all. The 1px line
  peaks +24 against +22, with a dark lobe of 8 beside it where Google's dips
  9. Google's copy also softens a
  hard edge or not depending on where it falls against its grid — the
  patch's edge came back 26|209, the chart's 9|233 — and the app's grid does
  not fall where Google's does.
- **Which way the blur is stretched.** The app stretches it across and down;
  the paper stretches it along whatever direction is gentlest. On everything
  measured those were the same or nearly, and the paper's way fitted the
  blurred chart worse. A photo whose gentlest direction is diagonal would
  tell them apart.
- **Why the hand-made copies differ.** The first copies of the chart, edited
  by hand on the same phone, are not what the phone makes of it now; the
  hand-made blurred copy is.
- **σ between the charts.** The slope-to-σ line was fitted where Google has
  been measured: slopes of 60, 107.5 and 127.5 levels a pixel. Two phone runs
  would test it in between: the patch with its edge at 140 and at 90 levels,
  and a black and a white patch with soft edges to set the range without
  adding a slope.
- **Colour at White and Black point ±100**, where saturated patches are up to
  twelve levels from Google's.
- **Tone on a photograph.** Nothing yet: the phone was locked. The gain comes
  from a line through four synthetic images, and on the fox, the forest and
  the portrait (means 146, 108 and 116) it puts the brighter exposure 1.8 to
  2.6 stops up at +100 — a guess until one of them has been through the phone
  at +25, +50 and +100. `google-android.mjs edit <dir> <photo> tone+50`
  makes them and `ours.mjs` the app's; `real.mjs` reads only files named
  `sharpen+N` for now.
- **Tone's patch on black.** Google's lifts it 16 levels less than the open
  grey; the app's lifts it the same. Fusion done at full size and depth lifts
  it 6 less, and the 192-pixel copy none, and neither a finer grid nor a deeper
  pyramid on the copy brings it back.
- **Tone on a dark picture.** On the grid on black Google lifts the darks far
  harder than anything here (grey 32 to 80) and darkens a bright green (191 to
  144). Fusion never takes a pixel below itself, so something else is in
  Google's — possibly a different tool altogether underneath the one slider.
- **Tone's highlights**, held still on the chart and lifted on the full grid.
- **Tone's fine grain.** Google's +100 kept 0.63 of the chart's faint noise at
  4px, against 1.04 in its Sharpen +25 copy through the same JPEG, and 0.03 at
  2px against 0.21. Tone may smooth, or the JPEG may take more off flatter
  shadows; a copy at Tone +5 would say which.
- **Whether Tone's regions scale with the photo.** The copy is a fixed 192
  pixels across whatever the photo's size, as a working copy would be, but
  only 2160 squares have been measured.
