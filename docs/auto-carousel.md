# Building a carousel by itself

What the feature is meant to do, what exists, what the real data says, and what
is still undecided. Written as a handoff: someone picking this up should be able
to start from here without reading a chat log.

The backlog entries this relates to are **"Measure every photo as it is
imported"** (done) and **"Build a deck from the tray by itself"** (not started),
in [`BACKLOG.md`](BACKLOG.md).

---

## The goal

Import a trip's photos, press one thing, get a carousel worth posting.

Not "pick the best photos" in the abstract. The shape being aimed at is a
sequence of little stories:

- Find the **events** — the app should notice that these forty photos were four
  separate things, not one pile.
- For each event, emit a **block**: a full-page hero, then a collage of other
  photos from that same event that expands on it.
- The result reads as a trip rather than a shuffle.

In the owner's words: *"try and figure out based on locations maybe or group time
periods … create these little stories … first carousel image as a full page and
then maybe a two by two with some extra images from that same sort of event."*

## The rules of a deck, as agreed

- **Slide 1 is the strongest photo**, full page. It is the cover Instagram shows
  in-feed, and it is the only slide exempt from date order.
- **Everything after slide 1 runs in `taken` order.**
- **No collage touches another collage.** At least one full-page slide between
  them; more is fine.
- **A collage belongs to the hero before it** — supporting material for the event
  that hero introduces, not an independent page.
- **Collage members come from one event**, matched in tone, and near each other in
  time or place.
- **At most 20 slides**, and it does not have to use them. A tight eight beats a
  padded twenty.
- **The last slide does not need to be the second best.** Considered and dropped.
- **Events are ranked by photo density, not by quality.** Where a lot of photos
  were taken close together, something was happening. This came from the person
  who makes these carousels and is the single most useful idea in the design.

Deferred: the subject-versus-environment rule (a collage wanting one subject shot
plus two establishing shots, subjects placed diagonally rather than adjacent).
It is the only rule that needs a model, and dropping it is what makes a first
version pure arithmetic.

---

## What is built and shipped

**Measured once per photo, inside `ingest()`** while the full-resolution decode is
still in hand — the only moment native pixels exist. Persisted in IndexedDB
beside `taken`, because the pixels are gone a few lines later.

| field | what it is |
| --- | --- |
| `sharpness` | variance of the Laplacian, from a 3×3 grid of 128px windows copied at 1:1 |
| `focusFalloff` | centre sharpness ÷ edge sharpness. High means a subject with a soft background |
| `lum`, `lumSpread` | mean brightness and contrast |
| `sat`, `hueX`, `hueY`, `warm` | the tone vector — hue as a saturation-weighted vector, so grey pixels do not vote |
| `clipHi`, `clipLo` | fraction of blown highlights and crushed shadows |
| `hash` | 64-bit dHash, for spotting the same moment shot twice |
| `lat`, `lon`, `focal35` | read from EXIF, flat on the photo beside `taken` |

Verified in `tests/test-measure.mjs` and `tests/test-place.mjs`, against images
generated in process so the right answer is known:

- sharp checkerboard **41089** against a blurred copy of itself **1**
- a flat sky **0** — *lower* than the blur, which is why these rank and never
  verdict
- subject on a soft background: falloff **7.61**, evenly sharp **1.00**
- warm **+170** and cool **−170**, hue vectors pointing opposite ways
- the same scene moved three pixels: **0 bits apart**; a different image **28** of 64
- 35°41'22.2"N 139°41'30.12"E → **35.689500, 139.691700**, and the same with S/W
  refs → **−35.689500, −139.691700**

Cost: ten 12MP photos per run, three runs each side — **184 ms/photo without the
pass, 189 with**, ranges overlapping. No second decode.

**A Data button in the photo library** exports the whole tray as tab-separated
text: one row per photo, every field above, no pixels. This is how a real
library's numbers get out of a phone. It is the only reason anything below is
based on measurement rather than opinion.

---

## What a real library actually looks like

180 photos, one Tokyo trip, exported with the Data button.

| | |
| --- | --- |
| span | 2025-10-09 04:20 → 2025-10-11 18:46 UTC, **62.4 hours** |
| devices | **118 Samsung, 50 Fujifilm, 12 iPhone** — interleaved |
| usable locations | **zero** |

**Gaps between consecutive photos**, 179 of them, seconds:

| min | p25 | median | p75 | p90 | p95 | max |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 4 | **14** | 235 | 1195 | 5142 | 55730 (15.5 h) |

- 85 of 179 gaps are **≤10 s**. 31 are ≤2 s. Seven are exactly 0.
- max ÷ median = **3981×**.

### Two clustering ideas that do not work

- **Anchor to the largest gap.** One photo at the airport sets the maximum and
  every real boundary looks small beside it. The whole trip becomes one event.
- **Anchor to the median gap.** This was the proposal and the data killed it:
  half the gaps are bursts, so *the median is the burst interval*, not the rhythm
  between events. `3 × median` gives **70 events**; even `80 × median` gives 19
  lumpy ones.

### Two that do

Both land in the same place, which is the reassuring part:

- **`3 × p90`** (59.8 min) → **12 events**, 9 with three or more photos.
- **Collapse anything within 10 s into one "shot"** (180 photos → **95 shots**,
  shot-to-shot median 3.2 min), then cut at `15 × that` (48.6 min) → **13
  events**, 9 with three or more.

A 45-minute threshold recovers something that reads like a trip:

```
Thu 09 04:20-04:21    7 photos
Thu 09 13:13-13:57   21
Thu 09 15:19-16:18   10
Thu 09 17:43-19:29   18
Thu 09 20:46          1
Fri 10 12:15-12:56   18   Fuji + iPhone + Samsung
Fri 10 17:26-19:34   67   Fuji + iPhone + Samsung
Sat 11 07:19          1
Sat 11 09:04          1
Sat 11 10:04-10:29    8
Sat 11 12:22-13:42   20
Sat 11 16:50          1
Sat 11 18:18-18:46    7
```

Nine events with 3+ photos and four singles — roughly one hero-plus-collage block
each, which fits a 20-slide deck almost exactly.

### Three things the data taught that no amount of reasoning would

- **An event is not one camera.** Friday evening has all three devices in it.
- **`focal35` is real lens intent and a better subject signal than any pixel
  measurement.** The Samsung's `13 / 23 / 69 / 230` are its ultrawide, main, 3×
  and 10× cameras — so a 13mm frame is recognisably an establishing shot and a
  230mm one is a deliberately picked-out subject. The Fuji writes none, so it
  applies to some photos and not others in the same event.
- **`~2` files are crops** of the photo they are named after, same timestamp,
  different hash. Dedup has to handle "same moment, deliberately reframed".
- Several Fuji frames report `sat 0` — they were shot in monochrome, and that is
  correct rather than a bug.

---

## Known bug

**Zeroed GPS is stored as a real position.** The Samsung rows come through as
`lat 0, lon 0`. Zero/zero is a real place in the Atlantic. `readExif` discards a
*half* coordinate for exactly this reason but not an all-zero one, so a GPS block
that is present and blank sails through as a location.

Fix: treat an all-zero coordinate as absent. Wrong on its own terms regardless of
anything below.

## Why there are no locations at all, probably

Worth being precise, because it is not the parser:

- `focal35` **works on the real files**. It is read from the Exif sub-IFD via a
  pointer, exactly like GPS is read from the GPS sub-IFD via a pointer. If the
  mechanism works for one it works for the other.
- The parser passes seven assertions on a file built with real GPS.
- Samsung: tags **present but zeroed**. iPhone: block **absent**. Fuji: no GPS
  hardware, so absent is correct.
- Present-but-zeroed is what a privacy filter does — keep the structure, blank
  the values. Absent is what a stripper does.

So something removed the location before the file reached the app. Candidates:
Apple Photos export without "Unmodified Original", the iOS share sheet's
**Options → Location** toggle, Samsung Gallery's equivalent, or Safari's file
picker stripping location when handing photos to a web page.

**Cheapest test:** re-export one photo with location explicitly included, import
it, press Data. If coordinates appear, it is the transfer path and there is
nothing to fix in the app.

**If certainty is wanted:** add two columns to the export — whether a GPS block
was found at all, and the raw DMS values before conversion. That separates
"absent" from "present and zeroed" from "present and misread".

**Consequence for the design:** location clustering cannot be relied on. Build on
time, and let location refine it where it exists.

---

## Decisions still open

1. **Is the 13-event split right?** Only the person who was there knows. Friday
   evening is 67 photos in one block — if that was really dinner and then
   somewhere else, no time threshold will find the seam.
2. **Single-photo events: drop or keep?** A one-photo event can only be a
   full-page slide. Dropping means those photos never appear; keeping means
   slides that are not part of a story.
3. **Target slide count** — about 13, one hero per event, or about 20 with
   collages? The no-adjacent-collages rule caps it near 20 either way.
4. **Use the lens as a subject signal**, knowing it is absent on the Fuji?

Everything else can ship as named constants and be retuned once a real deck has
been looked at. These four change the output rather than the code.

## The tuning trap

The thresholds here are **relative to the imported set on purpose**. The same
principle killed an earlier idea of badging good photos above a fixed sharpness:
a flat sky measured 0, *below* a deliberately blurred image at 1. These numbers
rank photos against each other within one import. None of them is a verdict on a
single photo, and any feature built on an absolute threshold will be wrong in a
way that looks right.
