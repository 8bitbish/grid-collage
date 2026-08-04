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
  const DRAG_TYPE = 'application/x-collage-photo';

  // A phone photo is ~12MP; the largest tile we ever draw is 2160px. Decoding
  // at full size costs memory and draw time for detail that can't survive the
  // downscale, so photos are resized once on the way in.
  const MAX_EDGE = 2560;
  const THUMB_EDGE = 160;

  /* --------------------------------------------------------------- state */

  const state = {
    // deck-wide
    ratio: RATIOS[0],
    gap: 24,
    padding: 24,
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

  let nextId = 1;
  const uid = () => `id${nextId++}`;

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = $('file-input');

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
  // dropping it, a page turning, an angle clicking square, hitting a limit.
  const BUZZ = {
    pick: 10,
    drop: 14,
    snap: 6,
    turn: 5,
    limit: [0, 18, 45, 18],
  };
  function buzz(kind) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(BUZZ[kind] || 8); } catch { /* device said no */ }
  }

  let pendingCell = null;
  let importForChooser = false;
  const pointers = new Map();
  let gesture = null;
  let swipe = null;
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

  // Hands the post's shape to CSS so the preview container can hold it.
  function publishRatio() {
    document.documentElement.style.setProperty(
      '--post-ratio', `${state.ratio.w} / ${state.ratio.h}`,
    );
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
        g.drawImage(photo.bitmap, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
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

  const emptyCell = (photoId) => ({ photo: photoId, zoom: 1, rot: 0, ox: 0, oy: 0, flipX: false, flipY: false });

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
    publishRatio();
    render();
    renderFilmstrip();
    renderTray();
    syncPanel();
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

  // Decode once, at a sane size, and keep the ImageBitmap. Every later draw is
  // then a straight blit with no decode behind it, and what we persist is the
  // resized copy rather than the original 12MP file.
  async function ingest(blob, name) {
    const decoded = await createImageBitmap(blob);
    const bitmap = await shrink(decoded, MAX_EDGE);
    const resized = bitmap !== decoded;
    if (resized) decoded.close();

    const thumbBitmap = await shrink(bitmap, THUMB_EDGE);
    const thumbBlob = await encode(thumbBitmap, 'image/jpeg', 0.8);
    if (thumbBitmap !== bitmap) thumbBitmap.close();

    // Only re-encode when we actually changed the pixels — a JPEG that was
    // already small enough can be persisted exactly as it arrived.
    const stored = !resized && blob.type === 'image/jpeg'
      ? blob
      : await encode(bitmap, 'image/jpeg', 0.92);

    return {
      id: uid(),
      name,
      bitmap,
      w: bitmap.width,
      h: bitmap.height,
      blob: stored,
      thumbUrl: URL.createObjectURL(thumbBlob),
      thumbBlob,
    };
  }

  async function addPhotos(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name));
    if (!images.length) return;

    const wasEmpty = state.photos.length === 0;
    if (images.length > 2) toast(`Importing ${images.length} photos…`);

    // A few at a time: all 20 at once spikes memory with 12MP decodes, one at
    // a time leaves the decoder idle between photos.
    const queue = [...images];
    const results = new Array(images.length);
    const worker = async () => {
      while (queue.length) {
        const index = images.length - queue.length;
        const file = queue.shift();
        try {
          results[index] = await ingest(file, file.name);
        } catch {
          const heic = /\.hei[cf]$/i.test(file.name) || file.type === 'image/heic';
          toast(heic
            ? `${file.name} is HEIC — this browser can't decode it`
            : `Couldn't read ${file.name}`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    // Added in the order they were chosen, whatever order they finished in.
    if (results.some(Boolean)) snapshot();
    results.filter(Boolean).forEach((photo) => {
      state.photos.push(photo);
      savePhoto(photo);
    });
    renderTray();
    requestPersistence();
    if (importForChooser) {
      // Added to choose between, so don't go dropping them into other tiles.
      importForChooser = false;
      renderChooser();
      refresh();
      return;
    }
    afterImport(wasEmpty);
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

    reorder = { el, index, target: index, startX, items, step, strip };
    strip.classList.add('is-reordering');
    el.classList.add('is-lifted');
    el.style.transition = 'none';
  }

  function dragReorder(x) {
    const { el, index, items, step, strip } = reorder;
    const dx = x - reorder.startX;
    el.style.transform = `translateX(${dx}px) scale(1.08)`;

    // Nudge the strip along when dragging against either end of it.
    const box = strip.getBoundingClientRect();
    if (x > box.right - 44) strip.scrollLeft += 8;
    else if (x < box.left + 44) strip.scrollLeft -= 8;

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
    const { el, index, target, step, items, strip } = reorder;
    reorder = null;
    document.removeEventListener('touchmove', blockScroll);

    // Settle into the gap rather than snapping back to the old slot.
    el.style.transition = `transform ${LIFT_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
    el.style.transform = `translateX(${(target - index) * step}px) scale(1)`;
    el.classList.remove('is-lifted');

    setTimeout(() => {
      strip.classList.remove('is-reordering');
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

    state.pages.forEach((pg, i) => {
      const el = document.createElement('div');
      el.className = 'film' + (i === state.current ? ' is-current' : '');
      el.draggable = true;
      el.title = `Page ${i + 1}`;

      // Thumbnails are cached on the page and only redrawn when that page or
      // the deck style actually changed. Redrawing all 20 on every refresh
      // cost 78ms per page change.
      const out = outputSize();
      const tw = 96;
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
    add.title = 'Add a page';
    add.disabled = state.pages.length >= MAX_PAGES;
    add.addEventListener('click', () => addPage(LAYOUTS[0]) && refresh());
    strip.appendChild(add);

  }

  /* ------------------------------------------------------------ photo tray */

  function renderTray() {
    const tray = $('tray');
    [...tray.querySelectorAll('.tray-item')].forEach((n) => n.remove());
    $('dock-photos-count').textContent = state.photos.length || '';

    state.photos.forEach((photo) => {
      const el = document.createElement('div');
      const uses = usageCount(photo.id);
      el.className = 'tray-item' + (uses ? ' is-used' : '');
      el.draggable = true;
      el.title = uses ? `Used ${uses}x — drag onto a tile` : 'Not placed yet — drag onto a tile';
      el.innerHTML = `<img src="${photo.thumbUrl}" alt="" loading="lazy">`
        + (uses ? `<span class="tray-badge">${uses}</span>` : '')
        + '<button class="tray-x" type="button" aria-label="Remove photo">&times;</button>';

      el.addEventListener('click', (e) => {
        if (e.target.closest('.tray-x')) { removePhoto(photo.id); return; }
        placePhoto(photo.id);
      });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(DRAG_TYPE, photo.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      tray.insertBefore(el, $('btn-add-photos'));
    });

  }

  /* ------------------------------------------------------------ tile panel */

  function syncPanel() {
    const i = state.selected;
    const pg = page();
    const cell = pg.cells[i];
    const photo = photoFor(cell);

    // The layout highlight belongs to the page, not the selection, so it has
    // to be set before we bail out on there being no selected tile.
    [...$('layouts').children].forEach((c) => c.classList.toggle(
      'is-active', c.dataset.id === pg.layout.id,
    ));

    if (!photo) {
      if (drawer === 'tile') closeDrawer();
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
  }

  function select(i) {
    state.selected = i;
    render();
    syncPanel();
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
  const reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

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
  }

  // delta: +1 for the next page, -1 for the previous.
  function slidePage(delta) {
    const target = state.current + delta;
    if (sliding) return;
    if (target < 0 || target >= state.pages.length) { setTrack(0, true); return; }

    preparePeek();
    sliding = true;
    buzz('turn');
    setTrack(-delta * slideStep(), true);
    setTimeout(() => {
      // Reset the track and paint the new page in the same frame, so the
      // hand-off from the peek canvas to the real one isn't visible.
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

  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);

    // Nothing selected: the canvas belongs to the carousel, so this is a swipe.
    // Selection is the mode switch — it's visible, and one tap either way.
    if (state.selected === -1) {
      if (sliding) return;
      canvas.setPointerCapture(e.pointerId);
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
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, p);
    rebase();
  });

  canvas.addEventListener('pointermove', (e) => {
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
    if (swipe && e.pointerId === swipe.id) {
      const dx = e.clientX - swipe.x;

      // A quick flick should turn the page even if it didn't travel far, so
      // decide on velocity as well as distance.
      const first = swipe.samples[0];
      const last = swipe.samples[swipe.samples.length - 1];
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
  canvas.addEventListener('pointerup', liftPointer);
  canvas.addEventListener('pointercancel', liftPointer);

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

  canvas.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  canvas.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toCanvas(e);
    const i = cellAt(p.x, p.y);
    if (i !== -1) assign(i, id);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    addPhotos(e.dataTransfer.files);
  });

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

  async function exportDeck() {
    const filled = state.pages.filter((pg) => pg.cells.some(Boolean));
    if (!filled.length) { toast('Add a photo first'); return; }

    const ext = state.format === 'image/png' ? 'png' : 'jpg';
    const out = outputSize();
    const skipped = state.pages.length - filled.length;
    toast(skipped
      ? `Rendering ${filled.length} page${filled.length > 1 ? 's' : ''} — skipping ${skipped} empty`
      : `Rendering ${filled.length} page${filled.length > 1 ? 's' : ''}…`);

    const files = [];
    for (let i = 0; i < filled.length; i++) {
      const blob = await renderToBlob(filled[i], state.format);
      if (!blob) continue;
      // Instagram imports by filename, so the order has to be in the name.
      files.push(new File([blob], `${String(i + 1).padStart(2, '0')}.${ext}`, { type: state.format }));
    }
    if (!files.length) { toast("Couldn't render the pages"); return; }

    // Share sheet takes the whole carousel at once and lands it in Photos.
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: 'Carousel' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    if (FRAMED) {
      // Downloads are blocked in an embedded frame; offer the current page.
      const url = URL.createObjectURL(files[Math.min(state.current, files.length - 1)]);
      openSheet(url, files[0].name, `${out.w}×${out.h}`, ext.toUpperCase());
      toast('Embedded preview can only save one page at a time');
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
    toast(`Saving ${files.length} page${files.length > 1 ? 's' : ''} as ${out.w}×${out.h} ${ext.toUpperCase()}`);
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
      btn.addEventListener('click', () => setLayout(layout));
      wrap.appendChild(btn);
    });
  }

  function buildRatios() {
    const wrap = $('ratios');
    RATIOS.forEach((ratio) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = ratio.label;
      btn.dataset.id = ratio.id;
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
    });
    $('quality').value = String(state.quality);
    $('format').value = state.format;
  }

  function markActive(wrap, btn) {
    [...wrap.children].forEach((c) => c.classList.remove('is-active'));
    if (btn) btn.classList.add('is-active');
  }

  function slider(id, key) {
    const input = $(id);
    const label = $(`${id}-val`);
    input.value = state[key];
    label.textContent = state[key];
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
  const DRAWERS = ['photos', 'layout', 'shape', 'gap', 'padding', 'corners',
    'background', 'page', 'export', 'tile'];
  let drawer = null;

  // Which sub-panel of the tile drawer is showing, and the tile waiting to be
  // swapped with another.
  let tileSub = null;
  let swapFrom = null;

  function showTileSub(name) {
    tileSub = name;
    $('tile-actions').hidden = !!name;
    ['zoom', 'rotate', 'flip', 'replace'].forEach((n) => { $(`tile-${n}`).hidden = n !== name; });

    // Choosing a photo wants room: the pages bar steps aside and the dock
    // takes two rows, so the options are large enough to judge at a glance.
    const choosing = name === 'replace';
    document.querySelector('.app').classList.toggle('is-choosing', choosing);
    $('dock').classList.toggle('is-choosing', choosing);
    if (choosing) renderChooser();
    // Page thumbnails aren't visible while choosing, so they catch up on the
    // way out rather than being redrawn for every photo scrolled past.
    else if (centred !== -1) { centred = -1; renderFilmstrip(); }
    setBackIcon();
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
      el.innerHTML = `<img src="${photo.thumbUrl}" alt="">`;
      // Tapping doesn't apply directly — it brings that photo to the middle,
      // and the middle is what counts.
      el.addEventListener('click', () => scrollChooserTo(i, true));
      strip.appendChild(el);
    });

    // Open on whatever the tile already holds.
    const start = Math.max(0, state.photos.findIndex((p) => cell && p.id === cell.photo));
    centred = start;
    markCentred(start);
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
    if (!photo || !cell || cell.photo === photo.id) return;
    // One undo step for a run through the reel, not one per photo passed.
    snapshot('choose');
    // A fresh crop each time, so flicking between options compares like
    // with like rather than inheriting the last photo's framing.
    page().cells[i] = emptyCell(photo.id);
    render();
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
  }

  /* ------------------------------------------------------------------ misc */

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  /* --------------------------------------------------------- persistence */
  //
  // An installed app is expected to still be there when you reopen it, and a
  // 20-page deck is far too much work to lose to a relaunch. Photos live in
  // IndexedDB as resized blobs; the deck is a small JSON record beside them.

  const DB_NAME = 'grid-collage';
  const STORE_PHOTOS = 'photos';
  const STORE_META = 'meta';
  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_PHOTOS)) d.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META, { keyPath: 'key' });
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
    persisted.add(photo.id);
    put(STORE_PHOTOS, {
      id: photo.id, name: photo.name, blob: photo.blob, thumb: photo.thumbBlob, w: photo.w, h: photo.h,
    });
  }

  async function dropPhoto(id) {
    const d = await db();
    if (!d) return;
    d.transaction(STORE_PHOTOS, 'readwrite').objectStore(STORE_PHOTOS).delete(id);
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
          flipX: !!c.flipX, flipY: !!c.flipY,
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
  const DECK_KEY = 'grid-collage:deck';

  // Nothing is written until the saved deck has been read back. The first
  // refresh happens during start-up, and without this it would overwrite the
  // stored deck with the blank one before restore ever got to look at it.
  let restored = false;

  function saveDeck() {
    if (!restored) return;
    try {
      localStorage.setItem(DECK_KEY, JSON.stringify(serialiseDeck()));
    } catch { /* private mode or quota — the deck just won't come back */ }
  }

  function loadDeck() {
    try {
      const raw = localStorage.getItem(DECK_KEY);
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

  async function restoreAll() {
    // localStorage is where the deck lives now; the IndexedDB record is only
    // read so a deck saved by the previous build isn't stranded.
    const saved = loadDeck() || (await getAll(STORE_META)).find((r) => r.key === 'deck');
    if (saved) {
      state.ratio = RATIOS.find((r) => r.id === saved.ratio) || state.ratio;
      ['gap', 'padding', 'radius', 'quality'].forEach((k) => {
        if (typeof saved[k] === 'number') state[k] = saved[k];
      });
      if (saved.bg) state.bg = saved.bg;
      if (saved.format) state.format = saved.format;
    }

    const rows = await getAll(STORE_PHOTOS);
    for (const row of rows) {
      try {
        const bitmap = await createImageBitmap(row.blob);
        state.photos.push({
          id: row.id, name: row.name, bitmap, w: row.w || bitmap.width, h: row.h || bitmap.height,
          blob: row.blob, thumbBlob: row.thumb, thumbUrl: URL.createObjectURL(row.thumb || row.blob),
        });
        persisted.add(row.id);
        // Keep the id counter clear of anything we just restored.
        const n = Number(String(row.id).replace(/\D/g, ''));
        if (n >= nextId) nextId = n + 1;
      } catch { /* unreadable row — skip it */ }
    }

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
    const placed = state.pages.filter((pg) => pg.cells.some(Boolean)).length;
    if (placed) toast(`Picked up where you left off — ${placed} page${placed > 1 ? 's' : ''}`);
    restyle();
    setBgInputs(state.bg);
    syncStyleInputs();
    refresh();
    // A restore isn't an edit, so it starts with a clean history.
    undoStack.length = 0;
    redoStack.length = 0;
    syncHistoryButtons();
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
    toast(`${files.length} photo${files.length > 1 ? 's' : ''} shared in`);
    await addPhotos(files);
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
  publishRatio();
  slider('gap', 'gap');
  slider('padding', 'padding');
  slider('radius', 'radius');
  closeDrawer();

  $('quality').value = String(state.quality);
  $('format').value = state.format;
  $('quality').addEventListener('change', (e) => { snapshot(); state.quality = Number(e.target.value); restyle(); refresh(); saveDeck(); });
  $('format').addEventListener('change', (e) => { state.format = e.target.value; saveDeck(); });
  $('bg').addEventListener('input', (e) => setBg(e.target.value));

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
  $('angle').addEventListener('pointerdown', () => { endRun(); snapshot('angle'); });
  $('angle').addEventListener('pointerup', endRun);
  $('angle').addEventListener('input', (e) => {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot('angle');
    cell.rot = (Number(e.target.value) * Math.PI) / 180;
    settle(state.selected);
    render();
    $('cell-angle').textContent = `${Math.round(Number(e.target.value))}°`;
  });

  $('btn-export').addEventListener('click', exportDeck);
  $('btn-add-photos').addEventListener('click', () => { pendingCell = null; fileInput.click(); });
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

  $('zoom').addEventListener('pointerdown', () => { endRun(); snapshot('zoom'); });
  $('zoom').addEventListener('pointerup', endRun);
  $('zoom').addEventListener('input', (e) => {
    const cell = page().cells[state.selected];
    if (!cell) return;
    snapshot('zoom');
    cell.zoom = Number(e.target.value) / 100;
    settle(state.selected);
    render();
  });

  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-copy').addEventListener('click', copyImage);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

    if (e.target.matches('input, select, textarea')) return;
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
  // Restore first, so anything shared in is added to the deck you left behind.
  restoreAll().then(collectShared);

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

  if ('serviceWorker' in navigator && !FRAMED && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('btn-install').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('btn-install').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('btn-install').hidden = true;
  });
})();
