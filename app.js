/* Grid Collage — drop photos into a grid, export one image for Instagram.
   No build step, no dependencies: everything renders into a single canvas at
   export resolution, so what you see is exactly what downloads. */

(() => {
  'use strict';

  /* ---------------------------------------------------------- definitions */

  // Layouts are described in grid units. `cells` is optional — without it we
  // generate a plain cols × rows grid.
  const LAYOUTS = [
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

  // Slider values are authored against a 1080px-wide post and scaled from there.
  const BASE_WIDTH = 1080;

  /* --------------------------------------------------------------- state */

  const state = {
    layout: LAYOUTS[2],
    ratio: RATIOS[0],
    gap: 24,
    padding: 24,
    radius: 0,
    bg: '#ffffff',
    quality: 1080,
    format: 'image/jpeg',
    cells: [],
    selected: -1,
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const fileInput = $('file-input');

  let pendingCell = null;         // cell index a file picker was opened for
  const pointers = new Map();     // pointerId -> canvas-space position
  let gesture = null;             // baseline for the in-flight pan/pinch/twist
  let thumbDragFrom = null;       // index within the filled-cell list

  /* ------------------------------------------------------------ geometry */

  const layoutCells = (layout) =>
    layout.cells || Array.from({ length: layout.cols * layout.rows }, (_, i) => ({
      x: i % layout.cols, y: Math.floor(i / layout.cols), w: 1, h: 1,
    }));

  function outputSize() {
    const w = state.quality;
    return { w, h: Math.round(w * state.ratio.h / state.ratio.w) };
  }

  // The preview only needs enough pixels to look sharp on screen. Rendering it
  // at the full export size made every drag frame cost 33ms at 2160px; there's
  // no point pushing 4.6M pixels to fill an 800px box.
  function previewSize() {
    const out = outputSize();
    const css = canvas.clientWidth;
    if (!css) return out;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(360, Math.min(out.w, Math.round(css * dpr)));
    return { w, h: Math.round(w * out.h / out.w) };
  }

  // Pixel rect of every cell, in whatever resolution the canvas is currently
  // sized to — preview while editing, full size during an export render.
  function cellRects() {
    const W = canvas.width;
    const H = canvas.height;
    const s = W / BASE_WIDTH;
    const gap = state.gap * s;
    const pad = state.padding * s;
    const { cols, rows } = state.layout;

    const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const ch = (H - pad * 2 - gap * (rows - 1)) / rows;

    return layoutCells(state.layout).map((c) => ({
      x: pad + c.x * (cw + gap),
      y: pad + c.y * (ch + gap),
      w: c.w * cw + (c.w - 1) * gap,
      h: c.h * ch + (c.h - 1) * gap,
    }));
  }

  function cellAt(px, py) {
    return cellRects().findIndex(
      (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
    );
  }

  // Where the photo lands inside its cell, honouring zoom, rotation and pan but
  // never letting the background show through at the edges.
  //
  // Rotation is what makes this non-obvious. An axis-aligned clamp is wrong the
  // moment the photo is turned: the cell's corners escape it. So measure the
  // cell's half-extents in the *photo's* frame (hx, hy) and clamp the pan there.
  // That also tells us the smallest zoom the angle can be drawn at — 45° on a
  // square needs 1.414x — so rotating pushes the zoom up rather than tearing a
  // hole in the tile.
  //
  // Offsets are stored in BASE_WIDTH units, like gap and padding, so framing
  // survives a change of preview or export resolution.
  function place(cell, rect, s) {
    const img = cell.img;
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

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Write the clamped result back, so the next gesture starts from what's on
  // screen rather than from a value the clamp has been quietly overriding.
  function settle(i) {
    const cell = state.cells[i];
    if (!cell || !cell.img) return;
    const s = canvas.width / BASE_WIDTH;
    const p = place(cell, cellRects()[i], s);
    cell.ox = p.ox / s;
    cell.oy = p.oy / s;
    cell.zoom = p.zoom;
  }

  /* --------------------------------------------------------------- render */

  function render(forExport = false) {
    const { w: W, h: H } = forExport ? outputSize() : previewSize();
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, W, H);

    const s = W / BASE_WIDTH;
    const radius = state.radius * s;
    const rects = cellRects();

    rects.forEach((rect, i) => {
      const cell = state.cells[i];
      ctx.save();
      roundedPath(rect, radius);
      ctx.clip();

      if (cell && cell.img) {
        const p = place(cell, rect, s);
        ctx.translate(rect.x + rect.w / 2 + p.ox, rect.y + rect.h / 2 + p.oy);
        ctx.rotate(cell.rot);
        ctx.drawImage(cell.img, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
      } else if (!forExport) {
        ctx.fillStyle = 'rgba(125,125,145,0.16)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        plusSign(rect, s);
      }
      ctx.restore();

      if (!forExport && i === state.selected) {
        ctx.save();
        ctx.strokeStyle = '#ff4d8d';
        ctx.lineWidth = Math.max(2, 4 * s);
        roundedPath(rect, radius);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  function roundedPath(r, radius) {
    const rad = Math.min(radius, r.w / 2, r.h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, rad);
    else ctx.rect(r.x, r.y, r.w, r.h);
  }

  function plusSign(r, s) {
    const arm = Math.min(r.w, r.h) * 0.09;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.strokeStyle = 'rgba(140,140,165,0.75)';
    ctx.lineWidth = 3 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
    ctx.stroke();
  }

  /* ----------------------------------------------------------- photo I/O */

  function syncCellCount() {
    const n = layoutCells(state.layout).length;
    const kept = state.cells.filter(Boolean);
    state.cells = Array.from({ length: n }, (_, i) => kept[i] || null);
    if (state.selected >= n) state.selected = -1;
  }

  function loadFiles(files, startIndex) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;

    // Work out a slot per file up front — the loads are async, so we can't
    // rely on the array itself to tell us what's still free.
    const taken = new Set(state.cells.reduce((acc, c, i) => (c ? [...acc, i] : acc), []));
    const targets = images.map((_, n) => {
      if (n === 0 && startIndex != null && startIndex < state.cells.length) {
        taken.add(startIndex);
        return startIndex;
      }
      for (let i = 0; i < state.cells.length; i++) {
        if (!taken.has(i)) { taken.add(i); return i; }
      }
      return null;
    });

    const overflow = targets.filter((t) => t === null).length;
    if (overflow) toast(`${overflow} photo${overflow > 1 ? 's' : ''} didn't fit — pick a bigger layout`);

    images.forEach((file, i) => {
      const index = targets[i];
      if (index === null) return;
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const previous = state.cells[index];
        if (previous && previous.url) URL.revokeObjectURL(previous.url);
        state.cells[index] = { img, url, zoom: 1, rot: 0, ox: 0, oy: 0 };
        if (state.selected === -1 || state.selected === index) select(index);
        render();
        renderStrip();
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast(`Couldn't read ${file.name}`); };
      img.src = url;
    });
  }

  function removeCell(i) {
    const cell = state.cells[i];
    if (cell && cell.url) URL.revokeObjectURL(cell.url);
    state.cells[i] = null;
    if (state.selected === i) select(-1);
    render();
    renderStrip();
  }

  /* ------------------------------------------------------------- controls */

  function buildLayouts() {
    const wrap = $('layouts');
    LAYOUTS.forEach((layout) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'layout-btn';
      btn.title = layout.id;
      btn.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
      btn.style.gridTemplateRows = `repeat(${layout.rows}, 1fr)`;
      layoutCells(layout).forEach((c) => {
        const s = document.createElement('span');
        s.style.gridArea = `${c.y + 1} / ${c.x + 1} / span ${c.h} / span ${c.w}`;
        btn.appendChild(s);
      });
      btn.addEventListener('click', () => {
        state.layout = layout;
        syncCellCount();
        markActive(wrap, btn);
        render();
        renderStrip();
        save();
      });
      btn.dataset.id = layout.id;
      wrap.appendChild(btn);
    });
    markActive(wrap, wrap.querySelector(`[data-id="${state.layout.id}"]`));
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
        render();
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
    const wrap = $('swatches');
    markActive(wrap, wrap.querySelector(`[data-id="${colour}"]`));
    render();
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
      render();
      save();
    });
  }

  /* -------------------------------------------------------------- selection */

  function select(i) {
    state.selected = i;
    syncCellPanel();
    renderStrip();
  }

  // Shows the effective transform — the zoom a rotation has forced is real, so
  // the slider has to show it and can't be allowed below it.
  function syncCellPanel() {
    const i = state.selected;
    const cell = state.cells[i];
    const field = $('cell-field');
    if (!cell || !cell.img) { field.hidden = true; return; }

    field.hidden = false;
    const p = place(cell, cellRects()[i], canvas.width / BASE_WIDTH);
    const degrees = Math.round(((cell.rot * 180) / Math.PI) % 360);

    $('cell-index').textContent = `#${i + 1}`;
    $('cell-angle').textContent = `${degrees > 180 ? degrees - 360 : degrees}°`;
    $('zoom').min = Math.ceil(p.minZoom * 100);
    $('zoom').max = Math.max(800, Math.ceil(p.minZoom * 100));
    $('zoom').value = Math.round(p.zoom * 100);
  }

  function resetCell(i) {
    const cell = state.cells[i];
    if (!cell || !cell.img) return;
    cell.zoom = 1;
    cell.rot = 0;
    cell.ox = 0;
    cell.oy = 0;
    render();
    syncCellPanel();
  }

  /* ------------------------------------------------------------- thumbnails */

  function renderStrip() {
    const strip = $('strip');
    strip.innerHTML = '';
    const filled = state.cells
      .map((cell, index) => ({ cell, index }))
      .filter((c) => c.cell && c.cell.img);

    $('photo-count').textContent = filled.length;

    if (!filled.length) {
      strip.innerHTML = '<p class="strip-empty">No photos yet — drop some anywhere on the page.</p>';
      return;
    }

    filled.forEach(({ cell, index }, pos) => {
      const el = document.createElement('div');
      el.className = 'thumb' + (index === state.selected ? ' is-selected' : '');
      el.draggable = true;
      el.title = `Tile ${index + 1} — drag to reorder`;
      el.innerHTML = `<img src="${cell.url}" alt=""><span class="thumb-num">${index + 1}</span>`;

      el.addEventListener('click', () => { select(index); render(); });
      el.addEventListener('dragstart', () => { thumbDragFrom = pos; el.classList.add('is-dragging'); });
      el.addEventListener('dragend', () => { thumbDragFrom = null; renderStrip(); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('is-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('is-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (thumbDragFrom === null || thumbDragFrom === pos) return;
        const order = filled.map((f) => f.cell);
        const [moved] = order.splice(thumbDragFrom, 1);
        order.splice(pos, 0, moved);
        filled.forEach((f, i) => { state.cells[f.index] = order[i]; });
        select(-1);
        render();
        renderStrip();
      });

      strip.appendChild(el);
    });
  }

  /* --------------------------------------------------------- canvas input */

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

  // Within 5° of square, take the square — free-rotating a photo to 89.6°
  // is never what anyone meant.
  const SNAP = 5 * Math.PI / 180;
  function snapAngle(a) {
    const quarter = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    return Math.abs(a - quarter) < SNAP ? quarter : a;
  }

  // Re-baseline the gesture against the fingers currently down. Called on every
  // touch down and up, so adding or lifting a finger mid-gesture continues from
  // where the photo actually is instead of jumping.
  function rebase() {
    const i = state.selected;
    const cell = state.cells[i];
    if (!cell || !cell.img || !pointers.size) { gesture = null; return; }

    const s = canvas.width / BASE_WIDTH;
    const rect = cellRects()[i];
    const p = place(cell, rect, s);
    const pts = [...pointers.values()];

    gesture = {
      i,
      s,
      ids: [...pointers.keys()],
      ax: mean(pts, 'x'),
      ay: mean(pts, 'y'),
      spread: pts.length > 1 ? spread(pts) : 0,
      tilt: pts.length > 1 ? tilt(pts) : 0,
      // Where the photo's centre sits right now, and the transform behind it.
      cx: rect.x + rect.w / 2 + p.ox,
      cy: rect.y + rect.h / 2 + p.oy,
      zoom: p.zoom,
      rot: cell.rot,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const i = cellAt(p.x, p.y);

    if (pointers.size === 0) {
      if (i === -1) { select(-1); render(); return; }
      const cell = state.cells[i];
      select(i);
      render();
      if (!cell || !cell.img) {
        pendingCell = i;
        fileInput.click();
        return;
      }
    } else if (i !== state.selected) {
      // A second finger outside the tile being edited isn't part of the gesture.
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, p);
    rebase();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      const p = toCanvas(e);
      const cell = state.cells[cellAt(p.x, p.y)];
      canvas.style.cursor = cell && cell.img ? 'grab' : 'pointer';
      return;
    }

    pointers.set(e.pointerId, toCanvas(e));
    if (!gesture) return;

    const pts = gesture.ids.filter((id) => pointers.has(id)).map((id) => pointers.get(id));
    if (pts.length !== gesture.ids.length) return;

    // One finger pans. Two also pinch and twist.
    let scale = 1;
    let turn = 0;
    if (pts.length > 1) {
      scale = spread(pts) / (gesture.spread || 1);
      turn = tilt(pts) - gesture.tilt;
    }

    const cell = state.cells[gesture.i];
    cell.rot = snapAngle(gesture.rot + turn);
    cell.zoom = clamp(gesture.zoom * scale, 1, 8);

    // Carry the photo's centre through the same similarity transform the
    // fingers described, so the image tracks the pinch instead of the cell.
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
    syncCellPanel();
  }, { passive: false });

  const liftPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture) settle(gesture.i);
    if (pointers.size) {
      rebase();
    } else {
      gesture = null;
      canvas.style.cursor = 'grab';
      syncCellPanel();
    }
  };
  canvas.addEventListener('pointerup', liftPointer);
  canvas.addEventListener('pointercancel', liftPointer);

  canvas.addEventListener('wheel', (e) => {
    const p = toCanvas(e);
    const i = cellAt(p.x, p.y);
    const cell = state.cells[i];
    if (!cell || !cell.img) return;
    e.preventDefault();

    const s = canvas.width / BASE_WIDTH;
    const rect = cellRects()[i];
    const before = place(cell, rect, s);
    const scale = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    cell.zoom = clamp(before.zoom * scale, 1, 8);

    // Zoom towards the cursor rather than the middle of the tile.
    const cx = rect.x + rect.w / 2 + before.ox;
    const cy = rect.y + rect.h / 2 + before.oy;
    cell.ox = (p.x + (cx - p.x) * scale - (rect.x + rect.w / 2)) / s;
    cell.oy = (p.y + (cy - p.y) * scale - (rect.y + rect.h / 2)) / s;

    settle(i);
    render();
    if (state.selected === i) syncCellPanel();
  }, { passive: false });

  // Two-finger pinch on iOS Safari zooms the page unless we say otherwise —
  // touch-action alone doesn't stop it.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    canvas.addEventListener(type, (e) => e.preventDefault());
  });

  canvas.addEventListener('dblclick', () => resetCell(state.selected));

  /* ------------------------------------------------------------ drag & drop */

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    dragDepth += 1;
    $('dropzone').hidden = false;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropzone').hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0;
    $('dropzone').hidden = true;
    let target = null;
    if (e.target === canvas) {
      const p = toCanvas(e);
      const i = cellAt(p.x, p.y);
      if (i !== -1) target = i;
    }
    loadFiles(e.dataTransfer.files, target);
  });

  fileInput.addEventListener('change', () => {
    loadFiles(fileInput.files, pendingCell);
    pendingCell = null;
    fileInput.value = '';
  });

  /* ---------------------------------------------------------------- export */

  // When the page is embedded, the frame is usually sandboxed without
  // `allow-downloads` and a link click is silently swallowed — so we never
  // claim a save we can't make, and fall back to a sheet you can save from.
  const FRAMED = (() => { try { return window.self !== window.top; } catch { return true; } })();

  // Renders without the selection outline, then restores the preview.
  function exportBlob(type) {
    render(true);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => { render(); resolve(blob); }, type, 0.92);
    });
  }

  let sheetUrl = null;

  async function download() {
    if (!state.cells.some((c) => c && c.img)) { toast('Add a photo first'); return; }

    const blob = await exportBlob(state.format);
    if (!blob) { toast("Couldn't render the image"); return; }

    const ext = state.format === 'image/png' ? 'png' : 'jpg';
    const name = `grid-collage-${state.layout.id}-${state.ratio.id.replace(':', 'x')}.${ext}`;
    // From outputSize, not the canvas — by now it's been restored to preview size.
    const out = outputSize();
    const size = `${out.w}×${out.h}`;

    // The share sheet is the only route to the camera roll on iOS, and it
    // survives sandboxing when the frame allows web-share.
    const file = new File([blob], name, { type: state.format });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Grid collage' }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }

    const url = URL.createObjectURL(blob);
    if (!FRAMED) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      // Firefox only honours a click on an anchor that's in the document, and
      // revoking straight away can cancel the download mid-flight.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(`Saved ${size} ${ext.toUpperCase()}`);
      return;
    }

    openSheet(url, name, size, ext);
  }

  function openSheet(url, name, size, ext) {
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
    sheetUrl = url;
    $('sheet-img').src = url;
    $('sheet-size').textContent = `${size} ${ext.toUpperCase()}`;
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
      // The clipboard only accepts PNG, whatever the chosen export format.
      const png = await exportBlob('image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Copied to clipboard');
    } catch {
      toast('Copying was blocked — save the image instead');
    }
  }

  /* ---------------------------------------------------------------- misc UI */

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
  }

  const SETTINGS_KEY = 'grid-collage:settings';

  function save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        layout: state.layout.id, ratio: state.ratio.id, gap: state.gap,
        padding: state.padding, radius: state.radius, bg: state.bg,
        quality: state.quality, format: state.format,
      }));
    } catch { /* private mode — settings just won't stick */ }
  }

  function restore() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { /* ignore */ }
    if (!saved) return;
    state.layout = LAYOUTS.find((l) => l.id === saved.layout) || state.layout;
    state.ratio = RATIOS.find((r) => r.id === saved.ratio) || state.ratio;
    ['gap', 'padding', 'radius', 'quality'].forEach((k) => {
      if (typeof saved[k] === 'number') state[k] = saved[k];
    });
    if (saved.bg) state.bg = saved.bg;
    if (saved.format) state.format = saved.format;
  }

  /* ------------------------------------------------------------------ wire */

  restore();
  buildLayouts();
  buildRatios();
  buildSwatches();
  setBg(state.bg);
  slider('gap', 'gap');
  slider('padding', 'padding');
  slider('radius', 'radius');
  syncCellCount();

  $('quality').value = String(state.quality);
  $('format').value = state.format;

  $('bg').addEventListener('input', (e) => setBg(e.target.value));
  $('quality').addEventListener('change', (e) => { state.quality = Number(e.target.value); render(); save(); });
  $('format').addEventListener('change', (e) => { state.format = e.target.value; save(); });
  $('btn-export').addEventListener('click', download);
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-copy').addEventListener('click', copyImage);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

  $('zoom').addEventListener('input', (e) => {
    const cell = state.cells[state.selected];
    if (!cell) return;
    cell.zoom = Number(e.target.value) / 100;
    settle(state.selected);
    render();
  });

  $('btn-remove').addEventListener('click', () => removeCell(state.selected));
  $('btn-recenter').addEventListener('click', () => resetCell(state.selected));
  $('btn-replace').addEventListener('click', () => { pendingCell = state.selected; fileInput.click(); });

  $('btn-clear').addEventListener('click', () => {
    state.cells.forEach((c, i) => c && removeCell(i));
    select(-1);
    render();
    renderStrip();
  });

  $('btn-shuffle').addEventListener('click', () => {
    const filled = state.cells.map((c, i) => ({ c, i })).filter((x) => x.c && x.c.img);
    const pool = filled.map((x) => x.c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    filled.forEach((x, i) => { state.cells[x.i] = pool[i]; });
    select(-1);
    render();
    renderStrip();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selected !== -1) {
      e.preventDefault();
      removeCell(state.selected);
    }
    if (e.key === 'Escape') {
      if (!$('sheet').hidden) { closeSheet(); return; }
      select(-1);
      render();
    }
  });

  render();
  renderStrip();

  // The preview is sized from its box on screen, so it has to be redrawn when
  // that box changes. Re-render once more after first layout, when the canvas
  // finally has a measurable width.
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

  // Skip when embedded — there's no sw.js alongside a bundled copy of the page.
  if ('serviceWorker' in navigator && !FRAMED && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Offline support just won't be available; the app still works.
      });
    });
  }

  // Chrome and Edge let us trigger the install prompt ourselves. Safari has no
  // equivalent — there it's Share > Add to Home Screen.
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
