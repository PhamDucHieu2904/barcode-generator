/* Single-color halftone image filter. Runs entirely in the browser. */
(function () {
  'use strict';

  const canvas = document.getElementById('image-filter-canvas');
  const dropzone = document.getElementById('image-filter-dropzone');
  const fileInput = document.getElementById('image-filter-file');
  if (!canvas || !dropzone || !fileInput) return;

  const preview = document.getElementById('image-filter-empty');
  const status = document.getElementById('image-filter-status');
  const meta = document.getElementById('image-filter-preview-meta');
  const colorInput = document.getElementById('image-filter-color');
  const minSizeInput = document.getElementById('image-filter-min-size');
  const maxSizeInput = document.getElementById('image-filter-max-size');
  const spacingInput = document.getElementById('image-filter-spacing');
  const contrastInput = document.getElementById('image-filter-contrast');
  const shapeDropdown = document.getElementById('image-filter-shape-dropdown');
  const shapeTrigger = document.getElementById('image-filter-shape-trigger');
  const shapeTriggerIcon = document.getElementById('image-filter-shape-trigger-icon');
  const shapeValue = document.getElementById('image-filter-shape-value');
  const shapeMenu = document.getElementById('image-filter-shape-menu');
  const shapeOptions = Array.from(document.querySelectorAll('[data-dot-shape]'));
  const resetButton = document.getElementById('image-filter-reset');
  const exportButton = document.getElementById('image-filter-export');
  const exportSvgButton = document.getElementById('image-filter-export-svg');
  const colorValue = document.getElementById('image-filter-color-value');
  const minSizeValue = document.getElementById('image-filter-min-size-value');
  const maxSizeValue = document.getElementById('image-filter-max-size-value');
  const spacingValue = document.getElementById('image-filter-spacing-value');
  const contrastValue = document.getElementById('image-filter-contrast-value');
  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const outputContext = canvas.getContext('2d');

  const defaults = {
    color: '#F56E5E',
    minSize: '0',
    maxSize: '12',
    spacing: '16',
    contrast: '100',
  };

  // Prevent white or near-white backgrounds from receiving minimum-size dots.
  const backgroundLuminanceCutoff = 250;

  let sourceImage = null;
  let sourceName = 'image';
  let renderFrame = 0;
  let selectedShape = 'circle';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function updateLabels() {
    const min = Number(minSizeInput.value);
    const max = Math.max(min, Number(maxSizeInput.value));
    if (Number(maxSizeInput.value) < min) maxSizeInput.value = String(min);

    colorValue.textContent = colorInput.value.toUpperCase();
    minSizeValue.textContent = min + ' px';
    maxSizeValue.textContent = max + ' px';
    spacingValue.textContent = spacingInput.value + ' px';
    contrastValue.textContent = contrastInput.value + '%';
  }

  function scheduleRender() {
    updateLabels();
    if (!sourceImage) return;
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(renderHalftone);
  }

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      status.textContent = 'Vui lòng chọn một file ảnh hợp lệ.';
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = function () {
      URL.revokeObjectURL(objectUrl);
      sourceImage = image;
      sourceName = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
      preview.classList.add('is-hidden');
      resetButton.disabled = false;
      exportButton.disabled = false;
      exportSvgButton.disabled = false;
      status.textContent = image.naturalWidth + ' × ' + image.naturalHeight;
      meta.textContent = 'PNG · ' + image.naturalWidth + ' × ' + image.naturalHeight + ' px';
      renderHalftone();
    };
    image.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      status.textContent = 'Không thể đọc ảnh này. Hãy thử file khác.';
    };
    image.src = objectUrl;
  }

  function getHexColor() {
    const hex = colorInput.value.replace('#', '');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  const shapeIconMarkup = {
    circle: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="currentColor" /></svg>',
    triangle: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 13.25 13.5H2.75L8 2.5Z" fill="currentColor" /></svg>',
    square: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" /></svg>',
    diamond: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 2.5 5.5 5.5L8 13.5 2.5 8 8 2.5Z" fill="currentColor" /></svg>',
  };

  const shapeLabels = {
    circle: 'Circle',
    triangle: 'Triangle',
    square: 'Square',
    diamond: 'Diamond',
  };

  function updateShapeSelection() {
    shapeTriggerIcon.innerHTML = shapeIconMarkup[selectedShape];
    shapeValue.textContent = shapeLabels[selectedShape];
    shapeOptions.forEach(function (option) {
      const active = option.dataset.dotShape === selectedShape;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }

  function closeShapeMenu(restoreFocus) {
    shapeMenu.hidden = true;
    shapeTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) shapeTrigger.focus();
  }

  function openShapeMenu(focusSelected) {
    shapeMenu.hidden = false;
    shapeTrigger.setAttribute('aria-expanded', 'true');
    if (focusSelected) {
      const selectedOption = shapeOptions.find(function (option) {
        return option.dataset.dotShape === selectedShape;
      });
      if (selectedOption) selectedOption.focus();
    }
  }

  function setShape(shape, shouldRender) {
    if (!shapeLabels[shape]) return;
    selectedShape = shape;
    updateShapeSelection();
    closeShapeMenu(false);
    if (shouldRender !== false) scheduleRender();
  }

  function drawDot(context, shape, x, y, diameter) {
    const half = diameter / 2;
    context.beginPath();
    if (shape === 'triangle') {
      context.moveTo(x, y - half);
      context.lineTo(x + half, y + half);
      context.lineTo(x - half, y + half);
    } else if (shape === 'square') {
      context.rect(x - half, y - half, diameter, diameter);
    } else if (shape === 'diamond') {
      context.moveTo(x, y - half);
      context.lineTo(x + half, y);
      context.lineTo(x, y + half);
      context.lineTo(x - half, y);
    } else {
      context.arc(x, y, half, 0, Math.PI * 2);
    }
    context.closePath();
    context.fill();
  }

  function svgDot(shape, x, y, diameter) {
    const half = diameter / 2;
    if (shape === 'triangle') {
      return '<polygon points="' + x.toFixed(2) + ',' + (y - half).toFixed(2) + ' ' + (x + half).toFixed(2) + ',' + (y + half).toFixed(2) + ' ' + (x - half).toFixed(2) + ',' + (y + half).toFixed(2) + '"/>';
    }
    if (shape === 'square') {
      return '<rect x="' + (x - half).toFixed(2) + '" y="' + (y - half).toFixed(2) + '" width="' + diameter.toFixed(2) + '" height="' + diameter.toFixed(2) + '"/>';
    }
    if (shape === 'diamond') {
      return '<polygon points="' + x.toFixed(2) + ',' + (y - half).toFixed(2) + ' ' + (x + half).toFixed(2) + ',' + y.toFixed(2) + ' ' + x.toFixed(2) + ',' + (y + half).toFixed(2) + ' ' + (x - half).toFixed(2) + ',' + y.toFixed(2) + '"/>';
    }
    return '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="' + half.toFixed(2) + '"/>';
  }

  function renderHalftone() {
    if (!sourceImage) return;

    // Keep very large photos responsive while preserving their aspect ratio.
    const maxDimension = 2200;
    const scale = Math.min(1, maxDimension / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
    const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));

    sourceCanvas.width = width;
    sourceCanvas.height = height;
    sourceContext.clearRect(0, 0, width, height);
    sourceContext.drawImage(sourceImage, 0, 0, width, height);
    const pixels = sourceContext.getImageData(0, 0, width, height).data;

    canvas.width = width;
    canvas.height = height;
    outputContext.fillStyle = '#ffffff';
    outputContext.fillRect(0, 0, width, height);

    const spacing = Math.max(1, Number(spacingInput.value));
    const minSize = clamp(Number(minSizeInput.value), 0, 80);
    const maxSize = Math.max(minSize, clamp(Number(maxSizeInput.value), 0, 80));
    const contrast = Number(contrastInput.value) / 100;
    const color = getHexColor();
    outputContext.fillStyle = 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';

    for (let y = spacing / 2; y < height; y += spacing) {
      const sampleY = Math.min(height - 1, Math.floor(y));
      for (let x = spacing / 2; x < width; x += spacing) {
        const sampleX = Math.min(width - 1, Math.floor(x));
        const pixelIndex = (sampleY * width + sampleX) * 4;
        const alpha = pixels[pixelIndex + 3] / 255;
        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        let luminance = (0.299 * red + 0.587 * green + 0.114 * blue) * alpha + 255 * (1 - alpha);
        if (luminance >= backgroundLuminanceCutoff) continue;
        luminance = clamp(128 + (luminance - 128) * contrast, 0, 255);
        const darkness = 1 - luminance / 255;
        const diameter = minSize + (maxSize - minSize) * darkness;
        if (diameter <= 0.01) continue;

        drawDot(outputContext, selectedShape, x, y, diameter);
      }
    }

    meta.textContent = 'PNG · ' + width + ' × ' + height + ' px · ' + spacing + ' px grid';
  }

  function resetSettings() {
    colorInput.value = defaults.color;
    minSizeInput.value = defaults.minSize;
    maxSizeInput.value = defaults.maxSize;
    spacingInput.value = defaults.spacing;
    contrastInput.value = defaults.contrast;
    setShape('circle', false);
    updateLabels();
    if (sourceImage) renderHalftone();
  }

  function exportPng() {
    if (!sourceImage) return;
    canvas.toBlob(function (blob) {
      if (!blob) {
        status.textContent = 'Không thể tạo file PNG. Hãy thử lại.';
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = sourceName + '-halftone.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      status.textContent = 'Đã export PNG';
    }, 'image/png');
  }

  function exportSvg() {
    if (!sourceImage || !canvas.width || !canvas.height) return;

    const width = canvas.width;
    const height = canvas.height;
    const pixels = sourceContext.getImageData(0, 0, width, height).data;
    const spacing = Math.max(1, Number(spacingInput.value));
    const minSize = clamp(Number(minSizeInput.value), 0, 80);
    const maxSize = Math.max(minSize, clamp(Number(maxSizeInput.value), 0, 80));
    const contrast = Number(contrastInput.value) / 100;
    const color = colorInput.value.toUpperCase();
    const circles = [];

    for (let y = spacing / 2; y < height; y += spacing) {
      const sampleY = Math.min(height - 1, Math.floor(y));
      for (let x = spacing / 2; x < width; x += spacing) {
        const sampleX = Math.min(width - 1, Math.floor(x));
        const pixelIndex = (sampleY * width + sampleX) * 4;
        const alpha = pixels[pixelIndex + 3] / 255;
        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        let luminance = (0.299 * red + 0.587 * green + 0.114 * blue) * alpha + 255 * (1 - alpha);
        if (luminance >= backgroundLuminanceCutoff) continue;
        luminance = clamp(128 + (luminance - 128) * contrast, 0, 255);
        const darkness = 1 - luminance / 255;
        const diameter = minSize + (maxSize - minSize) * darkness;
        if (diameter > 0.01) {
          circles.push(svgDot(selectedShape, x, y, diameter));
        }
      }
    }

    const svg = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
      '<rect width="100%" height="100%" fill="#FFFFFF"/>',
      '<g fill="' + color + '">',
      circles.join(''),
      '</g>',
      '</svg>',
    ].join('');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sourceName + '-halftone.svg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    status.textContent = 'Đã export SVG';
  }

  shapeTrigger.addEventListener('click', function () {
    if (shapeMenu.hidden) openShapeMenu(true);
    else closeShapeMenu(false);
  });

  shapeTrigger.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openShapeMenu(true);
    }
  });

  shapeOptions.forEach(function (option, index) {
    option.addEventListener('click', function () {
      setShape(option.dataset.dotShape);
      shapeTrigger.focus();
    });
    option.addEventListener('keydown', function (event) {
      let nextIndex = index;
      if (event.key === 'ArrowDown') nextIndex = (index + 1) % shapeOptions.length;
      if (event.key === 'ArrowUp') nextIndex = (index - 1 + shapeOptions.length) % shapeOptions.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = shapeOptions.length - 1;
      if (nextIndex !== index) {
        event.preventDefault();
        shapeOptions[nextIndex].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        option.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeShapeMenu(true);
      }
    });
  });

  document.addEventListener('click', function (event) {
    if (!shapeDropdown.contains(event.target)) closeShapeMenu(false);
  });

  fileInput.addEventListener('change', function (event) {
    loadImage(event.target.files[0]);
    event.target.value = '';
  });

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  ['dragenter', 'dragover'].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  });
  dropzone.addEventListener('drop', function (event) {
    loadImage(event.dataTransfer.files[0]);
  });

  [colorInput, minSizeInput, maxSizeInput, spacingInput, contrastInput].forEach(function (input) {
    input.addEventListener('input', scheduleRender);
  });
  resetButton.addEventListener('click', resetSettings);
  exportButton.addEventListener('click', exportPng);
  exportSvgButton.addEventListener('click', exportSvg);
  updateShapeSelection();
  updateLabels();
})();
