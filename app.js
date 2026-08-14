/* Grid Collage — build an Instagram carousel.
 *
 * A deck is up to 20 pages. Each page has a layout and a set of tiles. Tiles
 * don't own photos: they reference one from a shared tray, so the same photo
 * can be a full-bleed page and part of a collage elsewhere without being
 * imported or held in memory twice.
 *
 * Styling (shape, gap, border, corners, background) belongs to the deck, not
 * the page — Instagram crops a carousel to one shape, and slides that change
 * colour or spacing read as a mistake.
 */

(() => {
  'use strict';

  /* ---------------------------------------------------------- definitions */

  const LAYOUTS = [
    { id: '1x1', cols: 1, rows: 1 },
    { id: '2x1', cols: 2, rows: 1 },
    { id: '1x2', cols: 1, rows: 2 },
    { id: '2x2', cols: 2, rows: 2 },
    { id: '3x1', cols: 3, rows: 1 },
    { id: '1x3', cols: 1, rows: 3 },
    { id: '3x2', cols: 3, rows: 2 },
    { id: '2x3', cols: 2, rows: 3 },
    { id: '3x3', cols: 3, rows: 3 },
    { id: 'big-left', cols: 3, rows: 2, cells: [
      { x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 1, h: 1 }, { x: 2, y: 1, w: 1, h: 1 },
    ] },
    { id: 'big-right', cols: 3, rows: 2, cells: [
      { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 1, w: 1, h: 1 }, { x: 1, y: 0, w: 2, h: 2 },
    ] },
    { id: 'big-top', cols: 3, rows: 3, cells: [
      { x: 0, y: 0, w: 3, h: 2 },
      { x: 0, y: 2, w: 1, h: 1 }, { x: 1, y: 2, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 },
    ] },
    { id: 'big-bottom', cols: 3, rows: 3, cells: [
      { x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 },
      { x: 0, y: 1, w: 3, h: 2 },
    ] },
  ];

  const RATIOS = [
    { id: '1:1', label: '1:1', w: 1, h: 1 },
    { id: '4:5', label: '4:5', w: 4, h: 5 },
    { id: '3:4', label: '3:4', w: 3, h: 4 },
    { id: '9:16', label: '9:16', w: 9, h: 16 },
  ];

  const SWATCHES = ['#ffffff', '#000000', '#f2efe9', '#e8d9c5', '#1e2a3a', '#ff4d8d', '#a8c7a0', '#c9c9d4'];

  const BASE_WIDTH = 1080;   // slider values are authored against a 1080px post
  const MAX_PAGES = 20;      // Instagram's carousel limit

  // A phone photo is ~12MP; the largest tile we ever draw is 2160px. Decoding
  // at full size costs memory and draw time for detail that can't survive the
  // downscale, so photos are resized once on the way in.
  // 0 means no cap: keep every photo at the size it arrived. See ingest().
  const MAX_EDGE = 0;
  // Exactly what the library grid asks for and no more: a tile is about 128
  // CSS px, so a 3x phone wants 384 real pixels across it. 512 was sharp but
  // half of it was never seen — at twenty photos that is a megabyte of
  // thumbnail to decode on every launch for nothing.
  const THUMB_EDGE = 384;

  // A stand-in for the photo, big enough that the preview can't tell: the
  // preview canvas is capped at the export width, 1080 by default. Decoding
  // one costs 14ms against 351ms for the 12MP original, which is the whole of
  // why a deck opens in a moment rather than in seven seconds. The original
  // is still there and gets decoded when something actually needs it.
  const PROXY_EDGE = 1440;

  // How long you have to stay on a page before its photos are worth decoding
  // at full size. Long enough not to fire while you're flicking through.
  const DWELL_MS = 700;

  // Shown at the foot of the homepage. The one thing it has to do is settle
  // "is the copy on my phone the one that was just deployed", so it is the
  // date of the deploy, with a letter after it if there is more than one in
  // a day. Bump it in the same commit as the change it ships.
  //
  // Read off this file's own URL rather than written down twice. The stamp
  // in index.html is what busts the cache after a deploy, and a version
  // label that disagreed with it would be worse than none at all — it would
  // say the new build was running when it wasn't. Embedded in a page with no
  // stamp to read (the published artifact), data-v carries it instead.
  const VERSION = (() => {
    const el = document.currentScript;
    if (!el) return 'dev';
    if (el.dataset && el.dataset.v) return el.dataset.v;
    try { return new URL(el.src, location.href).searchParams.get('v') || 'dev'; } catch { return 'dev'; }
  })();

  /* --------------------------------------------------------------- state */

  const state = {
    // deck-wide
    ratio: RATIOS[0],
    // A new deck starts with nothing turned on: no gap, no padding, square
    // corners. The photos are the thing, and every one of these takes room
    // away from them — you add them when you want them, rather than finding
    // a border you never asked for and having to hunt down the slider.
    gap: 0,
    padding: 0,
    radius: 0,
    bg: '#ffffff',
    quality: 1080,
    format: 'image/jpeg',
    // contents
    photos: [],
    pages: [],
    current: 0,
    selected: -1,
  };

  // Ids have to stay unique across every project, because all the photos
  // share one table — so the counter outlives the session that made it.
  const SEQ_KEY = 'grid-collage:seq';
  let nextId = 1;
  try { nextId = Math.max(1, Number(localStorage.getItem(SEQ_KEY)) || 1); } catch { /* private mode */ }

  function bumpSeq(n) {
    if (n <= nextId) return;
    nextId = n;
    try { localStorage.setItem(SEQ_KEY, String(nextId)); } catch { /* private mode */ }
  }

  const uid = () => { const id = `id${nextId}`; bumpSeq(nextId + 1); return id; };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = $('file-input');
  const dropzone = $('dropzone');

  // Everything the finger does to the deck is listened for here rather than on
  // the canvas. The canvas moves during a page turn and the peek layers sit
  // over it, so a second swipe arriving mid-slide would land on neither.
  const stageInput = $('canvas-wrap');

  const page = () => state.pages[state.current];
  const photoById = (id) => state.photos.find((p) => p.id === id);
  const photoFor = (cell) => (cell && cell.photo ? photoById(cell.photo) : null);

  // Bumped whenever something deck-wide changes, which invalidates every
  // cached page thumbnail at once.
  let styleRev = 1;
  const restyle = () => { styleRev += 1; };

  // Haptics, where the device has them. This is the Vibration API, which in
  // practice means Android: Safari has never shipped it, installed or not, so
  // every buzz here is a nicety and never something the app relies on to
  // communicate. Kept to moments that feel physical — picking a page up,
  // dropping it, a page turning, an angle clicking square, hitting a limit,
  // and a control in the dock going down under the thumb.
  const BUZZ = {
    tap: 7,
    pick: 10,
    drop: 14,
    snap: 6,
    turn: 5,
    // A slider's detents. Shorter than anything else here because a drag fires
    // a dozen of them in a second or two and they have to read as texture
    // under the thumb rather than as a dozen separate announcements.
    tick: 4,
    limit: [0, 18, 45, 18],
    // Something that cannot be taken back by tapping it again. Two pulses
    // rather than one longer one: length reads as emphasis and is easy to
    // mistake for a slow tap, where a second pulse is unmistakably not the
    // buzz every other button in the dock gives.
    warn: [0, 14, 32, 22],
  };
  function buzz(kind) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(BUZZ[kind] || 8); } catch { /* device said no */ }
  }

  // iOS Safari only applies :active to a touch if something in the ancestry
  // listens for touchstart. Without this the press states below are dead on
  // an iPhone — and with the system tap highlight off, that's no feedback at
  // all. An empty listener is the whole fix; passive, so it costs no scroll.
  document.addEventListener('touchstart', () => {}, { passive: true });

  let pendingCell = null;
  let importForChooser = false;
  const pointers = new Map();
  let gesture = null;
  let swipe = null;
  // A press that landed on the delete cross, waiting to see whether it turns
  // out to be a tap or the start of a drag.
  let crossPress = null;
  let sheetUrl = null;

  /* ------------------------------------------------------------ geometry */

  const layoutCells = (layout) =>
    layout.cells || Array.from({ length: layout.cols * layout.rows }, (_, i) => ({
      x: i % layout.cols, y: Math.floor(i / layout.cols), w: 1, h: 1,
    }));

  function outputSize() {
    const w = state.quality;
    return { w, h: Math.round(w * state.ratio.h / state.ratio.w) };
  }

  // The preview only needs enough pixels to look sharp on screen; rendering it
  // at export size cost 33ms a frame at 2160px.
  //
  // Measured against the container, never the canvas. A canvas can't display
  // larger than its own backing store, so sizing the backing store from the
  // canvas's own width is a loop that only ever ratchets the preview smaller —
  // it had shrunk to 31% of the available width on a phone.
  function previewSize() {
    const out = outputSize();
    const box = $('canvas-wrap');
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    if (!bw || !bh) return out;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // The largest post-shaped box that fits the container.
    const fit = Math.min(bw / out.w, bh / out.h);
    const w = clamp(Math.round(out.w * fit * dpr), 360, out.w);
    return { w, h: Math.round(w * out.h / out.w) };
  }

  function cellRectsFor(layout, W, H) {
    const s = W / BASE_WIDTH;
    const gap = state.gap * s;
    const pad = state.padding * s;
    const { cols, rows } = layout;
    const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const ch = (H - pad * 2 - gap * (rows - 1)) / rows;

    return layoutCells(layout).map((c) => ({
      x: pad + c.x * (cw + gap),
      y: pad + c.y * (ch + gap),
      w: c.w * cw + (c.w - 1) * gap,
      h: c.h * ch + (c.h - 1) * gap,
    }));
  }

  const cellRects = () => cellRectsFor(page().layout, canvas.width, canvas.height);

  function cellAt(px, py) {
    return cellRects().findIndex(
      (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
    );
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Where a photo lands inside its tile, honouring zoom, rotation and pan but
  // never letting the background show through.
  //
  // Rotation is what makes this non-obvious: an axis-aligned clamp is wrong the
  // moment the photo is turned, because the tile's corners escape it. So we
  // measure the tile's half-extents in the *photo's* frame and clamp there.
  // The same maths gives the smallest zoom an angle can be drawn at, so
  // rotating zooms in rather than tearing a hole in the tile.
  //
  // Offsets are stored in BASE_WIDTH units so framing survives a change of
  // preview or export resolution.
  function place(cell, photo, rect, s) {
    const cos = Math.abs(Math.cos(cell.rot));
    const sin = Math.abs(Math.sin(cell.rot));

    const hx = (rect.w / 2) * cos + (rect.h / 2) * sin;
    const hy = (rect.w / 2) * sin + (rect.h / 2) * cos;

    const base = Math.max(rect.w / photo.w, rect.h / photo.h);
    const minZoom = Math.max((2 * hx) / (photo.w * base), (2 * hy) / (photo.h * base));
    const zoom = Math.max(cell.zoom, minZoom);

    const dw = photo.w * base * zoom;
    const dh = photo.h * base * zoom;

    const limX = Math.max(0, dw / 2 - hx);
    const limY = Math.max(0, dh / 2 - hy);
    const ca = Math.cos(cell.rot);
    const sa = Math.sin(cell.rot);
    const px = cell.ox * s;
    const py = cell.oy * s;
    const vx = clamp(px * ca + py * sa, -limX, limX);
    const vy = clamp(-px * sa + py * ca, -limY, limY);

    return { dw, dh, zoom, minZoom, ox: vx * ca - vy * sa, oy: vx * sa + vy * ca };
  }

  // Write the clamp back, so the next gesture starts from what's on screen.
  function settle(i) {
    const cell = page().cells[i];
    const photo = photoFor(cell);
    if (!photo) return;
    const s = canvas.width / BASE_WIDTH;
    const p = place(cell, photo, cellRects()[i], s);
    cell.ox = p.ox / s;
    cell.oy = p.oy / s;
    cell.zoom = p.zoom;
  }

  /* --------------------------------------------------------------- render */

  // One page into any context at any size — used by the preview, the export
  // and the filmstrip thumbnails alike.
  function drawPage(g, pg, W, H, opts = {}) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, W, H);
    g.fillStyle = state.bg;
    g.fillRect(0, 0, W, H);

    const s = W / BASE_WIDTH;
    const radius = state.radius * s;
    const rects = cellRectsFor(pg.layout, W, H);

    rects.forEach((rect, i) => {
      const cell = pg.cells[i];
      const photo = photoFor(cell);

      g.save();
      roundedPath(g, rect, radius);
      g.clip();

      if (photo && photo.bitmap) {
        const p = place(cell, photo, rect, s);
        g.translate(rect.x + rect.w / 2 + p.ox, rect.y + rect.h / 2 + p.oy);
        g.rotate(cell.rot);
        // About the photo's own centre, so the area covered is unchanged and
        // the cover clamp still holds.
        if (cell.flipX || cell.flipY) g.scale(cell.flipX ? -1 : 1, cell.flipY ? -1 : 1);
        // cell.frame is set while a video is playing in the preview, and
        // while an export walks its frames. Failing that a clip draws as its
        // poster — the first frame of its trim — and failing that as the
        // photo's own bitmap, which for a clip is the file's first frame and
        // for a photo is the whole story. A video element, a decoded frame
        // and an ImageBitmap are all things drawImage takes, so a moving
        // picture composes through exactly the same code as a still one.
        g.drawImage(cell.frame || cell.poster || photo.bitmap, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
      } else if (opts.placeholders) {
        g.fillStyle = 'rgba(125,125,145,0.16)';
        g.fillRect(rect.x, rect.y, rect.w, rect.h);
        plusSign(g, rect, s);
      }
      g.restore();

      if (opts.selected === i) {
        g.save();
        g.strokeStyle = '#ff4d8d';
        g.lineWidth = Math.max(2, 4 * s);
        roundedPath(g, rect, radius);
        g.stroke();
        g.restore();
      }
    });
  }

  function render() {
    const { w: W, h: H } = previewSize();
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    drawPage(ctx, page(), W, H, { placeholders: true, selected: state.selected });
    // Only the current page is editable, so it's the only thumbnail that can
    // have gone stale from a render.
    page().rev = (page().rev || 0) + 1;
    placePageX();
  }

  // The delete-page button rides the top-right corner of the page itself. The
  // canvas is sized by constraint and centred, so where that corner lands
  // depends on the deck's shape and the space available — it has to be
  // measured, not expressed as an inset.
  //
  // There is one per page in the track, and each is measured against the track
  // rather than against the stage. That difference is the whole trick: both
  // rects are moved by the track's transform, so the gap between them reads the
  // same mid-swipe as at rest, and the cross travels with its page without
  // anything having to reposition it frame by frame. Measured against the stage
  // instead, the canvas rect would carry the transform and the stage rect would
  // not, and the two only agree at translateX(0).
  const PAGE_X_INSET = 8;
  // How far past the visible disc a press still counts, matching the 5px the
  // pseudo-element in styles.css adds. 17 + 5 gives the 44px a finger wants.
  const PAGE_X_REACH = 5;

  // Whether a press landed on the current page's cross, measured against its
  // rect rather than taken from the event's target.
  //
  // The button is inside the track now, which carries will-change: transform —
  // so it lives in a compositing layer it did not before, and a layer whose
  // absolutely-positioned children have a history of painting without taking
  // taps on iOS. This is the belt to that braces: if the press is routed to the
  // button, the handler on the button deals with it and this is never consulted.
  // If the browser hands the press to the canvas underneath instead, this is
  // what stops the cross being decoration.
  function overPageX(e) {
    const btn = $('btn-page-x');
    if (!btn || btn.hidden || sliding) return false;
    const r = btn.getBoundingClientRect();
    if (!r.width) return false;
    // Radially, because the disc is round: the corner of its box is several
    // pixels outside anything anyone can see.
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return Math.hypot(dx, dy) <= r.width / 2 + PAGE_X_REACH;
  }

  // Deleting the current page, from wherever the press was noticed.
  //
  // Both routes really do fire for one tap: measured, a single touch on the
  // cross runs the pointer sequence below *and* delivers a click to the button,
  // capture notwithstanding. So the guard is not defensive tidiness, it is the
  // only reason one tap deletes one page.
  let lastPageDelete = 0;
  function requestDeletePage() {
    const now = performance.now();
    if (now - lastPageDelete < 400) return;
    lastPageDelete = now;
    buzz('drop');
    deletePage(state.current);
  }

  function placePageX() {
    const btn = $('btn-page-x');
    if (!btn) return;
    // Out of the way while a tile is selected: the dock is showing that tile's
    // own Delete, and two crosses meaning different things is one too many.
    const hide = state.selected !== -1 || !state.photos.length;
    const track = $('track').getBoundingClientRect();

    [[btn, canvas], [$('btn-page-x-prev'), $('canvas-prev')], [$('btn-page-x-next'), $('canvas-next')]]
      .forEach(([el, cv]) => {
        if (!el) return;
        el.hidden = hide || !cv || cv.hidden;
        if (el.hidden) return;
        const rect = cv.getBoundingClientRect();
        if (!rect.width) { el.hidden = true; return; }
        el.style.left = `${rect.right - track.left - el.offsetWidth - PAGE_X_INSET}px`;
        el.style.top = `${rect.top - track.top + PAGE_X_INSET}px`;
      });
  }

  function roundedPath(g, r, radius) {
    const rad = Math.min(radius, r.w / 2, r.h / 2);
    g.beginPath();
    if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, rad);
    else g.rect(r.x, r.y, r.w, r.h);
  }

  function plusSign(g, r, s) {
    const arm = Math.min(r.w, r.h) * 0.09;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    g.strokeStyle = 'rgba(140,140,165,0.75)';
    g.lineWidth = 3 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - arm, cy); g.lineTo(cx + arm, cy);
    g.moveTo(cx, cy - arm); g.lineTo(cx, cy + arm);
    g.stroke();
  }

  /* ----------------------------------------------------------- deck edits */

  function blankCells(layout) {
    return layoutCells(layout).map(() => null);
  }

  // t0/t1 are the trim, in seconds, and they live on the cell rather than
  // the photo for the same reason zoom does: the same clip can be on two
  // slides cut two different ways. t1 of 0 means "to the end", so a cell
  // made before trimming existed needs no migrating.
  const emptyCell = (photoId) => ({
    photo: photoId, zoom: 1, rot: 0, ox: 0, oy: 0, flipX: false, flipY: false, t0: 0, t1: 0,
  });

  // What this cell actually plays: the trim if it has one, the whole clip if
  // not, clamped to what the file really contains.
  function clipRange(cell) {
    const photo = photoFor(cell);
    const whole = (photo && photo.duration) || 0;
    const from = clamp(cell && cell.t0 ? cell.t0 : 0, 0, Math.max(0, whole - 0.1));
    const to = clamp(cell && cell.t1 ? cell.t1 : whole, from + 0.1, whole || from + 0.1);
    return { from, to, span: Math.max(0.1, to - from), whole };
  }

  function newPage(layout = LAYOUTS[0], photoId = null) {
    const pg = { id: uid(), layout, cells: blankCells(layout), dirty: true };
    if (photoId) pg.cells[0] = emptyCell(photoId);
    return pg;
  }

  function addPage(layout) {
    if (state.pages.length >= MAX_PAGES) {
      buzz('limit');
      toast(`A carousel tops out at ${MAX_PAGES} pages`);
      return false;
    }
    snapshot();
    state.pages.push(newPage(layout));
    goTo(state.pages.length - 1);
    return true;
  }

  function deletePage(i) {
    snapshot();
    if (state.pages.length === 1) {
      state.pages[0] = newPage();
    } else {
      state.pages.splice(i, 1);
    }
    goTo(Math.min(state.current, state.pages.length - 1));
  }

  function setLayout(layout) {
    snapshot();
    const pg = page();
    // Keep the photos that were already placed, in order.
    const kept = pg.cells.filter(Boolean);
    pg.layout = layout;
    pg.cells = blankCells(layout).map((_, i) => kept[i] || null);
    if (state.selected >= pg.cells.length) state.selected = -1;
    refresh();
  }

  function goTo(i) {
    state.current = clamp(i, 0, state.pages.length - 1);
    state.selected = -1;
    refresh();
  }

  function refresh() {
    saveDeck();
    render();
    renderFilmstrip();
    renderPhotos();
    syncPanel();
    syncEmpty();
    syncFades();
    armDwell();
    manageResidency();
    syncPlayback();
    // Reading a frame out of a clip means decoding up to it, so it happens
    // off to the side and paints when it lands. A no-op once the poster
    // matches the cut, which it does for all but the first pass after a trim
    // moves — so this does not loop.
    ensurePosters(page(), () => { render(); renderFilmstrip(); });
  }

  // An untouched deck is one blank page and no photos: say so on the canvas
  // rather than showing an empty square and leaving the way in to be guessed.
  function syncEmpty() {
    const empty = !state.photos.length;
    $('blank').hidden = !empty;
    $('canvas-wrap').classList.toggle('is-blank', empty);
    $('btn-export').disabled = empty;
  }

  /* ----------------------------------------------------------- photo tray */

  // Encode a bitmap back to a blob — for the copy we persist, and for the
  // small tray thumbnail.
  async function encode(bitmap, type, quality) {
    if (window.OffscreenCanvas) {
      const off = new OffscreenCanvas(bitmap.width, bitmap.height);
      off.getContext('2d').drawImage(bitmap, 0, 0);
      return off.convertToBlob({ type, quality });
    }
    const el = document.createElement('canvas');
    el.width = bitmap.width;
    el.height = bitmap.height;
    el.getContext('2d').drawImage(bitmap, 0, 0);
    return new Promise((res) => el.toBlob(res, type, quality));
  }

  async function shrink(bitmap, edge) {
    const long = Math.max(bitmap.width, bitmap.height);
    if (long <= edge) return bitmap;
    const k = edge / long;
    return createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * k),
      resizeHeight: Math.round(bitmap.height * k),
      resizeQuality: 'high',
    });
  }

  /* --------------------------------------------- what a photo is like */
  //
  // A handful of numbers about a photo, taken once, inside ingest() while the
  // full-resolution decode is still in hand. That moment is the only one where
  // native pixels exist — the bitmap is closed a few lines later and everything
  // afterwards works from a 1440px proxy — so measuring anywhere else means
  // decoding every photo a second time.
  //
  // Sharpness is measured at native resolution and nothing else is. Downscaling
  // is a low-pass filter: it removes exactly the high-frequency detail that
  // tells a sharp photo from a soft one, so a thumbnail cannot answer the
  // question. Tone is the opposite and survives being shrunk, so it is read off
  // a 64px draw for almost nothing.
  //
  // None of these are verdicts. A photo of a flat sky scores low for sharpness
  // without being blurred, which is why these are for ranking photos against
  // each other within one import and never for an absolute pass or fail.

  const SHARP_TILE = 128;   // one window, drawn 1:1 so no resampling softens it
  const SHARP_GRID = 3;     // 3x3 of them across the frame
  const TONE_EDGE = 64;
  const HASH_W = 9;         // 9x8 greys give 8x8 = 64 comparisons
  const HASH_H = 8;

  function scratch(w, h) {
    if (window.OffscreenCanvas) return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const lumaAt = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Variance of the Laplacian — the standard way to put a number on focus. A
  // sharp edge swings the second derivative hard, a soft one barely at all, so
  // the spread of the response is the measure and its mean is not.
  function focusScore(d, w, h) {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = (y * w + x) * 4;
        const v = 4 * lumaAt(d, i) - lumaAt(d, i - 4) - lumaAt(d, i + 4)
          - lumaAt(d, i - w * 4) - lumaAt(d, i + w * 4);
        sum += v;
        sumSq += v * v;
        n += 1;
      }
    }
    if (!n) return 0;
    return sumSq / n - (sum / n) ** 2;
  }

  // bitmap must be the native-resolution decode. small may be any already-shrunk
  // copy of it — the proxy ingest has just made is ideal — and only tone and the
  // hash are read from it, both of which survive being downscaled. Passing the
  // full bitmap for both works and costs about 60ms more on a 12MP photo, all of
  // it spent resampling twelve megapixels down to 64x64 and 9x8 twice over.
  function measure(bitmap, small = bitmap) {
    const { width: W, height: H } = bitmap;

    // Sharpness, from a grid of windows copied out at 1:1. The whole frame at
    // native size would be twelve megapixels of arithmetic for a number that
    // nine small windows answer just as well.
    const tile = scratch(SHARP_TILE, SHARP_TILE);
    const tg = tile.getContext('2d', { willReadFrequently: true });
    const tiles = [];
    const step = SHARP_GRID + 1;
    for (let gy = 1; gy <= SHARP_GRID; gy += 1) {
      for (let gx = 1; gx <= SHARP_GRID; gx += 1) {
        const sx = clamp(Math.round(W * gx / step - SHARP_TILE / 2), 0, Math.max(0, W - SHARP_TILE));
        const sy = clamp(Math.round(H * gy / step - SHARP_TILE / 2), 0, Math.max(0, H - SHARP_TILE));
        const sw = Math.min(SHARP_TILE, W);
        const sh = Math.min(SHARP_TILE, H);
        tg.clearRect(0, 0, SHARP_TILE, SHARP_TILE);
        tg.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        tiles.push(focusScore(tg.getImageData(0, 0, sw, sh).data, sw, sh));
      }
    }
    // The sharpest window, not the average: a portrait with a soft background is
    // a sharp photo, and averaging it with the bokeh says otherwise.
    const sharpness = Math.max(...tiles);
    // Centre against the outside. High means the middle is in focus and the rest
    // is not, which is a subject or a close-up; flat means a landscape.
    const middle = tiles[4] || 0;
    const outside = tiles.filter((_, i) => i !== 4).reduce((a, v) => a + v, 0) / 8 || 1;
    const focusFalloff = middle / outside;

    // Everything else off a 64px draw.
    const tone = scratch(TONE_EDGE, TONE_EDGE);
    const sg = tone.getContext('2d', { willReadFrequently: true });
    sg.drawImage(small, 0, 0, TONE_EDGE, TONE_EDGE);
    const d = sg.getImageData(0, 0, TONE_EDGE, TONE_EDGE).data;

    let lum = 0;
    let lumSq = 0;
    let sat = 0;
    let hueX = 0;
    let hueY = 0;
    let warm = 0;
    let clipHi = 0;
    let clipLo = 0;
    const px = TONE_EDGE * TONE_EDGE;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const l = lumaAt(d, i);
      lum += l;
      lumSq += l * l;
      if (l > 250) clipHi += 1;
      if (l < 5) clipLo += 1;
      warm += r - b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max ? (max - min) / max : 0;
      sat += s;
      // Hue is circular, so it is summed as a vector and weighted by saturation
      // — a grey pixel has no hue to vote with and would otherwise drag the
      // average towards whatever red happens to be.
      if (max !== min) {
        let hue;
        if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        const a = hue * Math.PI / 3;
        hueX += Math.cos(a) * s;
        hueY += Math.sin(a) * s;
      }
    }

    // dHash: each grey compared with the one to its right. Structure rather than
    // colour, which is what makes it match two frames of the same burst and not
    // two different photos that happen to share a palette.
    const hc = scratch(HASH_W, HASH_H);
    const hg = hc.getContext('2d', { willReadFrequently: true });
    hg.drawImage(small, 0, 0, HASH_W, HASH_H);
    const hd = hg.getImageData(0, 0, HASH_W, HASH_H).data;
    let hash = '';
    for (let y = 0; y < HASH_H; y += 1) {
      for (let x = 0; x < HASH_W - 1; x += 1) {
        const a = lumaAt(hd, (y * HASH_W + x) * 4);
        const b2 = lumaAt(hd, (y * HASH_W + x + 1) * 4);
        hash += a > b2 ? '1' : '0';
      }
    }

    return {
      sharpness: Math.round(sharpness),
      focusFalloff: Math.round(focusFalloff * 100) / 100,
      // Tone, in the order the deck builder wants it: how bright, how contrasty,
      // how colourful, which way the colour points, and how warm.
      lum: Math.round(lum / px),
      lumSpread: Math.round(Math.sqrt(Math.max(0, lumSq / px - (lum / px) ** 2))),
      sat: Math.round((sat / px) * 100) / 100,
      hueX: Math.round((hueX / px) * 1000) / 1000,
      hueY: Math.round((hueY / px) * 1000) / 1000,
      warm: Math.round(warm / px),
      clipHi: Math.round((clipHi / px) * 1000) / 1000,
      clipLo: Math.round((clipLo / px) * 1000) / 1000,
      // 64 characters of '0' and '1'. A string because that is what survives a
      // trip through IndexedDB and JSON without anyone thinking about it, and 64
      // bits does not fit in a Number anyway.
      hash,
    };
  }

  // Hamming distance between two dHashes: 0 is the same frame, and anything
  // under about 10 is the same moment shot twice.
  function hashDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let n = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1;
    return n;
  }

  /* ------------------------------------------------------------ date taken */
  //
  // File.lastModified is the file's own timestamp, which is whenever it
  // reached this device — copied, synced, shared in. The day the photo was
  // taken lives in its EXIF, so read that and keep lastModified as the
  // fallback for anything that hasn't got any.

  // "2026:03:12 09:41:07" — no timezone, so it is read as local time, which
  // is the same reading the camera clock had.
  function exifStamp(text) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
    if (!m) return null;
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isNaN(t.getTime()) ? null : t.getTime();
  }

  // One IFD, looking only for the tags asked for. Returns them by tag number.
  function readIFD(v, base, at, little, wanted) {
    const out = {};
    if (at + 2 > v.byteLength) return out;
    const count = v.getUint16(at, little);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > v.byteLength) break;
      const tag = v.getUint16(entry, little);
      if (!wanted.includes(tag)) continue;
      const type = v.getUint16(entry + 2, little);
      const n = v.getUint32(entry + 4, little);
      if (type === 4) {                       // LONG: an offset to another IFD
        out[tag] = v.getUint32(entry + 8, little);
      } else if (type === 3) {                // SHORT, in the first two bytes
        out[tag] = v.getUint16(entry + 8, little);
      } else if (type === 5) {                // RATIONAL: pairs of LONGs
        // Eight bytes each, so anything but a single one is stored elsewhere and
        // the entry holds its offset. A GPS coordinate is three of them —
        // degrees, minutes, seconds — which is why this returns an array.
        const at2 = n * 8 > 4 ? base + v.getUint32(entry + 8, little) : entry + 8;
        const parts = [];
        for (let k = 0; k < n && at2 + k * 8 + 8 <= v.byteLength; k++) {
          const num = v.getUint32(at2 + k * 8, little);
          const den = v.getUint32(at2 + k * 8 + 4, little);
          parts.push(den ? num / den : 0);
        }
        out[tag] = parts;
      } else if (type === 2) {                // ASCII
        const at2 = n > 4 ? base + v.getUint32(entry + 8, little) : entry + 8;
        let text = '';
        for (let k = 0; k < n - 1 && at2 + k < v.byteLength; k++) {
          text += String.fromCharCode(v.getUint8(at2 + k));
        }
        out[tag] = text;
      }
    }
    return out;
  }

  const TAG_DATETIME = 0x0132;          // IFD0, when the file was last written
  const TAG_EXIF_IFD = 0x8769;
  const TAG_GPS_IFD = 0x8825;
  const TAG_ORIGINAL = 0x9003;          // when the shutter went
  const TAG_DIGITIZED = 0x9004;
  const TAG_FOCAL35 = 0xa405;           // focal length as 35mm film would see it
  const TAG_LAT_REF = 0x0001;           // 'N' or 'S'
  const TAG_LAT = 0x0002;               // degrees, minutes, seconds
  const TAG_LON_REF = 0x0003;
  const TAG_LON = 0x0004;

  // Degrees-minutes-seconds to a single number, negative below the equator or
  // west of Greenwich. Cameras write the hemisphere as a separate letter, so
  // without it every photo taken in the southern hemisphere lands in the
  // northern one.
  function degrees(dms, ref) {
    if (!Array.isArray(dms) || !dms.length) return null;
    const [d = 0, m = 0, s = 0] = dms;
    const v = d + m / 60 + s / 3600;
    if (!Number.isFinite(v)) return null;
    return /^[SW]/i.test(ref || '') ? -v : v;
  }

  // Everything worth having out of a file's EXIF, in one pass: when the shutter
  // went, where, and how wide the lens was. Was takenAt and returned only the
  // date — the rest is here rather than in a second function because the walk to
  // find the block is the whole cost and doing it twice for one file would be
  // silly.
  //
  // Absent fields come back null. A file with no EXIF, or one this cannot read,
  // returns an object of nulls rather than throwing, so every caller can treat
  // "no answer" and "no file" the same way.
  const NO_EXIF = { taken: null, lat: null, lon: null, focal35: null };

  async function readExif(file) {
    try {
      // The EXIF block sits at the very front of a JPEG; a slice is enough and
      // saves reading a 12MP file into memory to find six bytes.
      const head = await file.slice(0, 128 * 1024).arrayBuffer();
      const v = new DataView(head);
      if (v.byteLength < 16 || v.getUint16(0) !== 0xffd8) return NO_EXIF;   // not a JPEG

      let p = 2;
      while (p + 4 <= v.byteLength) {
        if (v.getUint8(p) !== 0xff) break;
        const marker = v.getUint8(p + 1);
        if (marker === 0xda || marker === 0xd9) break;                   // image data starts
        const size = v.getUint16(p + 2, false);
        if (size < 2) break;
        if (marker === 0xe1 && p + 10 <= v.byteLength
            && v.getUint32(p + 4, false) === 0x45786966) {               // "Exif"
          const base = p + 10;                                           // TIFF header
          const order = v.getUint16(base, false);
          if (order !== 0x4949 && order !== 0x4d4d) return NO_EXIF;
          const little = order === 0x4949;
          const ifd0 = readIFD(v, base, base + v.getUint32(base + 4, little),
            little, [TAG_DATETIME, TAG_EXIF_IFD, TAG_GPS_IFD]);

          let taken = null;
          let focal35 = null;
          if (ifd0[TAG_EXIF_IFD]) {
            const sub = readIFD(v, base, base + ifd0[TAG_EXIF_IFD], little,
              [TAG_ORIGINAL, TAG_DIGITIZED, TAG_FOCAL35]);
            taken = exifStamp(sub[TAG_ORIGINAL] || sub[TAG_DIGITIZED] || '');
            focal35 = sub[TAG_FOCAL35] || null;
          }
          // The file's own written date, which is a worse answer than the
          // shutter's but a better one than nothing.
          if (!taken) taken = exifStamp(ifd0[TAG_DATETIME] || '');

          let lat = null;
          let lon = null;
          if (ifd0[TAG_GPS_IFD]) {
            const gps = readIFD(v, base, base + ifd0[TAG_GPS_IFD], little,
              [TAG_LAT_REF, TAG_LAT, TAG_LON_REF, TAG_LON]);
            lat = degrees(gps[TAG_LAT], gps[TAG_LAT_REF]);
            lon = degrees(gps[TAG_LON], gps[TAG_LON_REF]);
            // Both or neither: half a coordinate places a photo in the sea off
            // west Africa, which is where a zero latitude and longitude is.
            if (lat === null || lon === null) { lat = null; lon = null; }
          }

          return { taken, lat, lon, focal35 };
        }
        p += 2 + size;
      }
    } catch { /* unreadable, or not a shape we know */ }
    return NO_EXIF;
  }

  // Decode once, at a sane size, and keep the ImageBitmap. Every later draw is
  // then a straight blit with no decode behind it, and what we persist is the
  // resized copy rather than the original 12MP file.
  /* ------------------------------------------------------------- decoding */
  //
  // What a file is called, and what the picker says its type is, are both
  // guesses. The first bytes are not — and knowing what actually arrived is
  // the difference between "couldn't read it" and a message worth acting on.

  async function sniffKind(blob) {
    let head;
    try { head = new Uint8Array(await blob.slice(0, 16).arrayBuffer()); } catch { return 'unreadable'; }
    if (head.length < 12) return 'empty';
    const text = (i, n) => String.fromCharCode(...head.slice(i, i + n));
    if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
    // EBML: .webm and .mkv both. Either way it is something that moves.
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video';
    if (text(1, 3) === 'PNG') return 'png';
    if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'webp';
    if (text(0, 3) === 'GIF') return 'gif';
    if (text(0, 4) === '<svg' || text(0, 5) === '<?xml') return 'svg';
    if (text(4, 4) === 'ftyp') {
      const brand = text(8, 4);
      if (/^(heic|heix|heim|heis|hevc|hevm|hevs|mif1|msf1)$/.test(brand)) return 'heic';
      if (brand === 'avif' || brand === 'avis') return 'avif';
      return 'video';                                   // an mp4/mov wearing a photo's name
    }
    if (text(0, 2) === 'II' || text(0, 2) === 'MM') return 'tiff';
    return 'unknown';
  }

  // createImageBitmap is the strict decoder: a JPEG that is truncated, or
  // carries something in its headers it doesn't like, is rejected outright
  // where the <img> element would have shown you the picture. So when it says
  // no, ask the lenient one before giving up on the file.
  async function decodeImage(blob) {
    try {
      return await createImageBitmap(blob);
    } catch (strict) {
      const lenient = await decodeVia(blob, strict).catch(() => null);
      if (lenient) return lenient;

      const kind = await sniffKind(blob);
      const platform = await decodeViaCodec(blob, kind);
      if (platform) return platform;

      // Last, and only for a file that genuinely is one: this is a megabyte
      // of decoder and it must never be fetched on a hunch.
      if (kind === 'heic') {
        if (!heifLib) toast('Reading HEIC — fetching the decoder, just this once');
        return decodeHeif(blob);
      }
      throw strict;
    }
  }

  // The last door, and the only one that can open on a HEIC. Chrome doesn't
  // ship an HEVC image decoder — patents — so <img> will never take one. But
  // WebCodecs can reach the decoders the device itself has, and a phone that
  // shoots HEIC has one in hardware. It costs a feature test to ask, which is
  // a great deal cheaper than shipping a decoder of our own.
  const CODEC_MIME = {
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  };

  async function decodeViaCodec(blob, kind) {
    if (!window.ImageDecoder) return null;
    const type = CODEC_MIME[kind];
    if (!type) return null;
    let decoder = null;
    try {
      if (ImageDecoder.isTypeSupported && !(await ImageDecoder.isTypeSupported(type))) return null;
      decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type });
      const { image } = await decoder.decode();
      const bitmap = await createImageBitmap(image);
      image.close();
      return bitmap;
    } catch {
      return null;
    } finally {
      try { if (decoder) decoder.close(); } catch { /* already gone */ }
    }
  }

  function decodeVia(blob, strict) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      const give = (err) => { URL.revokeObjectURL(url); reject(err || strict); };
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) { give(); return; }
        try {
          // Through a canvas rather than straight off the element: whatever
          // the decoder managed to make of it is now just pixels.
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          createImageBitmap(c).then(resolve, give);
        } catch (e) { give(e); }
      };
      img.onerror = () => give();
      img.src = url;
    });
  }

  /* ------------------------------------------------------------------ HEIC */
  //
  // Chrome has no HEIC decoder and is not getting one — the HEVC patents are
  // the whole reason. Phones shoot HEIC regardless, and a photo that opens
  // fine in the gallery has no business being refused here, so the app
  // carries its own: libheif built to WebAssembly, in vendor/.
  //
  // It is fetched the first time a HEIC actually turns up, and the service
  // worker keeps it from then on — it is a plain same-origin GET, so the
  // stale-while-revalidate branch caches it without being told to. A library
  // of nothing but JPEGs never pays a byte for it.

  const HEIF_GLUE = './vendor/libheif.js';
  const HEIF_WASM = './vendor/libheif.wasm';
  let heifLib = null;

  function loadHeif() {
    if (heifLib) return heifLib;
    heifLib = (async () => {
      if (!window.libheif) {
        await new Promise((resolve, reject) => {
          const tag = document.createElement('script');
          tag.src = HEIF_GLUE;
          tag.onload = resolve;
          tag.onerror = () => reject(new Error('offline'));
          document.head.appendChild(tag);
        });
      }
      if (!window.libheif) throw new Error('offline');
      // This build wants the binary handed to it rather than fetching it
      // itself, which suits us: the fetch is the slow part and it belongs
      // where we can say something about it.
      const res = await fetch(HEIF_WASM);
      if (!res.ok) throw new Error('offline');
      return window.libheif({ wasmBinary: new Uint8Array(await res.arrayBuffer()) });
    })().catch((err) => { heifLib = null; throw err; });
    return heifLib;
  }

  async function decodeHeif(blob) {
    const lib = await loadHeif();
    const images = new lib.HeifDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    if (!images || !images.length) throw new Error('nothing inside it');
    const image = images[0];
    const w = image.get_width();
    const h = image.get_height();
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const pixels = g.createImageData(w, h);
      await new Promise((resolve, reject) => {
        image.display(pixels, (out) => (out ? resolve(out) : reject(new Error('it would not decode'))));
      });
      g.putImageData(pixels, 0, 0);
      return await createImageBitmap(c);
    } finally {
      // Those pixels sit on the wasm heap until this is called, and a phone
      // photo is twelve megapixels of them.
      images.forEach((im) => { try { if (im.free) im.free(); } catch { /* older build */ } });
    }
  }

  // Said in terms of what is wrong with the file, not what our decoder did.
  function whyNot(file, kind, err) {
    const name = file.name || 'That photo';
    if (!file.size || kind === 'empty') {
      return `${name} came through empty — whatever it came from may not have finished saving it`;
    }
    if (kind === 'unreadable') {
      return `${name} couldn't be read off the device — if it lives in the cloud, download it first`;
    }
    // HEIC is no longer a dead end, so a failure here is about the decoder,
    // not about the format.
    if (kind === 'heic') {
      return String(err && err.message) === 'offline'
        ? `${name} is HEIC — the decoder for it needs a connection the first time`
        : `${name} is HEIC, and it wouldn't decode`;
    }
    if (kind === 'avif') return `${name} is AVIF — this browser can't decode it`;
    // Video is welcome now, so getting this far means the browser wouldn't
    // play it — a codec it hasn't got, or a file that isn't really one.
    if (kind === 'video') return `${name} is a video this browser can't play`;
    if (kind === 'tiff') return `${name} is a TIFF — this browser can't decode it`;
    if (kind === 'unknown') return `${name} isn't an image this browser recognises`;
    const why = err && (err.name === 'NotReadableError' || err.name === 'NotFoundError')
      ? "the device wouldn't hand over the file"
      : 'the picture data is damaged';
    return `Couldn't read ${name} — it says it's ${kind.toUpperCase()}, but ${why}`;
  }

  /* ----------------------------------------------- when a clip was recorded */
  //
  // A video used to take the file's own date, on the stated grounds that a
  // clip's internal timestamps belong to the encoder rather than the camera.
  // Measured against four real files, that is only half true, and the half that
  // is false was costing the most:
  //
  // - A Samsung clip's `mvhd` matched the capture time in its own filename to
  //   eight seconds. Its file date was thirty-two hours out, because that is
  //   when it was exported.
  // - A DJI clip's `mvhd` was nine days late — the encoder's time, exactly as
  //   the old comment said — while its QuickTime `creationdate` was exact and
  //   carried the timezone.
  //
  // So neither box is trustworthy alone, and the order matters: `creationdate`
  // first because it is the only one naming a wall clock and its offset, then
  // `mvhd`, then the file. A clip with neither still falls back to the file.
  const EPOCH_1904 = -2082844800000;                    // MP4 counts from 1904
  const APPLE_CREATED = 'com.apple.quicktime.creationdate';
  const MAX_MOOV = 8 * 1024 * 1024;

  function eachBox(v, start, end, visit) {
    let at = start;
    while (at + 8 <= end) {
      let size = v.getUint32(at);
      let head = 8;
      const type = String.fromCharCode(v.getUint8(at + 4), v.getUint8(at + 5),
        v.getUint8(at + 6), v.getUint8(at + 7));
      if (size === 1) {
        if (at + 16 > end) break;
        size = Number(v.getBigUint64(at + 8));
        head = 16;
      }
      if (size === 0) size = end - at;
      if (size < head || at + size > end) break;
      visit(type, at + head, at + size);
      at += size;
    }
  }

  const boxText = (v, from, to) => {
    let s = '';
    for (let k = from; k < to; k++) s += String.fromCharCode(v.getUint8(k));
    return s;
  };

  // moov/meta carries four bytes of version and flags in MP4 and none at all in
  // QuickTime. Told apart by looking for a box type where each would put one,
  // because guessing wrong turns the whole metadata tree into noise.
  function metaChildren(v, body, end) {
    if (body + 8 > end) return body;
    for (let i = 4; i < 8; i++) {
      const c = v.getUint8(body + i);
      if (c < 0x20 || c > 0x7e) return body + 4;
    }
    return body;
  }

  // The keys box names the metadata; the ilst box holds the values, and an
  // ilst child's "type" is really its one-based index into those names.
  function appleCreationDate(v, body, end) {
    const start = metaChildren(v, body, end);
    let names = [];
    let ilst = null;
    eachBox(v, start, end, (type, cBody, cEnd) => {
      if (type === 'keys' && cBody + 8 <= cEnd) {
        const count = v.getUint32(cBody + 4);
        let at = cBody + 8;
        for (let i = 0; i < count && at + 8 <= cEnd; i++) {
          const size = v.getUint32(at);
          if (size < 8 || at + size > cEnd) break;
          names.push(boxText(v, at + 8, at + size));
          at += size;
        }
      }
      if (type === 'ilst') ilst = [cBody, cEnd];
    });
    const wanted = names.findIndex((n) => n.endsWith(APPLE_CREATED)) + 1;
    if (!wanted || !ilst) return null;
    let found = null;
    eachBox(v, ilst[0], ilst[1], (type, cBody, cEnd) => {
      const index = ((type.charCodeAt(0) << 24) | (type.charCodeAt(1) << 16)
        | (type.charCodeAt(2) << 8) | type.charCodeAt(3)) >>> 0;
      if (index !== wanted) return;
      eachBox(v, cBody, cEnd, (dType, dBody, dEnd) => {
        if (dType === 'data' && !found) found = boxText(v, dBody + 8, dEnd).trim();
      });
    });
    return found;
  }

  // An ISO stamp read the way exifStamp reads EXIF: the wall clock it names,
  // in the viewer's zone. A photo taken at one o'clock reads as one o'clock
  // wherever it is looked at, and a clip beside it has to agree or the two
  // cannot be grouped into the same event.
  function isoStamp(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?(Z|[+-]\d{2}:?\d{2})?/
      .exec(text || '');
    if (!m) return null;
    const wall = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (Number.isNaN(wall.getTime())) return null;
    let zone = null;
    if (m[7] === 'Z') zone = 0;
    else if (m[7]) {
      const digits = m[7].replace(':', '');
      zone = (m[7][0] === '-' ? -1 : 1)
        * ((+digits.slice(1, 3)) * 60 + (+digits.slice(3, 5))) * 60000;
    }
    return { taken: wall.getTime(), zone };
  }

  // How far this browser's clock sits from UTC at a given instant, in ms.
  const wallShift = (t) => -new Date(t).getTimezoneOffset() * 60000;

  // The instant whose reading on this browser's clock is the wall clock given.
  // Taken twice because the offset depends on the answer across a daylight
  // saving boundary.
  function atWallClock(wallAsUtc) {
    const once = wallAsUtc - wallShift(wallAsUtc);
    return wallAsUtc - wallShift(once);
  }

  // Top-level boxes are walked by their headers alone: moov sits at the front
  // or the very end depending on whether the writer did a faststart pass, and
  // a phone clip is hundreds of megabytes either way.
  async function readClipDate(blob) {
    try {
      let at = 0;
      for (let guard = 0; guard < 64 && at + 8 <= blob.size; guard++) {
        const head = new DataView(await blob.slice(at, at + 16).arrayBuffer());
        if (head.byteLength < 8) break;
        let size = head.getUint32(0);
        let headLen = 8;
        const type = String.fromCharCode(head.getUint8(4), head.getUint8(5),
          head.getUint8(6), head.getUint8(7));
        if (size === 1) {
          if (head.byteLength < 16) break;
          size = Number(head.getBigUint64(8));
          headLen = 16;
        }
        if (size === 0) size = blob.size - at;
        if (size < headLen) break;
        if (type === 'moov') {
          if (size - headLen > MAX_MOOV) return null;
          const v = new DataView(await blob.slice(at + headLen, at + size).arrayBuffer());
          let utc = null;
          let iso = null;
          eachBox(v, 0, v.byteLength, (bType, body, end) => {
            if (bType === 'mvhd') {
              const version = v.getUint8(body);
              const secs = version === 1 ? Number(v.getBigUint64(body + 4)) : v.getUint32(body + 4);
              // Plenty of encoders write a zero here rather than leaving the
              // box out, and 1904 is not a date any of this was shot on.
              if (secs) utc = EPOCH_1904 + secs * 1000;
            }
            if (bType === 'udta') {
              eachBox(v, body, end, (uType, uBody, uEnd) => {
                if (uType === '©day' && !iso) iso = boxText(v, uBody + 4, uEnd).trim();
              });
            }
            if (bType === 'meta') iso = appleCreationDate(v, body, end) || iso;
          });
          const stamped = iso ? isoStamp(iso) : null;
          if (stamped) {
            return {
              taken: stamped.taken,
              zone: stamped.zone,
              // Only meaningful with an offset to go with it.
              utc: stamped.zone === null ? null
                : stamped.taken + wallShift(stamped.taken) - stamped.zone,
            };
          }
          // No wall clock anywhere, so the zone it was shot in is unknown and
          // the tray has to supply it. Until then the clip is read as though it
          // was shot where it is being looked at.
          if (utc) return { taken: utc, zone: null, utc };
          return null;
        }
        at += size;
      }
    } catch {
      // A truncated or unusual container is not worth failing an import over.
    }
    return null;
  }

  /* ------------------------------------- what zone the clips were shot in */
  //
  // A clip with only `mvhd` names a true instant and no offset, so the wall
  // clock it was shot at cannot be recovered from the file alone. The tray can
  // supply it: either another clip carried a `creationdate` with its offset, or
  // the clips can be lined up against the photos around them.
  //
  // Worth doing rather than leaving clips on UTC, because a photo's EXIF is a
  // wall clock with no zone at all — so abroad, an unshifted clip lands hours
  // from the photos taken beside it and the two never group into one event.
  const ZONE_STEP = 15 * 60000;                 // real offsets are quarter hours
  const ZONE_MIN = -12 * 60 * 60000;
  const ZONE_MAX = 14 * 60 * 60000;
  // Past this, a clip is not near any photo and its distance says nothing about
  // which offset is right; counting it in full would let one stray clip decide.
  const ZONE_REACH = 6 * 60 * 60000;
  // And unless the winning offset actually lands clips near photos, the tray
  // has not established anything and the guess is not worth making.
  const ZONE_TRUST = 90 * 60000;

  function guessCaptureZone(clipUtcs, photoWalls) {
    if (!clipUtcs.length || !photoWalls.length) return null;
    let best = null;
    for (let zone = ZONE_MIN; zone <= ZONE_MAX; zone += ZONE_STEP) {
      let cost = 0;
      for (const utc of clipUtcs) {
        let nearest = Infinity;
        for (const wall of photoWalls) {
          const d = Math.abs(wall - (utc + zone));
          if (d < nearest) nearest = d;
        }
        cost += Math.min(nearest, ZONE_REACH);
      }
      if (!best || cost < best.cost) best = { zone, cost };
    }
    return best && best.cost / clipUtcs.length <= ZONE_TRUST ? best.zone : null;
  }

  // Rewrites the clips whose zone is unknown, and returns the ones it changed
  // so they can be written back to the database.
  function alignClipTimes(photos) {
    const loose = photos.filter((p) => p.kind === 'video' && p.takenUtc && p.takenZone === null);
    if (!loose.length) return [];

    // A clip that named its own offset is the best evidence there is, and a
    // trip is almost always one zone throughout.
    const known = photos.find((p) => p.kind === 'video' && p.takenZone !== null
      && p.takenZone !== undefined);
    let zone = known ? known.takenZone : null;
    if (zone === null) {
      zone = guessCaptureZone(
        loose.map((p) => p.takenUtc),
        photos.filter((p) => p.kind !== 'video').map((p) => p.taken + wallShift(p.taken)),
      );
    }
    const changed = [];
    loose.forEach((clip) => {
      // With nothing to go on the clip stays on its own UTC, which reads right
      // at home and is wrong by the trip's offset abroad.
      const taken = zone === null ? clip.takenUtc : atWallClock(clip.takenUtc + zone);
      if (taken !== clip.taken) { clip.taken = taken; changed.push(clip); }
    });
    return changed;
  }

  async function ingest(blob, name) {
    const kind = await sniffKind(blob);
    if (kind === 'video') return ingestVideo(blob, name);
    const decoded = await decodeImage(blob);
    const bitmap = MAX_EDGE ? await shrink(decoded, MAX_EDGE) : decoded;
    const resized = bitmap !== decoded;
    if (resized) decoded.close();

    const thumbBitmap = await shrink(bitmap, THUMB_EDGE);
    const thumbBlob = await encode(thumbBitmap, 'image/jpeg', 0.82);
    if (thumbBitmap !== bitmap) thumbBitmap.close();

    const proxyBitmap = await shrink(bitmap, PROXY_EDGE);
    const proxyBlob = await encode(proxyBitmap, 'image/jpeg', 0.86);

    // Only re-encode when we actually changed the pixels. Untouched, the file
    // is persisted exactly as it arrived — no second pass through a lossy
    // encoder, whatever format it came in.
    //
    // A HEIC is the exception, and it has to be: keeping the original would
    // mean every relaunch and every export ran libheif again, on a file the
    // browser itself still can't read. It goes in as a JPEG once, here, and
    // is an ordinary photo from then on.
    const stored = resized || kind === 'heic' ? await encode(bitmap, 'image/jpeg', 0.92) : blob;

    // Read from the original blob, before the HEIC re-encode above throws its
    // metadata away.
    const exif = await readExif(blob);
    const taken = exif.taken || blob.lastModified || Date.now();

    // Before the bitmap is let go below — this is the only place native pixels
    // exist, and measuring later would mean decoding the file again.
    const stats = measure(bitmap, proxyBitmap);

    // What stays in memory is the proxy, and the full-size decode is let go
    // now that everything that needed it has been made. Twenty 12MP photos
    // held at full size is the better part of a gigabyte of pixels, which is
    // what selecting a folder's worth of them died of. This is exactly the
    // state the app is in after a relaunch — the original is read back on
    // demand, on dwell, on selection and before every export.
    const w = bitmap.width;
    const h = bitmap.height;
    const keep = proxyBitmap !== bitmap ? proxyBitmap : bitmap;
    if (keep !== bitmap) bitmap.close();

    return {
      id: uid(),
      name,
      taken,
      // Where it was taken and how wide the lens was, where the file says so.
      // Kept flat beside taken rather than inside stats, because these are read
      // off the file and stats is what was measured from the pixels.
      lat: exif.lat,
      lon: exif.lon,
      focal35: exif.focal35,
      stats,
      bitmap: keep,
      small: false,
      full: keep === bitmap,
      // The real photo's, not the proxy's: the cover maths works in the
      // photo's own proportions and must not change when the full one
      // swaps back in.
      w,
      h,
      blob: stored,
      proxyBlob,
      thumbUrl: URL.createObjectURL(thumbBlob),
      thumbBlob,
    };
  }

  // A video joins the tray as its first frame. Everything the editor does —
  // the layout, the crop, the thumbnail, the cover on the homepage — is done
  // against that still, and it is only at export that the rest of the frames
  // are read. So placing a video costs exactly what placing a photo costs.
  async function ingestVideo(blob, name) {
    const { bitmap, duration } = await posterFrame(blob);
    const clip = await readClipDate(blob);

    const thumbBitmap = await shrink(bitmap, THUMB_EDGE);
    const thumbBlob = await encode(thumbBitmap, 'image/jpeg', 0.82);
    if (thumbBitmap !== bitmap) thumbBitmap.close();

    const proxyBitmap = await shrink(bitmap, PROXY_EDGE);
    const proxyBlob = await encode(proxyBitmap, 'image/jpeg', 0.86);

    // A phone clip's poster is 1080x1920, which is eight megabytes of pixels
    // held for every clip in the tray. The proxy is all the preview and the
    // thumbnails ever need, and the export reads real frames rather than
    // this, so the full-size one goes.
    // Measured off the poster, which is the only frame anything ever composes
    // for a clip, so the numbers describe exactly what a layout would show.
    const stats = measure(bitmap, proxyBitmap);

    const w = bitmap.width;
    const h = bitmap.height;
    const keep = proxyBitmap !== bitmap ? proxyBitmap : bitmap;
    if (keep !== bitmap) bitmap.close();

    return {
      id: uid(),
      name,
      kind: 'video',
      duration,
      stats,
      // The container first, the file only when it carries nothing — see
      // readClipDate for what was measured. A clip that named no offset is
      // provisional until alignClipTimes has seen the rest of the tray.
      taken: clip ? clip.taken : (blob.lastModified || Date.now()),
      takenUtc: clip ? clip.utc : null,
      takenZone: clip ? clip.zone : null,
      bitmap: keep,
      small: false,
      // The poster is the whole of what is ever drawn for a clip, so there
      // is nothing larger waiting to be read — ensureFull would try to
      // decode the video file as an image, and must never run on one.
      full: true,
      w,
      h,
      blob,
      proxyBlob,
      thumbUrl: URL.createObjectURL(thumbBlob),
      thumbBlob,
    };
  }

  // One frame out of a clip, and how long the whole thing runs. Through a
  // <video> element rather than the decoder we ship: the browser can already
  // play what it can play, and this way it costs no download.
  //
  // `at` of zero is the file's own first frame, which is what an import
  // wants. A trimmed tile asks for the first frame it will actually show,
  // which is somewhere else entirely.
  function frameAt(blob, at = 0) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;

      let settled = false;
      let timer = 0;

      // Reading a frame costs a decoder, and letting the element fall out of
      // scope does not give it back — it sits there holding one, and the
      // pixels behind it, until something collects it. Importing a folder of
      // clips left one of these alive per clip, which on a phone is a hard
      // ceiling rather than a slow leak: there are only so many decoders, and
      // a tab holding a dozen is a tab about to be killed. So it is handed
      // back explicitly, on the way out, whichever way that is.
      const release = () => {
        clearTimeout(timer);
        v.onerror = null;
        v.onloadeddata = null;
        v.onseeked = null;
        try { v.pause(); } catch { /* never started */ }
        v.removeAttribute('src');
        try { v.load(); } catch { /* nothing to unload */ }
        URL.revokeObjectURL(url);
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        release();
        reject(err || new Error('no frame'));
      };
      const grab = async () => {
        if (settled) return;
        try {
          if (!v.videoWidth || !v.videoHeight) { fail(); return; }
          const c = document.createElement('canvas');
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0);
          // The pixels are on the canvas now, so the element has done its
          // job and can go before the bitmap is even built.
          const duration = Number.isFinite(v.duration) ? v.duration : 0;
          settled = true;
          release();
          resolve({ bitmap: await createImageBitmap(c), duration });
        } catch (err) { fail(err); }
      };

      v.onerror = () => fail();
      v.onloadeddata = () => {
        // What puts a frame other than the first into the element is the
        // seek, so at anything past the start the frame is only there once
        // seeking has finished. At the start there is nothing to seek to and
        // loadeddata already means it has arrived.
        if (at > 0.01) {
          v.onseeked = grab;
          try { v.currentTime = at; } catch { grab(); }
        } else {
          grab();
        }
      };
      // A file that turns out to be undecodable can fire neither event.
      timer = setTimeout(() => fail(new Error('timed out reading a frame')), 15000);
      v.src = url;
    });
  }

  const posterFrame = (blob) => frameAt(blob, 0);

  async function addPhotos(files) {
    // An empty type is not a "no": some pickers hand a file back with no type
    // on it at all, and those were being dropped without a word. Only a type
    // that positively says "not a picture" is turned away here — anything
    // else goes to the decoder, which can say what is actually wrong with it.
    const images = [];
    const skipped = [];
    [...files].forEach((f) => {
      const refused = f.type && !f.type.startsWith('image/') && !f.type.startsWith('video/')
        && !/\.hei[cf]$/i.test(f.name);
      (refused ? skipped : images).push(f);
    });
    if (!images.length) {
      if (skipped.length === 1) toast(`${skipped[0].name} isn't a photo or a video`);
      else if (skipped.length) toast(`None of those ${skipped.length} files are photos or video`);
      return;
    }

    const wasEmpty = state.photos.length === 0;

    // A dozen photos off a phone is several seconds of decoding with nothing
    // to show for it until the end, and the old message said "importing 24
    // photos" once and then vanished long before they had arrived. It stays
    // now, and counts.
    const counted = images.length > 1;
    let done = 0;
    const step = () => {
      done += 1;
      if (counted) startProgress(`Importing ${done} of ${images.length}…`, done, images.length);
    };
    if (counted) startProgress(`Importing ${images.length} files…`, 0, images.length);

    // A few at a time: all 20 at once spikes memory with 12MP decodes, one at
    // a time leaves the decoder idle between photos.
    //
    // Only the first few will be looked at when this finishes. The rest go
    // down to their thumbnail as they arrive rather than at the end, because
    // "at the end" means the whole selection is held decoded at once first,
    // and that spike is the thing a large import dies on. They are read back
    // up as they are reached.
    const SHARP_ON_ARRIVAL = 4;
    const queue = [...images];
    const results = new Array(images.length);
    const problems = [];
    // Said last, so it is what stays on screen: a file that would not open is
    // more worth reading than a count of the ones that did.
    const sayProblems = () => {
      if (!problems.length) return;
      toast(problems.length === 1 ? problems[0]
        : `${problems.length} of those files couldn't be read`);
    };
    const worker = async () => {
      while (queue.length) {
        const index = images.length - queue.length;
        const file = queue.shift();
        try {
          const photo = await ingest(file, file.name);
          results[index] = photo;
          if (index >= SHARP_ON_ARRIVAL) {
            arriving.add(photo);
            try { await atThumb(photo); } finally { arriving.delete(photo); }
          }
        } catch (err) {
          const kind = await sniffKind(file);
          // On the console as well as on screen: a toast is gone in three
          // seconds, and this is the sort of thing you want to be able to
          // read back afterwards.
          console.warn('Import failed', {
            name: file.name, type: file.type, size: file.size, kind, error: err,
          });
          // Held rather than said here. What went wrong with one file out of
          // twenty is the thing worth reading, and saying it now means the
          // summary of the whole pile lands on top of it a moment later.
          problems.push(whyNot(file, kind, err));
        }
        step();
      }
    };
    // Two, not three. Each worker holds a whole decoded source while it makes
    // the thumbnail and the proxy from it, and a twelve-megapixel photo is
    // fifty megabytes of that — so the third worker was buying a fifth off
    // the time in exchange for another fifty megabytes at the worst possible
    // moment. Measured over two dozen 12MP photos: 2.6s peaking at 186MB
    // against 3.1s peaking at 135MB.
    // In a finally, because a bar left sitting at 60 per cent for the rest of
    // the session would be worse than never having shown one.
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      endProgress();
    }

    // Added in the order they were chosen, whatever order they finished in.
    if (results.some(Boolean)) snapshot();
    const added = results.filter(Boolean);
    added.forEach((photo) => { state.photos.push(photo); });
    // Only now, with the whole batch in the tray: a clip that named no offset
    // is placed by what the rest of the tray says about the trip, which is not
    // knowable one file at a time. Clips from an earlier batch can move too, so
    // what changed is saved rather than only what arrived.
    const moved = alignClipTimes(state.photos);
    new Set([...added, ...moved]).forEach(savePhoto);
    renderPhotos();
    requestPersistence();
    if (importForChooser) {
      // Added to choose between, so don't go dropping them into other tiles.
      importForChooser = false;
      renderChooser();
      refresh();
      sayProblems();
      return;
    }
    afterImport(wasEmpty);
    sayProblems();
  }

  // Dropping a pile of photos into an empty deck almost always means "one page
  // each" — that's what a multi-select does on Instagram. Merging a few into a
  // collage afterwards is easier than building every page by hand.
  function afterImport(wasEmpty) {
    const deckIsBlank = state.pages.every((pg) => pg.cells.every((c) => !c));
    if (wasEmpty && deckIsBlank && state.photos.length > 1) {
      const take = state.photos.slice(0, MAX_PAGES);
      state.pages = take.map((p) => newPage(LAYOUTS[0], p.id));
      goTo(0);
      toast(`${take.length} pages, one photo each — change any page's layout to make a collage`);
      if (state.photos.length > MAX_PAGES) {
        toast(`${state.photos.length - MAX_PAGES} photos are in the tray but not placed`);
      }
      return;
    }
    // Otherwise just fill whatever's empty on the current page.
    fillEmpties();
    refresh();
  }

  function fillEmpties() {
    const pg = page();
    const used = new Set(pg.cells.filter(Boolean).map((c) => c.photo));
    const spare = state.photos.filter((p) => !used.has(p.id));
    pg.cells.forEach((c, i) => {
      if (!c && spare.length) pg.cells[i] = emptyCell(spare.shift().id);
    });
  }

  /* ------------------------------------------------- reading the full photo */
  //
  // A restored deck is drawn from proxies, which the preview can't be told
  // apart from the real thing. The original is read when it starts to matter:
  // you've settled on a page, you've picked up a tile to zoom into, or you're
  // exporting. Never closed once decoded — undo hands old photo records back
  // and a closed bitmap throws when drawn.

  const loadingFull = new Map();

  function ensureFull(photo) {
    // A video's "full size" is its poster, which is already in hand — asking
    // the image decoder for an mp4 would only throw.
    if (!photo || photo.full || photo.kind === 'video') return Promise.resolve(false);
    if (loadingFull.has(photo.id)) return loadingFull.get(photo.id);

    const job = decodeImage(photo.blob).then((bitmap) => {
      loadingFull.delete(photo.id);
      // Gone from the library while it was decoding.
      if (!state.photos.includes(photo)) { bitmap.close(); return false; }
      photo.bitmap = bitmap;
      photo.full = true;
      photo.w = bitmap.width;
      photo.h = bitmap.height;
      return true;
    }).catch(() => { loadingFull.delete(photo.id); return false; });

    loadingFull.set(photo.id, job);
    return job;
  }

  const photosOn = (pg) => (pg ? pg.cells.filter(Boolean).map((c) => photoById(c.photo)).filter(Boolean) : []);

  // Everything on this page, then redraw once if anything actually changed.
  async function loadFullFor(pg) {
    const wanted = photosOn(pg).filter((p) => !p.full);
    if (!wanted.length) return;
    const done = await Promise.all(wanted.map(ensureFull));
    if (done.some(Boolean) && state.pages[state.current] === pg) {
      restyle();
      render();
      renderFilmstrip();
    }
  }

  // Flicking through pages shouldn't drag 12MP decodes along behind it, so
  // the page has to be the one you stopped on.
  let dwellTimer = 0;
  function armDwell() {
    clearTimeout(dwellTimer);
    const pg = state.pages[state.current];
    if (!pg || photosOn(pg).every((p) => p.full)) return;
    dwellTimer = setTimeout(() => loadFullFor(pg), DWELL_MS);
  }

  /* ------------------------------------------------ how much stays decoded */
  //
  // The expensive thing here is not the file, it is the decode. A 1440px
  // proxy is five megabytes of pixels and a twelve-megapixel original is
  // fifty, and one was being held for every item in the tray whether or not
  // anything was drawing it. Forty clips came to a hundred and seventy-eight
  // megabytes of pixels for slides nobody was looking at, and it grew with
  // no ceiling — which is what selecting a large pile of files died of. A
  // phone kills the tab for that and never says why.
  //
  // So size is only kept for the slide on screen and the ones a swipe away.
  // Everything else falls back to its thumbnail, a fortieth of the pixels,
  // and is read back up on arrival. The filmstrip is drawn at forty pixels
  // across and the library is a grid of thumbnails, so neither can tell.

  const RESIDENT = 1;                  // pages either side of the current one

  function residentIds() {
    const ids = new Set();
    for (let d = -RESIDENT; d <= RESIDENT; d += 1) {
      const pg = state.pages[state.current + d];
      if (pg) pg.cells.forEach((c) => { if (c) ids.add(c.photo); });
    }
    return ids;
  }

  const resizing = new Set();
  // Photos that have been read but not yet added to the tray. An import in
  // flight can already need one of these shrunk, and it is not orphaned just
  // because nothing points at it yet.
  const arriving = new Set();

  // Swap a photo's decoded bitmap for one at the wanted size and let the old
  // one go. Safe to close: undo hands back the same photo objects rather
  // than old bitmaps, and every draw reads .bitmap at the moment it draws.
  // w and h are left alone throughout — they are the real photo's, and the
  // cover maths would move if they followed whatever is decoded right now.
  //
  // It loops rather than doing one pass, because a shrink can be overtaken
  // by a request to grow again while it is still decoding — scroll the
  // chooser past a photo and back and that is exactly what happens. Dropping
  // the newer answer is how the preview ends up stuck on a thumbnail.
  async function reDecode(photo, small) {
    if (!photo) return false;
    photo.want = small;
    if (resizing.has(photo.id)) return false;   // the pass in flight will see it
    resizing.add(photo.id);
    let changed = false;
    try {
      while (photo.want !== !!photo.small) {
        const target = photo.want;
        const blob = target ? photo.thumbBlob : (photo.proxyBlob || photo.blob);
        if (!blob) break;
        const bitmap = await decodeImage(blob);
        // Gone from the tray, or wanted the other way again, while this was
        // decoding.
        if (!state.photos.includes(photo) && !arriving.has(photo)) { bitmap.close(); break; }
        if (photo.want !== target) { bitmap.close(); continue; }
        const old = photo.bitmap;
        photo.bitmap = bitmap;
        photo.small = target;
        // Down to a thumbnail is no longer the original, so a dwell can read
        // it back. A clip has no original to read — its poster is all there
        // ever is — and must never be handed to the image decoder.
        if (photo.kind !== 'video') photo.full = false;
        if (old && old !== bitmap) { try { old.close(); } catch { /* already gone */ } }
        changed = true;
      }
    } catch {
      // Keep whatever is already decoded; it draws, it is just the wrong size.
    } finally {
      resizing.delete(photo.id);
    }
    return changed;
  }

  const atSize = (photo) => reDecode(photo, false);
  const atThumb = (photo) => reDecode(photo, true);

  function manageResidency() {
    const near = residentIds();
    const jobs = [];
    state.photos.forEach((photo) => {
      if (near.has(photo.id)) { if (photo.small) jobs.push(atSize(photo)); }
      else if (!photo.small && photo.thumbBlob) jobs.push(atThumb(photo));
    });
    if (!jobs.length) return;
    Promise.all(jobs).then((done) => {
      if (done.some(Boolean)) { render(); renderFilmstrip(); }
    });
  }

  const videoCells = (pg) => (pg ? pg.cells
    .map((cell, i) => ({ cell, i, photo: photoFor(cell) }))
    .filter((x) => x.photo && x.photo.kind === 'video') : []);

  /* -------------------------------------------------------- video posters */
  //
  // Almost everywhere a clip appears it isn't playing: the filmstrip, the
  // slides either side of the one you're on, the project cover, the moment
  // before playback starts. In all of those it is a still, and the still
  // that belongs there is the first frame the tile will actually show —
  // which is the first frame of the trim, not of the file. Cut the opening
  // two seconds off and the thumbnail has to move with it.
  //
  // Kept on the cell for the same reason the trim is: one clip in two tiles,
  // cut two ways, is two different stills.

  // Resolves once every clip on the page has the still it should have, and
  // says whether anything actually changed.
  async function postersFor(pg) {
    // A tile that used to hold a clip and now holds a photo, or nothing, is
    // carrying a still it will never draw again.
    let dropped = false;
    (pg ? pg.cells : []).forEach((cell) => {
      const was = photoFor(cell);
      if (cell && cell.poster && (!was || was.kind !== 'video')) {
        closePoster(cell);
        dropped = true;
      }
    });

    const jobs = videoCells(pg).map(async ({ cell, photo }) => {
      const { from } = clipRange(cell);
      // Frame zero is already decoded and sitting on the photo, so an
      // untrimmed tile has nothing to work out.
      if (from <= 0.01) {
        if (!cell.poster) return false;
        closePoster(cell);
        return true;
      }
      if (cell.posterAt === from || cell.posterBusy === from) return false;
      cell.posterBusy = from;
      try {
        const { bitmap } = await frameAt(photo.blob, from);
        // The cut can move again while a frame is being read; if it has,
        // this one is already the wrong answer.
        if (clipRange(cell).from !== from) { bitmap.close(); return false; }
        closePoster(cell);
        cell.poster = bitmap;
        cell.posterAt = from;
        return true;
      } catch {
        // No frame at the cut is not worth saying anything about — the
        // file's own first frame stands in, and playback is unaffected.
        return false;
      } finally {
        if (cell.posterBusy === from) cell.posterBusy = 0;
      }
    });
    return (await Promise.all(jobs)).some(Boolean) || dropped;
  }

  // The same thing where nobody is waiting: repaint if it turned out to
  // matter, and say nothing if it didn't.
  function ensurePosters(pg, then) {
    if (!pg) return;
    postersFor(pg).then((changed) => { if (changed && then) then(); });
  }

  function closePoster(cell) {
    if (!cell || !cell.poster) return;
    try { cell.poster.close(); } catch { /* already gone */ }
    cell.poster = null;
    cell.posterAt = undefined;
  }

  const dropPosters = (pages) => (pages || []).forEach(
    (pg) => pg.cells.forEach((c) => closePoster(c)),
  );

  /* ------------------------------------------------------- video preview */
  //
  // The slide you are looking at plays. One hidden <video> per video cell —
  // per cell, not per clip, because the same clip can be in two tiles cut
  // differently and each has to be at its own moment. Each element hands its
  // current frame to the cell, and the page redraws through the very same
  // drawPage the export uses, so what moves on screen is composed exactly
  // the way the file will be.

  // Keyed by the slot on the page. `cell` is the object currently in that
  // slot, kept up to date every painted frame — it is there so a teardown
  // can clear the frame off it, not as the source of truth.
  const players = new Map();          // cell index -> { el, url, cell, photoId, ready }
  let painting = 0;

  function stopPlayers() {
    players.forEach(({ el, url, cell }) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      URL.revokeObjectURL(url);
      if (cell) cell.frame = null;
    });
    players.clear();
    if (painting) cancelAnimationFrame(painting);
    painting = 0;
  }

  // Nothing plays on the homepage, behind the library, in another tab, or
  // while a page is sliding past — all of them are either invisible or
  // somewhere a redraw would fight with an animation.
  const canPlay = () => !!current && !document.hidden && !libraryOpen
    && !sliding && !document.body.classList.contains('on-home');

  function syncPlayback() {
    const wanted = canPlay() ? videoCells(page()) : [];
    const keep = new Set(wanted.map((x) => x.i));

    players.forEach((p, i) => {
      if (keep.has(i)) return;
      p.el.pause();
      p.el.removeAttribute('src');
      p.el.load();
      p.el.remove();
      URL.revokeObjectURL(p.url);
      if (p.cell) p.cell.frame = null;
      players.delete(i);
    });

    wanted.forEach(({ cell, i, photo }) => {
      const had = players.get(i);
      // Matched on the clip and the slot it is in, not on the cell object.
      // Plenty of things build a fresh cell for the same clip in the same
      // place — the chooser does it for every photo you scroll past — and
      // restarting the video for that would be wrong twice over: it would
      // jump back to the beginning, and it would do it constantly.
      if (had && had.photoId === photo.id) { had.cell = cell; return; }
      if (had) { had.el.pause(); had.el.remove(); URL.revokeObjectURL(had.url); }
      const url = URL.createObjectURL(photo.blob);
      const el = document.createElement('video');
      // Muted is not a preference, it is the price of playing without being
      // asked; playsinline stops iOS taking the video full screen.
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.src = url;
      $('players').appendChild(el);
      const { from } = clipRange(cell);
      el.currentTime = from;
      el.play().catch(() => { /* a frame is still better than nothing */ });

      // Nothing is drawn off this element until it has presented a frame.
      // readyState is not that promise — it says data has arrived, not that
      // there is a picture to copy, and drawing a decoder that is still
      // warming up or seeking gives you a black rectangle. Which is what a
      // clip opened with: black, until it got going. So it stays on its
      // poster until there is genuinely something better.
      const p = { el, url, cell, photoId: photo.id, ready: false };
      const gotFrame = () => { p.ready = true; };
      if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(gotFrame);
      else el.addEventListener('canplay', gotFrame, { once: true });
      players.set(i, p);
    });

    if (players.size && !painting) painting = requestAnimationFrame(paintPlaying);
    if (!players.size && painting) { cancelAnimationFrame(painting); painting = 0; }
  }

  function paintPlaying() {
    painting = 0;
    if (!players.size) return;
    if (!canPlay()) { stopPlayers(); return; }

    const pg = page();
    let live = false;
    players.forEach((p, i) => {
      // Read the cell out of the page every frame rather than holding the
      // one it was made with. Anything that rebuilds a tile in place — the
      // chooser, a layout change, an undo — leaves the old object behind,
      // and frames written to that go nowhere: the element plays on, the
      // picture on screen freezes, and it only ever came back because
      // switching away and back rebuilt the players from scratch.
      const cell = pg.cells[i];
      if (!cell) return;
      p.cell = cell;

      const { el } = p;
      // Loop within the trim rather than the whole file, so what you watch
      // is what the export will produce.
      const { from, to } = clipRange(cell);
      if (el.currentTime >= to - 0.02 || el.currentTime < from - 0.02) {
        try { el.currentTime = from; } catch { /* not seekable yet */ }
        // Reaching the end of the file stops the element, and seeking a
        // stopped one does not start it again. Without this a clip trimmed
        // to its own end plays once and sits there.
        if (el.paused) el.play().catch(() => { /* the poster stands in */ });
      }
      // Mid-seek there is no frame to copy, so the poster holds the tile
      // rather than the picture dropping out on every loop round.
      if (p.ready && !el.seeking) { cell.frame = el; live = true; }
    });

    if (live) {
      const { w: W, h: H } = previewSize();
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      drawPage(ctx, pg, W, H, { placeholders: true, selected: state.selected });
    }
    players.forEach(({ cell }) => { cell.frame = null; });

    painting = requestAnimationFrame(paintPlaying);
  }

  document.addEventListener('visibilitychange', syncPlayback);

  function usageCount(photoId) {
    return state.pages.reduce(
      (n, pg) => n + pg.cells.filter((c) => c && c.photo === photoId).length,
      0,
    );
  }

  function assign(cellIndex, photoId, keepSelection = true) {
    snapshot();
    const pg = page();
    pg.cells[cellIndex] = emptyCell(photoId);
    if (keepSelection) state.selected = cellIndex;
    refresh();
  }

  // Tapping a photo places it: into the selected tile if you aimed at one,
  // otherwise the first gap. When you didn't aim, leave nothing selected so
  // tapping photo after photo walks down the empty tiles instead of
  // overwriting the same one.
  function placePhoto(photoId) {
    const pg = page();
    const aimed = state.selected >= 0;
    const target = aimed ? state.selected : pg.cells.findIndex((c) => !c);
    if (target === -1) {
      buzz('limit');
      toast('This page is full — pick a tile to replace, or add a page');
      return;
    }
    assign(target, photoId, aimed);
  }

  function removePhoto(photoId) {
    snapshot();
    const uses = usageCount(photoId);
    state.pages.forEach((pg) => {
      pg.cells.forEach((c, i) => { if (c && c.photo === photoId) { pg.cells[i] = null; pg.rev = (pg.rev || 0) + 1; } });
    });
    // Deliberately not closing the bitmap or revoking the thumbnail URL: undo
    // hands this exact object back, and a closed bitmap throws when drawn.
    // The snapshot holding it is what keeps it alive; once that falls off the
    // history the whole record becomes collectable.
    state.photos = state.photos.filter((p) => p.id !== photoId);
    dropPhoto(photoId);
    if (uses) toast(`Removed from ${uses} tile${uses > 1 ? 's' : ''}`);
    refresh();
  }

  /* ------------------------------------------------------------- filmstrip */
  //
  // Reordering uses pointer events rather than HTML5 drag and drop, which
  // gives nothing to animate and doesn't fire on touch at all. The page being
  // moved follows the finger while the others slide aside to open the gap it
  // would drop into, so the result is visible before letting go.

  const LIFT_MS = 200;
  let reorder = null;

  // Once a page has been picked up, the browser must not also scroll the
  // strip with the same finger. touch-action can't be changed mid-gesture,
  // but cancelling the first touchmove after the hold stops the scroll
  // before it starts — the finger has been still, so nothing has begun.
  const blockScroll = (e) => { if (reorder) e.preventDefault(); };

  function armReorder(el, index) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || reorder) return;
      const touch = e.pointerType === 'touch';
      const from = { x: e.clientX, y: e.clientY };
      let held = null;
      let picked = false;

      const pickUp = () => {
        picked = true;
        beginReorder(el, index, from.x);
      };
      // A press on a phone is ambiguous — tap, scroll the strip, or reorder.
      // Waiting a beat separates them; a mouse needs no delay because moving
      // sideways already says which it is.
      if (touch) held = setTimeout(pickUp, 170);

      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        const dx = ev.clientX - from.x;
        const dy = ev.clientY - from.y;
        if (!picked) {
          if (touch) {
            if (Math.hypot(dx, dy) > 8) { clearTimeout(held); stop(); }
            return;
          }
          if (Math.abs(dx) < 5) return;
          pickUp();
        }
        ev.preventDefault();
        dragReorder(ev.clientX);
      };

      const up = (ev) => {
        clearTimeout(held);
        if (picked) {
          // Includes pointercancel: finish where it is rather than leaving a
          // page stuck in the lifted state.
          if (reorder) endReorder();
        } else if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 8) {
          if (Math.abs(index - state.current) === 1) slidePage(index - state.current);
          else if (index !== state.current) goTo(index);
        }
        stop();
      };

      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  // How close to an end of the strip starts it moving, and how fast at the
  // very edge. Proportional in between, so easing towards the edge eases the
  // scroll up rather than switching it on.
  const EDGE_ZONE = 56;
  const EDGE_SPEED = 15;

  function beginReorder(el, index, startX) {
    const strip = $('filmstrip');
    // A long press would otherwise start selecting the page number, and the
    // selection takes the pointer stream with it.
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    document.addEventListener('touchmove', blockScroll, { passive: false });
    buzz('pick');

    const items = [...strip.querySelectorAll('.film')];
    // Every thumbnail is the same size — one deck, one shape — so a single
    // step describes how far each one has to move.
    const step = items.length > 1
      ? items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().left
      : el.getBoundingClientRect().width + 8;

    reorder = {
      el, index, target: index, items, step, strip,
      startX, startScroll: strip.scrollLeft, x: startX, raf: 0,
    };
    strip.classList.add('is-reordering');
    // The library and the undo pair fold away, handing their width to the
    // strip for as long as the drag lasts. Folding the left one would drag
    // every page sideways with it — and a page that moves while your finger
    // is still means the slot you are aiming at changes under you — so the
    // strip takes on exactly that width as padding and the contents stay put.
    const bar = document.querySelector('.pagesbar');
    bar.style.setProperty('--fold-left', `${$('btn-home').offsetWidth + $('btn-photos').offsetWidth}px`);
    bar.style.setProperty('--fold-right', `${bar.querySelector('.pagesbar-end').offsetWidth}px`);
    bar.classList.add('is-reordering');
    el.classList.add('is-lifted');
    el.style.transition = 'none';

    // How far the strip can scroll, fixed now, before the page is moved.
    //
    // A transform that pushes a child to the right extends its container's
    // scrollable area to the right — so dragging a page towards the end grows
    // scrollWidth, the edge scroll chases the new end, that carries the page
    // further right, and it grows again. Left to itself the strip scrolls for
    // as long as you hold there. Measured once, the runaway has nowhere to go.
    reorder.startScroll = strip.scrollLeft;
    reorder.maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);

    reorder.raf = requestAnimationFrame(edgeScroll);
  }

  function dragReorder(x) {
    if (!reorder) return;
    reorder.x = x;
    layoutReorder();
  }

  // Runs every frame for as long as the page is held, so resting against an
  // end keeps the strip moving instead of stopping the moment the finger does.
  function edgeScroll() {
    if (!reorder) return;
    const { strip, x } = reorder;
    const box = strip.getBoundingClientRect();
    let v = 0;
    if (x > box.right - EDGE_ZONE) v = EDGE_SPEED * Math.min(1, (x - box.right + EDGE_ZONE) / EDGE_ZONE);
    else if (x < box.left + EDGE_ZONE) v = -EDGE_SPEED * Math.min(1, (box.left + EDGE_ZONE - x) / EDGE_ZONE);

    if (v) strip.scrollLeft = clamp(strip.scrollLeft + v, 0, reorder.maxScroll);

    // Every frame, scrolled or not. The strip also moves and widens while the
    // ends fold away, and a page only re-placed on a finger move would slide
    // out from under a finger that is holding still.
    layoutReorder();
    reorder.raf = requestAnimationFrame(edgeScroll);
  }

  function layoutReorder() {
    const { el, index, items, step, strip, startX, startScroll, x } = reorder;
    // How far the page has come from its own slot: what the finger has moved,
    // plus whatever the strip has scrolled underneath it. The padding above
    // keeps the slot itself still, so nothing else needs accounting for.
    const dx = (x - startX) + (strip.scrollLeft - startScroll);
    el.style.transform = `translateX(${dx}px) scale(1.08)`;

    const target = clamp(index + Math.round(dx / step), 0, items.length - 1);
    if (target === reorder.target) return;
    reorder.target = target;

    // Open the gap: everything between the old slot and the new one steps
    // aside by exactly one place.
    items.forEach((it, i) => {
      if (it === el) return;
      let shift = 0;
      if (index < target && i > index && i <= target) shift = -step;
      else if (index > target && i >= target && i < index) shift = step;
      it.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  }

  function endReorder() {
    const { el, index, target, step, items, strip, raf } = reorder;
    cancelAnimationFrame(raf);
    reorder = null;
    document.removeEventListener('touchmove', blockScroll);

    // Settle into the gap rather than snapping back to the old slot.
    el.style.transition = `transform ${LIFT_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
    el.style.transform = `translateX(${(target - index) * step}px) scale(1)`;
    el.classList.remove('is-lifted');

    setTimeout(() => {
      strip.classList.remove('is-reordering');
      // The ends come back only once the page has landed. Unfolding them
      // during the settle would widen the strip under the page mid-glide, so
      // it would arrive somewhere other than where it was aimed.
      document.querySelector('.pagesbar').classList.remove('is-reordering');
      items.forEach((it) => { it.style.transform = ''; it.style.transition = ''; });
      if (target === index) return;

      buzz('drop');
      snapshot();
      // Follow the page you were looking at, which may not be the one moved.
      const viewing = state.pages[state.current];
      const [moved] = state.pages.splice(index, 1);
      state.pages.splice(target, 0, moved);
      state.current = Math.max(0, state.pages.indexOf(viewing));
      refresh();
    }, LIFT_MS);
  }

  function renderFilmstrip() {
    const strip = $('filmstrip');
    strip.innerHTML = '';

    // The add-a-page slot is CSS, not a canvas, so it takes the deck's shape
    // from here rather than measuring one.
    document.documentElement.style.setProperty(
      '--page-ratio', String(state.ratio.w / state.ratio.h));

    state.pages.forEach((pg, i) => {
      // A button, so it can be tabbed to and pressed. Not `draggable`: that's
      // left over from the old HTML5 reorder, and a native drag starting
      // mid-gesture cancels the pointer stream the new one runs on.
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'film' + (i === state.current ? ' is-current' : '');
      el.title = `Page ${i + 1}`;
      el.setAttribute('aria-label', `Page ${i + 1} of ${state.pages.length}`);
      if (i === state.current) el.setAttribute('aria-current', 'true');

      // Thumbnails are cached on the page and only redrawn when that page or
      // the deck style actually changed. Redrawing all 20 on every refresh
      // cost 78ms per page change.
      const out = outputSize();
      // The canvas is 46 CSS px tall, so on a 3x screen it wants 138 real
      // pixels across the long edge and a flat 96 was being stretched. Capped
      // at 3: past that the strip costs more to redraw than the sharpness is
      // worth on a thumbnail this size.
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const tw = Math.round(64 * dpr);
      const th = Math.round(tw * out.h / out.w);
      const key = `${styleRev}:${pg.rev || 0}:${tw}x${th}`;
      if (!pg.thumb || pg.thumbKey !== key) {
        pg.thumb = pg.thumb || document.createElement('canvas');
        pg.thumb.width = tw;
        pg.thumb.height = th;
        // Placeholders on, or an empty page is indistinguishable from one
        // holding a white photo.
        drawPage(pg.thumb.getContext('2d'), pg, tw, th, { placeholders: true });
        pg.thumbKey = key;
      }
      const thumb = pg.thumb;

      const num = document.createElement('span');
      num.className = 'film-num';
      num.textContent = i + 1;

      el.append(thumb, num);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      armReorder(el, i);

      strip.appendChild(el);
    });

    const add = document.createElement('button');
    add.className = 'film-add';
    add.type = 'button';
    add.textContent = '+';
    add.setAttribute('aria-label', 'Add a page');
    add.title = state.pages.length >= MAX_PAGES
      ? `A carousel tops out at ${MAX_PAGES} pages`
      : 'Add a page';
    add.disabled = state.pages.length >= MAX_PAGES;
    add.addEventListener('click', () => addPage(LAYOUTS[0]) && refresh());
    strip.appendChild(add);

    markCurrent(state.current);
  }

  // Which page the strip shows as current, kept apart from a full re-render so
  // it can answer a swipe on the frame the swipe is decided, rather than when
  // the animation lands.
  function markCurrent(i) {
    const strip = $('filmstrip');
    const films = [...strip.querySelectorAll('.film')];
    films.forEach((el, n) => {
      el.classList.toggle('is-current', n === i);
      if (n === i) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });

    // Past a handful of pages the strip runs off the edge, so the page you're
    // actually looking at has to be brought back into it. Not mid-reorder:
    // the strip is being scrolled by the drag itself.
    const cur = films[i];
    if (reorder || !cur) return;
    const box = strip.getBoundingClientRect();
    const it = cur.getBoundingClientRect();
    const pad = 12;
    let by = 0;
    if (it.right > box.right - pad) by = it.right - box.right + pad;
    else if (it.left < box.left + pad) by = it.left - box.left - pad;
    if (by) strip.scrollBy({ left: by, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  /* --------------------------------------------------------- photo library */
  //
  // Every photo imported, on its own screen rather than in a strip along the
  // bottom: the way in is pinned to the left of the pages, and the count on it
  // is the whole status. Tapping a photo drops it into a tile and leaves the
  // library open, so filling a four-up page is four taps and one close.

  // Which day a photo belongs to, and what to call it. Local midnight, so a
  // photo taken at 11pm is on that evening's day and not the next one.
  const dayKey = (t) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  function dayLabel(key) {
    const today = dayKey(Date.now());
    const day = 86400000;
    if (key === today) return 'Today';
    if (key === today - day) return 'Yesterday';
    const d = new Date(key);
    const opts = { weekday: 'short', day: 'numeric', month: 'long' };
    // The year only earns its place once it isn't this one.
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  // 0:07, 1:23 — the length, in the shape a video player writes it.
  function clockLabel(seconds) {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  /* ------------------------------------------------------ events, by time */
  //
  // Grouping the tray into the separate things that happened, so a deck can be
  // built one event at a time rather than out of one undifferentiated pile.
  // Nothing here picks photos or emits slides; this is the measuring end, and
  // the view over it exists so a split can be judged against the pictures.
  //
  // How the library is grouped, and the knobs for it. Deliberately not saved:
  // this is an instrument for looking, and starting from the same place every
  // time is what makes two looks comparable.
  const grouping = { mode: 'days', rule: 'gap', spread: 3, k: 17, burst: 10 };

  const percentileOf = (sorted, p) =>
    (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);

  // Runs taken within `withinSec` of each other, treated as one shot.
  //
  // This matters more than it looks. On a real 180-photo tray, 85 of the 179
  // gaps were ten seconds or less — so a phone firing six frames in four
  // seconds casts six votes on what a typical gap is, and drags every average
  // down to the burst interval rather than the rhythm between events. Collapse
  // first and the gaps that remain are the ones between things that happened.
  function toShots(sorted, withinSec) {
    const shots = [];
    sorted.forEach((photo, i) => {
      const prev = sorted[i - 1];
      if (i && (photo.taken - prev.taken) / 1000 <= withinSec) shots[shots.length - 1].push(photo);
      else shots.push([photo]);
    });
    return shots;
  }

  // Where one event ends and the next begins, from the timestamps alone.
  //
  // Two rules, because which one is right depends on the tray and seeing both
  // is the point:
  //
  // "gap" cuts wherever a gap beats one threshold for the whole tray, set as a
  // multiple of the 90th percentile of the gaps in it. Relative to the import
  // on purpose — the same principle that killed badging photos above a fixed
  // sharpness. A threshold in minutes that suits a walking tour is wrong for a
  // dinner. Three times p90 recovered twelve events from the 180-photo tray,
  // nine of them with three or more photos.
  //
  // "adaptive" is PhotoTOC's rule (Platt et al., Microsoft Research, 2002): a
  // gap is a boundary when it exceeds K times the geometric mean of the gaps
  // around it, so a dense evening and a sparse morning get their own
  // thresholds. On its own it over-splits badly here — with bursts left in, the
  // local geometric mean sits around thirty seconds, which puts the threshold
  // near eight minutes and turns ordinary pauses inside one event into
  // boundaries: twelve events became twenty-seven. It is worth having anyway,
  // because it is the only rule that finds seams inside a long block, and the
  // burst control next to it is what makes it usable.
  // Every photo has a `taken`: ingest falls back to the file's own timestamp and
  // then to the clock, so there is no undated case to handle here. Worth knowing
  // rather than guarding — a photo whose EXIF carried no date lands at import
  // time and becomes its own event at the end of the trip, which is a real
  // wrinkle for whatever builds the deck and not one this view invents.
  function clusterEvents(photos, opts) {
    const dated = [...photos].sort((a, b) => a.taken - b.taken);
    if (!dated.length) return { events: [], threshold: 0 };

    const shots = toShots(dated, opts.burst);
    const gaps = shots.slice(1).map((shot, i) => {
      const before = shots[i];
      return (shot[0].taken - before[before.length - 1].taken) / 1000;
    });

    let threshold = 0;
    let opensEvent;
    if (opts.rule === 'adaptive') {
      const logs = gaps.map((g) => Math.log(Math.max(g, 1)));
      const half = 10;
      opensEvent = gaps.map((_, i) => {
        const from = Math.max(0, i - half);
        const to = Math.min(logs.length, i + half + 1);
        let sum = 0;
        for (let j = from; j < to; j++) sum += logs[j];
        return logs[i] >= Math.log(opts.k) + sum / (to - from);
      });
    } else {
      threshold = opts.spread * percentileOf([...gaps].sort((a, b) => a - b), 0.9);
      opensEvent = gaps.map((g) => g > threshold);
    }

    // Each event carries the gap that opened it, because that number is what
    // makes a split arguable: an event that began after eleven minutes and one
    // that began after three hours are not the same claim.
    const events = [{ photos: [...shots[0]], after: null }];
    opensEvent.forEach((opens, i) => {
      const shot = shots[i + 1];
      if (opens) events.push({ photos: [...shot], after: gaps[i] });
      else events[events.length - 1].photos.push(...shot);
    });
    return { events, threshold };
  }

  // "23 min", "3 h 10", "45 s" — a duration at the coarseness it deserves.
  function spanLabel(seconds) {
    const whole = Math.round(seconds);
    if (whole < 90) return `${whole} s`;
    if (whole < 5400) return `${Math.round(whole / 60)} min`;
    return `${Math.floor(whole / 3600)} h ${String(Math.round((whole % 3600) / 60)).padStart(2, '0')}`;
  }

  const timeLabel = (t) =>
    new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  function renderPhotos() {
    const grid = $('pm-grid');
    grid.innerHTML = '';

    const n = state.photos.length;
    $('photos-count').textContent = n;
    $('btn-photos').classList.toggle('is-empty', n === 0);
    $('btn-photos').title = n
      ? `${n} photo${n > 1 ? 's' : ''} — tap to open the library`
      : 'Add your photos';
    $('pm-count').textContent = n || '';
    $('pm-empty').hidden = n > 0;

    if (grouping.mode === 'events') { renderByEvent(grid); return; }
    $('pm-tally').textContent = '';

    // Newest first, the way a photo roll reads. Sorted for the view only —
    // state.photos stays in the order things were imported, which is what the
    // pages were built from and what the replace reel steps through.
    const byDay = new Map();
    [...state.photos]
      .sort((a, b) => (b.taken || 0) - (a.taken || 0))
      .forEach((photo) => {
        const key = dayKey(photo.taken || Date.now());
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(photo);
      });

    byDay.forEach((photos, key) => {
      const head = document.createElement('h3');
      head.className = 'pm-day';
      head.textContent = dayLabel(key);
      grid.appendChild(head);

      const row = document.createElement('div');
      row.className = 'pm-row';
      grid.appendChild(row);
      photos.forEach((photo) => addPhotoTile(row, photo));
    });
  }

  // The same grid, cut into events instead of days.
  //
  // Events run newest first to match the day view, but the photos inside one
  // run in the order they were taken: an event reads as it happened, and a
  // block of the deck will be built from it in that order.
  function renderByEvent(grid) {
    const { events, threshold } = clusterEvents(state.photos, grouping);
    const solid = events.filter((e) => e.photos.length >= 3).length;
    const singles = events.filter((e) => e.photos.length === 1).length;

    // The tally is the whole point of the settings: it says what moving a
    // slider did without having to count headings down the page.
    $('pm-tally').textContent = events.length
      ? `${events.length} events · ${solid} with 3+ · ${singles} single`
        + (grouping.rule === 'gap' && threshold ? ` · cut at ${spanLabel(threshold)}` : '')
      : '';

    [...events].reverse().forEach((event, i) => {
      const photos = event.photos;
      const from = photos[0].taken;
      const to = photos[photos.length - 1].taken;
      const head = document.createElement('h3');
      head.className = 'pm-day pm-event';
      const when = document.createElement('span');
      when.className = 'pm-event-when';
      when.textContent = `${dayLabel(dayKey(from))}, ${timeLabel(from)}`
        + (to - from > 60000 ? `–${timeLabel(to)}` : '');
      const facts = document.createElement('span');
      facts.className = 'pm-event-facts';
      // The gap that opened an event is what makes the split arguable, so it
      // sits next to the count rather than being left to be inferred.
      facts.textContent = `${photos.length} photo${photos.length > 1 ? 's' : ''}`
        + (to - from > 60000 ? ` · ${spanLabel((to - from) / 1000)}` : '')
        + (event.after !== null ? ` · after ${spanLabel(event.after)}` : '');
      head.append(when, facts);
      // Numbered from the start of the trip, so an event keeps its name while
      // you scroll and while you talk about it.
      head.dataset.event = String(events.length - i);
      grid.appendChild(head);

      const row = document.createElement('div');
      row.className = 'pm-row';
      grid.appendChild(row);
      photos.forEach((photo) => addPhotoTile(row, photo));
    });
  }

  // The two sliders mean different things depending on the rule, so they say
  // what they currently are rather than carrying a fixed label.
  function syncGroupingControls() {
    const events = grouping.mode === 'events';
    $('pm-tune').hidden = !events;
    $('pm-by-days').classList.toggle('is-on', !events);
    $('pm-by-days').setAttribute('aria-pressed', String(!events));
    $('pm-by-events').classList.toggle('is-on', events);
    $('pm-by-events').setAttribute('aria-pressed', String(events));

    const adaptive = grouping.rule === 'adaptive';
    $('pm-rule-gap').classList.toggle('is-on', !adaptive);
    $('pm-rule-gap').setAttribute('aria-pressed', String(!adaptive));
    $('pm-rule-adaptive').classList.toggle('is-on', adaptive);
    $('pm-rule-adaptive').setAttribute('aria-pressed', String(adaptive));

    const split = $('pm-split');
    if (adaptive) {
      $('pm-split-label').textContent = 'Local';
      split.min = 2; split.max = 40; split.step = 1; split.value = grouping.k;
      $('pm-split-val').textContent = `${grouping.k}× nearby`;
    } else {
      $('pm-split-label').textContent = 'Split at';
      split.min = 0.5; split.max = 8; split.step = 0.25; split.value = grouping.spread;
      $('pm-split-val').textContent = `${grouping.spread}× p90`;
    }
    $('pm-burst-val').textContent = grouping.burst ? `${grouping.burst} s` : 'kept apart';
  }

  function setGrouping(patch) {
    Object.assign(grouping, patch);
    syncGroupingControls();
    renderPhotos();
  }

  function addPhotoTile(grid, photo) {
    {
      const uses = usageCount(photo.id);
      // Built as nodes, not markup: a filename is user text and can hold
      // quotes or angle brackets, which would break out of an attribute.
      const label = photo.name || 'Photo';

      const el = document.createElement('div');
      el.className = 'pm-item' + (uses ? ' is-used' : '');

      const pick = document.createElement('button');
      pick.className = 'pm-pick';
      pick.type = 'button';
      pick.setAttribute('aria-label',
        uses ? `Place ${label} again (on ${uses} tile${uses > 1 ? 's' : ''})` : `Place ${label}`);
      const img = document.createElement('img');
      img.src = photo.thumbUrl;
      img.alt = '';
      img.loading = 'lazy';
      pick.appendChild(img);
      el.appendChild(pick);

      if (uses) {
        const badge = document.createElement('span');
        badge.className = 'pm-badge';
        badge.textContent = uses;
        el.appendChild(badge);
      }

      // A poster frame looks exactly like a photo, so a video has to say so.
      if (photo.kind === 'video') {
        el.classList.add('is-video');
        const mark = document.createElement('span');
        mark.className = 'pm-clip';
        mark.textContent = clockLabel(photo.duration || 0);
        el.appendChild(mark);
      }

      const kill = document.createElement('button');
      kill.className = 'pm-x';
      kill.type = 'button';
      kill.setAttribute('aria-label', `Remove ${label}`);
      kill.textContent = '×';
      el.appendChild(kill);

      pick.addEventListener('click', () => placePhoto(photo.id));
      kill.addEventListener('click', () => removePhoto(photo.id));
      grid.appendChild(el);
    }
  }

  let libraryOpen = false;

  // Everything the app knows about the tray, as tab-separated text.
  //
  // The clustering the deck builder needs — which photos belong to one event —
  // turns on how far apart in time and place a real library's photos actually
  // are, and no amount of reasoning here answers that. This is how a real set's
  // numbers get out without the photos going anywhere: no pixels, no thumbnails,
  // nothing but what was already measured.
  //
  // Tab-separated on purpose. It pastes into a spreadsheet, reads by eye, and
  // parses in one line, which JSON manages only the last of.
  function exportData() {
    // clipUtc and clipZone are a clip's own two timestamps, and they are here
    // because the difference between them and `taken` is the whole of how a
    // video gets placed — which is not readable off the screen.
    const head = ['name', 'kind', 'takenISO', 'taken', 'clipUtc', 'clipZone',
      'lat', 'lon', 'focal35',
      'w', 'h', 'sharpness', 'focusFalloff', 'lum', 'lumSpread', 'sat',
      'hueX', 'hueY', 'warm', 'clipHi', 'clipLo', 'hash'];
    const rows = state.photos.map((p) => {
      const s = p.stats || {};
      // A missing number is an empty cell rather than a zero: zero is a real
      // sharpness and a real latitude, and the difference matters to anything
      // deciding what to do about it.
      const cell = (v) => (v === null || v === undefined ? '' : v);
      return [
        p.name || '', p.kind || 'photo',
        p.taken ? new Date(p.taken).toISOString() : '', cell(p.taken),
        p.takenUtc ? new Date(p.takenUtc).toISOString() : '',
        p.takenZone === null || p.takenZone === undefined ? '' : p.takenZone / 3600000,
        cell(p.lat), cell(p.lon), cell(p.focal35),
        cell(p.w), cell(p.h),
        cell(s.sharpness), cell(s.focusFalloff), cell(s.lum), cell(s.lumSpread),
        cell(s.sat), cell(s.hueX), cell(s.hueY), cell(s.warm),
        cell(s.clipHi), cell(s.clipLo), cell(s.hash),
      ].join('\t');
    });
    return [head.join('\t'), ...rows].join('\n');
  }

  function showData() {
    const text = exportData();
    $('pm-data-text').value = text;
    $('pm-data-out').hidden = false;
    const withPlace = state.photos.filter((p) => p.lat !== null && p.lat !== undefined).length;
    const withStats = state.photos.filter((p) => p.stats && p.stats.hash).length;
    // Said up front, because these two counts decide whether the numbers below
    // are worth anything: photos imported before the measuring pass carry none,
    // and a library with no coordinates has to be grouped on time alone.
    $('pm-data-note').textContent = `${state.photos.length} photos · `
      + `${withPlace} with a location · ${withStats} measured`;
    $('pm-data-text').focus();
    $('pm-data-text').select();
  }

  function openLibrary() {
    libraryOpen = true;
    stopPlayers();
    $('photos-modal').hidden = false;
    document.body.classList.add('is-library');
    $('btn-photos').setAttribute('aria-expanded', 'true');
    syncGroupingControls();
    renderPhotos();
    // Straight to the way out, so Tab and a screen reader both start where the
    // eye does rather than at the far end of the grid.
    $('pm-close').focus();
  }

  function closeLibrary() {
    if (!libraryOpen) return;
    libraryOpen = false;
    setTimeout(syncPlayback, 0);
    $('photos-modal').hidden = true;
    document.body.classList.remove('is-library');
    $('btn-photos').setAttribute('aria-expanded', 'false');
    $('btn-photos').focus();
  }

  /* ------------------------------------------------------------ tile panel */

  function syncPanel() {
    const i = state.selected;
    const pg = page();
    const cell = pg.cells[i];
    const photo = photoFor(cell);

    // The layout highlight belongs to the page, not the selection, so it has
    // to be set before we bail out on there being no selected tile.
    [...$('layouts').children].forEach((c) => {
      const on = c.dataset.id === pg.layout.id;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });

    // Only a tile with a clip in it can be trimmed, so the action is only
    // there when it means something.
    $('tile-trim-btn').hidden = !(photo && photo.kind === 'video');
    if (tileSub === 'trim' && !(photo && photo.kind === 'video')) showTileSub(null);

    if (!photo) {
      // The reel is how an empty tile gets filled, so don't shut it just
      // because the tile is still empty.
      if (drawer === 'tile' && tileSub !== 'replace') closeDrawer();
      return;
    }
    if (drawer !== 'tile') openDrawer('tile');

    const p = place(cell, photo, cellRects()[i], canvas.width / BASE_WIDTH);
    const degrees = Math.round(((cell.rot * 180) / Math.PI) % 360);

    $('cell-angle').textContent = `${degrees > 180 ? degrees - 360 : degrees}°`;
    $('zoom').min = Math.ceil(p.minZoom * 100);
    $('zoom').max = Math.max(800, Math.ceil(p.minZoom * 100));
    $('zoom').value = Math.round(p.zoom * 100);
    $('zoom-val').textContent = `${Math.round(p.zoom * 100)}%`;
    $('angle').value = degrees > 180 ? degrees - 360 : degrees;
    paintSlider($('zoom'));
    paintSlider($('angle'));
  }

  function select(i) {
    state.selected = i;
    render();
    syncPanel();
    // About to be zoomed or panned, which is where a proxy would start to
    // show. Fetch the real thing now rather than waiting out the dwell.
    if (i !== -1) {
      const photo = photoFor(page().cells[i]);
      if (photo && !photo.full) ensureFull(photo).then((got) => { if (got) render(); });
    }
  }

  // An empty tile opens the same reel as Replace, rather than the device
  // picker, so the photos already imported are the first thing offered.
  function fillEmptyTile(i) {
    state.selected = i;
    openDrawer('tile');
    showTileSub('replace');
    render();
  }

  function resetCell(i) {
    const cell = page().cells[i];
    if (!cell) return;
    snapshot();
    cell.zoom = 1; cell.rot = 0; cell.ox = 0; cell.oy = 0;
    cell.flipX = false; cell.flipY = false;
    render();
    syncPanel();
  }

  /* -------------------------------------------------------- canvas gestures */

  // Canvas pixels from a pointer event. The listeners sit on the wrapper, not
  // the canvas, so this has to measure the canvas itself — and mid-slide the
  // canvas is translated, so it measures where it is now, not where it rests.
  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  /* ------------------------------------------------------ carousel motion */

  const PEEK_GAP = 0;   // pages sit edge to edge while swiping
  const SLIDE_MS = 280;
  const motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery ? motionQuery.matches : false;
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener('change', (e) => { reducedMotion = e.matches; });
  }

  let sliding = false;

  const slideStep = () => canvas.clientWidth + PEEK_GAP;

  // Draw the pages either side so they can be seen coming in. Only done when
  // a slide starts, and only for pages that exist.
  function preparePeek() {
    const { w, h } = previewSize();
    const step = slideStep();
    const cw = `${canvas.clientWidth}px`;
    const ch = `${canvas.clientHeight}px`;

    [[$('canvas-prev'), state.current - 1, -1], [$('canvas-next'), state.current + 1, 1]]
      .forEach(([el, index, side]) => {
        const pg = state.pages[index];
        if (!pg) { el.hidden = true; return; }
        el.hidden = false;
        if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
        drawPage(el.getContext('2d'), pg, w, h, { placeholders: true });
        el.style.width = cw;
        el.style.height = ch;
        el.style.translate = `calc(-50% + ${side * step}px) -50%`;
      });
    $('canvas-wrap').classList.add('is-sliding');
    // The neighbours have only just been given their size and offset, and their
    // crosses are measured off them, so this is the moment those can be placed
    // — before the peeks become visible rather than a frame after.
    placePageX();
  }

  function setTrack(px, animate) {
    const track = $('track');
    track.style.transition = animate && !reducedMotion
      ? `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
      : 'none';
    track.style.transform = `translateX(${px}px)`;
  }

  function endSlide() {
    setTrack(0, false);
    $('canvas-wrap').classList.remove('is-sliding');
    sliding = false;
    // Nothing plays mid-slide — the peek layers sit over the canvas and a
    // redraw would fight the animation — so whatever you landed on starts
    // once the movement has stopped.
    syncPlayback();
  }

  // A slide in flight, so a second swipe can land on top of the first rather
  // than being turned away for the length of the animation.
  let slideTimer = 0;
  let slideTarget = -1;

  // Cut the current slide short and commit it now. What the animation was
  // going to do in another 200ms, done in this frame, so the next gesture
  // starts from a settled deck instead of queueing behind one.
  function finishSlide() {
    if (!sliding) return;
    clearTimeout(slideTimer);
    slideTimer = 0;
    const target = slideTarget;
    slideTarget = -1;
    endSlide();
    goTo(target);
  }

  // delta: +1 for the next page, -1 for the previous.
  function slidePage(delta) {
    // Mid-slide, land the one in progress first: swiping four pages along
    // should be four swipes, not swipe-wait-swipe-wait.
    if (sliding) finishSlide();

    const target = state.current + delta;
    if (target < 0 || target >= state.pages.length) { setTrack(0, true); return; }

    preparePeek();
    sliding = true;
    slideTarget = target;
    buzz('turn');
    // Straight away, not when the slide lands: state.current can't move until
    // the animation finishes (the render reads it), but the strip is showing
    // where you're going, and waiting 280ms for it to admit that reads as lag.
    markCurrent(target);
    setTrack(-delta * slideStep(), true);
    slideTimer = setTimeout(() => {
      // Reset the track and paint the new page in the same frame, so the
      // hand-off from the peek canvas to the real one isn't visible.
      slideTimer = 0;
      slideTarget = -1;
      endSlide();
      goTo(target);
    }, reducedMotion ? 0 : SLIDE_MS);
  }

  const mean = (pts, k) => pts.reduce((a, p) => a + p[k], 0) / pts.length;
  const spread = (pts) => Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const tilt = (pts) => Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

  const SNAP = 5 * Math.PI / 180;
  const nearSquare = (a) => Math.abs(a - Math.round(a / (Math.PI / 2)) * (Math.PI / 2)) < SNAP;
  function snapAngle(a) {
    const quarter = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    return nearSquare(a) ? quarter : a;
  }

  function rebase() {
    const i = state.selected;
    const cell = page().cells[i];
    const photo = photoFor(cell);
    if (!photo || !pointers.size) { gesture = null; return; }

    const s = canvas.width / BASE_WIDTH;
    const rect = cellRects()[i];
    const p = place(cell, photo, rect, s);
    const pts = [...pointers.values()];

    gesture = {
      i, s,
      ids: [...pointers.keys()],
      ax: mean(pts, 'x'),
      ay: mean(pts, 'y'),
      spread: pts.length > 1 ? spread(pts) : 0,
      tilt: pts.length > 1 ? tilt(pts) : 0,
      cx: rect.x + rect.w / 2 + p.ox,
      cy: rect.y + rect.h / 2 + p.oy,
      zoom: p.zoom,
      rot: cell.rot,
      snapped: nearSquare(cell.rot),
    };
  }

  stageInput.addEventListener('pointerdown', (e) => {
    // The delete-page button lives inside this wrapper. Now that the gesture
    // listeners are here rather than on the canvas, a press on it would be
    // read as the start of a swipe and the pointer capture would take the
    // click away from it.
    // The cross is decided here rather than by waiting for a click on it, and
    // before the check below, because waiting does not work. Two ways a press
    // reaches the button and produces no click: landing on hit area grown past
    // the button's own box, and — apparently — landing on it at all inside the
    // track's compositing layer on iOS, which is what made the cross look
    // decorative on a phone while every measurement on a desktop passed.
    //
    // Capturing the pointer means the tap is settled on release, so a drag that
    // starts here can still be abandoned by sliding off.
    if (overPageX(e)) {
      crossPress = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      try { stageInput.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      return;
    }

    if (e.target.closest('button')) return;

    const p = toCanvas(e);

    // Nothing selected: the canvas belongs to the carousel, so this is a swipe.
    // Selection is the mode switch — it's visible, and one tap either way.
    if (state.selected === -1) {
      // A finger down during a slide takes it over: land the page that was
      // moving and start this gesture from there.
      if (sliding) finishSlide();
      stageInput.setPointerCapture(e.pointerId);
      swipe = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: 0,
        dx: 0,
        cell: cellAt(p.x, p.y),
        locked: false,
        samples: [{ t: performance.now(), x: e.clientX }],
      };
      return;
    }

    const i = cellAt(p.x, p.y);

    // Waiting on a second tile to swap with.
    if (swapFrom !== null && pointers.size === 0) {
      if (i === -1 || i === swapFrom) { cancelSwap(); return; }
      snapshot();
      const cells = page().cells;
      [cells[swapFrom], cells[i]] = [cells[i], cells[swapFrom]];
      const moved = swapFrom;
      cancelSwap();
      select(i);
      refresh();
      toast(`Swapped tiles ${moved + 1} and ${i + 1}`);
      return;
    }

    if (pointers.size === 0) {
      if (i !== state.selected) { select(-1); return; }
    } else if (i !== state.selected) {
      return;
    }

    if (pointers.size === 0) { endRun(); snapshot(); }
    stageInput.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, p);
    rebase();
  });

  stageInput.addEventListener('pointermove', (e) => {
    if (crossPress && e.pointerId === crossPress.id) {
      crossPress.moved = Math.max(crossPress.moved,
        Math.hypot(e.clientX - crossPress.x, e.clientY - crossPress.y));
      return;
    }
    if (swipe && e.pointerId === swipe.id) {
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe.moved = Math.max(swipe.moved, Math.abs(dx));

      // Commit to a horizontal swipe once it's clearly horizontal, then stay
      // committed — otherwise a curved drag keeps dropping in and out of it.
      if (!swipe.locked && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        swipe.locked = true;
        preparePeek();
      }
      if (!swipe.locked) return;

      swipe.samples.push({ t: performance.now(), x: e.clientX });
      if (swipe.samples.length > 6) swipe.samples.shift();

      // Follows the finger exactly, except past the ends where it drags back.
      const atEnd = (dx > 0 && state.current === 0)
        || (dx < 0 && state.current === state.pages.length - 1);
      swipe.dx = atEnd ? dx * 0.3 : dx;
      setTrack(swipe.dx, false);
      return;
    }

    if (!pointers.has(e.pointerId)) {
      const p = toCanvas(e);
      const over = photoFor(page().cells[cellAt(p.x, p.y)]);
      canvas.style.cursor = state.selected === -1 ? 'grab' : (over ? 'grab' : 'pointer');
      return;
    }

    pointers.set(e.pointerId, toCanvas(e));
    if (!gesture) return;

    const pts = gesture.ids.filter((id) => pointers.has(id)).map((id) => pointers.get(id));
    if (pts.length !== gesture.ids.length) return;

    let scale = 1;
    let turn = 0;
    if (pts.length > 1) {
      scale = spread(pts) / (gesture.spread || 1);
      turn = tilt(pts) - gesture.tilt;
    }

    const cell = page().cells[gesture.i];
    const wanted = gesture.rot + turn;
    cell.rot = snapAngle(wanted);
    // Only on entering the zone. Comparing the snapped value against the raw
    // one can't tell "already square" from "not snapping", so a photo that
    // started at 0 buzzed on its very first frame.
    const snapped = nearSquare(wanted);
    if (snapped !== gesture.snapped) {
      gesture.snapped = snapped;
      if (snapped) buzz('snap');
    }
    cell.zoom = clamp(gesture.zoom * scale, 1, 8);

    // Carry the photo's centre through the same similarity transform the
    // fingers described, so the image tracks the pinch.
    const dx = gesture.cx - gesture.ax;
    const dy = gesture.cy - gesture.ay;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const nx = mean(pts, 'x') + (dx * c - dy * sn) * scale;
    const ny = mean(pts, 'y') + (dx * sn + dy * c) * scale;

    const rect = cellRects()[gesture.i];
    cell.ox = (nx - (rect.x + rect.w / 2)) / gesture.s;
    cell.oy = (ny - (rect.y + rect.h / 2)) / gesture.s;

    canvas.style.cursor = 'grabbing';
    render();
    syncPanel();
  }, { passive: false });

  const liftPointer = (e) => {
    if (crossPress && e.pointerId === crossPress.id) {
      const wasTap = crossPress.moved < 8 && e.type === 'pointerup';
      crossPress = null;
      try { stageInput.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      if (wasTap) requestDeletePage();
      return;
    }
    if (swipe && e.pointerId === swipe.id) {
      const dx = e.clientX - swipe.x;

      // A quick flick should turn the page even if it didn't travel far, so
      // decide on velocity as well as distance. Only the tail of the gesture
      // counts: dragging slowly and then flicking is one of the commonest
      // ways to turn a page, and averaging over the whole drag hides it.
      const cut = performance.now() - 120;
      const recent = swipe.samples.filter((s) => s.t >= cut);
      const win = recent.length >= 2 ? recent : swipe.samples;
      const first = win[0];
      const last = win[win.length - 1];
      const span = last.t - first.t;
      const velocity = span > 0 ? (last.x - first.x) / span : 0;   // px per ms
      const far = Math.abs(dx) > canvas.clientWidth * 0.22;
      const flicked = Math.abs(velocity) > 0.45 && Math.abs(dx) > 12;

      if (swipe.locked && (far || flicked)) {
        slidePage(dx < 0 ? 1 : -1);
      } else if (swipe.locked) {
        setTrack(0, true);
        setTimeout(() => { if (!sliding) $('canvas-wrap').classList.remove('is-sliding'); }, SLIDE_MS);
      } else if (swipe.moved < 8 && swipe.cell !== -1) {
        // A tap, not a swipe: pick up the tile, or ask for a photo for it.
        const cell = page().cells[swipe.cell];
        if (photoFor(cell)) select(swipe.cell);
        else if (state.photos.length) fillEmptyTile(swipe.cell);
        else { pendingCell = swipe.cell; fileInput.click(); }
      }
      swipe = null;
      return;
    }

    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture) settle(gesture.i);
    if (pointers.size) {
      rebase();
    } else {
      gesture = null;
      canvas.style.cursor = 'grab';
      refresh();
    }
  };
  stageInput.addEventListener('pointerup', liftPointer);
  stageInput.addEventListener('pointercancel', liftPointer);

  canvas.addEventListener('wheel', (e) => {
    if (state.selected === -1) return;
    const p = toCanvas(e);
    const i = cellAt(p.x, p.y);
    if (i !== state.selected) return;
    const cell = page().cells[i];
    const photo = photoFor(cell);
    if (!photo) return;
    e.preventDefault();

    const s = canvas.width / BASE_WIDTH;
    const rect = cellRects()[i];
    snapshot('wheel');
    const before = place(cell, photo, rect, s);
    const scale = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    cell.zoom = clamp(before.zoom * scale, 1, 8);

    const cx = rect.x + rect.w / 2 + before.ox;
    const cy = rect.y + rect.h / 2 + before.oy;
    cell.ox = (p.x + (cx - p.x) * scale - (rect.x + rect.w / 2)) / s;
    cell.oy = (p.y + (cy - p.y) * scale - (rect.y + rect.h / 2)) / s;

    settle(i);
    render();
    syncPanel();
  }, { passive: false });

  // iOS Safari zooms the page on a two-finger pinch unless told otherwise.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    canvas.addEventListener(type, (e) => e.preventDefault());
  });

  canvas.addEventListener('dblclick', () => {
    if (state.selected !== -1) resetCell(state.selected);
  });

  /* ------------------------------------------------------------ drag & drop */
  //
  // Files from outside only. Dragging a photo from the library onto a tile
  // went with the tray: the library is a modal over the canvas, so there is
  // nothing to drop onto. Tapping a photo places it instead.

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    hideDropzone();
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    // Dropped onto the homepage: there is nowhere to put them yet, so make
    // somewhere. The files have to be taken off the event first — it doesn't
    // survive the await that opening a project needs.
    const files = [...e.dataTransfer.files];
    if (!current) await openProject(createProject());
    if (!current) return;
    addPhotos(files);
  });

  // dragenter/dragleave fire for every element the pointer crosses, so count
  // depth rather than trusting a single leave to mean "gone".
  let dragDepth = 0;
  const draggingFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const hideDropzone = () => { dragDepth = 0; dropzone.hidden = true; };

  window.addEventListener('dragenter', (e) => {
    if (!draggingFiles(e)) return;
    dragDepth += 1;
    dropzone.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!draggingFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.hidden = true;
  });
  window.addEventListener('dragend', hideDropzone);

  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    const target = pendingCell;
    pendingCell = null;
    fileInput.value = '';
    if (!files.length) return;

    if (target !== null && files.length === 1) {
      // Filling one specific tile.
      const img = new Image();
      const url = URL.createObjectURL(files[0]);
      img.onload = () => {
        const photo = { id: uid(), img, url, name: files[0].name };
        state.photos.push(photo);
        assign(target, photo.id);
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast(`Couldn't read ${files[0].name}`); };
      img.src = url;
      return;
    }
    addPhotos(files);
  });

  /* ---------------------------------------------------------------- export */

  function renderToBlob(pg, type) {
    const { w, h } = outputSize();
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    drawPage(off.getContext('2d'), pg, w, h, {});
    return new Promise((resolve) => off.toBlob(resolve, type, 0.92));
  }

  const FRAMED = (() => { try { return window.self !== window.top; } catch { return true; } })();

  /* ------------------------------------------------------------ video out */
  //
  // A page with a video on it can't be a JPEG. It is composed the same way
  // every other page is — the same drawPage, the same layout, gap, padding
  // and background — only once per frame, with each video tile showing the
  // frame at that moment instead of its poster. The frames go out through
  // WebCodecs to H.264 and into an mp4.
  //
  // Mediabunny does the reading, the muxing and the wrapping of WebCodecs.
  // It is fetched the first time a video is actually exported and cached by
  // the service worker after, exactly like the HEIC decoder: a deck of
  // photos never pays for it.

  const MEDIABUNNY = './vendor/mediabunny.mjs';
  let mbLib = null;

  function loadMediabunny() {
    if (!mbLib) mbLib = import(MEDIABUNNY).catch((err) => { mbLib = null; throw err; });
    return mbLib;
  }

  const EXPORT_FPS = 30;
  const MAX_CLIP = 60;                     // a carousel slide tops out here

  const hasVideo = (pg) => videoCells(pg).length > 0;

  // Roughly a tenth of a bit per pixel per frame, which is where H.264 stops
  // looking like H.264 on flat colour and gradients — this app makes a lot of
  // both, in the background behind the tiles.
  const bitrateFor = (w, h) => Math.round(Math.min(24e6, Math.max(2e6, w * h * EXPORT_FPS * 0.1)));

  async function renderVideoPage(pg, onProgress) {
    const MB = await loadMediabunny();
    const { w: W, h: H } = outputSize();

    // Each distinct file is opened once, however many tiles show it — but
    // every tile gets its own reader, because two tiles can hold the same
    // clip cut two different ways.
    const sources = new Map();
    const clips = [];
    for (const { cell, photo } of videoCells(pg)) {
      if (!sources.has(photo.id)) {
        const input = new MB.Input({ source: new MB.BlobSource(photo.blob), formats: MB.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) continue;
        sources.set(photo.id, { input, track, duration: await input.computeDuration() });
      }
      const src = sources.get(photo.id);
      if (!src) continue;
      clips.push({ cell, src, ...clipRange(cell) });
    }
    if (!clips.length) return null;

    // Two clips on one page run together and the page lasts as long as the
    // longer of them; the shorter one holds its last frame.
    const seconds = Math.min(MAX_CLIP, Math.max(...clips.map((c) => c.span)));
    const frames = Math.max(1, Math.round(seconds * EXPORT_FPS));

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');

    const target = new MB.BufferTarget();
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const videoOut = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: bitrateFor(W, H) });
    output.addVideoTrack(videoOut, { frameRate: EXPORT_FPS });
    const audio = await attachAudio(MB, output, clips);

    await output.start();
    if (audio) await audio.copy();

    // Each clip is asked for its own moments, in order, so a packet is
    // decoded once however many frames come out of it. A clip shorter than
    // the page holds on its last frame rather than disappearing.
    clips.forEach((clip) => {
      const times = Array.from({ length: frames },
        (_, i) => Math.min(clip.to - 0.001, clip.from + i / EXPORT_FPS));
      clip.reader = new MB.VideoSampleSink(clip.src.track).samplesAtTimestamps(times);
    });

    try {
      return await composeFrames(pg, g, W, H, frames, clips, videoOut, output, target, onProgress);
    } finally {
      // Whatever happened, nothing is left holding a decoder open or a frame
      // undrained — abandoning an iterator mid-flight leaves both.
      for (const clip of clips) { try { await clip.reader?.return(); } catch { /* done already */ } }
      for (const src of sources.values()) { try { await src.input.dispose(); } catch { /* already gone */ } }
      pg.cells.forEach((cell) => { if (cell) cell.frame = null; });
    }
  }

  async function composeFrames(pg, g, W, H, frames, clips, videoOut, output, target, onProgress) {
    for (let i = 0; i < frames; i += 1) {
      const open = [];
      for (const clip of clips) {
        const { value: sample } = await clip.reader.next();
        if (!sample) continue;
        // A frame is something drawImage already takes, so the page composes
        // itself with no idea that anything is moving.
        clip.cell.frame = sample.toCanvasImageSource();
        open.push([clip.cell, sample]);
      }
      drawPage(g, pg, W, H);
      open.forEach(([cell, sample]) => { cell.frame = null; sample.close(); });

      await videoOut.add(i / EXPORT_FPS, 1 / EXPORT_FPS);
      if (onProgress) onProgress((i + 1) / frames);
    }

    await output.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  }

  // The sound comes from the longest clip on the page — with more than one
  // running at once there is no honest way to choose, so the one that lasts
  // is the one you hear.
  //
  // Untrimmed, its packets are already exactly what an mp4 wants, so they
  // are copied straight across: nothing lost, nothing spent. Trimmed, they
  // are not — the cut lands mid-packet and the timestamps start in the wrong
  // place — so that range is decoded and encoded again, which is the same
  // shape as what the video does two functions up.
  async function attachAudio(MB, output, clips) {
    let pick = null;
    for (const clip of clips) if (!pick || clip.span > pick.span) pick = clip;
    if (!pick) return null;

    try {
      const track = await pick.src.input.getPrimaryAudioTrack();
      if (!track) return null;
      const whole = pick.from <= 0.01 && pick.to >= (pick.whole || 0) - 0.01;

      if (whole) {
        const codec = await track.getCodec();
        if (!codec || !output.format.getSupportedCodecs().includes(codec)) return null;
        const source = new MB.EncodedAudioPacketSource(codec);
        output.addAudioTrack(source);
        return { async copy() {
          const sink = new MB.EncodedPacketSink(track);
          const meta = { decoderConfig: await track.getDecoderConfig() };
          let first = true;
          for await (const packet of sink.packets()) {
            await source.add(packet, first ? meta : undefined);
            first = false;
          }
        } };
      }

      // Trimmed: decode the range and encode it again, rebasing each sample
      // so the sound starts when the picture does rather than where it sat
      // in the original.
      const config = { codec: 'aac', bitrate: 128e3 };
      if (MB.canEncodeAudio && !(await MB.canEncodeAudio('aac'))) return null;
      const source = new MB.AudioSampleSource(config);
      output.addAudioTrack(source);
      return { async copy() {
        const sink = new MB.AudioSampleSink(track);
        for await (const sample of sink.samples(pick.from, pick.to)) {
          sample.setTimestamp(Math.max(0, sample.timestamp - pick.from));
          await source.add(sample);
          sample.close();
        }
      } };
    } catch {
      // No sound is a far better answer than no file.
      return null;
    }
  }

  // Nothing plays while an export is running. The preview and the export
  // both hand a frame to the same cell and both want the decoder, and the
  // preview is the one nobody is watching once the overlay is up.
  async function exportDeck() {
    stopPlayers();
    try { await runExport(); } finally { syncPlayback(); }
  }

  async function runExport() {
    const filled = state.pages.filter((pg) => pg.cells.some(Boolean));
    if (!filled.length) { toast('Add a photo first'); return; }

    const ext = state.format === 'image/png' ? 'png' : 'jpg';
    const out = outputSize();
    const skipped = state.pages.length - filled.length;
    const moving = filled.filter(hasVideo).length;
    toast(skipped
      ? `Rendering ${filled.length} page${filled.length > 1 ? 's' : ''} — skipping ${skipped} empty`
      : `Rendering ${filled.length} page${filled.length > 1 ? 's' : ''}…`);

    // A page of video is the one thing here that takes long enough to need
    // saying so: every frame has to be decoded, composed and encoded again.
    if (moving) showOpening('Rendering', 'Reading the video…');
    let failed = 0;

    const files = [];
    for (let i = 0; i < filled.length; i++) {
      const page = filled[i];
      if (hasVideo(page)) {
        if (moving) {
          $('op-name').textContent = filled.length > 1
            ? `Slide ${i + 1} of ${filled.length}` : 'Rendering';
        }
        let clip = null;
        try {
          clip = await renderVideoPage(page, (done) => {
            $('op-fill').style.width = `${Math.round(done * 100)}%`;
            $('op-step').textContent = `${Math.round(done * 100)}% of this slide`;
          });
        } catch (err) {
          console.warn('Video export failed', { page: i + 1, error: err });
        }
        if (clip) {
          files.push(new File([clip], `${String(i + 1).padStart(2, '0')}.mp4`, { type: 'video/mp4' }));
          continue;
        }
        // Rather than drop the slide, send the frame it opens on. A carousel
        // missing its third slide is worse than one whose third slide is a
        // still, and it is obvious which happened.
        failed += 1;
      }
      // Never export a proxy. Whatever is on screen, the file that comes out
      // is rendered from the photo as it arrived.
      await Promise.all(photosOn(page).map(ensureFull));
      const blob = await renderToBlob(page, state.format);
      if (!blob) continue;
      // Instagram imports by filename, so the order has to be in the name.
      files.push(new File([blob], `${String(i + 1).padStart(2, '0')}.${ext}`, { type: state.format }));
    }
    if (moving) hideOpening();
    if (!files.length) { toast("Couldn't render the pages"); return; }

    // Said at the end rather than here. Everything below toasts something
    // routine on its way out, and a routine message replacing this one is
    // how you would come to post a still where you meant a video.
    const warn = failed
      ? () => toast(`${failed} video slide${failed > 1 ? 's' : ''} wouldn't render — sent as stills`)
      : null;

    // Share sheet takes the whole carousel at once and lands it in Photos.
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: 'Carousel' });
        if (warn) warn();
        return;
      } catch (err) {
        if (err.name === 'AbortError') { if (warn) warn(); return; }
      }
    }

    if (FRAMED) {
      // Downloads are blocked in an embedded frame; offer the current page.
      const url = URL.createObjectURL(files[Math.min(state.current, files.length - 1)]);
      openSheet(url, files[0].name, `${out.w}×${out.h}`, ext.toUpperCase());
      toast(warn ? '' : 'Embedded preview can only save one page at a time');
      if (warn) warn();
      return;
    }

    // No share sheet here (most desktop browsers): save them one by one,
    // numbered, so they still import in order.
    files.forEach((file, i) => {
      setTimeout(() => {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }, i * 250);
    });
    if (warn) warn();
    else toast(`Saving ${files.length} page${files.length > 1 ? 's' : ''} as ${out.w}×${out.h} ${ext.toUpperCase()}`);
  }

  function openSheet(url, name, size, ext) {
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
    sheetUrl = url;
    $('sheet-img').src = url;
    $('sheet-size').textContent = `${size} ${ext}`;
    $('sheet-download').onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    $('sheet').hidden = false;
  }

  function closeSheet() {
    $('sheet').hidden = true;
    $('sheet-img').removeAttribute('src');
    if (sheetUrl) { URL.revokeObjectURL(sheetUrl); sheetUrl = null; }
  }

  async function copyImage() {
    if (!navigator.clipboard || !window.ClipboardItem) { toast('This browser can’t copy images'); return; }
    try {
      const png = await renderToBlob(page(), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Copied to clipboard');
    } catch {
      toast('Copying was blocked — save the image instead');
    }
  }

  /* ------------------------------------------------------------- controls */

  function buildLayouts() {
    const wrap = $('layouts');
    LAYOUTS.forEach((layout) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'layout-btn';
      btn.title = layout.id === '1x1' ? 'Single image' : layout.id;
      btn.dataset.id = layout.id;
      btn.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
      btn.style.gridTemplateRows = `repeat(${layout.rows}, 1fr)`;
      layoutCells(layout).forEach((c) => {
        const s = document.createElement('span');
        s.style.gridArea = `${c.y + 1} / ${c.x + 1} / span ${c.h} / span ${c.w}`;
        btn.appendChild(s);
      });
      btn.setAttribute('aria-label', layout.id === '1x1' ? 'Single image' : `Layout ${layout.id}`);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => setLayout(layout));
      wrap.appendChild(btn);
    });
  }

  function buildRatios() {
    const wrap = $('ratios');
    RATIOS.forEach((ratio) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      // A rectangle in the option's own proportion, above the numbers. Every
      // ratio here is square or taller, so the height is the constant and the
      // width is what says which is which: 15px for 1:1 down to 8 for 9:16.
      const shape = document.createElement('span');
      shape.className = 'seg-shape';
      shape.style.width = `${Math.round((15 * ratio.w) / ratio.h)}px`;
      shape.setAttribute('aria-hidden', 'true');
      btn.appendChild(shape);
      btn.appendChild(document.createTextNode(ratio.label));
      btn.dataset.id = ratio.id;
      btn.setAttribute('aria-label', `Post shape ${ratio.label}`);
      btn.setAttribute('aria-pressed', String(ratio.id === state.ratio.id));
      btn.addEventListener('click', () => {
        snapshot();
        state.ratio = ratio;
        markActive(wrap, btn);
        restyle();
        refresh();
        saveDeck();
      });
      wrap.appendChild(btn);
    });
    markActive(wrap, wrap.querySelector(`[data-id="${state.ratio.id}"]`));
  }

  function buildSwatches() {
    const wrap = $('swatches');
    SWATCHES.forEach((colour) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.style.background = colour;
      btn.dataset.id = colour;
      btn.title = colour.toUpperCase();
      btn.setAttribute('aria-label', `Background ${colour.toUpperCase()}`);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => setBg(colour));
      wrap.appendChild(btn);
    });
  }

  function setBgInputs(colour) {
    $('bg').value = colour;
    $('bg-hex').textContent = colour.toUpperCase();
    markActive($('swatches'), $('swatches').querySelector(`[data-id="${colour}"]`));
  }

  function setBg(colour) {
    snapshot('bg');
    state.bg = colour;
    setBgInputs(colour);
    restyle();
    refresh();
    saveDeck();
  }

  // Pull the Style tab's controls back in line with state — needed after an
  // undo, which can change any of them.
  function syncStyleInputs() {
    markActive($('ratios'), $('ratios').querySelector(`[data-id="${state.ratio.id}"]`));
    ['gap', 'padding', 'radius'].forEach((key) => {
      $(key).value = state[key];
      $(`${key}-val`).textContent = state[key];
      paintSlider($(key));
    });
    $('quality').value = String(state.quality);
    $('format').value = state.format;
  }

  function markActive(wrap, btn) {
    [...wrap.children].forEach((c) => {
      c.classList.remove('is-active');
      if (c.hasAttribute('aria-pressed')) c.setAttribute('aria-pressed', 'false');
    });
    if (!btn) return;
    btn.classList.add('is-active');
    if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', 'true');
  }

  // How many detents a full sweep of a slider has. Emphatically not the number
  // of steps: the gap slider takes sixty of those end to end, and sixty buzzes
  // in one drag is a rattle rather than a control. Twelve are close enough
  // together to feel like notches under the thumb and far enough apart that
  // each one arrives as its own tick.
  const NOTCHES = 12;

  // Where the knob is, handed to the stylesheet. CSS can see a range input's
  // width but not its value, so the fill behind the knob and the readout above
  // it both wait on this. Anything that sets a slider's value — an undo, a
  // project opening, another tile being selected — has to call this after, or
  // the control keeps drawing the value it used to hold.
  function paintSlider(input) {
    const panel = input.closest('.dock-slider');
    if (!panel) return;
    const min = Number(input.min);
    const span = Number(input.max) - min || 1;
    const value = Number(input.value);
    panel.style.setProperty('--frac', clamp((value - min) / span, 0, 1));
    const read = panel.querySelector('.slider-read');
    if (read) read.textContent = `${Math.round(value)}${input.dataset.read || ''}`;
  }

  // The part of a drag that is only feedback: the fill, the readout, the knob
  // knowing it is held, and the notches. The value itself is the caller's
  // business — this deliberately never touches state, which is why zoom and
  // angle can share it with the three deck sliders despite writing to
  // different places.
  function feedback(id) {
    const input = $(id);
    const panel = input.closest('.dock-slider');
    let notch = null;
    let atEnd = false;

    input.addEventListener('pointerdown', () => {
      panel.classList.add('is-sliding');
      notch = null;
      atEnd = false;
      buzz('pick');
    });
    const release = () => panel.classList.remove('is-sliding');
    input.addEventListener('pointerup', release);
    input.addEventListener('pointercancel', release);

    input.addEventListener('input', () => {
      paintSlider(input);
      const min = Number(input.min);
      const span = Number(input.max) - min || 1;
      const frac = clamp((Number(input.value) - min) / span, 0, 1);
      // Notches are crossed rather than landed on. Comparing which band the
      // value is in against the band it was in last frame is what gives one
      // tick per notch however fast the drag is travelling — checking for a
      // value on a notch instead misses every notch a quick sweep jumps over.
      const band = Math.round(frac * NOTCHES);
      const end = frac === 0 || frac === 1;
      if (end && !atEnd) buzz('limit');
      else if (!end && notch !== null && band !== notch) buzz('tick');
      atEnd = end;
      notch = band;
    });
  }

  function slider(id, key) {
    const input = $(id);
    const label = $(`${id}-val`);
    input.value = state[key];
    label.textContent = state[key];
    paintSlider(input);
    feedback(id);
    input.addEventListener('pointerdown', () => { endRun(); snapshot(`slider:${key}`); });
    input.addEventListener('pointerup', endRun);
    input.addEventListener('input', () => {
      snapshot(`slider:${key}`);
      state[key] = Number(input.value);
      label.textContent = input.value;
      restyle();
      refresh();
      saveDeck();
    });
  }

  // The dock shows the list of settings, or drills into one of them. Keeping
  // it to one row means the preview never has to share the screen with a
  // panel, and using a control can't scroll the preview out of view.
  const DRAWERS = ['layout', 'shape', 'gap', 'padding', 'corners',
    'background', 'page', 'export', 'tile'];
  let drawer = null;

  // Which sub-panel of the tile drawer is showing, and the tile waiting to be
  // swapped with another.
  let tileSub = null;
  let swapFrom = null;

  function showTileSub(name) {
    tileSub = name;
    $('tile-actions').hidden = !!name;
    ['zoom', 'rotate', 'flip', 'replace', 'trim'].forEach((n) => { $(`tile-${n}`).hidden = n !== name; });
    if (name === 'trim') syncTrim();

    // Choosing a photo wants room: the pages bar steps aside and the dock
    // takes two rows, so the options are large enough to judge at a glance.
    const choosing = name === 'replace';
    document.querySelector('.app').classList.toggle('is-choosing', choosing);
    $('dock').classList.toggle('is-choosing', choosing);
    // Trimming wants the same room for a different reason: it is the one panel
    // with three rows to fit, and in the 62px a drawer normally gives they came
    // to 4px of bar apiece. The pages bar stays up for this one, unlike the
    // chooser — which page is being cut still matters.
    $('dock').classList.toggle('is-trimming', name === 'trim');
    if (choosing) renderChooser();
    // Page thumbnails aren't visible while choosing, so they catch up on the
    // way out rather than being redrawn for every photo scrolled past.
    else if (centred !== -1) { centred = -1; renderFilmstrip(); }
    setBackIcon();
    syncFades();
  }

  // The photos already imported, run past a fixed marker: whichever sits in
  // the middle is the one in the tile. Scrolling is the choosing.
  let centred = -1;
  let settlingScroll = false;

  function renderChooser() {
    const strip = $('choose-strip');
    strip.innerHTML = '';
    const cell = page().cells[state.selected];
    $('choose-focus').hidden = !state.photos.length;

    if (!state.photos.length) {
      strip.innerHTML = '<p class="choose-empty">No photos yet — add some with the button above.</p>';
      return;
    }

    state.photos.forEach((photo, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'choose-item';
      el.title = photo.name || 'Photo';
      const shot = document.createElement('img');
      shot.src = photo.thumbUrl;
      shot.alt = '';
      el.appendChild(shot);
      // Tapping doesn't apply directly — it brings that photo to the middle,
      // and the middle is what counts.
      el.addEventListener('click', () => scrollChooserTo(i, true));
      strip.appendChild(el);
    });

    // Open on whatever the tile already holds; on an empty tile, put the
    // first photo in straight away so there's something to judge.
    const start = Math.max(0, state.photos.findIndex((p) => cell && p.id === cell.photo));
    centred = start;
    markCentred(start);
    if (!cell) { applyCentred(); markCentred(start); }
    requestAnimationFrame(() => scrollChooserTo(start, false));
  }

  function markCentred(index) {
    [...$('choose-strip').children].forEach((el, i) => {
      el.classList.toggle('is-current', i === index);
    });
  }

  function scrollChooserTo(index, smooth) {
    const strip = $('choose-strip');
    const el = strip.children[index];
    if (!el) return;
    settlingScroll = true;
    strip.scrollTo({
      left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2,
      behavior: smooth && !reducedMotion ? 'smooth' : 'auto',
    });
    // Let the programmatic scroll finish before reading positions again,
    // otherwise it reports its own intermediate frames as a choice.
    setTimeout(() => { settlingScroll = false; onChooserScroll(); }, smooth ? 340 : 60);
  }

  function nearestToCentre() {
    const strip = $('choose-strip');
    const mid = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    let best = -1;
    let closest = Infinity;
    [...strip.children].forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < closest) { closest = d; best = i; }
    });
    return best;
  }

  let scrollFrame = 0;
  function onChooserScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (tileSub !== 'replace' || settlingScroll) return;
      const index = nearestToCentre();
      if (index < 0 || index === centred) return;
      centred = index;
      markCentred(index);
      buzz('snap');
      applyCentred();
    });
  }

  function applyCentred() {
    const photo = state.photos[centred];
    const i = state.selected;
    const cell = page().cells[i];
    if (!photo || (cell && cell.photo === photo.id)) return;
    // One undo step for a run through the reel, not one per photo passed.
    snapshot('choose');
    // A fresh crop each time, so flicking between options compares like
    // with like rather than inheriting the last photo's framing.
    page().cells[i] = emptyCell(photo.id);
    render();
    // What you have just scrolled onto is on screen now, so it has to be
    // read back up to size. The reel itself is drawn from thumbnails; the
    // preview underneath it must not be.
    manageResidency();
    // Scrolling onto a clip starts it, and scrolling off one stops it, so
    // what you are choosing between is what you would get.
    syncPlayback();
    ensurePosters(page(), () => { render(); renderFilmstrip(); });
    saveDeck();
  }

  // The tile bar drops the tile with a cross, as sketched; everything else
  // steps back up a level with an arrow.
  function setBackIcon() {
    const cross = drawer === 'tile' && !tileSub;
    // Via a class, not `.hidden`: that property belongs to HTMLElement, and
    // setting it on an <svg> quietly creates a useless expando instead.
    $('dock-back').classList.toggle('is-cross', cross);
    $('dock-back').setAttribute('aria-label', cross ? 'Done with this tile' : 'Back');
    $('dock-drawer').classList.toggle('is-tile', drawer === 'tile');
  }

  function cancelSwap() {
    if (swapFrom === null) return;
    swapFrom = null;
    $('canvas-wrap').classList.remove('is-swapping');
    render();
  }

  function tileAction(action) {
    const i = state.selected;
    const cell = page().cells[i];
    if (!cell) return;

    if (action === 'swap') {
      swapFrom = i;
      $('canvas-wrap').classList.add('is-swapping');
      toast('Tap another tile to swap them over');
      return;
    }
    if (action === 'replace') {
      // Straight to the device picker when there's nothing to choose between.
      if (!state.photos.length) { pendingCell = i; fileInput.click(); return; }
      showTileSub('replace');
      return;
    }
    if (action === 'delete') {
      snapshot();
      page().cells[i] = null;
      select(-1);
      refresh();
      return;
    }
    if (action === 'reset') { resetCell(i); return; }
    showTileSub(action);
  }

  /* ------------------------------------------------------------- trimming */
  //
  // Both handles run the whole length of the clip, stacked, so start and end
  // are measured on the same scale. Moving either one seeks the preview to
  // that exact moment and holds it there — cutting a clip you cannot see
  // would be guesswork.

  const TRIM_STEPS = 1000;

  function syncTrim() {
    const cell = page().cells[state.selected];
    const photo = photoFor(cell);
    if (!cell || !photo || photo.kind !== 'video') return;
    const { from, to, span, whole } = clipRange(cell);
    const at = (t) => Math.round((t / (whole || 1)) * TRIM_STEPS);
    $('trim-start').value = String(at(from));
    $('trim-end').value = String(at(to));
    $('trim-from').textContent = clockLabel(from);
    $('trim-to').textContent = clockLabel(to);
    $('trim-span').textContent = `${span.toFixed(1)}s of ${clockLabel(whole)}`;
    $('trim-reset').disabled = from === 0 && Math.abs(to - whole) < 0.05;
    // The kept span, drawn on both rails. CSS can see neither range input's
    // value, so where that span starts and ends is handed over here — the same
    // arrangement as --frac on the dock sliders.
    const bars = document.querySelector('.trim-bars');
    bars.style.setProperty('--fa', at(from) / TRIM_STEPS);
    bars.style.setProperty('--fb', at(to) / TRIM_STEPS);
  }

  // Seconds from a slider position, against the clip's own length.
  const trimAt = (el, whole) => (Number(el.value) / TRIM_STEPS) * whole;

  // Whether the handle being dragged is already sitting against the other one.
  let trimHeld = false;

  function dragTrim(which) {
    const i = state.selected;
    const cell = page().cells[i];
    const photo = photoFor(cell);
    if (!cell || !photo || photo.kind !== 'video') return;
    const whole = photo.duration || 0;

    let from = trimAt($('trim-start'), whole);
    let to = trimAt($('trim-end'), whole);
    // Never let the handles cross, and never let a clip go to nothing.
    const floor = 0.2;
    let held = false;
    if (which === 'start' && from > to - floor) { from = Math.max(0, to - floor); $('trim-start').value = String(Math.round((from / (whole || 1)) * TRIM_STEPS)); held = true; }
    if (which === 'end' && to < from + floor) { to = Math.min(whole, from + floor); $('trim-end').value = String(Math.round((to / (whole || 1)) * TRIM_STEPS)); held = true; }
    // The handle has stopped moving while the thumb has not, which is the one
    // thing on this panel a screen cannot say quickly enough. Once per arrival:
    // a drag that keeps pushing at the floor would otherwise buzz every frame.
    if (held && !trimHeld) buzz('limit');
    trimHeld = held;

    snapshot('trim');
    cell.t0 = from;
    cell.t1 = to;
    syncTrim();
    saveDeck();

    // Park the preview on the frame being set, so the handle is showing you
    // the cut rather than describing it.
    const player = players.get(i);
    if (player) {
      player.el.pause();
      try { player.el.currentTime = which === 'start' ? from : Math.max(from, to - 0.05); } catch { /* not seekable */ }
    }
  }

  // Let go and it runs the trimmed clip, from the top.
  function endTrimDrag() {
    endRun();
    // The cut has moved, so everywhere this tile is a still — the filmstrip,
    // the cover, the slides either side — is now showing the wrong frame.
    // Only on letting go: reading a frame means decoding up to it, and doing
    // that on every pixel of the drag would be absurd.
    ensurePosters(page(), () => { render(); renderFilmstrip(); });

    const player = players.get(state.selected);
    if (!player) return;
    const { from } = clipRange(page().cells[state.selected]);
    try { player.el.currentTime = from; } catch { /* not seekable */ }
    player.el.play().catch(() => {});
  }

  function resetTrim() {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot();
    cell.t0 = 0;
    cell.t1 = 0;
    syncTrim();
    saveDeck();
    endTrimDrag();
  }

  function flipCell(axis) {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot();
    if (axis === 'x') cell.flipX = !cell.flipX;
    else cell.flipY = !cell.flipY;
    render();
  }

  function openDrawer(name) {
    drawer = name;
    DRAWERS.forEach((d) => { $(`dp-${d}`).hidden = d !== name; });
    if (name === 'tile') showTileSub(null); else tileSub = null;
    setBackIcon();
    $('dock-root').hidden = true;
    $('dock-drawer').hidden = false;
    syncFades();
  }

  function closeDrawer() {
    drawer = null;
    tileSub = null;
    document.querySelector('.app').classList.remove('is-choosing');
    $('dock').classList.remove('is-choosing');
    cancelSwap();
    setBackIcon();
    DRAWERS.forEach((d) => { $(`dp-${d}`).hidden = true; });
    $('dock-drawer').hidden = true;
    $('dock-root').hidden = false;
    syncFades();
  }

  /* ------------------------------------------------- sideways scroll hints */

  // Rows that can run off the edge fade there, but only while there really is
  // more to see — a fade on a row that already fits would promise nothing.
  const FADE_ROWS = [
    // The last two are panels that scroll a rail inside themselves rather than
    // scrolling whole: the background presets beside a colour well that stays
    // put, and the export settings beside an Export button that does. The
    // panel around each of them no longer moves, so it is the rail that has to
    // carry the fade or nothing would say there was more.
    ...['filmstrip', 'dock-root', 'layouts', 'tile-actions', 'swatches', 'export-settings'].map($),
    // Not the tile panel: it deliberately overflows (its own rows scroll), so
    // measuring it would show slack that can never be scrolled away.
    //
    // Nor a slider, for the same reason and with worse consequences. A slider
    // panel sets `overflow: visible` so the readout can escape upward out of
    // the dock, which also means it can never scroll: scrollLeft stays nought
    // whatever scrollWidth says. What it does have is a readout that rides the
    // knob, and at the top of the range that bubble hangs past the panel's
    // right edge — 381px of content in 346px of panel, measured at 420x860.
    // That counted as slack, so fade-r went on and masked the last 20px of the
    // panel: the knob faded out to nothing on its right side, its accent halo
    // was cut in half, and the number in the corner lost its last digit. All
    // of it at exactly the value being dragged to, and it stayed that way
    // after release, because a slider left at its maximum keeps the overflow.
    ...document.querySelectorAll('.dock-panel:not(#dp-tile):not(.dock-slider)'),
  ].filter(Boolean);

  function fadeRow(el) {
    if (!el) return;
    const slack = el.scrollWidth - el.clientWidth;
    const room = slack > 2 && el.clientWidth > 0;
    el.classList.toggle('fade-l', room && el.scrollLeft > 2);
    el.classList.toggle('fade-r', room && el.scrollLeft < slack - 2);
  }

  function syncFades() {
    FADE_ROWS.forEach(fadeRow);
  }

  FADE_ROWS.forEach((el) => {
    el.classList.add('hscroll');
    el.addEventListener('scroll', () => fadeRow(el), { passive: true });
    if (window.ResizeObserver) new ResizeObserver(() => fadeRow(el)).observe(el);
  });

  /* ------------------------------------------------------------------ misc */

  let toastTimer;
  // Something with a known number of steps holds the strip until it is
  // finished, and shows how far through it is. Anything else that wants to
  // say something meanwhile waits its turn: a message that arrived mid-import
  // would replace the bar and then be replaced by the next tick a moment
  // later, so nobody would read either.
  let running = false;
  let finishing = false;
  const waiting = [];

  function toast(message) {
    if (running) { waiting.push(message); return; }
    const el = $('toast');
    $('toast-text').textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  function startProgress(message, done, total) {
    running = true;
    clearTimeout(toastTimer);
    const el = $('toast');
    $('toast-text').textContent = message;
    $('toast-bar').hidden = false;
    $('toast-fill').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    el.classList.add('is-progress', 'is-visible');
  }

  function endProgress() {
    if (!running || finishing) return;
    finishing = true;

    // Let the bar arrive rather than yanking it off mid-sweep. The last step
    // and the end land in the same tick, so the fill is set to full and then
    // cleared before the browser has painted either — which reads as giving
    // up somewhere in the nineties. It stays claimed for the length of that
    // sweep, so anything said in the meantime still queues behind it.
    $('toast-fill').style.width = '100%';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      running = false;
      finishing = false;
      $('toast').classList.remove('is-progress');
      $('toast-bar').hidden = true;
      $('toast-fill').style.width = '0%';

      // Whatever tried to speak while it was working gets its turn now. The
      // last one said is the one that stands: the summary of what happened
      // to the whole pile comes after anything about a single file in it.
      const held = waiting.splice(0);
      if (held.length) toast(held[held.length - 1]);
      else $('toast').classList.remove('is-visible');
    }, 300);
  }

  /* --------------------------------------------------------- persistence */
  //
  // An installed app is expected to still be there when you reopen it, and a
  // 20-page deck is far too much work to lose to a relaunch. Photos live in
  // IndexedDB as resized blobs; the deck is a small JSON record beside them.

  const DB_NAME = 'grid-collage';
  const STORE_PHOTOS = 'photos';
  const STORE_META = 'meta';
  const STORE_COVERS = 'covers';
  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_PHOTOS)) d.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META, { keyPath: 'key' });
        // v2: a photo belongs to a project, and each project keeps one small
        // thumbnail so the homepage has something to show without opening a
        // deck. Photos saved by v1 carry no project; they are stamped once,
        // at start-up, by migrateLegacy().
        if (!d.objectStoreNames.contains(STORE_COVERS)) d.createObjectStore(STORE_COVERS, { keyPath: 'id' });
        const photos = req.transaction.objectStore(STORE_PHOTOS);
        if (!photos.indexNames.contains('project')) photos.createIndex('project', 'project', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
    return dbPromise;
  }

  async function put(store, value) {
    const d = await db();
    if (!d) return;
    await new Promise((resolve) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  }

  async function getAll(store) {
    const d = await db();
    if (!d) return [];
    return new Promise((resolve) => {
      const req = d.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  function savePhoto(photo) {
    // Nothing is written while the homepage is showing: there is no project
    // for it to belong to, and an unstamped row would look like a leftover
    // from the version before projects existed.
    if (!current) return;
    persisted.add(photo.id);
    put(STORE_PHOTOS, {
      id: photo.id, project: current.id, name: photo.name, taken: photo.taken,
      // A clip's own UTC and the offset it named, kept so a reopened tray can
      // still place it — and so a clip already shifted by a guess can be
      // shifted again by a better one when more of the trip arrives.
      takenUtc: photo.takenUtc ?? null, takenZone: photo.takenZone ?? null,
      // Measured once at import and stored, because the pixels it was measured
      // from no longer exist by the time anything reads it back — and neither
      // does the EXIF, which a HEIC loses on the way in.
      stats: photo.stats || null,
      lat: photo.lat ?? null, lon: photo.lon ?? null, focal35: photo.focal35 ?? null,
      kind: photo.kind || 'photo', duration: photo.duration || 0,
      blob: photo.blob, thumb: photo.thumbBlob, thumbEdge: THUMB_EDGE,
      proxy: photo.proxyBlob, proxyEdge: photo.proxyBlob ? PROXY_EDGE : 0,
      w: photo.w, h: photo.h,
    });
  }

  async function dropPhoto(id) {
    const d = await db();
    if (!d) return;
    d.transaction(STORE_PHOTOS, 'readwrite').objectStore(STORE_PHOTOS).delete(id);
  }

  // Every photo row belonging to one project, read in a single pass. Blobs
  // come back with it, which is the expensive part of opening a deck and the
  // reason the homepage never does this.
  async function photoRows(projectId) {
    const d = await db();
    if (!d) return [];
    return new Promise((resolve) => {
      let req;
      try {
        req = d.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS)
          .index('project').getAll(IDBKeyRange.only(projectId));
      } catch { resolve([]); return; }
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  // Deleting a project takes its photos with it. One cursor over the index,
  // so nothing but that project's rows is ever read.
  async function dropProjectPhotos(projectId) {
    const d = await db();
    if (!d) return;
    await new Promise((done) => {
      let tx;
      try { tx = d.transaction(STORE_PHOTOS, 'readwrite'); } catch { done(); return; }
      const req = tx.objectStore(STORE_PHOTOS).index('project').openKeyCursor(IDBKeyRange.only(projectId));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        tx.objectStore(STORE_PHOTOS).delete(cur.primaryKey);
        cur.continue();
      };
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    });
  }

  async function dropCover(projectId) {
    const d = await db();
    if (!d) return;
    try { d.transaction(STORE_COVERS, 'readwrite').objectStore(STORE_COVERS).delete(projectId); } catch { /* gone already */ }
  }

  // One description of the deck, shared by persistence and the undo stack.
  function serialiseDeck() {
    return {
      ratio: state.ratio.id,
      gap: state.gap,
      padding: state.padding,
      radius: state.radius,
      bg: state.bg,
      quality: state.quality,
      format: state.format,
      current: state.current,
      pages: state.pages.map((pg) => ({
        layout: pg.layout.id,
        cells: pg.cells.map((c) => (c ? {
          photo: c.photo, zoom: c.zoom, rot: c.rot, ox: c.ox, oy: c.oy,
          flipX: !!c.flipX, flipY: !!c.flipY, t0: c.t0 || 0, t1: c.t1 || 0,
        } : null)),
      })),
    };
  }

  function applyDeck(data) {
    state.ratio = RATIOS.find((r) => r.id === data.ratio) || state.ratio;
    ['gap', 'padding', 'radius', 'quality'].forEach((k) => {
      if (typeof data[k] === 'number') state[k] = data[k];
    });
    if (data.bg) state.bg = data.bg;
    if (data.format) state.format = data.format;

    if (data.pages && data.pages.length) {
      // Every undo replaces the cells wholesale, and a poster is a decoded
      // bitmap hanging off one. The replacements are built from serialised
      // JSON and carry none, so without this each step back would abandon a
      // frame per trimmed clip. They are read again on the next refresh.
      dropPosters(state.pages);
      state.pages = data.pages.map((p) => {
        const layout = LAYOUTS.find((l) => l.id === p.layout) || LAYOUTS[0];
        const pg = newPage(layout);
        pg.cells = blankCells(layout).map((_, i) => {
          const c = p.cells[i];
          // Drop references to photos that are no longer in the tray.
          return c && photoById(c.photo) ? { ...c } : null;
        });
        return pg;
      });
      state.current = clamp(data.current || 0, 0, state.pages.length - 1);
    }
  }

  // The deck is a few kilobytes of JSON, so it goes to localStorage: writing
  // it is synchronous and finishes before the app can be swiped away. An
  // IndexedDB write is async and can be abandoned mid-flight on close, which
  // is how a share-then-close lost its pages while the photos survived.
  // Photos stay in IndexedDB — blobs have no business in localStorage.
  //
  // One key per project now, and the list of the projects themselves goes the
  // same way for the same reason: the homepage is the first thing a cold
  // launch paints, and it must not have to wait on a database to do it.
  const DECK_PREFIX = 'grid-collage:deck:';
  const LEGACY_DECK_KEY = 'grid-collage:deck';
  const PROJECTS_KEY = 'grid-collage:projects';

  // Nothing is written until the saved deck has been read back. The first
  // refresh happens while a project is opening, and without this it would
  // overwrite the stored deck with the blank one before restore ever got to
  // look at it. It is also what stops the editor writing while the homepage
  // is showing and there is no project to write to.
  let restored = false;

  function saveDeck() {
    if (!restored || !current) return;
    try {
      localStorage.setItem(DECK_PREFIX + current.id, JSON.stringify(serialiseDeck()));
    } catch { /* private mode or quota — the deck just won't come back */ }
    saveProjectMeta();
  }

  function loadDeck(projectId) {
    try {
      const raw = localStorage.getItem(DECK_PREFIX + projectId);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
  }

  // Which photo blobs are actually in the database, so undoing a tray removal
  // can put one back and redoing can take it out again.
  const persisted = new Set();

  function reconcilePhotos() {
    const live = new Set(state.photos.map((p) => p.id));
    state.photos.forEach((p) => { if (!persisted.has(p.id)) savePhoto(p); });
    [...persisted].forEach((id) => { if (!live.has(id)) { dropPhoto(id); persisted.delete(id); } });
  }

  /* --------------------------------------------------------------- projects */
  //
  // A cold launch lands on the projects, not on a deck. Each project is a
  // deck of its own with its own photos, and what the homepage shows about
  // one — its name, how many photos and pages it holds, how much room it is
  // taking — is written beside it as it is edited. So the list costs one
  // localStorage read and no decoding at all, however many photos are behind
  // it. The photos are only read when you open one, which is the one place a
  // progress bar is worth having.

  let projects = [];          // newest edit first
  let current = null;         // the open project's record, null on the homepage
  let opening = false;

  const sizeOf = (b) => (b && b.size) || 0;
  const nextFrame = () => new Promise((go) => requestAnimationFrame(() => setTimeout(go, 0)));

  function loadProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      const list = raw ? JSON.parse(raw) : null;
      if (Array.isArray(list)) return list.filter((p) => p && p.id);
    } catch { /* private mode, or something else wrote the key */ }
    return [];
  }

  function saveProjects() {
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch { /* private mode */ }
  }

  // The cover is whatever the carousel opens on: the first photo actually
  // placed, falling back to the first one imported. It is the tray thumbnail,
  // which already exists — no extra encode, and 384px is more than a card
  // needs.
  function coverPhotoId() {
    for (const pg of state.pages) {
      const cell = pg.cells.find((c) => c && c.photo && photoById(c.photo));
      if (cell) return cell.photo;
    }
    return state.photos.length ? state.photos[0].id : null;
  }

  // Called on every save of the deck, which is every edit. All of it is
  // arithmetic over what is already in memory — no blob is read to work out
  // how big the project is.
  function saveProjectMeta() {
    if (!current) return;
    current.photos = state.photos.length;
    current.pages = state.pages.length;
    current.bytes = state.photos.reduce(
      (n, p) => n + sizeOf(p.blob) + sizeOf(p.thumbBlob) + sizeOf(p.proxyBlob), 0,
    );
    current.updated = Date.now();

    const wanted = coverPhotoId();
    if (wanted !== current.cover) {
      current.cover = wanted;
      const photo = wanted ? photoById(wanted) : null;
      const old = coverUrls.get(current.id);
      if (old) URL.revokeObjectURL(old);
      coverUrls.delete(current.id);
      if (photo && photo.thumbBlob) {
        put(STORE_COVERS, { id: current.id, blob: photo.thumbBlob });
        coverUrls.set(current.id, URL.createObjectURL(photo.thumbBlob));
      } else {
        dropCover(current.id);
      }
    }

    // Newest made, first — not most recently touched. Sorting by the edit
    // meant the grid rearranged itself behind you: open a carousel to look
    // at it and it jumped to the front, so nothing was ever where you left
    // it. When it was made never changes, so neither does the order.
    sortProjects();
    saveProjects();
  }

  // Until a tile has been dragged, the order is the date each was made.
  // After that the stored array is the order and nothing re-sorts it — you
  // have said where things go, and having the grid quietly put them back
  // would be worse than never having let you move them. New projects are
  // unshifted to the front either way, so making one always puts it where
  // you are looking.
  const ORDER_KEY = 'grid-collage:custom-order';
  let customOrder = false;
  try { customOrder = localStorage.getItem(ORDER_KEY) === '1'; } catch { /* private mode */ }

  function setCustomOrder() {
    if (customOrder) return;
    customOrder = true;
    try { localStorage.setItem(ORDER_KEY, '1'); } catch { /* private mode */ }
  }

  function sortProjects() {
    if (customOrder) return;
    projects.sort((a, b) => (b.created || b.updated || 0) - (a.created || a.updated || 0));
  }

  function nextName() {
    const used = new Set(projects.map((p) => p.name));
    let n = projects.length + 1;
    while (used.has(`Carousel ${n}`)) n += 1;
    return `Carousel ${n}`;
  }

  function createProject(name) {
    const rec = {
      id: `pj-${uid()}`,
      name: name || nextName(),
      created: Date.now(),
      updated: Date.now(),
      photos: 0,
      pages: 1,
      bytes: 0,
      cover: null,
    };
    projects.unshift(rec);
    saveProjects();
    return rec;
  }

  async function deleteProject(rec) {
    projects = projects.filter((p) => p.id !== rec.id);
    saveProjects();
    try { localStorage.removeItem(DECK_PREFIX + rec.id); } catch { /* private mode */ }
    const url = coverUrls.get(rec.id);
    if (url) URL.revokeObjectURL(url);
    coverUrls.delete(rec.id);
    // Redrawn before the photos are gone: the record is what the list reads,
    // and waiting on the database would leave a deleted card on screen. The
    // card leaving, and the total in the header dropping, are the answer —
    // the toast lives in the editor's stage and has nowhere to appear here.
    renderHome();
    await dropProjectPhotos(rec.id);
    await dropCover(rec.id);
  }

  /* --------------------------------------------------- opening and closing */

  function applySettings(saved) {
    if (!saved) return;
    state.ratio = RATIOS.find((r) => r.id === saved.ratio) || state.ratio;
    ['gap', 'padding', 'radius', 'quality'].forEach((k) => {
      if (typeof saved[k] === 'number') state[k] = saved[k];
    });
    if (saved.bg) state.bg = saved.bg;
    if (saved.format) state.format = saved.format;
  }

  // Back to the state a fresh project starts in. Bitmaps are closed and the
  // thumbnail URLs revoked here rather than left to the collector: a deck of
  // twenty is a couple of hundred megabytes of decoded pixels, and hopping
  // between projects would otherwise stack them up.
  function resetEditor() {
    clearTimeout(dwellTimer);
    stopPlayers();
    // A poster is a decoded bitmap sitting on a cell, and the cells are
    // about to be thrown away. Moving between projects would otherwise
    // stack up a frame per trimmed clip per project visited.
    dropPosters(state.pages);
    loadingFull.clear();
    state.photos.forEach((p) => {
      try { URL.revokeObjectURL(p.thumbUrl); } catch { /* already gone */ }
      try { p.bitmap.close(); } catch { /* not all browsers, and it may be closed */ }
    });
    state.photos = [];
    persisted.clear();
    state.pages = [newPage()];
    state.current = 0;
    state.selected = -1;
    state.ratio = RATIOS[0];
    state.gap = 0;
    state.padding = 0;
    state.radius = 0;
    state.bg = '#ffffff';
    state.quality = 1080;
    state.format = 'image/jpeg';
    undoStack.length = 0;
    redoStack.length = 0;
    syncHistoryButtons();
    restyle();
  }

  function showOpening(name, step) {
    $('op-name').textContent = name;
    $('op-step').textContent = step || 'Reading photos…';
    $('op-fill').style.width = '0%';
    $('opening').hidden = false;
  }

  function setOpening(done, total) {
    $('op-fill').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
    $('op-step').textContent = total ? `${done} of ${total} photos` : 'Ready';
  }

  const hideOpening = () => { $('opening').hidden = true; };

  async function openProject(rec) {
    if (!rec || opening) return;
    opening = true;
    restored = false;
    current = rec;
    showOpening(rec.name);
    // One frame, so the bar is on screen before the reading starts rather
    // than appearing at the end of it.
    await nextFrame();

    resetEditor();
    const saved = loadDeck(rec.id);
    applySettings(saved);

    const rows = await photoRows(rec.id);
    setOpening(0, rows.length);

    const stale = [];
    const noProxy = [];
    let done = 0;
    for (const row of rows) {
      try {
        // The proxy if there is one: a deck of twenty opens in a quarter of a
        // second on those, against seven seconds decoding the originals. The
        // full photo is read later, when something needs it.
        const bitmap = await decodeImage(row.proxy || row.blob);
        const photo = {
          id: row.id, name: row.name, bitmap,
          w: row.w || bitmap.width, h: row.h || bitmap.height,
          // Photos stored by an earlier build have no date on them; the file's
          // own timestamp is long gone by then, so they group under today.
          taken: row.taken || Date.now(),
          // w/h are the real photo's, not the proxy's — the cover maths works
          // in the photo's own proportions and must not change when the full
          // one swaps in.
          kind: row.kind === 'video' ? 'video' : 'photo',
          duration: row.duration || 0,
          // A restored video is drawn from its poster, which is all we ever
          // draw, so it is never waiting on anything.
          full: row.kind === 'video' ? true : !row.proxy,
          // Read back at proxy size, so not on its thumbnail. Residency
          // decides from here which of them stay that way.
          small: false,
          // Absent on anything imported before the measuring pass existed. Left
          // absent rather than recomputed: the numbers only mean anything
          // measured at native resolution, and by here the original is a blob
          // nobody has decoded.
          stats: row.stats || null,
          lat: row.lat ?? null, lon: row.lon ?? null, focal35: row.focal35 ?? null,
          // Absent on clips imported before the container was read, which is
          // why those keep whatever date they were given and only a re-import
          // moves them.
          takenUtc: row.takenUtc ?? null, takenZone: row.takenZone ?? null,
          blob: row.blob, proxyBlob: row.proxy,
          thumbBlob: row.thumb, thumbUrl: URL.createObjectURL(row.thumb || row.blob),
        };
        state.photos.push(photo);
        // Stored before proxies existed: make one in the background so the
        // next launch is the quick one.
        if (!row.proxy) noProxy.push(photo);
        // A library imported by an earlier build has 160px thumbnails in it,
        // which the grid stretches. The full photo is in hand, so they can be
        // redrawn rather than waiting to be imported again.
        // Any size but the current one, so the library converges whichever
        // way the setting moved — too small to look at, or bigger than the
        // grid can use and costing a decode on every launch.
        if ((row.thumbEdge || 0) !== THUMB_EDGE) stale.push(photo);
        persisted.add(row.id);
        // Keep the id counter clear of anything we just restored.
        bumpSeq(Number(String(row.id).replace(/\D/g, '')) + 1);
      } catch { /* unreadable row — skip it */ }
      done += 1;
      setOpening(done, rows.length);
      // A decode resolves on its own task, so the bar does get painted — but
      // only every few photos, which is often enough to read and rare enough
      // not to cost a frame each time.
      if (done % 4 === 0) await nextFrame();
    }

    // The whole tray is back, so a clip that named no offset can be placed by
    // what the rest of it says — the same pass the import runs, for the same
    // reason. Only what actually moved is written back.
    alignClipTimes(state.photos).forEach(savePhoto);

    if (saved && saved.pages && saved.pages.length) {
      state.pages = saved.pages.map((p) => {
        const layout = LAYOUTS.find((l) => l.id === p.layout) || LAYOUTS[0];
        const pg = newPage(layout);
        pg.cells = blankCells(layout).map((_, i) => {
          const c = p.cells[i];
          // Drop references to photos that are no longer in the tray.
          return c && photoById(c.photo) ? { ...c } : null;
        });
        return pg;
      });
      state.current = clamp(saved.current || 0, 0, state.pages.length - 1);
    }

    restored = true;
    restyle();
    setBgInputs(state.bg);
    syncStyleInputs();

    // Off the homepage before the first render, so the canvas is measured
    // against the space it will actually occupy rather than none at all.
    document.body.classList.remove('on-home');
    closeDrawer();
    hideOpening();
    opening = false;

    refresh();
    // Opening isn't an edit, so it starts with a clean history.
    undoStack.length = 0;
    redoStack.length = 0;
    syncHistoryButtons();
    requestAnimationFrame(() => render());

    if (stale.length) upgradeThumbs(stale);
    if (noProxy.length) backfillProxies(noProxy);
  }

  // What the card should really show is the slide, not one of the photos in
  // it — the layout, the background and the framing are most of what makes a
  // project recognisable. Drawn on the way out, which is the one moment it is
  // about to be looked at and the photos are still decoded.
  async function refreshCover(rec) {
    const first = state.pages.find((pg) => pg.cells.some((c) => photoFor(c))) || null;
    if (!rec || !first) return;
    try {
      // The cover page need not be the one that was open, so its clips may
      // never have had a poster read and its photos may be down to their
      // thumbnails. Worth the wait here: this runs once, on the way out, and
      // whatever it draws is the version that sits on the homepage until
      // something else changes it.
      await Promise.all(photosOn(first).filter((p) => p.small).map(atSize));
      await postersFor(first);
      const W = 400;
      const H = Math.round((W * state.ratio.h) / state.ratio.w);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      drawPage(c.getContext('2d'), first, W, H);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
      if (!blob) return;
      await put(STORE_COVERS, { id: rec.id, blob });
      const old = coverUrls.get(rec.id);
      if (old) URL.revokeObjectURL(old);
      coverUrls.set(rec.id, URL.createObjectURL(blob));
    } catch { /* the photo thumbnail saved alongside it stands in */ }
  }

  async function goHome() {
    if (!current || opening) return;
    saveDeck();                 // last write while the project is still open
    await refreshCover(current);
    restored = false;
    current = null;
    closeLibrary();
    closeDrawer();
    if (!$('sheet').hidden) closeSheet();
    resetEditor();
    document.body.classList.add('on-home');
    renderHome();
  }

  /* ------------------------------------------------------------ the homepage */

  // One object URL per cover, kept between renders: the list is rebuilt every
  // time you come back to it, and reissuing them would leak one a visit.
  const coverUrls = new Map();

  function fmtBytes(n) {
    if (!n) return '0 MB';
    const mb = n / 1048576;
    if (mb < 0.1) return 'under 0.1 MB';
    if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  function agoLabel(ts) {
    const mins = Math.max(0, (Date.now() - ts) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${Math.round(mins)} min ago`;
    const hours = mins / 60;
    if (hours < 24) return `${Math.round(hours)} hr ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Dated rather than numbered, because the question it answers is "has my
  // installed copy picked up the change yet" — and a date answers that
  // without anyone having to remember what 1.7.2 meant. Bumped by hand on
  // the way out; there is no build step to stamp it.
  const HOME_HINT = `v${VERSION}`;
  const SHARE_HINT = 'Tap a carousel to add them, or start a new one';

  function renderHome() {
    const grid = $('home-grid');
    grid.innerHTML = '';
    $('home-empty').hidden = projects.length > 0;
    // Always there, empty grid or not — a version you have to have projects
    // to read is no use for checking whether the app updated.
    $('home-hint').hidden = false;
    $('home-hint').textContent = pendingShare ? SHARE_HINT : HOME_HINT;

    const bytes = projects.reduce((n, p) => n + (p.bytes || 0), 0);
    $('home-sub').textContent = projects.length
      ? `${plural(projects.length, 'project')} · ${fmtBytes(bytes)} stored`
      : 'Build a carousel, then come back to it whenever';

    projects.forEach((rec) => grid.appendChild(projectTile(rec)));
    paintCovers();
    loadCovers();
  }

  // The mark a multi-photo post carries. Every project here is a carousel, so
  // every tile has one — it says what the grid is, not which tile is special.
  const CAROUSEL_MARK =
    '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<rect x="7" y="2" width="15" height="15" rx="4.5"/>'
    + '<path d="M4.2 5.9A1.2 1.2 0 0 0 2 6.6v10.2A5.2 5.2 0 0 0 7.2 22h10.2a1.2 1.2 0 0 0 .7-2.2'
    + ' 1.3 1.3 0 0 0-.75-.24H8a3.8 3.8 0 0 1-3.8-3.8V6.65a1.3 1.3 0 0 0-.24-.75z"/></svg>';

  function projectTile(rec) {
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.type = 'button';
    tile.dataset.id = rec.id;
    // The tile shows no words, so the label has to carry all of them.
    tile.setAttribute('aria-label',
      `${rec.name} — ${plural(rec.photos || 0, 'photo')}, ${plural(rec.pages || 1, 'slide')}.`
      + ' Tap to open, press and hold for details');

    const mark = document.createElement('span');
    mark.className = 'brand-mark';
    mark.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i += 1) mark.appendChild(document.createElement('i'));
    tile.appendChild(mark);

    const badge = document.createElement('span');
    badge.className = 'tile-mark';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = CAROUSEL_MARK;
    tile.appendChild(badge);

    armHold(tile, rec);
    return tile;
  }

  // Tap opens, hold shows what it is. The hold has to survive a finger that
  // drifts a pixel or two, and must not fire when the finger is really
  // scrolling the grid — so any real movement cancels it. Half a second is
  // roughly where the platforms put the same gesture: long enough that
  // starting a slow scroll doesn't trip it, short enough to feel like an
  // answer rather than a wait.
  const HOLD_MS = 450;

  function armHold(tile, rec) {
    let lastPointer = 'mouse';

    tile.addEventListener('pointerdown', (e) => {
      lastPointer = e.pointerType || 'mouse';
      // While a share is waiting, a tile means one thing only: put them here.
      // That path goes through click, below.
      if (e.button > 0 || pendingShare || gridDrag) return;

      const from = { x: e.clientX, y: e.clientY };
      let lifted = false;

      tile.classList.add('is-holding');
      const timer = setTimeout(() => {
        lifted = true;
        tile.classList.remove('is-holding');
        beginGridDrag(tile, from.x, from.y);
      }, HOLD_MS);

      // On window, not on the tile: once it is in your hand the pointer
      // spends most of the drag over other tiles, and the release can land
      // anywhere at all.
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        if (lifted) { ev.preventDefault(); moveGridDrag(ev.clientX, ev.clientY); return; }
        // Moved before the hold landed — that was a scroll, not a press.
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > 10) { clearTimeout(timer); done(); }
      };

      const up = (ev) => {
        clearTimeout(timer);
        if (lifted) {
          // Held and let go without going anywhere: that was a question
          // about the tile, not an instruction to move it.
          const asked = !(gridDrag && gridDrag.moved);
          endGridDrag();
          if (asked) openDetail(rec);
        } else if (ev.type === 'pointerup'
            && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 10) {
          openProject(rec);
        }
        done();
      };

      const done = () => {
        tile.classList.remove('is-holding');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    tile.addEventListener('click', (e) => {
      if (pendingShare) { placeSharedIn(rec); return; }
      // A pointer tap was already answered on pointerup, where it could be
      // told apart from a hold. What is left is the keyboard, which fires a
      // click with no clicks behind it.
      if (e.detail === 0) openProject(rec);
    });

    tile.addEventListener('contextmenu', (e) => {
      // Always swallowed: on Android this is the system's own long-press
      // menu trying to open over the drag.
      e.preventDefault();
      // A right-click is a fair shortcut to the details. A touch long-press
      // is not — that one is already the hold, and answering it here would
      // open the sheet on top of a tile you had just picked up.
      if (lastPointer === 'touch' || pendingShare || gridDrag) return;
      openDetail(rec);
    });
  }

  /* ------------------------------------------------- rearranging the grid */
  //
  // Three things one tile has to tell apart. A tap opens it. A hold and
  // release says what it is. A hold and drag moves it. The hold is the fork:
  // once it fires the tile is in your hand, and what happens next is decided
  // by whether you go anywhere — which is the same bargain the filmstrip
  // strikes with pages, so the two feel like one app.

  const GRID_LIFT_MS = 170;
  const GRID_EDGE = 64;          // how close to an end starts the scroll
  const GRID_EDGE_SPEED = 14;    // pixels a frame at the very edge
  let gridDrag = null;

  // Once a page has been picked up the browser must not also scroll the grid
  // with the same finger. touch-action can't be changed mid-gesture, but
  // cancelling the moves after the hold stops the scroll before it starts.
  const blockGridScroll = (e) => { if (gridDrag) e.preventDefault(); };

  function beginGridDrag(tile, x, y) {
    const grid = $('home-grid');
    const body = $('home-body');
    const items = [...grid.querySelectorAll('.tile')];
    const index = items.indexOf(tile);
    if (index === -1) return;

    // A long press would otherwise start a selection, and the selection takes
    // the pointer stream with it.
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    document.addEventListener('touchmove', blockGridScroll, { passive: false });
    buzz('pick');

    // Every cell is the same size, so one step across and one step down
    // describe the whole grid. Measured now, before anything has moved.
    const rects = items.map((it) => it.getBoundingClientRect());
    let cols = 1;
    while (cols < rects.length && Math.abs(rects[cols].top - rects[0].top) < 2) cols += 1;
    const stepX = cols > 1 ? rects[1].left - rects[0].left : rects[0].width + 2;
    const stepY = rects.length > cols ? rects[cols].top - rects[0].top : rects[0].height + 2;

    gridDrag = {
      tile, index, target: index, items, cols, stepX, stepY, body,
      startX: x, startY: y, x, y, moved: false,
      originX: rects[0].left + rects[0].width / 2,
      originY: rects[0].top + rects[0].height / 2,
      homeX: rects[index].left + rects[index].width / 2,
      homeY: rects[index].top + rects[index].height / 2,
      startScroll: body.scrollTop,
      maxScroll: Math.max(0, body.scrollHeight - body.clientHeight),
      raf: 0,
    };

    grid.classList.add('is-reordering');
    tile.classList.add('is-lifted');
    gridDrag.raf = requestAnimationFrame(gridEdgeScroll);
    layoutGridDrag();
  }

  function moveGridDrag(x, y) {
    if (!gridDrag) return;
    gridDrag.x = x;
    gridDrag.y = y;
    if (Math.hypot(x - gridDrag.startX, y - gridDrag.startY) > 10) gridDrag.moved = true;
    layoutGridDrag();
  }

  function layoutGridDrag() {
    const d = gridDrag;
    if (!d) return;
    // What the finger has moved, plus whatever the grid has scrolled beneath
    // it — the tile travels with the scroller, so it has to be paid back.
    const dx = d.x - d.startX;
    const dy = (d.y - d.startY) + (d.body.scrollTop - d.startScroll);
    d.tile.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;

    // Which cell the tile's own middle is now sitting over.
    const col = clamp(Math.round((d.homeX + dx - d.originX) / d.stepX), 0, d.cols - 1);
    const row = Math.max(0, Math.round((d.homeY + dy - d.originY) / d.stepY));
    const target = clamp(row * d.cols + col, 0, d.items.length - 1);
    if (target === d.target) return;
    d.target = target;
    d.moved = true;

    // Open the gap: everything between the old slot and the new one steps
    // along by exactly one place, wrapping across rows as it goes.
    d.items.forEach((it, i) => {
      if (it === d.tile) return;
      let slot = i;
      if (d.index < target && i > d.index && i <= target) slot = i - 1;
      else if (d.index > target && i >= target && i < d.index) slot = i + 1;
      const across = (slot % d.cols) - (i % d.cols);
      const down = Math.floor(slot / d.cols) - Math.floor(i / d.cols);
      it.style.transform = across || down
        ? `translate(${across * d.stepX}px, ${down * d.stepY}px)`
        : '';
    });
  }

  // Holding a tile against the top or bottom of the grid walks it along,
  // faster the closer to the edge — otherwise a deck of twenty could only be
  // rearranged as far as one screen reaches.
  function gridEdgeScroll() {
    const d = gridDrag;
    if (!d) return;
    const box = d.body.getBoundingClientRect();
    let step = 0;
    if (d.y < box.top + GRID_EDGE) step = -GRID_EDGE_SPEED * ((box.top + GRID_EDGE - d.y) / GRID_EDGE);
    else if (d.y > box.bottom - GRID_EDGE) step = GRID_EDGE_SPEED * ((d.y - (box.bottom - GRID_EDGE)) / GRID_EDGE);
    if (step) {
      const next = clamp(d.body.scrollTop + step, 0, d.maxScroll);
      if (next !== d.body.scrollTop) {
        d.body.scrollTop = next;
        d.moved = true;
        layoutGridDrag();
      }
    }
    d.raf = requestAnimationFrame(gridEdgeScroll);
  }

  function endGridDrag() {
    const d = gridDrag;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    gridDrag = null;
    document.removeEventListener('touchmove', blockGridScroll);

    const { tile, index, target, items, cols, stepX, stepY } = d;

    // Settle into the slot it is going to occupy rather than snapping back
    // to the one it came from.
    const across = (target % cols) - (index % cols);
    const down = Math.floor(target / cols) - Math.floor(index / cols);
    tile.style.transition = `transform ${GRID_LIFT_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
    tile.style.transform = `translate(${across * stepX}px, ${down * stepY}px)`;

    if (target !== index) {
      buzz('drop');
      const [moved] = projects.splice(index, 1);
      projects.splice(target, 0, moved);
      // From here on the order is yours, and the date it was made stops
      // deciding it. New ones still arrive at the front.
      setCustomOrder();
      saveProjects();
    }

    setTimeout(() => {
      items.forEach((it) => {
        it.style.transform = '';
        it.style.transition = '';
        it.classList.remove('is-lifted');
      });
      $('home-grid').classList.remove('is-reordering');
      renderHome();
    }, GRID_LIFT_MS);
  }

  function paintCovers() {
    $('home-grid').querySelectorAll('.tile').forEach((el) => {
      const url = coverUrls.get(el.dataset.id);
      if (!url || el.querySelector('img')) return;
      const mark = el.querySelector('.brand-mark');
      if (mark) mark.remove();
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      // An image is draggable by default, and starting the browser's own
      // drag cancels the pointer stream mid-gesture — which took the tile
      // out of your hand the moment you tried to move it.
      img.draggable = false;
      el.prepend(img);
    });
  }

  /* --------------------------------------------- placing what was shared in */
  //
  // Photos came in through the share sheet with the app on the homepage, and
  // there is more than one carousel they could belong to. Rather than pick
  // one, the grid turns into the chooser: the bar says what is waiting and
  // every tile becomes a target. The hold is off while it is up — one tap,
  // one meaning.

  let pendingShare = null;

  function beginSharePick(files) {
    pendingShare = files;
    $('share-count').textContent = `Add ${plural(files.length, 'photo')} to…`;
    $('sharebar').hidden = false;
    $('home-hint').textContent = SHARE_HINT;
    document.body.classList.add('is-picking');
  }

  function endSharePick() {
    pendingShare = null;
    $('sharebar').hidden = true;
    $('home-hint').textContent = HOME_HINT;
    document.body.classList.remove('is-picking');
  }

  async function placeSharedIn(rec) {
    const files = pendingShare;
    endSharePick();
    if (!files || !rec) return;
    await openProject(rec);
    // The toast lives in the editor, which is now on screen, so it lands.
    if (!current) return;
    toast(`${plural(files.length, 'photo')} shared in`);
    await addPhotos(files);
  }

  $('share-new').addEventListener('click', () => placeSharedIn(createProject()));
  $('share-drop').addEventListener('click', () => {
    // It says Discard rather than Cancel because that is what it does: the
    // files have already been taken out of the share inbox, so backing out
    // here is the end of them.
    const n = pendingShare ? pendingShare.length : 0;
    endSharePick();
    if (!n) return;
    // The toast lives in the editor's stage, which isn't laid out here, so
    // the header line says it instead and puts itself back.
    $('home-sub').textContent = `${plural(n, 'shared photo')} discarded`;
    setTimeout(renderHome, 2600);
  });

  /* --------------------------------------------------------- press and hold */

  let detailOf = null;

  function openDetail(rec) {
    detailOf = rec;
    const url = coverUrls.get(rec.id);
    const img = $('detail-img');
    // Nothing placed yet, so there is no slide to show — the sheet is just
    // the numbers, rather than a grey rectangle pretending to be a picture.
    img.closest('.detail-cover').hidden = !url;
    if (url) img.src = url;

    $('detail-name').textContent = rec.name;
    const stats = $('detail-stats');
    stats.innerHTML = '';
    [
      ['Photos', String(rec.photos || 0)],
      ['Slides', String(rec.pages || 1)],
      ['Storage', fmtBytes(rec.bytes || 0)],
      ['Edited', agoLabel(rec.updated || rec.created || Date.now())],
    ].forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      stats.append(dt, dd);
    });

    // The confirm row says what deleting does rather than how much there is
    // of it: the counts are already listed a couple of lines above it.
    $('detail-actions').hidden = false;
    $('detail-ask').hidden = true;
    $('detail').hidden = false;
    $('detail-open').focus();
  }

  function closeDetail() {
    detailOf = null;
    $('detail').hidden = true;
  }

  $('detail').addEventListener('pointerdown', (e) => { if (e.target === $('detail')) closeDetail(); });
  $('detail-open').addEventListener('click', () => { const rec = detailOf; closeDetail(); openProject(rec); });
  $('detail-delete').addEventListener('click', () => {
    $('detail-actions').hidden = true;
    $('detail-ask').hidden = false;
    $('detail-yes').focus();
  });
  $('detail-keep').addEventListener('click', () => {
    $('detail-ask').hidden = true;
    $('detail-actions').hidden = false;
    $('detail-delete').focus();
  });
  $('detail-yes').addEventListener('click', () => {
    const rec = detailOf;
    buzz('drop');
    closeDetail();
    if (rec) deleteProject(rec);
  });

  // After the list is on screen, never before it: this is the one thing on
  // the homepage that touches the database, and it is a handful of 384px
  // thumbnails rather than anything a deck is made of.
  async function loadCovers() {
    const rows = await getAll(STORE_COVERS);
    let fresh = false;
    rows.forEach((row) => {
      if (!row.blob || coverUrls.has(row.id)) return;
      coverUrls.set(row.id, URL.createObjectURL(row.blob));
      fresh = true;
    });
    if (fresh) paintCovers();
  }

  /* ---------------------------------------------- the deck from before projects */
  //
  // One install already has a deck and a tray saved with no project around
  // them. Give them one, so an update doesn't look like everything was lost.
  // Rows with no project aren't in the index, so comparing the two counts
  // says whether there is anything to do without reading a single blob.

  async function countOf(store, indexName) {
    const d = await db();
    if (!d) return 0;
    return new Promise((resolve) => {
      try {
        const s = d.transaction(store, 'readonly').objectStore(store);
        const req = (indexName ? s.index(indexName) : s).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch { resolve(0); }
    });
  }

  async function stampOrphans(projectId, wantId) {
    const out = { photos: 0, bytes: 0, cover: null, coverId: null };
    const d = await db();
    if (!d) return out;
    await new Promise((finish) => {
      let tx;
      try { tx = d.transaction(STORE_PHOTOS, 'readwrite'); } catch { finish(); return; }
      const store = tx.objectStore(STORE_PHOTOS);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const row = cur.value;
        if (!row.project) { row.project = projectId; cur.update(row); }
        if (row.project === projectId) {
          out.photos += 1;
          out.bytes += sizeOf(row.blob) + sizeOf(row.thumb) + sizeOf(row.proxy);
          if (wantId ? row.id === wantId : !out.cover) {
            out.cover = row.thumb || row.blob;
            out.coverId = row.id;
          }
          bumpSeq(Number(String(row.id).replace(/\D/g, '')) + 1);
        }
        cur.continue();
      };
      tx.oncomplete = finish;
      tx.onerror = finish;
      tx.onabort = finish;
    });
    return out;
  }

  async function migrateLegacy() {
    let legacy = null;
    try {
      const raw = localStorage.getItem(LEGACY_DECK_KEY);
      if (raw) legacy = JSON.parse(raw);
    } catch { /* ignore */ }

    const total = await countOf(STORE_PHOTOS, null);
    const stamped = await countOf(STORE_PHOTOS, 'project');
    if (!legacy && total === stamped) return false;
    // Only worth looking at for an install old enough to have kept its deck
    // in the database rather than in localStorage.
    if (!legacy) legacy = (await getAll(STORE_META)).find((r) => r.key === 'deck') || null;

    showOpening('Grid Collage', 'Moving your work into a project…');
    let wantId = null;
    if (legacy && Array.isArray(legacy.pages)) {
      for (const p of legacy.pages) {
        const cell = (p.cells || []).find((c) => c && c.photo);
        if (cell) { wantId = cell.photo; break; }
      }
    }

    const rec = createProject('My carousel');
    const found = await stampOrphans(rec.id, wantId);
    rec.photos = found.photos;
    rec.bytes = found.bytes;
    rec.pages = (legacy && Array.isArray(legacy.pages) && legacy.pages.length) || 1;
    if (legacy) {
      try { localStorage.setItem(DECK_PREFIX + rec.id, JSON.stringify(legacy)); } catch { /* private mode */ }
    }
    try { localStorage.removeItem(LEGACY_DECK_KEY); } catch { /* private mode */ }
    if (found.cover) {
      rec.cover = found.coverId;
      put(STORE_COVERS, { id: rec.id, blob: found.cover });
      coverUrls.set(rec.id, URL.createObjectURL(found.cover));
    }
    saveProjects();
    hideOpening();
    return true;
  }

  // A library stored before proxies existed has none, so it opened the slow
  // way. Build them now, one per frame behind the first paint, and the next
  // launch is the quick one.
  async function backfillProxies(photos) {
    for (const photo of photos) {
      try {
        await new Promise((go) => requestAnimationFrame(() => setTimeout(go, 0)));
        if (!state.photos.includes(photo) || photo.proxyBlob) continue;
        const small = await shrink(photo.bitmap, PROXY_EDGE);
        photo.proxyBlob = await encode(small, 'image/jpeg', 0.86);
        if (small !== photo.bitmap) small.close();
        savePhoto(photo);
      } catch { /* it'll be tried again next launch */ }
    }
  }

  // Redraw thumbnails an earlier build left too small. Behind the first paint
  // and one at a time: the app is already usable by now and this is only
  // sharpening what is on screen, so it must not compete with it.
  async function upgradeThumbs(photos) {
    for (const photo of photos) {
      try {
        await new Promise((go) => requestAnimationFrame(() => setTimeout(go, 0)));
        if (!state.photos.includes(photo)) continue;     // removed meanwhile
        const small = await shrink(photo.bitmap, THUMB_EDGE);
        const blob = await encode(small, 'image/jpeg', 0.82);
        if (small !== photo.bitmap) small.close();
        URL.revokeObjectURL(photo.thumbUrl);
        photo.thumbBlob = blob;
        photo.thumbUrl = URL.createObjectURL(blob);
        savePhoto(photo);
      } catch { /* leave the old thumbnail in place */ }
    }
    renderPhotos();
  }

  /* ------------------------------------------------------------ undo/redo */
  //
  // Snapshots rather than commands: the deck serialises to a few kilobytes of
  // JSON, so keeping whole states is simpler than describing every edit and
  // its inverse — and it can't drift out of sync with the real state.
  //
  // Photos are held by reference, not copied. A snapshot keeps a removed
  // photo's bitmap alive so undo can put it back, and it falls out of memory
  // once the last snapshot mentioning it drops off the stack.

  const UNDO_LIMIT = 50;
  const undoStack = [];
  const redoStack = [];
  let coalesceKey = null;
  let coalesceAt = 0;

  const takeSnapshot = () => ({ deck: serialiseDeck(), photos: state.photos.slice() });

  // `key` groups a continuous interaction — a slider drag or a pinch — into
  // one undo step instead of one per frame.
  function snapshot(key = null) {
    const now = performance.now();
    if (key && key === coalesceKey && now - coalesceAt < 700) {
      coalesceAt = now;
      return;
    }
    coalesceKey = key;
    coalesceAt = now;

    undoStack.push(takeSnapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    syncHistoryButtons();
  }

  // Ends a run so the next interaction of the same kind starts a fresh step.
  const endRun = () => { coalesceKey = null; };

  function applySnapshot(snap) {
    state.photos = snap.photos.slice();
    applyDeck(snap.deck);
    state.selected = -1;
    styleRev += 1;
    reconcilePhotos();
    setBgInputs(state.bg);
    syncStyleInputs();
    refresh();
  }

  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    redoStack.push(takeSnapshot());
    applySnapshot(undoStack.pop());
    endRun();
    syncHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) { toast('Nothing to redo'); return; }
    undoStack.push(takeSnapshot());
    applySnapshot(redoStack.pop());
    endRun();
    syncHistoryButtons();
  }

  function syncHistoryButtons() {
    $('btn-undo').disabled = !undoStack.length;
    $('btn-redo').disabled = !redoStack.length;
  }

  /* --------------------------------------------------------- share target */
  //
  // Sharing photos from the gallery into the installed app lands here: the
  // service worker took the POST, put the files in a cache, and redirected
  // with ?share=N. All that's left is to collect them.

  const INBOX = 'grid-collage-share-inbox';

  async function collectShared() {
    const params = new URLSearchParams(location.search);
    if (!params.has('share') || !window.caches) return;

    // Clear the marker so a refresh doesn't look like a second share.
    history.replaceState(null, '', location.pathname);

    let cache;
    try { cache = await caches.open(INBOX); } catch { return; }

    const files = [];
    for (const key of await cache.keys()) {
      const res = await cache.match(key);
      if (!res) continue;
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-filename') || 'shared');
      files.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
      await cache.delete(key);
    }

    if (!files.length) {
      if (params.get('share') !== '0') toast("Shared photos didn't come through");
      return;
    }

    // Already in a project: that's the one you were working in, and it is the
    // only sensible answer — so no question gets asked.
    if (current) {
      toast(`${plural(files.length, 'photo')} shared in`);
      await addPhotos(files);
      return;
    }
    // Nothing to choose between: make the one project there could be.
    if (!projects.length) {
      await openProject(createProject());
      if (!current) return;
      toast(`${plural(files.length, 'photo')} shared in`);
      await addPhotos(files);
      return;
    }
    // Otherwise the grid becomes the chooser. Guessing here was the one thing
    // the share flow got wrong: opening a project to look at it counts as
    // touching it, so "the last one you edited" could be a carousel you never
    // changed — and the photos would land there without a word.
    beginSharePick(files);
  }

  // Without this the browser may evict the deck under storage pressure.
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((already) => {
        if (!already) navigator.storage.persist().catch(() => {});
      }).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ wire */

  // Before anything that can trigger a render — setBg and the sliders both
  // refresh, and a refresh with no pages throws.
  state.pages = [newPage()];

  buildLayouts();
  buildRatios();
  buildSwatches();
  setBgInputs(state.bg);
  slider('gap', 'gap');
  slider('padding', 'padding');
  slider('radius', 'radius');
  closeDrawer();

  $('quality').value = String(state.quality);
  $('format').value = state.format;
  // The three controls in the dock that a tap never lands on, so the delegated
  // tick below never reaches them: two selects and the colour well all hand
  // over to a picker of the system's own and come back with an answer. The
  // buzz belongs to the answer arriving, which is what change means on all
  // three — an input event on a colour well fires for every step of a drag
  // round the wheel, and buzzing those would be the rattle the sliders avoid.
  $('quality').addEventListener('change', (e) => { snapshot(); state.quality = Number(e.target.value); restyle(); refresh(); saveDeck(); buzz('tap'); });
  $('format').addEventListener('change', (e) => { state.format = e.target.value; saveDeck(); buzz('tap'); });
  $('bg').addEventListener('input', (e) => setBg(e.target.value));
  $('bg').addEventListener('change', () => buzz('tap'));

  // One tick for every control in the dock — drilling into a setting, picking
  // an option, stepping back out. Delegated rather than wired per button, so
  // the whole bar feels the same and nothing added later is left silent.
  //
  // Buttons only: the sliders would buzz on every frame of a drag, and the
  // reel's options already tick as they pass under the marker.
  //
  // On release rather than on touch, and only if the finger stayed put. Most
  // of these rows scroll sideways, and a tick every time you push the dock
  // along would be noise. Eighty milliseconds late is not something a thumb
  // can feel; a buzz for a gesture that wasn't a tap is.
  function buzzTaps(root) {
    let pending = null;
    root.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button');
      // Tiles are left out: they have a hold as well as a tap, and the hold
      // already buzzed when it fired. The pointerup that ends it would tick a
      // second time for a gesture that wasn't a tap at all.
      pending = btn && !btn.disabled && !btn.closest('.choose-strip') && !btn.classList.contains('tile')
        ? { btn, x: e.clientX, y: e.clientY }
        : null;
    });
    root.addEventListener('pointerup', (e) => {
      if (!pending) return;
      const still = Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 8;
      // data-buzz is how a button says it deserves something other than the
      // ordinary tick — the deleters ask for the double. Declared on the button
      // rather than wired up here, so the rule stays one delegated listener
      // however many of them there come to be.
      if (still && pending.btn.contains(e.target)) buzz(pending.btn.dataset.buzz || 'tap');
      pending = null;
    });
    root.addEventListener('pointercancel', () => { pending = null; });
  }

  buzzTaps($('dock'));
  // The library and the way into it are the same kind of control, so they get
  // the same tick — the grid scrolls, so the same tap test applies.
  buzzTaps($('photos-modal'));
  buzzTaps($('btn-photos'));
  buzzTaps($('btn-home'));
  buzzTaps(document.querySelector('.pagesbar-end'));
  buzzTaps($('installbar'));
  buzzTaps($('update-toast'));
  buzzTaps($('home'));
  buzzTaps($('detail'));

  [...$('dock-root').children].forEach((btn) => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.drawer));
  });
  $('dock-back').addEventListener('click', () => {
    // Inside a tile sub-panel, step back to the tile's actions. At the top of
    // the tile bar the cross lets go of the tile, which puts the canvas back
    // into swiping.
    if (drawer === 'tile' && tileSub) { showTileSub(null); return; }
    if (drawer === 'tile') { cancelSwap(); select(-1); return; }
    closeDrawer();
  });

  [...$('tile-actions').children].forEach((btn) => {
    btn.addEventListener('click', () => tileAction(btn.dataset.tile));
  });
  $('choose-back').addEventListener('click', () => showTileSub(null));
  $('choose-strip').addEventListener('scroll', onChooserScroll, { passive: true });
  $('choose-add').addEventListener('click', () => {
    pendingCell = null;
    importForChooser = true;
    fileInput.click();
  });
  ['start', 'end'].forEach((which) => {
    const el = $(`trim-${which}`);
    el.addEventListener('pointerdown', () => { endRun(); snapshot('trim'); trimHeld = false; });
    el.addEventListener('input', () => dragTrim(which));
    el.addEventListener('pointerup', endTrimDrag);
    el.addEventListener('change', endTrimDrag);
  });
  $('trim-reset').addEventListener('click', resetTrim);

  $('btn-flip-h').addEventListener('click', () => flipCell('x'));
  $('btn-flip-v').addEventListener('click', () => flipCell('y'));
  $('btn-rot90').addEventListener('click', () => {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot();
    cell.rot = snapAngle(cell.rot + Math.PI / 2);
    settle(state.selected);
    render();
    syncPanel();
  });
  feedback('angle');
  $('angle').addEventListener('pointerdown', () => { endRun(); snapshot('angle'); });
  $('angle').addEventListener('pointerup', endRun);
  $('angle').addEventListener('input', (e) => {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot('angle');
    cell.rot = (Number(e.target.value) * Math.PI) / 180;
    settle(state.selected);
    render();
    // Rotating raises the minimum zoom, so the zoom control has to be told —
    // it was still reading 100% while the photo sat at 141%.
    syncPanel();
  });

  $('btn-export').addEventListener('click', exportDeck);
  // A press is settled by the pointer sequence in the stage handlers, and this
  // still fires afterwards for the same tap — so it is the second caller the
  // guard in requestDeletePage exists for, not a fallback. It matters on its own
  // only for a keyboard: Enter or Space on a focused cross sends a click and no
  // pointer events at all.
  $('btn-page-x').addEventListener('click', () => {
    if (sliding) return;
    requestDeletePage();
  });
  $('btn-home').addEventListener('click', goHome);
  // New means "a new one for these" while a share is waiting to be placed.
  const startNew = () => (pendingShare ? placeSharedIn(createProject()) : openProject(createProject()));
  $('btn-new').addEventListener('click', startNew);
  $('home-first').addEventListener('click', startNew);
  $('btn-photos').addEventListener('click', openLibrary);
  $('pm-close').addEventListener('click', closeLibrary);
  $('pm-add').addEventListener('click', () => { pendingCell = null; fileInput.click(); });
  $('pm-data').addEventListener('click', showData);
  $('pm-data-hide').addEventListener('click', () => { $('pm-data-out').hidden = true; });

  $('pm-by-days').addEventListener('click', () => setGrouping({ mode: 'days' }));
  $('pm-by-events').addEventListener('click', () => setGrouping({ mode: 'events' }));
  $('pm-rule-gap').addEventListener('click', () => setGrouping({ rule: 'gap' }));
  $('pm-rule-adaptive').addEventListener('click', () => setGrouping({ rule: 'adaptive' }));
  // On input rather than change: the whole value of these is watching the
  // grouping move as the slider does, and waiting for the finger to lift
  // turns that into a guessing game.
  $('pm-split').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setGrouping(grouping.rule === 'adaptive' ? { k: v } : { spread: v });
  });
  $('pm-burst').addEventListener('input', (e) => setGrouping({ burst: Number(e.target.value) }));
  $('pm-data-copy').addEventListener('click', async () => {
    const text = $('pm-data-text').value;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      // Safari refuses the clipboard outside a few narrow circumstances, and an
      // installed app is one of the places it refuses. The text is already
      // selected in the box, so say that rather than failing silently.
      $('pm-data-text').focus();
      $('pm-data-text').select();
      toast('Selected — copy it from the box');
    }
  });
  // Tapping the dimmed area behind the card is the other way out.
  $('photos-modal').addEventListener('pointerdown', (e) => {
    if (e.target === $('photos-modal')) closeLibrary();
  });
  $('blank-add').addEventListener('click', () => { pendingCell = null; fileInput.click(); });
  $('btn-duplicate').addEventListener('click', () => {
    if (state.pages.length >= MAX_PAGES) { toast(`A carousel tops out at ${MAX_PAGES} pages`); return; }
    snapshot();
    const copy = JSON.parse(JSON.stringify({ layout: page().layout.id, cells: page().cells }));
    const pg = newPage(LAYOUTS.find((l) => l.id === copy.layout));
    pg.cells = copy.cells;
    state.pages.splice(state.current + 1, 0, pg);
    goTo(state.current + 1);
  });
  $('btn-delete-page').addEventListener('click', () => deletePage(state.current));

  feedback('zoom');
  $('zoom').addEventListener('pointerdown', () => { endRun(); snapshot('zoom'); });
  $('zoom').addEventListener('pointerup', endRun);
  $('zoom').addEventListener('input', (e) => {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot('zoom');
    cell.zoom = Number(e.target.value) / 100;
    // The label in the corner was only ever brought up to date by syncPanel,
    // which a drag never reaches, so it sat on whatever it said when the panel
    // opened. Harmless while it was the only readout; now that one rides the
    // knob it would be one number contradicting another an inch away.
    $('zoom-val').textContent = `${Math.round(Number(e.target.value))}%`;
    settle(state.selected);
    render();
  });

  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-copy').addEventListener('click', copyImage);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  window.addEventListener('keydown', (e) => {
    // Every shortcut below acts on the open deck, and on the homepage there
    // isn't one — undo and the arrow keys would be editing a hidden project.
    // The hold sheet is the exception: it only ever exists over the homepage.
    if (!current) {
      if (detailOf && e.key === 'Escape') closeDetail();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

    if (e.target.matches('input, select, textarea')) return;
    // The library sits over everything, so it takes Escape before anything
    // underneath gets a look at it.
    if (libraryOpen && e.key === 'Escape') { closeLibrary(); return; }
    if (!$('sheet').hidden && e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Escape' && swapFrom !== null) { cancelSwap(); return; }
    if (e.key === 'Escape' && drawer === 'tile' && tileSub) { showTileSub(null); return; }
    if (e.key === 'Escape' && state.selected !== -1) { select(-1); return; }
    if (e.key === 'Escape' && drawer) { closeDrawer(); return; }
    if (e.key === 'ArrowLeft' && state.selected === -1) slidePage(-1);
    if (e.key === 'ArrowRight' && state.selected === -1) slidePage(1);
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selected !== -1) {
      e.preventDefault();
      snapshot();
      page().cells[state.selected] = null;
      select(-1);
      refresh();
    }
  });

  refresh();

  // The homepage, straight away and from localStorage alone — no database, no
  // decoding, nothing to wait for. Everything that does need the database
  // happens behind it: the one-off move of a pre-projects deck, the cover
  // thumbnails, and anything that arrived through the share sheet.
  projects = loadProjects();
  // The stored list was written in whatever order the build that saved it
  // used, so put it in this one before it is drawn rather than waiting for
  // the next edit to correct it.
  sortProjects();
  // Set here as well as in the markup: embedded, the page is wrapped in a
  // <body> that isn't ours, so the class in index.html never arrives.
  document.body.classList.add('on-home');
  renderHome();
  requestPersistence();
  migrateLegacy()
    .then((moved) => { if (moved) renderHome(); })
    .catch(() => {})
    .then(collectShared);

  if (window.ResizeObserver) {
    let lastW = 0;
    let lastH = 0;
    new ResizeObserver(() => {
      const box = $('canvas-wrap');
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w || !h) return;
      if (Math.abs(w - lastW) < 8 && Math.abs(h - lastH) < 8) return;
      lastW = w;
      lastH = h;
      render();
    }).observe($('canvas-wrap'));
  }
  requestAnimationFrame(() => render());

  /* ------------------------------------------------------ install / offline */

  // An installed app can stay open for days, and the shell it is running came
  // out of the cache. A new deploy lands in that cache in the background, but
  // the copy already running is still the old one — which is why an update
  // only appeared after force-quitting. Now it says so, and offers the reload.

  let swReg = null;
  let updateDismissed = false;

  // Letting the new worker in, if one is waiting, and reloading onto it.
  let updating = false;
  function applyUpdate() {
    if (updating) return;
    updating = true;
    // A worker waiting its turn has to be let in first, and the reload goes
    // once it has taken over. With nothing waiting, the new files are already
    // in the cache and the reload is the whole of it.
    const waiting = swReg && swReg.waiting;
    if (!waiting) { location.reload(); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage({ type: 'skip-waiting' });
    // Don't sit there spinning if it never takes over.
    setTimeout(() => location.reload(), 2500);
  }

  function offerUpdate() {
    if (updateDismissed || updating) return;

    // On the homepage with no project open there is nothing to interrupt and
    // nothing on screen worth keeping, so the update is simply taken — a
    // reload from cache is under a tenth of a second and lands on the same
    // grid. Asking would be a button to dismiss a question nobody had.
    // Anywhere else, a reload would throw away where you were, so it asks.
    if (!current && document.body.classList.contains('on-home')) { applyUpdate(); return; }

    // No buzz. Every other one answers something the user just did; this one
    // would arrive unasked, and the browser blocks vibration before a first
    // tap anyway, which only puts an error in the console.
    $('update-toast').hidden = false;
  }

  // Is there actually a newer build than the one running, right now?
  //
  // index.html is what gets asked, because the stamp on its script tag is the
  // deployed version, full stop. Four kilobytes, no-store so nothing in any
  // cache can answer it, and the comparison is exact. Every route below goes
  // through this rather than offering on the strength of a service worker
  // event: a worker reinstalls whenever sw.js changes by a byte, which is not
  // the same question, and answering the wrong one is how you get an app that
  // reloads to tell you about the build it is already running.
  let lastCheck = 0;
  async function checkForNewBuild(force) {
    const now = Date.now();
    if (!force && now - lastCheck < 60 * 1000) return;
    lastCheck = now;
    try {
      const res = await fetch('./index.html', { cache: 'no-store' });
      if (!res.ok) return;
      const found = (await res.text()).match(/app\.js\?v=([^"']+)/);
      if (found && found[1] !== VERSION) offerUpdate();
    } catch { /* offline, which is not news */ }
  }

  function watchWorker(reg) {
    swReg = reg;
    // A new sw.js, installed and held back until it's asked in.
    if (reg.waiting && navigator.serviceWorker.controller) checkForNewBuild(true);
    reg.addEventListener('updatefound', () => {
      const fresh = reg.installing;
      if (!fresh) return;
      fresh.addEventListener('statechange', () => {
        // With no controller this is a first install, not an update.
        if (fresh.state === 'installed' && navigator.serviceWorker.controller) checkForNewBuild(true);
      });
    });
  }

  if ('serviceWorker' in navigator && !FRAMED && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(watchWorker).catch(() => {});
    });

    // The worker's other way of saying so: it re-fetched a core file in the
    // background and what came back was a different file. Rarely fires now
    // that those files are versioned — a stamped URL's contents never change
    // — but it still covers anything served unstamped.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'update-ready') checkForNewBuild(true);
    });

    // Coming back to a long-running installed app is the moment to look. An
    // installed app on iOS can sit there for days without navigating again —
    // switching back to it is not a launch, and nothing else would notice.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForNewBuild(false);
    });
  }

  $('ut-later').addEventListener('click', () => {
    updateDismissed = true;
    $('update-toast').hidden = true;
  });

  $('ut-now').addEventListener('click', () => {
    $('ut-now').disabled = true;
    $('ut-now').textContent = 'Updating…';
    applyUpdate();
  });

  /* --------------------------------------------------------- install banner */
  //
  // The only thing above the pages is an offer to install, and it earns its
  // row by not being there once it has been taken: installed, dismissed, or
  // never offered in the first place, and the app starts at the pages.

  const DISMISS_KEY = 'grid-collage:install-dismissed';

  // Launched from the home screen rather than a browser tab. display-mode is
  // the standard signal; navigator.standalone is the iOS one, which predates
  // it and is still what Safari answers to.
  const installed = () => window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true;

  // Room for the home indicator, and only where there is one. The first
  // version of this asked "installed, and a touch screen", which is also true
  // of Android — where the navigation bar is drawn outside the web view, so
  // nothing needs reserving and the space simply piled up under the dock.
  //
  // navigator.standalone is what separates them. It is iOS's own signal, it
  // predates display-mode, and Android has never set it — the same reason
  // installed() above has to check both.
  //
  // Which iPhone this is gets read off the device rather than assumed.
  // Dropping viewport-fit=cover stopped env() reporting any inset, but iOS
  // still takes the status bar out of the view, and how much it takes says
  // what kind of screen this is: 47 measured here on a notch, 59 on a Dynamic
  // Island, 20 on a phone with a home button — and a home button means there
  // is no indicator at the bottom to leave room for.
  //
  // Read in portrait only, and remembered. screen.height does not turn with
  // the device on iOS, so the difference means nothing on its side: a phone
  // with a home button would clear the threshold there for the wrong reason.
  // An app first opened in landscape therefore leaves no room until it is
  // turned upright once, which is the lesser mistake — landscape reserves
  // less anyway.
  let hasIndicator = false;

  function markInstalled() {
    if (navigator.standalone === true && innerHeight > innerWidth) {
      hasIndicator = screen.height - innerHeight > 21;
    }
    document.documentElement.classList.toggle('has-home-indicator', hasIndicator);
  }

  let installPrompt = null;

  function syncInstallBar() {
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* private mode */ }
    // Only offered when it can actually be accepted: no prompt in hand means
    // the browser has nothing to install, and a banner would be a dead end.
    $('installbar').hidden = !installPrompt || installed() || dismissed;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    syncInstallBar();
  });

  $('btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    syncInstallBar();
  });

  $('btn-install-x').addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    syncInstallBar();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    syncInstallBar();
  });

  // Installing while the tab is open switches it to standalone without a
  // reload on some browsers, so the bar has to notice.
  const displayQuery = window.matchMedia('(display-mode: standalone)');
  if (displayQuery.addEventListener) {
    displayQuery.addEventListener('change', syncInstallBar);
    displayQuery.addEventListener('change', markInstalled);
  }

  syncInstallBar();
  markInstalled();
})();
