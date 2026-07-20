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
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept.join(',');
  input.multiple = accept.length > 1;
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    try { await _handleEditFileDrop(Array.from(input.files)); }
    finally { input.remove(); }
  }, { once: true });
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.click();
}

const EDIT_DEFAULT_SCAN_PPI = 300;
const EDIT_PREVIEW_BASE_SCALE = 1.5;
const EDIT_PREVIEW_MAX_PIXELS = 18000000;
const _editPdfJsDocPromises = new WeakMap();
const _editPreviewJobs = new Map();

function _getEditPdfJsDocument(pdfBytes) {
  if (!pdfBytes || (typeof pdfBytes !== 'object' && typeof pdfBytes !== 'function')) {
    return Promise.reject(new Error('PDF bytes are unavailable.'));
  }
  let promise = _editPdfJsDocPromises.get(pdfBytes);
  if (!promise) {
    const data = pdfBytes instanceof ArrayBuffer
      ? new Uint8Array(pdfBytes.slice(0))
      : new Uint8Array(pdfBytes);
    promise = pdfjsLib.getDocument({ data }).promise;
    _editPdfJsDocPromises.set(pdfBytes, promise);
  }
  return promise;
}

function _editMultiplyPdfMatrix(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function _editPdfJsObject(page, objectId) {
  if (!objectId) return null;
  const stores = [page.objs, page.commonObjs].filter(Boolean);
  for (const store of stores) {
    try {
      if (store.has(objectId)) return store.get(objectId);
    } catch (_) { /* Object is not resolved in this store. */ }
  }
  return null;
}

function _editWeightedMedian(entries, valueKey) {
  if (!entries.length) return EDIT_DEFAULT_SCAN_PPI;
  const sorted = entries.slice().sort((a, b) => a[valueKey] - b[valueKey]);
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  let accumulated = 0;
  for (const entry of sorted) {
    accumulated += entry.weight;
    if (accumulated >= total / 2) return entry[valueKey];
  }
  return sorted[sorted.length - 1][valueKey];
}

async function _detectPdfRasterProfile(page, viewportAtOne) {
  const fallback = {
    type: 'unknown', ppiX: EDIT_DEFAULT_SCAN_PPI, ppiY: EDIT_DEFAULT_SCAN_PPI,
    pixelsPerPointX: EDIT_DEFAULT_SCAN_PPI / 72,
    pixelsPerPointY: EDIT_DEFAULT_SCAN_PPI / 72,
    confidence: 0, detected: false
  };
  try {
    const operatorList = await page.getOperatorList({ intent: 'display' });
    const OPS = pdfjsLib.OPS || {};
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const candidates = [];
    const pageArea = Math.max(1, viewportAtOne.width * viewportAtOne.height);
    const userUnit = Number(page.userUnit) > 0 ? Number(page.userUnit) : 1;

    for (let index = 0; index < operatorList.fnArray.length; index++) {
      const fn = operatorList.fnArray[index];
      const args = operatorList.argsArray[index] || [];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
        continue;
      }
      if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        continue;
      }
      if (fn === OPS.transform && args.length >= 6) {
        ctm = _editMultiplyPdfMatrix(ctm, args.slice(0, 6).map(Number));
        continue;
      }

      const isInline = fn === OPS.paintInlineImageXObject;
      const isImage = fn === OPS.paintImageXObject ||
        (OPS.paintJpegXObject !== undefined && fn === OPS.paintJpegXObject) || isInline;
      if (!isImage) continue;

      const objectData = isInline ? args[0] : _editPdfJsObject(page, args[0]);
      const pixelWidth = Number(objectData?.width || args[1]);
      const pixelHeight = Number(objectData?.height || args[2]);
      if (!(pixelWidth > 0) || !(pixelHeight > 0)) continue;

      const widthPt = Math.hypot(ctm[0], ctm[1]) * userUnit;
      const heightPt = Math.hypot(ctm[2], ctm[3]) * userUnit;
      if (!(widthPt > 0.5) || !(heightPt > 0.5)) continue;
      const ppiX = pixelWidth * 72 / widthPt;
      const ppiY = pixelHeight * 72 / heightPt;
      if (ppiX < 36 || ppiY < 36 || ppiX > 2400 || ppiY > 2400) continue;
      const coverage = Math.min(1, Math.abs(widthPt * heightPt) / pageArea);
      candidates.push({ ppiX, ppiY, coverage, weight: Math.max(0.001, coverage) });
    }

    if (!candidates.length) return fallback;
    const dominant = candidates.slice().sort((a, b) => b.coverage - a.coverage)[0];
    const useful = candidates.filter(item => item.coverage >= Math.max(0.02, dominant.coverage * 0.08));
    const ppiX = Math.round(_editWeightedMedian(useful, 'ppiX'));
    const ppiY = Math.round(_editWeightedMedian(useful, 'ppiY'));
    return {
      type: dominant.coverage >= 0.65 ? 'scan' : 'mixed',
      ppiX, ppiY,
      pixelsPerPointX: ppiX / 72,
      pixelsPerPointY: ppiY / 72,
      confidence: Math.round(Math.min(0.99, dominant.coverage) * 100) / 100,
      coverage: dominant.coverage,
      detected: true
    };
  } catch (error) {
    console.warn('[PDF PPI] Falling back to 300 PPI:', error);
    return fallback;
  }
}

function _limitEditRenderScale(widthPt, heightPt, requestedScale) {
  const safeScale = Math.max(1, Number(requestedScale) || EDIT_PREVIEW_BASE_SCALE);
  const pixelLimitScale = Math.sqrt(EDIT_PREVIEW_MAX_PIXELS / Math.max(1, widthPt * heightPt));
  const sideLimitScale = 8192 / Math.max(1, widthPt, heightPt);
  return Math.max(1, Math.min(safeScale, pixelLimitScale, sideLimitScale));
}

async function _ensureAdaptivePagePreview(pg, forceSourceQuality = false) {
  if (!pg?.pdfBytes || pg.pdfPageIndex == null) return pg?.renderURL || null;
  const sourcePpi = Math.max(
    Number(pg.rasterProfile?.ppiX) || EDIT_DEFAULT_SCAN_PPI,
    Number(pg.rasterProfile?.ppiY) || EDIT_DEFAULT_SCAN_PPI
  );
  const screenScale = Math.max(1, editorScale * editZoom * (window.devicePixelRatio || 1));
  const desiredScale = forceSourceQuality
    ? sourcePpi / 72
    : Math.min(sourcePpi / 72, screenScale);
  const targetScale = _limitEditRenderScale(
    pg.origWidthPt || pg.widthPt,
    pg.origHeightPt || pg.heightPt,
    desiredScale
  );
  if ((Number(pg.renderScale) || 0) >= targetScale * 0.94) return pg.renderURL;

  const existingJob = _editPreviewJobs.get(pg.id);
  if (existingJob && existingJob.targetScale >= targetScale * 0.94) return existingJob.promise;

  const promise = (async () => {
    const pdfDoc = await _getEditPdfJsDocument(pg.pdfBytes);
    const page = await pdfDoc.getPage(pg.pdfPageIndex + 1);
    const viewport = page.getViewport({ scale: targetScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'display' }).promise;
    const renderedURL = canvas.toDataURL('image/png');
    const activeJob = _editPreviewJobs.get(pg.id);
    // A slower low-resolution render must never overwrite a newer, sharper job.
    if (activeJob?.promise !== promise && activeJob?.targetScale > targetScale) return pg.renderURL;
    pg.renderURL = renderedURL;
    pg.renderScale = targetScale;

    const area = document.getElementById('edit-canvas-area');
    if (area?._currentPg?.id === pg.id) {
      const background = area.querySelector('.edit-bg-layer img');
      if (background) {
        background.src = pg.renderURL;
        if (typeof background.decode === 'function') {
          try { await background.decode(); } catch (_) { /* onload remains the fallback */ }
        }
      }
    }
    return pg.renderURL;
  })().finally(() => {
    if (_editPreviewJobs.get(pg.id)?.promise === promise) _editPreviewJobs.delete(pg.id);
  });
  _editPreviewJobs.set(pg.id, { targetScale, promise });
  return promise;
}

// Render trang PDF thành dataURL VÀ trả kèm kích thước visual (đã apply rotation)
async function _renderPdfJsPageToDataURL(pdfJsDoc, pageIndex) {
  try {
    const page = await pdfJsDoc.getPage(pageIndex + 1);
    // scale=1.0 để lấy visual dimensions chính xác (pdfjsLib đã tính rotation)
    const vpScale1 = page.getViewport({ scale: 1.0 });
    const viewport = page.getViewport({ scale: EDIT_PREVIEW_BASE_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    const rasterProfile = await _detectPdfRasterProfile(page, vpScale1);
    return {
      dataURL: canvas.toDataURL('image/png'),
      visualW: vpScale1.width,   // chiều rộng visual (pts, sau khi apply PDF rotation)
      visualH: vpScale1.height,  // chiều cao visual
      renderScale: EDIT_PREVIEW_BASE_SCALE,
      rasterProfile
    };
  } catch(e) {
    return {
      dataURL: null, visualW: 595, visualH: 842,
      renderScale: EDIT_PREVIEW_BASE_SCALE,
      rasterProfile: {
        type: 'unknown', ppiX: EDIT_DEFAULT_SCAN_PPI, ppiY: EDIT_DEFAULT_SCAN_PPI,
        pixelsPerPointX: EDIT_DEFAULT_SCAN_PPI / 72,
        pixelsPerPointY: EDIT_DEFAULT_SCAN_PPI / 72,
        confidence: 0, detected: false
      }
    };
  }
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
        const pdfJsDoc = await _getEditPdfJsDocument(bytes);
        for (let i = 0; i < doc.getPageCount(); i++) {
          const pdfPage = doc.getPage(i);
          const pdfBuiltInRot = pdfPage.getRotation().angle || 0;
          const rendered = await _renderPdfJsPageToDataURL(pdfJsDoc, i);
          const visualW = rendered.visualW;
          const visualH = rendered.visualH;
          editPages.push({
            id: uid(), pdfBytes: bytes, pdfPageIndex: i, imageDataURL: null,
            renderURL: rendered.dataURL, previewURLLow: rendered.dataURL,
            renderScale: rendered.renderScale, rasterProfile: rendered.rasterProfile,
            rotation: 0, pdfBuiltInRotation: pdfBuiltInRot,
            widthPt: visualW, heightPt: visualH,
            origWidthPt: visualW, origHeightPt: visualH, overlayObjects: []
          });
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
    const pdfJsDoc = await _getEditPdfJsDocument(arrayBuffer);
    editPages = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const pdfPage = doc.getPage(i);
      const pdfBuiltInRot = pdfPage.getRotation().angle || 0;
      const rendered = await _renderPdfJsPageToDataURL(pdfJsDoc, i);
      const visualW = rendered.visualW;
      const visualH = rendered.visualH;
      editPages.push({
        id: uid(), pdfBytes: arrayBuffer, pdfPageIndex: i,
        renderURL: rendered.dataURL, previewURLLow: rendered.dataURL,
        renderScale: rendered.renderScale, rasterProfile: rendered.rasterProfile,
        rotation: 0, pdfBuiltInRotation: pdfBuiltInRot,
        widthPt: visualW, heightPt: visualH,
        origWidthPt: visualW, origHeightPt: visualH, overlayObjects: []
      });
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
