/* ══════════════════════════════════════════════
   edit-pdf-canvas.js — Canvas rendering & interaction
   Chứa: _openPageEditor, shape SVG builders, _renderOverlayObject,
         _bindObjectMove, _bindResizeHandle, _selectObject, _deselectAll
   Phụ thuộc: edit-pdf-state.js
   ══════════════════════════════════════════════ */

function _openPageEditor(pg) {
  const area = document.getElementById('edit-canvas-area');
  if (!area) return;
  area.innerHTML = ''; editSelectedObj = null;

  const areaW = area.clientWidth || 600, areaH = area.clientHeight || 700;
  
  editorScale = Math.min((areaW - 32) / pg.widthPt, (areaH - 32) / pg.heightPt, 1.5);

  const wrapper = document.createElement('div');
  wrapper.id = 'edit-page-wrapper';
  // Đặt margin auto để center khi nhỏ, nhưng vẫn align top-left khi zoom to tránh bị cắt
  wrapper.style.margin = '0 auto';
  wrapper.style.width = Math.round(pg.widthPt * editorScale * editZoom) + 'px';
  wrapper.style.height = Math.round(pg.heightPt * editorScale * editZoom) + 'px';

  const pageEl = document.createElement('div');
  pageEl.className = 'edit-page-canvas';
  pageEl.style.width = Math.round(pg.widthPt * editorScale) + 'px';
  pageEl.style.height = Math.round(pg.heightPt * editorScale) + 'px';
  pageEl.style.transform = `scale(${editZoom})`;
  // Zoom từ góc trên bên trái (upper left)
  pageEl.style.transformOrigin = 'top left';
  
  const bgLayer = document.createElement('div');
  bgLayer.className = 'edit-bg-layer'; bgLayer.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden;';

  if (pg.renderURL) {
    const bgImg = document.createElement('img');
    bgImg.src = pg.renderURL;
    const rot = pg.rotation || 0;
    if (rot === 90 || rot === 270) {
      // Container đã swap: widthPt↔heightPt. renderURL vẫn là ảnh gốc (portrait).
      // Cần đặt img với kích thước ngược (h x w), căn giữa, rồi rotate → fill đúng container
      const cW = Math.round(pg.widthPt * editorScale);   // chiều rộng container hiện tại
      const cH = Math.round(pg.heightPt * editorScale);  // chiều cao container hiện tại
      bgImg.style.cssText = `
        position:absolute;
        width:${cH}px; height:${cW}px;
        top:50%; left:50%;
        margin-left:${-cH / 2}px; margin-top:${-cW / 2}px;
        transform: rotate(${rot}deg);
        transform-origin: center center;
        object-fit:fill; display:block; pointer-events:none;
      `;
    } else if (rot === 180) {
      bgImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;transform:rotate(180deg);transform-origin:center center;';
    } else {
      bgImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    }
    bgLayer.appendChild(bgImg);
  }

  pageEl.appendChild(bgLayer);
  const overlayEl = document.createElement('div');
  overlayEl.className = 'edit-overlay';
  // overflow:visible để resize handles và buttons không bị xén mất
  overlayEl.style.cssText = 'position:absolute;inset:0;overflow:visible;';
  pageEl.appendChild(overlayEl);

  pg.overlayObjects.forEach(obj => _renderOverlayObject(obj, overlayEl, pg));

  pageEl.addEventListener('mousedown', e => { if (e.target === pageEl || e.target === bgLayer || e.target === overlayEl) _deselectAll(pg); });
  
  wrapper.appendChild(pageEl);
  area.appendChild(wrapper);
  area._currentPg = pg; area._overlayEl = overlayEl;
}

/* ════════════════════════════════════════════
   SHAPE DRAWING HELPERS
   ════════════════════════════════════════════ */

function _createShapeElement(obj) {
  const NS  = 'http://www.w3.org/2000/svg';
  const fill   = obj.shapeFill   || 'none';
  const stroke = (obj.shapeStroke && obj.shapeStroke !== 'none') ? obj.shapeStroke : 'none';
  const sw     = obj.shapeStrokeWidth != null ? obj.shapeStrokeWidth : 2;
  const dash   = obj.shapeStrokeDash === 'dashed' ? `${sw * 3},${sw * 2}` : null;
  const w = obj.w || 100, h = obj.h || 100;
  let el;

  if (obj.shapeType === 'rect') {
    el = document.createElementNS(NS, 'rect');
    el.setAttribute('x',      sw / 2);
    el.setAttribute('y',      sw / 2);
    el.setAttribute('width',  Math.max(1, w - sw));
    el.setAttribute('height', Math.max(1, h - sw));

  } else if (obj.shapeType === 'ellipse') {
    el = document.createElementNS(NS, 'ellipse');
    el.setAttribute('cx', w / 2);
    el.setAttribute('cy', h / 2);
    el.setAttribute('rx', Math.max(1, w / 2 - sw / 2));
    el.setAttribute('ry', Math.max(1, h / 2 - sw / 2));

  } else if (obj.shapeType === 'triangle') {
    el = document.createElementNS(NS, 'polygon');
    const pad = sw / 2;
    el.setAttribute('points', `${w/2},${pad} ${w - pad},${h - pad} ${pad},${h - pad}`);

  } else if (obj.shapeType === 'line') {
    el = document.createElementNS(NS, 'line');
    // Nếu là line có tọa độ thông minh thì vẽ theo giữa Box
    if (obj.lineStartRel && obj.lineEndRel) {
      el.setAttribute('x1', obj.lineStartRel[0] * w);
      el.setAttribute('y1', obj.lineStartRel[1] * h);
      el.setAttribute('x2', obj.lineEndRel[0] * w);
      el.setAttribute('y2', obj.lineEndRel[1] * h);
    } else {
      // Logic cũ cho các file chưa update
      el.setAttribute('x1', 0);  el.setAttribute('y1', obj.lineFlipY ? 0 : h);
      el.setAttribute('x2', w);  el.setAttribute('y2', obj.lineFlipY ? h : 0);
    }
  }

  if (!el) return document.createElementNS(NS, 'g');

  el.setAttribute('fill',             fill);
  el.setAttribute('stroke',           stroke);
  el.setAttribute('stroke-width',     sw);
  el.setAttribute('stroke-linecap',   'round');
  el.setAttribute('stroke-linejoin',  'round');
  if (dash) el.setAttribute('stroke-dasharray', dash);
  return el;
}

function _buildShapeSVG(obj) {
  const NS  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${obj.w || 100} ${obj.h || 100}`);

  // Mũi tên cho line
  if (obj.shapeType === 'line' && obj.lineArrow) {
    const defs   = document.createElementNS(NS, 'defs');
    const marker = document.createElementNS(NS, 'marker');
    const markId = 'arrow-' + obj.id;
    marker.setAttribute('id',           markId);
    marker.setAttribute('markerWidth',  '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX',         '6');
    marker.setAttribute('refY',         '3');
    marker.setAttribute('orient',       'auto');
    const arrowPath = document.createElementNS(NS, 'path');
    arrowPath.setAttribute('d',    'M0,0 L0,6 L8,3 z');
    arrowPath.setAttribute('fill', obj.shapeStroke || '#000000');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);
    const lineEl = _createShapeElement(obj);
    lineEl.setAttribute('marker-end', `url(#${markId})`);
    svg.appendChild(lineEl);
  } else {
    svg.appendChild(_createShapeElement(obj));
  }

  return svg;
}

function _updateShapeSVG(obj) {
  const area = document.getElementById('edit-canvas-area');
  if (!area || !area._overlayEl) return;
  const el = area._overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
  if (!el) return;
  const oldSvg = el.querySelector('svg');
  if (oldSvg) oldSvg.remove();
  const svgEl = _buildShapeSVG(obj);
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
  const delBtn = el.querySelector('.obj-btn-del');
  el.insertBefore(svgEl, delBtn || null);
}


function _renderOverlayObject(obj, overlayEl, pg) {
  const existing = overlayEl.querySelector(`[data-obj-id="${obj.id}"]`);
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.dataset.objId = obj.id;
  el.className = 'edit-obj' + (obj.selected ? ' selected' : '');
  // Lưu rotation vào transform-origin center của object
  const rotDeg = obj.rotation || 0;
  el.style.cssText = `position:absolute; left:${obj.x}px; top:${obj.y}px; width:${obj.w}px; height:${obj.h}px; box-sizing:border-box; cursor:move; user-select:none; transform-origin:center center; transform:rotate(${rotDeg}deg);`;

  if (obj.type === 'text') {
    el.classList.add('edit-obj-text');
    const textDiv = document.createElement('div');
    textDiv.className = 'edit-obj-textcontent';
    textDiv.contentEditable = 'false';
    textDiv.textContent = obj.content || 'Text';
    textDiv.style.cssText = `font-family: "${obj.fontFamily || 'Arial'}", sans-serif; font-size: ${obj.fontSize || 16}px; font-weight: ${obj.fontWeight || 'normal'}; color: ${obj.color || '#000000'}; text-align: ${obj.textAlign || 'left'}; width:100%; height:100%; outline:none; word-break:break-word; white-space:pre-wrap; pointer-events:none; user-select: none;`;
    el.appendChild(textDiv);

    // Double Click Thần Thánh
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      textDiv.contentEditable = 'true';
      textDiv.style.pointerEvents = 'all';
      el.style.cursor = 'text'; textDiv.style.cursor = 'text';
      el.style.userSelect = 'text'; textDiv.style.userSelect = 'text';
      
      textDiv.focus();
      const range = document.createRange(); range.selectNodeContents(textDiv); range.collapse(false); 
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });

    textDiv.addEventListener('blur', () => {
      const oldContent = obj.content;
      obj.content = textDiv.textContent;
      textDiv.contentEditable = 'false'; textDiv.style.pointerEvents = 'none';
      el.style.cursor = 'move'; textDiv.style.cursor = 'move';
      el.style.userSelect = 'none'; textDiv.style.userSelect = 'none';
      if (oldContent !== obj.content) _saveHistory();
    });
    textDiv.addEventListener('keydown', e => e.stopPropagation());

  } else if (obj.type === 'image') {
    el.classList.add('edit-obj-image');
    // Inner wrapper clip ảnh, còn handles thì nằm trên el (overflow:visible)
    const inner = document.createElement('div');
    inner.className = 'edit-obj-image-inner';
    const img = document.createElement('img');
    img.src = obj.dataURL || '';
    inner.appendChild(img);
    el.appendChild(inner);

  } else if (obj.type === 'shape') {
    el.classList.add('edit-obj-shape');
    el.style.overflow = 'visible';
    const svgEl = _buildShapeSVG(obj);
    svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    el.appendChild(svgEl);
    obj._svgEl = svgEl;

  } else if (obj.type === 'cropbox') {
    el.classList.add('edit-obj-cropbox');
    el.style.cssText += 'border: 1px solid white; background: transparent; box-shadow: 0 0 0 9999px rgba(0,0,0,0.5); z-index: 999;';
    // Đảm bảo box-shadow không che khuất các phần khác quá đáng
    el.style.clipPath = 'inset(-9999px -9999px -9999px -9999px)';
  }

  _bindObjectMove(el, obj, pg);

  // Nút xóa đỏ
  const delBtn = document.createElement('button');
  delBtn.className = 'obj-btn obj-btn-del'; delBtn.innerHTML = '&times;'; delBtn.title = 'Xóa';
  delBtn.addEventListener('mousedown', e => {
    e.stopPropagation();
    pg.overlayObjects = pg.overlayObjects.filter(o => o.id !== obj.id);
    el.remove();
    if (editSelectedObj === obj.id) { editSelectedObj = null; _updateTextControls(null); }
    _saveHistory();
  });
  el.appendChild(delBtn);

  // ── Rotate handle (góc trên trái) ──
  const rotHandle = document.createElement('div');
  rotHandle.className = 'obj-rotate-handle';
  rotHandle.title = 'Xoay (Shift: bước 10°)';
  rotHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>`;
  _bindRotateHandle(el, obj, rotHandle);
  el.appendChild(rotHandle);

  const handles = [ { cls:'rh-n', dir:'n' }, { cls:'rh-s', dir:'s' }, { cls:'rh-w', dir:'w' }, { cls:'rh-e', dir:'e' }, { cls:'rh-se', dir:'se' } ];
  
  // Cropbox cần đủ 8 hướng
  if (obj.type === 'cropbox') {
    handles.push({ cls:'rh-ne', dir:'ne' }, { cls:'rh-nw', dir:'nw' }, { cls:'rh-sw', dir:'sw' });
  }

  handles.forEach(h => {
    const rh = document.createElement('div');
    rh.className = `obj-resize-handle ${h.cls}`;
    
    // Con trỏ chuẩn — page luôn hiển thị thẳng sau khi apply physical rotation
    if (h.dir === 'n' || h.dir === 's') rh.style.cursor = 'ns-resize';
    if (h.dir === 'e' || h.dir === 'w') rh.style.cursor = 'ew-resize';
    if (h.dir === 'ne' || h.dir === 'sw') rh.style.cursor = 'nesw-resize';
    if (h.dir === 'nw' || h.dir === 'se') rh.style.cursor = 'nwse-resize';

    _bindResizeHandle(el, obj, rh, h.dir);
    el.appendChild(rh);
  });

  overlayEl.appendChild(el);
}

function _selectObject(obj, pg) {
  if (editSelectedObj === obj.id) return;

  // Nếu chọn sang một Object khác, ép tắt chế độ gõ chữ của Text hiện tại
  if (document.activeElement && document.activeElement.classList.contains('edit-obj-textcontent')) {
    document.activeElement.blur();
    window.getSelection().removeAllRanges();
  }

  pg.overlayObjects.forEach(o => o.selected = false);
  obj.selected = true; editSelectedObj = obj.id;
  
  const area = document.getElementById('edit-canvas-area');
  if (area && area._overlayEl) {
    Array.from(area._overlayEl.children).forEach(child => {
      if (child.dataset.objId === obj.id) child.classList.add('selected'); else child.classList.remove('selected');
    });
  }
  _updateTextControls(obj);
}

function _deselectAll(pg) {
  pg.overlayObjects.forEach(o => o.selected = false); editSelectedObj = null;
  const area = document.getElementById('edit-canvas-area');
  if (area && area._overlayEl) Array.from(area._overlayEl.children).forEach(child => child.classList.remove('selected'));
  _updateTextControls(null);

  // Ép tắt con trỏ nhấp nháy khi click ra vùng trống của PDF
  if (document.activeElement && document.activeElement.classList.contains('edit-obj-textcontent')) {
    document.activeElement.blur();
  }
  window.getSelection().removeAllRanges();
}

function _bindObjectMove(el, obj, pg) {
  let startX, startY, startOX, startOY;
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.obj-btn-del') || e.target.closest('.obj-resize-handle') || e.target.closest('.obj-rotate-handle')) return;
    if (el.querySelector('[contenteditable="true"]')) return;

    e.preventDefault(); e.stopPropagation();
    _selectObject(obj, pg);

    startX = e.clientX; startY = e.clientY; startOX = obj.x; startOY = obj.y;

    function onMove(e2) {
      let dx = (e2.clientX - startX) / editZoom;
      let dy = (e2.clientY - startY) / editZoom;

      let nx = startOX + dx;
      let ny = startOY + dy;

      if (obj.type === 'cropbox') {
        nx = Math.max(0, Math.min(nx, pg.widthPt * editorScale - obj.w));
        ny = Math.max(0, Math.min(ny, pg.heightPt * editorScale - obj.h));
      } else {
        nx = Math.max(0, nx);
        ny = Math.max(0, ny);
      }

      obj.x = nx;
      obj.y = ny;
      el.style.left = obj.x + 'px';
      el.style.top = obj.y + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (obj.x !== startOX || obj.y !== startOY) _saveHistory();
    }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

function _bindResizeHandle(el, obj, handleEl, dir) {
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY, startW = obj.w, startH = obj.h, startOX = obj.x, startOY = obj.y, MIN = 2;
    const aspect = startW / startH;

    function onMove(e2) {
      let dx = (e2.clientX - startX) / editZoom;
      let dy = (e2.clientY - startY) / editZoom;
      const pg = _getCurrentPg();

      if (obj.type === 'cropbox' && pg) {
        if (dir.includes('e')) dx = Math.min(dx, pg.widthPt * editorScale - (startOX + startW));
        if (dir.includes('w')) dx = Math.max(dx, -startOX);
        if (dir.includes('s')) dy = Math.min(dy, pg.heightPt * editorScale - (startOY + startH));
        if (dir.includes('n')) dy = Math.max(dy, -startOY);
      }

      if (dir === 'se') {
        if (obj.type === 'cropbox') {
          obj.w = Math.max(MIN, startW + dx);
          obj.h = Math.max(MIN, startH + dy);
        } else {
          if (Math.abs(dx) > Math.abs(dy)) {
            obj.w = Math.max(MIN, startW + dx);
            obj.h = obj.w / aspect;
          } else {
            obj.h = Math.max(MIN, startH + dy);
            obj.w = obj.h * aspect;
          }
        }
      }
      else if (dir === 'ne') { obj.w = Math.max(MIN, startW + dx); const nh = Math.max(MIN, startH - dy); obj.y = startOY + (startH - nh); obj.h = nh; }
      else if (dir === 'sw') { obj.h = Math.max(MIN, startH + dy); const nw = Math.max(MIN, startW - dx); obj.x = startOX + (startW - nw); obj.w = nw; }
      else if (dir === 'nw') { const nw = Math.max(MIN, startW - dx); obj.x = startOX + (startW - nw); obj.w = nw; const nh = Math.max(MIN, startH - dy); obj.y = startOY + (startH - nh); obj.h = nh; }
      else if (dir === 'e') { obj.w = Math.max(MIN, startW + dx); }
      else if (dir === 'w') { const nw = Math.max(MIN, startW - dx); obj.x = startOX + (startW - nw); obj.w = nw; }
      else if (dir === 's') { obj.h = Math.max(MIN, startH + dy); }
      else if (dir === 'n') { const nh = Math.max(MIN, startH - dy); obj.y = startOY + (startH - nh); obj.h = nh; }

      el.style.width = obj.w + 'px';
      el.style.height = obj.h + 'px';
      el.style.left = obj.x + 'px';
      el.style.top = obj.y + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (obj.w !== startW || obj.h !== startH || obj.x !== startOX || obj.y !== startOY) _saveHistory();
    }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
}

// ── Bind Rotate Handle ──
function _bindRotateHandle(el, obj, handleEl) {
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startAngle = obj.rotation || 0;

    // Tâm của object trên màn hình (dùng getBoundingClientRect sau khi element đã render)
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;

    // Góc bắt đầu giữa chuột và tâm object
    const initMouseAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);

    function onMove(e2) {
      const curMouseAngle = Math.atan2(e2.clientY - cy, e2.clientX - cx) * (180 / Math.PI);
      let delta = curMouseAngle - initMouseAngle;
      let newAngle = startAngle + delta;

      // Shift: snap to 10°
      if (e2.shiftKey) newAngle = Math.round(newAngle / 10) * 10;

      obj.rotation = ((newAngle % 360) + 360) % 360;
      el.style.transform = `rotate(${obj.rotation}deg)`;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _saveHistory();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
