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

## Doing it

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

`google.json` is what step 4 made of Google's copies, for the 17 settings below.
The JPEGs themselves are not kept: this is everything that was read off them.

## What was found

Measured in September 2026, Google Photos for Android.

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
- **Sharpen** is Polyblur (Delbracio et al., the algorithm Google Research
  published for it): its response `p(k)`, `k` a Gaussian of σ ≈ 1.5px at the
  chart's 2160px, fits the gratings to within 0.04 of gain — α 4.3 and b 1.58
  at 50, α 12.8 and b 2.16 at 100. Detail with a 6px period gains most (×2.8 at
  100), and the noise patch came out slightly quieter, not louder. The app's
  Sharpen is not built that way yet.

How close the app now is, from `compare.mjs`:

| | grey steps, worst | colour patches, RMS / worst |
| --- | --- | --- |
| Highlights, all four | 1 level | 0.6–0.8 / 1.7 |
| Shadows ±50 | 1 level | 0.8–0.9 / 1.4 |
| Shadows ±100 | 1 level | 1.9–2.1 / 6.4 |
| White point, Black point ±50 | 1 level | 0.7–3.3 / 7.1 |
| White point, Black point ±100 | 1 level | 3.2–5.7 / 12.5 |

The grey is as close as the measurement can see. The colour at White and Black
point ±100 is not: Google also takes about a tenth off a saturated colour at
Black point -100 and adds a little at +100, which the per-channel model does not
do and nothing tried yet explains.

## Still open

- **White point -50.** The copy meant for it came back the same as -100, so the
  app puts -50 halfway to the -100 curve until it is measured.
- **Whether Google adapts a curve to the photo.** Everything here is off one
  chart. The same ramp on a mostly dark and a mostly bright surround, at
  Shadows +100 and Highlights -100, would settle it.
- **Settings between the ones measured.** Each knot moves in a straight line
  between the measured positions; ±25 and ±75 would show how true that is.
