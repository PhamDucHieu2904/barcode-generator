/* ══════════════════════════════════════════════
   app.js — application shell
   Handles section switching and bootstraps modules.
   ══════════════════════════════════════════════ */

(function () {
  /* ── Popup AI Tool state ── */
  let aiPopup = null;
  let activeToolBtn = null;
  let focusTrick = null;

  // Khi user alt+tab về web app → kéo popup lên trên (nếu đang mở)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && aiPopup && !aiPopup.closed) {
      clearTimeout(focusTrick);
      focusTrick = setTimeout(() => {
        try {
          aiPopup.focus();           // kéo popup lên trước
          setTimeout(() => {
            try { window.focus(); } catch(e) {}  // sau đó focus lại main window
          }, 80);
        } catch(e) {}
      }, 150);
    }
  });

  // Tương tự khi main window được click/focus lại
  window.addEventListener('focus', () => {
    if (aiPopup && !aiPopup.closed) {
      clearTimeout(focusTrick);
      focusTrick = setTimeout(() => {
        try {
          aiPopup.focus();
          setTimeout(() => { try { window.focus(); } catch(e) {} }, 80);
        } catch(e) {}
      }, 100);
    }
  });

  function closeAiPopup() {
    if (aiPopup && !aiPopup.closed) aiPopup.close();
    aiPopup = null;
    if (activeToolBtn) {
      activeToolBtn.classList.remove('active');
      activeToolBtn = null;
    }
  }

  /* ── Section switching ── */
  const sections = {
    barcode:   document.getElementById('section-barcode'),
    pdf:       document.getElementById('section-pdf'),
    'ai-tool': document.getElementById('section-ai-tool'),
  };

  function activateSection(sectionKey) {
    Object.values(sections).forEach(el => el && el.classList.remove('active'));
    const target = sections[sectionKey];
    if (target) target.classList.add('active');
  }

  /* ── Sidebar nav buttons ── */
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const section = btn.dataset.section;
      const type    = btn.dataset.type;
      const url     = btn.dataset.url;

      // Nếu không phải là click vào tool có popup url → đóng popup đang mở
      if (!url) closeAiPopup();

      activateSection(section);

      if (section === 'barcode') {
        switchBarcodeType(type);
      } else if (url) {
        // Xử lý mở popup cho AI Tool (mở từ thanh sidebar)
        // Nếu bấm lại đúng tool đang active → focus popup
        if (activeToolBtn === btn && aiPopup && !aiPopup.closed) {
          aiPopup.focus();
          return;
        }

        // Đóng popup cũ nếu đang mở
        closeAiPopup();

        // Tính vị trí popup: nằm ngay cạnh sidebar, chiếm toàn bộ chiều cao viewport
        const sidebarEl   = document.getElementById('sidebar');
        const sidebarRect = sidebarEl ? sidebarEl.getBoundingClientRect() : { right: 110 };

        const browserChromeW = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
        const rawChromeH     = window.outerHeight - window.innerHeight;
        const safeChromeH    = (rawChromeH > 0 && rawChromeH < 150) ? rawChromeH : 90;

        const popLeft = Math.round(window.screenX + browserChromeW + sidebarRect.right);
        const popTop  = Math.round(window.screenY + safeChromeH);
        const popW    = Math.round(window.innerWidth  - sidebarRect.right);
        const popH    = Math.round(window.innerHeight);

        const features = [
          `left=${popLeft}`,
          `top=${popTop}`,
          `width=${Math.max(popW, 400)}`,
          `height=${Math.max(popH, 300)}`,
          'toolbar=no', 'menubar=no', 'scrollbars=yes',
          'resizable=yes', 'location=no', 'status=no',
        ].join(',');

        aiPopup = window.open(url, 'ai_tool_window', features);

        if (!aiPopup) {
          // Fallback nếu bị block
          window.open(url, '_blank');
          return;
        }

        // Đánh dấu nút sidebar này đang active
        activeToolBtn = btn;

        // Theo dõi khi user tự đóng popup
        const checkClosed = setInterval(() => {
          if (!aiPopup || aiPopup.closed) {
            clearInterval(checkClosed);
            aiPopup = null;
            if (activeToolBtn) {
              activeToolBtn.classList.remove('active');
              activeToolBtn = null;
            }
          }
        }, 600);
      }
    });
  });

  /* ── Đóng popup khi refresh / đóng tab ── */
  window.addEventListener('beforeunload', () => closeAiPopup());

  /* ── Bootstrap all modules ── */
  initBarcode();   // barcode.js
  initPDF();       // pdf.js
  initEditPDF();   // edit-pdf.js
})();