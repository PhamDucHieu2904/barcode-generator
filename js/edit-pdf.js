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
     7. edit-pdf-ai.js       — AI Generative Fill
     8. edit-pdf.js          ← entry point (this file)
   ══════════════════════════════════════════════ */

// Inject Google Fonts cho các font trong EDIT_FONTS (khai báo trong edit-pdf-state.js)
(function injectGoogleFonts() {
  const webFonts = EDIT_FONTS
    .filter(f => !['Arial','Helvetica','Georgia','Times New Roman','Courier New'].includes(f))
    .map(f => f.replace(/ /g, '+')).join('|');
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${webFonts.split('|').map(f=>`${f}:wght@400;700`).join('&family=')}&display=swap`;
  document.head.appendChild(link);
})();

/**
 * Populate <select id="edit-font"> từ mảng EDIT_FONTS.
 * Gọi trong initEditPDF() — thay thế inline <script> cũ trong index.html.
 */
function _populateFontSelect() {
  const fontSel = document.getElementById('edit-font');
  if (!fontSel) return;
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
  initAITool(); // AI Generative Fill
}