/* ══════════════════════════════════════════════
   edit-pdf-export.js — PDF & Image export
   Chứa: _renderTextToPng, _generateEditedPdfBytes,
         _buildAndDownloadEditPDF, _exportEditImages
   Phụ thuộc: edit-pdf-state.js, convertToPNG (utils.js)
   ══════════════════════════════════════════════ */

// 1. HÀM MỚI: Xử lý triệt để lỗi tiếng Việt bằng cách vẽ Text thành ảnh PNG siêu nét
async function _renderTextToPng(obj) {
  if (typeof ensureGoogleFontLoaded === 'function') {
    await ensureGoogleFontLoaded(obj.fontFamily || 'Arial', obj.content || 'Tiếng Việt');
  }
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const scale = 4; // Khử răng cưa bằng độ phân giải 4x
    canvas.width = obj.w * scale;
    canvas.height = obj.h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Cài đặt font chữ y hệt như UI
    const fontSize = obj.fontSize || 16;
    ctx.font = `${obj.fontStyle === 'italic' ? 'italic' : 'normal'} ${obj.fontWeight === 'bold' ? 'bold' : 'normal'} ${fontSize}px "${obj.fontFamily || 'Arial'}", sans-serif`;
    ctx.fillStyle = obj.color || '#000000';
    ctx.textBaseline = 'top';

    // Cài đặt viền chữ (stroke)
    const strokeW = obj.strokeWidth || 0;
    const strokeC = obj.stroke || 'none';
    if (strokeW > 0 && strokeC !== 'none') {
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = strokeC;
      ctx.lineJoin = 'round';
    }

    // Xử lý xuống dòng tự động (Word Wrap)
    const lines = [];
    const paragraphs = (obj.content || '').split('\n');
    for (const p of paragraphs) {
      let currentLine = '';
      const words = p.split(' ');
      for (const word of words) {
        const testLine = currentLine + word + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > obj.w && currentLine !== '') {
          lines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine = testLine;
        }
      }
      lines.push(currentLine.trim());
    }

    // Căn lề (Align) và vẽ lên Canvas
    const lineHeight = fontSize * 1.2;
    let y = 0;
    for (const line of lines) {
      let x = 0;
      const lineWidth = ctx.measureText(line).width;
      if (obj.textAlign === 'center') {
        x = (obj.w - lineWidth) / 2;
      } else if (obj.textAlign === 'right') {
        x = obj.w - lineWidth;
      }
      
      if (strokeW > 0 && strokeC !== 'none') ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
      y += lineHeight;
    }

    resolve(canvas.toDataURL('image/png'));
  });
}

function _loadExportImage(dataURL) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không thể đọc ảnh của lớp chỉnh sửa.'));
    image.src = dataURL;
  });
}

function _dataUrlBytes(dataURL) {
  const commaIndex = typeof dataURL === 'string' ? dataURL.indexOf(',') : -1;
  if (commaIndex < 0) throw new Error('Dữ liệu ảnh chỉnh sửa không hợp lệ.');
  const binary = atob(dataURL.slice(commaIndex + 1));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

const _smartVectorFontBytes = new Map();
const _smartVectorDocumentFonts = new WeakMap();

function _smartVectorStandardFontName(family, weight, style) {
  const name = String(family || '').toLowerCase();
  const bold = weight === 'bold' || Number(weight) >= 600;
  const italic = style === 'italic';
  let group = 'Helvetica';
  if (name.includes('times') || name.includes('georgia') || name.includes('serif')) group = 'TimesRoman';
  else if (name.includes('courier') || name.includes('mono')) group = 'Courier';
  const suffix = bold && italic ? (group === 'TimesRoman' ? 'BoldItalic' : 'BoldOblique')
    : bold ? 'Bold'
    : italic ? (group === 'TimesRoman' ? 'Italic' : 'Oblique')
    : '';
  return PDFLib.StandardFonts[group + suffix];
}

function _smartVectorGoogleFallbackFamily(family) {
  const name = String(family || '').toLowerCase();
  if (name.includes('times')) return 'Tinos';
  if (name.includes('courier')) return 'Cousine';
  if (name.includes('georgia')) return 'Noto Serif';
  return 'Arimo';
}

async function _fetchSmartVectorFontBytes(family, weight, style, text) {
  const numericWeight = weight === 'bold' || Number(weight) >= 600 ? 700 : 400;
  const italicAxis = style === 'italic' ? 1 : 0;
  const familyParam = String(family || 'Arimo').trim().replace(/\s+/g, '+');
  const cacheKey = `${familyParam}|${italicAxis}|${numericWeight}|${text}`;
  if (_smartVectorFontBytes.has(cacheKey)) return _smartVectorFontBytes.get(cacheKey);

  const load = (async () => {
    const base = `https://fonts.googleapis.com/css2?family=${familyParam}`;
    const suffix = `&text=${encodeURIComponent(text || 'Text')}&display=swap`;
    let response = await fetch(`${base}:ital,wght@${italicAxis},${numericWeight}${suffix}`);
    if (!response.ok) response = await fetch(base + suffix);
    if (!response.ok) throw new Error(`Không tải được font vector ${family}.`);
    const css = await response.text();
    const match = css.match(/url\((?:['"])?(https:\/\/[^)'"]+)(?:['"])?\)/i);
    if (!match) throw new Error(`Google Fonts không trả về file font cho ${family}.`);
    const fontResponse = await fetch(match[1]);
    if (!fontResponse.ok) throw new Error(`Không tải được dữ liệu font ${family}.`);
    return new Uint8Array(await fontResponse.arrayBuffer());
  })();
  _smartVectorFontBytes.set(cacheKey, load);
  try { return await load; }
  catch (error) { _smartVectorFontBytes.delete(cacheKey); throw error; }
}

async function _embedSmartVectorFont(outDoc, smartText, text) {
  let documentCache = _smartVectorDocumentFonts.get(outDoc);
  if (!documentCache) {
    documentCache = new Map();
    _smartVectorDocumentFonts.set(outDoc, documentCache);
  }
  const family = smartText.fontFamily || 'Arial';
  const weight = smartText.fontWeight || 'normal';
  const style = smartText.fontStyle || 'normal';
  const catalogItem = typeof SMART_FONT_CATALOG !== 'undefined'
    ? SMART_FONT_CATALOG.find(item => item.family === family)
    : null;
  const cacheKey = `${family}|${weight}|${style}|${text}`;
  if (documentCache.has(cacheKey)) return documentCache.get(cacheKey);

  const promise = (async () => {
    if (catalogItem?.system || !catalogItem) {
      const standard = await outDoc.embedFont(_smartVectorStandardFontName(family, weight, style));
      try {
        standard.encodeText(text);
        return standard;
      } catch (_) {
        // Standard PDF fonts are WinAnsi-only. Use a metric-compatible Google
        // font when the replacement contains Vietnamese/Cyrillic/Unicode.
      }
    }
    const fontkitGlobal = globalThis.fontkit;
    if (!fontkitGlobal) throw new Error('Fontkit chưa sẵn sàng để nhúng font vector.');
    outDoc.registerFontkit(fontkitGlobal);
    const downloadFamily = catalogItem?.system || !catalogItem
      ? _smartVectorGoogleFallbackFamily(family)
      : family;
    const bytes = await _fetchSmartVectorFontBytes(downloadFamily, weight, style, text);
    return outDoc.embedFont(bytes, { subset: true });
  })();
  documentCache.set(cacheKey, promise);
  try { return await promise; }
  catch (error) { documentCache.delete(cacheKey); throw error; }
}

function _mapVisualPointToPdfPage(point, page, totalRot) {
  const box = page && typeof page.getCropBox === 'function'
    ? page.getCropBox()
    : { x: 0, y: 0, ...page.getSize() };
  const rotation = ((Number(totalRot) || 0) % 360 + 360) % 360;
  if (rotation === 90) return { x: box.x + point.y, y: box.y + point.x };
  if (rotation === 180) return { x: box.x + box.width - point.x, y: box.y + point.y };
  if (rotation === 270) return { x: box.x + box.width - point.y, y: box.y + box.height - point.x };
  return { x: box.x + point.x, y: box.y + box.height - point.y };
}

async function _drawSmartVectorText(outDoc, page, obj, visualRect, totalRot) {
  const smartText = obj.smartText || {};
  const vector = smartText.vectorText;
  const text = String(vector?.text || smartText.replacementText || '');
  if (!vector || !text) return;
  const canvasWidth = Math.max(1, Number(vector.canvasWidth) || 1);
  const canvasHeight = Math.max(1, Number(vector.canvasHeight) || 1);
  const size = Math.max(0.1, (Number(vector.fontSize) || 12) * visualRect.h / canvasHeight);
  const font = await _embedSmartVectorFont(outDoc, smartText, text);
  let anchorX = visualRect.x + (Number(vector.x) || 0) * visualRect.w / canvasWidth;
  const baselineY = visualRect.y + (Number(vector.baseline) || 0) * visualRect.h / canvasHeight;
  const textWidth = font.widthOfTextAtSize(text, size);
  if (vector.align === 'center') anchorX -= textWidth / 2;
  else if (vector.align === 'right') anchorX -= textWidth;
  const point = _mapVisualPointToPdfPage({ x: anchorX, y: baselineY }, page, totalRot);
  const color = hexToRgb(vector.color || smartText.textColor || '#000000');
  page.drawText(text, {
    x: point.x,
    y: point.y,
    size,
    font,
    color: PDFLib.rgb(color.r, color.g, color.b),
    rotate: PDFLib.degrees(((Number(totalRot) || 0) % 360 + 360) % 360)
  });
}

async function _prepareSmartPatchForPdf(dataURL, pageRotation) {
  const normalizedRot = ((Number(pageRotation) || 0) % 360 + 360) % 360;
  if (normalizedRot === 0) return dataURL;
  const image = await _loadExportImage(dataURL);
  const canvas = document.createElement('canvas');
  const swapsAxes = normalizedRot === 90 || normalizedRot === 270;
  canvas.width = swapsAxes ? image.naturalHeight : image.naturalWidth;
  canvas.height = swapsAxes ? image.naturalWidth : image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không thể xoay ảnh chữ khi xuất PDF.');

  // A PDF page rotates all raw page content when displayed. Rotate the patch in
  // the opposite direction first so it stays upright in visual page space.
  if (normalizedRot === 90) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  } else if (normalizedRot === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (normalizedRot === 270) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function _mapVisualRectToPdfPage(rectPt, page, totalRot) {
  const targetBox = page && typeof page.getCropBox === 'function'
    ? page.getCropBox()
    : { x: 0, y: 0, ...page.getSize() };
  const vx = rectPt.x, vy = rectPt.y, vw = rectPt.w, vh = rectPt.h;
  const rotation = ((Number(totalRot) || 0) % 360 + 360) % 360;
  let x, y, width, height;

  if (rotation === 90) {
    x = targetBox.x + vy;
    y = targetBox.y + vx;
    width = vh; height = vw;
  } else if (rotation === 180) {
    x = targetBox.x + targetBox.width - vx - vw;
    y = targetBox.y + vy;
    width = vw; height = vh;
  } else if (rotation === 270) {
    x = targetBox.x + targetBox.width - vy - vh;
    y = targetBox.y + targetBox.height - vx - vw;
    width = vh; height = vw;
  } else {
    x = targetBox.x + vx;
    y = targetBox.y + targetBox.height - vy - vh;
    width = vw; height = vh;
  }
  return { x, y, width, height };
}

// Hàm mới: Crop ngay lập tức và hiển thị kết quả
async function _applyCropToPage(currentPg, cropbox) {
  try {
    const area = document.getElementById('edit-canvas-area');
    const areaW = area ? (area.clientWidth || 600) : 600;
    const areaH = area ? (area.clientHeight || 700) : 700;
    
    const isRotated = currentPg.rotation === 90 || currentPg.rotation === 270;
    const logicalW = isRotated ? currentPg.heightPt : currentPg.widthPt;
    const logicalH = isRotated ? currentPg.widthPt : currentPg.heightPt;
    const pageScale = Math.min((areaW - 32) / logicalW, (areaH - 32) / logicalH, 1.5);

    const pdfX = cropbox.x / pageScale;
    const pdfW = cropbox.w / pageScale;
    const pdfH = cropbox.h / pageScale;
    const shiftX = cropbox.x;
    const shiftY = cropbox.y;

    const isMasterAll = document.getElementById('edit-master-all-toggle')?.classList.contains('active');
    const pagesToCrop = isMasterAll ? editPages : [currentPg];

    document.body.style.cursor = 'wait';

    for (const pg of pagesToCrop) {
      // Tính lại pdfY (từ dưới lên) cho từng trang vì mỗi trang có thể có heightPt khác nhau
      const localPdfY = pg.heightPt - ((cropbox.y + cropbox.h) / pageScale); 

      if (pg.pdfBytes) {
        const { PDFDocument } = PDFLib;
        const srcDoc = await PDFDocument.load(pg.pdfBytes, { ignoreEncryption: true });
        
        const newDoc = await PDFDocument.create();
        const newPage = newDoc.addPage([pdfW, pdfH]);
        
        // Dùng kĩ thuật "embed" để crop cứng vĩnh viễn (Illustrator sẽ nhận diện đây là clipping mask thực sự/trang mới)
        const [embeddedPage] = await newDoc.embedPdf(srcDoc, [pg.pdfPageIndex]);
        
        // Đặt tọa độ âm để dịch chuyển phần giữ lại vào đúng khung (0,0) của trang mới
        newPage.drawPage(embeddedPage, { x: -pdfX, y: -localPdfY });
        
        pg.pdfBytes = await newDoc.save();
        pg.pdfPageIndex = 0;
        
        pg.origWidthPt = pg.widthPt = pdfW;
        pg.origHeightPt = pg.heightPt = pdfH;
        // KHÔNG reset pg.rotation để giữ nguyên góc xoay mà user đã chọn
        
        const pdf = await pdfjsLib.getDocument({ data: pg.pdfBytes }).promise;
        const pdfPage = await pdf.getPage(1);
        const viewport = pdfPage.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        
        pg.renderURL = canvas.toDataURL('image/png');
        pg.previewURLLow = pg.renderURL;
        pg.renderScale = 2.0;
      } else if (pg.imageDataURL) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = pg.imageDataURL; });
        const canvas = document.createElement('canvas');
        const scaleX = img.width / pg.widthPt;
        const scaleY = img.height / pg.heightPt;
        canvas.width = pdfW * scaleX;
        canvas.height = pdfH * scaleY;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropbox.x / pageScale * scaleX, cropbox.y / pageScale * scaleY, pdfW * scaleX, pdfH * scaleY, 0, 0, canvas.width, canvas.height);
        
        pg.imageDataURL = canvas.toDataURL('image/png');
        pg.renderURL = pg.imageDataURL;
        pg.previewURLLow = pg.renderURL;
        pg.renderScale = Math.max(scaleX, scaleY);
        pg.origWidthPt = pg.widthPt = pdfW;
        pg.origHeightPt = pg.heightPt = pdfH;
        // KHÔNG reset pg.rotation
      }
      
      pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== cropbox.id && o.type !== 'cropbox');
      pg.overlayObjects.forEach(o => {
        o.x -= shiftX;
        o.y -= shiftY;
        if (o.rectPt && typeof _syncObjectRectPt === 'function') _syncObjectRectPt(o, pageScale);
      });
    }
    
    document.body.style.cursor = '';
    _renderEditThumbs();
    _openPageEditor(currentPg);
    _saveHistory();
  } catch (e) {
    document.body.style.cursor = '';
    console.error(e);
    alert('Lỗi crop: ' + e.message);
  }
}

// 2. HÀM CŨ ĐÃ ĐƯỢC NÂNG CẤP (Kết nối với hàm vẽ Text ở trên)
async function _generateEditedPdfBytes() {
  const { PDFDocument, rgb } = PDFLib;
  const outDoc = await PDFDocument.create();

  const area = document.getElementById('edit-canvas-area');
  const areaW = area ? (area.clientWidth || 600) : 600;
  const areaH = area ? (area.clientHeight || 700) : 700;

  for (const pg of editPages) {
    let page;
    const isResized = (pg.widthPt !== pg.origWidthPt) || (pg.heightPt !== pg.origHeightPt);

    if (pg.imageDataURL) {
      page = outDoc.addPage([pg.widthPt, pg.heightPt]);
      const isJpeg = pg.imageDataURL.startsWith('data:image/jpeg') || pg.imageDataURL.startsWith('data:image/jpg');
      const base64 = pg.imageDataURL.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      let imgEmbed;
      try { imgEmbed = isJpeg ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes); }
      catch {
        const pngURL = await convertToPNG(pg.imageDataURL); // utils.js
        const pngByte = Uint8Array.from(atob(pngURL.split(',')[1]), c => c.charCodeAt(0));
        imgEmbed = await outDoc.embedPng(pngByte);
      }
      const ratio = Math.min(pg.widthPt / imgEmbed.width, pg.heightPt / imgEmbed.height);
      const dw = imgEmbed.width * ratio, dh = imgEmbed.height * ratio;
      page.drawImage(imgEmbed, { x: (pg.widthPt - dw) / 2, y: (pg.heightPt - dh) / 2, width: dw, height: dh });
      
    } else if (pg.pdfBytes) {
      const srcDoc = await PDFDocument.load(pg.pdfBytes, { ignoreEncryption: true });
      const [copied] = await outDoc.copyPages(srcDoc, [pg.pdfPageIndex]);
      outDoc.addPage(copied);
      page = outDoc.getPage(outDoc.getPageCount() - 1);
      // Cộng thêm user rotation vào built-in rotation của PDF
      if (pg.rotation) {
        const currentRot = page.getRotation().angle || 0;
        page.setRotation(PDFLib.degrees((currentRot + pg.rotation) % 360));
      }

    } else {
      page = outDoc.addPage([pg.widthPt || 595, pg.heightPt || 842]);
    }

    // pageScale dựa trên visual dimensions (đã đúng sau fix)
    const pageScale = Math.min((areaW - 32) / pg.widthPt, (areaH - 32) / pg.heightPt, 1.5);

    // Tổng rotation = built-in rotation của PDF + user's physical rotation
    // Dùng để map visual coords → PDF raw coords khi vẽ overlay
    const builtInRot = pg.pdfBuiltInRotation || 0;
    const userRot    = pg.rotation || 0;
    const totalRot   = (builtInRot + userRot) % 360;

    // pg.widthPt/heightPt là visual dimensions (sau tất cả rotation)
    for (const obj of pg.overlayObjects) {
      // Map visual coords (y từ trên xuống) → PDF raw coords (y từ dưới lên)
      // dựa theo totalRot (tổng xoay của visual so với raw PDF)
      const objectScale = Number(obj.coordinateScale) > 0 ? Number(obj.coordinateScale) : pageScale;
      const visualRect = obj.rectPt || {
        x: obj.x / objectScale,
        y: obj.y / objectScale,
        w: obj.w / objectScale,
        h: obj.h / objectScale
      };
      const mappedRect = _mapVisualRectToPdfPage(visualRect, page, totalRot);
      const pdfX = mappedRect.x, pdfY = mappedRect.y;
      const pdfW = mappedRect.width, pdfH = mappedRect.height;

      if (obj.type === 'text') {
        try {
          const isTransparent = obj.color === 'transparent' || obj.color === 'none';
          if (isTransparent || !obj.content || obj.content.trim() === '') continue;

          // Thay vì dùng font mặc định gây lỗi Unicode, gọi hàm xuất Text thành ảnh PNG siêu nét
          const pngDataUrl = await _renderTextToPng(obj);
          if (pngDataUrl) {
            const base64 = pngDataUrl.split(',')[1];
            const pngBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const imgEmbed = await outDoc.embedPng(pngBytes);
            page.drawImage(imgEmbed, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
          }
        } catch(e2) { console.error("Lỗi khi vẽ Text", e2); }
        
      } else if (obj.type === 'image' && obj.smartText && obj.dataURL) {
        const isVector = obj.smartText.renderMode === 'vector';
        const backgroundURL = isVector
          ? (obj.smartText.backgroundDataURL || obj.dataURL)
          : obj.dataURL;
        // Embed the native-PPI patch itself. Vector mode embeds only the clean
        // background here, then draws real selectable PDF text above it.
        const preparedURL = await _prepareSmartPatchForPdf(backgroundURL, totalRot);
        const imgE = await outDoc.embedPng(_dataUrlBytes(preparedURL));
        page.drawImage(imgE, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
        if (isVector) {
          try {
            await _drawSmartVectorText(outDoc, page, obj, visualRect, totalRot);
          } catch (vectorError) {
            console.warn('[Smart Text] Vector export fallback to raster:', vectorError);
            const rasterURL = obj.smartText.rasterDataURL;
            if (rasterURL) {
              const rasterPrepared = await _prepareSmartPatchForPdf(rasterURL, totalRot);
              const rasterImage = await outDoc.embedPng(_dataUrlBytes(rasterPrepared));
              page.drawImage(rasterImage, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
            }
          }
        }

      } else if (obj.type === 'image' && obj.dataURL) {
        try {
          const isJ = obj.dataURL.startsWith('data:image/jpeg') || obj.dataURL.startsWith('data:image/jpg');
          const imgB = _dataUrlBytes(obj.dataURL);
          let imgE;
          try { imgE = isJ ? await outDoc.embedJpg(imgB) : await outDoc.embedPng(imgB); }
          catch {
            const pu = await convertToPNG(obj.dataURL); // utils.js
            imgE = await outDoc.embedPng(Uint8Array.from(atob(pu.split(',')[1]), c => c.charCodeAt(0)));
          }
          page.drawImage(imgE, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
        } catch(e3) { console.error("Lỗi khi vẽ Image", e3); }

      } else if (obj.type === 'shape') {
        try {
          const strokeColor = (obj.shapeStroke && obj.shapeStroke !== 'none') ? obj.shapeStroke : null;
          const fillColor   = (obj.shapeFill   && obj.shapeFill   !== 'none') ? obj.shapeFill   : null;
          const sw          = ((obj.shapeStrokeWidth != null ? obj.shapeStrokeWidth : 2)) / pageScale;
          const isDashed    = obj.shapeStrokeDash === 'dashed';

          // hexToRgb đã được chuyển ra module scope trong edit-pdf-state.js
          const strokeRgb = strokeColor ? (() => { const sc = hexToRgb(strokeColor); return PDFLib.rgb(sc.r, sc.g, sc.b); })() : undefined;
          const fillRgb   = fillColor   ? (() => { const fc = hexToRgb(fillColor);   return PDFLib.rgb(fc.r, fc.g, fc.b); })() : undefined;

          if (obj.shapeType === 'rect') {
            page.drawRectangle({
              x: pdfX, y: pdfY, width: pdfW, height: pdfH,
              borderColor: strokeRgb, borderWidth: strokeRgb ? sw : 0,
              color: fillRgb,
              borderDashArray: isDashed && strokeRgb ? [sw * 3, sw * 2] : undefined 
            });

          } else if (obj.shapeType === 'ellipse') {
            page.drawEllipse({
              x: pdfX + pdfW / 2, y: pdfY + pdfH / 2,
              xScale: pdfW / 2, yScale: pdfH / 2,
              borderColor: strokeRgb, borderWidth: strokeRgb ? sw : 0,
              color: fillRgb,
              borderDashArray: isDashed && strokeRgb ? [sw * 3, sw * 2] : undefined
            });

          } else if (obj.shapeType === 'triangle') {
            const pdfY_top = pg.heightPt - (obj.y / pageScale); 
            const triPath  = `M ${pdfW/2},0 L ${pdfW},${pdfH} L 0,${pdfH} Z`;
            page.drawSvgPath(triPath, {
              x: pdfX, y: pdfY_top,
              borderColor: strokeRgb, borderWidth: strokeRgb ? sw : 0,
              color: fillRgb,
              borderDashArray: isDashed && strokeRgb ? [sw * 3, sw * 2] : undefined
            });

          } else if (obj.shapeType === 'line') {
            if (strokeRgb) {
              let lx1, ly1, lx2, ly2;
              if (obj.lineStartRel && obj.lineEndRel) {
                lx1 = pdfX + obj.lineStartRel[0] * pdfW;
                ly1 = pdfY + (1 - obj.lineStartRel[1]) * pdfH;
                lx2 = pdfX + obj.lineEndRel[0] * pdfW;
                ly2 = pdfY + (1 - obj.lineEndRel[1]) * pdfH;
              } else {
                lx1 = pdfX;        ly1 = obj.lineFlipY ? (pdfY + pdfH) : pdfY;
                lx2 = pdfX + pdfW; ly2 = obj.lineFlipY ? pdfY : (pdfY + pdfH);
              }
              
              page.drawLine({ 
                start: {x: lx1, y: ly1}, end: {x: lx2, y: ly2}, 
                color: strokeRgb, thickness: sw, 
                dashArray: isDashed ? [sw * 3, sw * 2] : undefined 
              });

              if (obj.lineArrow) {
                const angle = Math.atan2(ly2 - ly1, lx2 - lx1);
                const arrowLen = Math.max(10, sw * 4);
                const arrowWidth = Math.max(8, sw * 3);

                const p1x = lx2, p1y = ly2; 
                const p2x = lx2 - arrowLen * Math.cos(angle) + (arrowWidth/2) * Math.sin(angle);
                const p2y = ly2 - arrowLen * Math.sin(angle) - (arrowWidth/2) * Math.cos(angle);
                const p3x = lx2 - arrowLen * Math.cos(angle) - (arrowWidth/2) * Math.sin(angle);
                const p3y = ly2 - arrowLen * Math.sin(angle) + (arrowWidth/2) * Math.cos(angle);

                page.drawSvgPath(`M ${p1x},${-p1y} L ${p2x},${-p2y} L ${p3x},${-p3y} Z`, {
                  color: strokeRgb, borderColor: strokeRgb, borderWidth: 1
                });
              }
            }
          }
        } catch(e4) { console.error("Lỗi khi vẽ Shape", e4); }
      } else if (obj.type === 'cropbox') {
        // Áp dụng crop cho trang PDF. Chú ý: pdfX, pdfY đã là tọa độ góc dưới cùng bên trái của Object.
        page.setCropBox(pdfX, pdfY, pdfW, pdfH);
      }
    }
  }

  return await outDoc.save();
}

// Hàm 2: Download bản PDF
async function _buildAndDownloadEditPDF() {
  const outBytes = await _generateEditedPdfBytes();
  triggerDownload(new Blob([outBytes], { type: 'application/pdf' }), 'edited.pdf');
}

// Hàm 3: Export thành Image PNG (Chính xác 100% với bản PDF)
async function _exportEditImages(exportAll) {
  if (!editPages.length) { alert('Chưa có trang nào.'); return; }
  const pg = _getCurrentPg();
  if (!exportAll && !pg) { alert('Vui lòng chọn một trang để export.'); return; }

  const btnPage = document.getElementById('edit-export-img-page');
  const btnAll = document.getElementById('edit-export-img-all');
  
  btnPage.disabled = true; btnAll.disabled = true;
  if (exportAll) btnAll.textContent = '...'; else btnPage.textContent = '...';

  try {
    // 1. Lấy byte PDF đã được chỉnh sửa (chứa MỌI THỨ: vẽ, xoay, text, khổ giấy...)
    const pdfBytes = await _generateEditedPdfBytes();

    // 2. Dùng pdf.js để render byte PDF đó thành ảnh
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

    let pagesToExport = [];
    if (exportAll) {
      for (let i = 1; i <= pdf.numPages; i++) pagesToExport.push(i);
    } else {
      const idx = editPages.findIndex(p => p.id === pg.id);
      pagesToExport.push(idx + 1);
    }

    for (let i = 0; i < pagesToExport.length; i++) {
      const pageNum = pagesToExport[i];
      const page = await pdf.getPage(pageNum);
      
      // Scale 2.5 cho ảnh sắc nét (High Quality)
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Chuyển sang ảnh PNG và tải xuống
      const dataURL = canvas.toDataURL('image/png');
      const blob = await (await fetch(dataURL)).blob();

      const filename = exportAll ? `exported-page-${pageNum}.png` : `exported-page.png`;
      triggerDownload(blob, filename);

      // Delay nhẹ khi tải nhiều ảnh để trình duyệt không chặn popup download
      if (exportAll && i < pagesToExport.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
  } catch(e) {
    console.error(e);
    alert('Lỗi xuất ảnh: ' + e.message);
  } finally {
    btnPage.textContent = 'Page'; btnAll.textContent = 'All';
    btnPage.disabled = false; btnAll.disabled = false;
  }
}
