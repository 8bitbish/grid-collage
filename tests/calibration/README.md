# Calibration against Google Photos

The Adjust tools are meant to do what Google Photos' do, and nothing public says
how Google's work — no paper, blog post or patent covers White point,
Highlights, Shadows or Black point. So they were measured instead: one chart,
edited in Google Photos at a spread of settings, read back into numbers, and the
app built to reproduce them. This folder is how, so the next tool can be matched
the same way and the ones here can be checked again.

## The chart

`node chart.mjs` writes `out/chart.png` (2160×2160), `out/chart-blurred.png`
and `out/chart.json`, the layout the other scripts read. It is deterministic —
the noise is seeded — so it is regenerated rather than kept in git. The blurred
chart is the same through a canvas `blur(2px)`, byte for byte the copy Google's
Sharpen was tried on (`@blurred`); made in a browser with SwiftShader instead it
comes out a touch sharper, and Sharpen notices. Every region answers one
question:

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
   same settings, and `--chart=out/chart-blurred.png` for `@blurred`; measure
   that folder too, then `node compare.mjs <dir>/results.json` sets the two
   side by side. For a detail tool it adds a second table: each grating's
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
  but run on a smaller copy. The 2px and 3px gratings came back with beats in
  them, periods of 14.2, 10.4 and 4.2px, which a filter working at the chart's
  own size cannot make; all three put the copy at 0.5702 of 2160px, to four
  figures, which is 1232px, a square of 1.5 megapixels with its side rounded up
  to 16. Only plain bilinear sampling down and back up aliased the 3px grating
  as strongly as Google's (5.8 levels against 5.5). Measured by fundamental
  rather than by swing, the finest detail is not lifted at all — 2px ×1.01,
  3px ×0.88 at 100 — and the lift is at 4 to 12px, most at 6px (×2.15). Fitted
  at the copy's scale with one σ of 0.75, α runs 0, 6.75, 13.75 and 21 from 25
  to 100 and b 0.98, 0.70, 0.38 and 0. It adapts: on the chart blurred by σ
  2px, Sharpen 100 lifted 8px by ×2.76 and 12px by ×3.11 of the blurred
  chart's own, which no σ reaches with the sharp chart's α and b; σ 1.1 in the
  copy with the lift scaled by 1.95 does. The noise patch came back quieter,
  not louder, and colour was untouched.

  What was built: the paper's blur estimate read off a copy at the working
  size (0.41 for the sharp chart, 1.57 for the blurred), mapped to σ and a
  gain through those two points; grain split off with a 3x3 bilateral filter
  and handed back unsharpened; the three bands and their weighting; and the
  paper's halo guard, with the photo's slope taken through the blur and the
  blend shared with each pixel's four neighbours, which is what took the
  hard edge's ring from 27 and 21 levels to 8 and 11. `app.js` has the
  measurements behind each piece.

How close the app now is, from `compare.mjs`:

| | grey steps, worst | colour patches, RMS / worst |
| --- | --- | --- |
| Highlights, all eight | 1 level | 0.6–0.9 / 1.8 |
| Shadows, lowering, all four | 1 level | 0.9–2.1 / 6.4 |
| Shadows +25 to +100, dark and bright photos | 1 level | — |
| White point, all eight | 1 level | 0.7–4.5 / 10.8 |
| Black point, all eight | 1–4 levels | 1.4–5.7 / 12.5 |

And Sharpen, exported through the app at 2160 and read the same way (gain by
each grating's fundamental against the chart as it came; ours / Google's):

| | 4px | 6px | 8px | 12px | 100\|170 edge, dip / rise | 1px line peak | noise (3.02 unedited) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 1.09 / 1.08 | 1.26 / 1.29 | 1.28 / 1.27 | 1.18 / 1.13 | 5, 6 / 4, 2 | +8 / +4 | 3.03 / 2.61 |
| 50 | 1.17 / 1.17 | 1.56 / 1.58 | 1.54 / 1.53 | 1.29 / 1.25 | 6, 9 / 8, 2 | +14 / +7 | 3.11 / 2.69 |
| 75 | 1.24 / 1.25 | 1.85 / 1.86 | 1.80 / 1.80 | 1.40 / 1.38 | 7, 10 / 11, 4 | +21 / +11 | 3.19 / 2.82 |
| 100 | 1.31 / 1.33 | 2.14 / 2.15 | 2.06 / 2.07 | 1.51 / 1.51 | 8, 11 / 16, 6 | +27 / +14 | 3.26 / 2.93 |
| 100, blurred chart | — | — | 2.82 / 2.76 | 3.18 / 3.11 | 3, 4 / 4, 3 | −49 / −47 | 0.80 / 0.87 |

The gratings, which are what Sharpen was fitted to, are within 0.05 everywhere.
The noise is not as far off as it looks: Google's copies are JPEGs, and the
same q90 round trip took the app's 3.03 and 3.26 at 25 and 100 to 2.59 and
2.86, against Google's 2.61 and 2.93. The rest is below.

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
- **How Sharpen's copy is sized for other photos.** One chart at one size
  cannot tell 1.5 megapixels from a fixed fraction of the photo, or a longest
  side of 1232; the app takes the first. They agree on the chart and differ
  on a 12MP photo, where the first sharpens at a scale about two photo pixels
  across and a fixed fraction at a little over one.
- **Sharpen's hard edges and single lines.** The app lifts a 1px line by 27
  levels at 100 to Google's 14, and shares an edge's ring evenly where
  Google's dips further on the dark side than it rises on the light (8 and 11
  against 16 and 6); its 3px grating gains ×1.10 where Google's loses a
  little. A one-dimensional model of the same pipeline agreed with the app
  on all three to a level or two, so it is something Google does that the
  model lacks. In that model, keeping only 60% of the detail finer than the
  copy brought the line's peak to Google's and softened the edge's middle as
  Google's is, but took the 2px grating to ×0.61; capping the lift at a
  multiple of the first band trimmed the ripple past the ring but not the
  ring.
- **What Sharpen's blur estimate keys on.** It reads a photo's steepest
  slopes, so it depends on what is in the photo as well as how soft it is:
  photos made of the chart's gratings and edges read 0.11 or 0.78 sharp and
  1.14 or 2.02 blurred, against the chart's 0.41 and 1.57. The app is
  calibrated on the chart, and nothing yet says whether Google's reads a real
  photo the same way.
- **Colour at White and Black point ±100**, where saturated patches are up to
  twelve levels from Google's.
