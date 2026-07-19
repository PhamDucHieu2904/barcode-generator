/* ══════════════════════════════════════════════
   edit-pdf-shapes.js — Shape & line drawing tools
   Chứa: SHAPE_CYCLE, SHAPE_CURSORS, _lineState, color getters,
         cursor helpers, _onCanvasMousedownForShape, line & shape drag logic
   Phụ thuộc: edit-pdf-state.js, edit-pdf-canvas.js
   ══════════════════════════════════════════════ */

// ── Combo button state ──
// Shape combo: cycle rect → triangle → ellipse
const SHAPE_CYCLE = ['rect', 'triangle', 'ellipse'];
let activeShapeComboIdx = 0;   // index trong SHAPE_CYCLE, mặc định 'rect'

// Line combo: 'arrow' | 'plain', mặc định 'arrow'
let activeLineMode = 'arrow';   // 'arrow' | 'plain'

/** Cập nhật icon của shape combo button theo activeShapeComboIdx */
function _updateShapeComboIcon() {
  const types = ['rect', 'triangle', 'ellipse'];
  types.forEach(t => {
    const el = document.getElementById(`elb-shape-icon-${t}`);
    if (el) el.style.display = (t === SHAPE_CYCLE[activeShapeComboIdx]) ? '' : 'none';
  });
}

/** Cập nhật icon của line combo button theo activeLineMode */
function _updateLineComboIcon() {
  const arrowEl = document.getElementById('elb-line-icon-arrow');
  const plainEl = document.getElementById('elb-line-icon-plain');
  if (arrowEl) arrowEl.style.display = (activeLineMode === 'arrow') ? '' : 'none';
  if (plainEl) plainEl.style.display = (activeLineMode === 'plain') ? '' : 'none';
}

/* ════════════════════════════════════════════
   SHAPE TOOL: CURSOR & DRAWING
   ════════════════════════════════════════════ */

const SHAPE_CURSORS = {
  rect:     'crosshair',
  triangle: 'crosshair',
  ellipse:  'crosshair',
  line:     'crosshair',
};

function _setCanvasCursor(shapeType) {
  const canvasArea = document.getElementById('edit-canvas-area');
  if (canvasArea) {
    canvasArea.style.cursor = SHAPE_CURSORS[shapeType] || 'crosshair';
    canvasArea.classList.remove('can-pan');
  }
}

function _resetCanvasCursor() {
  const canvasArea = document.getElementById('edit-canvas-area');
  if (canvasArea) canvasArea.style.cursor = '';
  if (typeof _updateCanvasPanAvailability === 'function') _updateCanvasPanAvailability();
}

function _getOverlayRelativePos(e) {
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._overlayEl) return null;
  const rect = area._overlayEl.getBoundingClientRect();
  // Khử sai số tỷ lệ Zoom khi lấy tọa độ chuột
  return { 
    x: (e.clientX - rect.left) / editZoom, 
    y: (e.clientY - rect.top) / editZoom 
  };
}

function _getShapeFillColor() {
  // Trả về 'none' nếu nút none đang active, ngược lại trả màu từ fill color picker
  const noneBtn = document.getElementById('edit-fillcolor-none');
  if (noneBtn && noneBtn.classList.contains('active')) return 'none';
  const colorEl = document.getElementById('edit-fillcolor');
  if (colorEl) return colorEl.value || '#000000';
  return '#000000';
}

function _getShapeStrokeColor() {
  // Trả về 'none' nếu nút none đang active, ngược lại trả màu từ stroke color picker
  const noneBtn = document.getElementById('edit-strokecolor-none');
  if (noneBtn && noneBtn.classList.contains('active')) return 'none';
  const colorEl = document.getElementById('edit-strokecolor');
  if (colorEl) return colorEl.value || '#000000';
  return '#000000';
}

// _getShapeColor: alias không cần thiết — dùng _getShapeFillColor() trực tiếp

function _getStrokeWidth() {
  const el = document.getElementById('edit-strokewidth');
  return el ? (parseInt(el.value) || 2) : 2;
}

function _getStrokeDash() {
  const el = document.getElementById('edit-strokestyle');
  return el ? el.value : 'solid'; // 'solid' | 'dashed'
}

// =========================================================
// 1. HÀM BẮT SỰ KIỆN CHÍNH CHO SHAPE/LINE
// =========================================================
function _onCanvasMousedownForShape(e) {
  if (!activeShapeTool) return;
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._overlayEl || !area._currentPg) return;

  const overlayEl = area._overlayEl;
  const pageEl = overlayEl.closest('.edit-page-canvas') || overlayEl.parentElement;

  const startPos = _getOverlayRelativePos(e);
  if (!startPos) return;

  if (!pageEl || !pageEl.contains(e.target)) {
    if (!area.contains(e.target)) {
      activeShapeTool = null;
      _cancelLinePending();
      document.querySelectorAll('.elb-btn').forEach(b => b.classList.remove('active'));
      _resetCanvasCursor();
    }
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const pg = area._currentPg;
  const isShift = e.shiftKey;

  if (activeShapeTool === 'line') {
    _handleLineStart(e, startPos, pg, overlayEl, isShift);
  } else {
    _startShapeDrag(e, startPos, pg, overlayEl, isShift);
  }
}

// =========================================================
// 2. LOGIC VẼ LINE (HỖ TRỢ DRAG HOẶC 2-CLICK)
// =========================================================
let _lineState = null;

function _cancelLinePending() {
  if (_lineState) {
    if (_lineState.ghostSvg) _lineState.ghostSvg.remove();
    if (_lineState.onMove) document.removeEventListener('mousemove', _lineState.onMove);
    _lineState = null;
  }
}

function _handleLineStart(e, pos, pg, overlayEl, isShift) {
  if (_lineState && _lineState.mode === 'waiting_second_click') {
    _finalizeLine(pos, pg, overlayEl, e);
    return;
  }

  const sx = pos.x, sy = pos.y;
  const strokeColor = _getShapeStrokeColor();
  const strokeWidth = _getStrokeWidth();
  const strokeDash = _getStrokeDash();

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:visible;';
  const lineNode = document.createElementNS(ns, 'line');
  lineNode.setAttribute('x1', sx); lineNode.setAttribute('y1', sy);
  lineNode.setAttribute('x2', sx); lineNode.setAttribute('y2', sy);
  lineNode.setAttribute('stroke', strokeColor !== 'none' ? strokeColor : '#111');
  lineNode.setAttribute('stroke-width', strokeWidth);
  lineNode.setAttribute('stroke-linecap', 'round');
  if (strokeDash === 'dashed') lineNode.setAttribute('stroke-dasharray', `${strokeWidth * 3},${strokeWidth * 2}`);

  svg.appendChild(lineNode);
  overlayEl.appendChild(svg);

  function onMove(ev) {
    if (!_lineState) return;
    const curPos = _getOverlayRelativePos(ev);
    if (!curPos) return;

    let cx = curPos.x, cy = curPos.y;
    let dx = cx - sx, dy = cy - sy;

    if (_lineState.isShift || ev.shiftKey) {
       const angle = Math.atan2(dy, dx);
       const snap  = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
       const dist  = Math.sqrt(dx * dx + dy * dy);
       dx = Math.cos(snap) * dist;
       dy = Math.sin(snap) * dist;
       // Loại bỏ sai số floating point nhỏ để line thực sự thẳng
       if (Math.abs(dx) < 0.5) dx = 0;
       if (Math.abs(dy) < 0.5) dy = 0;
       cx = sx + dx; cy = sy + dy;
    }

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _lineState.didDrag = true;

    _lineState.lineNode.setAttribute('x2', cx);
    _lineState.lineNode.setAttribute('y2', cy);
  }

  _lineState = { mode: 'dragging', sx, sy, ghostSvg: svg, lineNode, isShift, didDrag: false, onMove };

  function onUp(ev) {
    document.removeEventListener('mouseup', onUp);
    if (!_lineState) return;

    if (_lineState.didDrag) {
      document.removeEventListener('mousemove', onMove);
      const curPos = _getOverlayRelativePos(ev) || { x: parseFloat(_lineState.lineNode.getAttribute('x2')), y: parseFloat(_lineState.lineNode.getAttribute('y2')) };
      _finalizeLine(curPos, pg, overlayEl, ev);
    } else {
      _lineState.mode = 'waiting_second_click';
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function _finalizeLine(endPos, pg, overlayEl, ev) {
  if (!_lineState) return;
  
  if (_lineState.onMove) document.removeEventListener('mousemove', _lineState.onMove);
  _lineState.ghostSvg.remove();

  let cx = endPos.x, cy = endPos.y;
  let sx = _lineState.sx, sy = _lineState.sy;
  let dx = cx - sx, dy = cy - sy;

  const isShiftActive = _lineState.isShift || (ev && ev.shiftKey);

  if (isShiftActive) {
    const angle = Math.atan2(dy, dx);
    const snap  = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist  = Math.sqrt(dx * dx + dy * dy);
    dx = Math.cos(snap) * dist;
    dy = Math.sin(snap) * dist;
    // Làm tròn tuyệt đối để loại bỏ sai số, đảm bảo đường thẳng băng
    if (Math.abs(dx) < 0.5) dx = 0;
    if (Math.abs(dy) < 0.5) dy = 0;
    cx = sx + dx; cy = sy + dy;
  }

  _lineState = null;
  // Bỏ qua nếu click nhầm (chưa kéo được 2px)
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

  let x = Math.min(sx, cx);
  let y = Math.min(sy, cy);
  let w = Math.max(1, Math.abs(dx));
  let h = Math.max(1, Math.abs(dy));

  // Tọa độ tương đối để vẽ line bên trong bounding box
  let startRel = [0, 0];
  let endRel = [1, 1];

  let isHorizontal = isShiftActive && Math.abs(dy) === 0;
  let isVertical   = isShiftActive && Math.abs(dx) === 0;

  if (isHorizontal) {
    // ÉP CHIỀU CAO BOX = 20PX, ĐƯỜNG LINE NẰM GIỮA (0.5)
    h = 20;
    y = sy - 10;
    if (dx >= 0) { startRel = [0, 0.5]; endRel = [1, 0.5]; }
    else         { startRel = [1, 0.5]; endRel = [0, 0.5]; }
  } else if (isVertical) {
    // ÉP CHIỀU RỘNG BOX = 20PX, ĐƯỜNG LINE NẰM GIỮA (0.5)
    w = 20;
    x = sx - 10;
    if (dy >= 0) { startRel = [0.5, 0]; endRel = [0.5, 1]; }
    else         { startRel = [0.5, 1]; endRel = [0.5, 0]; }
  } else {
    // Vẽ chéo bình thường
    w = Math.max(4, w);
    h = Math.max(4, h);
    if (dx >= 0 && dy >= 0) { startRel = [0, 0]; endRel = [1, 1]; }
    else if (dx < 0 && dy >= 0) { startRel = [1, 0]; endRel = [0, 1]; }
    else if (dx >= 0 && dy < 0) { startRel = [0, 1]; endRel = [1, 0]; }
    else { startRel = [1, 1]; endRel = [0, 0]; }
  }

  const newObj = {
    id: uid(), type: 'shape', shapeType: 'line',
    x, y, w, h,
    shapeFill: _getShapeFillColor(),
    shapeStroke: _getShapeStrokeColor(),
    shapeStrokeWidth: _getStrokeWidth(),
    shapeStrokeDash: _getStrokeDash(),
    lineFlipY: (dx * dy >= 0), 
    lineArrow: (activeLineMode === 'arrow'),
    lineStartRel: startRel, // Lưu tỷ lệ điểm bắt đầu
    lineEndRel: endRel,     // Lưu tỷ lệ điểm kết thúc
    color: _getShapeStrokeColor(),
    selected: false,
  };

  pg.overlayObjects.push(newObj);
  _renderOverlayObject(newObj, overlayEl, pg);
  _selectObject(newObj, pg);
  _saveHistory();
}

// =========================================================
// 3. LOGIC KÉO THẢ CHO RECTANGLE, ELLIPSE, TRIANGLE
// =========================================================
function _startShapeDrag(e, startPos, pg, overlayEl, isShift) {
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:absolute;pointer-events:none;z-index:9999;border:none;box-sizing:border-box;`;
  overlayEl.appendChild(ghost);

  let startX = startPos.x, startY = startPos.y;
  let currentObj = null;

  function onMove(e2) {
    const pos = _getOverlayRelativePos(e2);
    if (!pos) return;

    let dx = pos.x - startX, dy = pos.y - startY;

    if (isShift || e2.shiftKey) {
      const side = Math.min(Math.abs(dx), Math.abs(dy));
      dx = dx < 0 ? -side : side;
      dy = dy < 0 ? -side : side;
    }

    let x = dx >= 0 ? startX : startX + dx;
    let y = dy >= 0 ? startY : startY + dy;
    let w = Math.abs(dx);
    let h = Math.abs(dy);

    if (w < 2 && h < 2) return;

    const shapeFill   = _getShapeFillColor();
    const shapeStroke = _getShapeStrokeColor();

    if (!currentObj) {
      currentObj = {
        id: uid(), type: 'shape',
        shapeType: activeShapeTool,
        x, y, w: Math.max(2, w), h: Math.max(2, h),
        shapeFill, shapeStroke,
        shapeStrokeWidth: _getStrokeWidth(),
        shapeStrokeDash: _getStrokeDash(),
        color: shapeStroke,
        selected: false,
      };
      ghost.remove();
      pg.overlayObjects.push(currentObj);
      _renderOverlayObject(currentObj, overlayEl, pg);
      _selectObject(currentObj, pg);
    } else {
      currentObj.x = x; currentObj.y = y;
      currentObj.w = Math.max(2, w); currentObj.h = Math.max(2, h);
      currentObj.shapeStroke = shapeStroke;
      currentObj.shapeFill   = shapeFill;
      currentObj.color       = shapeStroke;

      const objEl = overlayEl.querySelector(`[data-obj-id="${currentObj.id}"]`);
      if (objEl) {
        objEl.style.left   = currentObj.x + 'px';
        objEl.style.top    = currentObj.y + 'px';
        objEl.style.width  = currentObj.w + 'px';
        objEl.style.height = currentObj.h + 'px';
        _updateShapeSVG(currentObj);
      }
    }
  }

  function onUp(e2) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    ghost.remove();
    if (currentObj && currentObj.w < 3 && currentObj.h < 3) {
      pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== currentObj.id);
      const objEl = overlayEl.querySelector(`[data-obj-id="${currentObj.id}"]`);
      if (objEl) objEl.remove();
    } else if (currentObj) {
      _saveHistory();
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}
