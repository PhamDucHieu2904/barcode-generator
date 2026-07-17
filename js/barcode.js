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
  GS1128:  { label: 'Nhập GS1-128',     hint: 'AI trong ngoặc đơn, không có khoảng trắng. Ví dụ: (01)12345678901231(10)LOT001', placeholder: '(01)12345678901231', onlyDigits: false, maxLen: 80 },
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
const inputsList   = document.getElementById('inputs-list');
const inputLabel   = document.getElementById('input-label');
const inputHint    = document.getElementById('input-hint');
const addBtn       = document.getElementById('add-btn');
const downloadBtn  = document.getElementById('download-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const downloadPngBtn = document.getElementById('download-png-btn');
const errorMsg     = document.getElementById('error-msg');
const cardsEl      = document.getElementById('barcode-cards');
const placeholder  = document.getElementById('placeholder');

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

  if (type === 'GS1128') {
    return raw.replace(/[\(\)\s]/g, '');
  }

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
    case 'GS1128':  return parseGS1(full) ? null : 'Chuỗi GS1-128 không hợp lệ hoặc chứa AI không nhận dạng được';
    case 'QR':      return full.length > 0 ? null : 'QR không được để trống';
    default:        return null;
  }
}

function jsFormat(type) {
  if (type === 'ITF14')  return 'ITF14';
  if (type === 'EAN13')  return 'EAN13';
  if (type === 'UPCA')   return 'UPC';
  if (type === 'GS1128') return 'CODE128'; // GS1-128 = CODE128 + FNC1, không có format riêng trong JsBarcode
  return 'CODE128';
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
    text:         overrides.text,
    ...overrides,
  };
}

const GS1_AI_FIXED = {
  '00': 18,
  '01': 14, '02': 14, '03': 14, '04': 14,
  '11': 6, '12': 6, '13': 6, '14': 6, '15': 6, '16': 6, '17': 6,
  '20': 2,
  '31': 6, '32': 6, '33': 6, '34': 6, '35': 6, '36': 6,
  '41': 13
};

function parseGS1(raw) {
  let clean = raw.replace(/[\(\)\s]/g, '');
  if (!clean) return null;
  
  let encoded = 'Ï'; // FNC1 (char 207)
  let displayValue = '';
  let i = 0;
  
  while (i < clean.length) {
    let ai = null;
    let isVariable = true;
    let dataLen = 0;
    
    let ai2 = clean.substr(i, 2);
    let ai3 = clean.substr(i, 3);
    let ai4 = clean.substr(i, 4);

    if (GS1_AI_FIXED[ai2] !== undefined) {
      ai = ai2; dataLen = GS1_AI_FIXED[ai2]; isVariable = false;
    } else if (['10','21','22','30','37','90'].includes(ai2)) {
      ai = ai2; isVariable = true;
    } else if (ai3.startsWith('41') && parseInt(ai3) <= 416) {
      ai = ai3; dataLen = 13; isVariable = false;
    } else if (['240','241','242','250','251','253','254','255','420','421','422','423','424','425','426','427'].includes(ai3)) {
       ai = ai3; isVariable = true;
    } else if (['8003','8004','8008','8018','8020','8110'].includes(ai4)) {
       ai = ai4; isVariable = true;
    } else if (ai4.startsWith('31') || ai4.startsWith('32') || ai4.startsWith('33') || ai4.startsWith('34') || ai4.startsWith('35') || ai4.startsWith('36')) {
      ai = ai4; dataLen = 6; isVariable = false;
    } else if (ai4.startsWith('39') || ai4.startsWith('80') || ai4.startsWith('81') || ai4.startsWith('82') || ai4.startsWith('9')) {
      ai = ai4; isVariable = true;
    } else {
      ai = ai2; isVariable = true;
    }

    if (!/^\d+$/.test(ai)) return null;

    i += ai.length;
    let data = '';
    
    if (!isVariable) {
      data = clean.substr(i, dataLen);
      i += dataLen;
      if (data.length < dataLen) return null; // Incomplete data for fixed length AI
    } else {
      data = clean.substr(i);
      i = clean.length;
    }
    
    encoded += ai + data;
    displayValue += `(${ai})${data}`;
    
    if (isVariable && i < clean.length) {
      encoded += 'Ï';
    }
  }
  return { encoded, displayValue };
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

/* ── Render preview (card layout) ── */
function renderPreview() {
  cardsEl.innerHTML = '';
  const filledCodes = codes.filter(c => c && c.trim());

  if (!filledCodes.length) {
    placeholder.style.display = 'flex';
    cardsEl.appendChild(placeholder);
    return;
  }
  placeholder.style.display = 'none';

  filledCodes.forEach((raw, idx) => {
    const full = getFullCode(raw, currentType);
    if (!full || validateFull(full, currentType)) return;

    const card = document.createElement('div');
    card.className = 'barcode-card';

    if (currentType === 'QR') {
      const qrDiv = document.createElement('div');
      qrDiv.id = `qr-prev-${idx}`;
      card.appendChild(qrDiv);
      cardsEl.appendChild(card);
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
      card.appendChild(svg);
      cardsEl.appendChild(card);
      try {
        let text = full;
        let data = full;
        if (currentType === 'GS1128') {
          const parsed = parseGS1(full);
          if (parsed) {
            data = parsed.encoded;
            text = parsed.displayValue;
          }
        }
        JsBarcode(svg, data, barcodeOpts({ format: jsFormat(currentType), text: text }));
      } catch (e) {
        card.innerHTML = `<div style="color:#e55;font-size:12px;padding:8px;word-break:break-all;">Lỗi: ${e.message || e}</div>`;
      }
    }
  });
}

/* ── Init all download buttons ── */
function initBarcodeDownload() {

  function getValidCodes() {
    const filledCodes = codes.filter(c => c && c.trim());
    if (!filledCodes.length) { errorMsg.textContent = 'Vui lòng nhập ít nhất một mã.'; return null; }
    const fullCodes = [];
    for (const raw of filledCodes) {
      const full = getFullCode(raw, currentType);
      if (!full) { errorMsg.textContent = `Mã "${raw}" chưa đủ ký tự.`; return null; }
      const err = validateFull(full, currentType);
      if (err) { errorMsg.textContent = err; return null; }
      fullCodes.push(full);
    }
    errorMsg.textContent = '';
    return fullCodes;
  }

  // Download SVG
  downloadBtn.addEventListener('click', () => {
    const fullCodes = getValidCodes();
    if (!fullCodes) return;
    if (currentType === 'QR') downloadQRSVG(fullCodes);
    else downloadBarcodeSVG(fullCodes);
  });

  // Download PDF
  downloadPdfBtn.addEventListener('click', async () => {
    const fullCodes = getValidCodes();
    if (!fullCodes) return;
    downloadPdfBtn.disabled = true;
    downloadPdfBtn.textContent = 'Generating...';
    try {
      if (currentType === 'QR') await downloadQRPDF(fullCodes);
      else await downloadBarcodePDF(fullCodes);
    } finally {
      downloadPdfBtn.disabled = false;
      downloadPdfBtn.textContent = 'Download PDF';
    }
  });

  // Download PNG
  downloadPngBtn.addEventListener('click', async () => {
    const fullCodes = getValidCodes();
    if (!fullCodes) return;
    downloadPngBtn.disabled = true;
    downloadPngBtn.textContent = 'Generating...';
    try {
      if (currentType === 'QR') await downloadQRPNG(fullCodes);
      else await downloadBarcodePNG(fullCodes);
    } finally {
      downloadPngBtn.disabled = false;
      downloadPngBtn.textContent = 'Download PNG';
    }
  });
}

/* ════════════════════════════════════════════
   DOWNLOAD FUNCTIONS
   ════════════════════════════════════════════ */

/**
 * Chuyển SVG element thành PNG Uint8Array để nhúng vào pdf-lib
 */
function svgToPngBytes(svgEl, w, h) {
  return new Promise((resolve) => {
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([serialized], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = w * 2;  // @2x cho nét hơn
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob2 => {
        if (!blob2) { resolve(null); return; }
        blob2.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/**
 * Chuyển SVG element thành PNG dataURL để download trực tiếp
 */
function svgToDataURL(svgEl, w, h) {
  return new Promise((resolve) => {
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([serialized], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ── Download SVG: 1 artboard, xếp dọc từ trên xuống ── */
function downloadBarcodeSVG(fullCodes) {
  const padding = 30, gap = 20;
  const ns  = 'http://www.w3.org/2000/svg';
  const fmt = jsFormat(currentType);

  // Render tất cả vào temp SVG để lấy kích thước thực tế
  const rendered = [];
  for (const code of fullCodes) {
    const tmp = document.createElementNS(ns, 'svg');
    try {
      let text = code;
      let data = code;
      if (currentType === 'GS1128') {
        const parsed = parseGS1(code);
        if (parsed) {
          data = parsed.encoded;
          text = parsed.displayValue;
        }
      }
      JsBarcode(tmp, data, barcodeOpts({ format: fmt, text: text }));
      rendered.push({
        w:    parseFloat(tmp.getAttribute('width'))  || 200,
        h:    parseFloat(tmp.getAttribute('height')) || 120,
        html: tmp.innerHTML,
      });
    } catch(e) {}
  }
  if (!rendered.length) return;

  const maxW   = Math.max(...rendered.map(r => r.w)) + padding * 2;
  const totalH = rendered.reduce((s, r) => s + r.h + gap, 0) - gap + padding * 2;

  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('viewBox', `0 0 ${maxW} ${totalH}`);
  root.setAttribute('width',  String(maxW));
  root.setAttribute('height', String(totalH));

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', maxW); bg.setAttribute('height', totalH); bg.setAttribute('fill', 'white');
  root.appendChild(bg);

  let y = padding;
  for (const r of rendered) {
    const inner = document.createElementNS(ns, 'svg');
    inner.setAttribute('x', padding);
    inner.setAttribute('y', String(y));
    inner.setAttribute('width',  String(r.w));
    inner.setAttribute('height', String(r.h));
    inner.innerHTML = r.html;
    root.appendChild(inner);
    y += r.h + gap;
  }

  triggerDownload(
    new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }),
    'barcodes.svg'
  );
}

/* ── Download PDF: mỗi barcode = 1 trang ── */
async function downloadBarcodePDF(fullCodes) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const ns  = 'http://www.w3.org/2000/svg';
  const fmt = jsFormat(currentType);
  const pad = 30;

  for (const code of fullCodes) {
    const tmp = document.createElementNS(ns, 'svg');
    try {
      let text = code;
      let data = code;
      if (currentType === 'GS1128') {
        const parsed = parseGS1(code);
        if (parsed) {
          data = parsed.encoded;
          text = parsed.displayValue;
        }
      }
      JsBarcode(tmp, data, barcodeOpts({ format: fmt, text: text }));
    } catch(e) { continue; }

    const bW = parseFloat(tmp.getAttribute('width'))  || 200;
    const bH = parseFloat(tmp.getAttribute('height')) || 120;
    const pngBytes = await svgToPngBytes(tmp, bW, bH);
    if (!pngBytes) continue;

    const page = pdfDoc.addPage([bW + pad * 2, bH + pad * 2]);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    page.drawImage(pngImage, { x: pad, y: pad, width: bW, height: bH });
  }

  const bytes = await pdfDoc.save();
  triggerDownload(new Blob([bytes], { type: 'application/pdf' }), 'barcodes.pdf');
}

/* ── Download PNG: mỗi barcode = 1 file PNG ── */
async function downloadBarcodePNG(fullCodes) {
  const ns  = 'http://www.w3.org/2000/svg';
  const fmt = jsFormat(currentType);

  for (let i = 0; i < fullCodes.length; i++) {
    const tmp = document.createElementNS(ns, 'svg');
    try {
      let text = fullCodes[i];
      let data = fullCodes[i];
      if (currentType === 'GS1128') {
        const parsed = parseGS1(fullCodes[i]);
        if (parsed) {
          data = parsed.encoded;
          text = parsed.displayValue;
        }
      }
      JsBarcode(tmp, data, barcodeOpts({ format: fmt, text: text }));
    } catch(e) { continue; }

    const bW = parseFloat(tmp.getAttribute('width'))  || 200;
    const bH = parseFloat(tmp.getAttribute('height')) || 120;
    const dataURL = await svgToDataURL(tmp, bW, bH);
    if (!dataURL) continue;

    const fname = fullCodes.length > 1 ? `barcode_${i + 1}.png` : 'barcode.png';
    triggerDownload(dataURL, fname);
    if (i < fullCodes.length - 1) await new Promise(r => setTimeout(r, 150));
  }
}

/**
 * Render một mã QR thành PNG dataURL một cách đáng tin cậy.
 * Sử dụng requestAnimationFrame thay vì setTimeout cố định.
 * @param {string} text
 * @param {object} opts
 * @returns {Promise<string|null>}
 */
function renderQRCodeToDataURL(text, opts) {
  return new Promise((resolve) => {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
    document.body.appendChild(tmp);
    // QRCode.js render đồng bộ, nhưng cần 1 frame để vẽ xong canvas
    new QRCode(tmp, opts);
    requestAnimationFrame(() => {
      const canvas = tmp.querySelector('canvas');
      const dataURL = canvas ? canvas.toDataURL('image/png') : null;
      document.body.removeChild(tmp);
      resolve(dataURL);
    });
  });
}

/* ── QR Download SVG: 1 artboard, xếp dọc ── */
async function downloadQRSVG(fullCodes) {
  const padding = 30, gap = 20;
  const qrSize  = barcodeProps.qrSize;
  const textH   = barcodeProps.showText ? barcodeProps.fontSize + 8 : 0;
  const itemH   = qrSize + textH;

  const totalH = fullCodes.length * (itemH + gap) - gap + padding * 2;
  const totalW = qrSize + padding * 2;

  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  root.setAttribute('width',  String(totalW));
  root.setAttribute('height', String(totalH));
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', totalW); bg.setAttribute('height', totalH); bg.setAttribute('fill', 'white');
  root.appendChild(bg);

  for (let idx = 0; idx < fullCodes.length; idx++) {
    const code = fullCodes[idx];
    const x = padding;
    const y = padding + idx * (itemH + gap);

    const dataURL = await renderQRCodeToDataURL(code, {
      text: code,
      width:  qrSize * 2,
      height: qrSize * 2,
      colorDark:  barcodeProps.lineColor,
      colorLight: barcodeProps.bgColor,
      correctLevel: QRCode.CorrectLevel.M,
    });

    if (dataURL) {
      const imgEl = document.createElementNS(ns, 'image');
      imgEl.setAttribute('x', x); imgEl.setAttribute('y', y);
      imgEl.setAttribute('width', qrSize); imgEl.setAttribute('height', qrSize);
      imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataURL);
      root.appendChild(imgEl);

      if (barcodeProps.showText) {
        const txt = document.createElementNS(ns, 'text');
        txt.setAttribute('x', x + qrSize / 2);
        txt.setAttribute('y', y + qrSize + barcodeProps.fontSize);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('font-size', barcodeProps.fontSize);
        txt.setAttribute('font-family', barcodeProps.font + ', sans-serif');
        txt.setAttribute('fill', barcodeProps.lineColor);
        txt.textContent = code.length > 36 ? code.slice(0, 36) + '…' : code;
        root.appendChild(txt);
      }
    }
  }

  triggerDownload(
    new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }),
    'qrcodes.svg'
  );
}

/* ── QR Download PDF: mỗi QR = 1 trang ── */
async function downloadQRPDF(fullCodes) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const qrSize = barcodeProps.qrSize;
  const pad    = 30;

  for (const code of fullCodes) {
    const dataURL = await renderQRCodeToDataURL(code, {
      text: code,
      width:  qrSize * 2,
      height: qrSize * 2,
      colorDark:  barcodeProps.lineColor,
      colorLight: barcodeProps.bgColor,
      correctLevel: QRCode.CorrectLevel.M,
    });
    if (!dataURL) continue;

    // dataURL → Uint8Array
    const res    = await fetch(dataURL);
    const blob   = await res.blob();
    const buffer = await blob.arrayBuffer();
    const bytes  = new Uint8Array(buffer);

    const page     = pdfDoc.addPage([qrSize + pad * 2, qrSize + pad * 2]);
    const pngImage = await pdfDoc.embedPng(bytes);
    page.drawImage(pngImage, { x: pad, y: pad, width: qrSize, height: qrSize });
  }

  const bytes = await pdfDoc.save();
  triggerDownload(new Blob([bytes], { type: 'application/pdf' }), 'qrcodes.pdf');
}

/* ── QR Download PNG: mỗi QR = 1 file PNG ── */
async function downloadQRPNG(fullCodes) {
  for (let i = 0; i < fullCodes.length; i++) {
    const code = fullCodes[i];
    const dataURL = await renderQRCodeToDataURL(code, {
      text: code,
      width:  barcodeProps.qrSize * 2,
      height: barcodeProps.qrSize * 2,
      colorDark:  barcodeProps.lineColor,
      colorLight: barcodeProps.bgColor,
      correctLevel: QRCode.CorrectLevel.M,
    });
    if (!dataURL) continue;

    const fname = fullCodes.length > 1 ? `qrcode_${i + 1}.png` : 'qrcode.png';
    triggerDownload(dataURL, fname);
    if (i < fullCodes.length - 1) await new Promise(r => setTimeout(r, 150));
  }
}

/* ── Public API ── */

/**
 * Chuyển sang loại barcode khác. Được gọi từ app.js.
 * Thay vì để app.js ghi trực tiếp vào biến internal, ta expose API rõ ràng.
 * @param {string} type — 'EAN13' | 'UPCA' | 'ITF14' | 'CODE128' | 'GS1128' | 'QR'
 */
function switchBarcodeType(type) {
  currentType = type;
  codes = [''];
  errorMsg.textContent = '';
  renderInputs();
  renderPreview();
}

/* ── Public init ── */
function initBarcode() {
  wireSpinners();
  wirePropsPanel();
  renderInputs();
  renderPreview();
  initBarcodeDownload();
}