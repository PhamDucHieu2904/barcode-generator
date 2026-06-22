/* ══════════════════════════════════════════════
   app.js — application shell
   Handles section switching and bootstraps modules.
   ══════════════════════════════════════════════ */

(function () {
  /* ── Section switching ── */
  const sections = {
    barcode: document.getElementById('section-barcode'),
    pdf:     document.getElementById('section-pdf'),
  };

  function activateSection(sectionKey) {
    Object.values(sections).forEach(el => el.classList.remove('active'));
    const target = sections[sectionKey];
    if (target) target.classList.add('active');
  }

  /* ── Sidebar nav buttons ── */
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const section = btn.dataset.section;
      const type    = btn.dataset.type;

      activateSection(section);

      // If switching to barcode, update current type and re-render inputs
      if (section === 'barcode') {
        currentType = type;          // barcode.js global
        codes = [''];                // barcode.js global
        if (typeof errorMsg !== 'undefined') errorMsg.textContent = '';
        renderInputs();              // barcode.js
        renderPreview();             // barcode.js
      }
    });
  });

  /* ── Bootstrap all modules ── */
  initBarcode();   // barcode.js
  initPDF();       // pdf.js
})();