/* ══════════════════════════════════════════════
   pdf.js — PDF tools module
   Depends on: pdf-lib (global PDFLib), utils.js
   ══════════════════════════════════════════════ */

/* ────────────────────────────────────────────
   DROPZONE CLASS
   Manages a single drag-drop file area.
   ──────────────────────────────────────────── */
class DropZone {
  /**
   * @param {object} opts
   * @param {string}   opts.dzId          — drop-zone element id
   * @param {string}   opts.triggerId     — "+" button id
   * @param {string}   opts.thumbsId      — thumbs container id
   * @param {string}   opts.placeholderId — placeholder div id
   * @param {string}   opts.accept        — file input accept string
   * @param {'image'|'pdf'} opts.mode
   * @param {function} opts.onChange      — called whenever items change
   */
  constructor(opts) {
    this.dzEl        = document.getElementById(opts.dzId);
    this.trigger     = document.getElementById(opts.triggerId);
    this.thumbsEl    = document.getElementById(opts.thumbsId);
    this.placeholder = document.getElementById(opts.placeholderId);
    this.accept      = opts.accept;
    this.mode        = opts.mode;        // 'image' | 'pdf'
    this.onChange    = opts.onChange || (() => {});

    // Each item: { file, dataURL (images) | null (pdfs), id }
    this.items = [];
    this._dragSrcId = null;

    this._bindEvents();
  }

  /* ── Events ── */
  _bindEvents() {
    // Click "+" or anywhere on empty zone
    this.trigger.addEventListener('click', () => this._openFilePicker());
    this.dzEl.addEventListener('click', e => {
      if (e.target === this.dzEl || e.target.closest('.dz-placeholder')) {
        this._openFilePicker();
      }
    });

    // Native drag-and-drop (files from OS)
    this.dzEl.addEventListener('dragover',  e => { e.preventDefault(); this.dzEl.classList.add('dragover'); });
    this.dzEl.addEventListener('dragleave', e => { if (!this.dzEl.contains(e.relatedTarget)) this.dzEl.classList.remove('dragover'); });
    this.dzEl.addEventListener('drop',      e => {
      e.preventDefault();
      this.dzEl.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      this._addFiles(files);
    });
  }

  _openFilePicker() {
    const input = document.createElement('input');
    input.type     = 'file';
    input.accept   = this.accept;
    input.multiple = true;
    input.addEventListener('change', () => this._addFiles(Array.from(input.files)));
    input.click();
  }

  /* ── Add files ── */
  async _addFiles(files) {
    const valid = files.filter(f => this._fileValid(f));
    for (const file of valid) {
      const id = `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (this.mode === 'image') {
        const dataURL = await readFileAsDataURL(file);
        this.items.push({ id, file, dataURL });
      } else {
        this.items.push({ id, file, dataURL: null });
      }
    }
    this._render();
    this.onChange(this.items);
  }

  _fileValid(file) {
    if (this.mode === 'image') return file.type.startsWith('image/');
    if (this.mode === 'pdf')   return file.type === 'application/pdf' || file.name.endsWith('.pdf');
    return false;
  }

  /* ── Render thumbs ── */
  _render() {
    this.thumbsEl.innerHTML = '';
    const isEmpty = this.items.length === 0;
    this.placeholder.classList.toggle('hidden', !isEmpty);

    this.items.forEach((item, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'dz-thumb';
      thumb.dataset.id = item.id;
      thumb.draggable = true;

      if (this.mode === 'image') {
        const img = document.createElement('img');
        img.src = item.dataURL;
        img.alt = item.file.name;
        thumb.appendChild(img);
      } else {
        // PDF thumb — dùng DOM API để tránh XSS từ tên file
        const inner = document.createElement('div');
        inner.className = 'dz-thumb-pdf';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'pdf-icon';
        iconSpan.textContent = '📄';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'pdf-name';
        nameSpan.textContent = item.file.name; // safe: textContent không interpret HTML
        inner.appendChild(iconSpan);
        inner.appendChild(nameSpan);
        thumb.appendChild(inner);
      }

      // Page number badge
      const badge = document.createElement('span');
      badge.className = 'dz-page-num';
      badge.textContent = idx + 1;
      thumb.appendChild(badge);

      // Remove button
      const rmBtn = document.createElement('button');
      rmBtn.className = 'dz-remove';
      rmBtn.title = 'Xóa';
      rmBtn.innerHTML = '&times;';
      rmBtn.addEventListener('click', e => {
        e.stopPropagation();
        this._removeItem(item.id);
      });
      thumb.appendChild(rmBtn);

      // Thumb drag-to-reorder
      this._bindThumbDrag(thumb, item.id);

      this.thumbsEl.appendChild(thumb);
    });
  }

  /* ── Remove ── */
  _removeItem(id) {
    this.items = this.items.filter(i => i.id !== id);
    this._render();
    this.onChange(this.items);
  }

  /* ── Drag-to-reorder ── */
  _bindThumbDrag(thumbEl, id) {
    thumbEl.addEventListener('dragstart', e => {
      this._dragSrcId = id;
      thumbEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // prevent OS drag-drop handler
      e.dataTransfer.setData('text/plain', id);
    });

    thumbEl.addEventListener('dragend', () => {
      thumbEl.classList.remove('dragging');
      this.thumbsEl.querySelectorAll('.dz-thumb').forEach(t => t.classList.remove('drag-over'));
    });

    thumbEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      if (this._dragSrcId !== id) thumbEl.classList.add('drag-over');
    });

    thumbEl.addEventListener('dragleave', () => {
      thumbEl.classList.remove('drag-over');
    });

    thumbEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      thumbEl.classList.remove('drag-over');
      if (this._dragSrcId && this._dragSrcId !== id) {
        this._reorder(this._dragSrcId, id);
      }
    });
  }

  _reorder(fromId, toId) {
    const fromIdx = this.items.findIndex(i => i.id === fromId);
    const toIdx   = this.items.findIndex(i => i.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = this.items.splice(fromIdx, 1);
    this.items.splice(toIdx, 0, moved);
    this._render();
    this.onChange(this.items);
  }

  /* ── Public ── */
  getItems() { return this.items; }
  clear()    { this.items = []; this._render(); this.onChange([]); }
}

/* ────────────────────────────────────────────
   QUALITY SCALE FACTORS
   ──────────────────────────────────────────── */
const QUALITY_SCALE = { none: 1.0, medium: 0.6, strong: 0.35 };
const COMPRESS_SCALE = { none: 1.0, medium: 0.65, strong: 0.4 };

/* A4 in points (72 dpi): 595 × 842 */
const A4_W_PT = 595, A4_H_PT = 842;

/* ────────────────────────────────────────────
   COMBINE IMAGES → PDF
   ──────────────────────────────────────────── */
async function combineImagesToPDF(items, paperSize, qualityKey) {
  if (!items.length) { alert('Chưa có ảnh nào!'); return; }

  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const scale  = QUALITY_SCALE[qualityKey] ?? 1;

  for (const item of items) {
    // Down-sample via canvas if quality reduction needed
    const dataURL = scale < 1
      ? await resizeImageDataURL(item.dataURL, scale)
      : item.dataURL;

    const isJpeg = dataURL.startsWith('data:image/jpeg') || dataURL.startsWith('data:image/jpg');
    const base64 = dataURL.split(',')[1];
    const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    let img;
    try {
      img = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
    } catch {
      // Convert to PNG via canvas as fallback
      const pngDataURL = await convertToPNG(item.dataURL);
      const pngBase64  = pngDataURL.split(',')[1];
      const pngBytes   = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
      img = await pdfDoc.embedPng(pngBytes);
    }

    const { width: imgW, height: imgH } = img;

    let pageW, pageH;
    if (paperSize === 'fit') {
      pageW = imgW; pageH = imgH;
    } else if (paperSize === 'a4v') {
      pageW = A4_W_PT; pageH = A4_H_PT;
    } else {
      pageW = A4_H_PT; pageH = A4_W_PT; // a4h
    }

    const page = pdfDoc.addPage([pageW, pageH]);

    // Scale image to fit page while preserving aspect ratio
    const ratio = Math.min(pageW / imgW, pageH / imgH);
    const drawW = imgW * ratio;
    const drawH = imgH * ratio;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    page.drawImage(img, { x, y, width: drawW, height: drawH });
  }

  const bytes = await pdfDoc.save();
  triggerDownload(new Blob([bytes], { type: 'application/pdf' }), 'combined.pdf');
}

/* ────────────────────────────────────────────
   MERGE PDFs
   ──────────────────────────────────────────── */
async function mergePDFs(items, compressKey) {
  if (!items.length) { alert('Chưa có PDF nào!'); return; }

  const { PDFDocument } = PDFLib;
  const mergedDoc = await PDFDocument.create();
  const scale = COMPRESS_SCALE[compressKey] ?? 1;

  for (const item of items) {
    const arrayBuffer = await readFileAsArrayBuffer(item.file);
    const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pageIndices = srcDoc.getPageIndices();
    const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(page => {
      // If compression requested, scale page dimensions
      if (scale < 1) {
        const { width, height } = page.getSize();
        page.setSize(width * scale, height * scale);
        page.scaleContent(scale, scale);
      }
      mergedDoc.addPage(page);
    });
  }

  const bytes = await mergedDoc.save();
  triggerDownload(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
}

/* ────────────────────────────────────────────
   IMAGE UTILITY HELPERS
   ──────────────────────────────────────────── */
function resizeImageDataURL(dataURL, scale) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = dataURL;
  });
}

// convertToPNG đã được chuyển vào utils.js — dùng chung với edit-pdf.js

/* ────────────────────────────────────────────
   INIT
   ──────────────────────────────────────────── */
function initPDF() {
  /* Drop zones (Combine Image) */
  if (document.getElementById('dz-images')) {
    const imageDZ = new DropZone({
      dzId:          'dz-images',
      triggerId:     'dz-images-trigger',
      thumbsId:      'dz-images-thumbs',
      placeholderId: 'dz-images-placeholder',
      accept:        'image/*,.tiff,.tif',
      mode:          'image',
    });

    const btnCombine = document.getElementById('btn-combine');
    if (btnCombine) {
      btnCombine.addEventListener('click', async () => {
        btnCombine.disabled = true;
        btnCombine.textContent = 'Đang xử lý…';
        try {
          const paperSize = document.getElementById('opt-papersize').value;
          const quality   = document.getElementById('opt-quality').value;
          await combineImagesToPDF(imageDZ.getItems(), paperSize, quality);
        } catch(e) {
          console.error(e);
          alert('Có lỗi xảy ra: ' + e.message);
        } finally {
          btnCombine.disabled = false;
          btnCombine.textContent = 'Download PDF';
        }
      });
    }
  }

  /* Drop zones (Merge PDF) */
  if (document.getElementById('dz-pdfs')) {
    const pdfDZ = new DropZone({
      dzId:          'dz-pdfs',
      triggerId:     'dz-pdfs-trigger',
      thumbsId:      'dz-pdfs-thumbs',
      placeholderId: 'dz-pdfs-placeholder',
      accept:        '.pdf,application/pdf',
      mode:          'pdf',
    });

    const btnMerge = document.getElementById('btn-merge');
    if (btnMerge) {
      btnMerge.addEventListener('click', async () => {
        btnMerge.disabled = true;
        btnMerge.textContent = 'Đang xử lý…';
        try {
          const compress = document.getElementById('opt-compress').value;
          await mergePDFs(pdfDZ.getItems(), compress);
        } catch(e) {
          console.error(e);
          alert('Có lỗi xảy ra: ' + e.message);
        } finally {
          btnMerge.disabled = false;
          btnMerge.textContent = 'Download PDF';
        }
      });
    }
  }
}