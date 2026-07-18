/* ══════════════════════════════════════════════
   edit-pdf-ai.js — AI Generative Fill
   Sử dụng: Cloudflare Workers AI (miễn phí 10k neurons/ngày)
   Model: @cf/runwayml/stable-diffusion-v1-5-inpainting
   Hướng dẫn deploy Worker: xem cloudflare_worker.js
   ══════════════════════════════════════════════ */

// ── Config ──
// Sau khi deploy Cloudflare Worker, paste URL vào đây:
const CF_WORKER_URL = 'https://pdf-ai-fill.duchieudndh.workers.dev';

// ── State ──
let _aiActive = false;         // Tool AI đang bật?
let _aiDragState = null;       // Trạng thái kéo vùng chọn
let _aiSelectionEl = null;     // DOM element vùng chọn
let _aiOverlayDimEl = null;    // DOM element làm tối xung quanh
let _aiSelectionRect = null;   // { x, y, w, h } trong tọa độ overlay

/* ════════════════════════════════════════════
   KHỞI TẠO — gọi từ initEditPDF()
   ════════════════════════════════════════════ */
function initAITool() {
  const btn = document.getElementById('ai-fill-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const pg = _getCurrentPg();
    if (!pg) { alert('Vui lòng chọn một trang trước.'); return; }

    if (_aiActive) {
      _cancelAITool();
      return;
    }

    _aiActive = true;
    btn.classList.add('active');

    // Tắt các tool shape khác
    activeShapeTool = null;
    _cancelLinePending();
    document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));

    // Đổi cursor canvas
    const canvasArea = document.getElementById('edit-canvas-area');
    if (canvasArea) canvasArea.style.cursor = 'crosshair';

    _bindAICanvasEvents();
  });
}

/* ════════════════════════════════════════════
   BIND SỰ KIỆN VẼ VÙNG CHỌN TRÊN CANVAS
   ════════════════════════════════════════════ */
function _bindAICanvasEvents() {
  const canvasArea = document.getElementById('edit-canvas-area');
  if (!canvasArea) return;

  function onMousedown(e) {
    if (!_aiActive) return;
    const area = document.getElementById('edit-canvas-area');
    if (!area || !area._overlayEl || !area._currentPg) return;

    // Chỉ phản hồi click trái trực tiếp lên canvas / page
    const overlayEl = area._overlayEl;
    const pageEl = overlayEl.parentElement;
    if (!pageEl || !pageEl.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const startPos = _getOverlayRelativePos(e);
    if (!startPos) return;

    // Tạo element vùng chọn
    _removeAISelectionEl();

    const selEl = document.createElement('div');
    selEl.id = 'ai-selection-box';
    selEl.style.cssText = `
      position: absolute;
      left: ${startPos.x}px; top: ${startPos.y}px;
      width: 0; height: 0;
      border: 2px dashed #6c47ff;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 8000;
      border-radius: 3px;
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
      clip-path: inset(-9999px -9999px -9999px -9999px);
    `;
    overlayEl.appendChild(selEl);
    _aiSelectionEl = selEl;

    let sx = startPos.x, sy = startPos.y;

    function onMove(e2) {
      const pos = _getOverlayRelativePos(e2);
      if (!pos) return;

      const dx = pos.x - sx;
      const dy = pos.y - sy;

      const x = dx >= 0 ? sx : sx + dx;
      const y = dy >= 0 ? sy : sy + dy;
      const w = Math.abs(dx);
      const h = Math.abs(dy);

      selEl.style.left = x + 'px';
      selEl.style.top  = y + 'px';
      selEl.style.width  = Math.max(1, w) + 'px';
      selEl.style.height = Math.max(1, h) + 'px';

      _aiSelectionRect = { x, y, w, h };
    }

    function onUp(e2) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      if (!_aiSelectionRect || _aiSelectionRect.w < 10 || _aiSelectionRect.h < 10) {
        _removeAISelectionEl();
        return;
      }

      // Hiển thị dialog nhập prompt
      _showAIPromptDialog();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    _aiDragState = { onMove, onUp };
  }

  canvasArea.addEventListener('mousedown', onMousedown);
  // Lưu ref để có thể remove sau
  canvasArea._aiMousedown = onMousedown;
}

/* ════════════════════════════════════════════
   DIALOG NHẬP PROMPT
   ════════════════════════════════════════════ */
function _showAIPromptDialog() {
  // Remove dialog cũ nếu có
  document.getElementById('ai-prompt-dialog')?.remove();

  const dialog = document.createElement('div');
  dialog.id = 'ai-prompt-dialog';
  dialog.innerHTML = `
    <div class="ai-dialog-backdrop"></div>
    <div class="ai-dialog-box">
      <div class="ai-dialog-header">
        <span class="ai-dialog-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </span>
        <span class="ai-dialog-title">Sửa Chữ Nâng Cao</span>
      </div>
      <div class="ai-dialog-body" style="padding-top: 10px;">
        
        <!-- Mode: Text -->
        <div id="ai-mode-text" style="display: block;">
          <p class="ai-dialog-hint">Nhập chữ mới bạn muốn chèn vào bản scan</p>
          <textarea id="ai-prompt-input" class="ai-prompt-textarea" 
            placeholder="Ví dụ: CÔNG TY"
            rows="2" spellcheck="false"></textarea>
          
          <div class="ai-font-controls" style="margin-top: 8px; display: flex; gap: 8px; font-size: 12px; align-items: center;">
            <select id="ai-font-family" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; flex: 1;">
              <option value="Arial">Font: Arial</option>
              <option value="Times New Roman">Font: Times New Roman</option>
              <option value="Courier New">Font: Courier New</option>
              <option value="Verdana">Font: Verdana</option>
              <option value="Tahoma">Font: Tahoma</option>
            </select>
            <select id="ai-font-weight" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; width: 80px;">
              <option value="normal">Thường</option>
              <option value="bold" selected>Đậm</option>
            </select>
            <select id="ai-font-style" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; width: 85px;">
              <option value="normal">Thẳng</option>
              <option value="italic">Nghiêng</option>
            </select>

            <input type="color" id="ai-text-color" value="#000000" style="padding: 0; border: 1px solid #ccc; border-radius: 4px; height: 26px; width: 30px; cursor: pointer;" title="Màu chữ">
          </div>
          
          <div style="margin-top: 12px; font-size: 12px; color: #555;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Cỡ Chữ (Size): <span id="ai-font-size-val">70</span>%</span>
              <input type="range" id="ai-font-size-slider" min="10" max="150" step="1" value="70" style="width: 120px;" title="Tỷ lệ cỡ chữ so với khung chọn">
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Độ Nhòe (Blur): <span id="ai-blur-val">0.5</span>px</span>
              <input type="range" id="ai-blur-slider" min="0" max="3" step="0.1" value="0.5" style="width: 120px;">
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Nhiễu Hạt (Noise): <span id="ai-noise-val">10</span>%</span>
              <input type="range" id="ai-noise-slider" min="0" max="100" step="1" value="10" style="width: 120px;">
            </div>
          </div>
          
          <div id="ai-live-preview-container" style="margin-top: 12px; text-align: center; border: 1px dashed #ccc; padding: 4px; border-radius: 4px; min-height: 40px; display: flex; align-items: center; justify-content: center; background: #fafafa; overflow: hidden;">
             <span style="color: #999; font-size: 11px;">Bản xem trước sẽ hiện ở đây...</span>
          </div>
        </div>

        <div class="ai-dialog-info" style="margin-top: 12px;">
          <span class="ai-info-icon">📐</span>
          <span id="ai-selection-size"></span>
        </div>
      </div>
      <div class="ai-dialog-footer">
        <button id="ai-cancel-btn" class="ai-btn ai-btn-cancel">Cancel</button>
        <button id="ai-create-btn" class="ai-btn ai-btn-create">
          <span class="ai-btn-icon">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </span> Thay Chữ
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  // Hiển thị kích thước vùng chọn
  const pg = _getCurrentPg();
  if (_aiSelectionRect && pg) {
    const sizeEl = document.getElementById('ai-selection-size');
    if (sizeEl) {
      sizeEl.textContent = `Vùng chọn: ${Math.round(_aiSelectionRect.w * editorScale)} × ${Math.round(_aiSelectionRect.h * editorScale)} px canvas`;
    }
  }

  // Live Preview Logic
  let capturedBase64ForPreview = null;
  if (pg && _aiSelectionRect) {
    _captureSelectionRegion(pg, _aiSelectionRect).then(async base64 => {
      capturedBase64ForPreview = base64;
      
      // Auto-detect Text Color
      const detectedColor = await _extractDominantTextColor(base64);
      const colorInput = document.getElementById('ai-text-color');
      if (colorInput) colorInput.value = detectedColor;

      // Auto-detect Text Height
      const detectedHeightPct = await _detectTextHeightPct(base64);
      const fontSizeSlider = document.getElementById('ai-font-size-slider');
      const fontSizeVal = document.getElementById('ai-font-size-val');
      if (fontSizeSlider && fontSizeVal) {
        const pctVal = Math.round(detectedHeightPct * 100);
        fontSizeSlider.value = pctVal;
        fontSizeVal.textContent = pctVal;
      }

      _updateLivePreview();
    });
  }

  async function _updateLivePreview() {
    if (!capturedBase64ForPreview) return;
    const container = document.getElementById('ai-live-preview-container');
    if (!container) return;

    const prompt = document.getElementById('ai-prompt-input')?.value?.trim();
    if (!prompt) {
      container.innerHTML = '<span style="color: #999; font-size: 11px;">Nhập chữ để xem trước...</span>';
      return;
    }

    const manualStyle = { 
      fontFamily: document.getElementById('ai-font-family')?.value || 'Arial', 
      fontWeight: document.getElementById('ai-font-weight')?.value || 'bold', 
      fontStyle: document.getElementById('ai-font-style')?.value || 'normal',
      textAlign: document.getElementById('ai-text-align')?.value || 'left',
      textColor: document.getElementById('ai-text-color')?.value || '#000000',
      fontSizePct: parseFloat(document.getElementById('ai-font-size-slider')?.value || '70') / 100,
      blurPx: parseFloat(document.getElementById('ai-blur-slider')?.value || '0.5'),
      noiseAlpha: parseFloat(document.getElementById('ai-noise-slider')?.value || '10') / 100
    };

    const renderObj = await _localSmartTextReplacement(capturedBase64ForPreview, prompt, manualStyle);
    container.innerHTML = `<img src="${renderObj.dataURL}" style="max-width: 100%; max-height: 100px; object-fit: contain; border: 1px solid #eee; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">`;
  }

  // Focus textarea & trigger preview on type
  setTimeout(() => {
    const input = document.getElementById('ai-prompt-input');
    if (input) {
      input.focus();
      input.addEventListener('input', _updateLivePreview);
    }
  }, 100);

  // Bind slider events
  const fontSizeSlider = document.getElementById('ai-font-size-slider');
  if (fontSizeSlider) fontSizeSlider.addEventListener('input', e => { 
    document.getElementById('ai-font-size-val').textContent = e.target.value; 
    _updateLivePreview();
  });
  
  const blurSlider = document.getElementById('ai-blur-slider');
  if (blurSlider) blurSlider.addEventListener('input', e => { 
    document.getElementById('ai-blur-val').textContent = e.target.value; 
    _updateLivePreview();
  });
  
  const noiseSlider = document.getElementById('ai-noise-slider');
  if (noiseSlider) noiseSlider.addEventListener('input', e => { 
    document.getElementById('ai-noise-val').textContent = e.target.value; 
    _updateLivePreview();
  });
  
  const fontControls = dialog.querySelectorAll('#ai-font-family, #ai-font-weight, #ai-font-style, #ai-text-align, #ai-text-color');
  fontControls.forEach(el => el.addEventListener('change', _updateLivePreview));
  const colorInput = document.getElementById('ai-text-color');
  if (colorInput) colorInput.addEventListener('input', _updateLivePreview);

  // Bind buttons dialog
  function onKeydown(e) {
    if (e.key === 'Escape') { _handleAICancel(); document.removeEventListener('keydown', onKeydown); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { _handleAICreate(); document.removeEventListener('keydown', onKeydown); }
  }
  document.addEventListener('keydown', onKeydown);
  dialog._keydownRef = onKeydown;

  // Bind buttons
  document.getElementById('ai-cancel-btn')?.addEventListener('click', () => {
    document.removeEventListener('keydown', onKeydown);
    _handleAICancel();
  });
  document.getElementById('ai-create-btn')?.addEventListener('click', () => {
    document.removeEventListener('keydown', onKeydown);
    _handleAICreate();
  });
}

/* ════════════════════════════════════════════
   XỬ LÝ CANCEL
   ════════════════════════════════════════════ */
function _handleAICancel() {
  document.getElementById('ai-prompt-dialog')?.remove();
  _removeAISelectionEl();
  _cancelAITool();
}

/* ════════════════════════════════════════════
   XỬ LÝ CREATE — Capture + Gọi Gemini
   ════════════════════════════════════════════ */
async function _handleAICreate() {
  const pg = _getCurrentPg();
  if (!pg || !_aiSelectionRect) return;

  let resultDataURL;
  let expandLeft = 0, expandRight = 0, expandTop = 0, expandBottom = 0;

  const prompt = document.getElementById('ai-prompt-input')?.value?.trim();
  if (!prompt) {
    document.getElementById('ai-prompt-input')?.focus();
    return;
  }

  // Đổi sang trạng thái loading
  _setAIDialogLoading(true);

  try {
    // ── 1. Capture vùng chọn từ background image của page ──
    const capturedBase64 = await _captureSelectionRegion(pg, _aiSelectionRect);

    const manualFontFamily = document.getElementById('ai-font-family')?.value || 'Arial';
    const manualFontWeight = document.getElementById('ai-font-weight')?.value || 'bold';
    const manualFontStyle = document.getElementById('ai-font-style')?.value || 'normal';
    const manualTextAlign = document.getElementById('ai-text-align')?.value || 'left';
    const manualTextColor = document.getElementById('ai-text-color')?.value || '#000000';
    const manualFontSizePct = parseFloat(document.getElementById('ai-font-size-slider')?.value || '70') / 100;
    const manualBlur = parseFloat(document.getElementById('ai-blur-slider')?.value || '0.5');
    const manualNoise = parseFloat(document.getElementById('ai-noise-slider')?.value || '10') / 100;

    const manualStyle = { 
      fontFamily: manualFontFamily, 
      fontWeight: manualFontWeight, 
      fontStyle: manualFontStyle,
      textAlign: manualTextAlign,
      textColor: manualTextColor,
      fontSizePct: manualFontSizePct,
      blurPx: manualBlur,
      noiseAlpha: manualNoise
    };

    console.log('⚡ [Smart Canvas] Đang áp dụng Text + Thuật toán đồ họa thủ công...');
    const renderObj = await _localSmartTextReplacement(capturedBase64, prompt, manualStyle);
    
    resultDataURL = renderObj.dataURL;
    expandLeft = renderObj.expandLeft || 0;
    expandRight = renderObj.expandRight || 0;
    expandTop = renderObj.expandTop || 0;
    expandBottom = renderObj.expandBottom || 0;

    // ── 3. Tính toán tỷ lệ Scale để convert Offset về tọa độ PDF ──
    const imgForScale = new Image();
    imgForScale.crossOrigin = 'anonymous';
    imgForScale.src = pg.renderURL;
    await new Promise(r => { imgForScale.onload = r; imgForScale.onerror = r; });
    
    const canvasW = pg.widthPt * editorScale;
    const canvasH = pg.heightPt * editorScale;
    const scaleX = imgForScale.naturalWidth ? (imgForScale.naturalWidth / canvasW) : 1;
    const scaleY = imgForScale.naturalHeight ? (imgForScale.naturalHeight / canvasH) : 1;
    
    const pdfExpandLeft = expandLeft / scaleX;
    const pdfExpandRight = expandRight / scaleX;
    const pdfExpandTop = expandTop / scaleY;
    const pdfExpandBottom = expandBottom / scaleY;

    // ── 4. Tạo image object và thêm vào overlay ──
    const area = document.getElementById('edit-canvas-area');
    if (!area || !area._overlayEl) throw new Error('Canvas area not found');

    const obj = {
      id: uid(),
      type: 'image',
      x: _aiSelectionRect.x - pdfExpandLeft,
      y: _aiSelectionRect.y - pdfExpandTop,
      w: _aiSelectionRect.w + pdfExpandLeft + pdfExpandRight,
      h: _aiSelectionRect.h + pdfExpandTop + pdfExpandBottom,
      dataURL: resultDataURL,
      selected: false,
    };

    pg.overlayObjects.push(obj);
    _renderOverlayObject(obj, area._overlayEl, pg);
    _selectObject(obj, pg);
    _saveHistory();

    // ── 5. Dọn dẹp ──
    document.getElementById('ai-prompt-dialog')?.remove();
    _removeAISelectionEl();
    _cancelAITool();

  } catch (err) {
    console.error('[AI Fill] Error:', err);
    _setAIDialogLoading(false);
    _setAIDialogError(err.message || 'Có lỗi xảy ra khi gọi AI. Vui lòng thử lại.');
  }
}

/* ════════════════════════════════════════════
   CAPTURE VÙNG CHỌN TỪ PDF BACKGROUND
   ════════════════════════════════════════════ */
async function _captureSelectionRegion(pg, rect) {
  return new Promise((resolve, reject) => {
    if (!pg.renderURL) {
      reject(new Error('Trang chưa được render. Vui lòng chọn lại trang.'));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Tỷ lệ: renderURL có kích thước gốc (naturalWidth x naturalHeight)
      // Canvas area hiển thị với kích thước (pg.widthPt * editorScale) x (pg.heightPt * editorScale)
      const canvasW = pg.widthPt * editorScale;
      const canvasH = pg.heightPt * editorScale;
      const scaleX = img.naturalWidth  / canvasW;
      const scaleY = img.naturalHeight / canvasH;

      // Tọa độ vùng chọn trên ảnh gốc
      const srcX = Math.round(rect.x * scaleX);
      const srcY = Math.round(rect.y * scaleY);
      const srcW = Math.round(rect.w * scaleX);
      const srcH = Math.round(rect.h * scaleY);

      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, srcW);
      canvas.height = Math.max(1, srcH);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => {
      // Nếu không load được img (CORS), tạo canvas trắng vẫn gọi AI được
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(rect.w));
      canvas.height = Math.max(1, Math.round(rect.h));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.src = pg.renderURL;
  });
}

/* ════════════════════════════════════════════
   GỌI COMFYUI LOCAL (Flux Kontext Dev)
   ─ Hoàn toàn miễn phí, chạy trên RTX 3060
   ─ Chất lượng cực cao cho việc sửa text/hình ảnh
   ════════════════════════════════════════════ */
const COMFYUI_URL = 'http://127.0.0.1:8189'; // qua proxy CORS

/* ════════════════════════════════════════════
   GỌI COMFYUI LOCAL (ĐÃ XÓA)
   ════════════════════════════════════════════ */

/* ════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════ */
function _setAIDialogLoading(loading) {
  const createBtn = document.getElementById('ai-create-btn');
  const cancelBtn = document.getElementById('ai-cancel-btn');
  const textarea  = document.getElementById('ai-prompt-input');
  const dialog    = document.getElementById('ai-prompt-dialog');

  if (!createBtn) return;

  if (loading) {
    createBtn.disabled = true;
    createBtn.innerHTML = `<span class="ai-spinner"></span> Đang tạo...`;
    if (cancelBtn) cancelBtn.disabled = true;
    if (textarea)  textarea.disabled = true;
    if (dialog) dialog.classList.add('loading');
  } else {
    createBtn.disabled = false;
    createBtn.innerHTML = `<span class="ai-btn-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span> Thay Chữ`;
    if (cancelBtn) cancelBtn.disabled = false;
    if (textarea)  textarea.disabled = false;
    if (dialog) dialog.classList.remove('loading');
  }
}

function _setAIDialogError(message) {
  const existing = document.querySelector('.ai-dialog-error');
  if (existing) existing.remove();

  const errEl = document.createElement('div');
  errEl.className = 'ai-dialog-error';
  errEl.textContent = '⚠ ' + message;

  const footer = document.querySelector('.ai-dialog-footer');
  if (footer) footer.insertAdjacentElement('beforebegin', errEl);

  // Re-enable create button
  const createBtn = document.getElementById('ai-create-btn');
  if (createBtn) {
    createBtn.disabled = false;
    createBtn.innerHTML = `<span class="ai-btn-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span> Thử lại`;
  }
  const cancelBtn = document.getElementById('ai-cancel-btn');
  if (cancelBtn) cancelBtn.disabled = false;
  const textarea = document.getElementById('ai-prompt-input');
  if (textarea) textarea.disabled = false;
}

function _removeAISelectionEl() {
  if (_aiSelectionEl) {
    _aiSelectionEl.remove();
    _aiSelectionEl = null;
  }
  _aiSelectionRect = null;
}

function _cancelAITool() {
  _aiActive = false;
  _aiDragState = null;

  const btn = document.getElementById('ai-fill-btn');
  if (btn) btn.classList.remove('active');

  const canvasArea = document.getElementById('edit-canvas-area');
  if (canvasArea) {
    canvasArea.style.cursor = '';
    if (canvasArea._aiMousedown) {
      canvasArea.removeEventListener('mousedown', canvasArea._aiMousedown);
      canvasArea._aiMousedown = null;
    }
  }
  _removeAISelectionEl();
}

/* Trích xuất màu mực in tối ưu từ ảnh crop */
function _extractDominantTextColor(base64) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', {willReadFrequently: true});
      ctx.drawImage(img, 0, 0);
      
      const W = c.width, H = c.height;
      const data = ctx.getImageData(0,0,W,H).data;
      
      let sumLum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sumLum += data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
      }
      const avgLum = sumLum / (W * H);
      const inkThresholdLum = Math.min(180, avgLum - 30);

      let rSum=0, gSum=0, bSum=0, count=0;
      for (let i=0; i<data.length; i+=4) {
        const lum = data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
        if (lum < inkThresholdLum) {
          rSum += data[i]; gSum += data[i+1]; bSum += data[i+2]; count++;
        }
      }
      if (count > 0) {
        resolve('#' + [Math.round(rSum/count), Math.round(gSum/count), Math.round(bSum/count)].map(x => x.toString(16).padStart(2, '0')).join(''));
      } else {
        resolve('#000000');
      }
    };
    img.onerror = () => resolve('#000000');
    img.src = 'data:image/png;base64,' + base64;
  });
}

/* ════════════════════════════════════════════
   NHẬN DIỆN CHIỀU CAO CHỮ GỐC (pixel scanning)
   Quét từng dòng pixel, tìm hàng đầu và hàng cuối có chứa mực đậm,
   trả về tỷ lệ (0–1) so với tổng chiều cao crop.
   ════════════════════════════════════════════ */
function _detectTextHeightPct(base64) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      const W = c.width, H = c.height;
      const data = ctx.getImageData(0, 0, W, H).data;
      
      let sumLum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sumLum += data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
      }
      const avgLum = sumLum / (W * H);
      const inkThresholdLum = Math.min(180, avgLum - 30);

      function isInkPixel(i) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        return lum < inkThresholdLum;
      }

      // Với mỗi hàng, đếm số pixel mực — cần ít nhất 2% số cột là mực
      const inkThreshold = Math.max(2, Math.floor(W * 0.02));
      let topRow = -1, bottomRow = -1;

      for (let y = 0; y < H; y++) {
        let inkCount = 0;
        for (let x = 0; x < W; x++) {
          if (isInkPixel((y * W + x) * 4)) inkCount++;
        }
        if (inkCount >= inkThreshold) {
          if (topRow === -1) topRow = y;
          bottomRow = y;
        }
      }

      if (topRow === -1 || bottomRow === topRow) {
        return resolve(0.7);
      }

      const textPixelHeight = bottomRow - topRow + 1;
      const ratio = textPixelHeight / H;
      resolve(Math.min(1.2, Math.max(0.1, ratio)));
    };
    img.onerror = () => resolve(0.7);
    img.src = 'data:image/png;base64,' + base64;
  });
}

function _localSmartTextReplacement(base64, newText, manualStyle) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      const style = {
        backgroundColor: '#ffffff', // Will be overridden
        textColor: manualStyle?.textColor || '#000000',
        fontFamily: manualStyle?.fontFamily || 'Arial', 
        fontWeight: manualStyle?.fontWeight || 'bold', 
        fontStyle: manualStyle?.fontStyle || 'normal',
        isUppercase: false, 
        blurPx: manualStyle?.blurPx !== undefined ? manualStyle.blurPx : 0.5, 
        noiseAlpha: manualStyle?.noiseAlpha !== undefined ? manualStyle.noiseAlpha : 0.05
      };
      const finalText = style.isUppercase ? newText.toUpperCase() : newText;

      const W = img.width, H = img.height;
      const data = ctx.getImageData(0, 0, W, H).data;
      
      let sumLum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sumLum += data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
      }
      const avgLum = sumLum / (W * H);
      const inkThresholdLum = Math.min(180, avgLum - 30);

      // Background is the most common color or average
      let rBg=0, gBg=0, bBg=0, bgCount=0;
      for (let i=0; i<data.length; i+=4) {
        const lum = data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
        if (lum > avgLum) {
           rBg += data[i]; gBg += data[i+1]; bBg += data[i+2]; bgCount++;
        }
      }
      if (bgCount > 0) {
        style.backgroundColor = '#' + [Math.round(rBg/bgCount), Math.round(gBg/bgCount), Math.round(bBg/bgCount)].map(x => x.toString(16).padStart(2, '0')).join('');
      }

      let minX = W, maxX = -1, minY = H, maxY = -1;
      let hasInk = false;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = data[i], g = data[i+1], b = data[i+2];
          const lum = r*0.299 + g*0.587 + b*0.114;
          if (lum < inkThresholdLum) {
             if (x < minX) minX = x;
             if (x > maxX) maxX = x;
             if (y < minY) minY = y;
             if (y > maxY) maxY = y;
             hasInk = true;
          }
        }
      }

      let textCenterX = W / 2;
      let textCenterY = H / 2;
      if (hasInk) {
        textCenterX = (minX + maxX) / 2;
        textCenterY = (minY + maxY) / 2;
      }

      const align = manualStyle?.textAlign || 'left';
      ctx.font = `${style.fontStyle} ${style.fontWeight} 100px "${style.fontFamily}", sans-serif`;
      const metrics100 = ctx.measureText(finalText);
      const visualHeight100 = metrics100.actualBoundingBoxAscent + metrics100.actualBoundingBoxDescent;
      const safeHeight100 = visualHeight100 > 0 ? visualHeight100 : 100;

      const fontSizePct = manualStyle?.fontSizePct !== undefined ? manualStyle.fontSizePct : 0.7;
      const targetVisualHeight = Math.floor(img.height * fontSizePct);
      const exactFontSize = (targetVisualHeight / safeHeight100) * 100;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${exactFontSize}px "${style.fontFamily}", sans-serif`;

      const finalMetrics = ctx.measureText(finalText);
      const finalVisualHeight = finalMetrics.actualBoundingBoxAscent + finalMetrics.actualBoundingBoxDescent;
      const finalVisualWidth = finalMetrics.actualBoundingBoxLeft + finalMetrics.actualBoundingBoxRight;

      ctx.textBaseline = 'alphabetic';
      let drawY = textCenterY + finalMetrics.actualBoundingBoxAscent - (finalVisualHeight / 2);

      let drawX = textCenterX;
      if (hasInk) {
        if (align === 'left') drawX = minX + finalMetrics.actualBoundingBoxLeft;
        else if (align === 'right') drawX = maxX - finalMetrics.actualBoundingBoxRight;
        else drawX = textCenterX + finalMetrics.actualBoundingBoxLeft - (finalVisualWidth / 2);
      }

      let textLeft = drawX - finalMetrics.actualBoundingBoxLeft;
      let textRight = drawX + finalMetrics.actualBoundingBoxRight;
      let textTop = drawY - finalMetrics.actualBoundingBoxAscent;
      let textBottom = drawY + finalMetrics.actualBoundingBoxDescent;

      let expandLeft = 0, expandRight = 0, expandTop = 0, expandBottom = 0;
      if (textLeft < 0) expandLeft = Math.ceil(-textLeft) + 10;
      if (textRight > img.width) expandRight = Math.ceil(textRight - img.width) + 10;
      if (textTop < 0) expandTop = Math.ceil(-textTop) + 10;
      if (textBottom > img.height) expandBottom = Math.ceil(textBottom - img.height) + 10;

      if (expandLeft > 0 || expandRight > 0 || expandTop > 0 || expandBottom > 0) {
        c.width = img.width + expandLeft + expandRight;
        c.height = img.height + expandTop + expandBottom;
        drawX += expandLeft;
        drawY += expandTop;
      }

      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, c.width, c.height);

      if (style.blurPx > 0) ctx.filter = `blur(${style.blurPx}px)`;
      ctx.fillStyle = style.textColor;
      ctx.textAlign = align;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${exactFontSize}px "${style.fontFamily}", sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(finalText, drawX, drawY);

      ctx.filter = 'none';
      if (style.noiseAlpha > 0) {
        const noiseData = ctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < noiseData.data.length; i += 4) {
          const noise = (Math.random() - 0.5) * 50; 
          noiseData.data[i]   = Math.min(255, Math.max(0, noiseData.data[i]   + noise * style.noiseAlpha));
          noiseData.data[i+1] = Math.min(255, Math.max(0, noiseData.data[i+1] + noise * style.noiseAlpha));
          noiseData.data[i+2] = Math.min(255, Math.max(0, noiseData.data[i+2] + noise * style.noiseAlpha));
        }
        ctx.putImageData(noiseData, 0, 0);
      }

      resolve({ 
        dataURL: c.toDataURL('image/png'), 
        maskURL: null,
        offsetX: -expandLeft,
        offsetY: -expandTop
      });
    };
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + base64;
  });
}
