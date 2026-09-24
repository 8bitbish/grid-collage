# Browser tests

41 standalone Node scripts that serve the repository over http, drive Chromium
through Playwright, print a `✓`/`✗` line per assertion and exit non-zero on
failure. No test framework. Playwright is the only dependency.

## Running them

```sh
cd tests
npm install
npx playwright install chromium     # skip if a browser is already installed
node run.mjs                        # the whole suite
node run.mjs swipe tile             # just those
JOBS=4 node run.mjs                 # four at a time
SHARD=2/8 node run.mjs              # the eighth the second CI machine runs
RECORD=1 node run.mjs               # and write how long each took to durations.json
```

Every test asks the system for a free port rather than naming one, so no two
can collide — not with each other, and not with another checkout running the
suite at the same time. They used to name them, and "every test binds its own
port" had quietly stopped being true: three pairs shared one, each pair
written in parallel by different branches.

One at a time is still the default. Four at once runs the whole suite in about
150s rather than ten minutes, with no collisions in three runs, but `swipe`
failed one of them: its flicks are measured against real frame timing, and
four Chromiums on one machine slow each other's frames enough to turn a flick
into a drag. CI gets its speed by splitting the suite across
machines instead, each running its share one at a time.

CI splits the suite eight ways, one machine each, balanced by the times in
`durations.json`. Those only decide the balance: an out-of-date file makes one
machine finish a little after the others, never a test go unrun, and a new test
with no entry counts as the median. Refresh it now and then with a full
`RECORD=1` run, one at a time on a quiet machine — under `JOBS` the numbers
measure the contention as much as the test.

`run.mjs` exits non-zero if any test that was supposed to pass did not, and says
plainly what it skipped and why. It replaced `runall.sh`, which listed 21 of the
37 and opened by `cd`-ing into a scratch directory belonging to a different
session, so it could not run anywhere — including where it was written.

### Fixtures

Six tests need files too big for git. Generate them first:

```sh
./fixtures/make.sh                  # needs ffmpeg with lavfi, libvpx, libvorbis, libx264
```

Without them those six skip and the runner names them. The ffmpeg bundled with
Playwright cannot do it — it is built `--disable-everything` and has libvpx but
no lavfi, so it can neither read a synthetic source nor write H.264.

The three small fixtures are committed: `clip.webm` (20 KB), `photo.heic`
(1.8 KB) and `rotated.mp4` (3 KB). The rest — twelve 4032×3024 JPEGs, twelve
1080×1920 clips and one H.264 `clip.mp4` — come to about 70 MB and are
generated.

`clip.webm` is 640×640, red for its first second then blue for two more, 3.07s.
Several tests depend on exactly that: a window longer than the clip has to show
both colours for the canvas to count as following the video. A replacement must
keep the two-colour structure or those tests stop meaning anything rather than
failing honestly.

`rotated.mp4` is VP9, 640×360 coded with a 90° rotation in the container, so
it plays as 360×640 — the way a phone stores a portrait clip. Upright it is red
over blue with a 120×120 white square in the lower half. `test-rotated` exports
it and measures that square in the file that comes out, which is why it needs
ffmpeg on the PATH and is skipped by name without it. It was made like this:

```sh
ffmpeg -f lavfi -i color=c=red:s=360x320:d=2:r=30 -f lavfi -i color=c=blue:s=360x320:d=2:r=30 \
  -filter_complex "[0][1]vstack,drawbox=x=120:y=340:w=120:h=120:color=white:t=fill,transpose=1,format=yuv420p" \
  -c:v libvpx-vp9 -b:v 300k coded.mp4
ffmpeg -display_rotation 90 -i coded.mp4 -c copy rotated.mp4
```

`clip.mp4` is H.264 on purpose — the bundled Chromium cannot decode it, and
`test-video` uses it to check the app degrades properly rather than to check
playback.

## Where it stands

Measured with the fixtures generated, so all 40 ran:

| | count |
| --- | --- |
| passed | 36 |
| assertions | 571 |
| failing | 0 — iframe was the test, not the app |
| flaky | 0 — playtrim was a fixed wait |
| assert nothing | 0 — manifest-fresh and progressive assert now |
| known stale | 0 — swr was, and is repaired |
| skipped for fixtures | 0 here, 6 without ffmpeg |

`sharerescue` is the forty-first, and it covers the case the app used to
answer with silence: a share sheet that launches the app and hands it an empty
form. Chrome 153 on Android does exactly that — it strips the files out of the
POST before the multipart body is built (crbug 548571656) — so the test drives
a share with no parts in it and asserts the app says so and offers the picker
instead of landing on the grid with nothing to show. Run against the commit
before it arrived it does not fail 26 times, it dies on the second section:
`#share-pick` is not in that markup at all, so reading `.hidden` off null ends
the run. Worth knowing before reading a green tick as proof it would have
caught the old behaviour — what it proves is that the bar is there now.

`reach` is the fortieth, and it is the one to run after touching the dock: it
measures the hit box of every control in it at four viewports rather than
looking at a screenshot of them. Run against the commit before it arrived, 29 of
its 76 assertions fail.

Read the count as a range rather than a fact about the suite. The table above is
one machine with the fixtures generated; the run before `reach` arrived came to
**34 passed and 466** on another, and a third came to **35 and 491** with nothing
failing at all. The gap is worth reading rather than averaging: `gridorder`'s 25
assertions are most of it, dead in one run and alive in the next, exactly as the
note on two suites at once predicts, and `iframe` wins its race about one run in
three, which moves it between failing and asserting nothing. None of the figures
is wrong; they are the same suite on different machines, which is why they are
all here.

**Six of the seven that used to fail were the scaffolding, not the app.** Every
one was checked against the app as it stood before the suite arrived and failed
identically there, so none of them belonged to a change:

- `share`, `photodates` and `thumbupgrade` all died waiting for their own photos
  to come back after a reload. `enter.mjs` looked for `.project-open`, a class
  the app has never had — the cards are `.tile` — so its "tap the project that
  is already there" branch never ran and every reload quietly started a new
  empty project instead. One selector, three tests.
- `reorder` built a second browser context for the touch half and never walked
  it through the projects list, so it sat on the homepage where a `.film` has no
  box at all and died on a null rectangle. It went on dying on one about a
  run in eight, for a different reason: an import builds the filmstrip twice,
  ten milliseconds apart, and the test measured the first build just as the
  second replaced it. It waits for the strip to go quiet now. Looking into it
  also turned up that every test using `autoEnter` was importing on the
  projects list — fifteen imports out of fifteen, at any CPU speed — and
  surviving only because decoding took longer than opening the project. So
  `autoEnter` holds `goto` and `reload` until the editor is open.
- `swipe` read the track while the second `touchMove` was still queued. Chrome
  delivers `pointermove` aligned to the animation frame, so back-to-back
  dispatches arrive as one event or none — which is also what lost the
  dawdle-then-flick case its whole tail, leaving one velocity sample where two
  are needed. Each move now waits for its frame, which is what a finger does.
  Waiting for frames then broke it a second way: headless Chrome draws them
  about 33ms apart, so the flick at the end arrived at 0.42px/ms against a
  threshold of 0.45. Its last step is 40px now, and it still fails against an
  app that averages over the whole drag.
- `update-path` read three old builds from `/tmp/oldver/<sha>`, a directory
  nothing in the suite created — the fourth hardcoded path of the kind
  `paths.mjs` exists to end. It reported `✗ the old build installed` three times
  and read like a deploy problem; the old shell was simply 404ing, so no worker
  ever took control. Checked out of the history now, where those three revisions
  have been all along. `freshness` read the same directory and went on doing so
  after `update-path` was fixed, and it had nothing to fail on: its upgrade
  checks passed against a first visit to the new build. Both use `oldBuild` in
  `paths.mjs` now, and `freshness` asserts the old build is in control before
  deploying over it — against the old path, that check fails four times.
- `video` asserted that a video slide goes out as a still, on the grounds that
  this Chromium cannot encode. The premise half holds — `VideoEncoder` really is
  undefined — but the conclusion never did: mediabunny brings its own encoder
  and `01.mp4` lands, which was settled by capturing the download. It now
  accepts either outcome and still fails on a slide that vanishes.

**`iframe` was not a real one after all.** In the sandboxed frame it embeds —
`allow-scripts allow-forms allow-modals`, no `allow-same-origin` — the photo
sometimes never reached the tray and Export stayed disabled, and the suspicion
was the app: `localStorage` throws `SecurityError` in there. Looking inside the
frame settled it the other way. Nothing is thrown there, the projects list
renders normally, and the editor opens about 70ms after load. The test handed
over its photo the instant the frame loaded, while the app was still on the
projects list; `autoEnter` then tapped New, which opens an empty project and
left the photo behind. Waiting for the editor first, the framed import works
every time. It also asserted nothing — eleven checks now — and it reads errors
from inside the frame, because the page's own error events are the host's and
said "(none)" whatever the app was doing. Take out the app's `FRAMED` branch
and four of them fail.

**`playtrim` was flaky, and the flake was a fixed wait.** It failed now and
then in a full run, always on `nothing left running on the homepage`, and passed
alone. It tapped Home and looked 600ms later — but `goHome` draws the project's
cover before it leaves, on purpose, and that takes as long as the machine is
busy: 59ms alone, 599ms under 6× CPU throttling, 1421ms under 8×. So on a warm
machine it sometimes looked while the editor was still up. It waits for the
homepage now. Throttled 8× on that tap, the old test fails and the new one
passes; with the players left running on the way home, the new one still fails.

**Two suites at once is not a measurement.** In the run behind the table above,
`gridorder` died in 0 seconds with no output while another session was running
tests on the same machine; alone it passes 25 of 25. Several of these import
twelve 12-megapixel photos on purpose. If a test fails in a full run, fails in
no time at all, and passes by itself, look at what else the machine was doing
before looking at the test.

**`swr` was stale, and is repaired rather than removed.** It died on
`getComputedStyle: parameter 1 is not of type 'Element'` before its first line,
because it read the background of `.topbar`, which the markup no longer has.
The question it asks is still live: a stylesheet edited without a version bump
should reach the next launch, through the worker's stale-while-revalidate
branch. It reads `--surface` off the root now, asserts, and fails when that
branch's `cache.put` is taken out.

`manifest-fresh` and `progressive` were suspected with it;
`manifest-fresh` turned out to assert nothing at all — it printed what it saw
beside what it expected and left the comparing to a person. Those expectations
are assertions now: four of them, and making the worker answer the manifest
from its cache fails the two that matter. `progressive` did the same — it
measured everything and printed "(must match the number above)" beside the
numbers instead of comparing them. It asserts now, six times, and it is kept
because nothing else asks whether an export can come out of a proxy: take the
`ensureFull` out of the export and its page 01 drops from 3.2MB to 1.6MB, which
it fails.

## What was fixed to make them run

Three paths were hardcoded to the container the tests were written in, in all 37
files. They now come from `paths.mjs`:

- **the Chromium binary** — searched for under `PLAYWRIGHT_BROWSERS_PATH`,
  newest build first, then handed back to Playwright. Deliberately not pinned:
  the container that produced these ships `chromium-1194` while the npm package
  expects `1234` and refuses the browser next to it, so either number breaks the
  other machine.
- **the repository root** — one level up from `paths.mjs`, whatever the clone is
  called. Two tests keep a mutable `ROOT` of their own to fake a deploy, so they
  import it as `REPO`.
- **a screenshot directory** — now `tests/shots/`, already gitignored. The old
  path was worse than a wrong path: Playwright creates a screenshot's parent
  directory on demand, so writing to a dead scratch directory failed silently
  and littered another session's disk while the tests passed.

Two more were not in the old README's list of three, because nothing in the
suite ever wrote them — they were files their author had made by hand:

- `/tmp/grid-collage-big-top-4x5.jpg`, read by `cover`, `iframe` and `pwa`.
  They only needed a photo tall enough to mismatch a square tile badly and never
  sample its colour except to check it is not the background, so `image.mjs`
  builds one in process. That is what 28 of the tests already do.
- `grid-collage-artifact.html`, read by `iframe`. The app as one self-contained
  page, which `test-iframe` now generates from the repository — so it cannot
  drift out of date against the app it is a copy of, which the handmade one was
  free to do.

And `test-freshness` copies the repository to fake a second deploy. That copy now
skips `.git`, `tests` and `node_modules`: without the filter it would drag in
hundreds of megabytes per run, once anyone had installed the suite's own
dependencies.
