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
