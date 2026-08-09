# Backlog

Work not yet started, in the order it should be picked up. `/add` appends to the
bottom; `/next` takes the topmost unchecked entry with no `blocked:` line.

The shape of an entry is defined in [`task-template.md`](task-template.md), and
that file is the only place it is defined. Order is a judgement about what
matters most and stays a human one — but an entry sitting above something it
depends on is simply wrong, and that much can be put right without asking.

---

- [x] **Bring the browser test suite into the repo**
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

- [ ] **Close the 47px strip below the dock on an installed iPhone**
  why: installed on an iPhone, roughly 47 CSS pixels of screen below the dock
    are not the app, and read as a black bar. It is only cosmetic and it is only
    that platform in that display mode, but it is the first thing you see at the
    bottom of every screen.
  acceptance:
    - on an installed iPhone there is no strip below the dock in a different
      colour from it, checked on a device and said so plainly in the commit
    - `document.body.getBoundingClientRect().bottom` equals `screen.height`, or
      the strip is painted the same colour as the dock and the reason it cannot
      be filled is written down instead
    - the page still does not scroll as a document, and `.pagesbar` still clears
      the status bar — both were fixed and both are easy to undo by accident
      here
  files: styles.css (`html, body`, `.dock`), index.html (the apple-* meta and
    the viewport), manifest.webmanifest
  notes: measured on the device, and these are the only numbers anyone should
    start from — screen 844, innerHeight 797, clientHeight 797, 100dvh 797,
    body 797, documentElement.scrollHeight 797, safe-area insets 47 top and 34
    bottom, standalone true. 844 − 797 = 47, exactly the top inset, and the page
    fills the view exactly at whatever height it is given. So the strip is
    outside the view and no stylesheet reaches it.

    Six things were tried and none worked, so do not repeat them: `min-height:
    100dvh` (inert — 100% already wins); `height: 100dvh` (actively worse, it is
    797 where 100% is the full view, and it is what put the bar back after it
    had seemed to go); `overflow: hidden` and `overscroll-behavior: none` on
    html (correctly stops the document scrolling, does nothing to the strip);
    `apple-mobile-web-app-status-bar-style` from black-translucent to black (the
    measured inset stayed 47/34 either way, on a clean install); and reinstalling
    under each of the two status-bar styles.

    Worth knowing: the strip was already there before any of that, and the one
    version that appeared to fix it only left the page scrollable, so it could be
    pushed out of sight. A change that "fixes" this by making the page taller
    than the viewport has not fixed it.

    Untried, in the order worth trying: dropping `viewport-fit=cover`, which is
    what makes the view full-bleed and short in the first place; and matching the
    manifest's `background_color` to the dock's `--surface` so the strip stops
    being a different colour from what is above it. Both need a fresh install to
    judge, because iOS reads those at install and never again.

    This cannot be closed from a hosted session — there is no way to reproduce an
    installed iPhone from one, which is why six attempts were guesses. The next
    person should put the phone on a Mac and use Safari Web Inspector, and read
    the live values rather than reason about them.

- [ ] **Get the browser suite to a green run**
  why: the suite now runs from a clone and in CI, but four tests fail, one is
    flaky, three assert nothing and one is stale, so the run CI performs is red
    on every push and will train everyone to ignore it. All of it predates the suite
    arriving in the repository — the five were run against the app as it stood
    before and failed identically — so this is inherited work, not a
    regression, and it is the last thing between here and a check worth having.
  acceptance:
    - `photodates`, `reorder`, `share` and `update-path` either pass or are
      deleted with a note saying what they used to cover
    - `dock-haptics`, `iframe` and `manifest-fresh` either assert something or
      go; a test that exits 0 whatever it observes is not a test
    - `swr` passes or goes
    - `playtrim` passes ten consecutive full-suite runs, or the timing
      assumption that makes it flaky is written down in the test
    - `node run.mjs` exits 0 on a machine with ffmpeg, with no tolerance list
    - the counts in `tests/README.md` and CLAUDE.md match what the runner
      prints
  files: tests/
  notes: measured numbers and the failure reason for each are in
    `tests/README.md`. `reorder` fails on a null `boundingBox()` for `.film` in
    its second touch-emulation context, which looks like the app still being on
    the homepage there — `querySelectorAll` finds the films because hidden
    elements are still in the DOM, which is why its wait passes and the
    measurement then does not. `update-path` prints "the old build installed"
    three times, so it is one cause rather than three. `playtrim` passed three
    runs in isolation and failed one of two in-suite, so whatever it is depends
    on what ran before it. Do not add a known-failing tolerance list to make CI
    green — that was deliberately not done, because it is the decision that
    turns a red suite into a permanently amber one nobody reads.

- [ ] **Read the date a HEIC was taken out of its EXIF**
  why: `takenAt()` gives up on anything that is not a JPEG, so a HEIC falls
    back to `File.lastModified` — the moment the file reached this device, not
    the moment the shutter went.
    Narrower than it first looks, and the correction matters for where this sits
    in the order. The file input asks for `image/*`, and iOS transcodes a HEIC to
    JPEG when you pick a photo that way, EXIF intact — so the ordinary route
    through the picker already gets the right date, demonstrated on a device.
    What is left is the routes that hand over the original file: the share sheet,
    and picking out of Files or iCloud Drive.
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
    for the pixels rather than the metadata — and libheif is the safer of the two,
    because it already parses real iPhone HEICs correctly today, which is the
    whole reason it is vendored. A hand-rolled ISOBMFF walker would be new code
    reading untrusted binary with nothing real to test it against.

    Scoping got as far as proving the route and no further. libheif exposes the
    metadata functions, but as raw wasm exports rather than cwrapped ones, so the
    type filter needs a real C string and `heif_image_handle_get_metadata`
    returns a struct by value, which against a raw ABI means the caller passes a
    hidden out-pointer first. Neither can be settled without a HEIC that actually
    carries EXIF, and `tests/fixtures/photo.heic` carries none — its box tree is
    ftyp/meta/mdat with no Exif item. So this wants one straight-out-of-camera
    HEIC in `tests/fixtures/`, not passed through anything that re-encodes.

    It sat above the date-sort entry on the strength of "an iPhone camera roll is
    the likeliest source", which turned out to be wrong — see why above. Both are
    fine where they are now; neither blocks the other in the common case.

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

- [x] **Make the delete-page cross travel with its page**
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

- [x] **Say where an `/add` entry gets committed**
  why: `/add` forbids commits, which is right on a laptop and wrong in a
    hosted session, where the container is reclaimed and anything uncommitted
    is destroyed. The two rules met for the first time this week and the
    command lost. Worse, the destination matters more than the command
    admits: `/next` reads the backlog off the branch it cuts, so an entry
    that has not reached `main` does not exist as far as it is concerned.
  acceptance:
    - `add.md` names `docs/BACKLOG.md` as the only path it may stage, and says
      to commit that path alone
    - running `/add` with unrelated modified files in the tree leaves every
      one of them modified and uncommitted afterwards
    - `add.md` says where the commit lands, and states plainly that an entry
      not on `main` is invisible to `/next` until it is merged
    - `next.md`'s scope-discipline paragraph says which branch a
      noticed-while-working entry lands on, and acknowledges that it travels
      with that task's pull request
    - CLAUDE.md's "Managing work" section agrees with both commands, with no
      instruction living in only one of the three
  files: .claude/commands/add.md, .claude/commands/next.md, CLAUDE.md
  notes: the hook that forced this is `~/.claude/stop-hook-git-check.sh`,
    outside the repository and shared by every hosted session, so it cannot
    be fixed from here and should not be worked around — its purpose is
    exactly the right one, which is that an ephemeral container loses
    uncommitted work. The commands were written for a persistent working
    tree and need to say what they do without one. Two smaller things fall
    out of the same reading: an `/add` that stages everything would commit
    whatever code was in flight beside the entry, and `/next` currently tells
    itself to put noticed items "in the backlog, not into the current branch"
    while standing on a task branch, which is not a thing it can do.
