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
