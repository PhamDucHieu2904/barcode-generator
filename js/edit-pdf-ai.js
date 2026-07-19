/* ══════════════════════════════════════════════
   edit-pdf-ai.js — Smart Text Replacement
   Nhận diện và render hoàn toàn trong trình duyệt; không upload PDF.
   ══════════════════════════════════════════════ */

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
    if (canvasArea) {
      canvasArea.style.cursor = 'crosshair';
      canvasArea.classList.remove('can-pan');
    }

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
    const selectionStroke = 2 / Math.max(1, editZoom);
    const selectionRadius = 3 / Math.max(1, editZoom);
    selEl.style.cssText = `
      position: absolute;
      left: ${startPos.x}px; top: ${startPos.y}px;
      width: 0; height: 0;
      border: ${selectionStroke}px dashed #6c47ff;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 8000;
      border-radius: ${selectionRadius}px;
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

      const minLogicalSize = 10 / Math.max(1, editZoom); // 10px trên màn hình ở mọi mức zoom.
      if (!_aiSelectionRect || _aiSelectionRect.w < minLogicalSize || _aiSelectionRect.h < minLogicalSize) {
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
          <div class="ai-font-detect-panel">
            <div class="ai-detect-status-row">
              <span id="ai-font-detect-status" class="ai-detect-status">Đang chuẩn bị nhận diện font…</span>
              <span class="ai-detect-progress"><i id="ai-font-detect-progress"></i></span>
            </div>
            <div class="ai-source-row">
              <label for="ai-source-text">Chữ gốc</label>
              <input id="ai-source-text" type="text" placeholder="Tự đọc từ PDF hoặc OCR" autocomplete="off">
              <button id="ai-font-redetect" class="ai-redetect-btn" type="button">Dò lại</button>
            </div>
            <div id="ai-font-candidates" class="ai-font-candidates"></div>
          </div>
          <p class="ai-dialog-hint">Nhập chữ mới bạn muốn chèn vào bản scan</p>
          <textarea id="ai-prompt-input" class="ai-prompt-textarea" 
            placeholder="Ví dụ: CÔNG TY"
            rows="2" spellcheck="false"></textarea>
          
          <div class="ai-font-controls" style="margin-top: 8px; display: flex; gap: 8px; font-size: 12px; align-items: center;">
            <select id="ai-font-family" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; flex: 1;">
              <option value="Arial">Arial</option>
            </select>
            <select id="ai-font-weight" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; width: 80px;">
              <option value="normal">Thường</option>
              <option value="bold" selected>Đậm</option>
            </select>
            <select id="ai-font-style" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; width: 85px;">
              <option value="normal">Thẳng</option>
              <option value="italic">Nghiêng</option>
            </select>

            <select id="ai-text-align" style="padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; width: 70px;" title="Căn chữ">
              <option value="left">Trái</option>
              <option value="center">Giữa</option>
              <option value="right">Phải</option>
            </select>

            <input type="color" id="ai-text-color" value="#000000" style="padding: 0; border: 1px solid #ccc; border-radius: 4px; height: 26px; width: 30px; cursor: pointer;" title="Màu chữ">
          </div>
          
          <div class="ai-text-adjustments" style="margin-top: 12px; font-size: 12px; color: #555;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Cỡ Chữ (Size): <span id="ai-font-size-val">70</span>%</span>
              <input type="range" id="ai-font-size-slider" min="10" max="150" step="1" value="70" style="width: 120px;" title="Tỷ lệ cỡ chữ so với khung chọn">
            </div>
          </div>

          <div class="ai-appearance-panel">
            <div class="ai-appearance-heading">
              <label for="ai-appearance-mode">Hiệu ứng chữ</label>
              <select id="ai-appearance-mode">
                <option value="match" selected>Khớp tài liệu scan</option>
                <option value="clean">Chữ kỹ thuật số sạch</option>
                <option value="manual">Tùy chỉnh</option>
              </select>
            </div>
            <div id="ai-scan-profile-status" class="ai-scan-profile-status">Đang phân tích hiệu ứng scan…</div>
            <div class="ai-effect-grid">
              <label><span>Cường độ <b id="ai-scan-strength-val">80</b>%</span><input id="ai-scan-strength" type="range" min="0" max="150" step="1" value="80"></label>
              <label><span>Blur <b id="ai-blur-val">0.0</b>px</span><input id="ai-blur-slider" type="range" min="0" max="3" step="0.1" value="0"></label>
              <label><span>Sharpen <b id="ai-sharpen-val">0</b>%</span><input id="ai-sharpen-slider" type="range" min="0" max="150" step="1" value="0"></label>
              <label><span>Mực loang <b id="ai-spread-val">0</b>%</span><input id="ai-spread-slider" type="range" min="-100" max="100" step="1" value="0"></label>
              <label><span>Contrast <b id="ai-contrast-val">100</b>%</span><input id="ai-contrast-slider" type="range" min="70" max="140" step="1" value="100"></label>
              <label><span>Noise <b id="ai-noise-val">0</b>%</span><input id="ai-noise-slider" type="range" min="0" max="100" step="1" value="0"></label>
              <label><span>JPEG <b id="ai-jpeg-val">100</b>%</span><input id="ai-jpeg-slider" type="range" min="60" max="100" step="1" value="100"></label>
            </div>
            <input id="ai-bg-noise" type="hidden" value="0">
            <input id="ai-ink-noise" type="hidden" value="0">
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
  if (typeof populateSmartFontSelect === 'function') {
    populateSmartFontSelect(document.getElementById('ai-font-family'));
  }

  // Hiển thị kích thước vùng chọn
  const pg = _getCurrentPg();
  if (_aiSelectionRect && pg) {
    const sizeEl = document.getElementById('ai-selection-size');
    if (sizeEl) {
      sizeEl.textContent = `Vùng chọn: ${Math.round(_aiSelectionRect.w)} × ${Math.round(_aiSelectionRect.h)} px canvas`;
    }
  }

  // Live Preview Logic
  let capturedBase64ForPreview = null;
  let livePreviewSequence = 0;
  let detectedScanProfile = null;
  if (pg && _aiSelectionRect) {
    _captureSelectionRegion(pg, _aiSelectionRect).then(async base64 => {
      capturedBase64ForPreview = base64;

      const updateDetectProgress = (status, progress) => {
        const statusEl = document.getElementById('ai-font-detect-status');
        const progressEl = document.getElementById('ai-font-detect-progress');
        if (statusEl) statusEl.textContent = status;
        if (progressEl) progressEl.style.width = `${Math.max(4, Math.round((progress || 0) * 100))}%`;
      };

      const detectionPromise = typeof analyzeSelectionFont === 'function'
        ? analyzeSelectionFont(pg, _aiSelectionRect, base64, updateDetectProgress)
        : Promise.resolve(null);
      const scanProfilePromise = typeof analyzeScanEffectProfile === 'function'
        ? analyzeScanEffectProfile(base64).catch(err => {
            console.warn('[Scan Profile] Analysis fallback:', err);
            return null;
          })
        : Promise.resolve(null);
      const [detectedColor, detectedHeightPct, fontAnalysis, rawScanProfile] = await Promise.all([
        _extractDominantTextColor(base64),
        _detectTextHeightPct(base64),
        detectionPromise,
        scanProfilePromise
      ]);
      let scanProfile = rawScanProfile;
      if (scanProfile && fontAnalysis?.text && fontAnalysis.candidates?.[0] &&
          typeof refineScanProfileStroke === 'function') {
        try {
          scanProfile = await refineScanProfileStroke(
            base64,
            fontAnalysis.text,
            fontAnalysis.candidates[0],
            scanProfile
          );
        } catch (err) {
          console.warn('[Scan Profile] Stroke refinement fallback:', err);
        }
      }
      if (scanProfile && typeof rememberScanEffectProfile === 'function') {
        scanProfile = rememberScanEffectProfile(pg, scanProfile);
      }

      // Auto-detect Text Color
      const colorInput = document.getElementById('ai-text-color');
      if (colorInput) colorInput.value = detectedColor;

      // Auto-detect Text Height
      const fontSizeSlider = document.getElementById('ai-font-size-slider');
      const fontSizeVal = document.getElementById('ai-font-size-val');
      if (fontSizeSlider && fontSizeVal) {
        const pctVal = Math.round(detectedHeightPct * 100);
        fontSizeSlider.value = pctVal;
        fontSizeVal.textContent = pctVal;
      }

      detectedScanProfile = scanProfile;
      if (scanProfile && document.getElementById('ai-appearance-mode')?.value === 'match') {
        _applyScanProfileToUI(scanProfile);
      } else if (!scanProfile) {
        const profileStatus = document.getElementById('ai-scan-profile-status');
        if (profileStatus) profileStatus.textContent = 'Không đủ dữ liệu để khớp tự động; có thể chỉnh tay.';
      }

      if (fontAnalysis) {
        const sourceInput = document.getElementById('ai-source-text');
        if (sourceInput) sourceInput.value = fontAnalysis.text || '';
        _renderAIFontCandidates(fontAnalysis.candidates || [], fontAnalysis.source);
        if (fontAnalysis.candidates?.[0]) await _applyAIFontCandidate(fontAnalysis.candidates[0]);
        if (!fontAnalysis.text) updateDetectProgress('Không đọc được chữ gốc — nhập thủ công rồi bấm Dò lại', 0);
      }

      _updateLivePreview();
    }).catch(err => {
      const statusEl = document.getElementById('ai-font-detect-status');
      if (statusEl) statusEl.textContent = 'Không thể phân tích vùng chọn: ' + (err.message || err);
    });
  }

  function _setEffectControl(id, value, displayId, displayValue) {
    const input = document.getElementById(id);
    const display = document.getElementById(displayId);
    if (input) input.value = value;
    if (display) display.textContent = displayValue ?? value;
  }

  function _applyScanProfileToUI(profile) {
    if (!profile) return;
    _setEffectControl('ai-blur-slider', profile.blurPx, 'ai-blur-val', Number(profile.blurPx).toFixed(1));
    _setEffectControl('ai-sharpen-slider', Math.round(profile.sharpenAmount * 100), 'ai-sharpen-val');
    const safeAutoSpread = Math.max(-0.08, Math.min(0.08, Number(profile.inkSpread) || 0));
    _setEffectControl('ai-spread-slider', Math.round(safeAutoSpread * 100), 'ai-spread-val');
    _setEffectControl('ai-contrast-slider', Math.round(profile.contrast * 100), 'ai-contrast-val');
    _setEffectControl('ai-noise-slider', Math.round(profile.noiseAlpha * 100), 'ai-noise-val');
    _setEffectControl('ai-jpeg-slider', Math.round(profile.jpegQuality * 100), 'ai-jpeg-val');
    const bgNoise = document.getElementById('ai-bg-noise');
    const inkNoise = document.getElementById('ai-ink-noise');
    if (bgNoise) bgNoise.value = profile.backgroundNoise || 0;
    if (inkNoise) inkNoise.value = profile.inkNoise || 0;
    const status = document.getElementById('ai-scan-profile-status');
    const sampleLabel = profile.sampleCount > 1 ? ` · ${profile.sampleCount} vùng trên trang` : '';
    if (status) status.textContent = `Đã khớp ${Math.round(profile.confidence || 0)}%${sampleLabel} · blur ${Number(profile.blurPx).toFixed(1)}px · sharpen ${Math.round(profile.sharpenAmount*100)}% · JPEG ${Math.round(profile.jpegQuality*100)}%`;
    _updateLivePreview();
  }

  function _applyCleanProfileToUI() {
    _setEffectControl('ai-blur-slider', 0, 'ai-blur-val', '0.0');
    _setEffectControl('ai-sharpen-slider', 0, 'ai-sharpen-val');
    _setEffectControl('ai-spread-slider', 0, 'ai-spread-val');
    _setEffectControl('ai-contrast-slider', 100, 'ai-contrast-val');
    _setEffectControl('ai-noise-slider', 0, 'ai-noise-val');
    _setEffectControl('ai-jpeg-slider', 100, 'ai-jpeg-val');
    const bgNoise = document.getElementById('ai-bg-noise');
    const inkNoise = document.getElementById('ai-ink-noise');
    if (bgNoise) bgNoise.value = 0;
    if (inkNoise) inkNoise.value = 0;
    const status = document.getElementById('ai-scan-profile-status');
    if (status) status.textContent = 'Không áp hiệu ứng scan.';
    _updateLivePreview();
  }

  async function _applyAIFontCandidate(candidate) {
    if (!candidate) return;
    const family = document.getElementById('ai-font-family');
    const weight = document.getElementById('ai-font-weight');
    const style = document.getElementById('ai-font-style');
    if (family) family.value = candidate.family || 'Arial';
    if (weight) weight.value = candidate.fontWeight || 'normal';
    if (style) style.value = candidate.fontStyle || 'normal';
    if (typeof ensureGoogleFontLoaded === 'function') {
      await ensureGoogleFontLoaded(candidate.family, document.getElementById('ai-source-text')?.value || 'Tiếng Việt');
    }
    document.querySelectorAll('.ai-font-candidate').forEach(btn => btn.classList.toggle('active', btn.dataset.family === candidate.family));
    _updateLivePreview();
  }

  function _renderAIFontCandidates(candidates, sourceKind) {
    const container = document.getElementById('ai-font-candidates');
    if (!container) return;
    container.innerHTML = '';
    candidates.slice(0, 3).forEach(candidate => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-font-candidate';
      button.dataset.family = candidate.family;
      button.style.fontFamily = `"${candidate.family}", sans-serif`;
      button.innerHTML = `<strong>${candidate.family}</strong><small>${candidate.confidence || 0}% tương đồng</small>`;
      button.addEventListener('click', () => _applyAIFontCandidate(candidate));
      container.appendChild(button);
    });
    const statusEl = document.getElementById('ai-font-detect-status');
    if (statusEl && candidates.length) {
      const sourceLabel = sourceKind === 'pdf-text' ? 'PDF text' : (sourceKind === 'manual' ? 'Chữ nhập tay' : 'OCR');
      statusEl.textContent = `${sourceLabel} · Gợi ý: ${candidates[0].family}`;
    }
  }

  async function _updateLivePreview() {
    const sequence = ++livePreviewSequence;
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
      ..._readAIScanEffectControls()
    };

    if (typeof ensureGoogleFontLoaded === 'function') {
      await ensureGoogleFontLoaded(manualStyle.fontFamily, prompt);
    }
    const renderObj = await _localSmartTextReplacement(capturedBase64ForPreview, prompt, manualStyle);
    if (sequence !== livePreviewSequence || !document.getElementById('ai-prompt-dialog')) return;
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
  
  const effectSliders = [
    ['ai-scan-strength','ai-scan-strength-val',false],
    ['ai-blur-slider','ai-blur-val',true],
    ['ai-sharpen-slider','ai-sharpen-val',true],
    ['ai-spread-slider','ai-spread-val',true],
    ['ai-contrast-slider','ai-contrast-val',true],
    ['ai-noise-slider','ai-noise-val',true],
    ['ai-jpeg-slider','ai-jpeg-val',true]
  ];
  effectSliders.forEach(([inputId, valueId, markManual]) => {
    document.getElementById(inputId)?.addEventListener('input', e => {
      const display = document.getElementById(valueId);
      if (display) display.textContent = inputId === 'ai-blur-slider' ? Number(e.target.value).toFixed(1) : e.target.value;
      if (markManual) {
        const mode = document.getElementById('ai-appearance-mode');
        if (mode) mode.value = 'manual';
        const status = document.getElementById('ai-scan-profile-status');
        if (status) status.textContent = 'Đang dùng profile tùy chỉnh.';
      }
      _updateLivePreview();
    });
  });

  document.getElementById('ai-appearance-mode')?.addEventListener('change', e => {
    if (e.target.value === 'clean') _applyCleanProfileToUI();
    else if (e.target.value === 'match') {
      if (detectedScanProfile) _applyScanProfileToUI(detectedScanProfile);
      else {
        const status = document.getElementById('ai-scan-profile-status');
        if (status) status.textContent = 'Đang phân tích hiệu ứng scan…';
      }
    } else {
      const status = document.getElementById('ai-scan-profile-status');
      if (status) status.textContent = 'Đang dùng profile tùy chỉnh.';
      _updateLivePreview();
    }
  });
  
  const fontControls = dialog.querySelectorAll('#ai-font-family, #ai-font-weight, #ai-font-style, #ai-text-align, #ai-text-color');
  fontControls.forEach(el => el.addEventListener('change', _updateLivePreview));
  const colorInput = document.getElementById('ai-text-color');
  if (colorInput) colorInput.addEventListener('input', _updateLivePreview);

  document.getElementById('ai-font-redetect')?.addEventListener('click', async () => {
    const sourceText = document.getElementById('ai-source-text')?.value?.trim();
    if (!capturedBase64ForPreview || !sourceText || typeof detectNearestGoogleFonts !== 'function') return;
    const button = document.getElementById('ai-font-redetect');
    if (button) button.disabled = true;
    try {
      const statusEl = document.getElementById('ai-font-detect-status');
      const progressEl = document.getElementById('ai-font-detect-progress');
      const candidates = await detectNearestGoogleFonts(capturedBase64ForPreview, sourceText, null, (status, progress) => {
        if (statusEl) statusEl.textContent = status;
        if (progressEl) progressEl.style.width = `${Math.max(4, Math.round(progress * 100))}%`;
      });
      _renderAIFontCandidates(candidates, 'manual');
      if (candidates[0]) await _applyAIFontCandidate(candidates[0]);
    } catch (err) {
      const statusEl = document.getElementById('ai-font-detect-status');
      if (statusEl) statusEl.textContent = 'Dò font thất bại: ' + (err.message || err);
    } finally {
      if (button) button.disabled = false;
    }
  });

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

function _readAIScanEffectControls() {
  return {
    appearanceMode: document.getElementById('ai-appearance-mode')?.value || 'match',
    scanStrength: parseFloat(document.getElementById('ai-scan-strength')?.value || '80') / 100,
    blurPx: parseFloat(document.getElementById('ai-blur-slider')?.value || '0'),
    sharpenAmount: parseFloat(document.getElementById('ai-sharpen-slider')?.value || '0') / 100,
    inkSpread: parseFloat(document.getElementById('ai-spread-slider')?.value || '0') / 100,
    contrast: parseFloat(document.getElementById('ai-contrast-slider')?.value || '100') / 100,
    noiseAlpha: parseFloat(document.getElementById('ai-noise-slider')?.value || '0') / 100,
    backgroundNoise: parseFloat(document.getElementById('ai-bg-noise')?.value || '0'),
    inkNoise: parseFloat(document.getElementById('ai-ink-noise')?.value || '0'),
    jpegQuality: parseFloat(document.getElementById('ai-jpeg-slider')?.value || '100') / 100
  };
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
   XỬ LÝ CREATE — Capture + render cục bộ
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
    const scanEffects = _readAIScanEffectControls();
    const detectedSourceText = document.getElementById('ai-source-text')?.value?.trim() || '';

    const manualStyle = { 
      fontFamily: manualFontFamily, 
      fontWeight: manualFontWeight, 
      fontStyle: manualFontStyle,
      textAlign: manualTextAlign,
      textColor: manualTextColor,
      fontSizePct: manualFontSizePct,
      sourceText: detectedSourceText,
      ...scanEffects
    };

    console.log('⚡ [Smart Canvas] Đang áp dụng Text + Thuật toán đồ họa thủ công...');
    if (typeof ensureGoogleFontLoaded === 'function') {
      await ensureGoogleFontLoaded(manualFontFamily, prompt);
    }
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
    const pageRot = ((pg.rotation || 0) % 360 + 360) % 360;
    const orientedNaturalW = (pageRot === 90 || pageRot === 270) ? imgForScale.naturalHeight : imgForScale.naturalWidth;
    const orientedNaturalH = (pageRot === 90 || pageRot === 270) ? imgForScale.naturalWidth : imgForScale.naturalHeight;
    const scaleX = orientedNaturalW ? (orientedNaturalW / canvasW) : 1;
    const scaleY = orientedNaturalH ? (orientedNaturalH / canvasH) : 1;
    
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
      // Object coordinates are stored in the unzoomed editor canvas coordinate
      // system. Keep the scale used at creation so PDF export does not depend on
      // a later resize of the browser/editor panel.
      coordinateScale: editorScale,
      selected: false,
      smartText: {
        sourceText: detectedSourceText,
        replacementText: prompt,
        sourceRect: { ..._aiSelectionRect },
        fontFamily: manualFontFamily,
        fontWeight: manualFontWeight,
        fontStyle: manualFontStyle,
        textAlign: manualTextAlign,
        textColor: manualTextColor,
        fontSizePct: manualFontSizePct,
        ...scanEffects
      }
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
      // Dựng đúng hướng đang hiển thị trước khi crop; renderURL vẫn giữ hướng gốc.
      const rot = ((pg.rotation || 0) % 360 + 360) % 360;
      const oriented = document.createElement('canvas');
      const swap = rot === 90 || rot === 270;
      oriented.width = swap ? img.naturalHeight : img.naturalWidth;
      oriented.height = swap ? img.naturalWidth : img.naturalHeight;
      const orientedCtx = oriented.getContext('2d');
      if (rot === 90) {
        orientedCtx.translate(oriented.width, 0);
        orientedCtx.rotate(Math.PI / 2);
      } else if (rot === 180) {
        orientedCtx.translate(oriented.width, oriented.height);
        orientedCtx.rotate(Math.PI);
      } else if (rot === 270) {
        orientedCtx.translate(0, oriented.height);
        orientedCtx.rotate(-Math.PI / 2);
      }
      orientedCtx.drawImage(img, 0, 0);

      // Canvas area hiển thị với kích thước (pg.widthPt * editorScale) x (pg.heightPt * editorScale)
      const canvasW = pg.widthPt * editorScale;
      const canvasH = pg.heightPt * editorScale;
      const scaleX = oriented.width  / canvasW;
      const scaleY = oriented.height / canvasH;

      // Tọa độ vùng chọn trên ảnh gốc
      const srcX = Math.round(rect.x * scaleX);
      const srcY = Math.round(rect.y * scaleY);
      const srcW = Math.round(rect.w * scaleX);
      const srcH = Math.round(rect.h * scaleY);

      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, srcW);
      canvas.height = Math.max(1, srcH);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(oriented, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

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
  if (typeof _updateCanvasPanAvailability === 'function') _updateCanvasPanAvailability();
  _removeAISelectionEl();
}

/*
 * Lấy màu lõi của nét chữ thay vì trung bình toàn bộ vùng anti-alias.
 * Pixel rìa glyph luôn bị pha với màu nền, nếu đưa vào trung bình sẽ làm
 * chữ mới nhạt rõ rệt (đặc biệt trên scan độ phân giải thấp).
 */
function _pickCoreInkColor(data, W, H) {
  const border = Math.max(1, Math.round(Math.min(W, H) * 0.08));
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= border && x < W-border && y >= border && y < H-border) continue;
      const i = (y * W + x) * 4;
      rs.push(data[i]); gs.push(data[i+1]); bs.push(data[i+2]);
    }
  }
  const median = arr => { arr.sort((a,b) => a-b); return arr[Math.floor(arr.length/2)] ?? 255; };
  const bgR = median(rs), bgG = median(gs), bgB = median(bs);
  const candidates = [];

  for (let i = 0; i < data.length; i += 4) {
    const dr=data[i]-bgR, dg=data[i+1]-bgG, db=data[i+2]-bgB;
    const distance = Math.sqrt(dr*dr*0.3 + dg*dg*0.59 + db*db*0.11);
    if (distance > 18) candidates.push({ r:data[i], g:data[i+1], b:data[i+2], distance });
  }
  if (!candidates.length) return '#000000';

  candidates.sort((a,b) => b.distance - a.distance);
  // Bỏ 1% pixel xa nền nhất để tránh chấm đen/nhiễu JPEG đơn lẻ, sau đó
  // lấy 20% pixel lõi. Dùng quá nhiều pixel anti-alias sẽ làm màu chữ mới bạc đi.
  const start = candidates.length >= 100 ? Math.floor(candidates.length * 0.01) : 0;
  const count = Math.max(1, Math.ceil(candidates.length * 0.20));
  const core = candidates.slice(start, Math.min(candidates.length, start + count));
  let rSum=0, gSum=0, bSum=0, weightSum=0;
  const maxDistance = core[0]?.distance || 1;
  core.forEach(pixel => {
    const weight = 0.5 + pixel.distance / maxDistance;
    rSum += pixel.r * weight; gSum += pixel.g * weight; bSum += pixel.b * weight;
    weightSum += weight;
  });
  const rgb = [rSum/weightSum, gSum/weightSum, bSum/weightSum].map(value =>
    Math.max(0, Math.min(255, Math.round(value)))
  );
  return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
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
      resolve(_pickCoreInkColor(data, W, H));
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

      const border = Math.max(1, Math.round(Math.min(W, H) * 0.08));
      const rs=[], gs=[], bs=[];
      for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
        if (x>=border && x<W-border && y>=border && y<H-border) continue;
        const i=(y*W+x)*4; rs.push(data[i]); gs.push(data[i+1]); bs.push(data[i+2]);
      }
      const median = arr => { arr.sort((a,b)=>a-b); return arr[Math.floor(arr.length/2)] ?? 255; };
      const bgR=median(rs), bgG=median(gs), bgB=median(bs);

      function isInkPixel(i) {
        const dr=data[i]-bgR, dg=data[i+1]-bgG, db=data[i+2]-bgB;
        return Math.sqrt(dr*dr*0.3 + dg*dg*0.59 + db*db*0.11) > 28;
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

function _smartTextExpansionPadding(style, strength) {
  const blur = Math.max(0, Number(style?.blurPx) || 0) * Math.max(0, strength || 0);
  const spread = Math.max(0, Number(style?.inkSpread) || 0) * Math.max(0, strength || 0);
  const sharpen = Math.max(0, Number(style?.sharpenAmount) || 0) * Math.max(0, strength || 0);
  // 2 sigma cho blur, thêm một phần nhỏ cho morphology/halo; tối thiểu 1px
  // để anti-alias không bị cắt. Profile scan thông thường sẽ chỉ cần 1-2px.
  return Math.max(1, Math.ceil(blur * 2 + spread + sharpen * 0.5));
}

function _featherSmartPatchEdges(canvas, featherPx = 2) {
  const width = canvas.width, height = canvas.height;
  const feather = Math.max(0, Math.min(featherPx, Math.floor(Math.min(width, height) / 4)));
  if (!feather) return canvas;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edgeDistance = Math.min(x + 0.5, y + 0.5, width - x - 0.5, height - y - 0.5);
      if (edgeDistance >= feather) continue;
      const t = Math.max(0, Math.min(1, edgeDistance / feather));
      const smoothAlpha = t * t * (3 - 2 * t);
      const alphaIndex = (y * width + x) * 4 + 3;
      data[alphaIndex] = Math.round(data[alphaIndex] * smoothAlpha);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function _localSmartTextReplacement(base64, newText, manualStyle) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      (async () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      const style = {
        appearanceMode: manualStyle?.appearanceMode || 'match',
        backgroundColor: '#ffffff', // Will be overridden
        textColor: manualStyle?.textColor || '#000000',
        fontFamily: manualStyle?.fontFamily || 'Arial', 
        fontWeight: manualStyle?.fontWeight || 'bold', 
        fontStyle: manualStyle?.fontStyle || 'normal',
        isUppercase: false, 
        blurPx: manualStyle?.blurPx !== undefined ? manualStyle.blurPx : 0,
        noiseAlpha: manualStyle?.noiseAlpha !== undefined ? manualStyle.noiseAlpha : 0,
        sharpenAmount: manualStyle?.sharpenAmount || 0,
        inkSpread: manualStyle?.inkSpread || 0,
        contrast: manualStyle?.contrast || 1,
        backgroundNoise: manualStyle?.backgroundNoise || 0,
        inkNoise: manualStyle?.inkNoise || 0,
        jpegQuality: manualStyle?.jpegQuality ?? 1,
        scanStrength: manualStyle?.appearanceMode === 'clean' ? 0 : (manualStyle?.scanStrength ?? 1)
      };
      const finalText = style.isUppercase ? newText.toUpperCase() : newText;

      const W = img.width, H = img.height;
      const data = ctx.getImageData(0, 0, W, H).data;
      
      // Lấy màu nền từ viền crop, dùng được cả chữ tối/nền sáng và chữ sáng/nền tối.
      const border = Math.max(1, Math.round(Math.min(W, H) * 0.08));
      const rs=[], gs=[], bs=[];
      for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
        if (x>=border && x<W-border && y>=border && y<H-border) continue;
        const i=(y*W+x)*4; rs.push(data[i]); gs.push(data[i+1]); bs.push(data[i+2]);
      }
      const median = arr => { arr.sort((a,b)=>a-b); return arr[Math.floor(arr.length/2)] ?? 255; };
      const bgR=median(rs), bgG=median(gs), bgB=median(bs);
      style.backgroundColor = '#' + [bgR,bgG,bgB].map(x => Math.round(x).toString(16).padStart(2,'0')).join('');

      let minX = W, maxX = -1, minY = H, maxY = -1;
      let hasInk = false;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
           const dr=data[i]-bgR, dg=data[i+1]-bgG, db=data[i+2]-bgB;
           const distance=Math.sqrt(dr*dr*0.3 + dg*dg*0.59 + db*db*0.11);
           if (distance > 28) {
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
      if (hasInk) {
        // Text on a document line must share a baseline. Centering glyph boxes
        // makes capitals/numbers look a few pixels too high when their descent
        // differs from the source word. Estimate the original baseline from the
        // OCR text rendered with the chosen font, then place the replacement on it.
        const sourceText = String(manualStyle?.sourceText || '').trim();
        if (sourceText) {
          const sourceMetrics = ctx.measureText(sourceText);
          const sourceMetricHeight = sourceMetrics.actualBoundingBoxAscent + sourceMetrics.actualBoundingBoxDescent;
          if (sourceMetricHeight > 0) {
            const detectedInkHeight = maxY - minY + 1;
            const sourceScale = detectedInkHeight / sourceMetricHeight;
            drawY = minY + sourceMetrics.actualBoundingBoxAscent * sourceScale;
          } else {
            drawY = maxY - finalMetrics.actualBoundingBoxDescent;
          }
        } else {
          drawY = maxY - finalMetrics.actualBoundingBoxDescent;
        }
      }

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

      const strength = Math.max(0, Math.min(1.5, style.scanStrength));
      const effectPadding = _smartTextExpansionPadding(style, strength);
      let expandLeft = 0, expandRight = 0, expandTop = 0, expandBottom = 0;
      if (textLeft < 0) expandLeft = Math.ceil(-textLeft) + effectPadding;
      if (textRight > img.width) expandRight = Math.ceil(textRight - img.width) + effectPadding;
      if (textTop < 0) expandTop = Math.ceil(-textTop) + effectPadding;
      if (textBottom > img.height) expandBottom = Math.ceil(textBottom - img.height) + effectPadding;

      if (expandLeft > 0 || expandRight > 0 || expandTop > 0 || expandBottom > 0) {
        c.width = img.width + expandLeft + expandRight;
        c.height = img.height + expandTop + expandBottom;
        drawX += expandLeft;
        drawY += expandTop;
      }

      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, c.width, c.height);

      const textCanvas = document.createElement('canvas');
      textCanvas.width = c.width; textCanvas.height = c.height;
      const textCtx = textCanvas.getContext('2d', { willReadFrequently: true });
      textCtx.fillStyle = style.textColor;
      textCtx.textAlign = align;
      textCtx.font = `${style.fontStyle} ${style.fontWeight} ${exactFontSize}px "${style.fontFamily}", sans-serif`;
      textCtx.textBaseline = 'alphabetic';
      textCtx.fillText(finalText, drawX, drawY);

      const safeInkSpread = style.appearanceMode === 'match'
        ? Math.max(-0.08, Math.min(0.08, style.inkSpread))
        : style.inkSpread;
      if (typeof applyTextInkSpread === 'function' && Math.abs(safeInkSpread * strength) > 0.01) {
        applyTextInkSpread(textCanvas, safeInkSpread * strength);
      }
      const effectiveBlur = style.blurPx * strength;
      if (effectiveBlur > 0.01) ctx.filter = `blur(${effectiveBlur}px)`;
      ctx.drawImage(textCanvas, 0, 0);
      ctx.filter = 'none';

      let seed = 2166136261;
      for (let i=0; i<finalText.length; i++) seed = Math.imul(seed ^ finalText.charCodeAt(i), 16777619);
      if (typeof applyCompositeScanEffects === 'function' && strength > 0) {
        const manualNoise = style.appearanceMode === 'manual';
        const backgroundNoise = manualNoise ? style.noiseAlpha * 10 : style.backgroundNoise;
        const inkNoise = manualNoise ? style.noiseAlpha * 14 : style.inkNoise;
        applyCompositeScanEffects(c, {
          contrast: 1 + (style.contrast - 1) * strength,
          sharpenAmount: style.sharpenAmount * strength,
          backgroundNoise: backgroundNoise * strength,
          inkNoise: inkNoise * strength,
          noiseSeed: seed >>> 0
        }, style.backgroundColor);
      }

      let outputCanvas = c;
      if (typeof finalizeScanCompression === 'function' && strength > 0) {
        const effectiveQuality = 1 - (1 - style.jpegQuality) * Math.min(1, strength);
        outputCanvas = await finalizeScanCompression(c, effectiveQuality);
      }

      // Avoid a visible rectangular seam against the scanned page. Keeping a
      // very small alpha feather is enough to blend background/noise differences
      // without softening the text in the middle of the patch.
      outputCanvas = _featherSmartPatchEdges(outputCanvas, 2);

      resolve({ 
        dataURL: outputCanvas.toDataURL('image/png'),
        maskURL: null,
        offsetX: -expandLeft,
        offsetY: -expandTop,
        expandLeft,
        expandRight,
        expandTop,
        expandBottom
      });
      })().catch(reject);
    };
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + base64;
  });
}
