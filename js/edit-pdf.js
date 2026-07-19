/* ══════════════════════════════════════════════
   edit-pdf.js — Entry point (PDF Editor module)
   ══════════════════════════════════════════════
   Load order (xem index.html):
     1. edit-pdf-state.js    — Constants + state vars
     2. edit-pdf-canvas.js   — Canvas rendering
     3. edit-pdf-shapes.js   — Shape & line tools
     4. edit-pdf-export.js   — PDF/image export
     5. edit-pdf-toolbar.js  — Toolbar & keyboard
     6. edit-pdf-dropzone.js — File input & thumbnails
     7. edit-pdf-font-detect.js — PDF text/OCR + Google Font matcher
     8. edit-pdf-scan-effects.js — Scan degradation analysis/render
     9. edit-pdf-ai.js       — Smart text replacement UI/render
    10. edit-pdf.js          ← entry point (this file)
   ══════════════════════════════════════════════ */

/**
 * Populate <select id="edit-font"> từ mảng EDIT_FONTS.
 * Gọi trong initEditPDF() — thay thế inline <script> cũ trong index.html.
 */
function _populateFontSelect() {
  const fontSel = document.getElementById('edit-font');
  if (!fontSel) return;
  if (typeof populateSmartFontSelect === 'function') {
    populateSmartFontSelect(fontSel);
    if (!fontSel.dataset.smartFontBound) {
      fontSel.dataset.smartFontBound = '1';
      fontSel.addEventListener('change', () => {
        const selectedObj = _getCurrentPg()?.overlayObjects?.find(o => o.id === editSelectedObj);
        ensureGoogleFontLoaded(fontSel.value, selectedObj?.content || 'Tiếng Việt').then(() => {
          if (selectedObj) _renderEditThumbs();
        });
      });
    }
    return;
  }
  fontSel.innerHTML = '';
  EDIT_FONTS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    opt.style.fontFamily = f;
    fontSel.appendChild(opt);
  });
}

/**
 * Entry point — được gọi bởi app.js sau khi DOM sẵn sàng.
 * Orchestrate tất cả module con.
 */
function initEditPDF() {
  _populateFontSelect();
  _bindEditDropZone();
  _bindKeyboardShortcuts();
  _bindEditButtons();
  _bindTextFormatControls();
  _bindZoomControls();
  _renderEditThumbs();
  initAITool(); // Smart Text Replacement
}
