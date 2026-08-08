# Browser tests

**These are preserved sources, not yet a working suite.** They were written
outside this repository and ran there against hardcoded paths. They are
committed here so they cannot be lost with a container; making them run from a
clone is the task in `docs/BACKLOG.md`.

Do not assume a green run from this directory. Nothing here has been run since
it was moved.

## What is here

37 test files, ~5,100 lines. Each is a standalone Node script that serves the
repository over http, drives the bundled Chromium through Playwright, prints a
`✓`/`✗` line per assertion and exits non-zero on failure. There is no test
framework and no `package.json`; Playwright is the only import.

- `runall.sh` — runs 21 of them in sequence. Sixteen more are not in it; see below.
- `enter.mjs` — `autoEnter`, injected into every test. Creates a project and
  opens it, so tests start in the editor rather than on the homepage.
- `fixtures/` — only the two small ones are committed. See below.

## Three things stop it running from a clone

Each is mechanical. All 37 files need the same treatment.

1. **The browser path is hardcoded**, 37 times:
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. That is where the
   container this was written in kept it. Should come from
   `PLAYWRIGHT_BROWSERS_PATH` or Playwright's own resolution.
2. **The repository path is hardcoded**, 37 times: `/home/user/grid-collage`,
   used as the http root. Should be derived from the test file's own location.
3. **A scratch directory is hardcoded**, 11 times, for screenshots — a
   `/tmp/claude-0/…/scratchpad/shots` path that no longer exists anywhere.

## Fixtures

**28 of the 37 tests need no fixture file at all** — they generate flat PNGs
in-process and hand them to the file input, which is why the fixture problem is
smaller than it looks. The nine that do:

| fixture | size | needed by | committed |
| --- | --- | --- | --- |
| `clip.webm` | 20 KB | playtrim, poster, replaceplay, video | yes |
| `photo.heic` | 1.8 KB | heic | yes |
| `photo0-11.jpg` | 5.6–5.9 MB each, 67 MB total | bulk, heic, progress, progressive, replaceplay, thumbupgrade | **no** |
| `clip.mp4` | 2.4 MB | video | **no** |
| `many/clip0-11.webm` | 2.8 MB total | bulk | **no** |

The 12 JPEGs are 4032×3024 (12.2 MP) — the point of them is to be a realistic
phone photo, since the memory tests measure what a 12 MP decode costs. Their
*content* does not matter; nothing samples their pixels. They are the reason
this directory cannot simply be committed whole, and they should be generated
rather than stored.

`many/clip*.webm` are 1080×1920 flat-colour VP8, four seconds, made with:

```sh
ffmpeg -f lavfi -i "color=c=<hex>:s=1080x1920:d=4:r=30" \
       -f lavfi -i "sine=frequency=<hz>:duration=4" \
       -c:v libvpx -b:v 1500k -c:a libvorbis -shortest clipN.webm
```

`clip.webm` is 640×640, red for its first second then blue for two more, 3.07s
total. Several tests depend on exactly that: a window longer than the clip has
to show both colours for the canvas to count as following the video. Any
replacement must keep the two-colour structure or those tests become
meaningless rather than failing honestly.

`clip.mp4` is 1080×1920 H.264 + AAC. It exists because the bundled Chromium
**cannot decode H.264** — `test-video` uses it to check the app degrades
properly rather than to check playback.

## The sixteen not in runall.sh

`runall.sh` lists 21. These sixteen were run alongside it by hand and are not in
any runner:

awkward, bulk, freshness, gridorder, heic, home, manifest-fresh, playtrim,
poster, progress, progressive, replaceplay, sharepick, swr, update-path, video

Thirteen of those were run regularly. **Three — `manifest-fresh`, `progressive`
and `swr` — are in no run list and have not been run in a long time.** They may
well be stale. Treat them as unverified until they have been run once.
