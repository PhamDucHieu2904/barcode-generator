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
const EDIT_ZOOM_MIN = 1;
const EDIT_ZOOM_MAX = 10;
const EDIT_ZOOM_STEP = 0.2;
let _clipboard = null; // Lưu object đã copy (Ctrl+C)

// ── Lịch sử Undo/Redo ──
const MAX_HISTORY = 15;
let editHistory = [];
let editHistoryIndex = -1;


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

function _syncObjectRectPt(obj, scale = editorScale) {
  const safeScale = Number(scale) > 0 ? Number(scale) : 1;
  obj.rectPt = {
    x: obj.x / safeScale,
    y: obj.y / safeScale,
    w: obj.w / safeScale,
    h: obj.h / safeScale
  };
  obj.coordinateScale = safeScale;
  return obj.rectPt;
}

/* ════════════════════════════════════════════
   UNDO / REDO HISTORY MANAGER
   ════════════════════════════════════════════ */

/**
 * Lưu trạng thái hiện tại vào history. 
 * Gọi hàm này SAU MỖI THAO TÁC thay đổi.
 */
function _saveHistory() {
  if (editPages.length === 0) return;

  // Clone sâu overlayObjects để không bị dính tham chiếu (reference),
  // nhưng giữ nguyên tham chiếu tới pdfBytes / imageDataURL để không ngốn RAM.
  const stateCopy = editPages.map(pg => ({
    ...pg,
    overlayObjects: pg.overlayObjects.map(obj => ({ ...obj }))
  }));

  // Nếu đang ở giữa History (đã Undo) mà làm thao tác mới, thì cắt bỏ đoạn History tương lai
  if (editHistoryIndex < editHistory.length - 1) {
    editHistory = editHistory.slice(0, editHistoryIndex + 1);
  }

  editHistory.push(stateCopy);

  // Giới hạn max history (tránh tràn RAM)
  if (editHistory.length > MAX_HISTORY) {
    editHistory.shift();
  } else {
    editHistoryIndex++;
  }
}

/**
 * Undo thao tác
 */
function _undo() {
  if (editHistoryIndex > 0) {
    editHistoryIndex--;
    _restoreHistory(editHistory[editHistoryIndex]);
  }
}

/**
 * Redo thao tác
 */
function _redo() {
  if (editHistoryIndex < editHistory.length - 1) {
    editHistoryIndex++;
    _restoreHistory(editHistory[editHistoryIndex]);
  }
}

/**
 * Phục hồi trạng thái từ History state
 */
function _restoreHistory(state) {
  const area = document.getElementById('edit-canvas-area');
  const viewport = area ? {
    pageId: editSelectedPage,
    left: area.scrollLeft,
    top: area.scrollTop
  } : null;
  const selectedObjectId = editSelectedObj;

  // Clone lại state từ history ra hiện tại
  editPages = state.map(pg => ({
    ...pg,
    overlayObjects: pg.overlayObjects.map(obj => ({ ...obj }))
  }));

  // Cập nhật lại UI
  _renderEditThumbs();

  const current = _getCurrentPg();
  if (current) {
    _openPageEditor(current);
  } else if (editPages.length > 0) {
    editSelectedPage = editPages[0].id;
    _openPageEditor(editPages[0]);
  }

  // Khôi phục Selected Object nếu nó vẫn tồn tại.
  // _openPageEditor() xóa selection DOM nên phải dùng ID đã chụp trước khi restore.
  if (selectedObjectId) {
    const curPg = _getCurrentPg();
    const stillExists = curPg && curPg.overlayObjects.find(o => o.id === selectedObjectId);
    if (!stillExists) {
      editSelectedObj = null;
      _updateTextControls(null);
    } else {
      _selectObject(stillExists, curPg);
    }
  }

  // Undo/Redo chỉ thay dữ liệu, không được đẩy người dùng về góc trên-trái.
  if (viewport && viewport.pageId === editSelectedPage) {
    const restoreViewport = () => {
      const currentArea = document.getElementById('edit-canvas-area');
      if (!currentArea || currentArea._currentPg?.id !== viewport.pageId) return;
      currentArea.scrollLeft = viewport.left;
      currentArea.scrollTop = viewport.top;
    };
    restoreViewport();
    requestAnimationFrame(restoreViewport);
  }
}
