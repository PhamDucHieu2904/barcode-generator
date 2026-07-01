/* ══════════════════════════════════════════════
   utils.js — shared helpers
   ══════════════════════════════════════════════ */

/**
 * Trigger a file download from a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Read a File as a data URL (returns Promise<string>).
 * @param {File} file
 * @returns {Promise<string>}
 */
async function readFileAsDataURL(file) {
  const name = file.name.toLowerCase();
  
  // NẾU LÀ FILE TIFF -> Giải mã và ép sang PNG
  if (name.endsWith('.tiff') || name.endsWith('.tif')) {
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const ifds = UTIF.decode(buffer);
      UTIF.decodeImage(buffer, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]);
      
      const canvas = document.createElement('canvas');
      canvas.width = ifds[0].width;
      canvas.height = ifds[0].height;
      const ctx = canvas.getContext('2d');
      const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer), canvas.width, canvas.height);
      ctx.putImageData(imgData, 0, 0);
      
      return canvas.toDataURL('image/png'); // Trả về PNG an toàn
    } catch (err) {
      console.error("Lỗi khi đọc file TIFF:", err);
      throw new Error("Không thể giải mã file TIFF này.");
    }
  }

  // NẾU LÀ CÁC ẢNH BÌNH THƯỜNG -> Đọc bình thường
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Read a File as an ArrayBuffer (returns Promise<ArrayBuffer>).
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Convert any image dataURL to PNG via canvas (handles WebP, BMP, etc.).
 * Used by both pdf.js and edit-pdf.js as single source of truth.
 * @param {string} dataURL
 * @returns {Promise<string>} PNG dataURL
 */
function convertToPNG(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('convertToPNG: failed to load image'));
    img.src = dataURL;
  });
}