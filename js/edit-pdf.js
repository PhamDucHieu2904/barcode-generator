/* ══════════════════════════════════════════════
   edit-pdf.js — Edit PDF module (Pro Version)
   ══════════════════════════════════════════════ */

const EDIT_FONTS = [
  'Arial','Helvetica','Georgia','Times New Roman','Courier New',
  'Roboto','Open Sans','Lato','Montserrat','Raleway',
  'Oswald','Playfair Display','Merriweather','Nunito','Poppins',
  'Source Sans Pro','Ubuntu','PT Serif','Quicksand','Josefin Sans'
];

(function injectGoogleFonts() {
  const webFonts = EDIT_FONTS
    .filter(f => !['Arial','Helvetica','Georgia','Times New Roman','Courier New'].includes(f))
    .map(f => f.replace(/ /g, '+')).join('|');
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${webFonts.split('|').map(f=>`${f}:wght@400;700`).join('&family=')}&display=swap`;
  document.head.appendChild(link);
})();

const PAPER_SIZES = { none: null, a4v: { w: 595, h: 842 }, a4h: { w: 842, h: 595 }, a3v: { w: 842, h: 1191 }, a3h: { w: 1191, h: 842 } };

let editPages = [], editSelectedPage = null, editPdfOrigBytes = null, editDragSrcId = null, editSelectedObj = null, editorScale = 1;
let _clipboard = null; // Lưu object đã copy (Ctrl+C)

// ── Shape tool state ──
let activeShapeTool = null; // 'rect' | 'triangle' | 'ellipse' | 'line' | null

// ── Line 2-click state ──
let _linePendingStart = null; // { x, y, pg, overlayEl } — điểm đầu của line đang chờ điểm cuối
let _lineGhostEl = null;      // element preview ghost line
let _lineGhostObj = null;     // ghost shape object

function uid() { return `ep-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

function initEditPDF() {
  _bindEditDropZone();
  _bindEditButtons();
  _bindTextFormatControls();
  _renderEditThumbs();

  // Bắt sự kiện phím (Delete, Ctrl+C, Ctrl+V)
  document.addEventListener('keydown', e => {
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = activeTag === 'INPUT' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
    if (isTyping) return;

    // ── Delete / Backspace: xóa object ──
    if ((e.key === 'Delete' || e.key === 'Backspace') && editSelectedObj) {
      const pg = _getCurrentPg();
      if (pg) {
        pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== editSelectedObj);
        const area = document.getElementById('edit-canvas-area');
        if (area && area._overlayEl) {
          const elToRemove = area._overlayEl.querySelector(`[data-obj-id="${editSelectedObj}"]`);
          if (elToRemove) elToRemove.remove();
        }
        editSelectedObj = null;
        _updateTextControls(null);
      }
    }

    // ── Ctrl+C: copy object đang chọn ──
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && editSelectedObj) {
      const pg = _getCurrentPg();
      if (pg) {
        const obj = pg.overlayObjects.find(o => o.id === editSelectedObj);
        if (obj) {
          // Loại bỏ _svgEl (DOM ref) trước khi serialize
          const { _svgEl, ...copyable } = obj;
          _clipboard = JSON.parse(JSON.stringify(copyable));
        }
      }
      e.preventDefault();
    }

    // ── Ctrl+V: paste object từ clipboard ──
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && _clipboard) {
      const pg = _getCurrentPg();
      if (pg) {
        const newObj = JSON.parse(JSON.stringify(_clipboard));
        newObj.id    = uid();
        newObj.x    += 20;  // Lệch nhẹ để phân biệt với bản gốc
        newObj.y    += 20;
        newObj.selected = false;
        pg.overlayObjects.push(newObj);
        const area = document.getElementById('edit-canvas-area');
        if (area && area._overlayEl) {
          _renderOverlayObject(newObj, area._overlayEl, pg);
          _selectObject(newObj, pg);
        }
      }
      e.preventDefault();
    }
  });
}

function _bindEditDropZone() {
  const dz = document.getElementById('dz-edit'), trigger = document.getElementById('dz-edit-trigger');
  trigger.addEventListener('click', e => { e.stopPropagation(); _openEditFilePicker(['application/pdf']); });
  dz.addEventListener('click', e => { if (e.target === dz || e.target.closest('#dz-edit-placeholder')) _openEditFilePicker(['application/pdf']); });
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', e => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('dragover'); });
  dz.addEventListener('drop', async e => { e.preventDefault(); dz.classList.remove('dragover'); await _handleEditFileDrop(Array.from(e.dataTransfer.files)); });
}

function _openEditFilePicker(accept) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = accept.join(','); input.multiple = accept.length > 1;
  input.addEventListener('change', async () => _handleEditFileDrop(Array.from(input.files))); input.click();
}

async function _renderPdfPageToDataURL(arrayBuffer, pageIndex) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    return canvas.toDataURL('image/png');
  } catch(e) { return null; }
}

async function _handleEditFileDrop(files) {
  const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
  const imageFiles = files.filter(f => f.type.startsWith('image/'));

  if (!editPages.length) {
    if (!pdfFiles.length) { alert('Vui lòng kéo thả file PDF đầu tiên.'); return; }
    editPdfOrigBytes = await readFileAsArrayBuffer(pdfFiles[0]);
    await _loadPdfPages(editPdfOrigBytes);
  } else {
    for (const img of imageFiles) {
      const dataURL = await readFileAsDataURL(img);
      editPages.push({ id: uid(), pdfBytes: null, imageDataURL: dataURL, renderURL: dataURL, rotation: 0, widthPt: 595, heightPt: 842, origWidthPt: 595, origHeightPt: 842, overlayObjects: [] });
    }
    for (const pf of pdfFiles) {
      const bytes = await readFileAsArrayBuffer(pf);
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      for (let i = 0; i < doc.getPageCount(); i++) {
        const { width, height } = doc.getPage(i).getSize();
        const renderUrl = await _renderPdfPageToDataURL(bytes, i);
        editPages.push({ id: uid(), pdfBytes: bytes, pdfPageIndex: i, imageDataURL: null, renderURL: renderUrl, rotation: 0, widthPt: width, heightPt: height, origWidthPt: width, origHeightPt: height, overlayObjects: [] });
      }
    }
  }
  _renderEditThumbs(); _updateEditPlaceholder();
}

async function _loadPdfPages(arrayBuffer) {
  try {
    const doc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    editPages = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const { width, height } = doc.getPage(i).getSize();
      const renderUrl = await _renderPdfPageToDataURL(arrayBuffer, i);
      editPages.push({ id: uid(), pdfBytes: arrayBuffer, pdfPageIndex: i, renderURL: renderUrl, rotation: 0, widthPt: width, heightPt: height, origWidthPt: width, origHeightPt: height, overlayObjects: [] });
    }
  } catch(e) { alert('Lỗi file PDF: ' + e.message); }
}

function _updateEditPlaceholder() {
  const ph = document.getElementById('dz-edit-placeholder');
  if (ph) ph.classList.toggle('hidden', editPages.length > 0);
}

async function _renderEditThumbs() {
  const thumbsEl = document.getElementById('dz-edit-thumbs');
  if (!thumbsEl) return;
  thumbsEl.innerHTML = ''; _updateEditPlaceholder();

  for (let idx = 0; idx < editPages.length; idx++) {
    const pg = editPages[idx];
    const thumb = document.createElement('div');
    thumb.className = 'dz-thumb edit-thumb';
    if (pg.id === editSelectedPage) thumb.classList.add('selected');
    thumb.dataset.id = pg.id; thumb.draggable = true;

    const imgEl = document.createElement('img');
    imgEl.style.transform = `rotate(${pg.rotation}deg)`;

    const canvas = document.createElement('canvas');
    canvas.width = 76; canvas.height = 76;
    const ctx = canvas.getContext('2d');

    if (pg.renderURL) {
      await new Promise(res => {
        const img2 = new Image();
        img2.onload = () => {
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 76, 76);
          const s = Math.min(76 / img2.width, 76 / img2.height);
          ctx.drawImage(img2, (76 - img2.width * s)/2, (76 - img2.height * s)/2, img2.width * s, img2.height * s);
          res();
        };
        img2.src = pg.renderURL;
      });
    }

    imgEl.src = canvas.toDataURL();
    thumb.appendChild(imgEl);

    const badge = document.createElement('span'); badge.className = 'dz-page-num'; badge.textContent = idx + 1; thumb.appendChild(badge);
    const rmBtn = document.createElement('button'); rmBtn.className = 'dz-remove'; rmBtn.innerHTML = '&times;';
    rmBtn.addEventListener('click', e => {
      e.stopPropagation();
      editPages = editPages.filter(p => p.id !== pg.id);
      if (editSelectedPage === pg.id) { editSelectedPage = null; _clearEditor(); }
      _renderEditThumbs();
    });
    thumb.appendChild(rmBtn);

    thumb.addEventListener('click', e => { if (e.target === rmBtn) return; editSelectedPage = pg.id; _renderEditThumbs(); _openPageEditor(pg); });
    _bindEditThumbDrag(thumb, pg.id);
    thumbsEl.appendChild(thumb);
  }
}

function _openPageEditor(pg) {
  const area = document.getElementById('edit-canvas-area');
  if (!area) return;
  area.innerHTML = ''; editSelectedObj = null;

  const areaW = area.clientWidth || 600, areaH = area.clientHeight || 700;
  
  // 1. Nhận diện kích thước thật khi bị xoay (Đảo chiều Rộng/Cao)
  const isRotated = pg.rotation === 90 || pg.rotation === 270;
  const logicalW = isRotated ? pg.heightPt : pg.widthPt;
  const logicalH = isRotated ? pg.widthPt : pg.heightPt;
  
  // Tính tỷ lệ thu phóng dựa trên kích thước thật đã xoay
  editorScale = Math.min((areaW - 32) / logicalW, (areaH - 32) / logicalH, 1.5);

  // 2. Tạo một lớp Wrapper để giữ chỗ cho Layout không bị tràn
  const wrapper = document.createElement('div');
  wrapper.style.width = Math.round(logicalW * editorScale) + 'px';
  wrapper.style.height = Math.round(logicalH * editorScale) + 'px';
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';

  // 3. Render trang PDF như bình thường
  const pageEl = document.createElement('div');
  pageEl.className = 'edit-page-canvas';
  pageEl.style.width = Math.round(pg.widthPt * editorScale) + 'px';
  pageEl.style.height = Math.round(pg.heightPt * editorScale) + 'px';
  pageEl.style.transform = `rotate(${pg.rotation}deg)`;
  pageEl.style.transformOrigin = 'center center';
  const bgLayer = document.createElement('div');
  bgLayer.className = 'edit-bg-layer'; bgLayer.style.width = '100%'; bgLayer.style.height = '100%';

  if (pg.renderURL) {
    const bgImg = document.createElement('img'); bgImg.src = pg.renderURL; bgImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    bgLayer.appendChild(bgImg);
  }

  pageEl.appendChild(bgLayer);
  const overlayEl = document.createElement('div');
  overlayEl.className = 'edit-overlay'; overlayEl.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  pageEl.appendChild(overlayEl);

  pg.overlayObjects.forEach(obj => _renderOverlayObject(obj, overlayEl, pg));

  pageEl.addEventListener('mousedown', e => { if (e.target === pageEl || e.target === bgLayer || e.target === overlayEl) _deselectAll(pg); });
  
  // Chèn Page vào Wrapper, rồi mới chèn vào màn hình
  wrapper.appendChild(pageEl);
  area.appendChild(wrapper);
  area._currentPg = pg; area._overlayEl = overlayEl;
}

function _bindEditThumbDrag(thumbEl, id) {
  thumbEl.addEventListener('dragstart', e => { editDragSrcId = id; thumbEl.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); e.stopPropagation(); });
  thumbEl.addEventListener('dragend', () => { thumbEl.classList.remove('dragging'); document.querySelectorAll('.edit-thumb').forEach(t => t.classList.remove('drag-over')); });
  thumbEl.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); if (editDragSrcId !== id) thumbEl.classList.add('drag-over'); });
  thumbEl.addEventListener('dragleave', () => thumbEl.classList.remove('drag-over'));
  thumbEl.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); thumbEl.classList.remove('drag-over');
    if (editDragSrcId && editDragSrcId !== id) {
      const fi = editPages.findIndex(p => p.id === editDragSrcId), ti = editPages.findIndex(p => p.id === id);
      if (fi >= 0 && ti >= 0) { const [moved] = editPages.splice(fi, 1); editPages.splice(ti, 0, moved); _renderEditThumbs(); }
    }
  });
}

function _clearEditor() {
  const area = document.getElementById('edit-canvas-area');
  if (area) area.innerHTML = '<div class="edit-empty-hint">Chọn một trang để chỉnh sửa</div>';
  editSelectedObj = null; _updateTextControls(null);
}

function _bindObjectMove(el, obj, pg) {
  let startX, startY, startOX, startOY;
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.obj-btn-del') || e.target.closest('.obj-resize-handle')) return;
    if (el.querySelector('[contenteditable="true"]')) return;

    e.preventDefault(); e.stopPropagation();
    _selectObject(obj, pg);

    startX = e.clientX; startY = e.clientY; startOX = obj.x; startOY = obj.y;

    function onMove(e2) {
      let dx = e2.clientX - startX;
      let dy = e2.clientY - startY;
      let localDx = dx, localDy = dy;

      // Xử lý dịch tọa độ khi canvas bị xoay
      if (pg.rotation === 90) {
        localDx = -dy; localDy = dx;
      } else if (pg.rotation === 180) {
        localDx = -dx; localDy = -dy;
      } else if (pg.rotation === 270) {
        localDx = dy; localDy = -dx;
      }

      obj.x = Math.max(0, startOX + localDx); 
      obj.y = Math.max(0, startOY + localDy);
      el.style.left = obj.x + 'px'; 
      el.style.top = obj.y + 'px';
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

/* ════════════════════════════════════════════
   SHAPE DRAWING HELPERS
   ════════════════════════════════════════════ */

function _createShapeElement(obj) {
  const NS  = 'http://www.w3.org/2000/svg';
  const fill   = obj.shapeFill   || 'none';
  const stroke = (obj.shapeStroke && obj.shapeStroke !== 'none') ? obj.shapeStroke : 'none';
  const sw     = obj.shapeStrokeWidth != null ? obj.shapeStrokeWidth : 2;
  const dash   = obj.shapeStrokeDash === 'dashed' ? `${sw * 3},${sw * 2}` : null;
  const w = obj.w || 100, h = obj.h || 100;
  let el;

  if (obj.shapeType === 'rect') {
    el = document.createElementNS(NS, 'rect');
    el.setAttribute('x',      sw / 2);
    el.setAttribute('y',      sw / 2);
    el.setAttribute('width',  Math.max(1, w - sw));
    el.setAttribute('height', Math.max(1, h - sw));

  } else if (obj.shapeType === 'ellipse') {
    el = document.createElementNS(NS, 'ellipse');
    el.setAttribute('cx', w / 2);
    el.setAttribute('cy', h / 2);
    el.setAttribute('rx', Math.max(1, w / 2 - sw / 2));
    el.setAttribute('ry', Math.max(1, h / 2 - sw / 2));

  } else if (obj.shapeType === 'triangle') {
    el = document.createElementNS(NS, 'polygon');
    const pad = sw / 2;
    el.setAttribute('points', `${w/2},${pad} ${w - pad},${h - pad} ${pad},${h - pad}`);

  } else if (obj.shapeType === 'line') {
    el = document.createElementNS(NS, 'line');
    // MỚI: Nếu là line có tọa độ thông minh thì vẽ theo giữa Box
    if (obj.lineStartRel && obj.lineEndRel) {
      el.setAttribute('x1', obj.lineStartRel[0] * w);
      el.setAttribute('y1', obj.lineStartRel[1] * h);
      el.setAttribute('x2', obj.lineEndRel[0] * w);
      el.setAttribute('y2', obj.lineEndRel[1] * h);
    } else {
      // Logic cũ cho các file chưa update
      el.setAttribute('x1', 0);  el.setAttribute('y1', obj.lineFlipY ? 0 : h);
      el.setAttribute('x2', w);  el.setAttribute('y2', obj.lineFlipY ? h : 0);
    }
  }

  if (!el) return document.createElementNS(NS, 'g');

  el.setAttribute('fill',             fill);
  el.setAttribute('stroke',           stroke);
  el.setAttribute('stroke-width',     sw);
  el.setAttribute('stroke-linecap',   'round');
  el.setAttribute('stroke-linejoin',  'round');
  if (dash) el.setAttribute('stroke-dasharray', dash);
  return el;
}

function _buildShapeSVG(obj) {
  const NS  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${obj.w || 100} ${obj.h || 100}`);

  // Mũi tên cho line
  if (obj.shapeType === 'line' && obj.lineArrow) {
    const defs   = document.createElementNS(NS, 'defs');
    const marker = document.createElementNS(NS, 'marker');
    const markId = 'arrow-' + obj.id;
    marker.setAttribute('id',           markId);
    marker.setAttribute('markerWidth',  '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX',         '6');
    marker.setAttribute('refY',         '3');
    marker.setAttribute('orient',       'auto');
    const arrowPath = document.createElementNS(NS, 'path');
    arrowPath.setAttribute('d',    'M0,0 L0,6 L8,3 z');
    arrowPath.setAttribute('fill', obj.shapeStroke || '#000000');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);
    const lineEl = _createShapeElement(obj);
    lineEl.setAttribute('marker-end', `url(#${markId})`);
    svg.appendChild(lineEl);
  } else {
    svg.appendChild(_createShapeElement(obj));
  }

  return svg;
}

function _updateShapeSVG(obj) {
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._overlayEl) return;
  const el = area._overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
  if (!el) return;
  const oldSvg = el.querySelector('svg');
  if (oldSvg) oldSvg.remove();
  const svgEl = _buildShapeSVG(obj);
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
  const delBtn = el.querySelector('.obj-btn-del');
  el.insertBefore(svgEl, delBtn || null);
}


function _renderOverlayObject(obj, overlayEl, pg) {
  const existing = overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.dataset.objId = obj.id;
  el.className = 'edit-obj' + (obj.selected ? ' selected' : '');
  el.style.cssText = `position:absolute; left:${obj.x}px; top:${obj.y}px; width:${obj.w}px; height:${obj.h}px; box-sizing:border-box; cursor:move; user-select:none;`;

  if (obj.type === 'text') {
    el.classList.add('edit-obj-text');
    const textDiv = document.createElement('div');
    textDiv.className = 'edit-obj-textcontent';
    textDiv.contentEditable = 'false';
    textDiv.textContent = obj.content || 'Text';
    textDiv.style.cssText = `font-family: "${obj.fontFamily || 'Arial'}", sans-serif; font-size: ${obj.fontSize || 16}px; font-weight: ${obj.fontWeight || 'normal'}; color: ${obj.color || '#000000'}; text-align: ${obj.textAlign || 'left'}; width:100%; height:100%; outline:none; word-break:break-word; white-space:pre-wrap; pointer-events:none; user-select: none;`;
    el.appendChild(textDiv);

    // Double Click Thần Thánh
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      textDiv.contentEditable = 'true';
      textDiv.style.pointerEvents = 'all';
      el.style.cursor = 'text'; textDiv.style.cursor = 'text';
      el.style.userSelect = 'text'; textDiv.style.userSelect = 'text';
      
      textDiv.focus();
      const range = document.createRange(); range.selectNodeContents(textDiv); range.collapse(false); 
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });

    textDiv.addEventListener('blur', () => {
      obj.content = textDiv.textContent;
      textDiv.contentEditable = 'false'; textDiv.style.pointerEvents = 'none';
      el.style.cursor = 'move'; textDiv.style.cursor = 'move';
      el.style.userSelect = 'none'; textDiv.style.userSelect = 'none';
    });
    textDiv.addEventListener('keydown', e => e.stopPropagation());

  } else if (obj.type === 'image') {
    el.classList.add('edit-obj-image');
    const img = document.createElement('img');
    img.src = obj.dataURL || ''; 
    img.style.cssText = 'width:100%;height:100%;object-fit:fill;pointer-events:none;display:block;';
    el.appendChild(img);

  } else if (obj.type === 'shape') {
    el.classList.add('edit-obj-shape');
    el.style.overflow = 'visible';
    const svgEl = _buildShapeSVG(obj);
    svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    el.appendChild(svgEl);
    obj._svgEl = svgEl;
  }

  _bindObjectMove(el, obj, pg);

  // Nút xóa đỏ
  const delBtn = document.createElement('button');
  delBtn.className = 'obj-btn obj-btn-del'; delBtn.innerHTML = '&times;'; delBtn.title = 'Xóa';
  delBtn.addEventListener('mousedown', e => {
    e.stopPropagation();
    pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== obj.id);
    el.remove();
    if (editSelectedObj === obj.id) { editSelectedObj = null; _updateTextControls(null); }
  });
  el.appendChild(delBtn);

  const handles = [ { cls:'rh-n', dir:'n' }, { cls:'rh-s', dir:'s' }, { cls:'rh-w', dir:'w' }, { cls:'rh-e', dir:'e' }, { cls:'rh-se', dir:'se' } ];
  handles.forEach(h => {
    const rh = document.createElement('div');
    rh.className = `obj-resize-handle ${h.cls}`;
    _bindResizeHandle(el, obj, rh, h.dir);
    el.appendChild(rh);
  });

  overlayEl.appendChild(el);
}

function _selectObject(obj, pg) {
  if (editSelectedObj === obj.id) return;

  // MỚI: Nếu chọn sang một Object khác, ép tắt chế độ gõ chữ của Text hiện tại
  if (document.activeElement && document.activeElement.classList.contains('edit-obj-textcontent')) {
    document.activeElement.blur();
    window.getSelection().removeAllRanges();
  }

  pg.overlayObjects.forEach(o => o.selected = false);
  obj.selected = true; editSelectedObj = obj.id;
  
  const area = document.getElementById('edit-canvas-area');
  if (area && area._overlayEl) {
    Array.from(area._overlayEl.children).forEach(child => {
      if (child.dataset.objId === obj.id) child.classList.add('selected'); else child.classList.remove('selected');
    });
  }
  _updateTextControls(obj);
}

function _deselectAll(pg) {
  pg.overlayObjects.forEach(o => o.selected = false); editSelectedObj = null;
  const area = document.getElementById('edit-canvas-area');
  if (area && area._overlayEl) Array.from(area._overlayEl.children).forEach(child => child.classList.remove('selected'));
  _updateTextControls(null);

  // MỚI: Ép tắt con trỏ nhấp nháy khi click ra vùng trống của PDF
  if (document.activeElement && document.activeElement.classList.contains('edit-obj-textcontent')) {
    document.activeElement.blur();
  }
  window.getSelection().removeAllRanges();
}


function _bindResizeHandle(el, obj, handleEl, dir) {
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY, startW = obj.w, startH = obj.h, startOX = obj.x, startOY = obj.y, MIN = 20;
    
    // Ghi nhớ tỷ lệ gốc (Width / Height) ngay khi vừa click chuột
    const aspect = startW / startH; 
    
    function onMove(e2) {
      let dx = e2.clientX - startX;
      let dy = e2.clientY - startY;
      
      // Áp dụng dịch tọa độ cho Resize khi xoay trang PDF
      const pg = _getCurrentPg();
      if (pg) {
        if (pg.rotation === 90) {
          const tmp = dx; dx = -dy; dy = tmp;
        } else if (pg.rotation === 180) {
          dx = -dx; dy = -dy;
        } else if (pg.rotation === 270) {
          const tmp = dx; dx = dy; dy = -tmp;
        }
      }

      // Xử lý kéo các hướng
      if (dir === 'se') { 
        // KÉO GÓC CHÉO: Scale khóa tỷ lệ (Proportional Scale)
        // Lấy trục nào chuột di chuyển nhiều hơn làm chuẩn để tính toán
        if (Math.abs(dx) > Math.abs(dy)) {
          obj.w = Math.max(MIN, startW + dx);
          obj.h = obj.w / aspect;
        } else {
          obj.h = Math.max(MIN, startH + dy);
          obj.w = obj.h * aspect;
        }
      }
      else if (dir === 'e') { obj.w = Math.max(MIN, startW + dx); }
      else if (dir === 'w') { const nw = Math.max(MIN, startW - dx); obj.x = startOX + (startW - nw); obj.w = nw; }
      else if (dir === 's') { obj.h = Math.max(MIN, startH + dy); }
      else if (dir === 'n') { const nh = Math.max(MIN, startH - dy); obj.y = startOY + (startH - nh); obj.h = nh; }
      
      el.style.width = obj.w + 'px'; 
      el.style.height = obj.h + 'px'; 
      el.style.left = obj.x + 'px'; 
      el.style.top = obj.y + 'px';
    }
    
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

// ── Combo button state ──
// Shape combo: cycle rect → triangle → ellipse
const SHAPE_CYCLE = ['rect', 'triangle', 'ellipse'];
let activeShapeComboIdx = 0;   // index trong SHAPE_CYCLE, mặc định 'rect'

// Line combo: 'arrow' | 'plain', mặc định 'arrow'
let activeLineMode = 'arrow';   // 'arrow' | 'plain'

/** Cập nhật icon của shape combo button theo activeShapeComboIdx */
function _updateShapeComboIcon() {
  const types = ['rect', 'triangle', 'ellipse'];
  types.forEach(t => {
    const el = document.getElementById(`elb-shape-icon-${t}`);
    if (el) el.style.display = (t === SHAPE_CYCLE[activeShapeComboIdx]) ? '' : 'none';
  });
}

/** Cập nhật icon của line combo button theo activeLineMode */
function _updateLineComboIcon() {
  const arrowEl = document.getElementById('elb-line-icon-arrow');
  const plainEl = document.getElementById('elb-line-icon-plain');
  if (arrowEl) arrowEl.style.display = (activeLineMode === 'arrow') ? '' : 'none';
  if (plainEl) plainEl.style.display = (activeLineMode === 'plain') ? '' : 'none';
}

function _bindEditButtons() {
  const btnText = document.getElementById('edit-btn-text');
  if (btnText) {
    btnText.addEventListener('click', () => {
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      activeShapeTool = null;
      _cancelLinePending();
      _resetCanvasCursor();

      const pg = _getCurrentPg();
      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      const obj = {
        id: uid(), type: 'text', x: Math.round(pg.widthPt * editorScale * 0.3), y: Math.round(pg.heightPt * editorScale * 0.4),
        w: 200, h: 60, content: 'Nhập text tại đây', fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal', color: '#000000',
        textAlign: 'left',
        stroke: 'none', strokeWidth: 1, selected: false,
      };
      pg.overlayObjects.push(obj);
      const area = document.getElementById('edit-canvas-area');
      if (area && area._overlayEl) _renderOverlayObject(obj, area._overlayEl, pg);
      _selectObject(obj, pg);
    });
  }

  const btnImg = document.getElementById('edit-btn-image');
  if (btnImg) {
    btnImg.addEventListener('click', () => {
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      activeShapeTool = null;
      _cancelLinePending();
      _resetCanvasCursor();

      const pg = _getCurrentPg();
      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,.tiff,.tif';
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        const dataURL = await readFileAsDataURL(input.files[0]);
        const obj = {
          id: uid(), type: 'image', x: Math.round(pg.widthPt * editorScale * 0.2), y: Math.round(pg.heightPt * editorScale * 0.2),
          w: 200, h: 150, dataURL, selected: false,
        };
        pg.overlayObjects.push(obj);
        const area = document.getElementById('edit-canvas-area');
        if (area && area._overlayEl) _renderOverlayObject(obj, area._overlayEl, pg);
        _selectObject(obj, pg);
      });
      input.click();
    });
  }

  /* ── SHAPE COMBO BUTTON ── */
  const shapeComboBtn = document.getElementById('elb-shape-combo');
  _updateShapeComboIcon(); // khởi tạo icon mặc định

  if (shapeComboBtn) {
    shapeComboBtn.addEventListener('click', (e) => {
      const pg = _getCurrentPg();

      // Click thường: toggle bật/tắt chế độ vẽ shape
      const currentShapeType = SHAPE_CYCLE[activeShapeComboIdx];
      if (activeShapeTool === currentShapeType) {
        // Đang active → tắt
        activeShapeTool = null;
        _cancelLinePending();
        document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
        _resetCanvasCursor();
        return;
      }

      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      _cancelLinePending();
      activeShapeTool = currentShapeType;
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      shapeComboBtn.classList.add('active');
      _setCanvasCursor(activeShapeTool);
    });
  }

  /* ── LINE COMBO BUTTON ── */
  const lineComboBtn = document.getElementById('elb-line-combo');
  _updateLineComboIcon(); // khởi tạo icon mặc định (arrow)

  if (lineComboBtn) {
    lineComboBtn.addEventListener('click', (e) => {
      const pg = _getCurrentPg();

      // Click thường: toggle bật/tắt chế độ vẽ line
      if (activeShapeTool === 'line') {
        activeShapeTool = null;
        _cancelLinePending();
        document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
        _resetCanvasCursor();
        return;
      }

      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      _cancelLinePending();
      activeShapeTool = 'line';
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      lineComboBtn.classList.add('active');
      _setCanvasCursor('line');
    });
  }

  /* ── PARAGRAPH ALIGN BUTTONS ── */
  document.querySelectorAll('.etb-align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const align = btn.dataset.align;

      // Cập nhật trạng thái active
      document.querySelectorAll('.etb-align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (!editSelectedObj) return;
      const pg = _getCurrentPg(); if (!pg) return;
      const obj = pg.overlayObjects.find(o => o.id === editSelectedObj);
      if (!obj || obj.type !== 'text') return;

      obj.textAlign = align;

      // Cập nhật DOM trực tiếp
      const area = document.getElementById('edit-canvas-area');
      if (area && area._overlayEl) {
        const el = area._overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
        if (el) {
          const textDiv = el.querySelector('.edit-obj-textcontent');
          if (textDiv) textDiv.style.textAlign = align;
        }
      }
    });
  });

  /* ESC huỷ tool shape/line + Ctrl standalone để cycle/swap combo */
  document.addEventListener('keydown', e => {
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = activeTag === 'INPUT' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);

    // ESC: huỷ tool
    if (e.key === 'Escape' && activeShapeTool) {
      activeShapeTool = null;
      _cancelLinePending();
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      _resetCanvasCursor();
      return;
    }

    // Ctrl / Meta: cycle shape hoặc swap line mode
    // Chỉ bắt khi: (1) đang vẽ shape/line, (2) không typing, (3) không kèm chữ cái khác (tránh Ctrl+C, Ctrl+V, v.v.)
    if ((e.key === 'Control' || e.key === 'Meta') && !isTyping) {
      if (activeShapeTool === 'rect' || activeShapeTool === 'triangle' || activeShapeTool === 'ellipse') {
        // Cycle sang shape kế tiếp
        activeShapeComboIdx = (activeShapeComboIdx + 1) % SHAPE_CYCLE.length;
        activeShapeTool = SHAPE_CYCLE[activeShapeComboIdx];
        _updateShapeComboIcon();
        _setCanvasCursor(activeShapeTool);
        e.preventDefault();
      } else if (activeShapeTool === 'line') {
        // Swap plain ↔ arrow
        activeLineMode = (activeLineMode === 'arrow') ? 'plain' : 'arrow';
        _updateLineComboIcon();
        e.preventDefault();
      }
    }
  });

  /* Bind sự kiện vẽ shape trên canvas area */
  const canvasArea = document.getElementById('edit-canvas-area');
  if (canvasArea) {
    canvasArea.addEventListener('mousedown', e => _onCanvasMousedownForShape(e));
  }

  // Tùy chọn Rotate/PaperSize đã bị ẩn khỏi UI theo thiết kế, nhưng giữ an toàn ở đây nếu sau này cần dùng lại
// ── Xử lý Paper Size và nút Toggle "All" ──
  const paperSizeEl = document.getElementById('edit-papersize');
  const paperSizeAllBtn = document.getElementById('edit-papersize-all');
  let isPaperSizeAll = false; // Trạng thái mặc định: Tắt

  // Bật/tắt trạng thái "All"
  if (paperSizeAllBtn) {
    paperSizeAllBtn.addEventListener('click', () => {
      isPaperSizeAll = !isPaperSizeAll;
      paperSizeAllBtn.classList.toggle('active', isPaperSizeAll);
    });
  }

  // Khi chọn khổ giấy trong Dropdown
  if (paperSizeEl) {
    paperSizeEl.addEventListener('change', e => { 
      const currentPg = _getCurrentPg(); 
      if (!currentPg && editPages.length === 0) return; // Không có trang nào
      
      const val = e.target.value;
      const preset = PAPER_SIZES[val];

      // Hàm áp dụng khổ giấy cho 1 trang cụ thể
      const applySizeToPage = (pg) => {
        if (val === 'none') {
          pg.widthPt = pg.origWidthPt || pg.widthPt;
          pg.heightPt = pg.origHeightPt || pg.heightPt;
        } else if (preset) {
          pg.widthPt = preset.w; 
          pg.heightPt = preset.h; 
        }
      };

      // Nếu nút All đang bật -> Áp dụng cho toàn bộ mảng editPages
      if (isPaperSizeAll) {
        editPages.forEach(pg => applySizeToPage(pg));
      } 
      // Nếu tắt -> Chỉ áp dụng cho trang hiện tại
      else if (currentPg) {
        applySizeToPage(currentPg);
      }
      
      // Vẽ lại trang đang xem và cập nhật lại toàn bộ Thumbnails
      if (currentPg) _openPageEditor(currentPg); 
      _renderEditThumbs(); 
    });
  }
  
  const dlBtn = document.getElementById('edit-download-btn');
  // Khôi phục các nút Rotate
  const rotatePage = document.getElementById('edit-rotate-page');
  if (rotatePage) rotatePage.addEventListener('click', () => { const pg = _getCurrentPg(); if (pg) { pg.rotation = ((pg.rotation || 0) + 90) % 360; _openPageEditor(pg); _renderEditThumbs(); } });

  const rotatePageCcw = document.getElementById('edit-rotate-page-ccw');
  if (rotatePageCcw) rotatePageCcw.addEventListener('click', () => { const pg = _getCurrentPg(); if (pg) { pg.rotation = ((pg.rotation || 0) - 90 + 360) % 360; _openPageEditor(pg); _renderEditThumbs(); } });

  const rotateAll = document.getElementById('edit-rotate-all');
  if (rotateAll) rotateAll.addEventListener('click', () => { editPages.forEach(p => { p.rotation = ((p.rotation || 0) + 90) % 360; }); const pg = _getCurrentPg(); if (pg) _openPageEditor(pg); _renderEditThumbs(); });

  const rotateAllCcw = document.getElementById('edit-rotate-all-ccw');
  if (rotateAllCcw) rotateAllCcw.addEventListener('click', () => { editPages.forEach(p => { p.rotation = ((p.rotation || 0) - 90 + 360) % 360; }); const pg = _getCurrentPg(); if (pg) _openPageEditor(pg); _renderEditThumbs(); });
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      if (!editPages.length) { alert('Chưa có trang nào.'); return; }
      dlBtn.disabled = true; dlBtn.textContent = 'Đang xử lý…';
      try { await _buildAndDownloadEditPDF(); } catch(e) { alert('Lỗi: ' + e.message); } finally { dlBtn.disabled = false; dlBtn.textContent = 'Download PDF'; }
    });
  }
}

// Bổ sung lắng nghe sự kiện cho Stroke
function _bindTextFormatControls() {
  ['edit-font', 'edit-fontsize', 'edit-fontstyle', 'edit-fontcolor',
   'edit-fillcolor', 'edit-strokecolor', 'edit-strokestyle', 'edit-strokewidth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', () => _applyTextFormat()); el.addEventListener('change', () => _applyTextFormat()); }
  });

  // None buttons (fill / stroke)
  const fillNoneBtn   = document.getElementById('edit-fillcolor-none');
  const strokeNoneBtn = document.getElementById('edit-strokecolor-none');

  if (fillNoneBtn) {
    fillNoneBtn.addEventListener('click', () => {
      fillNoneBtn.classList.toggle('active');
      _applyTextFormat();
    });
  }
  if (strokeNoneBtn) {
    strokeNoneBtn.addEventListener('click', () => {
      strokeNoneBtn.classList.toggle('active');
      _applyTextFormat();
    });
  }
}

function _applyTextFormat() {
  if (!editSelectedObj) return;
  const pg = _getCurrentPg(); if (!pg) return;
  const obj = pg.overlayObjects.find(o => o.id === editSelectedObj);
  if (!obj) return;

  const fillColorEl   = document.getElementById('edit-fillcolor');
  const strokeColorEl = document.getElementById('edit-strokecolor');
  const fillNoneBtn   = document.getElementById('edit-fillcolor-none');
  const strokeNoneBtn = document.getElementById('edit-strokecolor-none');
  const strokeStyleEl = document.getElementById('edit-strokestyle');
  const strokeWidthEl = document.getElementById('edit-strokewidth');

  if (obj.type === 'shape') {
    if (fillColorEl)   obj.shapeFill        = fillNoneBtn   && fillNoneBtn.classList.contains('active')   ? 'none' : (fillColorEl.value   || '#000000');
    if (strokeColorEl) obj.shapeStroke      = strokeNoneBtn && strokeNoneBtn.classList.contains('active') ? 'none' : (strokeColorEl.value || '#000000');
    if (strokeWidthEl) obj.shapeStrokeWidth = parseInt(strokeWidthEl.value) || 2;
    if (strokeStyleEl) obj.shapeStrokeDash  = strokeStyleEl.value; 
    obj.color = obj.shapeStroke;
    _updateShapeSVG(obj);
    return;
  }

  if (obj.type !== 'text') return;

  const font  = document.getElementById('edit-font'), 
        size  = document.getElementById('edit-fontsize'), 
        style = document.getElementById('edit-fontstyle');

  if (font)  obj.fontFamily  = font.value;
  if (size)  obj.fontSize    = parseInt(size.value) || 16;
  if (style) {
    obj.fontWeight = (style.value === 'bold')   ? 'bold'   : 'normal';
    obj.fontStyle  = (style.value === 'italic') ? 'italic' : 'normal';
  }

  // Lưu textAlign từ button đang active
  const activeAlignBtn = document.querySelector('.etb-align-btn.active');
  if (activeAlignBtn) obj.textAlign = activeAlignBtn.dataset.align || 'left';

  // Dùng fillColor để lưu màu chữ, hỗ trợ Text "Tàng hình" (trong suốt) nếu click None
  if (fillColorEl) obj.color = fillNoneBtn && fillNoneBtn.classList.contains('active') ? 'transparent' : (fillColorEl.value || '#000000');
  if (strokeColorEl) obj.stroke = strokeNoneBtn && strokeNoneBtn.classList.contains('active') ? 'none' : strokeColorEl.value;
  if (strokeWidthEl) obj.strokeWidth = parseInt(strokeWidthEl.value) || 0;

  const area = document.getElementById('edit-canvas-area');
  if (area && area._overlayEl) {
    const el = area._overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
    if (el) {
      const textDiv = el.querySelector('.edit-obj-textcontent');
      if (textDiv) {
        textDiv.style.fontFamily = `"${obj.fontFamily}", sans-serif`;
        textDiv.style.fontSize   = `${obj.fontSize}px`;
        textDiv.style.fontWeight = obj.fontWeight;
        textDiv.style.fontStyle  = obj.fontStyle;
        textDiv.style.color      = obj.color;
        textDiv.style.textAlign  = obj.textAlign || 'left';
        if (obj.stroke !== 'none' && obj.strokeWidth > 0) {
          textDiv.style.webkitTextStroke = `${obj.strokeWidth}px ${obj.stroke}`;
        } else {
          textDiv.style.webkitTextStroke = '0';
        }
      }
    }
  }
}

function _updateTextControls(obj) {
  const font          = document.getElementById('edit-font'), 
        size          = document.getElementById('edit-fontsize'), 
        style         = document.getElementById('edit-fontstyle'), 
        fillColorEl   = document.getElementById('edit-fillcolor'),
        strokeColorEl = document.getElementById('edit-strokecolor'),
        fillNoneBtn   = document.getElementById('edit-fillcolor-none'),
        strokeNoneBtn = document.getElementById('edit-strokecolor-none'),
        strokeStyleEl = document.getElementById('edit-strokestyle'),
        strokeW       = document.getElementById('edit-strokewidth');

  const isText  = obj && obj.type === 'text';
  const isShape = obj && obj.type === 'shape';

  [font, size, style].forEach(el => { if (el) el.disabled = !isText; });

  // Align buttons chỉ bật khi text
  document.querySelectorAll('.etb-align-btn').forEach(b => { b.disabled = !isText; });

  if (fillColorEl)   fillColorEl.disabled   = !(isShape || isText);
  if (fillNoneBtn)   fillNoneBtn.disabled   = !(isShape || isText);
  if (strokeColorEl) strokeColorEl.disabled = !(isText || isShape);
  if (strokeNoneBtn) strokeNoneBtn.disabled = !(isText || isShape);
  if (strokeStyleEl) strokeStyleEl.disabled = !(isText || isShape);
  if (strokeW)       strokeW.disabled     = !(isText || isShape);

  if (fillNoneBtn)   fillNoneBtn.classList.remove('active');
  if (strokeNoneBtn) strokeNoneBtn.classList.remove('active');

  // Reset align buttons nếu không phải text
  if (!isText) {
    document.querySelectorAll('.etb-align-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.align === 'left');
    });
  }

  if (isText && obj) {
    if (font) font.value  = obj.fontFamily || 'Arial';
    if (size) size.value  = obj.fontSize || 16;
    if (style) {
      if (obj.fontStyle === 'italic') style.value = 'italic';
      else style.value = (obj.fontWeight === 'bold') ? 'bold' : 'normal';
    }

    const colorVal = obj.color || '#000000';
    if (colorVal === 'transparent' || colorVal === 'none') {
      if (fillColorEl) fillColorEl.value = '#000000';
      if (fillNoneBtn) fillNoneBtn.classList.add('active');
    } else {
      if (fillColorEl) fillColorEl.value = colorVal;
    }

    const strokeVal = obj.stroke || 'none';
    if (strokeColorEl) strokeColorEl.value = (strokeVal !== 'none') ? strokeVal : '#000000';
    if (strokeNoneBtn && strokeVal === 'none') strokeNoneBtn.classList.add('active');
    if (strokeW) strokeW.value = obj.strokeWidth || 1;

    // Sync align buttons
    const currentAlign = obj.textAlign || 'left';
    document.querySelectorAll('.etb-align-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.align === currentAlign);
    });
  }

  if (isShape && obj) {
    const fillVal = obj.shapeFill || 'none';
    if (fillColorEl)  fillColorEl.value = (fillVal !== 'none') ? fillVal : '#000000';
    if (fillNoneBtn && fillVal === 'none') fillNoneBtn.classList.add('active');

    const strokeVal = obj.shapeStroke || '#000000';
    if (strokeColorEl) strokeColorEl.value = (strokeVal !== 'none') ? strokeVal : '#000000';
    if (strokeNoneBtn && strokeVal === 'none') strokeNoneBtn.classList.add('active');

    if (strokeW)       strokeW.value       = obj.shapeStrokeWidth != null ? obj.shapeStrokeWidth : 2;
    if (strokeStyleEl) strokeStyleEl.value = obj.shapeStrokeDash || 'solid';
  }
}
function _updateFontColorHex(val) { /* hex display removed, no-op */ }
function _getCurrentPg() { if (!editSelectedPage) return null; return editPages.find(p => p.id === editSelectedPage) || null; }

async function _buildAndDownloadEditPDF() {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const outDoc = await PDFDocument.create();

  // Lấy kích thước Container màn hình để tính toán lại chính xác tỷ lệ Zoom của từng trang
  const area = document.getElementById('edit-canvas-area');
  const areaW = area ? (area.clientWidth || 600) : 600;
  const areaH = area ? (area.clientHeight || 700) : 700;

  for (const pg of editPages) {
    let page;
    // Kiểm tra xem người dùng có đổi khổ giấy không
    const isResized = (pg.widthPt !== pg.origWidthPt) || (pg.heightPt !== pg.origHeightPt);

    /* ════════════════════════════════════════════
       1. XỬ LÝ BACKGROUND VÀ KHỔ GIẤY (PAPER SIZE)
       ════════════════════════════════════════════ */
    if (pg.imageDataURL) {
      // Nếu trang là file Ảnh
      page = outDoc.addPage([pg.widthPt, pg.heightPt]);
      const isJpeg = pg.imageDataURL.startsWith('data:image/jpeg') || pg.imageDataURL.startsWith('data:image/jpg');
      const base64 = pg.imageDataURL.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      let imgEmbed;
      try { imgEmbed = isJpeg ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes); }
      catch {
        const pngURL = await _toCanvasPNG(pg.imageDataURL);
        const pngByte = Uint8Array.from(atob(pngURL.split(',')[1]), c => c.charCodeAt(0));
        imgEmbed = await outDoc.embedPng(pngByte);
      }
      const ratio = Math.min(pg.widthPt / imgEmbed.width, pg.heightPt / imgEmbed.height);
      const dw = imgEmbed.width * ratio, dh = imgEmbed.height * ratio;
      page.drawImage(imgEmbed, { x: (pg.widthPt - dw) / 2, y: (pg.heightPt - dh) / 2, width: dw, height: dh });
      
    } else if (pg.pdfBytes) {
      // Nếu trang là file PDF
      const srcDoc = await PDFDocument.load(pg.pdfBytes, { ignoreEncryption: true });
      if (isResized) {
        // NẾU CÓ ĐỔI KHỔ GIẤY: Tạo trang mới với size mới, nhúng trang cũ vào và scale fit như hình ảnh
        page = outDoc.addPage([pg.widthPt, pg.heightPt]);
        const [embeddedPage] = await outDoc.embedPdf(pg.pdfBytes, [pg.pdfPageIndex]);
        const ratio = Math.min(pg.widthPt / embeddedPage.width, pg.heightPt / embeddedPage.height);
        const dw = embeddedPage.width * ratio, dh = embeddedPage.height * ratio;
        page.drawPage(embeddedPage, { x: (pg.widthPt - dw) / 2, y: (pg.heightPt - dh) / 2, width: dw, height: dh });
      } else {
        // GIỮ NGUYÊN KHỔ GIẤY: Copy thẳng để giữ nguyên chất lượng vector
        const [copied] = await outDoc.copyPages(srcDoc, [pg.pdfPageIndex]);
        outDoc.addPage(copied);
        page = outDoc.getPage(outDoc.getPageCount() - 1);
      }
    } else {
      // Trang trống
      page = outDoc.addPage([pg.widthPt || 595, pg.heightPt || 842]);
    }

    /* ════════════════════════════════════════════
       2. XỬ LÝ XOAY TRANG (ROTATE)
       ════════════════════════════════════════════ */
    if (pg.rotation) {
      const rot = [0, 90, 180, 270].find(r => r === pg.rotation) || 0;
      if (rot) {
        const currentRot = page.getRotation().angle || 0;
        page.setRotation({ angle: (currentRot + rot) % 360, type: 'degrees' });
      }
    }

    /* ════════════════════════════════════════════
       3. ĐỒNG BỘ TỶ LỆ TEXT/IMAGE LÊN PDF CHUẨN 100%
       ════════════════════════════════════════════ */
    // Tính lại tỷ lệ Zoom của trang này lúc edit để làm hệ quy chiếu
    const isRotated = pg.rotation === 90 || pg.rotation === 270;
    const logicalW = isRotated ? pg.heightPt : pg.widthPt;
    const logicalH = isRotated ? pg.widthPt : pg.heightPt;
    const pageScale = Math.min((areaW - 32) / logicalW, (areaH - 32) / logicalH, 1.5);

    for (const obj of pg.overlayObjects) {
      // Công thức vàng: Chuyển đổi tọa độ màn hình (CSS Pixel) sang kích thước thực tế PDF (Point)
      const pdfX = obj.x / pageScale;
      // PDF hệ tọa độ Y ngược với Web (gốc Y nằm ở dưới cùng)
      const pdfY = pg.heightPt - ((obj.y + obj.h) / pageScale); 
      const pdfW = obj.w / pageScale;
      const pdfH = obj.h / pageScale;

      if (obj.type === 'text') {
        try {
          let fontType = StandardFonts.Helvetica;
          const isBold = obj.fontWeight === 'bold';
          const isItalic = obj.fontStyle === 'italic';
          if (isBold && isItalic) fontType = StandardFonts.HelveticaBoldOblique;
          else if (isBold) fontType = StandardFonts.HelveticaBold;
          else if (isItalic) fontType = StandardFonts.HelveticaOblique;

          const font2 = await outDoc.embedFont(fontType);
          const isTransparent = obj.color === 'transparent' || obj.color === 'none';
          const hexColor = isTransparent ? '000000' : (obj.color || '#000000').replace('#', '');
          const r = parseInt(hexColor.slice(0,2), 16) / 255;
          const g = parseInt(hexColor.slice(2,4), 16) / 255;
          const b = parseInt(hexColor.slice(4,6), 16) / 255;
          
          // Size chữ thực tế trên PDF = Size hiển thị / Tỷ lệ zoom
          const pdfFontSize = obj.fontSize / pageScale;
          // Tọa độ Y của chữ là Baseline (Đường cơ sở), ta tính xấp xỉ 80% chiều cao chữ từ trên xuống
          const textY = pg.heightPt - (obj.y / pageScale) - (pdfFontSize * 0.8); 

          page.drawText(obj.content || '', { 
            x: pdfX, 
            y: textY, 
            size: pdfFontSize, 
            font: font2, 
            color: rgb(r, g, b),
            opacity: isTransparent ? 0 : 1,
            maxWidth: pdfW,
            lineHeight: pdfFontSize * 1.2
          });
        } catch(e2) { console.error("Lỗi khi vẽ Text", e2); }
        
      } else if (obj.type === 'image' && obj.dataURL) {
        try {
          const isJ = obj.dataURL.startsWith('data:image/jpeg') || obj.dataURL.startsWith('data:image/jpg');
          const imgB = Uint8Array.from(atob(obj.dataURL.split(',')[1]), c => c.charCodeAt(0));
          let imgE;
          try { imgE = isJ ? await outDoc.embedJpg(imgB) : await outDoc.embedPng(imgB); }
          catch {
            const pu = await _toCanvasPNG(obj.dataURL);
            imgE = await outDoc.embedPng(Uint8Array.from(atob(pu.split(',')[1]), c => c.charCodeAt(0)));
          }
          page.drawImage(imgE, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
        } catch(e3) { console.error("Lỗi khi vẽ Image", e3); }

      } else if (obj.type === 'shape') {
        try {
          const strokeColor = (obj.shapeStroke && obj.shapeStroke !== 'none') ? obj.shapeStroke : null;
          const fillColor   = (obj.shapeFill   && obj.shapeFill   !== 'none') ? obj.shapeFill   : null;
          const sw          = ((obj.shapeStrokeWidth != null ? obj.shapeStrokeWidth : 2)) / pageScale;
          const isDashed    = obj.shapeStrokeDash === 'dashed';

          function hexToRgb(hex) {
            const h = hex.replace('#','');
            return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
          }
          const strokeRgb = strokeColor ? (() => { const sc = hexToRgb(strokeColor); return PDFLib.rgb(sc.r, sc.g, sc.b); })() : undefined;
          const fillRgb   = fillColor   ? (() => { const fc = hexToRgb(fillColor);   return PDFLib.rgb(fc.r, fc.g, fc.b); })() : undefined;

          if (obj.shapeType === 'rect') {
            page.drawRectangle({
              x: pdfX, y: pdfY, width: pdfW, height: pdfH,
              borderColor: strokeRgb, borderWidth: strokeRgb ? sw : 0,
              color: fillRgb,
              // Chú ý: pdf-lib dùng borderDashArray cho Rect và Ellipse
              borderDashArray: isDashed && strokeRgb ? [sw * 3, sw * 2] : undefined 
            });

          } else if (obj.shapeType === 'ellipse') {
            page.drawEllipse({
              x: pdfX + pdfW / 2, y: pdfY + pdfH / 2,
              xScale: pdfW / 2, yScale: pdfH / 2,
              borderColor: strokeRgb, borderWidth: strokeRgb ? sw : 0,
              color: fillRgb,
              borderDashArray: isDashed && strokeRgb ? [sw * 3, sw * 2] : undefined
            });

          } else if (obj.shapeType === 'triangle') {
            // BUG FIX: drawSvgPath dùng hệ tọa độ SVG (Y đi xuống).
            // Cần dùng x/y options để đặt gốc tọa độ, rồi vẽ path theo SVG relative.
            const pdfY_top = pg.heightPt - (obj.y / pageScale); // Top của object trong PDF
            const triPath  = `M ${pdfW/2},0 L ${pdfW},${pdfH} L 0,${pdfH} Z`;
            page.drawSvgPath(triPath, {
              x: pdfX, y: pdfY_top,
              borderColor: strokeRgb, borderWidth: strokeRgb ? sw : 0,
              color: fillRgb,
              borderDashArray: isDashed && strokeRgb ? [sw * 3, sw * 2] : undefined
            });

          } else if (obj.shapeType === 'line') {
            if (strokeRgb) {
              let lx1, ly1, lx2, ly2;
              // MỚI: Tính toán tọa độ xuất PDF chuẩn xác dựa trên tỷ lệ điểm bắt đầu/kết thúc
              if (obj.lineStartRel && obj.lineEndRel) {
                lx1 = pdfX + obj.lineStartRel[0] * pdfW;
                ly1 = pdfY + (1 - obj.lineStartRel[1]) * pdfH;
                lx2 = pdfX + obj.lineEndRel[0] * pdfW;
                ly2 = pdfY + (1 - obj.lineEndRel[1]) * pdfH;
              } else {
                lx1 = pdfX;        ly1 = obj.lineFlipY ? (pdfY + pdfH) : pdfY;
                lx2 = pdfX + pdfW; ly2 = obj.lineFlipY ? pdfY : (pdfY + pdfH);
              }
              
              page.drawLine({ 
                start: {x: lx1, y: ly1}, end: {x: lx2, y: ly2}, 
                color: strokeRgb, thickness: sw, 
                dashArray: isDashed ? [sw * 3, sw * 2] : undefined 
              });

              if (obj.lineArrow) {
                const angle = Math.atan2(ly2 - ly1, lx2 - lx1);
                const arrowLen = Math.max(10, sw * 4);
                const arrowWidth = Math.max(8, sw * 3);

                const p1x = lx2, p1y = ly2; 
                const p2x = lx2 - arrowLen * Math.cos(angle) + (arrowWidth/2) * Math.sin(angle);
                const p2y = ly2 - arrowLen * Math.sin(angle) - (arrowWidth/2) * Math.cos(angle);
                const p3x = lx2 - arrowLen * Math.cos(angle) - (arrowWidth/2) * Math.sin(angle);
                const p3y = ly2 - arrowLen * Math.sin(angle) + (arrowWidth/2) * Math.cos(angle);

                page.drawSvgPath(`M ${p1x},${-p1y} L ${p2x},${-p2y} L ${p3x},${-p3y} Z`, {
                  color: strokeRgb, borderColor: strokeRgb, borderWidth: 1
                });
              }
            }
          }
        } catch(e4) { console.error("Lỗi khi vẽ Shape", e4); }
      }
    }
  }

  const outBytes = await outDoc.save();
  triggerDownload(new Blob([outBytes], { type: 'application/pdf' }), 'edited.pdf');
}

/* ════════════════════════════════════════════
   SHAPE TOOL: CURSOR & DRAWING
   ════════════════════════════════════════════ */

const SHAPE_CURSORS = {
  rect:     'crosshair',
  triangle: 'crosshair',
  ellipse:  'crosshair',
  line:     'crosshair',
};

function _setCanvasCursor(shapeType) {
  const canvasArea = document.getElementById('edit-canvas-area');
  if (canvasArea) canvasArea.style.cursor = SHAPE_CURSORS[shapeType] || 'crosshair';
}

function _resetCanvasCursor() {
  const canvasArea = document.getElementById('edit-canvas-area');
  if (canvasArea) canvasArea.style.cursor = '';
}

function _getOverlayRelativePos(e) {
  // Lấy tọa độ tương đối so với overlayEl (cùng hệ với obj.x, obj.y)
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._overlayEl) return null;
  const rect = area._overlayEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}


function _getShapeFillColor() {
  // Trả về 'none' nếu nút none đang active, ngược lại trả màu từ fill color picker
  const noneBtn = document.getElementById('edit-fillcolor-none');
  if (noneBtn && noneBtn.classList.contains('active')) return 'none';
  const colorEl = document.getElementById('edit-fillcolor');
  if (colorEl) return colorEl.value || '#000000';
  return '#000000';
}

function _getShapeStrokeColor() {
  // Trả về 'none' nếu nút none đang active, ngược lại trả màu từ stroke color picker
  const noneBtn = document.getElementById('edit-strokecolor-none');
  if (noneBtn && noneBtn.classList.contains('active')) return 'none';
  const colorEl = document.getElementById('edit-strokecolor');
  if (colorEl) return colorEl.value || '#000000';
  return '#000000';
}

// Giữ lại tên cũ để không phá phần khác (alias)
function _getShapeColor() { return _getShapeFillColor(); }


function _getStrokeWidth() {
  const el = document.getElementById('edit-strokewidth');
  return el ? (parseInt(el.value) || 2) : 2;
}

function _getStrokeDash() {
  const el = document.getElementById('edit-strokestyle');
  return el ? el.value : 'solid'; // 'solid' | 'dashed'
}

// =========================================================
// 1. HÀM BẮT SỰ KIỆN CHÍNH CHO SHAPE/LINE
// =========================================================
function _onCanvasMousedownForShape(e) {
  if (!activeShapeTool) return;
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._overlayEl || !area._currentPg) return;

  const overlayEl = area._overlayEl;
  const pageEl = overlayEl.closest('.edit-page-canvas') || overlayEl.parentElement;

  const startPos = _getOverlayRelativePos(e);
  if (!startPos) return;

  if (!pageEl || !pageEl.contains(e.target)) {
    if (!area.contains(e.target)) {
      activeShapeTool = null;
      _cancelLinePending();
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      _resetCanvasCursor();
    }
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const pg = area._currentPg;
  const isShift = e.shiftKey;

  if (activeShapeTool === 'line') {
    _handleLineStart(e, startPos, pg, overlayEl, isShift);
  } else {
    _startShapeDrag(e, startPos, pg, overlayEl, isShift);
  }
}

// =========================================================
// 2. LOGIC VẼ LINE (HỖ TRỢ DRAG HOẶC 2-CLICK)
// =========================================================
let _lineState = null;

function _cancelLinePending() {
  if (_lineState) {
    if (_lineState.ghostSvg) _lineState.ghostSvg.remove();
    if (_lineState.onMove) document.removeEventListener('mousemove', _lineState.onMove);
    _lineState = null;
  }
}

function _handleLineStart(e, pos, pg, overlayEl, isShift) {
  if (_lineState && _lineState.mode === 'waiting_second_click') {
    _finalizeLine(pos, pg, overlayEl, e);
    return;
  }

  const sx = pos.x, sy = pos.y;
  const strokeColor = _getShapeStrokeColor();
  const strokeWidth = _getStrokeWidth();
  const strokeDash = _getStrokeDash();

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:visible;';
  const lineNode = document.createElementNS(ns, 'line');
  lineNode.setAttribute('x1', sx); lineNode.setAttribute('y1', sy);
  lineNode.setAttribute('x2', sx); lineNode.setAttribute('y2', sy);
  lineNode.setAttribute('stroke', strokeColor !== 'none' ? strokeColor : '#111');
  lineNode.setAttribute('stroke-width', strokeWidth);
  lineNode.setAttribute('stroke-linecap', 'round');
  if (strokeDash === 'dashed') lineNode.setAttribute('stroke-dasharray', `${strokeWidth * 3},${strokeWidth * 2}`);

  svg.appendChild(lineNode);
  overlayEl.appendChild(svg);

  function onMove(ev) {
    if (!_lineState) return;
    const curPos = _getOverlayRelativePos(ev);
    if (!curPos) return;

    let cx = curPos.x, cy = curPos.y;
    let dx = cx - sx, dy = cy - sy;

    if (_lineState.isShift || ev.shiftKey) {
       const angle = Math.atan2(dy, dx);
       const snap  = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
       const dist  = Math.sqrt(dx * dx + dy * dy);
       dx = Math.cos(snap) * dist;
       dy = Math.sin(snap) * dist;
       // Loại bỏ sai số floating point nhỏ để line thực sự thẳng
       if (Math.abs(dx) < 0.5) dx = 0;
       if (Math.abs(dy) < 0.5) dy = 0;
       cx = sx + dx; cy = sy + dy;
    }

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _lineState.didDrag = true;

    _lineState.lineNode.setAttribute('x2', cx);
    _lineState.lineNode.setAttribute('y2', cy);
  }

  _lineState = { mode: 'dragging', sx, sy, ghostSvg: svg, lineNode, isShift, didDrag: false, onMove };

  function onUp(ev) {
    document.removeEventListener('mouseup', onUp);
    if (!_lineState) return;

    if (_lineState.didDrag) {
      document.removeEventListener('mousemove', onMove);
      const curPos = _getOverlayRelativePos(ev) || { x: parseFloat(_lineState.lineNode.getAttribute('x2')), y: parseFloat(_lineState.lineNode.getAttribute('y2')) };
      _finalizeLine(curPos, pg, overlayEl, ev);
    } else {
      _lineState.mode = 'waiting_second_click';
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function _finalizeLine(endPos, pg, overlayEl, ev) {
  if (!_lineState) return;
  
  if (_lineState.onMove) document.removeEventListener('mousemove', _lineState.onMove);
  _lineState.ghostSvg.remove();

  let cx = endPos.x, cy = endPos.y;
  let sx = _lineState.sx, sy = _lineState.sy;
  let dx = cx - sx, dy = cy - sy;

  const isShiftActive = _lineState.isShift || (ev && ev.shiftKey);

  if (isShiftActive) {
    const angle = Math.atan2(dy, dx);
    const snap  = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist  = Math.sqrt(dx * dx + dy * dy);
    dx = Math.cos(snap) * dist;
    dy = Math.sin(snap) * dist;
    // Làm tròn tuyệt đối để loại bỏ sai số, đảm bảo đường thẳng băng
    if (Math.abs(dx) < 0.5) dx = 0;
    if (Math.abs(dy) < 0.5) dy = 0;
    cx = sx + dx; cy = sy + dy;
  }

  _lineState = null;
  // Bỏ qua nếu click nhầm (chưa kéo được 2px)
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

  let x = Math.min(sx, cx);
  let y = Math.min(sy, cy);
  let w = Math.max(1, Math.abs(dx));
  let h = Math.max(1, Math.abs(dy));

  // Tọa độ tương đối để vẽ line bên trong bounding box
  let startRel = [0, 0];
  let endRel = [1, 1];

  let isHorizontal = isShiftActive && Math.abs(dy) === 0;
  let isVertical   = isShiftActive && Math.abs(dx) === 0;

  if (isHorizontal) {
    // ÉP CHIỀU CAO BOX = 20PX, ĐƯỜNG LINE NẰM GIỮA (0.5)
    h = 20;
    y = sy - 10;
    if (dx >= 0) { startRel = [0, 0.5]; endRel = [1, 0.5]; }
    else         { startRel = [1, 0.5]; endRel = [0, 0.5]; }
  } else if (isVertical) {
    // ÉP CHIỀU RỘNG BOX = 20PX, ĐƯỜNG LINE NẰM GIỮA (0.5)
    w = 20;
    x = sx - 10;
    if (dy >= 0) { startRel = [0.5, 0]; endRel = [0.5, 1]; }
    else         { startRel = [0.5, 1]; endRel = [0.5, 0]; }
  } else {
    // Vẽ chéo bình thường
    w = Math.max(4, w);
    h = Math.max(4, h);
    if (dx >= 0 && dy >= 0) { startRel = [0, 0]; endRel = [1, 1]; }
    else if (dx < 0 && dy >= 0) { startRel = [1, 0]; endRel = [0, 1]; }
    else if (dx >= 0 && dy < 0) { startRel = [0, 1]; endRel = [1, 0]; }
    else { startRel = [1, 1]; endRel = [0, 0]; }
  }

  const newObj = {
    id: uid(), type: 'shape', shapeType: 'line',
    x, y, w, h,
    shapeFill: _getShapeFillColor(),
    shapeStroke: _getShapeStrokeColor(),
    shapeStrokeWidth: _getStrokeWidth(),
    shapeStrokeDash: _getStrokeDash(),
    lineFlipY: (dx * dy >= 0), 
    lineArrow: (activeLineMode === 'arrow'),
    lineStartRel: startRel, // Lưu tỷ lệ điểm bắt đầu
    lineEndRel: endRel,     // Lưu tỷ lệ điểm kết thúc
    color: _getShapeStrokeColor(),
    selected: false,
  };

  pg.overlayObjects.push(newObj);
  _renderOverlayObject(newObj, overlayEl, pg);
  _selectObject(newObj, pg);
}

// =========================================================
// 3. LOGIC KÉO THẢ CHO RECTANGLE, ELLIPSE, TRIANGLE
// =========================================================
function _startShapeDrag(e, startPos, pg, overlayEl, isShift) {
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:absolute;pointer-events:none;z-index:9999;border:none;box-sizing:border-box;`;
  overlayEl.appendChild(ghost);

  let startX = startPos.x, startY = startPos.y;
  let currentObj = null;

  function onMove(e2) {
    const pos = _getOverlayRelativePos(e2);
    if (!pos) return;

    let dx = pos.x - startX, dy = pos.y - startY;

    if (isShift || e2.shiftKey) {
      const side = Math.min(Math.abs(dx), Math.abs(dy));
      dx = dx < 0 ? -side : side;
      dy = dy < 0 ? -side : side;
    }

    let x = dx >= 0 ? startX : startX + dx;
    let y = dy >= 0 ? startY : startY + dy;
    let w = Math.abs(dx);
    let h = Math.abs(dy);

    if (w < 2 && h < 2) return;

    const shapeFill   = _getShapeFillColor();
    const shapeStroke = _getShapeStrokeColor();

    if (!currentObj) {
      currentObj = {
        id: uid(), type: 'shape',
        shapeType: activeShapeTool,
        x, y, w: Math.max(4, w), h: Math.max(4, h),
        shapeFill, shapeStroke,
        shapeStrokeWidth: _getStrokeWidth(),
        shapeStrokeDash: _getStrokeDash(),
        color: shapeStroke,
        selected: false,
      };
      ghost.remove();
      pg.overlayObjects.push(currentObj);
      _renderOverlayObject(currentObj, overlayEl, pg);
      _selectObject(currentObj, pg);
    } else {
      currentObj.x = x; currentObj.y = y;
      currentObj.w = Math.max(4, w); currentObj.h = Math.max(4, h);
      currentObj.shapeStroke = shapeStroke;
      currentObj.shapeFill   = shapeFill;
      currentObj.color       = shapeStroke;

      const objEl = overlayEl.querySelector(`[data-obj-id="${currentObj.id}"]`);
      if (objEl) {
        objEl.style.left   = currentObj.x + 'px';
        objEl.style.top    = currentObj.y + 'px';
        objEl.style.width  = currentObj.w + 'px';
        objEl.style.height = currentObj.h + 'px';
        _updateShapeSVG(currentObj);
      }
    }
  }

  function onUp(e2) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    ghost.remove();
    if (currentObj && currentObj.w < 5 && currentObj.h < 5) {
      pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== currentObj.id);
      const objEl = overlayEl.querySelector(`[data-obj-id="${currentObj.id}"]`);
      if (objEl) objEl.remove();
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
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