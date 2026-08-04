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
  const imageFor = (cell) => (cell && cell.photo ? (photoById(cell.photo) || {}).img : null);

  let pendingCell = null;
  const pointers = new Map();
  let gesture = null;
  let swipe = null;
  let sheetUrl = null;
  let filmDragFrom = null;

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
  function previewSize() {
    const out = outputSize();
    const css = canvas.clientWidth;
    if (!css) return out;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(360, Math.min(out.w, Math.round(css * dpr)));
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
  function place(cell, img, rect, s) {
    const cos = Math.abs(Math.cos(cell.rot));
    const sin = Math.abs(Math.sin(cell.rot));

    const hx = (rect.w / 2) * cos + (rect.h / 2) * sin;
    const hy = (rect.w / 2) * sin + (rect.h / 2) * cos;

    const base = Math.max(rect.w / img.naturalWidth, rect.h / img.naturalHeight);
    const minZoom = Math.max(
      (2 * hx) / (img.naturalWidth * base),
      (2 * hy) / (img.naturalHeight * base),
    );
    const zoom = Math.max(cell.zoom, minZoom);

    const dw = img.naturalWidth * base * zoom;
    const dh = img.naturalHeight * base * zoom;

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
    const img = imageFor(cell);
    if (!img) return;
    const s = canvas.width / BASE_WIDTH;
    const p = place(cell, img, cellRects()[i], s);
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
      const img = imageFor(cell);

      g.save();
      roundedPath(g, rect, radius);
      g.clip();

      if (img && img.complete && img.naturalWidth) {
        const p = place(cell, img, rect, s);
        g.translate(rect.x + rect.w / 2 + p.ox, rect.y + rect.h / 2 + p.oy);
        g.rotate(cell.rot);
        g.drawImage(img, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
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
    page().dirty = true;
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

  const emptyCell = (photoId) => ({ photo: photoId, zoom: 1, rot: 0, ox: 0, oy: 0 });

  function newPage(layout = LAYOUTS[0], photoId = null) {
    const pg = { id: uid(), layout, cells: blankCells(layout), dirty: true };
    if (photoId) pg.cells[0] = emptyCell(photoId);
    return pg;
  }

  function addPage(layout) {
    if (state.pages.length >= MAX_PAGES) {
      toast(`A carousel tops out at ${MAX_PAGES} pages`);
      return false;
    }
    state.pages.push(newPage(layout));
    goTo(state.pages.length - 1);
    return true;
  }

  function deletePage(i) {
    if (state.pages.length === 1) {
      state.pages[0] = newPage();
    } else {
      state.pages.splice(i, 1);
    }
    goTo(Math.min(state.current, state.pages.length - 1));
  }

  function setLayout(layout) {
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
    render();
    renderFilmstrip();
    renderTray();
    syncPanel();
    $('pager-count').textContent = `${state.current + 1} / ${state.pages.length}`;
    $('page-count').textContent = state.pages.length;
    $('btn-prev').disabled = state.current === 0;
    $('btn-next').disabled = state.current === state.pages.length - 1;
  }

  /* ----------------------------------------------------------- photo tray */

  function addPhotos(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;

    const wasEmpty = state.photos.length === 0;
    let pending = images.length;

    images.forEach((file) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        state.photos.push({ id: uid(), img, url, name: file.name });
        if (--pending === 0) afterImport(wasEmpty);
        renderTray();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const heic = /\.hei[cf]$/i.test(file.name);
        toast(heic ? `${file.name} is HEIC — this browser can't read it` : `Couldn't read ${file.name}`);
        if (--pending === 0) afterImport(wasEmpty);
      };
      img.src = url;
    });
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
      toast('This page is full — pick a tile to replace, or add a page');
      return;
    }
    assign(target, photoId, aimed);
  }

  function removePhoto(photoId) {
    const uses = usageCount(photoId);
    state.pages.forEach((pg) => {
      pg.cells.forEach((c, i) => { if (c && c.photo === photoId) { pg.cells[i] = null; pg.dirty = true; } });
    });
    const photo = photoById(photoId);
    if (photo) URL.revokeObjectURL(photo.url);
    state.photos = state.photos.filter((p) => p.id !== photoId);
    if (uses) toast(`Removed from ${uses} tile${uses > 1 ? 's' : ''}`);
    refresh();
  }

  /* ------------------------------------------------------------- filmstrip */

  function renderFilmstrip() {
    const strip = $('filmstrip');
    strip.innerHTML = '';

    state.pages.forEach((pg, i) => {
      const el = document.createElement('div');
      el.className = 'film' + (i === state.current ? ' is-current' : '');
      el.draggable = true;
      el.title = `Page ${i + 1}`;

      const out = outputSize();
      const tw = 96;
      const th = Math.round(tw * out.h / out.w);
      const thumb = document.createElement('canvas');
      thumb.width = tw;
      thumb.height = th;
      // Placeholders on, or an empty page is indistinguishable from one
      // holding a white photo.
      drawPage(thumb.getContext('2d'), pg, tw, th, { placeholders: true });

      const num = document.createElement('span');
      num.className = 'film-num';
      num.textContent = i + 1;

      el.append(thumb, num);
      el.addEventListener('click', () => goTo(i));
      el.addEventListener('dragstart', (e) => {
        filmDragFrom = i;
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('is-dragging');
      });
      el.addEventListener('dragend', () => { filmDragFrom = null; renderFilmstrip(); });
      el.addEventListener('dragover', (e) => {
        if (filmDragFrom === null) return;
        e.preventDefault();
        el.classList.add('is-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('is-over'));
      el.addEventListener('drop', (e) => {
        if (filmDragFrom === null) return;
        e.preventDefault();
        e.stopPropagation();
        const [moved] = state.pages.splice(filmDragFrom, 1);
        state.pages.splice(i, 0, moved);
        filmDragFrom = null;
        goTo(i);
      });

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

    $('page-note').textContent = state.pages.length >= MAX_PAGES
      ? `${MAX_PAGES} of ${MAX_PAGES} — that's Instagram's limit`
      : 'drag to reorder · max 20';
  }

  /* ------------------------------------------------------------ photo tray */

  function renderTray() {
    const tray = $('tray');
    [...tray.querySelectorAll('.tray-item')].forEach((n) => n.remove());
    $('photo-count').textContent = state.photos.length;

    state.photos.forEach((photo) => {
      const el = document.createElement('div');
      const uses = usageCount(photo.id);
      el.className = 'tray-item' + (uses ? ' is-used' : '');
      el.draggable = true;
      el.title = uses ? `Used ${uses}x — drag onto a tile` : 'Not placed yet — drag onto a tile';
      el.innerHTML = `<img src="${photo.url}" alt="">`
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

    $('tray-note').textContent = state.photos.length
      ? 'drag onto a tile, or tap to place'
      : 'nothing imported yet';
  }

  /* ------------------------------------------------------------ tile panel */

  function syncPanel() {
    const i = state.selected;
    const pg = page();
    const cell = pg.cells[i];
    const img = imageFor(cell);
    const field = $('cell-field');

    // The layout highlight belongs to the page, not the selection, so it has
    // to be set before we bail out on there being no selected tile.
    [...$('layouts').children].forEach((c) => c.classList.toggle(
      'is-active', c.dataset.id === pg.layout.id,
    ));

    if (!img) { field.hidden = true; return; }
    field.hidden = false;

    const p = place(cell, img, cellRects()[i], canvas.width / BASE_WIDTH);
    const degrees = Math.round(((cell.rot * 180) / Math.PI) % 360);

    $('cell-index').textContent = `#${i + 1}`;
    $('cell-angle').textContent = `${degrees > 180 ? degrees - 360 : degrees}°`;
    $('zoom').min = Math.ceil(p.minZoom * 100);
    $('zoom').max = Math.max(800, Math.ceil(p.minZoom * 100));
    $('zoom').value = Math.round(p.zoom * 100);
  }

  function select(i) {
    state.selected = i;
    render();
    syncPanel();
  }

  function resetCell(i) {
    const cell = page().cells[i];
    if (!cell) return;
    cell.zoom = 1; cell.rot = 0; cell.ox = 0; cell.oy = 0;
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

  const mean = (pts, k) => pts.reduce((a, p) => a + p[k], 0) / pts.length;
  const spread = (pts) => Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const tilt = (pts) => Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

  const SNAP = 5 * Math.PI / 180;
  function snapAngle(a) {
    const quarter = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    return Math.abs(a - quarter) < SNAP ? quarter : a;
  }

  function rebase() {
    const i = state.selected;
    const cell = page().cells[i];
    const img = imageFor(cell);
    if (!img || !pointers.size) { gesture = null; return; }

    const s = canvas.width / BASE_WIDTH;
    const rect = cellRects()[i];
    const p = place(cell, img, rect, s);
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
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);

    // Nothing selected: the canvas belongs to the carousel, so this is a swipe.
    // Selection is the mode switch — it's visible, and one tap either way.
    if (state.selected === -1) {
      canvas.setPointerCapture(e.pointerId);
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, cell: cellAt(p.x, p.y) };
      return;
    }

    const i = cellAt(p.x, p.y);
    if (pointers.size === 0) {
      if (i !== state.selected) { select(-1); return; }
    } else if (i !== state.selected) {
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, p);
    rebase();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (swipe && e.pointerId === swipe.id) {
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe.moved = Math.max(swipe.moved, Math.abs(dx));
      // Only follow the finger once it's clearly horizontal.
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        const atEnd = (dx > 0 && state.current === 0)
          || (dx < 0 && state.current === state.pages.length - 1);
        canvas.style.transform = `translateX(${dx * (atEnd ? 0.25 : 1) * 0.4}px)`;
      }
      return;
    }

    if (!pointers.has(e.pointerId)) {
      const p = toCanvas(e);
      const over = imageFor(page().cells[cellAt(p.x, p.y)]);
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
    cell.rot = snapAngle(gesture.rot + turn);
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
      canvas.style.transform = '';
      if (Math.abs(dx) > 45) {
        goTo(state.current + (dx < 0 ? 1 : -1));
      } else if (swipe.moved < 8 && swipe.cell !== -1) {
        // A tap, not a swipe: pick up the tile, or ask for a photo for it.
        const cell = page().cells[swipe.cell];
        if (imageFor(cell)) select(swipe.cell);
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
    const img = imageFor(cell);
    if (!img) return;
    e.preventDefault();

    const s = canvas.width / BASE_WIDTH;
    const rect = cellRects()[i];
    const before = place(cell, img, rect, s);
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
        state.ratio = ratio;
        markActive(wrap, btn);
        state.pages.forEach((pg) => { pg.dirty = true; });
        refresh();
        save();
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

  function setBg(colour) {
    state.bg = colour;
    $('bg').value = colour;
    $('bg-hex').textContent = colour.toUpperCase();
    markActive($('swatches'), $('swatches').querySelector(`[data-id="${colour}"]`));
    refresh();
    save();
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
    input.addEventListener('input', () => {
      state[key] = Number(input.value);
      label.textContent = input.value;
      refresh();
      save();
    });
  }

  function setTab(name) {
    const isPage = name === 'page';
    $('panel-page').hidden = !isPage;
    $('panel-style').hidden = isPage;
    $('tab-page').classList.toggle('is-active', isPage);
    $('tab-style').classList.toggle('is-active', !isPage);
    $('tab-page').setAttribute('aria-selected', String(isPage));
    $('tab-style').setAttribute('aria-selected', String(!isPage));
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

  const SETTINGS_KEY = 'grid-collage:settings';

  function save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        ratio: state.ratio.id, gap: state.gap, padding: state.padding,
        radius: state.radius, bg: state.bg, quality: state.quality, format: state.format,
      }));
    } catch { /* private mode — settings just won't stick */ }
  }

  function restore() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { /* ignore */ }
    if (!saved) return;
    state.ratio = RATIOS.find((r) => r.id === saved.ratio) || state.ratio;
    ['gap', 'padding', 'radius', 'quality'].forEach((k) => {
      if (typeof saved[k] === 'number') state[k] = saved[k];
    });
    if (saved.bg) state.bg = saved.bg;
    if (saved.format) state.format = saved.format;
  }

  /* ------------------------------------------------------------------ wire */

  // Before anything that can trigger a render — setBg and the sliders both
  // refresh, and a refresh with no pages throws.
  state.pages = [newPage()];

  restore();
  buildLayouts();
  buildRatios();
  buildSwatches();
  setBg(state.bg);
  slider('gap', 'gap');
  slider('padding', 'padding');
  slider('radius', 'radius');
  setTab('page');

  $('quality').value = String(state.quality);
  $('format').value = state.format;
  $('quality').addEventListener('change', (e) => { state.quality = Number(e.target.value); save(); });
  $('format').addEventListener('change', (e) => { state.format = e.target.value; save(); });
  $('bg').addEventListener('input', (e) => setBg(e.target.value));

  $('tab-page').addEventListener('click', () => setTab('page'));
  $('tab-style').addEventListener('click', () => setTab('style'));

  $('btn-export').addEventListener('click', exportDeck);
  $('btn-add-photos').addEventListener('click', () => { pendingCell = null; fileInput.click(); });
  $('btn-prev').addEventListener('click', () => goTo(state.current - 1));
  $('btn-next').addEventListener('click', () => goTo(state.current + 1));
  $('btn-duplicate').addEventListener('click', () => {
    if (state.pages.length >= MAX_PAGES) { toast(`A carousel tops out at ${MAX_PAGES} pages`); return; }
    const copy = JSON.parse(JSON.stringify({ layout: page().layout.id, cells: page().cells }));
    const pg = newPage(LAYOUTS.find((l) => l.id === copy.layout));
    pg.cells = copy.cells;
    state.pages.splice(state.current + 1, 0, pg);
    goTo(state.current + 1);
  });
  $('btn-delete-page').addEventListener('click', () => deletePage(state.current));

  $('zoom').addEventListener('input', (e) => {
    const cell = page().cells[state.selected];
    if (!cell) return;
    cell.zoom = Number(e.target.value) / 100;
    settle(state.selected);
    render();
  });
  $('btn-remove').addEventListener('click', () => {
    page().cells[state.selected] = null;
    select(-1);
    refresh();
  });
  $('btn-recenter').addEventListener('click', () => resetCell(state.selected));
  $('btn-replace').addEventListener('click', () => { pendingCell = state.selected; fileInput.click(); });

  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-copy').addEventListener('click', copyImage);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (!$('sheet').hidden && e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Escape' && state.selected !== -1) { select(-1); return; }
    if (e.key === 'ArrowLeft' && state.selected === -1) goTo(state.current - 1);
    if (e.key === 'ArrowRight' && state.selected === -1) goTo(state.current + 1);
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selected !== -1) {
      e.preventDefault();
      page().cells[state.selected] = null;
      select(-1);
      refresh();
    }
  });

  refresh();

  if (window.ResizeObserver) {
    let last = 0;
    new ResizeObserver(() => {
      const w = canvas.clientWidth;
      if (!w || Math.abs(w - last) < 8) return;
      last = w;
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
