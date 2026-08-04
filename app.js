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

  let pendingCell = null;   // cell index a file picker was opened for
  let drag = null;          // active pan gesture
  let thumbDragFrom = null; // index within the filled-cell list

  /* ------------------------------------------------------------ geometry */

  const layoutCells = (layout) =>
    layout.cells || Array.from({ length: layout.cols * layout.rows }, (_, i) => ({
      x: i % layout.cols, y: Math.floor(i / layout.cols), w: 1, h: 1,
    }));

  function outputSize() {
    const w = state.quality;
    return { w, h: Math.round(w * state.ratio.h / state.ratio.w) };
  }

  // Pixel rect of every cell in the current layout, at export resolution.
  function cellRects() {
    const { w: W, h: H } = outputSize();
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

  // Where the photo lands inside its cell, honouring zoom and pan but never
  // letting the cell show through at the edges.
  function drawRect(cell, rect) {
    const base = Math.max(rect.w / cell.img.naturalWidth, rect.h / cell.img.naturalHeight);
    const scale = base * cell.zoom;
    const dw = cell.img.naturalWidth * scale;
    const dh = cell.img.naturalHeight * scale;
    const limitX = Math.max(0, (dw - rect.w) / 2);
    const limitY = Math.max(0, (dh - rect.h) / 2);
    const ox = clamp(cell.ox, -limitX, limitX);
    const oy = clamp(cell.oy, -limitY, limitY);
    return { x: rect.x + (rect.w - dw) / 2 + ox, y: rect.y + (rect.h - dh) / 2 + oy, w: dw, h: dh, limitX, limitY };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* --------------------------------------------------------------- render */

  function render(forExport = false) {
    const { w: W, h: H } = outputSize();
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, W, H);

    const radius = state.radius * (W / BASE_WIDTH);
    const rects = cellRects();

    rects.forEach((rect, i) => {
      const cell = state.cells[i];
      ctx.save();
      roundedPath(rect, radius);
      ctx.clip();

      if (cell && cell.img) {
        const d = drawRect(cell, rect);
        ctx.drawImage(cell.img, d.x, d.y, d.w, d.h);
      } else if (!forExport) {
        ctx.fillStyle = 'rgba(125,125,145,0.16)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        plusSign(rect, W / BASE_WIDTH);
      }
      ctx.restore();

      if (!forExport && i === state.selected) {
        ctx.save();
        ctx.strokeStyle = '#ff4d8d';
        ctx.lineWidth = Math.max(2, 4 * (W / BASE_WIDTH));
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
        state.cells[index] = { img, url, zoom: 1, ox: 0, oy: 0 };
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
    const cell = state.cells[i];
    const field = $('cell-field');
    if (!cell || !cell.img) {
      field.hidden = true;
    } else {
      field.hidden = false;
      $('cell-index').textContent = `#${i + 1}`;
      $('zoom').value = Math.round(cell.zoom * 100);
    }
    renderStrip();
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

  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const i = cellAt(p.x, p.y);
    if (i === -1) { select(-1); render(); return; }

    const cell = state.cells[i];
    select(i);
    render();

    if (!cell || !cell.img) {
      pendingCell = i;
      fileInput.click();
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    drag = { i, startX: p.x, startY: p.y, ox: cell.ox, oy: cell.oy };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const p = toCanvas(e);
      const i = cellAt(p.x, p.y);
      const cell = state.cells[i];
      canvas.style.cursor = cell && cell.img ? 'grab' : 'pointer';
      return;
    }
    const p = toCanvas(e);
    const cell = state.cells[drag.i];
    cell.ox = drag.ox + (p.x - drag.startX);
    cell.oy = drag.oy + (p.y - drag.startY);
    canvas.style.cursor = 'grabbing';
    render();
  });

  const endDrag = () => {
    if (!drag) return;
    // Persist the clamped values so the next drag starts from what's on screen.
    const cell = state.cells[drag.i];
    const rect = cellRects()[drag.i];
    const d = drawRect(cell, rect);
    cell.ox = clamp(cell.ox, -d.limitX, d.limitX);
    cell.oy = clamp(cell.oy, -d.limitY, d.limitY);
    drag = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    const p = toCanvas(e);
    const i = cellAt(p.x, p.y);
    const cell = state.cells[i];
    if (!cell || !cell.img) return;
    e.preventDefault();
    cell.zoom = clamp(cell.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 4);
    if (state.selected === i) $('zoom').value = Math.round(cell.zoom * 100);
    render();
  }, { passive: false });

  canvas.addEventListener('dblclick', () => {
    const cell = state.cells[state.selected];
    if (!cell) return;
    cell.zoom = 1; cell.ox = 0; cell.oy = 0;
    $('zoom').value = 100;
    render();
  });

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

  function download() {
    if (!state.cells.some((c) => c && c.img)) { toast('Add a photo first'); return; }
    render(true);
    const ext = state.format === 'image/png' ? 'png' : 'jpg';
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grid-collage-${state.layout.id}-${state.ratio.id.replace(':', 'x')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      render();
      toast(`Saved ${canvas.width}×${canvas.height} ${ext.toUpperCase()}`);
    }, state.format, 0.92);
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

  $('zoom').addEventListener('input', (e) => {
    const cell = state.cells[state.selected];
    if (!cell) return;
    cell.zoom = Number(e.target.value) / 100;
    render();
  });

  $('btn-remove').addEventListener('click', () => removeCell(state.selected));
  $('btn-recenter').addEventListener('click', () => {
    const cell = state.cells[state.selected];
    if (!cell) return;
    cell.zoom = 1; cell.ox = 0; cell.oy = 0;
    $('zoom').value = 100;
    render();
  });
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
    if (e.key === 'Escape') { select(-1); render(); }
  });

  render();
  renderStrip();
})();
