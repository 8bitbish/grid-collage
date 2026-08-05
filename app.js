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
    limit: [0, 18, 45, 18],
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
    placePageX();
  }

  // The delete-page button rides the top-right corner of the page itself. The
  // canvas is sized by constraint and centred, so where that corner lands
  // depends on the deck's shape and the space available — it has to be
  // measured, not expressed as an inset.
  function placePageX() {
    const btn = $('btn-page-x');
    if (!btn) return;
    // Out of the way while a tile is selected: the dock is showing that tile's
    // own Delete, and two crosses meaning different things is one too many.
    // Out of the way mid-slide too, or it hangs over a page that's leaving.
    const hide = state.selected !== -1 || sliding || !state.photos.length;
    btn.hidden = hide;
    if (hide) return;

    const wrap = $('canvas-wrap').getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const inset = 8;
    btn.style.left = `${rect.right - wrap.left - btn.offsetWidth - inset}px`;
    btn.style.top = `${rect.top - wrap.top + inset}px`;
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
    render();
    renderFilmstrip();
    renderPhotos();
    syncPanel();
    syncEmpty();
    syncFades();
    armDwell();
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
  const TAG_ORIGINAL = 0x9003;          // when the shutter went
  const TAG_DIGITIZED = 0x9004;

  async function takenAt(file) {
    try {
      // The EXIF block sits at the very front of a JPEG; a slice is enough and
      // saves reading a 12MP file into memory to find six bytes.
      const head = await file.slice(0, 128 * 1024).arrayBuffer();
      const v = new DataView(head);
      if (v.byteLength < 16 || v.getUint16(0) !== 0xffd8) return null;   // not a JPEG

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
          if (order !== 0x4949 && order !== 0x4d4d) return null;
          const little = order === 0x4949;
          const ifd0 = readIFD(v, base, base + v.getUint32(base + 4, little),
            little, [TAG_DATETIME, TAG_EXIF_IFD]);
          if (ifd0[TAG_EXIF_IFD]) {
            const sub = readIFD(v, base, base + ifd0[TAG_EXIF_IFD], little,
              [TAG_ORIGINAL, TAG_DIGITIZED]);
            const t = exifStamp(sub[TAG_ORIGINAL] || sub[TAG_DIGITIZED] || '');
            if (t) return t;
          }
          return exifStamp(ifd0[TAG_DATETIME] || '');
        }
        p += 2 + size;
      }
    } catch { /* unreadable, or not a shape we know */ }
    return null;
  }

  // Decode once, at a sane size, and keep the ImageBitmap. Every later draw is
  // then a straight blit with no decode behind it, and what we persist is the
  // resized copy rather than the original 12MP file.
  async function ingest(blob, name) {
    const decoded = await createImageBitmap(blob);
    const bitmap = MAX_EDGE ? await shrink(decoded, MAX_EDGE) : decoded;
    const resized = bitmap !== decoded;
    if (resized) decoded.close();

    const thumbBitmap = await shrink(bitmap, THUMB_EDGE);
    const thumbBlob = await encode(thumbBitmap, 'image/jpeg', 0.82);
    if (thumbBitmap !== bitmap) thumbBitmap.close();

    const proxyBitmap = await shrink(bitmap, PROXY_EDGE);
    const proxyBlob = await encode(proxyBitmap, 'image/jpeg', 0.86);
    if (proxyBitmap !== bitmap) proxyBitmap.close();

    // Only re-encode when we actually changed the pixels. Untouched, the file
    // is persisted exactly as it arrived — no second pass through a lossy
    // encoder, whatever format it came in.
    const stored = resized ? await encode(bitmap, 'image/jpeg', 0.92) : blob;

    const taken = (await takenAt(blob)) || blob.lastModified || Date.now();

    return {
      id: uid(),
      name,
      taken,
      bitmap,
      // Just decoded it, so this one starts at full size. Only a restore
      // begins on the proxy.
      full: true,
      w: bitmap.width,
      h: bitmap.height,
      blob: stored,
      proxyBlob,
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
    renderPhotos();
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

  /* ------------------------------------------------- reading the full photo */
  //
  // A restored deck is drawn from proxies, which the preview can't be told
  // apart from the real thing. The original is read when it starts to matter:
  // you've settled on a page, you've picked up a tile to zoom into, or you're
  // exporting. Never closed once decoded — undo hands old photo records back
  // and a closed bitmap throws when drawn.

  const loadingFull = new Map();

  function ensureFull(photo) {
    if (!photo || photo.full) return Promise.resolve(false);
    if (loadingFull.has(photo.id)) return loadingFull.get(photo.id);

    const job = createImageBitmap(photo.blob).then((bitmap) => {
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
    bar.style.setProperty('--fold-left', `${$('btn-photos').offsetWidth}px`);
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

  function openLibrary() {
    libraryOpen = true;
    $('photos-modal').hidden = false;
    document.body.classList.add('is-library');
    $('btn-photos').setAttribute('aria-expanded', 'true');
    renderPhotos();
    // Straight to the way out, so Tab and a screen reader both start where the
    // eye does rather than at the far end of the grid.
    $('pm-close').focus();
  }

  function closeLibrary() {
    if (!libraryOpen) return;
    libraryOpen = false;
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
    placePageX();
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
  window.addEventListener('drop', (e) => {
    hideDropzone();
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    addPhotos(e.dataTransfer.files);
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
      // Never export a proxy. Whatever is on screen, the file that comes out
      // is rendered from the photo as it arrived.
      await Promise.all(photosOn(filled[i]).map(ensureFull));
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
      btn.textContent = ratio.label;
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
    ...['filmstrip', 'dock-root', 'layouts', 'tile-actions'].map($),
    // Not the tile panel: it deliberately overflows (its own rows scroll), so
    // measuring it would show slack that can never be scrolled away.
    ...document.querySelectorAll('.dock-panel:not(#dp-tile)'),
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
      id: photo.id, name: photo.name, taken: photo.taken,
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
    const stale = [];
    const noProxy = [];
    for (const row of rows) {
      try {
        // The proxy if there is one: a deck of twenty opens in a quarter of a
        // second on those, against seven seconds decoding the originals. The
        // full photo is read later, when something needs it.
        const bitmap = await createImageBitmap(row.proxy || row.blob);
        const photo = {
          id: row.id, name: row.name, bitmap,
          w: row.w || bitmap.width, h: row.h || bitmap.height,
          // Photos stored by an earlier build have no date on them; the file's
          // own timestamp is long gone by then, so they group under today.
          taken: row.taken || Date.now(),
          // w/h are the real photo's, not the proxy's — the cover maths works
          // in the photo's own proportions and must not change when the full
          // one swaps in.
          full: !row.proxy,
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

    if (stale.length) upgradeThumbs(stale);
    if (noProxy.length) backfillProxies(noProxy);
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
  slider('gap', 'gap');
  slider('padding', 'padding');
  slider('radius', 'radius');
  closeDrawer();

  $('quality').value = String(state.quality);
  $('format').value = state.format;
  $('quality').addEventListener('change', (e) => { snapshot(); state.quality = Number(e.target.value); restyle(); refresh(); saveDeck(); });
  $('format').addEventListener('change', (e) => { state.format = e.target.value; saveDeck(); });
  $('bg').addEventListener('input', (e) => setBg(e.target.value));

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
      pending = btn && !btn.disabled && !btn.closest('.choose-strip')
        ? { btn, x: e.clientX, y: e.clientY }
        : null;
    });
    root.addEventListener('pointerup', (e) => {
      if (!pending) return;
      const still = Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 8;
      if (still && pending.btn.contains(e.target)) buzz('tap');
      pending = null;
    });
    root.addEventListener('pointercancel', () => { pending = null; });
  }

  buzzTaps($('dock'));
  // The library and the way into it are the same kind of control, so they get
  // the same tick — the grid scrolls, so the same tap test applies.
  buzzTaps($('photos-modal'));
  buzzTaps($('btn-photos'));
  buzzTaps(document.querySelector('.pagesbar-end'));
  buzzTaps($('installbar'));
  buzzTaps($('update-toast'));

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
    // Rotating raises the minimum zoom, so the zoom control has to be told —
    // it was still reading 100% while the photo sat at 141%.
    syncPanel();
  });

  $('btn-export').addEventListener('click', exportDeck);
  $('btn-page-x').addEventListener('click', () => { buzz('drop'); deletePage(state.current); });
  $('btn-photos').addEventListener('click', openLibrary);
  $('pm-close').addEventListener('click', closeLibrary);
  $('pm-add').addEventListener('click', () => { pendingCell = null; fileInput.click(); });
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

  // An installed app can stay open for days, and the shell it is running came
  // out of the cache. A new deploy lands in that cache in the background, but
  // the copy already running is still the old one — which is why an update
  // only appeared after force-quitting. Now it says so, and offers the reload.

  let swReg = null;
  let updateDismissed = false;

  function offerUpdate() {
    if (updateDismissed) return;
    // No buzz. Every other one answers something the user just did; this one
    // would arrive unasked, and the browser blocks vibration before a first
    // tap anyway, which only puts an error in the console.
    $('update-toast').hidden = false;
  }

  function watchWorker(reg) {
    swReg = reg;
    // A new sw.js, installed and held back until it's asked in.
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate();
    reg.addEventListener('updatefound', () => {
      const fresh = reg.installing;
      if (!fresh) return;
      fresh.addEventListener('statechange', () => {
        // With no controller this is a first install, not an update.
        if (fresh.state === 'installed' && navigator.serviceWorker.controller) offerUpdate();
      });
    });
  }

  if ('serviceWorker' in navigator && !FRAMED && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(watchWorker).catch(() => {});
    });

    // The worker's other way of saying so: it re-fetched app.js or the
    // stylesheet in the background and what came back was a different file.
    // That covers a deploy where sw.js itself is byte-identical, which is most
    // of them — a browser only reinstalls a worker whose bytes changed, so
    // nothing above would fire.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'update-ready') offerUpdate();
    });

    // Coming back to a long-running installed app is the moment to look.
    let lastCheck = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !swReg) return;
      const now = Date.now();
      if (now - lastCheck < 15 * 60 * 1000) return;
      lastCheck = now;
      swReg.update().catch(() => {});
    });
  }

  $('ut-later').addEventListener('click', () => {
    updateDismissed = true;
    $('update-toast').hidden = true;
  });

  $('ut-now').addEventListener('click', () => {
    $('ut-now').disabled = true;
    $('ut-now').textContent = 'Updating…';
    // A worker waiting its turn has to be let in first, and the reload goes
    // once it has taken over. With nothing waiting, the new files are already
    // in the cache and the reload is the whole of it.
    const waiting = swReg && swReg.waiting;
    if (waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      waiting.postMessage({ type: 'skip-waiting' });
      // Don't leave the button spinning if it never takes over.
      setTimeout(() => location.reload(), 2500);
    } else {
      location.reload();
    }
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
  if (displayQuery.addEventListener) displayQuery.addEventListener('change', syncInstallBar);

  syncInstallBar();
})();
