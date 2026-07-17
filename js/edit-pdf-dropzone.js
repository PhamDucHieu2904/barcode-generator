/* ══════════════════════════════════════════════
   edit-pdf-dropzone.js — File input & thumbnails
   Chứa: _bindEditDropZone, file loading, _renderEditThumbs, thumb drag/drop
   Phụ thuộc: edit-pdf-state.js, edit-pdf-canvas.js (cho _openPageEditor, _clearEditor)
   ══════════════════════════════════════════════ */

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

// Render trang PDF thành dataURL VÀ trả kèm kích thước visual (đã apply rotation)
async function _renderPdfJsPageToDataURL(pdfJsDoc, pageIndex) {
  try {
    const page = await pdfJsDoc.getPage(pageIndex + 1);
    // scale=1.0 để lấy visual dimensions chính xác (pdfjsLib đã tính rotation)
    const vpScale1 = page.getViewport({ scale: 1.0 });
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    return {
      dataURL: canvas.toDataURL('image/png'),
      visualW: vpScale1.width,   // chiều rộng visual (pts, sau khi apply PDF rotation)
      visualH: vpScale1.height,  // chiều cao visual
    };
  } catch(e) { return { dataURL: null, visualW: 595, visualH: 842 }; }
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
      document.body.style.cursor = 'wait';
      try {
        const bytes = await readFileAsArrayBuffer(pf);
        const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        for (let i = 0; i < doc.getPageCount(); i++) {
          const pdfPage = doc.getPage(i);
          const pdfBuiltInRot = pdfPage.getRotation().angle || 0;
          const rendered = await _renderPdfJsPageToDataURL(pdfJsDoc, i);
          const visualW = rendered.visualW;
          const visualH = rendered.visualH;
          editPages.push({ id: uid(), pdfBytes: bytes, pdfPageIndex: i, imageDataURL: null, renderURL: rendered.dataURL, rotation: 0, pdfBuiltInRotation: pdfBuiltInRot, widthPt: visualW, heightPt: visualH, origWidthPt: visualW, origHeightPt: visualH, overlayObjects: [] });
        }
      } finally {
        document.body.style.cursor = '';
      }
    }
  }
  _renderEditThumbs(); _updateEditPlaceholder();
  _saveHistory();
}

async function _loadPdfPages(arrayBuffer) {
  try {
    document.body.style.cursor = 'wait';
    const doc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    editPages = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const pdfPage = doc.getPage(i);
      const pdfBuiltInRot = pdfPage.getRotation().angle || 0;
      const rendered = await _renderPdfJsPageToDataURL(pdfJsDoc, i);
      const visualW = rendered.visualW;
      const visualH = rendered.visualH;
      editPages.push({ id: uid(), pdfBytes: arrayBuffer, pdfPageIndex: i, renderURL: rendered.dataURL, rotation: 0, pdfBuiltInRotation: pdfBuiltInRot, widthPt: visualW, heightPt: visualH, origWidthPt: visualW, origHeightPt: visualH, overlayObjects: [] });
    }
  } catch(e) { 
    alert('Lỗi file PDF: ' + e.message); 
  } finally {
    document.body.style.cursor = '';
  }
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
