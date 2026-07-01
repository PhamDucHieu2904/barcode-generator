/* ══════════════════════════════════════════════
   edit-pdf-state.js — Constants & mutable state
   Được load ĐẦU TIÊN để tất cả module khác dùng chung.
   Chứa: EDIT_FONTS, PAPER_SIZES, state vars, uid(), hexToRgb(), _getCurrentPg()
   ══════════════════════════════════════════════ */

const EDIT_FONTS = [
  'Arial','Helvetica','Georgia','Times New Roman','Courier New',
  'Roboto','Open Sans','Lato','Montserrat','Raleway',
  'Oswald','Playfair Display','Merriweather','Nunito','Poppins',
  'Source Sans Pro','Ubuntu','PT Serif','Quicksand','Josefin Sans'
];

const PAPER_SIZES = { none: null, a4v: { w: 595, h: 842 }, a4h: { w: 842, h: 595 }, a3v: { w: 842, h: 1191 }, a3h: { w: 1191, h: 842 } };

// ── Dữ liệu trang PDF đang mở ──
let editPages = [], editSelectedPage = null, editPdfOrigBytes = null, editDragSrcId = null, editSelectedObj = null, editorScale = 1;
let editZoom = 1;
let _clipboard = null; // Lưu object đã copy (Ctrl+C)

// ── Shape tool state ──
let activeShapeTool = null; // 'rect' | 'triangle' | 'ellipse' | 'line' | null

// ── Line 2-click state (legacy, hiện dùng _lineState trong edit-pdf-shapes.js) ──
let _linePendingStart = null;
let _lineGhostEl = null;
let _lineGhostObj = null;

/**
 * Tạo ID duy nhất cho overlay object.
 * @returns {string}
 */
function uid() { return `ep-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }

/**
 * Chuyển hex color (#rrggbb) thành object {r,g,b} normalized 0-1.
 * Đặt ở module scope để không phải tạo lại trong mỗi vòng lặp export.
 * @param {string} hex
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/**
 * Trả về page object của trang đang được chọn, hoặc null.
 * Dùng chung bởi mọi module.
 */
function _getCurrentPg() { if (!editSelectedPage) return null; return editPages.find(p => p.id === editSelectedPage) || null; }
