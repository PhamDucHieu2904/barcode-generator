/* ══════════════════════════════════════════════
   edit-pdf-scan-effects.js — Scan appearance matching
   Ước lượng degradation profile từ vùng scan và áp lại lên text mới.
   Hoàn toàn chạy trong browser bằng Canvas/ImageData.
   ══════════════════════════════════════════════ */

function _scanClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _scanMedian(values) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function _scanPercentile(values, percentile) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * percentile)))];
}

function _scanHexToRgb(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) || 0,
    parseInt(value.slice(2, 4), 16) || 0,
    parseInt(value.slice(4, 6), 16) || 0
  ];
}

function _scanLoadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function _scanOtsu(histogram, count) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * histogram[i];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = 0, best = 24;
  for (let i = 0; i < 256; i++) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = count - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (total - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * Math.pow(backgroundMean - foregroundMean, 2);
    if (variance > bestVariance) { bestVariance = variance; best = i; }
  }
  return best;
}

/**
 * Phân tích một crop text và trả về profile có đơn vị trực tiếp dùng cho UI.
 * Profile này không phụ thuộc nội dung text mới.
 */
async function analyzeScanEffectProfile(base64) {
  const image = await _scanLoadImage('data:image/png;base64,' + base64);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const W = canvas.width, H = canvas.height;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  return analyzeScanEffectPixels(data, W, H);
}

function analyzeScanEffectPixels(data, W, H) {
  const borderSize = Math.max(1, Math.round(Math.min(W, H) * 0.09));
  const red = [], green = [], blue = [], borderLuminance = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= borderSize && x < W-borderSize && y >= borderSize && y < H-borderSize) continue;
      const i = (y * W + x) * 4;
      red.push(data[i]); green.push(data[i+1]); blue.push(data[i+2]);
      borderLuminance.push(data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114);
    }
  }

  const background = [_scanMedian(red), _scanMedian(green), _scanMedian(blue)];
  const backgroundLum = background[0]*0.299 + background[1]*0.587 + background[2]*0.114;
  const borderMedianLum = _scanMedian(borderLuminance.slice());
  const backgroundMad = _scanMedian(borderLuminance.map(value => Math.abs(value - borderMedianLum)));
  const backgroundStdDev = _scanClamp(backgroundMad * 1.4826, 0, 12);
  const distances = new Uint8Array(W * H);
  const histogram = new Uint32Array(256);

  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const dr=data[i]-background[0], dg=data[i+1]-background[1], db=data[i+2]-background[2];
    const distance = Math.min(255, Math.round(Math.sqrt(dr*dr*0.3 + dg*dg*0.59 + db*db*0.11)));
    distances[p] = distance;
    histogram[distance]++;
  }

  const threshold = _scanClamp(_scanOtsu(histogram, W * H), 14, 100);
  const nonBackgroundDistances = Array.from(distances).filter(value => value > Math.max(10, threshold * 0.55));
  const strongDistance = Math.max(threshold, _scanPercentile(nonBackgroundDistances, 0.68));
  const softDistance = Math.max(6, Math.min(threshold * 0.35, strongDistance * 0.22));
  const strongMask = new Uint8Array(W * H);
  const softMask = new Uint8Array(W * H);
  const inkLuminance = [];
  let strongCount = 0, softCount = 0, perimeter = 0;
  let strongMinY = H, strongMaxY = -1;

  for (let p = 0; p < W * H; p++) {
    if (distances[p] >= softDistance) { softMask[p] = 1; softCount++; }
    if (distances[p] >= strongDistance) {
      strongMask[p] = 1; strongCount++;
      const y = Math.floor(p / W);
      if (y < strongMinY) strongMinY = y;
      if (y > strongMaxY) strongMaxY = y;
      const i = p * 4;
      inkLuminance.push(data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114);
    }
  }

  if (strongCount < Math.max(4, W * H * 0.002)) {
    throw new Error('Không đủ nét chữ để phân tích hiệu ứng scan.');
  }

  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const p = y * W + x;
      if (!strongMask[p]) continue;
      if (!strongMask[p-1] || !strongMask[p+1] || !strongMask[p-W] || !strongMask[p+W]) perimeter++;
    }
  }

  const inkMedianLum = _scanMedian(inkLuminance);
  const darkInk = inkMedianLum < backgroundLum;

  // Chỉ đếm pixel chuyển tiếp nằm sát nét chữ. Nhiễu giấy ở xa chữ
  // không được phép làm tăng blur như công thức toàn-crop trước đây.
  let transitionCount = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (!softMask[p] || strongMask[p]) continue;
      const i = p * 4;
      const luminance = data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
      const movesTowardInk = darkInk
        ? luminance < backgroundLum - Math.max(1.5, backgroundStdDev)
        : luminance > backgroundLum + Math.max(1.5, backgroundStdDev);
      if (!movesTowardInk) continue; // halo sharpen đi ra xa màu mực, không phải blur.
      let nearStrong = false;
      for (let oy = -3; oy <= 3 && !nearStrong; oy++) {
        for (let ox = -3; ox <= 3; ox++) {
          if (strongMask[(y + oy) * W + x + ox]) { nearStrong = true; break; }
        }
      }
      if (nearStrong) transitionCount++;
    }
  }
  const transitionWidth = transitionCount / Math.max(1, perimeter);
  const inkMad = _scanMedian(inkLuminance.map(value => Math.abs(value - inkMedianLum)));
  const inkStdDev = _scanClamp(inkMad * 1.4826, 0, 24);
  const contrastRange = Math.abs(backgroundLum - inkMedianLum);

  // Độ gồ ghề của biên: perimeter lớn so với căn bậc hai diện tích.
  const edgeComplexity = perimeter / Math.max(1, Math.sqrt(strongCount) * 4);
  const strongTextHeight = Math.max(1, strongMaxY - strongMinY + 1);
  const safeBlurLimit = _scanClamp(strongTextHeight * 0.06, 0.3, 1.25);
  // Canvas text sạch vốn đã có một dải anti-alias quanh hai phía cạnh;
  // chỉ phần mềm hơn
  // mức này mới là degradation cần bổ sung.
  const blurPx = _scanClamp((transitionWidth - 1.75) * 0.28, 0, safeBlurLimit);

  // Unsharp mask thường để lại một viền "vượt nền" ngay phía ngoài nét mực.
  // Đo trực tiếp halo này thay vì suy sharpen từ độ phức tạp hình dạng glyph.
  const haloFloor = Math.max(2, backgroundStdDev * 1.8);
  let haloMagnitude = 0, haloCount = 0, edgeBackgroundCount = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (strongMask[p]) continue;
      if (!strongMask[p-1] && !strongMask[p+1] && !strongMask[p-W] && !strongMask[p+W]) continue;
      edgeBackgroundCount++;
      const i = p * 4;
      const luminance = data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
      const overshoot = darkInk ? luminance - backgroundLum : backgroundLum - luminance;
      if (overshoot > haloFloor) {
        haloMagnitude += overshoot - haloFloor;
        haloCount++;
      }
    }
  }
  const haloCoverage = haloCount / Math.max(1, edgeBackgroundCount);
  const haloMean = haloMagnitude / Math.max(1, haloCount);
  const sharpenAmount = _scanClamp(haloCoverage * haloMean / 5, 0, 0.9);
  const noiseAlpha = _scanClamp(Math.max(backgroundStdDev / 24, inkStdDev / 45), 0, 0.42);
  const contrast = _scanClamp(0.9 + contrastRange / 1500, 0.9, 1.08);

  // Đo blockiness trên các cặp pixel nền. Không dùng cạnh glyph vì vị trí
  // chữ tình cờ trùng lưới 8px sẽ gây nhận nhầm JPEG rất mạnh.
  let boundaryDiff=0, boundarySamples=0, interiorDiff=0, interiorSamples=0;
  const luminanceAt = (x,y) => {
    const i=(y*W+x)*4; return data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114;
  };
  for (let y=0; y<H; y++) for (let x=1; x<W; x++) {
    const p=y*W+x;
    if (distances[p] >= softDistance || distances[p-1] >= softDistance) continue;
    const diff=Math.abs(luminanceAt(x,y)-luminanceAt(x-1,y));
    if (x%8===0) { boundaryDiff+=diff; boundarySamples++; }
    else { interiorDiff+=diff; interiorSamples++; }
  }
  for (let y=1; y<H; y++) for (let x=0; x<W; x++) {
    const p=y*W+x;
    if (distances[p] >= softDistance || distances[p-W] >= softDistance) continue;
    const diff=Math.abs(luminanceAt(x,y)-luminanceAt(x,y-1));
    if (y%8===0) { boundaryDiff+=diff; boundarySamples++; }
    else { interiorDiff+=diff; interiorSamples++; }
  }
  const boundaryMean=boundaryDiff/Math.max(1,boundarySamples);
  const interiorMean=interiorDiff/Math.max(1,interiorSamples);
  const blockiness=boundaryMean/Math.max(0.05,interiorMean);
  const reliableJpegSignal=boundarySamples>=24 && interiorSamples>=80 &&
    boundaryMean-interiorMean>Math.max(1.2,backgroundStdDev*0.35);
  const jpegQuality = reliableJpegSignal && blockiness > 2.2 ? 0.88 :
    (reliableJpegSignal && blockiness > 1.65 ? 0.93 : 1);

  return {
    mode: 'match',
    blurPx: Math.round(blurPx * 10) / 10,
    sharpenAmount: Math.round(sharpenAmount * 100) / 100,
    inkSpread: 0,
    noiseAlpha: Math.round(noiseAlpha * 100) / 100,
    backgroundNoise: Math.round(backgroundStdDev * 10) / 10,
    inkNoise: Math.round(Math.max(backgroundStdDev, inkStdDev * 0.45) * 10) / 10,
    contrast: Math.round(contrast * 100) / 100,
    gamma: 1,
    jpegQuality,
    // Inner-edge sharpening is intentionally manual for now. Detecting it
    // reliably requires comparing luminance across the interior of each glyph.
    smartSharpen: 0,
    edgeIrregularity: Math.round(_scanClamp(edgeComplexity - 1, 0, 2) * 100) / 100,
    backgroundColor: '#' + background.map(value => Math.round(value).toString(16).padStart(2,'0')).join(''),
    confidence: Math.round(_scanClamp((strongCount / Math.max(1, W*H) * 4 + Math.min(1, contrastRange/120)) * 50, 10, 96))
  };
}

/**
 * So sánh độ dày nét của font sạch với mask scan để ước lượng mực loang/mòn.
 * Tận dụng mask chuẩn hóa của bộ nhận diện font; nếu module đó không có thì giữ profile ban đầu.
 */
function _calibrateAutoInkSpread(rawSpread) {
  if (!Number.isFinite(rawSpread)) return 0;
  const calibrated = _scanClamp(rawSpread * 0.25, -0.08, 0.08);
  return Math.abs(calibrated) < 0.015 ? 0 : calibrated;
}

async function refineScanProfileStroke(base64, sourceText, fontCandidate, profile) {
  if (!profile || !sourceText || !fontCandidate ||
      typeof _smartExtractInkMask !== 'function' ||
      typeof _smartNormalizeSourceMask !== 'function' ||
      typeof _smartRenderCandidateMask !== 'function') return profile;

  const source = _smartNormalizeSourceMask(await _smartExtractInkMask(base64));
  const candidate = _smartRenderCandidateMask(
    sourceText.trim().slice(0, 80),
    fontCandidate.family,
    fontCandidate.fontWeight || 'normal',
    fontCandidate.fontStyle || 'normal',
    source
  );
  if (!candidate.count || !candidate.inkW) return profile;

  let sourceCount = 0, candidatePerimeter = 0;
  for (let p = 0; p < source.mask.length; p++) sourceCount += source.mask[p];
  for (let y = 1; y < source.height - 1; y++) {
    for (let x = 1; x < source.width - 1; x++) {
      const p = y * source.width + x;
      if (!candidate.mask[p]) continue;
      if (!candidate.mask[p-1] || !candidate.mask[p+1] ||
          !candidate.mask[p-source.width] || !candidate.mask[p+source.width]) candidatePerimeter++;
    }
  }
  if (!candidatePerimeter) return profile;

  // Loại ảnh hưởng do sai khác chiều rộng glyph trước khi đo diện tích nét.
  const horizontalScale = source.inkW / Math.max(1, candidate.inkW);
  const expectedCleanInk = candidate.count * horizontalScale;
  const expectedPerimeter = candidatePerimeter * Math.sqrt(horizontalScale);
  const normalizedSpread = (sourceCount - expectedCleanInk) / Math.max(1, expectedPerimeter);
  const outputPixelScale = source.inkH > 0 ? source.inkH / 56 : 1;
  // Chênh lệch diện tích mask còn chứa sai số font/weight/anti-alias, nên nếu ánh xạ
  // trực tiếp sang morphology sẽ thường loang gấp 3-4 lần thực tế. Hiệu chuẩn 0.25
  // và chặn auto trong +/-8%; Manual vẫn cho phép người dùng chọn toàn dải.
  const inkSpread = _calibrateAutoInkSpread(normalizedSpread / Math.max(0.5, outputPixelScale));

  return { ...profile, inkSpread: Math.round(inkSpread * 100) / 100 };
}

const _scanProfileCache = new WeakMap();

/** Gộp tối đa 10 vùng cùng trang bằng trung vị để profile ổn định dần. */
function rememberScanEffectProfile(page, profile) {
  if (!page || !profile || (typeof page !== 'object' && typeof page !== 'function')) return profile;
  const samples = _scanProfileCache.get(page) || [];
  samples.push(profile);
  if (samples.length > 10) samples.shift();
  _scanProfileCache.set(page, samples);
  const numericKeys = [
    'blurPx', 'sharpenAmount', 'inkSpread', 'noiseAlpha', 'backgroundNoise',
    'inkNoise', 'contrast', 'gamma', 'jpegQuality', 'smartSharpen', 'edgeIrregularity', 'confidence'
  ];
  const merged = { ...profile };
  numericKeys.forEach(key => {
    const values = samples.map(item => item[key]).filter(Number.isFinite);
    if (values.length) merged[key] = Math.round(_scanMedian(values) * 100) / 100;
  });
  const colors = samples.map(item => _scanHexToRgb(item.backgroundColor));
  if (colors.length) {
    merged.backgroundColor = '#' + [0,1,2].map(channel =>
      Math.round(_scanMedian(colors.map(color => color[channel]))).toString(16).padStart(2, '0')
    ).join('');
  }
  merged.sampleCount = samples.length;
  return merged;
}

/** Áp dilation/erosion mức dưới 1px lên alpha của text canvas. */
function applyTextInkSpread(textCanvas, amount) {
  const strength = _scanClamp(Math.abs(amount || 0), 0, 1);
  if (strength < 0.01) return;
  const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, textCanvas.width, textCanvas.height);
  const data = imageData.data;
  const originalAlpha = new Uint8ClampedArray(textCanvas.width * textCanvas.height);
  for (let p=0; p<originalAlpha.length; p++) originalAlpha[p]=data[p*4+3];
  const useDilation = amount > 0;

  for (let y=0; y<textCanvas.height; y++) {
    for (let x=0; x<textCanvas.width; x++) {
      let target = useDilation ? 0 : 255;
      for (let oy=-1; oy<=1; oy++) for (let ox=-1; ox<=1; ox++) {
        const sx=_scanClamp(x+ox,0,textCanvas.width-1), sy=_scanClamp(y+oy,0,textCanvas.height-1);
        const alpha=originalAlpha[sy*textCanvas.width+sx];
        target=useDilation ? Math.max(target,alpha) : Math.min(target,alpha);
      }
      const p=y*textCanvas.width+x, original=originalAlpha[p];
      data[p*4+3]=Math.round(original+(target-original)*strength);
    }
  }
  ctx.putImageData(imageData,0,0);
}

function _scanGaussianAlpha(source, width, height, sigma) {
  if (!(sigma > 0)) return new Float32Array(source);
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let kernelSum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = weight;
    kernelSum += weight;
  }
  for (let index = 0; index < kernel.length; index++) kernel[index] /= kernelSum;

  const horizontal = new Float32Array(width * height);
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = _scanClamp(x + offset, 0, width - 1);
        value += source[y * width + sampleX] * kernel[offset + radius];
      }
      horizontal[y * width + x] = value;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleY = _scanClamp(y + offset, 0, height - 1);
        value += horizontal[sampleY * width + x] * kernel[offset + radius];
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

/**
 * Mô phỏng Smart Sharpen mạnh trên chữ đã in: chỉ dùng đáp ứng high-pass ở
 * phía trong glyph, giữ hai mép nét đậm trong khi hạ mật độ mực ở lõi nét.
 * Không tạo halo/bóng ra ngoài hình chữ.
 */
function applyTextInnerSharpen(textCanvas, amount, radiusPx) {
  const strength = _scanClamp(Number(amount) || 0, 0, 1);
  if (strength < 0.005) return;

  const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, textCanvas.width, textCanvas.height);
  const data = imageData.data;
  const alpha = new Float32Array(textCanvas.width * textCanvas.height);
  for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = data[pixel * 4 + 3];

  // radiusPx corresponds to the visual edge band. Gaussian sigma is smaller
  // because its kernel already extends to three sigma on each side.
  const radius = _scanClamp(Number(radiusPx) || 1, 0.35, 5);
  const blurred = _scanGaussianAlpha(alpha, textCanvas.width, textCanvas.height, Math.max(0.2, radius / 1.9));
  // Giữ lại nhiều mật độ mực hơn ở lõi. Ở mức tối đa lõi vẫn còn 58%
  // opacity thay vì 38%, tránh cảm giác toàn bộ chữ bị bạc màu.
  const interiorFactor = 1 - strength * 0.42;
  // Ngưỡng thấp hơn giúp dải mép đậm ăn sâu thêm vào trong khoảng 1–2 px,
  // nhất là với chữ nhỏ trên tài liệu 300 PPI.
  const edgeThreshold = Math.max(7, 30 - radius * 3);

  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const originalAlpha = alpha[pixel];
    if (originalAlpha <= 0) continue;
    const innerHighPass = Math.max(0, originalAlpha - blurred[pixel]);
    const edgeWeight = _scanClamp(innerHighPass / edgeThreshold, 0, 1);
    const density = interiorFactor + (1 - interiorFactor) * edgeWeight;
    data[pixel * 4 + 3] = Math.round(_scanClamp(originalAlpha * density, 0, 255));
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Blur alpha với nội suy giữa hai mức pixel nguyên. Canvas filter trên Chromium
 * có thể lượng tử hóa blur dưới 1px; nội suy này giúp 0.1…0.9 tạo ra chín mức
 * khác nhau và vẫn liên tục khi đi qua 1px, 2px, 3px.
 */
function applyTextSubpixelBlur(textCanvas, amount) {
  const blur = Math.max(0, Number(amount) || 0);
  if (blur < 0.01) return;
  const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, textCanvas.width, textCanvas.height);
  const data = imageData.data;
  const alpha = new Float32Array(textCanvas.width * textCanvas.height);
  let solidOffset = 0;
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    alpha[pixel] = data[pixel * 4 + 3];
    if (data[pixel * 4 + 3] > data[solidOffset + 3]) solidOffset = pixel * 4;
  }

  const lower = Math.floor(blur);
  const upper = Math.ceil(blur);
  const fraction = blur - lower;
  const lowerAlpha = lower > 0
    ? _scanGaussianAlpha(alpha, textCanvas.width, textCanvas.height, lower)
    : alpha;
  const upperAlpha = upper === lower
    ? lowerAlpha
    : _scanGaussianAlpha(alpha, textCanvas.width, textCanvas.height, upper);
  const inkColor = [data[solidOffset], data[solidOffset + 1], data[solidOffset + 2]];

  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const offset = pixel * 4;
    const value = lowerAlpha[pixel] * (1 - fraction) + upperAlpha[pixel] * fraction;
    data[offset + 3] = Math.round(_scanClamp(value, 0, 255));
    if (data[offset + 3] > 0) {
      data[offset] = inkColor[0];
      data[offset + 1] = inkColor[1];
      data[offset + 2] = inkColor[2];
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function _scanSeededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Áp contrast, unsharp mask và noise tách nền/mực lên canvas đã composite. */
function applyCompositeScanEffects(canvas, options, backgroundHex) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
  const data = imageData.data;
  const original = new Uint8ClampedArray(data);
  const background = _scanHexToRgb(backgroundHex);
  const contrast = Number.isFinite(options.contrast) ? options.contrast : 1;
  const sharpen = _scanClamp(options.sharpenAmount || 0,0,1.5);
  const backgroundNoise = Math.max(0, options.backgroundNoise || 0);
  const inkNoise = Math.max(backgroundNoise, options.inkNoise || 0);
  const random = _scanSeededRandom((options.noiseSeed || 1) + canvas.width*73856093 + canvas.height*19349663);
  let blurred = null;

  if (sharpen > 0.01) {
    blurred = new Float32Array(data.length);
    const kernel=[1,2,1,2,4,2,1,2,1];
    for (let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      for(let channel=0;channel<3;channel++) {
        let sum=0,weight=0,k=0;
        for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++,k++) {
          const sx=_scanClamp(x+ox,0,canvas.width-1),sy=_scanClamp(y+oy,0,canvas.height-1);
          sum+=original[(sy*canvas.width+sx)*4+channel]*kernel[k]; weight+=kernel[k];
        }
        blurred[(y*canvas.width+x)*4+channel]=sum/weight;
      }
    }
  }

  for(let p=0;p<canvas.width*canvas.height;p++) {
    const i=p*4;
    const dr=original[i]-background[0],dg=original[i+1]-background[1],db=original[i+2]-background[2];
    const inkness=_scanClamp(Math.sqrt(dr*dr*.3+dg*dg*.59+db*db*.11)/180,0,1);
    const stdDev=(backgroundNoise*(1-inkness)+inkNoise*inkness);
    // Tổng sáu uniform gần Gaussian, deterministic để preview không nhấp nháy.
    const gaussian=(random()+random()+random()+random()+random()+random()-3)*stdDev;
    for(let channel=0;channel<3;channel++) {
      let value=background[channel]+(original[i+channel]-background[channel])*contrast;
      if(blurred) value+=sharpen*(original[i+channel]-blurred[i+channel]);
      data[i+channel]=_scanClamp(Math.round(value+gaussian),0,255);
    }
  }
  ctx.putImageData(imageData,0,0);
}

async function finalizeScanCompression(canvas, quality) {
  const jpegQuality = _scanClamp(Number.isFinite(quality) ? quality : 1, 0.55, 1);
  if (jpegQuality >= 0.985) return canvas;
  const sourceAlpha = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0,0,canvas.width,canvas.height).data;
  const image = await _scanLoadImage(canvas.toDataURL('image/jpeg', jpegQuality));
  const output = document.createElement('canvas');
  output.width=canvas.width; output.height=canvas.height;
  const outputCtx = output.getContext('2d', { willReadFrequently: true });
  outputCtx.drawImage(image,0,0);
  const outputData = outputCtx.getImageData(0,0,output.width,output.height);
  for (let offset=3; offset<outputData.data.length; offset+=4) {
    outputData.data[offset] = sourceAlpha[offset];
  }
  outputCtx.putImageData(outputData,0,0);
  return output;
}
