# Grid Collage

A carousel builder that runs entirely in the browser. Photos and video go into a
tray, each slide gets a layout, and the lot exports as numbered files ready to
post. No server, no upload, no build step.

## Shape of the thing

| file | what it is |
| --- | --- |
| `index.html` | all the markup, including every panel and sheet |
| `app.js` | the whole app, one IIFE, no modules |
| `styles.css` | all the styling |
| `sw.js` | service worker: offline shell, share target |
| `manifest.webmanifest` | PWA manifest, including the share target |
| `vendor/` | libheif (HEIC decode) and mediabunny (video), both lazy-loaded |

There is no bundler, no package.json and no dependency to install. The folder
you clone is the folder that gets deployed. Keep it that way — anything that
needs a build step needs a much better reason than convenience.

## Running it

```sh
python3 -m http.server 8000    # then http://localhost:8000
```

Opening `index.html` off disk mostly works, but the service worker, install and
share target all need it served over http(s).

## Checks

Before pushing anything:

```sh
node --check app.js            # and sw.js if you touched it
```

Then the browser suite, which is what actually covers this app:

```sh
cd tests && npm install && node run.mjs
```

39 tests, no framework, Playwright the only dependency. It exits non-zero on any
failure and says plainly what it skipped and why — six tests need fixtures too
big for git, which `tests/fixtures/make.sh` generates and which need ffmpeg. CI
runs the lot on every push and pull request.

Read [`tests/README.md`](tests/README.md) before trusting a green run. Five
tests fail for reasons that predate the suite arriving here, three assert
nothing at all, and one is stale — all named there, with numbers. The runner
counts those separately rather than as passes, so the figure it prints is the
number of tests that actually asserted something and were right.

The app itself still has no dependencies and no build step; `tests/` has its own
`package.json` precisely so the repository root stays the thing that gets
deployed.

Whatever you do, verify by measuring rather than by reasoning about it. Most of
the bugs in this app's history looked correct on the page and were caught by
sampling a canvas, counting decoders, or timing a launch. "It should work
because…" is not a check.

## Deploying

Push to `main`. The Pages workflow publishes the repository root as-is, and
takes about twenty seconds.

**Bump the version stamp in the same commit as any change to `app.js`,
`styles.css` or `index.html`.** It appears twice in `index.html`:

```html
<link rel="stylesheet" href="styles.css?v=2026.08.06e">
<script src="app.js?v=2026.08.06e"></script>
```

Both must match. That query string is what makes a deploy reach an installed
app on the first launch instead of the second, and `app.js` reads its own
version back off it to show on the homepage — so a mismatch shows the wrong
build number to the one people are running. Format is the date plus a letter
for the nth deploy that day.

## House style

The code here is written to be read. Match it rather than your own habits.

- **Comments explain why, not what.** If a comment restates the line under it,
  delete it. The ones worth writing record the thing that is not visible: the
  constraint that forced the design, the bug that was hit, the measurement that
  settled an argument. There are a lot of these and they are the point.
- **Prose, not notes.** Full sentences, British spelling, no shouting.
- **No dead abstractions.** One `drawPage` composes the preview, the filmstrip
  thumbnails, the project covers, the export and video frames. When something
  new needs drawing, it goes through there too — that shared path is why the
  export looks like the preview.
- **Names say what a thing is for**, not what type it is.
- **No new dependencies** without a clear reason. The two in `vendor/` are
  there because browsers genuinely cannot do those jobs.

## Git

- **Never rewrite history.** No `reset`, no `rebase`, no `--amend`, no force
  push. If something is wrong, fix it forwards.
- Commit messages explain the change and how it was verified, with the numbers
  where there are numbers. The log is the record of why this app is the way it
  is; treat it as documentation.
- One task per branch, and never commit to `main` directly.
- Anything noticed while working on something else is worth raising rather than
  fixing in the branch you are on. Keeping a change to one thing is what makes
  the log worth reading.
- **Stage by path, never `git add -A`.** More than one person works this tree
  and there is usually something half-finished in it. Look at `git diff` before
  committing and take only the paths that are yours.

## The design file

The app's design lives in one Figma file, and every call to the Figma connector
takes a `fileKey`. This is the one:

```
Grid Collage — vvTNILQSm10sgKMBqGTHYY
https://www.figma.com/design/vvTNILQSm10sgKMBqGTHYY
```

**Work in that file. Do not create a new one.** Nothing about a Figma file is
discoverable from a repository, so without this written down every session
starts by making a second file, and then there are two design systems that
disagree. It holds the token collection, the component sets, the icon set and
the screens.

The file is in the 3 SIDED CUBE plan, in drafts. The other plan on the account
is a View-only seat and cannot be written to.

## The design system in that file

- **Variables mirror `styles.css` where the CSS has a name for something.** The
  nine custom properties are flat variables — `bg`, `surface`, `accent` — each
  carrying `var(--bg)` as its code syntax so Dev Mode shows the CSS name. Groups
  (`type/`, `copy/`) are Figma-only organisation for things the stylesheet
  never named: the font sizes are literals scattered through the CSS, and the
  labels live in `index.html`.
- **Seed a bound paint with the token's own colour, never black.** A bound paint
  falls back to its base when it cannot resolve, and black on a dark UI simply
  disappears. This hid a real bug for a while: every stroked icon looked correct
  whether or not its binding worked, because `--muted` is the same `#8d8d9c`
  already baked into the SVGs.
- **Icons are the app's own set**, not Material Symbols. That was measured and
  rejected: at default weight the filled shapes sit heavier than the 1.7–2.2px
  strokes, and four of eight candidates were worse on meaning — `space_bar` for
  gap is a keyboard glyph, `rounded_corner` reads as marching ants at 22px.
- **Icon components must scale.** Both the wrapper frame and the vectors inside
  need `SCALE` constraints, or resizing the container crops the artwork instead
  of shrinking it. `createNodeFromSvg` gives the wrapper `MIN/MIN` and clipping,
  so this has to be set by hand every time.
- **Stroke weight in Figma is in final pixels. In the app it is in viewBox
  units, and the two are not the same number.** `styles.css` sets `stroke-width`
  anywhere from 1.7 to 2.2 inside a 24-unit `viewBox`, and the browser divides
  it by the render scale — so what actually lands on screen is about 1.5 CSS px
  at every icon size. The scatter in the source is what produces the consistency
  in the output, and it is deliberate: 2.2 at 16px and 1.7 at 22px both draw
  ~1.5. Figma scales geometry on resize but *not* stroke, so copying the source
  numbers across made every icon 20–28% too heavy. Icons here carry 1.5, the
  drawn width.

  The limit that follows: one component cannot reproduce per-context
  compensation, so an icon used well outside the 19–22px band will look wrong
  and wants an instance-level override rather than a new component.
- **Component states come from the CSS, not from taste.** `.btn:active` is
  `translateY(1px) scale(0.97)` with no colour change at all, so the Pressed
  variant differs only in size and looks like a mistake until you read the rule.
  Some things brighten rather than scale, and the stylesheet says why.
- Text properties go on the **component set**, not on a variant — a variant
  throws `Can only set component property definitions on a product component`.
  Bind the instance's property to the copy variable rather than the text node,
  or the properties panel and the canvas disagree.
- **Build it, screenshot it, compare it, fix it — then screenshot again.** A
  `use_figma` call that returns node ids has told you the API accepted the
  script, not that the result looks like the app. Take the screenshot large
  (`maxDimension` well past the node's real size, then `sips -Z` it bigger
  again) — at thumbnail size everything looks fine.

  This is not a nicety. The add-a-page slot came out as a 50×22 pill, because
  setting `layoutMode` after `resize()` quietly turns hugging back on and the
  frame collapsed around its `+`. The screenshot showed it instantly; the
  return value showed nothing. Fixing that then revealed a second fault the
  first had hidden — the same slot was clipped out of the strip altogether,
  because four 50px thumbnails and their gaps do not fit 200px of filmstrip.
  Both were only ever going to be found by looking.

  Where the app scrolls and Figma cannot, show fewer items rather than letting
  the overflow hide something. A clipped-off add button misrepresents the one
  thing the variant exists to demonstrate.

## Working here

- **Take the sensible default and get on with it.** Ask only when two readings
  lead to genuinely different work; otherwise pick, say which way you went, and
  keep moving.
- **Do not take focus.** Simulators and emulators get driven headless or through
  the background, because somebody is usually working on the same machine.
- **Task tracking is not in this repository.** It used to be, and three systems
  describing the same work was worse than none. Do not add a backlog file back.
