# Browser tests

37 standalone Node scripts that serve the repository over http, drive Chromium
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

Measured on a container with no ffmpeg, so six tests skipped:

| | count |
| --- | --- |
| passed | 22 |
| assertions | 374 |
| failing | 5 — photodates, playtrim, reorder, share, update-path |
| assert nothing | 3 — dock-haptics, iframe, manifest-fresh |
| known stale | 1 — swr |
| skipped for fixtures | 6 — bulk, progress, progressive, replaceplay, thumbupgrade, video |

None of the five failures were caused by the change that brought the suite in.
They were checked against the app as it stood before it and failed identically,
with the same errors.

**Three tests assert nothing.** `dock-haptics`, `iframe` and `manifest-fresh`
print observations a person used to read and emit no `✓` or `✗`, so they exit 0
whatever they saw — `iframe` reports a 404 in its own output and still passes.
The runner counts them separately rather than as passes, because a suite that
reports green over a test which cannot fail is worse than one test short.

**`playtrim` is flaky, not broken.** Three runs in isolation, three passes; one
failure in two full-suite runs, on `nothing left running on the homepage`.
Something earlier in the suite, or simply a warm machine, changes the timing.

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
