# Browser tests

40 standalone Node scripts that serve the repository over http, drive Chromium
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
```

Every test binds its own port, so running them together is safe. One at a time
is the default anyway: several import twelve 12-megapixel photos on purpose, and
four Chromiums doing that at once is how a machine starts swapping.

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

The two small fixtures are committed: `clip.webm` (20 KB) and `photo.heic`
(1.8 KB). The rest — twelve 4032×3024 JPEGs, twelve 1080×1920 clips and one
H.264 `clip.mp4` — come to about 70 MB and are generated.

`clip.webm` is 640×640, red for its first second then blue for two more, 3.07s.
Several tests depend on exactly that: a window longer than the clip has to show
both colours for the canvas to count as following the video. A replacement must
keep the two-colour structure or those tests stop meaning anything rather than
failing honestly.

`clip.mp4` is H.264 on purpose — the bundled Chromium cannot decode it, and
`test-video` uses it to check the app degrades properly rather than to check
playback.

## Where it stands

Measured with the fixtures generated, so all 40 ran:

| | count |
| --- | --- |
| passed | 36 |
| assertions | 571 |
| failing | 1 — iframe, and it is a real one |
| flaky | 1 — playtrim, which passes alone and sometimes fails in a full run |
| assert nothing | 2 — manifest-fresh, progressive |
| known stale | 1 — swr |
| skipped for fixtures | 0 here, 6 without ffmpeg |

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
  box at all and died on a null rectangle.
- `swipe` read the track while the second `touchMove` was still queued. Chrome
  delivers `pointermove` aligned to the animation frame, so back-to-back
  dispatches arrive as one event or none — which is also what lost the
  dawdle-then-flick case its whole tail, leaving one velocity sample where two
  are needed. Each move now waits for its frame, which is what a finger does.
- `update-path` read three old builds from `/tmp/oldver/<sha>`, a directory
  nothing in the suite created — the fourth hardcoded path of the kind
  `paths.mjs` exists to end. It reported `✗ the old build installed` three times
  and read like a deploy problem; the old shell was simply 404ing, so no worker
  ever took control. Checked out of the history now, where those three revisions
  have been all along.
- `video` asserted that a video slide goes out as a still, on the grounds that
  this Chromium cannot encode. The premise half holds — `VideoEncoder` really is
  undefined — but the conclusion never did: mediabunny brings its own encoder
  and `01.mp4` lands, which was settled by capturing the download. It now
  accepts either outcome and still fails on a slide that vanishes.

**`iframe` is the real one, and the test was hiding it.** In the sandboxed frame
it embeds — `allow-scripts allow-forms allow-modals`, no `allow-same-origin` —
`localStorage` throws `SecurityError`, the photo sometimes never reaches the
tray, and Export stays disabled. It waited for `.film` length === 1, which an
empty deck satisfies, then asserted nothing and clicked a disabled button. The
wait is now on the button being enabled, so the failure names its own cause.
One run in three passes, so the framed import is racy rather than broken, and
the app plainly means to work framed — there is a `FRAMED` branch for it. Fixing
that is an app change and its own branch.

**`playtrim` is flaky, not broken.** Three runs in isolation, three passes; one
failure in two full-suite runs, on `nothing left running on the homepage`, and a
pass in the run the table above comes from. Something earlier in the suite, or
simply a warm machine, changes the timing — so a green `playtrim` is not evidence
of anything either way.

**Two suites at once is not a measurement.** In the run behind the table above,
`gridorder` died in 0 seconds with no output while another session was running
tests on the same machine; alone it passes 25 of 25. Several of these import
twelve 12-megapixel photos on purpose. If a test fails in a full run, fails in
no time at all, and passes by itself, look at what else the machine was doing
before looking at the test.

**`swr` is stale, as suspected.** It dies on
`getComputedStyle: parameter 1 is not of type 'Element'` before its first
assertion. `manifest-fresh` and `progressive` were suspected with it;
`manifest-fresh` turns out to assert nothing at all, and `progressive` is one of
the six that need fixtures, so it has still never run here.

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
