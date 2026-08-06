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

That is the only check that currently lives in this repository, which is not
enough — the browser suite that actually covers this app is still outside it.
Bringing it in is the top item in [`docs/BACKLOG.md`](docs/BACKLOG.md). Until
that is done, a change to behaviour needs verifying by hand in a browser, and
the commit message should say how it was verified.

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
- One task per branch. See `docs/BACKLOG.md` and the `/next` command.

## Managing work

- `docs/BACKLOG.md` — what is next, in order.
- `docs/task-template.md` — the shape of an entry. The only place it is defined.
- `/add <rough idea>` — scopes it against the code and appends a proper entry.
- `/next` — takes the topmost unblocked entry through to a pushed branch, on
  its own, without stopping to ask. It stops only on the conditions listed in
  the command itself, and it never commits to `main`. Review happens on the
  branch afterwards, so the acceptance criteria on an entry are doing the work
  a conversation would otherwise do — write them so they can be checked, not
  argued about.

Anything noticed while working on something else goes into the backlog, not
into the current branch.
