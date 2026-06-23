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

function uid() { return `ep-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

function initEditPDF() {
  _bindEditDropZone();
  _bindEditButtons();
  _bindTextFormatControls();
  _renderEditThumbs();

  // Bắt sự kiện phím Delete / Backspace để xóa Object
  document.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && editSelectedObj) {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      const isTyping = activeTag === 'INPUT' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
      
      if (!isTyping) {
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
    textDiv.style.cssText = `font-family: "${obj.fontFamily || 'Arial'}", sans-serif; font-size: ${obj.fontSize || 16}px; font-weight: ${obj.fontWeight || 'normal'}; color: ${obj.color || '#000000'}; width:100%; height:100%; outline:none; word-break:break-word; white-space:pre-wrap; pointer-events:none; user-select: none;`;
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
    img.src = obj.dataURL || ''; img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;display:block;';
    el.appendChild(img);
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
}

function _bindObjectMove(el, obj, pg) {
  let startX, startY, startOX, startOY;
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.obj-btn-del') || e.target.closest('.obj-resize-handle')) return;
    if (el.querySelector('[contenteditable="true"]')) return; // Đang gõ chữ thì không kéo

    e.preventDefault(); e.stopPropagation();
    _selectObject(obj, pg);

    startX = e.clientX; startY = e.clientY; startOX = obj.x; startOY = obj.y;

    function onMove(e2) {
      obj.x = Math.max(0, startOX + (e2.clientX - startX)); obj.y = Math.max(0, startOY + (e2.clientY - startY));
      el.style.left = obj.x + 'px'; el.style.top = obj.y + 'px';
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

function _bindResizeHandle(el, obj, handleEl, dir) {
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY, startW = obj.w, startH = obj.h, startOX = obj.x, startOY = obj.y, MIN = 20;
    
    function onMove(e2) {
      let dx = e2.clientX - startX;
      let dy = e2.clientY - startY;
      
      // Áp dụng dịch tọa độ cho Resize khi xoay
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

      if (dir === 'se') { obj.w = Math.max(MIN, startW + dx); obj.h = Math.max(MIN, startH + dy); }
      else if (dir === 'e') { obj.w = Math.max(MIN, startW + dx); }
      else if (dir === 'w') { const nw = Math.max(MIN, startW - dx); obj.x = startOX + (startW - nw); obj.w = nw; }
      else if (dir === 's') { obj.h = Math.max(MIN, startH + dy); }
      else if (dir === 'n') { const nh = Math.max(MIN, startH - dy); obj.y = startOY + (startH - nh); obj.h = nh; }
      el.style.width = obj.w + 'px'; el.style.height = obj.h + 'px'; el.style.left = obj.x + 'px'; el.style.top = obj.y + 'px';
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

function _bindEditButtons() {
  const btnText = document.getElementById('edit-btn-text');
  if (btnText) {
    btnText.addEventListener('click', () => {
      // Đổi active state ở left menu
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      btnText.classList.add('active');

      const pg = _getCurrentPg();
      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      const obj = {
        id: uid(), type: 'text', x: Math.round(pg.widthPt * editorScale * 0.3), y: Math.round(pg.heightPt * editorScale * 0.4),
        w: 200, h: 60, content: 'Nhập text tại đây', fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal', color: '#000000',
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
      btnImg.classList.add('active');

      const pg = _getCurrentPg();
      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
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
  ['edit-font', 'edit-fontsize', 'edit-fontstyle', 'edit-fontcolor', 'edit-strokestyle', 'edit-strokewidth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', () => _applyTextFormat()); el.addEventListener('change', () => _applyTextFormat()); }
  });
}

function _applyTextFormat() {
  if (!editSelectedObj) return;
  const pg = _getCurrentPg(); if (!pg) return;
  const obj = pg.overlayObjects.find(o => o.id === editSelectedObj);
  if (!obj || obj.type !== 'text') return;

  const font = document.getElementById('edit-font'), 
        size = document.getElementById('edit-fontsize'), 
        style = document.getElementById('edit-fontstyle'), // Dropdown mới có Italic
        colorEl = document.getElementById('edit-fontcolor'),
        stroke = document.getElementById('edit-strokestyle'),
        strokeW = document.getElementById('edit-strokewidth');

  if (font) obj.fontFamily = font.value;
  if (size) obj.fontSize = parseInt(size.value) || 16;
  
  // LOGIC MỚI CHO FONT STYLE
  if (style) {
    obj.fontWeight = (style.value === 'bold') ? 'bold' : 'normal';
    obj.fontStyle  = (style.value === 'italic') ? 'italic' : 'normal';
  }
  
  if (colorEl) obj.color = colorEl.value;
  if (stroke) obj.stroke = stroke.value;
  if (strokeW) obj.strokeWidth = parseInt(strokeW.value) || 0;

  const area = document.getElementById('edit-canvas-area');
  if (area && area._overlayEl) {
    const el = area._overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
    if (el) {
      const textDiv = el.querySelector('.edit-obj-textcontent');
      if (textDiv) {
        textDiv.style.fontFamily = `"${obj.fontFamily}", sans-serif`;
        textDiv.style.fontSize = `${obj.fontSize}px`;
        textDiv.style.fontWeight = obj.fontWeight;
        textDiv.style.fontStyle  = obj.fontStyle; // Cập nhật style
        textDiv.style.color = obj.color;
        
        if (obj.stroke !== 'none' && obj.strokeWidth > 0) {
          textDiv.style.webkitTextStroke = `${obj.strokeWidth}px #000`;
        } else {
          textDiv.style.webkitTextStroke = '0';
        }
      }
    }
  }
}

function _updateTextControls(obj) {
  const font = document.getElementById('edit-font'), 
        size = document.getElementById('edit-fontsize'), 
        style = document.getElementById('edit-fontstyle'), 
        colorEl = document.getElementById('edit-fontcolor'),
        stroke = document.getElementById('edit-strokestyle'),
        strokeW = document.getElementById('edit-strokewidth');

  const isText = obj && obj.type === 'text';
  [font, size, style, colorEl, stroke, strokeW].forEach(el => { if (el) el.disabled = !isText; });
if (isText && obj) {
    if (font) font.value = obj.fontFamily || 'Arial';
    if (size) size.value = obj.fontSize || 16;
    if (style) {
      if (obj.fontStyle === 'italic') style.value = 'italic';
      else style.value = (obj.fontWeight === 'bold') ? 'bold' : 'normal';
    }
    
    if (stroke) stroke.value = obj.stroke || 'none';
    if (strokeW) strokeW.value = obj.strokeWidth || 1;
    if (colorEl) { colorEl.value = obj.color || '#000000'; }
  }
}

function _updateFontColorHex(val) { const hexEl = document.getElementById('edit-fontcolor-hex'); if (hexEl) hexEl.textContent = val; }
function _getCurrentPg() { if (!editSelectedPage) return null; return editPages.find(p => p.id === editSelectedPage) || null; }

async function _buildAndDownloadEditPDF() {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const outDoc = await PDFDocument.create();

  for (const pg of editPages) {
    let page;
    if (pg.imageDataURL) {
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
      const { width: iw, height: ih } = imgEmbed;
      page = outDoc.addPage([pg.widthPt || iw, pg.heightPt || ih]);
      const ratio = Math.min(page.getWidth() / iw, page.getHeight() / ih);
      const dw = iw * ratio, dh = ih * ratio;
      page.drawImage(imgEmbed, { x: (page.getWidth() - dw) / 2, y: (page.getHeight() - dh) / 2, width: dw, height: dh });
    } else if (pg.pdfBytes) {
      const srcDoc = await PDFDocument.load(pg.pdfBytes, { ignoreEncryption: true });
      const [copied] = await outDoc.copyPages(srcDoc, [pg.pdfPageIndex]);
      outDoc.addPage(copied);
      page = outDoc.getPage(outDoc.getPageCount() - 1);
    } else { page = outDoc.addPage([pg.widthPt || 595, pg.heightPt || 842]); }

    if (pg.rotation) {
      const rot = [0, 90, 180, 270].find(r => r === pg.rotation) || 0;
      if (rot) page.setRotation({ angle: rot, type: 'degrees' });
    }

    for (const obj of pg.overlayObjects) {
      const pageH = page.getHeight(), scaleX = (pg.widthPt || 595) / (page.getWidth() || 595), scaleY = (pg.heightPt || 842) / pageH;
      const pdfX = (obj.x / editorScale) * scaleX, pdfY = pageH - ((obj.y / editorScale) + (obj.h / editorScale)) * scaleY;
      const pdfW = (obj.w / editorScale) * scaleX, pdfH = (obj.h / editorScale) * scaleY;

      if (obj.type === 'text') {
        try {
          // LOGIC CHỌN FONT CẬP NHẬT: HỖ TRỢ BOLD + ITALIC
          let fontType = StandardFonts.Helvetica;
          const isBold = obj.fontWeight === 'bold';
          const isItalic = obj.fontStyle === 'italic';

          if (isBold && isItalic) fontType = StandardFonts.HelveticaBoldOblique;
          else if (isBold) fontType = StandardFonts.HelveticaBold;
          else if (isItalic) fontType = StandardFonts.HelveticaOblique;
          else fontType = StandardFonts.Helvetica;

          const font2 = await outDoc.embedFont(fontType);
          const hexColor = (obj.color || '#000000').replace('#', '');
          const r = parseInt(hexColor.slice(0,2), 16) / 255;
          const g = parseInt(hexColor.slice(2,4), 16) / 255;
          const b = parseInt(hexColor.slice(4,6), 16) / 255;
          
          page.drawText(obj.content || '', { 
            x: pdfX, 
            y: pdfY + pdfH * 0.25, 
            size: Math.max(4, obj.fontSize || 16), 
            font: font2, 
            color: rgb(r, g, b), 
            maxWidth: pdfW 
          });
        } catch(e2) {}
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
        } catch(e3) {}
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