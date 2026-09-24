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
deletes both from the device. The slider lands within 2 of the number asked
for on a Galaxy S23 Ultra, so each copy is named for the value it really
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

`google-phone-real.json` holds a red fox (US Fish and Wildlife Service, public
domain, 3872x2592: fur, whiskers, gravel, soft background) at Sharpen 25, 52
and 100, and the USFWS director's official portrait (public domain,
3325x4987: skin, hair, fabric, a badge, bokeh) at 25. The portrait at 50 and
100 and a rainforest photo at three settings were planned; the phone run
stopped on the portrait at 50, when the slider settled on 54 rather than
within 2 of 50, and nothing more was run.

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
  - *σ from that slope.* Fitted with everything else, σ = √((81/f)² − 0.38²)
    in pixels of the copy puts the chart's 107.5 at 0.64, the patch's 127.5 at
    0.51 and the blurred chart's 60 at 1.29. The paper's 89.8 and 0.764 would
    put the chart at 0.34 and the patch at nothing.
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
    steepest, and the portrait at 0.80 and 1.00. That moved the app's peak on
    the fox from 8 to 10px and halved its distance from Google's (below).
    Whether Google counts pixels, takes a percentile or does something else
    that comes to the same on these two photos is not known.
  - *The halo guard matters more on photographs than on charts.* In a model
    of the passes that matched the app's exports to 0.01, taking it away put
    every region of the fox three times as far from Google's (0.37 RMS against
    0.13 at 100): the mid-sized detail in the gravel went ×2.12 where Google's
    is ×1.41.
  - *The slider is still a straight line.* The fox's transfer at 25 and 52 is
    that at 100 scaled down, to within 0.015 from 3 to 48px. Not the finest:
    2.5px sits at ×1.07 to ×1.09 at every setting, and 2px goes ×1.09, ×1.03,
    ×0.95 — some of which may be Google's own JPEG.

  What was built: a working copy of 1.5 megapixels up or down, taken with
  bilinear lookups; the blur estimate read off it once per decode, across and
  down separately, from the fortieth steepest slope each way, each turned
  into σ as above; grain split off with a 3x3 bilateral filter of 2.9 levels,
  39% of it handed back (on a photograph it barely acts: neighbours in the
  copy differ by far more than 2.9 levels); the three bands and a fixed
  polynomial, α 13.7 and b 1.8, lifted 1.55 times over; the paper's halo
  guard with the photo's slope taken through the blur, the blend shared with
  each pixel's four neighbours and taken a fifth further; and the lift added
  to the photo as it is. All of it is worked out once per photo and size, and
  the slider scales the result. The constants were fitted to the phone's
  copies with a Python model of the same passes, not kept here, which agreed
  with the app's own exports to 0.02 on every grating and to 0.01 on the
  fox's regions; `app.js` has what each piece is for and what it measured.

How close the app now is, from `compare.mjs`:

| | grey steps, worst | colour patches, RMS / worst |
| --- | --- | --- |
| Highlights, all eight | 1 level | 0.6–0.9 / 1.8 |
| Shadows, lowering, all four | 1 level | 0.9–2.1 / 6.4 |
| Shadows +25 to +100, dark and bright photos | 1 level | — |
| White point, all eight | 1 level | 0.7–4.5 / 10.8 |
| Black point, all eight | 1–4 levels | 1.4–5.7 / 12.5 |

And Sharpen. Real photographs first, since they are what it is for, through
`real.mjs`: Google's / the app's now (the app before this refit). Each
region's boost in the three bands at 100 on the fox:

| fox at 100 | fine | mid | coarse |
| --- | --- | --- | --- |
| face fur | 1.30 / 1.22 (1.10) | 1.65 / 1.68 (1.66) | 1.77 / 1.81 (1.55) |
| muzzle, whiskers | 1.38 / 1.36 (1.22) | 1.75 / 1.77 (1.63) | 1.78 / 1.73 (1.48) |
| body fur | 1.50 / 1.33 (1.14) | 1.95 / 1.83 (1.56) | 1.86 / 1.57 (1.25) |
| gravel | 1.11 / 1.17 (0.91) | 1.42 / 1.71 (1.54) | 1.38 / 1.33 (1.14) |
| soft background | 1.28 / 1.14 (0.91) | 1.58 / 1.51 (1.47) | 1.70 / 1.51 (1.33) |
| eye and ear edges | 1.33 / 1.27 (1.20) | 1.66 / 1.74 (1.71) | 1.67 / 1.69 (1.42) |

At 52 and 25 the same regions are as far off in proportion: RMS over every
region and band 0.085 at 52 (0.175 before) and 0.050 at 25 (0.094); at 100
it is 0.130 (0.275). The portrait at 25:

| portrait at 25 | fine | mid | coarse |
| --- | --- | --- | --- |
| cheek skin | 1.06 / 1.06 (0.99) | 1.14 / 1.16 (1.12) | 1.10 / 1.09 (1.05) |
| other cheek | 1.10 / 1.07 (1.00) | 1.19 / 1.19 (1.14) | 1.20 / 1.19 (1.12) |
| hair | 1.11 / 1.06 (0.99) | 1.21 / 1.17 (1.15) | 1.18 / 1.16 (1.12) |
| eyes, brows | 1.09 / 1.09 (1.02) | 1.16 / 1.19 (1.15) | 1.14 / 1.13 (1.08) |
| shirt fabric | 1.02 / 1.06 (0.99) | 1.12 / 1.18 (1.13) | 1.09 / 1.11 (1.07) |
| badge | 1.10 / 1.14 (1.09) | 1.13 / 1.20 (1.15) | 1.10 / 1.13 (1.09) |
| soft background | 1.01 / 1.01 (0.95) | 1.08 / 1.04 (1.03) | 1.12 / 1.05 (1.05) |

RMS 0.035 (0.057). The transfer function over the whole frame, by period in
the 2160 export:

| | 2 | 2.5 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 24 | 32 | 48 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fox 100, Google | 0.95 | 1.09 | 1.20 | 1.38 | 1.50 | 1.61 | 1.81 | 1.97 | 2.03 | 1.84 | 1.42 | 1.21 | 1.07 |
| now | 0.95 | 0.98 | 1.04 | 1.17 | 1.34 | 1.57 | 1.93 | 1.99 | 1.89 | 1.59 | 1.26 | 1.12 | 1.04 |
| before | 0.48 | 0.53 | 0.67 | 1.03 | 1.38 | 1.64 | 1.76 | 1.65 | 1.51 | 1.30 | 1.13 | 1.06 | 1.02 |
| fox 52, Google | 1.03 | 1.08 | 1.10 | 1.20 | 1.26 | 1.32 | 1.43 | 1.52 | 1.55 | 1.45 | 1.22 | 1.11 | 1.04 |
| now | 0.98 | 1.00 | 1.03 | 1.10 | 1.20 | 1.31 | 1.51 | 1.54 | 1.48 | 1.31 | 1.14 | 1.06 | 1.02 |
| before | 0.73 | 0.76 | 0.83 | 1.03 | 1.21 | 1.35 | 1.41 | 1.35 | 1.27 | 1.16 | 1.07 | 1.03 | 1.01 |
| fox 25, Google | 1.09 | 1.07 | 1.05 | 1.08 | 1.12 | 1.15 | 1.20 | 1.24 | 1.25 | 1.21 | 1.10 | 1.05 | 1.02 |
| now | 1.00 | 1.00 | 1.02 | 1.05 | 1.10 | 1.15 | 1.25 | 1.26 | 1.23 | 1.15 | 1.07 | 1.03 | 1.01 |
| before | 0.88 | 0.89 | 0.93 | 1.02 | 1.10 | 1.17 | 1.20 | 1.17 | 1.13 | 1.08 | 1.03 | 1.01 | 1.00 |
| portrait 25, Google | 0.89 | 0.96 | 1.00 | 1.06 | 1.09 | 1.11 | 1.14 | 1.15 | 1.15 | 1.10 | 1.05 | 1.03 | 1.01 |
| now | 0.99 | 1.00 | 1.02 | 1.05 | 1.09 | 1.15 | 1.21 | 1.19 | 1.17 | 1.10 | 1.04 | 1.02 | 1.01 |
| before | 0.89 | 0.90 | 0.93 | 1.00 | 1.07 | 1.13 | 1.17 | 1.14 | 1.11 | 1.06 | 1.02 | 1.01 | 1.00 |

What is still off is the shape: Google's lift is broader than any one
Polyblur makes, rising sooner at 3 to 5px and running on further past 16px,
and it is not quite the same everywhere in a photo — the fox's gravel got
less from Google at 6 to 8px than its fur did (×1.25 against ×1.72 at 6px),
where the app treats them alike and so lifts the gravel's mid band ×1.71
against Google's ×1.42. See below.

Then the charts, exported through the app at 2160 and read as before (gain by
each grating's fundamental against the chart as it came; ours / the phone's,
and in brackets the app before this refit where it moved):

| | 4px | 6px | 8px | 12px | 20\|235 edge, dip, rise | 100\|170 edge, dip, rise | 1px line peak | noise, ours raw → after q90 JPEG / Google's |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 1.26 / 1.16 (1.19) | 1.35 / 1.32 (1.31) | 1.25 / 1.22 (1.23) | 1.11 / 1.08 (1.10) | 1, 8 / 3, 2 (1, 4) | 0, 2 / 2, 1 (0, 1) | +12 / +5 (+7) | 3.20 → 2.82 / 2.60 (2.54) |
| 52 | 1.55 / 1.33 (1.39) | 1.73 / 1.68 (1.65) | 1.53 / 1.47 (1.48) | 1.23 / 1.18 (1.21) | 2, 16 / 5, 4 (2, 7) | 1, 5 / 6, 3 (1, 2) | +24 / +11 (+14) | 3.46 → 3.12 / 2.74 (2.62) |
| 77 | 1.81 / 1.48 (1.58) | 2.08 / 1.99 (1.95) | 1.78 / 1.68 (1.70) | 1.34 / 1.26 (1.31) | 4, 20 / 8, 7 (4, 11) | 1, 7 / 8, 4 (1, 3) | +33 / +17 (+18) | 3.73 → 3.43 / 2.89 (2.82) |
| 100 | 2.05 / 1.63 (1.75) | 2.40 / 2.28 (2.24) | 2.01 / 1.88 (1.91) | 1.44 / 1.34 (1.40) | 5, 20 / 11, 9 (5, 14) | 2, 9 / 10, 7 (1, 4) | +38 / +22 (+20) | 3.99 → 3.75 / 3.01 (3.10) |
| 100, blurred chart | — | — | 2.94 / 2.76 (2.84) | 2.89 / 3.11 (2.85) | 5, 20 / −1, 0 (4, 18) | 2, 6 / 4, 3 (1, 6) | −48 / −47 | 0.85 → 0.86 / 0.87 |
| 100, clipped chart | 1.74 / 1.44 (1.44) | 1.72 / 1.69 (1.56) | 1.47 / 1.43 (1.37) | 1.20 / 1.17 (1.15) | 4, 20 / 8, 10 (4, 14) | 1, 10 / 7, 8 (1, 5) | +27 / +13 (+8) | 3.89 → 3.63 / 2.68 (2.85) |

A rise of 20 at the 20|235 edge is as far as it can go: that is white. The 2
and 3px gratings at 100 are 1.01 / 0.15 and 1.25 / 1.07 (0.51 and 0.83
before). This is what keeping a photograph's finest detail costs on a chart:
the finest gratings, the 4px one lifted 0.42 more than Google's, a 1px line
that peaks +38 where Google's peaks +22, and pixel-fine noise 0.74 louder
through the same JPEG. From 6 to 12px the charts are within 0.13 of the
phone, as they were, though the chart itself at 100 has gone from within 0.06
to within 0.13. On the photos none of this showed as grit or halo: in the
fine band the fox's soft background comes out less grainy than Google's (1.14
against 1.28) and the portrait's cheek as grainy (1.06 and 1.06 at 25), and
in the crops the whiskers and the rim of the eye ring about as far as
Google's do.

scale.mjs's patch at three sizes, each drawn into a 2160 export as the app
draws it (`scale.mjs versus`), gain by period in the photo's own pixels; ours
/ Google's (the app before this refit):

| | 2px | 3px | 4px | 6px | 8px | 12px | 16px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1080², ×2 | 1.73 / 0.92 (1.44) | 1.59 / 1.40 (1.37) | 1.42 / 1.39 (1.27) | 1.18 / 1.17 (1.11) | 1.09 / 1.08 (1.05) | 1.03 / 1.02 (1.01) | 1.02 / 1.01 (1.01) |
| 2160², ×1 | 1.00 / 0.41 (0.50) | 1.26 / 0.93 (0.85) | 1.73 / 1.42 (1.44) | 1.72 / 1.56 (1.56) | 1.47 / 1.35 (1.37) | 1.20 / 1.13 (1.15) | 1.10 / 1.06 (1.08) |
| 2160² with the squares | 1.01 / 0.42 (0.51) | 1.25 / 1.12 (0.83) | 2.05 / 1.76 (1.75) | 2.40 / 2.31 (2.24) | 2.01 / 1.98 (1.92) | 1.44 / 1.41 (1.40) | 1.22 / 1.19 (1.19) |
| 4032×3024, ×0.71 | 1.28 / 0.52 (0.87) | 0.99 / 0.59 (0.49) | 1.09 / 0.76 (0.63) | 1.61 / 1.33 (1.30) | 1.81 / 1.68 (1.61) | 1.53 / 1.48 (1.43) | 1.30 / 1.27 (1.24) |

From 6 to 12px the app is within 0.16 of the phone on every patch bar the
4032x3024 one's 6px, 0.28 over, and within 0.1 on eight of those twelve
numbers; below that it lifts more than Google, for the same reason as on the
chart.

The grey is as close as the measurement can see. The colour at White and Black
point ±100 is not: Google also takes about a tenth off a saturated colour at
Black point -100 and adds a little at +100, which the per-channel model does not
do and nothing tried yet explains.

## Still open

- **What Shadows' change-over actually keys on.** Median is close but not it:
  the calibration chart and a plain surround of 128 share a median and came
  out at slightly different points of the change, so a photo with a median
  near 128 is lifted up to six levels differently from Google at +100.
  Everything with a median below about 122 or above 130 matches to a level.
- **The shape of Sharpen's lift on a photograph.** Google's is broader than
  one Polyblur gives at any σ: on the fox it is ×1.38 at 4px and still ×1.42
  at 24px where the app's is ×1.17 and ×1.26, with the peaks two pixels
  apart. Fitting the three bands' weights freely matched it (about 0.04 over
  25, 52 and 100), but with weights that would ruin the charts, and a second
  lift at a larger σ that only a photo sees (the charts' two σ being equal)
  bought 0.13 → 0.12 for twice the passes, so neither was kept.
- **And its content.** In the same photo Google gave the fox's gravel less
  at 6 to 8px than its fur (×1.25 against ×1.72 at 6px). The app treats
  every part of a photo alike and so lifts the gravel's mid band ×1.71
  against ×1.42 — the largest miss, and it shows as a slightly grittier
  gravel in the crops. In the model, the grain split's fall-off raised from 2.9 to 12 levels
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
  fits the fox and the portrait and leaves every chart where it was, but two
  photos cannot tell it from a percentile or from something else that comes
  to the same on them, and the 4032x3024 patch, whose edge is only 42 copy
  pixels at its steepest, allows nothing past the forty-first. More photos
  through the phone would say: the portrait at 50 and 100 and a rainforest at
  25, 50 and 100 were planned and not run.
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
  ×1.73 where Google's is ×0.92 (×1.44 while the finest detail was traded),
  and that is 4px in a 2160 export. Carrying σ
  up from the photo's own size, and coming back down with a box rather than
  bilinearly, were both further off.
- **The rest of the chart.** Held to 20..235, the chart reads the same
  steepest slope as the patch and the app sharpens the two alike (6px
  ×1.72), but Google took the clipped chart to ×1.69 and the patch to ×1.56:
  something else on the chart — its colour, text, 1px lines or the scene —
  reads a little softer to Google's estimate than to the app's. That the app
  now matches the clipped chart is the finest detail no longer being traded,
  not this being solved.
- **Sharpen's hard edges and single lines.** At 100 the chart's 20|235 edge
  rings 5 under and to white over against Google's 11 and 9, the 100|170
  edge 2 and 9 against 10 and 7, and the blurred chart's 20|235 edge rises
  to white where Google's does not rise at all. The 1px line peaks +38
  against +22 — it was +20 while the finest detail was traded — and has no
  dark lobe beside it where Google's dips 9. Google's copy also softens a
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
