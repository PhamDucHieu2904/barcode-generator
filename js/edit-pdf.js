/* ══════════════════════════════════════════════
   edit-pdf.js — Edit PDF module
   Depends on: pdf-lib (global PDFLib), utils.js
   Features:
   - Drop single PDF → render each page as thumbnail
   - Drag images or extra PDFs onto the drop zone to append pages
   - Drag-to-reorder / × remove pages
   - Click a page thumbnail → open canvas editor
   - Add text / image objects via buttons
   - Select objects → move, resize, delete
   - Text objects: inline edit, font/size/weight/color controls
   - Change paper size (A4v, A4h, A3v, A3h, None)
   - Rotate selected page or all pages
   - Download final PDF
   ══════════════════════════════════════════════ */

/* ────────────────────────────────────────────
   GOOGLE FONTS (20 popular fonts)
   ──────────────────────────────────────────── */
const EDIT_FONTS = [
  'Arial','Helvetica','Georgia','Times New Roman','Courier New',
  'Roboto','Open Sans','Lato','Montserrat','Raleway',
  'Oswald','Playfair Display','Merriweather','Nunito','Poppins',
  'Source Sans Pro','Ubuntu','PT Serif','Quicksand','Josefin Sans'
];

/* Inject Google Fonts link */
(function injectGoogleFonts() {
  const webFonts = EDIT_FONTS
    .filter(f => !['Arial','Helvetica','Georgia','Times New Roman','Courier New'].includes(f))
    .map(f => f.replace(/ /g, '+'))
    .join('|');
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${webFonts.split('|').map(f=>`${f}:wght@400;700`).join('&family=')}&display=swap`;
  document.head.appendChild(link);
})();

/* ────────────────────────────────────────────
   PAPER SIZE PRESETS (in PDF points: 72 dpi)
   ──────────────────────────────────────────── */
const PAPER_SIZES = {
  none:  null,
  a4v:   { w: 595,  h: 842  },
  a4h:   { w: 842,  h: 595  },
  a3v:   { w: 842,  h: 1191 },
  a3h:   { w: 1191, h: 842  },
};

/* ────────────────────────────────────────────
   STATE
   ──────────────────────────────────────────── */
let editPages        = [];   // [{ id, pdfBytes (null for appended images), rotation, widthPt, heightPt, overlayObjects:[] }]
let editSelectedPage = null; // id of the page being edited in the canvas
let editPdfOrigBytes = null; // raw ArrayBuffer of the original PDF (first drop)
let editDragSrcId    = null;
let editSelectedObj  = null; // currently selected canvas object id

/* canvas-editor scale factor (canvas px / pdf pts) */
let editorScale = 1;

/* ────────────────────────────────────────────
   UNIQUE ID HELPER
   ──────────────────────────────────────────── */
function uid() { return `ep-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

/* ────────────────────────────────────────────
   INIT
   ──────────────────────────────────────────── */
function initEditPDF() {
  _bindEditDropZone();
  _bindEditButtons();
  _bindTextFormatControls();
  _renderEditThumbs();
}

/* ────────────────────────────────────────────
   DROP ZONE BINDINGS
   ──────────────────────────────────────────── */
function _bindEditDropZone() {
  const dz      = document.getElementById('dz-edit');
  const trigger = document.getElementById('dz-edit-trigger');

  // click "+" on placeholder
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    _openEditFilePicker(['application/pdf']);
  });

  // click anywhere on empty zone
  dz.addEventListener('click', e => {
    if (e.target === dz || e.target.closest('#dz-edit-placeholder')) {
      _openEditFilePicker(['application/pdf']);
    }
  });

  // drag-over / leave / drop (files from OS)
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', e => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('dragover'); });
  dz.addEventListener('drop', async e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files);
    await _handleEditFileDrop(files);
  });
}

function _openEditFilePicker(accept) {
  const input = document.createElement('input');
  input.type     = 'file';
  input.accept   = accept.join(',');
  input.multiple = accept.length > 1;
  input.addEventListener('change', async () => _handleEditFileDrop(Array.from(input.files)));
  input.click();
}

/* Hàm mới: Render trang PDF thành hình ảnh */
async function _renderPdfPageToDataURL(arrayBuffer, pageIndex) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageIndex + 1); // pdf.js dùng index từ 1
    const viewport = page.getViewport({ scale: 1.5 }); // Độ nét x1.5
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return canvas.toDataURL('image/png');
  } catch(e) {
    console.error("Lỗi render PDF:", e);
    return null;
  }
}

async function _handleEditFileDrop(files) {
  const pdfFiles   = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
  const imageFiles = files.filter(f => f.type.startsWith('image/'));

  if (!editPages.length) {
    if (!pdfFiles.length) { alert('Vui lòng kéo thả file PDF đầu tiên.'); return; }
    const file = pdfFiles[0];
    editPdfOrigBytes = await readFileAsArrayBuffer(file);
    await _loadPdfPages(editPdfOrigBytes);
  } else {
    for (const img of imageFiles) {
      const dataURL = await readFileAsDataURL(img);
      editPages.push({ id: uid(), pdfBytes: null, imageDataURL: dataURL, renderURL: dataURL, rotation: 0, widthPt: 595, heightPt: 842, overlayObjects: [] });
    }
    for (const pf of pdfFiles) {
      const bytes = await readFileAsArrayBuffer(pf);
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      for (let i = 0; i < doc.getPageCount(); i++) {
        const { width, height } = doc.getPage(i).getSize();
        const renderUrl = await _renderPdfPageToDataURL(bytes, i);
        editPages.push({ id: uid(), pdfBytes: bytes, pdfPageIndex: i, imageDataURL: null, renderURL: renderUrl, rotation: 0, widthPt: width, heightPt: height, overlayObjects: [] });
      }
    }
  }
  _renderEditThumbs();
  _updateEditPlaceholder();
}

async function _loadPdfPages(arrayBuffer) {
  const { PDFDocument } = PDFLib;
  try {
    const doc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    editPages = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const { width, height } = doc.getPage(i).getSize();
      const renderUrl = await _renderPdfPageToDataURL(arrayBuffer, i);
      editPages.push({
        id: uid(),
        pdfBytes: arrayBuffer,
        pdfPageIndex: i,
        imageDataURL: null,
        renderURL: renderUrl, // Lưu ảnh hiển thị
        rotation: 0,
        widthPt: width,
        heightPt: height,
        overlayObjects: [],
      });
    }
  } catch(e) {
    alert('Không thể đọc file PDF: ' + e.message);
  }
}

/* ────────────────────────────────────────────
   THUMBNAIL RENDERING
   ──────────────────────────────────────────── */
function _updateEditPlaceholder() {
  const ph = document.getElementById('dz-edit-placeholder');
  if (ph) ph.classList.toggle('hidden', editPages.length > 0);
}

async function _renderEditThumbs() {
  const thumbsEl = document.getElementById('dz-edit-thumbs');
  if (!thumbsEl) return;
  thumbsEl.innerHTML = '';
  _updateEditPlaceholder();

  for (let idx = 0; idx < editPages.length; idx++) {
    const pg = editPages[idx];
    const thumb = document.createElement('div');
    thumb.className = 'dz-thumb edit-thumb';
    if (pg.id === editSelectedPage) thumb.classList.add('selected');
    thumb.dataset.id = pg.id;
    thumb.draggable  = true;

    // Thumbnail image
    const imgEl = document.createElement('img');
    imgEl.alt = `Trang ${idx + 1}`;
    imgEl.style.transform = `rotate(${pg.rotation}deg)`;

    // Render thumbnail using canvas + pdf.js-style approach
    const canvas = document.createElement('canvas');
    canvas.width  = 76;
    canvas.height = 76;
    const ctx = canvas.getContext('2d');

    // Bên trong hàm _renderEditThumbs, thay thế đoạn vẽ canvas thành:
    if (pg.renderURL) {
      // Dùng ảnh đã render (dành cho cả PDF và Ảnh)
      await new Promise(res => {
        const img2 = new Image();
        img2.onload = () => {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, 76, 76);
          const s = Math.min(76 / img2.width, 76 / img2.height);
          const dw = img2.width * s, dh = img2.height * s;
          ctx.drawImage(img2, (76-dw)/2, (76-dh)/2, dw, dh);
          res();
        };
        img2.src = pg.renderURL;
      });
    } else {
      // Dự phòng nếu lỗi render
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(6, 6, 64, 64);
      ctx.fillStyle = '#777';
      ctx.font = 'bold 10px Arial';
      ctx.fillText(`Trang ${pg.pdfPageIndex + 1}`, 38, 42);
    }

    imgEl.src = canvas.toDataURL();
    thumb.appendChild(imgEl);

    // Page number badge
    const badge = document.createElement('span');
    badge.className = 'dz-page-num';
    badge.textContent = idx + 1;
    thumb.appendChild(badge);

    // Remove button
    const rmBtn = document.createElement('button');
    rmBtn.className = 'dz-remove';
    rmBtn.title     = 'Xóa trang';
    rmBtn.innerHTML = '&times;';
    rmBtn.addEventListener('click', e => {
      e.stopPropagation();
      editPages = editPages.filter(p => p.id !== pg.id);
      if (editSelectedPage === pg.id) { editSelectedPage = null; _clearEditor(); }
      _renderEditThumbs();
    });
    thumb.appendChild(rmBtn);

    // Click to select page for editing
    thumb.addEventListener('click', e => {
      if (e.target === rmBtn) return;
      editSelectedPage = pg.id;
      _renderEditThumbs();
      _openPageEditor(pg);
    });

    // Drag to reorder
    _bindEditThumbDrag(thumb, pg.id);

    thumbsEl.appendChild(thumb);
  }
}

function _bindEditThumbDrag(thumbEl, id) {
  thumbEl.addEventListener('dragstart', e => {
    editDragSrcId = id;
    thumbEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    e.stopPropagation(); // don't trigger drop zone handler
  });
  thumbEl.addEventListener('dragend', () => {
    thumbEl.classList.remove('dragging');
    document.querySelectorAll('.edit-thumb').forEach(t => t.classList.remove('drag-over'));
  });
  thumbEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    if (editDragSrcId !== id) thumbEl.classList.add('drag-over');
  });
  thumbEl.addEventListener('dragleave', () => thumbEl.classList.remove('drag-over'));
  thumbEl.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    thumbEl.classList.remove('drag-over');
    if (editDragSrcId && editDragSrcId !== id) {
      const fi = editPages.findIndex(p => p.id === editDragSrcId);
      const ti = editPages.findIndex(p => p.id === id);
      if (fi >= 0 && ti >= 0) {
        const [moved] = editPages.splice(fi, 1);
        editPages.splice(ti, 0, moved);
        _renderEditThumbs();
      }
    }
  });
}

/* ────────────────────────────────────────────
   PAGE EDITOR (canvas-based)
   ──────────────────────────────────────────── */
function _clearEditor() {
  const area = document.getElementById('edit-canvas-area');
  if (area) {
    area.innerHTML = '<div class="edit-empty-hint">Chọn một trang để chỉnh sửa</div>';
  }
  editSelectedObj = null;
  _updateTextControls(null);
}

function _openPageEditor(pg) {
  const area = document.getElementById('edit-canvas-area');
  if (!area) return;
  area.innerHTML = '';
  editSelectedObj = null;

  // Determine displayed size (fit inside edit area keeping aspect ratio)
  const areaW = area.clientWidth  || 600;
  const areaH = area.clientHeight || 700;
  let   w = pg.widthPt, h = pg.heightPt;
  const scale = Math.min((areaW - 32) / w, (areaH - 32) / h, 1.5);
  editorScale = scale;

  const canvasW = Math.round(w * scale);
  const canvasH = Math.round(h * scale);

  // Page container
  const pageEl = document.createElement('div');
  pageEl.id        = 'edit-page-canvas';
  pageEl.className = 'edit-page-canvas';
  pageEl.style.width  = canvasW + 'px';
  pageEl.style.height = canvasH + 'px';
  pageEl.style.transform = `rotate(${pg.rotation}deg)`;

  // Background layer (white page + optional image)
  const bgLayer = document.createElement('div');
  bgLayer.className = 'edit-bg-layer';
  bgLayer.style.width  = '100%';
  bgLayer.style.height = '100%';

if (pg.renderURL) {
    const bgImg = document.createElement('img');
    bgImg.src   = pg.renderURL;
    bgImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    bgLayer.appendChild(bgImg);
  } else {
    bgLayer.style.background = '#fff';
    const hint = document.createElement('div');
    hint.className = 'edit-page-hint';
    hint.textContent = `PDF — Trang ${(pg.pdfPageIndex ?? 0) + 1}`;
    bgLayer.appendChild(hint);
  }

  pageEl.appendChild(bgLayer);

  // Overlay objects layer
  const overlayEl = document.createElement('div');
  overlayEl.className = 'edit-overlay';
  overlayEl.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  pageEl.appendChild(overlayEl);

  // Re-render existing overlay objects
  pg.overlayObjects.forEach(obj => _renderOverlayObject(obj, overlayEl, pg));

  // Click on empty area → deselect
  pageEl.addEventListener('mousedown', e => {
    if (e.target === pageEl || e.target === bgLayer || e.target === overlayEl) {
      _deselectAll(pg);
    }
  });

  area.appendChild(pageEl);

  // Store reference
  area._currentPg    = pg;
  area._overlayEl    = overlayEl;
}

/* ── Render an overlay object ── */
function _renderOverlayObject(obj, overlayEl, pg) {
  // Remove existing element if any
  const existing = overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.dataset.objId = obj.id;
  el.className = 'edit-obj' + (obj.selected ? ' selected' : '');
  el.style.cssText = `
    position:absolute;
    left:${obj.x}px;
    top:${obj.y}px;
    width:${obj.w}px;
    height:${obj.h}px;
    box-sizing:border-box;
    cursor:move;
    user-select:none;
  `;

  if (obj.type === 'text') {
    el.classList.add('edit-obj-text');
    const textDiv = document.createElement('div');
    textDiv.className = 'edit-obj-textcontent';
    textDiv.contentEditable = 'false';
    textDiv.textContent = obj.content || 'Text';
    textDiv.style.cssText = `
      font-family: "${obj.fontFamily || 'Arial'}", sans-serif;
      font-size: ${obj.fontSize || 16}px;
      font-weight: ${obj.fontWeight || 'normal'};
      color: ${obj.color || '#000000'};
      width:100%;
      height:100%;
      outline:none;
      overflow:hidden;
      word-break:break-word;
      white-space:pre-wrap;
      pointer-events:none;
    `;
    el.appendChild(textDiv);

    // Double-click to edit text inline
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      textDiv.contentEditable = 'true';
      textDiv.style.pointerEvents = 'all';
      textDiv.focus();
      const range = document.createRange();
      range.selectNodeContents(textDiv);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    textDiv.addEventListener('blur', () => {
      obj.content = textDiv.textContent;
      textDiv.contentEditable = 'false';
      textDiv.style.pointerEvents = 'none';
    });
    textDiv.addEventListener('keydown', e => e.stopPropagation());

  } else if (obj.type === 'image') {
    el.classList.add('edit-obj-image');
    const img = document.createElement('img');
    img.src = obj.dataURL || '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
    el.appendChild(img);
  }

  // ── Select on click ──
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.obj-btn') || e.target.contentEditable === 'true') return;
    e.stopPropagation();
    _selectObject(obj, pg);
  });

  // ── Control buttons (only visible when selected) ──
  if (obj.selected) {
    // Delete button (top-right)
    const delBtn = document.createElement('button');
    delBtn.className = 'obj-btn obj-btn-del';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Xóa';
    delBtn.addEventListener('mousedown', e => {
      e.stopPropagation();
      pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== obj.id);
      el.remove();
      editSelectedObj = null;
      _updateTextControls(null);
    });
    el.appendChild(delBtn);

    // Drag handle (top-left)
    const dragHandle = document.createElement('button');
    dragHandle.className = 'obj-btn obj-btn-drag';
    dragHandle.innerHTML = '⠿';
    dragHandle.title = 'Di chuyển';
    _bindObjectMove(el, obj, dragHandle);
    el.appendChild(dragHandle);

    // Resize handles on 4 edges (N, S, W, E) + corner (SE)
    const handles = [
      { cls:'rh-n',  cursor:'n-resize',  dir:'n'  },
      { cls:'rh-s',  cursor:'s-resize',  dir:'s'  },
      { cls:'rh-w',  cursor:'w-resize',  dir:'w'  },
      { cls:'rh-e',  cursor:'e-resize',  dir:'e'  },
      { cls:'rh-se', cursor:'nwse-resize', dir:'se' },
    ];
    handles.forEach(h => {
      const rh = document.createElement('div');
      rh.className = `obj-resize-handle ${h.cls}`;
      rh.style.cursor = h.cursor;
      _bindResizeHandle(el, obj, rh, h.dir);
      el.appendChild(rh);
    });
  } else {
    // Move by dragging the object body when not in selected state
    _bindObjectMove(el, obj, el);
  }

  overlayEl.appendChild(el);
}

/* ── Select ── */
function _selectObject(obj, pg) {
  pg.overlayObjects.forEach(o => o.selected = false);
  obj.selected = true;
  editSelectedObj = obj.id;
  _refreshOverlay(pg);
  _updateTextControls(obj);
}

function _deselectAll(pg) {
  pg.overlayObjects.forEach(o => o.selected = false);
  editSelectedObj = null;
  _refreshOverlay(pg);
  _updateTextControls(null);
}

function _refreshOverlay(pg) {
  const area = document.getElementById('edit-canvas-area');
  if (!area || area._currentPg !== pg) return;
  const overlayEl = area._overlayEl;
  if (!overlayEl) return;
  overlayEl.innerHTML = '';
  pg.overlayObjects.forEach(o => _renderOverlayObject(o, overlayEl, pg));
}

/* ── Drag to move ── */
function _bindObjectMove(el, obj, handleEl) {
  let startX, startY, startOX, startOY;
  handleEl.addEventListener('mousedown', e => {
    if (e.target.closest('.obj-btn-del') || e.target.closest('.obj-resize-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    startX  = e.clientX;
    startY  = e.clientY;
    startOX = obj.x;
    startOY = obj.y;

    function onMove(e2) {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      obj.x = Math.max(0, startOX + dx);
      obj.y = Math.max(0, startOY + dy);
      el.style.left = obj.x + 'px';
      el.style.top  = obj.y + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

/* ── Resize handle ── */
function _bindResizeHandle(el, obj, handleEl, dir) {
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = obj.w, startH = obj.h, startOX = obj.x, startOY = obj.y;
    const MIN = 20;

    function onMove(e2) {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      if (dir === 'se') {
        obj.w = Math.max(MIN, startW + dx);
        obj.h = Math.max(MIN, startH + dy);
      } else if (dir === 'e') {
        obj.w = Math.max(MIN, startW + dx);
      } else if (dir === 'w') {
        const nw = Math.max(MIN, startW - dx);
        obj.x  = startOX + (startW - nw);
        obj.w  = nw;
      } else if (dir === 's') {
        obj.h = Math.max(MIN, startH + dy);
      } else if (dir === 'n') {
        const nh = Math.max(MIN, startH - dy);
        obj.y  = startOY + (startH - nh);
        obj.h  = nh;
      }
      el.style.width  = obj.w + 'px';
      el.style.height = obj.h + 'px';
      el.style.left   = obj.x + 'px';
      el.style.top    = obj.y + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

/* ────────────────────────────────────────────
   BUTTONS: Add Text / Add Image
   ──────────────────────────────────────────── */
function _bindEditButtons() {
  document.getElementById('edit-btn-text').addEventListener('click', () => {
    const pg = _getCurrentPg();
    if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
    const obj = {
      id: uid(), type: 'text',
      x: Math.round(pg.widthPt  * editorScale * 0.3),
      y: Math.round(pg.heightPt * editorScale * 0.4),
      w: 200, h: 60,
      content: 'Nhập text tại đây',
      fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal', color: '#000000',
      selected: false,
    };
    pg.overlayObjects.push(obj);
    _selectObject(obj, pg);
  });

  document.getElementById('edit-btn-image').addEventListener('click', () => {
    const pg = _getCurrentPg();
    if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const dataURL = await readFileAsDataURL(file);
      const obj = {
        id: uid(), type: 'image',
        x: Math.round(pg.widthPt  * editorScale * 0.2),
        y: Math.round(pg.heightPt * editorScale * 0.2),
        w: 200, h: 150,
        dataURL,
        selected: false,
      };
      pg.overlayObjects.push(obj);
      _selectObject(obj, pg);
    });
    input.click();
  });

  // Paper size change
  document.getElementById('edit-papersize').addEventListener('change', e => {
    const pg = _getCurrentPg();
    const preset = PAPER_SIZES[e.target.value];
    if (!preset || !pg) return;
    pg.widthPt  = preset.w;
    pg.heightPt = preset.h;
    _openPageEditor(pg); // re-render with new size
  });

  // Rotate selected page
  document.getElementById('edit-rotate-page').addEventListener('click', () => {
    const pg = _getCurrentPg();
    if (!pg) return;
    pg.rotation = ((pg.rotation || 0) + 90) % 360;
    _openPageEditor(pg);
    _renderEditThumbs();
  });

  document.getElementById('edit-rotate-page-ccw').addEventListener('click', () => {
    const pg = _getCurrentPg();
    if (!pg) return;
    pg.rotation = ((pg.rotation || 0) - 90 + 360) % 360;
    _openPageEditor(pg);
    _renderEditThumbs();
  });

  // Rotate all pages
  document.getElementById('edit-rotate-all').addEventListener('click', () => {
    editPages.forEach(p => { p.rotation = ((p.rotation || 0) + 90) % 360; });
    const pg = _getCurrentPg();
    if (pg) _openPageEditor(pg);
    _renderEditThumbs();
  });

  document.getElementById('edit-rotate-all-ccw').addEventListener('click', () => {
    editPages.forEach(p => { p.rotation = ((p.rotation || 0) - 90 + 360) % 360; });
    const pg = _getCurrentPg();
    if (pg) _openPageEditor(pg);
    _renderEditThumbs();
  });

  // Download PDF
  document.getElementById('edit-download-btn').addEventListener('click', async () => {
    const btn = document.getElementById('edit-download-btn');
    if (!editPages.length) { alert('Chưa có trang nào.'); return; }
    btn.disabled    = true;
    btn.textContent = 'Đang xử lý…';
    try {
      await _buildAndDownloadEditPDF();
    } catch(e) {
      console.error(e);
      alert('Lỗi: ' + e.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Download PDF';
    }
  });
}

/* ── Text format controls ── */
function _bindTextFormatControls() {
  ['edit-font', 'edit-fontsize', 'edit-fontstyle', 'edit-fontcolor'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input',  () => _applyTextFormat());
    el.addEventListener('change', () => _applyTextFormat());
  });
}

function _applyTextFormat() {
  if (!editSelectedObj) return;
  const pg = _getCurrentPg();
  if (!pg) return;
  const obj = pg.overlayObjects.find(o => o.id === editSelectedObj);
  if (!obj || obj.type !== 'text') return;

  const font      = document.getElementById('edit-font');
  const size      = document.getElementById('edit-fontsize');
  const style     = document.getElementById('edit-fontstyle');
  const colorEl   = document.getElementById('edit-fontcolor');

  if (font)    obj.fontFamily  = font.value;
  if (size)    obj.fontSize    = parseInt(size.value) || 16;
  if (style)   obj.fontWeight  = style.value === 'bold' ? 'bold' : 'normal';
  if (colorEl) obj.color       = colorEl.value;

  _refreshOverlay(pg);
  _updateFontColorHex(colorEl ? colorEl.value : '#000000');
}

function _updateTextControls(obj) {
  const font    = document.getElementById('edit-font');
  const size    = document.getElementById('edit-fontsize');
  const style   = document.getElementById('edit-fontstyle');
  const colorEl = document.getElementById('edit-fontcolor');

  const isText = obj && obj.type === 'text';
  [font, size, style, colorEl].forEach(el => {
    if (el) el.disabled = !isText;
  });

  if (isText && obj) {
    if (font)    font.value    = obj.fontFamily  || 'Arial';
    if (size)    size.value    = obj.fontSize    || 16;
    if (style)   style.value   = obj.fontWeight === 'bold' ? 'bold' : 'normal';
    if (colorEl) { colorEl.value = obj.color || '#000000'; _updateFontColorHex(colorEl.value); }
  }
}

function _updateFontColorHex(val) {
  const hexEl = document.getElementById('edit-fontcolor-hex');
  if (hexEl) hexEl.textContent = val;
}

/* ── Helpers ── */
function _getCurrentPg() {
  if (!editSelectedPage) return null;
  return editPages.find(p => p.id === editSelectedPage) || null;
}

/* ────────────────────────────────────────────
   EXPORT / DOWNLOAD
   ──────────────────────────────────────────── */
async function _buildAndDownloadEditPDF() {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const outDoc = await PDFDocument.create();

  for (const pg of editPages) {
    let page;

    if (pg.imageDataURL) {
      // Image page
      const isJpeg = pg.imageDataURL.startsWith('data:image/jpeg') || pg.imageDataURL.startsWith('data:image/jpg');
      const base64 = pg.imageDataURL.split(',')[1];
      const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      let imgEmbed;
      try {
        imgEmbed = isJpeg ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes);
      } catch {
        const pngURL  = await _toCanvasPNG(pg.imageDataURL);
        const pngBase = pngURL.split(',')[1];
        const pngByte = Uint8Array.from(atob(pngBase), c => c.charCodeAt(0));
        imgEmbed = await outDoc.embedPng(pngByte);
      }
      const { width: iw, height: ih } = imgEmbed;
      page = outDoc.addPage([pg.widthPt || iw, pg.heightPt || ih]);
      const ratio = Math.min(page.getWidth() / iw, page.getHeight() / ih);
      const dw = iw * ratio, dh = ih * ratio;
      page.drawImage(imgEmbed, {
        x: (page.getWidth() - dw) / 2,
        y: (page.getHeight() - dh) / 2,
        width: dw, height: dh,
      });
    } else if (pg.pdfBytes) {
      // PDF page — copy from source
      const srcDoc = await PDFDocument.load(pg.pdfBytes, { ignoreEncryption: true });
      const [copied] = await outDoc.copyPages(srcDoc, [pg.pdfPageIndex]);
      outDoc.addPage(copied);
      page = outDoc.getPage(outDoc.getPageCount() - 1);
    } else {
      page = outDoc.addPage([pg.widthPt || 595, pg.heightPt || 842]);
    }

    // Apply rotation
    if (pg.rotation) {
      const validRots = [0, 90, 180, 270];
      const rot = validRots.find(r => r === pg.rotation) || 0;
      if (rot) page.setRotation({ angle: rot, type: 'degrees' });
    }

    // Draw overlay objects
    for (const obj of pg.overlayObjects) {
      const pageH  = page.getHeight();
      const scaleX = (pg.widthPt  || 595) / (page.getWidth()  || 595);
      const scaleY = (pg.heightPt || 842) / pageH;

      // Convert from canvas (screen) coords to PDF coords
      const pdfX = (obj.x / editorScale) * scaleX;
      const pdfY = pageH - ((obj.y / editorScale) + (obj.h / editorScale)) * scaleY;
      const pdfW = (obj.w / editorScale) * scaleX;
      const pdfH = (obj.h / editorScale) * scaleY;

      if (obj.type === 'text') {
        // Use built-in font (pdf-lib can't load Google Fonts directly)
        try {
          const font2 = await outDoc.embedFont(
            obj.fontWeight === 'bold' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica
          );
          const fs = Math.max(4, obj.fontSize || 16);
          const hexColor = (obj.color || '#000000').replace('#', '');
          const r = parseInt(hexColor.slice(0,2), 16) / 255;
          const g = parseInt(hexColor.slice(2,4), 16) / 255;
          const b = parseInt(hexColor.slice(4,6), 16) / 255;
          page.drawText(obj.content || '', {
            x: pdfX, y: pdfY + pdfH * 0.25,
            size: fs,
            font: font2,
            color: rgb(r, g, b),
            maxWidth: pdfW,
          });
        } catch(e2) { /* skip if font fails */ }

      } else if (obj.type === 'image' && obj.dataURL) {
        try {
          const isJ   = obj.dataURL.startsWith('data:image/jpeg') || obj.dataURL.startsWith('data:image/jpg');
          const b64   = obj.dataURL.split(',')[1];
          const imgB  = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          let imgE;
          try { imgE = isJ ? await outDoc.embedJpg(imgB) : await outDoc.embedPng(imgB); }
          catch {
            const pu  = await _toCanvasPNG(obj.dataURL);
            const pb  = Uint8Array.from(atob(pu.split(',')[1]), c => c.charCodeAt(0));
            imgE = await outDoc.embedPng(pb);
          }
          page.drawImage(imgE, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
        } catch(e3) { /* skip */ }
      }
    }
  }

  const outBytes = await outDoc.save();
  triggerDownload(new Blob([outBytes], { type: 'application/pdf' }), 'edited.pdf');
}

function _toCanvasPNG(dataURL) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      res(c.toDataURL('image/png'));
    };
    img.src = dataURL;
  });
}