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

  What was built: a working copy of 1.5 megapixels up or down, taken with
  bilinear lookups; the blur estimate read off it once per decode, across and
  down separately, each slope turned into σ as above; grain split off with a
  3x3 bilateral filter of 2.9 levels, 39% of it handed back; the three bands
  and a fixed polynomial, α 13.7 and b 1.8, lifted 1.55 times over; the
  paper's halo guard with the photo's slope taken through the blur, the blend
  shared with each pixel's four neighbours and taken a fifth further; and at
  full size, the photo moved 51% of the way to the copy brought back up
  before the lift is added. All of it is worked out once per photo and size,
  and the slider scales the result. The constants were fitted to the phone's
  copies with a Python model of the same passes, not kept here, which agreed
  with the app's own exports to 0.02 on every grating; `app.js` has what each
  piece is for and what it measured.

How close the app now is, from `compare.mjs`:

| | grey steps, worst | colour patches, RMS / worst |
| --- | --- | --- |
| Highlights, all eight | 1 level | 0.6–0.9 / 1.8 |
| Shadows, lowering, all four | 1 level | 0.9–2.1 / 6.4 |
| Shadows +25 to +100, dark and bright photos | 1 level | — |
| White point, all eight | 1 level | 0.7–4.5 / 10.8 |
| Black point, all eight | 1–4 levels | 1.4–5.7 / 12.5 |

And Sharpen, exported through the app at 2160 and read the same way (gain by
each grating's fundamental against the chart as it came; ours / the phone's):

| | 4px | 6px | 8px | 12px | 20\|235 edge, dip, rise | 100\|170 edge, dip, rise | 1px line peak | noise, ours raw → after q90 JPEG / Google's |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 1.19 / 1.16 | 1.31 / 1.32 | 1.23 / 1.22 | 1.10 / 1.08 | 1, 4 / 3, 2 | 0, 1 / 2, 1 | +7 / +5 | 2.96 → 2.54 / 2.60 |
| 52 | 1.39 / 1.33 | 1.65 / 1.68 | 1.48 / 1.47 | 1.21 / 1.18 | 2, 7 / 5, 4 | 1, 2 / 6, 3 | +14 / +11 | 2.96 → 2.62 / 2.74 |
| 77 | 1.58 / 1.48 | 1.95 / 1.99 | 1.70 / 1.68 | 1.31 / 1.26 | 4, 11 / 8, 7 | 1, 3 / 8, 4 | +18 / +17 | 3.06 → 2.82 / 2.89 |
| 100 | 1.75 / 1.63 | 2.24 / 2.28 | 1.91 / 1.88 | 1.40 / 1.34 | 5, 14 / 11, 9 | 1, 4 / 10, 7 | +20 / +22 | 3.24 → 3.10 / 3.01 |
| 100, blurred chart | — | — | 2.84 / 2.76 | 2.85 / 3.11 | 4, 18 / −1, 0 | 1, 6 / 4, 3 | −48 / −47 | 0.83 → 0.85 / 0.87 |
| 100, clipped chart | 1.44 / 1.44 | 1.56 / 1.69 | 1.37 / 1.43 | 1.15 / 1.17 | 4, 14 / 8, 10 | 1, 5 / 7, 8 | +8 / +13 | 3.01 → 2.85 / 2.68 |

The 2 and 3px gratings at 100 are 0.51 / 0.15 and 0.83 / 1.07. What Google
leaves there is mostly beats against its copy's grid, and they were traded for
4 to 12px and the noise, which the fit weighted most.

scale.mjs's patch at three sizes, each drawn into a 2160 export as the app
draws it (`scale.mjs versus`), gain by period in the photo's own pixels; the
app as it was before this fit is the last figure:

| | 2px | 3px | 4px | 6px | 8px | 12px | 16px | worst over periods the export shows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1080², ×2 | 1.44 / 0.92 (1.50) | 1.37 / 1.40 (2.53) | 1.27 / 1.39 (2.54) | 1.11 / 1.17 (1.75) | 1.05 / 1.08 (1.37) | 1.01 / 1.02 (1.13) | 1.01 / 1.01 (1.04) | 0.52 (1.15) |
| 2160², ×1 | 0.50 / 0.41 (1.01) | 0.85 / 0.93 (1.10) | 1.44 / 1.42 (1.31) | 1.56 / 1.56 (2.13) | 1.37 / 1.35 (2.06) | 1.15 / 1.13 (1.51) | 1.08 / 1.06 (1.25) | 0.07 (0.71) |
| 2160² with the squares | 0.51 / 0.42 (1.01) | 0.83 / 1.12 (1.08) | 1.75 / 1.76 (1.20) | 2.24 / 2.31 (2.25) | 1.92 / 1.98 (2.29) | 1.40 / 1.41 (1.65) | 1.19 / 1.19 (1.33) | 0.29 (0.56) |
| 4032×3024, ×0.71 | 0.87 / 0.52 (1.15) | 0.49 / 0.59 (0.99) | 0.63 / 0.76 (1.14) | 1.30 / 1.33 (1.15) | 1.61 / 1.68 (1.82) | 1.43 / 1.48 (2.24) | 1.24 / 1.27 (1.84) | 0.13 (0.76) |

From 4 to 12px the app is within 0.13 of the phone on every image but the
1080² patch and the blurred chart, and within 0.07 on all but four of those
numbers. The noise, through the same q90 JPEG as Google's, is within 0.17 on
the chart and 0.27 on the patch.

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
- **Sharpen on grain rather than gratings.** In the same photo, Google lifted
  the grain round the patch much more than the patch's gratings at the same
  period and direction — detail running across ×1.77 at 8px against the 8px
  grating's ×1.35, ×1.56 at 12px against ×1.13, ×1.36 at 16px against ×1.06
  — and the same for grain of spread 4 and of 30, so it is not how strong the
  detail is. No filter that treats every part of a photo alike can do both.
  The app follows the gratings (×1.40, ×1.26 and ×1.15 on that grain), so on
  photos, which are more like grain than like gratings, it probably lifts
  8–16px detail less than Google does. A generated scene through the phone
  would say how much.
- **Small photos.** The app takes a photo under 1.5 megapixels up to the
  copy, as Google evidently does, but the 1080² patch's 2px grating comes out
  ×1.44 where Google's is ×0.92, and that is 4px in a 2160 export. Carrying σ
  up from the photo's own size, and coming back down with a box rather than
  bilinearly, were both further off.
- **The rest of the chart.** Held to 20..235, the chart reads the same
  steepest slope as the patch and the app sharpens the two alike (6px
  ×1.56), but Google took the clipped chart to ×1.69: something else on the
  chart — its colour, text, 1px lines or the scene — reads a little softer to
  Google's estimate than to the app's.
- **Sharpen's hard edges and single lines.** At 100 the chart's 20|235 edge
  rings 5 under and 13 over against Google's 11 and 9, the 100|170 edge 1 and
  4 against 10 and 7, and the blurred chart's 20|235 edge rises 18 where
  Google's does not rise at all. The 1px line's peak is right (+20 against
  +22) but it has no dark lobe beside it where Google's dips 9. Google's copy
  also softens a hard edge or not depending on where it falls against its
  grid — the patch's edge came back 26|209, the chart's 9|233 — and the app's
  grid does not fall where Google's does.
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
