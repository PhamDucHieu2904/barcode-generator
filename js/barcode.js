/* ══════════════════════════════════════════════
   barcode.js — barcode generation module
   ══════════════════════════════════════════════ */

/* ── Check digit calculators ── */

function calcEAN13(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length < 12) return null;
  const base = d.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + ((10 - (sum % 10)) % 10);
}

function calcITF14(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length < 13) return null;
  const base = d.slice(0, 13);
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(base[i]) * (i % 2 === 0 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

function calcUPCA(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length < 11) return null;
  const base = d.slice(0, 11);
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += parseInt(base[i]) * (i % 2 === 0 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/* ── Meta config per barcode type ── */
const BARCODE_META = {
  EAN13:   { label: 'Nhập EAN 13',      hint: 'Nhập 12 chữ số — check digit cuối tự động tính.',      placeholder: '123456789012',    onlyDigits: true,  maxLen: 12 },
  UPCA:    { label: 'Nhập UPC-A',       hint: 'Nhập 11 chữ số — check digit cuối tự động tính.',      placeholder: '01234567890',     onlyDigits: true,  maxLen: 11 },
  ITF14:   { label: 'Nhập ITF 14',      hint: 'Nhập 13 chữ số — check digit cuối tự động tính.',      placeholder: '1234567890123',   onlyDigits: true,  maxLen: 13 },
  CODE128: { label: 'Nhập Code 128',    hint: 'Nhập chuỗi ký tự bất kỳ. Code 128 tự tính check.',    placeholder: 'ABC-123',         onlyDigits: false, maxLen: 48 },
  QR:      { label: 'Nhập nội dung QR', hint: 'Nhập văn bản, URL, số điện thoại…',                    placeholder: 'https://example.com', onlyDigits: false, maxLen: 500 },
};

/* ── State ── */
let currentType = 'EAN13';
let codes = [''];
const MAX_CODES = 20;

const barcodeProps = {
  font:       'Arial',
  fontSize:   20,
  textMargin: 2,
  barHeight:  80,
  barWidth:   2,
  margin:     8,
  qrSize:     140,
  showText:   true,
  lineColor:  '#000000',
  bgColor:    '#ffffff',
};

/* ── DOM refs ── */
const inputsList  = document.getElementById('inputs-list');
const inputLabel  = document.getElementById('input-label');
const inputHint   = document.getElementById('input-hint');
const addBtn      = document.getElementById('add-btn');
const downloadBtn = document.getElementById('download-btn');
const errorMsg    = document.getElementById('error-msg');
const a4El        = document.getElementById('a4');
const placeholder = document.getElementById('placeholder');

/* ── Props DOM refs ── */
const propFont       = document.getElementById('prop-font');
const propFontSize   = document.getElementById('prop-fontsize');
const propTextMargin = document.getElementById('prop-textmargin');
const propBarHeight  = document.getElementById('prop-barheight');
const propBarWidth   = document.getElementById('prop-barwidth');
const propMargin     = document.getElementById('prop-margin');
const propQrSize     = document.getElementById('prop-qrsize');
const propShowText   = document.getElementById('prop-showtext');
const propLineColor  = document.getElementById('prop-linecolor');
const propBgColor    = document.getElementById('prop-bgcolor');
const linecolorHex   = document.getElementById('linecolor-hex');
const bgcolorHex     = document.getElementById('bgcolor-hex');
const showtextHint   = document.getElementById('showtext-hint');

/* ── Helpers ── */
function getFullCode(raw, type) {
  if (!raw || !raw.trim()) return null;
  switch (type) {
    case 'EAN13':   return calcEAN13(raw);
    case 'UPCA':    return calcUPCA(raw);
    case 'ITF14':   return calcITF14(raw);
    case 'CODE128':
    case 'QR':      return raw.trim() || null;
    default:        return null;
  }
}

function validateFull(full, type) {
  if (!full) return null;
  switch (type) {
    case 'EAN13':   return /^\d{13}$/.test(full) ? null : 'EAN-13 cần đúng 13 chữ số';
    case 'UPCA':    return /^\d{12}$/.test(full) ? null : 'UPC-A cần đúng 12 chữ số';
    case 'ITF14':   return /^\d{14}$/.test(full) ? null : 'ITF-14 cần đúng 14 chữ số';
    case 'CODE128': return full.length > 0 ? null : 'Code 128 không được để trống';
    case 'QR':      return full.length > 0 ? null : 'QR không được để trống';
    default:        return null;
  }
}

function jsFormat(type) {
  return type === 'ITF14' ? 'ITF14' :
         type === 'EAN13' ? 'EAN13' :
         type === 'UPCA'  ? 'UPC'   : 'CODE128';
}

function barcodeOpts(overrides = {}) {
  return {
    format:       overrides.format || '',
    width:        barcodeProps.barWidth,
    height:       barcodeProps.barHeight,
    displayValue: barcodeProps.showText,
    font:         barcodeProps.font,
    fontSize:     barcodeProps.fontSize,
    textMargin:   barcodeProps.textMargin,
    margin:       barcodeProps.margin,
    background:   barcodeProps.bgColor,
    lineColor:    barcodeProps.lineColor,
    ...overrides,
  };
}

/* ── Properties panel wiring ── */
function wireSpinners() {
  document.querySelectorAll('.spin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const step = parseFloat(input.step) || 1;
      const min  = input.min !== '' ? parseFloat(input.min) : -Infinity;
      const max  = input.max !== '' ? parseFloat(input.max) :  Infinity;
      let val = parseFloat(input.value) || 0;
      val = btn.dataset.dir === 'up' ? val + step : val - step;
      val = Math.min(max, Math.max(min, parseFloat(val.toFixed(4))));
      input.value = val;
      input.dispatchEvent(new Event('input'));
    });
  });
}

function wirePropsPanel() {
  const num = (el, key, parse = parseFloat) => {
    el.addEventListener('input', () => {
      const v = parse(el.value);
      if (!isNaN(v)) { barcodeProps[key] = v; renderPreview(); }
    });
  };
  num(propFontSize,   'fontSize',   parseInt);
  num(propTextMargin, 'textMargin', parseInt);
  num(propBarHeight,  'barHeight',  parseInt);
  num(propBarWidth,   'barWidth',   parseFloat);
  num(propMargin,     'margin',     parseInt);
  num(propQrSize,     'qrSize',     parseInt);

  propFont.addEventListener('change', () => { barcodeProps.font = propFont.value; renderPreview(); });

  propShowText.addEventListener('change', () => {
    barcodeProps.showText = propShowText.checked;
    showtextHint.textContent = barcodeProps.showText ? 'Bật' : 'Tắt';
    renderPreview();
  });

  propLineColor.addEventListener('input', () => {
    barcodeProps.lineColor = propLineColor.value;
    linecolorHex.textContent = propLineColor.value;
    renderPreview();
  });
  propBgColor.addEventListener('input', () => {
    barcodeProps.bgColor = propBgColor.value;
    bgcolorHex.textContent = propBgColor.value;
    renderPreview();
  });
}

/* ── Render inputs ── */
function renderInputs() {
  const meta = BARCODE_META[currentType];
  inputLabel.textContent = meta.label;
  inputHint.textContent  = meta.hint;
  inputsList.innerHTML   = '';

  codes.forEach((val, idx) => {
    const row   = document.createElement('div'); row.className = 'input-row';
    const inner = document.createElement('div'); inner.className = 'input-row-inner';

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.className   = 'barcode-input';
    inp.value       = val;
    inp.placeholder = meta.placeholder;
    inp.maxLength   = meta.maxLen;
    if (meta.onlyDigits) inp.inputMode = 'numeric';

    const badge = document.createElement('div');
    badge.className = 'check-badge';

    function updateBadge(rawVal) {
      badge.innerHTML = '';
      badge.className = 'check-badge';
      if (!rawVal) return;
      const stripped = meta.onlyDigits ? rawVal.replace(/\D/g, '') : rawVal;

      const checkTypes = {
        EAN13:  { need: 12, calc: calcEAN13, idx: 12 },
        UPCA:   { need: 11, calc: calcUPCA,  idx: 11 },
        ITF14:  { need: 13, calc: calcITF14, idx: 13 },
      };
      const ct = checkTypes[currentType];
      if (!ct) return;

      if (!stripped.length) return;
      if (stripped.length < ct.need) {
        badge.className = 'check-badge err-hint';
        badge.textContent = `Còn thiếu ${ct.need - stripped.length} số`;
      } else {
        const full = ct.calc(stripped);
        if (full) badge.innerHTML = `Check digit: <span class="cd">${full[ct.idx]}</span> → Mã đầy đủ: <span class="cd">${full}</span>`;
      }
    }

    inp.addEventListener('input', e => {
      let v = e.target.value;
      if (meta.onlyDigits) { v = v.replace(/\D/g, '').slice(0, meta.maxLen); e.target.value = v; }
      codes[idx] = v;
      inp.classList.remove('error', 'ok');
      errorMsg.textContent = '';
      updateBadge(v);
      renderPreview();
    });
    updateBadge(val);

    const del = document.createElement('button');
    del.className    = 'remove-btn';
    del.title        = 'Xóa';
    del.textContent  = '×';
    del.style.display = codes.length > 1 ? 'block' : 'none';
    del.addEventListener('click', () => {
      codes.splice(idx, 1);
      errorMsg.textContent = '';
      renderInputs();
      renderPreview();
    });

    inner.appendChild(inp);
    inner.appendChild(del);
    row.appendChild(inner);
    if (['EAN13', 'UPCA', 'ITF14'].includes(currentType)) row.appendChild(badge);
    inputsList.appendChild(row);
  });

  addBtn.style.display = codes.length >= MAX_CODES ? 'none' : 'flex';
}

addBtn.addEventListener('click', () => {
  if (codes.length < MAX_CODES) { codes.push(''); renderInputs(); }
});

/* ── Render preview ── */
function renderPreview() {
  a4El.innerHTML = '';
  const filledCodes = codes.filter(c => c && c.trim());

  if (!filledCodes.length) {
    placeholder.style.display = 'flex';
    a4El.appendChild(placeholder);
    return;
  }
  placeholder.style.display = 'none';

  filledCodes.forEach((raw, idx) => {
    const full = getFullCode(raw, currentType);
    if (!full || validateFull(full, currentType)) return;

    const wrap = document.createElement('div');
    wrap.className = 'barcode-preview-item';

    if (currentType === 'QR') {
      const qrDiv = document.createElement('div');
      qrDiv.id = `qr-prev-${idx}`;
      wrap.appendChild(qrDiv);
      a4El.appendChild(wrap);
      new QRCode(qrDiv, {
        text: full,
        width:  barcodeProps.qrSize,
        height: barcodeProps.qrSize,
        colorDark:  barcodeProps.lineColor,
        colorLight: barcodeProps.bgColor,
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wrap.appendChild(svg);
      a4El.appendChild(wrap);
      try {
        JsBarcode(svg, full, barcodeOpts({ format: jsFormat(currentType) }));
      } catch (e) { wrap.remove(); }
    }
  });
}

/* ── Download SVG ── */
function initBarcodeDownload() {
  downloadBtn.addEventListener('click', () => {
    const filledCodes = codes.filter(c => c && c.trim());
    if (!filledCodes.length) { errorMsg.textContent = 'Vui lòng nhập ít nhất một mã.'; return; }

    const fullCodes = [];
    for (const raw of filledCodes) {
      const full = getFullCode(raw, currentType);
      if (!full) { errorMsg.textContent = `Mã "${raw}" chưa đủ ký tự.`; return; }
      const err = validateFull(full, currentType);
      if (err) { errorMsg.textContent = err; return; }
      fullCodes.push(full);
    }
    errorMsg.textContent = '';

    if (currentType === 'QR') downloadQRSVG(fullCodes);
    else downloadBarcodeSVG(fullCodes);
  });
}

function downloadBarcodeSVG(fullCodes) {
  const A4_W = 793.7, A4_H = 1122.5;
  const margin = 30, gap = 20;
  const itemW  = barcodeProps.barWidth * 100 + 40;
  const itemH  = barcodeProps.barHeight + 40;
  const cols   = Math.max(1, Math.floor((A4_W - margin * 2 + gap) / (itemW + gap)));

  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('viewBox', `0 0 ${A4_W} ${A4_H}`);
  root.setAttribute('width',  `${A4_W}`);
  root.setAttribute('height', `${A4_H}`);

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', A4_W); bg.setAttribute('height', A4_H); bg.setAttribute('fill', 'white');
  root.appendChild(bg);

  const fmt = jsFormat(currentType);
  fullCodes.forEach((code, idx) => {
    const tmp = document.createElementNS(ns, 'svg');
    try {
      JsBarcode(tmp, code, barcodeOpts({ format: fmt }));
      const bW = parseFloat(tmp.getAttribute('width')  || itemW);
      const bH = parseFloat(tmp.getAttribute('height') || itemH);
      const col = idx % cols, row = Math.floor(idx / cols);
      const x = margin + col * (bW + gap);
      const y = margin + row * (bH + gap);
      const inner = document.createElementNS(ns, 'svg');
      inner.setAttribute('x', x); inner.setAttribute('y', y);
      inner.setAttribute('width', bW); inner.setAttribute('height', bH);
      inner.innerHTML = tmp.innerHTML;
      root.appendChild(inner);
    } catch(e) {}
  });

  triggerDownload(
    new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }),
    'barcodes.svg'
  );
}

function downloadQRSVG(fullCodes) {
  const A4_W = 793.7, A4_H = 1122.5;
  const margin = 30, gap = 20;
  const qrSize = barcodeProps.qrSize;
  const cols   = Math.max(1, Math.floor((A4_W - margin * 2 + gap) / (qrSize + gap)));

  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('viewBox', `0 0 ${A4_W} ${A4_H}`);
  root.setAttribute('width',  `${A4_W}`);
  root.setAttribute('height', `${A4_H}`);
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', A4_W); bg.setAttribute('height', A4_H); bg.setAttribute('fill', 'white');
  root.appendChild(bg);

  fullCodes.forEach((code, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols);
    const x = margin + col * (qrSize + gap);
    const y = margin + row * (qrSize + gap + 18);

    const tmp = document.createElement('div');
    tmp.style.display = 'none';
    document.body.appendChild(tmp);
    new QRCode(tmp, {
      text: code, width: qrSize * 2, height: qrSize * 2,
      colorDark: barcodeProps.lineColor, colorLight: barcodeProps.bgColor,
      correctLevel: QRCode.CorrectLevel.M,
    });

    setTimeout(() => {
      const canvas = tmp.querySelector('canvas');
      if (canvas) {
        const imgEl = document.createElementNS(ns, 'image');
        imgEl.setAttribute('x', x); imgEl.setAttribute('y', y);
        imgEl.setAttribute('width', qrSize); imgEl.setAttribute('height', qrSize);
        imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL('image/png'));
        root.appendChild(imgEl);
        if (barcodeProps.showText) {
          const txt = document.createElementNS(ns, 'text');
          txt.setAttribute('x', x + qrSize / 2);
          txt.setAttribute('y', y + qrSize + 13);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', barcodeProps.fontSize);
          txt.setAttribute('font-family', barcodeProps.font + ', sans-serif');
          txt.setAttribute('fill', barcodeProps.lineColor);
          txt.textContent = code.length > 36 ? code.slice(0, 36) + '…' : code;
          root.appendChild(txt);
        }
      }
      document.body.removeChild(tmp);
      if (idx === fullCodes.length - 1) {
        setTimeout(() => {
          triggerDownload(
            new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }),
            'qrcodes.svg'
          );
        }, 100);
      }
    }, 200 + idx * 60);
  });
}

/* ── Public init ── */
function initBarcode() {
  wireSpinners();
  wirePropsPanel();
  renderInputs();
  renderPreview();
  initBarcodeDownload();
}