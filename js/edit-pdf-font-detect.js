/* ══════════════════════════════════════════════
   edit-pdf-font-detect.js — Frontend-only font detection
   Ưu tiên PDF text layer, fallback OCR bằng Tesseract.js, sau đó
   rasterize các Google Font ứng viên và chấm điểm hình dáng glyph.
   ══════════════════════════════════════════════ */

const SMART_FONT_CATALOG = [
  { family: 'Arial', system: true, category: 'sans-serif' },
  { family: 'Helvetica', system: true, category: 'sans-serif' },
  { family: 'Verdana', system: true, category: 'sans-serif' },
  { family: 'Tahoma', system: true, category: 'sans-serif' },
  { family: 'Georgia', system: true, category: 'serif' },
  { family: 'Times New Roman', system: true, category: 'serif' },
  { family: 'Courier New', system: true, category: 'monospace' },
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Inter', category: 'sans-serif' },
  { family: 'Noto Sans', category: 'sans-serif' },
  { family: 'Source Sans 3', category: 'sans-serif' },
  { family: 'Source Sans Pro', category: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif' },
  { family: 'Ubuntu', category: 'sans-serif' },
  { family: 'PT Sans', category: 'sans-serif' },
  { family: 'Work Sans', category: 'sans-serif' },
  { family: 'Archivo', category: 'sans-serif' },
  { family: 'Mulish', category: 'sans-serif' },
  { family: 'Manrope', category: 'sans-serif' },
  { family: 'Barlow', category: 'sans-serif' },
  { family: 'DM Sans', category: 'sans-serif' },
  { family: 'Fira Sans', category: 'sans-serif' },
  { family: 'Quicksand', category: 'sans-serif' },
  { family: 'Josefin Sans', category: 'sans-serif' },
  { family: 'Oswald', category: 'condensed' },
  { family: 'Roboto Condensed', category: 'condensed' },
  { family: 'Barlow Condensed', category: 'condensed' },
  { family: 'Archivo Narrow', category: 'condensed' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Anton', category: 'display' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Noto Serif', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'Roboto Slab', category: 'serif' },
  { family: 'Crimson Text', category: 'serif' },
  { family: 'Bitter', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'Roboto Mono', category: 'monospace' },
  { family: 'Source Code Pro', category: 'monospace' },
  { family: 'IBM Plex Mono', category: 'monospace' },
  { family: 'Inconsolata', category: 'monospace' },
  { family: 'Space Mono', category: 'monospace' },
  { family: 'Lobster', category: 'display' },
  { family: 'Pacifico', category: 'handwriting' },
  { family: 'Dancing Script', category: 'handwriting' },
  { family: 'Caveat', category: 'handwriting' }
];

const _smartFontLoaded = new Set(SMART_FONT_CATALOG.filter(f => f.system).map(f => f.family));
const _smartFontBatchPromises = new Map();
const _smartPdfPageCache = new WeakMap();
let _smartOcrWorkerPromise = null;

function _smartTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
}

function _smartGoogleFamilyParam(family) {
  return family.trim().replace(/\s+/g, '+');
}

async function _ensureGoogleFontBatch(families, sampleText) {
  const missing = [...new Set(families)].filter(f => f && !_smartFontLoaded.has(f));
  if (!missing.length) return;

  const key = missing.slice().sort().join('|');
  if (_smartFontBatchPromises.has(key)) return _smartFontBatchPromises.get(key);

  const promise = new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.smartFonts = key;
    link.href = 'https://fonts.googleapis.com/css2?' +
      missing.map(f => `family=${_smartGoogleFamilyParam(f)}`).join('&') +
      '&display=swap';

    const finish = async () => {
      await Promise.all(missing.map(async family => {
        try {
          const loadedFaces = await _smartTimeout(
            document.fonts.load(`400 72px "${family}"`, sampleText || 'Hamburgefontsiv 0123456789'),
            8000,
            []
          );
          if (loadedFaces && loadedFaces.length) _smartFontLoaded.add(family);
        } catch (_) { /* Giữ fallback, không chặn cả batch. */ }
      }));
      resolve();
    };

    link.onload = finish;
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });

  _smartFontBatchPromises.set(key, promise);
  return promise;
}

async function ensureGoogleFontsLoaded(families, sampleText) {
  const googleFamilies = [...new Set((families || []).filter(f => {
    const item = SMART_FONT_CATALOG.find(x => x.family === f);
    return item && !item.system;
  }))];

  // CSS API ổn định hơn khi URL ngắn; tải song song theo batch nhỏ.
  const batches = [];
  for (let i = 0; i < googleFamilies.length; i += 8) batches.push(googleFamilies.slice(i, i + 8));
  await Promise.all(batches.map(batch => _ensureGoogleFontBatch(batch, sampleText)));
}

async function ensureGoogleFontLoaded(family, sampleText) {
  if (!family) return false;
  const item = SMART_FONT_CATALOG.find(x => x.family === family);
  if (!item || item.system) return true;
  await ensureGoogleFontsLoaded([family], sampleText);
  return _smartFontLoaded.has(family);
}

function populateSmartFontSelect(selectEl) {
  if (!selectEl) return;
  const previous = selectEl.value;
  selectEl.innerHTML = '';
  const groups = new Map();

  SMART_FONT_CATALOG.forEach(font => {
    const groupName = font.system ? 'Font hệ thống' : 'Google Fonts';
    if (!groups.has(groupName)) {
      const group = document.createElement('optgroup');
      group.label = groupName;
      groups.set(groupName, group);
      selectEl.appendChild(group);
    }
    const option = document.createElement('option');
    option.value = font.family;
    option.textContent = font.family;
    option.style.fontFamily = `"${font.family}", sans-serif`;
    groups.get(groupName).appendChild(option);
  });

  if ([...selectEl.options].some(o => o.value === previous)) selectEl.value = previous;
}

function _smartArrayBufferCopy(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return value;
}

async function _smartGetPdfPage(pg) {
  if (!pg || !pg.pdfBytes || pg.pdfPageIndex == null) return null;
  if (_smartPdfPageCache.has(pg)) return _smartPdfPageCache.get(pg);

  const promise = (async () => {
    const bytes = _smartArrayBufferCopy(pg.pdfBytes);
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    return doc.getPage(pg.pdfPageIndex + 1);
  })().catch(() => null);

  _smartPdfPageCache.set(pg, promise);
  return promise;
}

function _smartRectToOriginalPoints(pg, rect) {
  const scale = editorScale || 1;
  const r = { x: rect.x / scale, y: rect.y / scale, w: rect.w / scale, h: rect.h / scale };
  const rot = ((pg.rotation || 0) % 360 + 360) % 360;
  const originalW = pg.origWidthPt || (rot === 90 || rot === 270 ? pg.heightPt : pg.widthPt);
  const originalH = pg.origHeightPt || (rot === 90 || rot === 270 ? pg.widthPt : pg.heightPt);

  if (rot === 90) return { x: r.y, y: originalH - r.x - r.w, w: r.h, h: r.w };
  if (rot === 180) return { x: originalW - r.x - r.w, y: originalH - r.y - r.h, w: r.w, h: r.h };
  if (rot === 270) return { x: originalW - r.y - r.h, y: r.x, w: r.h, h: r.w };
  return r;
}

function _smartIntersectArea(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

function _smartNormalizePdfFontName(value) {
  return String(value || '')
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/[-_,](Bold|SemiBold|DemiBold|Medium|Light|Thin|Black|Italic|Oblique|Regular)+/gi, ' ')
    .replace(/PSMT|MT$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _smartCatalogFamilyFromName(value) {
  const normalized = _smartNormalizePdfFontName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!normalized || ['serif', 'sansserif', 'monospace', 'cursive', 'fantasy'].includes(normalized)) return null;
  return SMART_FONT_CATALOG.find(item => {
    const key = item.family.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return normalized === key || normalized.includes(key) || key.includes(normalized);
  })?.family || null;
}

async function detectTextFromPdfSelection(pg, rect) {
  const page = await _smartGetPdfPage(pg);
  if (!page) return null;

  try {
    const viewport = page.getViewport({ scale: 1 });
    const selection = _smartRectToOriginalPoints(pg, rect);
    const content = await page.getTextContent();
    const hits = [];

    content.items.forEach(item => {
      if (!item.str || !item.str.trim() || !item.transform) return;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.max(1, Math.hypot(tx[2], tx[3]) || item.height || 1);
      const itemWidth = Math.max(1, Math.abs(item.width || 0) * viewport.scale);
      const box = { x: tx[4], y: tx[5] - fontHeight, w: itemWidth, h: fontHeight };
      const overlap = _smartIntersectArea(selection, box);
      if (overlap <= 0) return;
      const overlapRatio = overlap / Math.max(1, Math.min(selection.w * selection.h, box.w * box.h));
      if (overlapRatio < 0.025) return;

      const style = content.styles[item.fontName] || {};
      hits.push({
        text: item.str.trim(),
        x: box.x,
        y: box.y,
        h: box.h,
        rawFont: style.fontFamily || item.fontName || '',
        fontName: item.fontName || ''
      });
    });

    if (!hits.length) return null;
    hits.sort((a, b) => Math.abs(a.y - b.y) > Math.max(a.h, b.h) * 0.45 ? a.y - b.y : a.x - b.x);
    const text = hits.map(x => x.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const rawNames = hits.flatMap(x => [x.rawFont, x.fontName]).filter(Boolean);
    const family = rawNames.map(_smartCatalogFamilyFromName).find(Boolean) || null;
    const rawJoined = rawNames.join(' ');
    const fontWeight = /bold|black|semibold|demibold/i.test(rawJoined) ? 'bold' : 'normal';
    const fontStyle = /italic|oblique/i.test(rawJoined) ? 'italic' : 'normal';

    return {
      source: 'pdf-text',
      text,
      confidence: family ? 0.98 : 0.88,
      family,
      fontWeight,
      fontStyle,
      rawFont: rawNames[0] || ''
    };
  } catch (_) {
    return null;
  }
}

function _smartLoadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-smart-src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window[globalName]), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.smartSrc = src;
    script.onload = () => resolve(window[globalName]);
    script.onerror = () => reject(new Error('Không tải được bộ OCR.'));
    document.head.appendChild(script);
  });
}

async function _smartGetOcrWorker(onProgress) {
  if (_smartOcrWorkerPromise) return _smartOcrWorkerPromise;
  _smartOcrWorkerPromise = (async () => {
    const TesseractLib = await _smartLoadScript(
      'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
      'Tesseract'
    );
    const options = {
      logger: message => {
        if (onProgress && message && message.status) onProgress(message.status, message.progress || 0);
      }
    };
    let worker;
    try {
      worker = await TesseractLib.createWorker(['eng', 'vie'], TesseractLib.OEM.LSTM, options);
    } catch (_) {
      // Nếu model tiếng Việt tạm thời không tải được, OCR tiếng Anh vẫn hữu ích
      // cho số, mã, tên riêng và cho phép người dùng sửa lại chuỗi gốc.
      worker = await TesseractLib.createWorker('eng', TesseractLib.OEM.LSTM, options);
    }
    await worker.setParameters({
      tessedit_pageseg_mode: TesseractLib.PSM.SINGLE_LINE,
      preserve_interword_spaces: '1'
    });
    return worker;
  })().catch(err => {
    _smartOcrWorkerPromise = null;
    throw err;
  });
  return _smartOcrWorkerPromise;
}

async function detectTextWithOcr(base64, onProgress) {
  try {
    const worker = await _smartGetOcrWorker(onProgress);
    const result = await worker.recognize('data:image/png;base64,' + base64);
    const text = result?.data?.text?.replace(/\s+/g, ' ').trim() || '';
    if (!text) return null;
    return {
      source: 'ocr',
      text,
      confidence: Math.max(0, Math.min(1, (result.data.confidence || 0) / 100)),
      family: null,
      fontWeight: 'normal',
      fontStyle: 'normal'
    };
  } catch (err) {
    console.warn('[Font Detect] OCR unavailable:', err);
    return null;
  }
}

function _smartLoadBase64Image(base64) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = 'data:image/png;base64,' + base64;
  });
}

function _smartMedian(values) {
  if (!values.length) return 255;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function _smartOtsu(histogram, count) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * histogram[i];
  let sumB = 0, weightB = 0, maxVariance = 0, threshold = 24;
  for (let i = 0; i < 256; i++) {
    weightB += histogram[i];
    if (!weightB) continue;
    const weightF = count - weightB;
    if (!weightF) break;
    sumB += i * histogram[i];
    const meanB = sumB / weightB;
    const meanF = (total - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance) { maxVariance = variance; threshold = i; }
  }
  return threshold;
}

async function _smartExtractInkMask(base64) {
  const image = await _smartLoadBase64Image(base64);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const W = canvas.width, H = canvas.height;
  const pixels = ctx.getImageData(0, 0, W, H).data;

  const br = [], bg = [], bb = [];
  const border = Math.max(1, Math.round(Math.min(W, H) * 0.08));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= border && x < W - border && y >= border && y < H - border) continue;
      const i = (y * W + x) * 4;
      br.push(pixels[i]); bg.push(pixels[i + 1]); bb.push(pixels[i + 2]);
    }
  }
  const background = [_smartMedian(br), _smartMedian(bg), _smartMedian(bb)];
  const deltas = new Uint8Array(W * H);
  const histogram = new Uint32Array(256);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const dr = pixels[i] - background[0];
    const dg = pixels[i + 1] - background[1];
    const db = pixels[i + 2] - background[2];
    const delta = Math.min(255, Math.round(Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11)));
    deltas[p] = delta;
    histogram[delta]++;
  }

  const threshold = Math.max(16, Math.min(110, _smartOtsu(histogram, W * H)));
  const mask = new Uint8Array(W * H);
  let minX = W, minY = H, maxX = -1, maxY = -1, inkCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (deltas[p] <= threshold) continue;
      mask[p] = 1;
      inkCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!inkCount || inkCount > W * H * 0.72 || maxX <= minX || maxY <= minY) {
    // Fallback cho crop quá phức tạp: dùng độ sáng tương phản với nền.
    mask.fill(0); minX = W; minY = H; maxX = -1; maxY = -1; inkCount = 0;
    const bgLum = background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, i = p * 4;
        const lum = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
        if (Math.abs(lum - bgLum) < 32) continue;
        mask[p] = 1; inkCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!inkCount || maxX <= minX || maxY <= minY) throw new Error('Không tách được nét chữ trong vùng chọn.');
  return { mask, width: W, height: H, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

function _smartNormalizeSourceMask(info) {
  const W = 256, H = 72, padX = 8, padY = 8;
  const out = new Uint8Array(W * H);
  const box = info.bbox;
  const scale = Math.min((W - padX * 2) / box.w, (H - padY * 2) / box.h);
  const targetW = Math.max(1, Math.round(box.w * scale));
  const targetH = Math.max(1, Math.round(box.h * scale));
  for (let ty = 0; ty < targetH; ty++) {
    const sy = box.y + Math.min(box.h - 1, Math.floor(ty / scale));
    for (let tx = 0; tx < targetW; tx++) {
      const sx = box.x + Math.min(box.w - 1, Math.floor(tx / scale));
      if (info.mask[sy * info.width + sx]) out[(padY + ty) * W + padX + tx] = 1;
    }
  }
  return { mask: out, width: W, height: H, inkW: targetW, inkH: targetH, padX, padY };
}

function _smartRenderCandidateMask(text, family, weight, style, source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const probeSize = 100;
  ctx.font = `${style} ${weight} ${probeSize}px "${family}", sans-serif`;
  const probe = ctx.measureText(text);
  const probeHeight = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent || probeSize;
  const size = Math.max(4, probeSize * source.inkH / probeHeight);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${style} ${weight} ${size}px "${family}", sans-serif`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const metrics = ctx.measureText(text);
  const x = source.padX + (metrics.actualBoundingBoxLeft || 0);
  const y = source.padY + (metrics.actualBoundingBoxAscent || size * 0.8);
  ctx.fillText(text, x, y);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(canvas.width * canvas.height);
  let count = 0, minX = canvas.width, maxX = -1;
  for (let p = 0; p < mask.length; p++) {
    if (data[p * 4 + 3] > 64) {
      mask[p] = 1; count++;
      const px = p % canvas.width;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
    }
  }
  return { mask, count, inkW: maxX >= minX ? maxX - minX + 1 : 0 };
}

function _smartMaskDice(source, candidate, dx, dy) {
  const W = source.width, H = source.height;
  let intersection = 0, sourceCount = 0, candidateCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = source.mask[y * W + x];
      const cx = x - dx, cy = y - dy;
      const c = cx >= 0 && cx < W && cy >= 0 && cy < H ? candidate.mask[cy * W + cx] : 0;
      if (s) sourceCount++;
      if (c) candidateCount++;
      if (s && c) intersection++;
    }
  }
  return 2 * intersection / Math.max(1, sourceCount + candidateCount);
}

function _smartProjectionScore(source, candidate) {
  const W = source.width, H = source.height;
  let diffX = 0, totalX = 0, diffY = 0, totalY = 0;
  for (let x = 0; x < W; x++) {
    let a = 0, b = 0;
    for (let y = 0; y < H; y++) { a += source.mask[y * W + x]; b += candidate.mask[y * W + x]; }
    diffX += Math.abs(a - b); totalX += Math.max(a, b);
  }
  for (let y = 0; y < H; y++) {
    let a = 0, b = 0;
    for (let x = 0; x < W; x++) { a += source.mask[y * W + x]; b += candidate.mask[y * W + x]; }
    diffY += Math.abs(a - b); totalY += Math.max(a, b);
  }
  return 1 - ((diffX / Math.max(1, totalX)) * 0.55 + (diffY / Math.max(1, totalY)) * 0.45);
}

function _smartScoreCandidate(source, candidate) {
  let bestDice = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) bestDice = Math.max(bestDice, _smartMaskDice(source, candidate, dx, dy));
  }
  const widthRatio = Math.min(source.inkW, candidate.inkW) / Math.max(1, Math.max(source.inkW, candidate.inkW));
  const sourceInk = source.mask.reduce((sum, value) => sum + value, 0);
  const densityRatio = Math.min(sourceInk, candidate.count) / Math.max(1, Math.max(sourceInk, candidate.count));
  const projection = Math.max(0, _smartProjectionScore(source, candidate));
  return bestDice * 0.55 + projection * 0.20 + widthRatio * 0.18 + densityRatio * 0.07;
}

async function detectNearestGoogleFonts(base64, sourceText, hint, onProgress) {
  if (!sourceText || !sourceText.trim()) return [];
  const text = sourceText.trim().slice(0, 80);
  let candidateCatalog = SMART_FONT_CATALOG;
  if (hint?.family) {
    const exact = SMART_FONT_CATALOG.find(font => font.family === hint.family);
    if (exact) {
      const sameCategory = SMART_FONT_CATALOG.filter(font => font.family !== exact.family && font.category === exact.category).slice(0, 16);
      const crossCategory = SMART_FONT_CATALOG.filter(font => font.family !== exact.family && font.category !== exact.category)
        .filter((font, index, list) => list.findIndex(x => x.category === font.category) === index);
      candidateCatalog = [exact, ...sameCategory, ...crossCategory];
    }
  }
  if (onProgress) onProgress('Đang tải font ứng viên…', 0.15);
  await ensureGoogleFontsLoaded(candidateCatalog.map(x => x.family), text);
  if (onProgress) onProgress('Đang so khớp hình dáng chữ…', 0.55);

  const source = _smartNormalizeSourceMask(await _smartExtractInkMask(base64));
  const variants = [
    { fontWeight: 'normal', fontStyle: 'normal' },
    { fontWeight: 'bold', fontStyle: 'normal' },
    { fontWeight: 'normal', fontStyle: 'italic' }
  ];
  const results = [];

  for (let index = 0; index < candidateCatalog.length; index++) {
    const font = candidateCatalog[index];
    if (!font.system && !_smartFontLoaded.has(font.family)) continue;
    let best = null;
    variants.forEach(variant => {
      const candidate = _smartRenderCandidateMask(text, font.family, variant.fontWeight, variant.fontStyle, source);
      let score = _smartScoreCandidate(source, candidate);
      if (hint?.family === font.family) score = Math.min(1, score + 0.18);
      if (hint?.fontWeight === variant.fontWeight) score += 0.015;
      if (hint?.fontStyle === variant.fontStyle) score += 0.015;
      if (!best || score > best.score) best = { family: font.family, category: font.category, score, ...variant };
    });
    if (best) results.push(best);
    if (onProgress && index % 8 === 0) onProgress('Đang so khớp hình dáng chữ…', 0.55 + 0.4 * index / candidateCatalog.length);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 3).map((result, index) => ({
    ...result,
    rank: index + 1,
    confidence: Math.max(1, Math.min(99, Math.round(result.score * 100)))
  }));
}

async function analyzeSelectionFont(pg, rect, base64, onProgress) {
  if (onProgress) onProgress('Đang đọc text trong PDF…', 0.03);
  let source = await detectTextFromPdfSelection(pg, rect);
  if (!source) {
    if (onProgress) onProgress('Không có text layer, đang OCR vùng chọn…', 0.05);
    source = await detectTextWithOcr(base64, onProgress);
  }

  if (!source || !source.text) {
    return {
      source: 'manual',
      text: '',
      confidence: 0,
      candidates: [{ family: 'Arial', fontWeight: 'normal', fontStyle: 'normal', confidence: 0, rank: 1 }]
    };
  }

  const candidates = await detectNearestGoogleFonts(base64, source.text, source, onProgress);
  if (onProgress) onProgress('Đã nhận diện xong', 1);
  return { ...source, candidates };
}
