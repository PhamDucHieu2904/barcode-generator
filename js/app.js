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

      // If switching to barcode, delegate to barcode.js public API
      // Không truy cập trực tiếp vào biến internal (currentType, codes) nữa
      if (section === 'barcode') {
        switchBarcodeType(type); // barcode.js public API
      }
    });
  });

  /* ── Bootstrap all modules ── */
  initBarcode();   // barcode.js
  initPDF();       // pdf.js
  initEditPDF();   // edit-pdf.js
})();