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

- [ ] **Read the date a HEIC was taken out of its EXIF**
  why: `takenAt()` gives up on anything that is not a JPEG, so every HEIC
    falls back to `File.lastModified` — the moment the file reached this
    device, not the moment the shutter went. An iPhone camera roll is the
    likeliest source of photos this app ever sees and the one place the date
    is currently wrong, which quietly undermines anything ordered by date.
  acceptance:
    - a HEIC whose EXIF `DateTimeOriginal` is known imports with
      `photo.taken` equal to that timestamp rather than to its `lastModified`
    - a HEIC carrying no EXIF still falls back to `lastModified`
    - a JPEG's `taken` is byte-for-byte what it was before the change
    - the two dates are printed for a real iPhone HEIC and the difference
      between them recorded in the commit message
  files: app.js (`takenAt`, the HEIC section, `ingest`)
  notes: the ordering in `ingest` already works — `takenAt` is handed the
    original blob at app.js:834, before the HEIC is re-encoded to JPEG, so
    only the `0xffd8` check at the top of `takenAt` stands in the way. HEIF
    keeps EXIF as an item inside its `meta` box; walking the boxes for it is
    likely cheaper than asking libheif, which is already loaded by then but
    for the pixels rather than the metadata. Blocks the auto-build entry
    below, and also the existing "sort slides by date taken" entry, which has
    the same wrong answer for the same reason.

- [ ] **Measure every photo as it is imported**
  why: choosing good photos out of a large tray needs numbers, and there is
    exactly one moment the full-resolution pixels exist — inside `ingest()`,
    between the decode and letting it go. Measured anywhere else it costs a
    second decode of every photo.
  acceptance:
    - each photo gains a sharpness score computed at full resolution
    - each photo gains clipped-highlight and clipped-shadow fractions, and a
      tone vector of mean luminance, luminance spread, mean saturation, hue
      as a saturation-weighted cosine and sine pair, and warm-minus-cool
    - each photo gains a 64-bit perceptual hash
    - GPS latitude and longitude, and focal length in 35mm equivalent, are
      read from EXIF and stored where the file carries them; a file carrying
      neither imports exactly as it does now
    - all of it is persisted and read back when a project opens, so reopening
      recomputes nothing
    - importing adds no second decode: the pass reads the bitmap `ingest()`
      is already holding
    - the photo library can be sorted sharpest first, so the measurements are
      useful before anything else consumes them
    - the added milliseconds per photo are measured and recorded in the
      commit message
  files: app.js (`ingest`, `readIFD`, the photo record, persistence, the
    photo library), index.html (library sort control)
  notes: sharpness has to be measured at native resolution. Downscaling is
    itself a low-pass filter, so it destroys exactly the high-frequency
    signal a variance-of-Laplacian measures and a 384px thumbnail cannot tell
    a sharp photo from a slightly soft one. Tone is the opposite — it
    survives downscaling, so the tone vector can come off the thumbnail.
    Absolute sharpness thresholds are not trustworthy: a photo of a flat sky
    scores low without being blurred, so these numbers are for ranking within
    a set and never for an absolute verdict. `readIFD` currently handles only
    ASCII and LONG tags; GPS sits behind tag `0x8825` as its own IFD with
    coordinates as RATIONAL triples, so it needs that type added.
    Everything read here must be extracted at import and persisted — the
    re-encode at app.js:832 writes from raw pixels and carries no metadata,
    so none of it can be recovered later.

- [ ] **Build a deck from the tray by itself**
  why: a tray holding one trip's worth of photos already contains the
    carousel; assembling it by hand is choosing a hero, finding the shots
    that support it, and repeating twenty times. The signals needed to do
    that are all measurable.
  acceptance:
    - the first slide is a single-cell page holding the highest-scoring photo
      in the tray, and is the only slide exempt from date order
    - every slide after the first is in non-decreasing `taken` order
    - no two adjacent slides both hold more than one photo
    - every collage's photos come from one event cluster, and no photo
      appears on more than one slide
    - within a collage, the largest pairwise tone distance is under a stated
      constant and the smallest pairwise perceptual-hash distance is over
      one, so the members match in tone without repeating each other
    - each collage's layout retains at least as much pixel area as every
      other candidate layout for the same photos
    - the deck is at most 20 slides, and a tray too small or too incoherent
      to fill a collage produces single slides rather than a bad collage
    - the whole build is one undo step
    - a run over a real tray is reported as a table of slide number, cell
      count, event and score, so the ordering can be checked rather than
      admired
  files: app.js (a new assembly section, `state.pages`, undo), index.html
    (the action that starts it)
  notes: events come from photo density, not from quality — where a lot of
    photos were taken close together in time, something was happening, and
    that ranks highlights far better than any aesthetic score. A collage
    belongs to the full-page slide before it, expanding on the event that
    slide introduces, so the unit being emitted is an event block of one or
    more full pages plus at most one collage. That is also why no two
    collages end up adjacent without a rule enforcing it: the good photos
    that belong to no dense cluster are what sits between the blocks.
    Depends on both entries above. Scope is whatever is in the tray, with no
    windowing — the expectation is a tray already curated to one trip or one
    place. The tone and hash thresholds are unmeasured, because no example
    carousel was available when this was scoped; they land as named constants
    with a comment saying so, and want calibrating against a real deck before
    they are trusted. Likely the largest entry here, and worth splitting once
    the entry above has landed and the real shape is visible.
