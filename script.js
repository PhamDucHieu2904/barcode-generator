/* ══════════════════════════════════════════════
   CHECK DIGIT CALCULATORS
   ══════════════════════════════════════════════ */

function calcEAN13(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 12) return null;
  const base = digits.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + ((10 - (sum % 10)) % 10);
}

function calcITF14(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13) return null;
  const base = digits.slice(0, 13);
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(base[i]) * (i % 2 === 0 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/* UPC-A: input 11 digits → returns full 12-digit string */
function calcUPCA(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 11) return null;
  const base = digits.slice(0, 11);
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += parseInt(base[i]) * (i % 2 === 0 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/* ══════════════════════════════════════════════
   META CONFIG
   ══════════════════════════════════════════════ */
const META = {
  EAN13:   { label: 'Nhập EAN 13',        hint: 'Nhập 12 chữ số — check digit cuối được tự động tính và thêm vào.',        placeholder: '123456789012',    onlyDigits: true,  maxLen: 12 },
  UPCA:    { label: 'Nhập UPC-A',         hint: 'Nhập 11 chữ số — check digit cuối được tự động tính và thêm vào.',        placeholder: '01234567890',     onlyDigits: true,  maxLen: 11 },
  ITF14:   { label: 'Nhập ITF 14',        hint: 'Nhập 13 chữ số — check digit cuối được tự động tính và thêm vào.',        placeholder: '1234567890123',   onlyDigits: true,  maxLen: 13 },
  CODE128: { label: 'Nhập Code 128',      hint: 'Nhập chuỗi ký tự bất kỳ. Code 128 tự tính check character.',              placeholder: 'ABC-123',         onlyDigits: false, maxLen: 48 },
  QR:      { label: 'Nhập nội dung QR',   hint: 'Nhập văn bản, URL, số điện thoại… QR tự tính checksum.',                  placeholder: 'https://example.com', onlyDigits: false, maxLen: 500 },
};

/* ══════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════ */
let currentType = 'EAN13';
let codes = [''];
const MAX_CODES = 20;

/* ── Barcode properties state ── */
const props = {
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

/* ══════════════════════════════════════════════
   DOM REFS
   ══════════════════════════════════════════════ */
const inputsList  = document.getElementById('inputs-list');
const inputLabel  = document.getElementById('input-label');
const inputHint   = document.getElementById('input-hint');
const addBtn      = document.getElementById('add-btn');
const downloadBtn = document.getElementById('download-btn');
const errorMsg    = document.getElementById('error-msg');
const a4          = document.getElementById('a4');
const placeholder = document.getElementById('placeholder');

/* ── Props controls ── */
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

/* ══════════════════════════════════════════════
   PROPERTIES PANEL — WIRE UP CONTROLS
   ══════════════════════════════════════════════ */

/* Spinner buttons (▲ ▼) */
document.querySelectorAll('.spin-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const step  = parseFloat(input.step) || 1;
    const min   = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max   = input.max !== '' ? parseFloat(input.max) :  Infinity;
    let val = parseFloat(input.value) || 0;
    val = btn.dataset.dir === 'up' ? val + step : val - step;
    val = Math.min(max, Math.max(min, parseFloat(val.toFixed(4))));
    input.value = val;
    input.dispatchEvent(new Event('input'));
  });
});

/* Map each input to the right props key and re-render on change */
function wireNumber(el, key, parse = parseFloat) {
  el.addEventListener('input', () => {
    const v = parse(el.value);
    if (!isNaN(v)) { props[key] = v; renderPreview(); }
  });
}

wireNumber(propFontSize,   'fontSize',   parseInt);
wireNumber(propTextMargin, 'textMargin', parseInt);
wireNumber(propBarHeight,  'barHeight',  parseInt);
wireNumber(propBarWidth,   'barWidth',   parseFloat);
wireNumber(propMargin,     'margin',     parseInt);
wireNumber(propQrSize,     'qrSize',     parseInt);

propFont.addEventListener('change', () => { props.font = propFont.value; renderPreview(); });

propShowText.addEventListener('change', () => {
  props.showText = propShowText.checked;
  showtextHint.textContent = props.showText ? 'Bật' : 'Tắt';
  renderPreview();
});

propLineColor.addEventListener('input', () => {
  props.lineColor = propLineColor.value;
  linecolorHex.textContent = propLineColor.value;
  renderPreview();
});
propBgColor.addEventListener('input', () => {
  props.bgColor = propBgColor.value;
  bgcolorHex.textContent = propBgColor.value;
  renderPreview();
});

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
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

/* Build JsBarcode options from current props */
function barcodeOpts(overrides = {}) {
  return {
    format:       overrides.format || '',
    width:        props.barWidth,
    height:       props.barHeight,
    displayValue: props.showText,
    font:         props.font,
    fontSize:     props.fontSize,
    textMargin:   props.textMargin,
    margin:       props.margin,
    background:   props.bgColor,
    lineColor:    props.lineColor,
    ...overrides,
  };
}

/* ══════════════════════════════════════════════
   RENDER INPUTS
   ══════════════════════════════════════════════ */
function renderInputs() {
  const meta = META[currentType];
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

      if (currentType === 'EAN13') {
        if (!stripped.length) return;
        if (stripped.length < 12) {
          badge.className = 'check-badge err-hint';
          badge.textContent = `Còn thiếu ${12 - stripped.length} số`;
        } else {
          const full = calcEAN13(stripped);
          if (full) badge.innerHTML = `Check digit: <span class="cd">${full[12]}</span> → Mã đầy đủ: <span class="cd">${full}</span>`;
        }
      } else if (currentType === 'UPCA') {
        if (!stripped.length) return;
        if (stripped.length < 11) {
          badge.className = 'check-badge err-hint';
          badge.textContent = `Còn thiếu ${11 - stripped.length} số`;
        } else {
          const full = calcUPCA(stripped);
          if (full) badge.innerHTML = `Check digit: <span class="cd">${full[11]}</span> → Mã đầy đủ: <span class="cd">${full}</span>`;
        }
      } else if (currentType === 'ITF14') {
        if (!stripped.length) return;
        if (stripped.length < 13) {
          badge.className = 'check-badge err-hint';
          badge.textContent = `Còn thiếu ${13 - stripped.length} số`;
        } else {
          const full = calcITF14(stripped);
          if (full) badge.innerHTML = `Check digit: <span class="cd">${full[13]}</span> → Mã đầy đủ: <span class="cd">${full}</span>`;
        }
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
    if (currentType === 'EAN13' || currentType === 'UPCA' || currentType === 'ITF14') row.appendChild(badge);
    inputsList.appendChild(row);
  });

  addBtn.style.display = codes.length >= MAX_CODES ? 'none' : 'flex';
}

addBtn.addEventListener('click', () => {
  if (codes.length < MAX_CODES) { codes.push(''); renderInputs(); }
});

/* ══════════════════════════════════════════════
   SIDEBAR SWITCHING
   ══════════════════════════════════════════════ */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentType = btn.dataset.type;
    codes = [''];
    errorMsg.textContent = '';
    renderInputs();
    renderPreview();
  });
});

/* ══════════════════════════════════════════════
   RENDER PREVIEW
   ══════════════════════════════════════════════ */
function renderPreview() {
  a4.innerHTML = '';
  const filledCodes = codes.filter(c => c && c.trim());

  if (!filledCodes.length) {
    placeholder.style.display = 'flex';
    a4.appendChild(placeholder);
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
      a4.appendChild(wrap);
      new QRCode(qrDiv, {
        text: full,
        width:  props.qrSize,
        height: props.qrSize,
        colorDark:  props.lineColor,
        colorLight: props.bgColor,
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wrap.appendChild(svg);
      a4.appendChild(wrap);
      const jsFormat = currentType === 'ITF14' ? 'ITF14' : currentType === 'EAN13' ? 'EAN13' : currentType === 'UPCA' ? 'UPC' : 'CODE128';
      try {
        JsBarcode(svg, full, barcodeOpts({ format: jsFormat }));
      } catch (e) { wrap.remove(); }
    }
  });
}

/* ══════════════════════════════════════════════
   DOWNLOAD SVG
   ══════════════════════════════════════════════ */
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

function downloadBarcodeSVG(fullCodes) {
  const A4_W = 793.7, A4_H = 1122.5;
  const margin = 30, gap = 20;
  const itemW = props.barWidth * 100 + 40;  // approximate cell width
  const itemH = props.barHeight + 40;
  const cols  = Math.max(1, Math.floor((A4_W - margin * 2 + gap) / (itemW + gap)));

  const ns = 'http://www.w3.org/2000/svg';
  const rootSvg = document.createElementNS(ns, 'svg');
  rootSvg.setAttribute('xmlns', ns);
  rootSvg.setAttribute('viewBox', `0 0 ${A4_W} ${A4_H}`);
  rootSvg.setAttribute('width',  `${A4_W}`);
  rootSvg.setAttribute('height', `${A4_H}`);

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', A4_W); bg.setAttribute('height', A4_H); bg.setAttribute('fill', 'white');
  rootSvg.appendChild(bg);

  const jsFormat = currentType === 'ITF14' ? 'ITF14' : currentType === 'EAN13' ? 'EAN13' : currentType === 'UPCA' ? 'UPC' : 'CODE128';

  fullCodes.forEach((code, idx) => {
    const tmpSvg = document.createElementNS(ns, 'svg');
    try {
      JsBarcode(tmpSvg, code, barcodeOpts({ format: jsFormat }));
      const bW = parseFloat(tmpSvg.getAttribute('width')  || itemW);
      const bH = parseFloat(tmpSvg.getAttribute('height') || itemH);

      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + col * (bW + gap);
      const y = margin + row * (bH + gap);

      const inner = document.createElementNS(ns, 'svg');
      inner.setAttribute('x', x); inner.setAttribute('y', y);
      inner.setAttribute('width', bW); inner.setAttribute('height', bH);
      inner.innerHTML = tmpSvg.innerHTML;
      rootSvg.appendChild(inner);
    } catch(e) {}
  });

  triggerDownload(
    new Blob([new XMLSerializer().serializeToString(rootSvg)], { type: 'image/svg+xml' }),
    'barcodes.svg'
  );
}

function downloadQRSVG(fullCodes) {
  const A4_W = 793.7, A4_H = 1122.5;
  const margin = 30, gap = 20;
  const qrSize = props.qrSize;
  const cols   = Math.max(1, Math.floor((A4_W - margin * 2 + gap) / (qrSize + gap)));

  const ns = 'http://www.w3.org/2000/svg';
  const rootSvg = document.createElementNS(ns, 'svg');
  rootSvg.setAttribute('xmlns', ns);
  rootSvg.setAttribute('viewBox', `0 0 ${A4_W} ${A4_H}`);
  rootSvg.setAttribute('width',  `${A4_W}`);
  rootSvg.setAttribute('height', `${A4_H}`);
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', A4_W); bg.setAttribute('height', A4_H); bg.setAttribute('fill', 'white');
  rootSvg.appendChild(bg);

  fullCodes.forEach((code, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = margin + col * (qrSize + gap);
    const y = margin + row * (qrSize + gap + 18);

    const tmpDiv = document.createElement('div');
    tmpDiv.style.display = 'none';
    document.body.appendChild(tmpDiv);
    new QRCode(tmpDiv, {
      text: code, width: qrSize * 2, height: qrSize * 2,
      colorDark: props.lineColor, colorLight: props.bgColor,
      correctLevel: QRCode.CorrectLevel.M,
    });

    setTimeout(() => {
      const canvas = tmpDiv.querySelector('canvas');
      if (canvas) {
        const imgEl = document.createElementNS(ns, 'image');
        imgEl.setAttribute('x', x); imgEl.setAttribute('y', y);
        imgEl.setAttribute('width', qrSize); imgEl.setAttribute('height', qrSize);
        imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL('image/png'));
        rootSvg.appendChild(imgEl);

        if (props.showText) {
          const txt = document.createElementNS(ns, 'text');
          txt.setAttribute('x', x + qrSize / 2);
          txt.setAttribute('y', y + qrSize + 13);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', props.fontSize);
          txt.setAttribute('font-family', props.font + ', sans-serif');
          txt.setAttribute('fill', props.lineColor);
          txt.textContent = code.length > 36 ? code.slice(0, 36) + '…' : code;
          rootSvg.appendChild(txt);
        }
      }
      document.body.removeChild(tmpDiv);
      if (idx === fullCodes.length - 1) {
        setTimeout(() => {
          triggerDownload(
            new Blob([new XMLSerializer().serializeToString(rootSvg)], { type: 'image/svg+xml' }),
            'qrcodes.svg'
          );
        }, 100);
      }
    }, 200 + idx * 60);
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ── Init ── */
renderInputs();
renderPreview();