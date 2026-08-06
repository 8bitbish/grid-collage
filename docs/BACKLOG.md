# Backlog

Work not yet started, in the order it should be picked up. `/add` appends to the
bottom; `/next` takes the topmost unchecked entry with no `blocked:` line.

The shape of an entry is defined in [`task-template.md`](task-template.md), and
that file is the only place it is defined. Order is manual — only a human
reorders this list.

---

- [ ] **Bring the browser test suite into the repo**
  why: `/next` is told to "run the checks defined in CLAUDE.md", and right now
    the only check that lives here is `node --check app.js`. The 34 Playwright
    tests that actually cover this app sit outside the repository, so nobody
    else can run them and CI runs none of them.
  acceptance:
    - `tests/` holds the suite and a runner that exits non-zero on any failure
    - a fresh clone can run the whole suite with one documented command
    - the large photo fixtures are generated or fetched by a script rather than
      committed — 12 of them are ~6MB each and have no business in git history
    - CLAUDE.md's "checks" section names that command and nothing older
    - the Pages workflow, or a second workflow, runs it on push to main
  files: tests/, CLAUDE.md, .github/workflows/
  notes: the suite currently needs Chromium via Playwright and generates its
    video fixtures with ffmpeg. Both are environment setup, so the runner
    should say plainly what it needs rather than failing obscurely.

- [ ] **Offer "Sort slides by date taken" in the Page panel**
  why: importing a folder builds one slide per photo in whatever order the
    picker handed them over, which is often not the order they were taken.
    Reordering twenty slides by hand is the tedious part of a long carousel.
  acceptance:
    - the Page panel has an action that reorders every slide by its photo's
      `taken` timestamp, oldest first
    - it is a single undo step
    - slides holding more than one photo sort by the oldest photo on them
    - a deck where nothing has a usable timestamp says so and changes nothing
  files: app.js (page panel actions, `state.pages`), index.html (dock markup)
  notes: `photo.taken` already exists and is populated from EXIF for photos and
    from the file's own timestamp for video — see `takenAt()` and `ingest()`.
    Came out of the Google Photos investigation; never picked up.

- [ ] **Make the delete-page cross travel with its page**
  why: the cross belongs to the page, but it is a sibling of the track rather
    than a passenger on it, so during a swipe the page slides out from under a
    cross that stays pinned where it was. On commit it vanishes outright and
    the next page arrives without one until the slide ends.
  acceptance:
    - sampled mid-drag, the cross's bounding rect keeps the same offset from
      its own canvas's bounding rect as it has at rest, to within a pixel
    - all three canvases in `#track` carry a cross at their own top-right
      corner with the same inset, so a committed turn shows one arriving with
      the incoming page rather than appearing after it lands
    - a click on any cross while `sliding` is true deletes nothing
    - at rest only the current page's cross is clickable; a click at a peek
      cross's position deletes nothing
    - the existing hide rules still hold: no cross anywhere while a tile is
      selected or while the deck holds no photos
    - a snap-back from an uncommitted swipe leaves each cross on its own
      page's corner with no jump at the end
  files: app.js (`placePageX`, the carousel motion section), index.html
    (`#canvas-wrap` markup), styles.css (`.page-x`)
  notes: three gotchas found while scoping. `placePageX` measures against
    `#canvas-wrap` and reads `canvas.getBoundingClientRect()`, which already
    includes the track's transform — parenting the button into `#track` makes
    `.track` the offsetParent and the two errors only cancel at
    `translateX(0)`. The peeks are sized in explicit pixels and centred with a
    JS `translate`, unlike `#canvas` which is sized by constraint, so a peek's
    corner has to be measured separately. `.page-x` is deliberately absent
    from the shared transition list in styles.css, so it has no transition of
    its own and any position change lands as a jump. Swipe listeners live on
    `#canvas-wrap` and `pointerdown` already early-returns on
    `e.target.closest('button')`, so a cross inside the track stays exempt
    from starting a swipe.
