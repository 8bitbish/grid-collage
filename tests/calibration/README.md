# Calibration against Google Photos

The Adjust tools are meant to do what Google Photos' do, and nothing public says
how Google's work — no paper, blog post or patent covers White point,
Highlights, Shadows or Black point. So they were measured instead: one chart,
edited in Google Photos at a spread of settings, read back into numbers, and the
app built to reproduce them. This folder is how, so the next tool can be matched
the same way and the ones here can be checked again.

## The chart

`node chart.mjs` writes `out/chart.png` (2160×2160) and `out/chart.json`, the
layout the other scripts read. It is deterministic — the noise is seeded — so it
is regenerated rather than kept in git. Every region answers one question:

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
   same settings; measure that folder too, then
   `node compare.mjs <dir>/results.json` sets the two side by side.

`google.json` is everything read off Google's copies — 46 of them: every tone
tool at every quarter of the slider, Shadows lifting on a dark and on a bright
photo (`@dark`, `@bright`), and Sharpen at 25 to 100 and on a blurred chart
(`@blurred`, with `none@blurred` the blurred chart as it came). The ±50 and
±100 tone settings and all of Sharpen are the Android app's, at full size; the
rest are the web's. The JPEGs themselves are not kept.

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
  published for it): its response `p(k)`, `k` a Gaussian of σ ≈ 1.5px at the
  chart's 2160px, fits the gratings to within 0.04 of gain — α 4.3 and b 1.58
  at 50, α 12.8 and b 2.16 at 100. From 25 to 100 both run in straight lines,
  α ≈ 17.1s − 4.3 and b ≈ 1 + 1.17s for s the slider over 100, with σ steady
  near 1.5. Detail with a 6px period gains most (×2.8 at 100), and the noise
  patch came out slightly quieter, not louder. It adapts: on the chart blurred
  by σ 2px, Sharpen 100 fitted σ ≈ 2.6 — about √(1.5² + 2²) — so Google
  estimates each photo's blur, as Polyblur does. The app's Sharpen is not built
  that way yet.

How close the app now is, from `compare.mjs`:

| | grey steps, worst | colour patches, RMS / worst |
| --- | --- | --- |
| Highlights, all eight | 1 level | 0.6–0.9 / 1.8 |
| Shadows, lowering, all four | 1 level | 0.9–2.1 / 6.4 |
| Shadows +25 to +100, dark and bright photos | 1 level | — |
| White point, all eight | 1 level | 0.7–4.5 / 10.8 |
| Black point, all eight | 1–4 levels | 1.4–5.7 / 12.5 |

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
- **Sharpen**, as above.
- **Colour at White and Black point ±100**, where saturated patches are up to
  twelve levels from Google's.
