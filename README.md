# Grid Collage

A tiny web app for building Instagram photo grids. Drop a handful of photos in,
pick a layout, nudge the gap and background, and download one image ready to post.

Everything runs in the browser — no upload, no server, no build step. Your photos
never leave the machine.

## Use it

Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## What it does

- **12 layouts** — plain grids from 1×2 up to 3×3, plus four mosaic layouts with one hero tile.
- **Post shapes** — 1:1, 4:5, 3:4 and 9:16, sized for feed posts, portrait posts and stories.
- **Per-tile crop** — drag a photo inside its tile to reposition, scroll to zoom, double-click to recentre.
- **Gap, border, corners** — sliders for the space between tiles, the outer margin and the corner radius.
- **Background** — eight presets plus a colour picker; shows through the gaps and rounded corners.
- **Reorder** — drag the thumbnails in the sidebar to move photos between tiles, or hit Shuffle.
- **Export** — JPG or PNG at 1080, 1440 or 2160px.

Layout, spacing and colour choices are remembered between visits. Photos aren't.

## Shortcuts

| Key | Action |
| --- | --- |
| Click an empty tile | Add a photo |
| Drag inside a tile | Reposition the crop |
| Scroll over a tile | Zoom the crop |
| Double-click | Recentre the selected tile |
| `Delete` / `Backspace` | Remove the selected photo |
| `Esc` | Deselect |

## How it works

`app.js` renders the whole collage into a single `<canvas>` sized at the export
resolution — the preview you see is literally the file you download, scaled down
by CSS. Layouts are declared as rectangles in grid units, so adding one is a few
lines in the `LAYOUTS` array:

```js
{ id: 'big-top', cols: 3, rows: 3, cells: [
  { x: 0, y: 0, w: 3, h: 2 },
  { x: 0, y: 2, w: 1, h: 1 }, { x: 1, y: 2, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 },
] }
```

## Deploying

It's three static files. Any static host will do — for GitHub Pages, enable Pages
on the `main` branch from the repository settings and it's live at
`https://<user>.github.io/grid-collage/`.
