/* Data-driven master prompt cards. No network or AI call is needed to generate. */
(function () {
  'use strict';
  const library = document.getElementById('prompt-library');
  const dialog = document.getElementById('prompt-dialog');
  const output = document.getElementById('prompt-output');
  const status = document.getElementById('prompt-status');
  const fallback = document.getElementById('prompt-open-fallback');
  const actions = dialog.querySelectorAll('.prompt-actions button');
  const categoryButtons = document.querySelectorAll('[data-prompt-category]');
  const emptyState = document.getElementById('prompt-category-empty');
  const providers = {
    gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
    dola: { name: 'Dola', url: 'https://www.dola.com/chat/create-image' }
  };
  let trigger = null;
  const promptCards = [];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function updateCount() {
    document.getElementById('prompt-character-count').textContent =
      output.value.length.toLocaleString('vi-VN') + ' ký tự';
  }

  function renderPrompt(template, values) {
    // One pass: user values (including $&, braces or HTML) remain literal text.
    let master = template.master;
    Object.entries(template.legacyReplacements || {}).forEach(([token, key]) => {
      master = master.split(token).join(values[key] || token);
    });
    return master.replace(/\{\{(\w+)\}\}/g, (token, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : token);
  }

  (window.PROMPT_TEMPLATES || []).forEach(template => {
    const storageKey = 'prompt-generator:v2:' + template.id;
    let saved = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
    } catch (_) { /* Storage may be unavailable when opened as a local file. */ }

    const card = element('article', 'prompt-card');
    const thumbnail = element('img', 'prompt-thumbnail');
    thumbnail.src = template.thumbnail;
    thumbnail.alt = template.thumbnailAlt;
    thumbnail.width = 232;
    thumbnail.height = 288;
    card.append(thumbnail);
    const form = element('form', 'prompt-card-body');
    form.append(element('h2', '', template.cardTitle), element('p', 'prompt-card-caption', template.caption));
    const advanced = element('details', 'prompt-advanced');
    advanced.append(element('summary', '', template.advancedLabel || 'Tùy chỉnh màu sắc, slogan & tỷ lệ'));
    const inputs = {};

    template.fields.forEach(field => {
      const row = element('div', 'prompt-field');
      const label = element('label', '', field.label);
      const input = element(field.options ? 'select' : 'input');
      input.id = 'prompt-' + template.id + '-' + field.key;
      input.name = field.key;
      label.htmlFor = input.id;
      if (field.options) {
        field.options.forEach(value => {
          const option = element('option', '', value);
          option.value = value;
          input.append(option);
        });
      } else {
        input.type = 'text';
        input.maxLength = 500;
        input.placeholder = field.placeholder || field.value;
      }
      const stored = saved[field.key];
      input.value = typeof stored === 'string' && stored.length <= 500 &&
        (!field.options || field.options.includes(stored)) ? stored : field.value;
      inputs[field.key] = input;
      row.append(label, input);
      (field.advanced ? advanced : form).append(row);
    });
    if (template.fields.some(field => field.advanced)) form.append(advanced);
    const generate = element('button', 'prompt-primary prompt-generate', 'GENERATE PROMT');
    generate.type = 'submit';
    form.append(generate);
    card.append(form);
    card.dataset.category = template.category || 'juice';
    library.append(card);
    promptCards.push(card);

    function draftValues() {
      return Object.fromEntries(template.fields.map(field => [field.key, inputs[field.key].value]));
    }
    form.addEventListener('input', () => {
      try { localStorage.setItem(storageKey, JSON.stringify(draftValues())); } catch (_) { /* Optional persistence. */ }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      for (const field of template.fields) {
        const input = inputs[field.key];
        if (!field.optional && !input.value.trim()) {
          if (field.advanced) advanced.open = true;
          input.setCustomValidity('Vui lòng nhập ' + field.label.toLowerCase() + '.');
          input.reportValidity();
          input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
          return;
        }
      }
      const values = Object.fromEntries(template.fields.map(field => {
        const value = inputs[field.key].value.trim();
        return [field.key, value || field.fallback || ''];
      }));
      output.value = renderPrompt(template, values);
      document.getElementById('prompt-dialog-title').textContent = template.title;
      document.getElementById('prompt-template-meta').textContent =
        'MASTER PROMT · ' + template.cardTitle.toUpperCase();
      status.textContent = '';
      fallback.hidden = true;
      updateCount();
      trigger = generate;
      dialog.showModal();
      output.scrollTop = 0;
      document.getElementById('prompt-dialog-close').focus();
    });
  });

  function selectCategory(category) {
    let visibleCount = 0;
    promptCards.forEach(card => {
      const visible = card.dataset.category === category;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    categoryButtons.forEach(button => {
      const selected = button.dataset.promptCategory === category;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    emptyState.hidden = visibleCount !== 0;
  }

  categoryButtons.forEach(button => {
    button.addEventListener('click', () => selectCategory(button.dataset.promptCategory));
  });
  selectCategory('juice');

  output.addEventListener('input', () => {
    updateCount();
    status.textContent = '';
  });
  document.getElementById('prompt-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (trigger) trigger.focus(); });

  async function copyPrompt() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(output.value); return true; }
      catch (_) { /* Local files or denied permission: try legacy copy. */ }
    }
    // Legacy copy supports browsers that do not expose the Clipboard API.
    const focused = document.activeElement;
    const start = output.selectionStart;
    const end = output.selectionEnd;
    const scroll = output.scrollTop;
    output.focus();
    output.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { /* Try Clipboard API. */ }
    output.setSelectionRange(start, end);
    output.scrollTop = scroll;
    if (focused) focused.focus();
    return copied;
  }

  async function handleAction(provider) {
    if (!output.value.trim()) {
      status.textContent = 'Promt đang trống. Hãy nhập nội dung hoặc tạo lại promt.';
      output.focus();
      return;
    }
    actions.forEach(button => { button.disabled = true; });
    fallback.hidden = true;
    // Start copying while the source window is focused; reserve a tab within
    // the original click so awaiting clipboard permission cannot block opening.
    const copying = copyPrompt();
    let destination = null;
    if (provider) {
      destination = window.open('about:blank', '_blank');
      if (destination) destination.opener = null;
    }
    const copied = await copying;
    actions.forEach(button => { button.disabled = false; });
    if (!copied) {
      if (destination) destination.close();
      output.focus();
      output.select();
      status.textContent = 'Trình duyệt chưa cho phép copy. Nội dung đã được chọn: nhấn Ctrl+C (Mac: ⌘C).' +
        (provider ? ' Sau đó mở trang bằng liên kết bên dưới.' : '');
    } else if (!provider) {
      status.textContent = 'Đã copy toàn bộ promt.';
    } else {
      status.textContent = 'Đã copy promt. Dán bằng Ctrl+V (Mac: ⌘V) trên ' + provider.name + ' rồi đính kèm ảnh sản phẩm.';
      if (destination) {
        try { destination.location.replace(provider.url); }
        catch (_) { destination.close(); destination = null; }
      }
      if (!destination) status.textContent += ' Nếu trang chưa mở, bấm liên kết bên dưới.';
    }
    if (provider) {
      fallback.href = provider.url;
      fallback.textContent = 'Mở ' + provider.name + ' ↗';
      fallback.hidden = false;
    }
  }

  document.getElementById('prompt-copy').addEventListener('click', () => handleAction(null));
  dialog.querySelectorAll('[data-prompt-provider]').forEach(button => {
    button.addEventListener('click', () => handleAction(providers[button.dataset.promptProvider]));
  });
})();
