/* ══════════════════════════════════════════════
   edit-pdf-toolbar.js — Toolbar, keyboard, format controls & zoom
   Chứa: _bindKeyboardShortcuts, _bindEditButtons,
         _bindTextFormatControls, _applyTextFormat, _updateTextControls,
         _updateCanvasZoom, _bindZoomControls
   Phụ thuộc: edit-pdf-state.js, edit-pdf-canvas.js, edit-pdf-shapes.js,
               edit-pdf-export.js, edit-pdf-dropzone.js
   ══════════════════════════════════════════════ */

/**
 * Bind keyboard shortcuts: Delete/Backspace, Ctrl+C, Ctrl+V.
 * Được extract ra khỏi initEditPDF() để đặt ở đây cho rõ ràng hơn.
 */
function _bindKeyboardShortcuts() {
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
        _saveHistory();
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
        _saveHistory();
      }
      e.preventDefault();
    }
    
    // ── Ctrl+Z / Ctrl+Y: Undo / Redo ──
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) _redo();
      else _undo();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      _redo();
      e.preventDefault();
      return;
    }
    // ── Enter: Apply crop ──
    if (e.key === 'Enter') {
      const pg = _getCurrentPg();
      if (pg) {
        const cropbox = pg.overlayObjects.find(o => o.type === 'cropbox');
        if (cropbox) {
          e.preventDefault();
          _applyCropToPage(pg, cropbox); // Defined in edit-pdf-export.js
        }
      }
    }
  });
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
      _saveHistory();
    });
  }

async function _createBlurredEdgeImage(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      
      // Giảm độ blur đi 40% (từ 0.08 xuống ~0.048)
      const blur = Math.min(w, h) * 0.048; 
      
      // Bước 1: Tạo mask mờ dần ở viền
      ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = 'black';
      
      // Tính toán vùng padding đủ lớn (khoảng 2.5 lần blur) để viền mờ 
      // fade out hoàn toàn thành trong suốt trước khi chạm mép khung ảnh,
      // giúp tránh bị xén ngọt (clipping) ở mép ngoài.
      const pad = blur * 2.5;
      ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);
      
      // Bước 2: Ghép ảnh gốc vào, lấy phần alpha của mask
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(img, 0, 0, w, h);
      
      // Xuất ra dạng PNG để giữ được alpha channel (độ trong suốt)
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

  const btnImg = document.getElementById('edit-btn-image');
  if (btnImg) {
    btnImg.addEventListener('click', (e) => {
      const isBlurMode = e.ctrlKey || e.metaKey;
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      activeShapeTool = null;
      _cancelLinePending();
      _resetCanvasCursor();

      const pg = _getCurrentPg();
      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      // Đã hỗ trợ định dạng TIFF/TIF
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,.tiff,.tif';
      input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        let dataURL = await readFileAsDataURL(input.files[0]);
        if (isBlurMode) {
          dataURL = await _createBlurredEdgeImage(dataURL);
        }
        // Tải ảnh để lấy tỉ lệ gốc trước khi tạo object
        const imgEl = new Image();
        imgEl.src = dataURL;
        await new Promise(res => { imgEl.onload = res; imgEl.onerror = res; });
        const naturalW = imgEl.naturalWidth || 200;
        const naturalH = imgEl.naturalHeight || 150;
        // Giới hạn kích thước ban đầu: tối đa 50% kích thước page canvas,
        // đảm bảo ảnh dọc không tràn ra ngoài trang ngang
        const pageCanvasW = pg.widthPt * editorScale;
        const pageCanvasH = pg.heightPt * editorScale;
        const maxW = pageCanvasW * 0.5;
        const maxH = pageCanvasH * 0.5;
        const ratio = Math.min(maxW / naturalW, maxH / naturalH, 1);
        const objW = Math.round(naturalW * ratio);
        const objH = Math.round(naturalH * ratio);
        const obj = {
          id: uid(), type: 'image', x: Math.round(pg.widthPt * editorScale * 0.2), y: Math.round(pg.heightPt * editorScale * 0.2),
          w: objW, h: objH, dataURL, selected: false,
        };
        pg.overlayObjects.push(obj);
        const area = document.getElementById('edit-canvas-area');
        if (area && area._overlayEl) _renderOverlayObject(obj, area._overlayEl, pg);
        _selectObject(obj, pg);
        _saveHistory();
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
      const currentShapeType = SHAPE_CYCLE[activeShapeComboIdx];
      if (activeShapeTool === currentShapeType) {
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
      document.querySelectorAll('.etb-align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (!editSelectedObj) return;
      const pg = _getCurrentPg(); if (!pg) return;
      const obj = pg.overlayObjects.find(o => o.id === editSelectedObj);
      if (!obj || obj.type !== 'text') return;

      obj.textAlign = align;

      const area = document.getElementById('edit-canvas-area');
      if (area && area._overlayEl) {
        const el = area._overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
        if (el) {
          const textDiv = el.querySelector('.edit-obj-textcontent');
          if (textDiv) textDiv.style.textAlign = align;
        }
      }
      _saveHistory();
    });
  });

  /* ESC huỷ tool shape/line + Ctrl standalone để cycle/swap combo */
  document.addEventListener('keydown', e => {
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = activeTag === 'INPUT' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);

    if (e.key === 'Escape' && activeShapeTool) {
      activeShapeTool = null;
      _cancelLinePending();
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      _resetCanvasCursor();
      return;
    }

    if ((e.key === 'Control' || e.key === 'Meta') && !isTyping) {
      if (activeShapeTool === 'rect' || activeShapeTool === 'triangle' || activeShapeTool === 'ellipse') {
        activeShapeComboIdx = (activeShapeComboIdx + 1) % SHAPE_CYCLE.length;
        activeShapeTool = SHAPE_CYCLE[activeShapeComboIdx];
        _updateShapeComboIcon();
        _setCanvasCursor(activeShapeTool);
        e.preventDefault();
      } else if (activeShapeTool === 'line') {
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

  // ── Xử lý Master Toggle "All" ──
  const masterAllBtn = document.getElementById('edit-master-all-toggle');
  let isMasterAll = false; // Trạng thái mặc định: Tắt

  if (masterAllBtn) {
    masterAllBtn.addEventListener('click', () => {
      isMasterAll = !isMasterAll;
      masterAllBtn.classList.toggle('active', isMasterAll);
    });
  }

  // ── Xử lý Paper Size ──
  const paperSizeEl = document.getElementById('edit-papersize');
  if (paperSizeEl) {
    paperSizeEl.addEventListener('change', e => { 
      const currentPg = _getCurrentPg(); 
      if (!currentPg && editPages.length === 0) return; 
      
      const val = e.target.value;
      const preset = PAPER_SIZES[val];

      const applySizeToPage = (pg) => {
        if (val === 'none') {
          pg.widthPt = pg.origWidthPt || pg.widthPt;
          pg.heightPt = pg.origHeightPt || pg.heightPt;
        } else if (preset) {
          pg.widthPt = preset.w; 
          pg.heightPt = preset.h; 
        }
      };

      if (isMasterAll) {
        editPages.forEach(pg => applySizeToPage(pg));
      } else if (currentPg) {
        applySizeToPage(currentPg);
      }
      
      if (currentPg) _openPageEditor(currentPg); 
      _renderEditThumbs(); 
    });
  }

  // ── Xử lý Rotate ── (Apply vật lý: transform tọa độ objects + swap width/height)
  const applyPhysicalRotate = (pg, angle) => {
    const isClockwise = angle > 0; // +90 = clockwise, -90 = counter-clockwise

    // Tính editorScale riêng cho từng trang (đặc biệt quan trọng khi Master All)
    const area = document.getElementById('edit-canvas-area');
    const areaW = area ? (area.clientWidth || 600) : 600;
    const areaH = area ? (area.clientHeight || 700) : 700;
    const pageScale = Math.min((areaW - 32) / pg.widthPt, (areaH - 32) / pg.heightPt, 1.5);

    // Kích thước thực trên canvas (pixel)
    const oldW = pg.widthPt * pageScale;
    const oldH = pg.heightPt * pageScale;

    // Transform tọa độ từng overlay object sang hệ tọa độ mới sau khi xoay
    pg.overlayObjects.forEach(obj => {
      const cx = obj.x + obj.w / 2;
      const cy = obj.y + obj.h / 2;

      let newCx, newCy;
      if (isClockwise) {
        // Rotate +90 (CW): (cx, cy) -> (oldH - cy, cx)
        newCx = oldH - cy;
        newCy = cx;
      } else {
        // Rotate -90 (CCW): (cx, cy) -> (cy, oldW - cx)
        newCx = cy;
        newCy = oldW - cx;
      }

      // Sau khi xoay, w và h của object cũng hoán đổi
      const newW = obj.h;
      const newH = obj.w;
      obj.x = newCx - newW / 2;
      obj.y = newCy - newH / 2;
      obj.w = newW;
      obj.h = newH;

      // Với line: cập nhật lineStartRel / lineEndRel
      if (obj.shapeType === 'line' && obj.lineStartRel && obj.lineEndRel) {
        if (isClockwise) {
          // (rx, ry) -> (1-ry, rx)
          const s = obj.lineStartRel, en = obj.lineEndRel;
          obj.lineStartRel = [1 - s[1], s[0]];
          obj.lineEndRel   = [1 - en[1], en[0]];
        } else {
          const s = obj.lineStartRel, en = obj.lineEndRel;
          obj.lineStartRel = [s[1], 1 - s[0]];
          obj.lineEndRel   = [en[1], 1 - en[0]];
        }
      }
    });

    // Hoán đổi width/height trang
    const tmpW = pg.widthPt;
    pg.widthPt = pg.heightPt;
    pg.heightPt = tmpW;
    const tmpOW = pg.origWidthPt;
    pg.origWidthPt = pg.origHeightPt;
    pg.origHeightPt = tmpOW;

    // Lưu rotation để export PDF biết xoay
    pg.rotation = ((pg.rotation || 0) + angle + 360) % 360;
  };

  const handleRotate = (angle) => {
    if (isMasterAll) {
      editPages.forEach(p => applyPhysicalRotate(p, angle));
    } else {
      const pg = _getCurrentPg();
      if (pg) applyPhysicalRotate(pg, angle);
    }
    const currentPg = _getCurrentPg();
    if (currentPg) _openPageEditor(currentPg);
    _renderEditThumbs();
    _saveHistory();
  };

  const rotate90Btn = document.getElementById('edit-rotate-90');
  if (rotate90Btn) rotate90Btn.addEventListener('click', () => handleRotate(90));

  const rotateCcwBtn = document.getElementById('edit-rotate-ccw');
  if (rotateCcwBtn) rotateCcwBtn.addEventListener('click', () => handleRotate(-90));

  // ── Xử lý Nút Crop PDF ──
  const cropBtn = document.getElementById('edit-crop-btn');
  if (cropBtn) {
    cropBtn.addEventListener('click', () => {
      const pg = _getCurrentPg();
      if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }
      
      // Tạo một đối tượng cropbox toàn màn hình nếu chưa có
      const existingCrop = pg.overlayObjects.find(o => o.type === 'cropbox');
      if (existingCrop) {
        // Nếu đã có, chọn nó
        _selectObject(existingCrop, pg);
      } else {
        // Nếu chưa có, tạo mới phủ kín trang
        const obj = {
          id: uid(), type: 'cropbox', 
          x: 0, y: 0, 
          w: pg.widthPt * editorScale, h: pg.heightPt * editorScale,
          selected: false
        };
        pg.overlayObjects.push(obj);
        const area = document.getElementById('edit-canvas-area');
        if (area && area._overlayEl) _renderOverlayObject(obj, area._overlayEl, pg);
        _selectObject(obj, pg);
        _saveHistory();
      }
    });
  }

const dlBtn = document.getElementById('edit-download-btn');
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      if (!editPages.length) { alert('Chưa có trang nào.'); return; }
      dlBtn.disabled = true; dlBtn.textContent = 'Đang xử lý…';
      try { await _buildAndDownloadEditPDF(); } catch(e) { alert('Lỗi: ' + e.message); } finally { dlBtn.disabled = false; dlBtn.textContent = 'Download PDF'; }
    });
  }

  // ── Xử lý các nút EXPORT IMAGE ──
  const exportImgPageBtn = document.getElementById('edit-export-img-page');
  if (exportImgPageBtn) {
    exportImgPageBtn.addEventListener('click', () => _exportEditImages(false));
  }

  const exportImgAllBtn = document.getElementById('edit-export-img-all');
  if (exportImgAllBtn) {
    exportImgAllBtn.addEventListener('click', () => _exportEditImages(true));
  }
}

// Bổ sung lắng nghe sự kiện cho Stroke
function _bindTextFormatControls() {
  ['edit-font', 'edit-fontsize', 'edit-fontstyle', 'edit-fontcolor',
   'edit-fillcolor', 'edit-strokecolor', 'edit-strokestyle', 'edit-strokewidth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { 
      el.addEventListener('input', () => _applyTextFormat()); 
      el.addEventListener('change', () => { _applyTextFormat(); _saveHistory(); }); 
    }
  });

  // None buttons (fill / stroke)
  const fillNoneBtn   = document.getElementById('edit-fillcolor-none');
  const strokeNoneBtn = document.getElementById('edit-strokecolor-none');

  if (fillNoneBtn) {
    fillNoneBtn.addEventListener('click', () => {
      fillNoneBtn.classList.toggle('active');
      _applyTextFormat();
      _saveHistory();
    });
  }
  if (strokeNoneBtn) {
    strokeNoneBtn.addEventListener('click', () => {
      strokeNoneBtn.classList.toggle('active');
      _applyTextFormat();
      _saveHistory();
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

// _updateFontColorHex: đã xoá — không còn cần thiết sau khi loại bỏ hex display

/* ════════════════════════════════════════════
   HỆ THỐNG ĐIỀU KHIỂN ZOOM (Phóng to / Thu nhỏ Canvas)
   ════════════════════════════════════════════ */

function _updateCanvasZoom() {
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._currentPg) return;
  const pg = area._currentPg;
  const wrapper = document.getElementById('edit-page-wrapper');
  const pageEl = area.querySelector('.edit-page-canvas');
  if (!wrapper || !pageEl) return;
  
  wrapper.style.width = Math.round(pg.widthPt * editorScale * editZoom) + 'px';
  wrapper.style.height = Math.round(pg.heightPt * editorScale * editZoom) + 'px';
  pageEl.style.transform = `scale(${editZoom})`;
}

function _bindZoomControls() {
  const zoomInput = document.getElementById('edit-zoom-input');
  const zoomInBtn = document.getElementById('edit-zoom-in');
  const zoomOutBtn = document.getElementById('edit-zoom-out');

  function setZoom(val) {
    // Chặn giới hạn Zoom từ 1 đến 5 (theo yêu cầu)
    editZoom = Math.max(1, Math.min(5, val));
    if (zoomInput) zoomInput.value = editZoom.toFixed(1);
    _updateCanvasZoom();
  }

  if (zoomInput) {
    zoomInput.addEventListener('change', e => setZoom(parseFloat(e.target.value) || 1));
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => setZoom(editZoom + 0.2));
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => setZoom(editZoom - 0.2));
  }
}
