(function () {
  'use strict';

  const { Effects, Bridge, Engine } = window;

  const $ = (selector) => document.querySelector(selector);

  const ICONS = {
    eye: '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    reload: '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9L13.5 5.7"/><path d="M13.5 2.5v3.2h-3.2"/></svg>',
    person: '<svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="5.2" r="2.7"/><path d="M2.8 14c.6-3 2.7-4.6 5.2-4.6s4.6 1.6 5.2 4.6"/></svg>',
    gallery: '<svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/></svg>',
    caret: '<svg aria-hidden="true" viewBox="0 0 10 10"><path d="M1 3h8L5 8z"/></svg>',
    chevron: '<svg aria-hidden="true" class="chevron" viewBox="0 0 10 10"><path d="M1 3h8L5 8z"/></svg>',
    reset: '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7"/><path d="M2.5 2.5v3.2h3.2"/></svg>',
    close: '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  };

  const THUMB_WIDTH = 260;
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.25;

  const state = {
    doc: null,
    hasMask: false,
    stack: [],
    selected: null,
    compare: false,
    zoom: null, // null means fit to the stage
    presets: {},
    user: { presets: {}, stacks: [] },
    collapsed: new Set(),
    busy: false,
  };

  let engine = null;
  let nextUid = 1;
  let frameQueued = false;
  let statusIsError = false;

  // --- DOM helper ---------------------------------------------------------

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'icon') node.innerHTML = ICONS[value];
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    children.forEach((child) => child && node.append(child));
    return node;
  }

  // --- Status -------------------------------------------------------------

  function docSummary() {
    if (!state.doc) return 'No document';
    const { title, width, height } = state.doc;
    const subject = state.hasMask ? 'subject detected' : 'no subject mask';
    return `${title} · ${width} × ${height} · ${subject}`;
  }

  function setStatus(text, isError) {
    statusIsError = Boolean(isError);
    const node = $('#status');
    node.textContent = text;
    node.classList.toggle('is-error', statusIsError);
  }

  function setProgress(fraction) {
    $('#progress').hidden = fraction === null;
    if (fraction !== null) $('#progressFill').style.width = `${Math.round(fraction * 100)}%`;
  }

  function updateCommands() {
    const canRender = Boolean(state.doc) && !state.busy;
    $('#apply').disabled = !canRender || !activeStack().length;
    $('#detect').disabled = !canRender;
    $('#reload').disabled = state.busy;
    $('#compare').disabled = !state.doc;
  }

  // Serialises Photoshop work. Only one long-running operation at a time.
  async function task(label, work) {
    if (state.busy) return false;
    state.busy = true;
    setStatus(label);
    updateCommands();
    try {
      await work();
      setStatus(docSummary());
      return true;
    } catch (error) {
      setStatus(error.message, true);
      return false;
    } finally {
      state.busy = false;
      setProgress(null);
      updateCommands();
    }
  }

  // --- Stack --------------------------------------------------------------

  function selectedLayer() {
    return state.stack.find((layer) => layer.uid === state.selected) || null;
  }

  function isRenderable(layer) {
    return layer.enabled && (!Effects.get(layer.effectId).requiresMask || state.hasMask);
  }

  function activeStack() {
    return state.stack.filter(isRenderable);
  }

  function builtinPreset(effectId, id) {
    return (state.presets[effectId] || []).find((preset) => preset.id === id);
  }

  function userPresets(effectId) {
    return state.user.presets[effectId] || [];
  }

  // Parameters can hold lists of objects, so anything shared between a layer and
  // a preset or saved stack has to be a real copy.
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function paramsFromPreset(effectId, preset) {
    return Object.assign(Effects.defaults(Effects.get(effectId)), preset ? clone(preset.params) : {});
  }

  function assignEffect(layer, effectId) {
    const first = (state.presets[effectId] || [])[0];
    layer.effectId = effectId;
    layer.presetKey = first ? `b:${first.id}` : null;
    layer.params = paramsFromPreset(effectId, first);
  }

  function addLayer(effectId) {
    const layer = { uid: nextUid++, enabled: true };
    assignEffect(layer, effectId);
    state.stack.push(layer);
    state.selected = layer.uid;
    refreshAll();
  }

  function removeLayer(uid) {
    const index = state.stack.findIndex((layer) => layer.uid === uid);
    state.stack.splice(index, 1);
    if (state.selected === uid) {
      const neighbour = state.stack[Math.min(index, state.stack.length - 1)];
      state.selected = neighbour ? neighbour.uid : null;
    }
    refreshAll();
  }

  function resetLayer(layer) {
    const [source, id] = (layer.presetKey || '').split(/:(.*)/s);
    let preset = null;
    if (source === 'b') preset = builtinPreset(layer.effectId, id);
    if (source === 'u') preset = userPresets(layer.effectId).find((item) => item.name === id);
    if (!preset) preset = (state.presets[layer.effectId] || [])[0];
    layer.params = paramsFromPreset(layer.effectId, preset);
    refreshAll();
  }

  // --- Rendering ----------------------------------------------------------

  function invalidate() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      if (engine && state.doc) engine.draw(state.compare ? [] : activeStack());
    });
  }

  function renderThumbnails() {
    if (!state.doc) return;
    const width = Math.min(THUMB_WIDTH, state.doc.previewWidth);
    const height = Math.round((width * state.doc.previewHeight) / state.doc.previewWidth);
    document.querySelectorAll('[data-thumb]').forEach((canvas) => {
      const effectId = canvas.dataset.thumb;
      const layer = { effectId, enabled: true, params: paramsFromPreset(effectId, (state.presets[effectId] || [])[0]) };
      const pixels = engine.renderThumbnail([layer], width, height);
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
    });
  }

  function refreshAll() {
    renderGalleryState();
    renderStack();
    renderInspector();
    renderHandles();
    updateCommands();
    invalidate();
  }

  // --- Zoom ---------------------------------------------------------------

  function fitScale() {
    const stage = $('#stage');
    const available = {
      width: stage.clientWidth - 32,
      height: stage.clientHeight - 32,
    };
    return Math.min(available.width / state.doc.previewWidth, available.height / state.doc.previewHeight);
  }

  function applyZoom() {
    if (!state.doc) return;
    const scale = state.zoom === null ? fitScale() : state.zoom;
    const frame = $('#frame');
    frame.style.width = `${Math.max(1, Math.round(state.doc.previewWidth * scale))}px`;
    frame.style.height = `${Math.max(1, Math.round(state.doc.previewHeight * scale))}px`;
  }

  function zoomBy(factor) {
    if (!state.doc) return;
    const current = state.zoom === null ? fitScale() : state.zoom;
    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor));
    applyZoom();
  }

  // --- Gallery ------------------------------------------------------------

  function buildGallery() {
    const list = $('#galleryList');
    list.replaceChildren(
      ...Effects.list().map((effect) =>
        h(
          'button',
          {
            class: 'card',
            type: 'button',
            'data-effect': effect.id,
            'aria-pressed': 'false',
            onclick: () => onGalleryPick(effect.id),
          },
          h('canvas', { 'data-thumb': effect.id, width: 260, height: 325 }),
          h('span', { class: 'card-name', text: effect.name }),
        ),
      ),
    );
  }

  function renderGalleryState() {
    const layer = selectedLayer();
    document.querySelectorAll('.card').forEach((card) => {
      card.setAttribute('aria-pressed', String(Boolean(layer) && layer.effectId === card.dataset.effect));
    });
  }

  function onGalleryPick(effectId) {
    const layer = selectedLayer();
    if (!layer) {
      addLayer(effectId);
      return;
    }
    if (layer.effectId === effectId) return;
    assignEffect(layer, effectId);
    refreshAll();
  }

  // --- Inspector ----------------------------------------------------------

  function formatNumber(value, step) {
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return Number(value).toFixed(decimals);
  }

  function setRangeFill(input) {
    const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.style.setProperty('--fill', `${Math.round(ratio * 100)}%`);
  }

  function markCustom(layer) {
    if (layer.presetKey === null) return;
    layer.presetKey = null;
    renderPresetControls(layer);
  }

  function updateLayer(layer, change) {
    change();
    markCustom(layer);
    renderHandles();
    invalidate();
  }

  // Field renderers read and write through a binding, so the same controls work
  // for a layer's own parameters and for one item in a list parameter.
  function flatBinding(layer) {
    return {
      get: (id) => layer.params[id],
      set: (id, value) => updateLayer(layer, () => {
        layer.params[id] = value;
      }),
      key: (id) => id,
    };
  }

  // Items saved before a field existed read that field's default.
  function itemValue(item, field) {
    return item[field.id] === undefined ? field.default : item[field.id];
  }

  function itemBinding(layer, list, item, onChange) {
    const listId = list.id;
    return {
      get: (id) => itemValue(item, list.fields.find((field) => field.id === id)),
      set: (id, value) => {
        updateLayer(layer, () => {
          item[id] = value;
          // A switch that gives the item its own copy of shared settings starts
          // that copy from the shared values.
          const field = list.fields.find((candidate) => candidate.id === id);
          if (value === true && field.seed) field.seed(item, layer.params);
        });
        onChange(id, value);
      },
      key: (id) => `${listId}.${id}`,
    };
  }

  function renderRange(binding, param) {
    const key = binding.key(param.id);
    const inputId = `p-${key}`;
    const range = h('input', {
      id: inputId,
      type: 'range',
      min: param.min,
      max: param.max,
      step: param.step,
      value: binding.get(param.id),
      'data-param': key,
    });
    const number = h('input', {
      type: 'number',
      min: param.min,
      max: param.max,
      step: param.step,
      inputmode: 'decimal',
      'aria-label': `${param.label} value`,
      value: formatNumber(binding.get(param.id), param.step),
      'data-number': key,
    });
    setRangeFill(range);

    range.addEventListener('input', () => {
      setRangeFill(range);
      number.value = formatNumber(range.value, param.step);
      binding.set(param.id, Number(range.value));
    });
    number.addEventListener('change', () => {
      const parsed = Number(number.value);
      const clamped = Number.isFinite(parsed)
        ? Math.min(param.max, Math.max(param.min, parsed))
        : binding.get(param.id);
      number.value = formatNumber(clamped, param.step);
      range.value = clamped;
      setRangeFill(range);
      binding.set(param.id, clamped);
    });

    return h('div', { class: 'param' }, h('label', { for: inputId, text: param.label }), range, number);
  }

  function renderSelect(binding, param) {
    const inputId = `p-${binding.key(param.id)}`;
    const select = h(
      'select',
      {
        id: inputId,
        class: 'field',
        onchange: (event) => binding.set(param.id, event.target.value),
      },
      ...param.options.map((option) => h('option', { value: option.value, text: option.label })),
    );
    select.value = binding.get(param.id);
    return h('div', { class: 'param param-select' }, h('label', { for: inputId, text: param.label }), select);
  }

  function renderColor(binding, param) {
    const inputId = `p-${binding.key(param.id)}`;
    const hex = h('span', { class: 'color-hex', text: binding.get(param.id).toUpperCase() });
    const input = h('input', {
      id: inputId,
      type: 'color',
      value: binding.get(param.id),
      oninput: (event) => {
        hex.textContent = event.target.value.toUpperCase();
        binding.set(param.id, event.target.value);
      },
    });
    return h(
      'div',
      { class: 'param param-select' },
      h('label', { for: inputId, text: param.label }),
      h('div', { class: 'color-pair' }, input, hex),
    );
  }

  // A switch that other parameters can depend on (through `when`), so turning
  // it rebuilds the panel and keeps focus on the checkbox.
  function renderToggle(binding, param) {
    const inputId = `p-${binding.key(param.id)}`;
    const input = h('input', {
      id: inputId,
      type: 'checkbox',
      onchange: (event) => {
        binding.set(param.id, event.target.checked);
        renderInspector();
        const again = document.getElementById(inputId);
        if (again) again.focus();
      },
    });
    input.checked = Boolean(binding.get(param.id));
    return h('div', { class: 'param param-toggle' }, h('label', { for: inputId, text: param.label }), input);
  }

  const FIELD_RENDERERS = { range: renderRange, select: renderSelect, color: renderColor, toggle: renderToggle };

  // A repeatable group, such as the lights of Rim Light. Only the active item
  // shows its fields, which keeps the panel short with several items.
  function renderList(layer, param) {
    const items = layer.params[param.id];
    layer.activeItem = Math.min(layer.activeItem || 0, items.length - 1);

    const nodes = items.flatMap((item, index) => {
      const label = `${param.itemLabel} ${index + 1}`;
      const isActive = index === layer.activeItem;
      const swatch = h('span', { class: 'item-swatch' });
      swatch.style.backgroundColor = item[param.swatch];

      const classes = ['item-row'];
      if (isActive) classes.push('is-active');
      if (!item.enabled) classes.push('is-off');

      const row = h(
        'div',
        { class: classes.join(' ') },
        h(
          'button',
          {
            class: 'item-pick',
            type: 'button',
            'aria-expanded': String(isActive),
            onclick: () => selectItem(layer, index),
          },
          swatch,
          document.createTextNode(label),
          ...param.fields
            .filter((field) => field.tag && field.tag[itemValue(item, field)])
            .map((field) => h('span', { class: 'item-tag', text: field.tag[itemValue(item, field)] })),
        ),
        h(
          'button',
          {
            class: 'row-btn',
            type: 'button',
            'aria-label': `Toggle ${label}`,
            'aria-pressed': String(item.enabled),
            onclick: () => {
              updateLayer(layer, () => {
                item.enabled = !item.enabled;
              });
              renderInspector();
            },
          },
          h('span', { class: 'dot' }),
        ),
        h('button', {
          class: 'row-btn',
          type: 'button',
          'aria-label': `Remove ${label}`,
          icon: 'close',
          disabled: items.length === 1,
          onclick: () => {
            updateLayer(layer, () => {
              items.splice(index, 1);
              layer.activeItem = Math.min(layer.activeItem, items.length - 1);
            });
            renderInspector();
          },
        }),
      );
      if (!isActive) return [row];

      const binding = itemBinding(layer, param, item, (id, value) => {
        if (id === param.swatch) swatch.style.backgroundColor = value;
        // A choice such as placement changes which fields and tags apply, so
        // rebuild, then put focus back on the control that was just used.
        if (param.fields.find((field) => field.id === id).type === 'select') {
          renderInspector();
          const again = document.getElementById(`p-${param.id}.${id}`);
          if (again) again.focus();
        }
      });
      const fields = param.fields
        .filter((field) => !field.when || field.when(item))
        .map((field) => {
          const node = FIELD_RENDERERS[field.type](binding, field);
          if (field.nested) node.classList.add('is-nested');
          return node;
        });
      return [row, h('div', { class: 'item-fields' }, ...fields)];
    });

    const add = h('button', {
      class: 'btn item-add',
      type: 'button',
      text: `+ Add ${param.itemLabel.toLowerCase()}`,
      disabled: items.length >= param.max,
      onclick: () => {
        updateLayer(layer, () => {
          items.push(param.newItem(items));
          layer.activeItem = items.length - 1;
        });
        renderInspector();
        document.querySelector('.item-add').focus();
      },
    });

    return h('div', { class: 'item-list' }, ...nodes, add);
  }

  function renderParam(layer, param) {
    if (param.type === 'list') return renderList(layer, param);
    return FIELD_RENDERERS[param.type](flatBinding(layer), param);
  }

  function renderPresetControls(layer) {
    const select = $('#presetSelect');
    const remove = $('#presetRemove');
    if (!layer) {
      select.replaceChildren();
      select.disabled = true;
      remove.disabled = true;
      $('#presetAdd').disabled = true;
      return;
    }

    const options = [];
    if (layer.presetKey === null) options.push(h('option', { value: '', text: 'Custom' }));
    (state.presets[layer.effectId] || []).forEach((preset) => {
      options.push(h('option', { value: `b:${preset.id}`, text: preset.name }));
    });
    const mine = userPresets(layer.effectId);
    if (mine.length) {
      options.push(
        h(
          'optgroup',
          { label: 'My presets' },
          ...mine.map((preset) => h('option', { value: `u:${preset.name}`, text: preset.name })),
        ),
      );
    }

    select.replaceChildren(...options);
    select.value = layer.presetKey === null ? '' : layer.presetKey;
    select.disabled = false;
    $('#presetAdd').disabled = false;
    remove.disabled = !(layer.presetKey || '').startsWith('u:');
  }

  function renderInspector() {
    const layer = selectedLayer();
    const container = $('#params');
    renderPresetControls(layer);

    if (!layer) {
      $('#effectName').textContent = 'No filter';
      container.replaceChildren(
        h('p', { class: 'no-selection', text: 'Pick a filter from the gallery to start.' }),
      );
      return;
    }

    const effect = Effects.get(layer.effectId);
    $('#effectName').textContent = effect.name;

    const scrollTop = container.scrollTop;
    container.replaceChildren(
      ...effect.groups.filter((group) => !group.when || group.when(layer.params)).map((group) => {
        const key = `${effect.id}/${group.id}`;
        const collapsed = state.collapsed.has(key);
        const body = h(
          'div',
          { class: 'group-body', hidden: collapsed },
          ...group.params
            .filter((param) => !param.when || param.when(layer.params))
            .map((param) => renderParam(layer, param)),
        );
        const head = h(
          'button',
          {
            class: 'group-head',
            type: 'button',
            'aria-expanded': String(!collapsed),
            onclick: () => {
              const nowCollapsed = !state.collapsed.has(key);
              if (nowCollapsed) state.collapsed.add(key);
              else state.collapsed.delete(key);
              body.hidden = nowCollapsed;
              head.setAttribute('aria-expanded', String(!nowCollapsed));
            },
          },
          h('span', { class: 'eyebrow', text: group.label }),
          h('span', { class: 'group-note', text: group.note ? group.note(layer.params) : '' }),
          h('span', { icon: 'chevron' }),
        );
        return h('div', { class: 'group' }, head, body);
      }),
    );
    container.scrollTop = scrollTop;
  }

  // --- Stack list ---------------------------------------------------------

  function renderStack() {
    const list = $('#stackList');
    if (!state.stack.length) {
      list.replaceChildren(h('li', { class: 'stack-empty', text: 'No filters yet.' }));
      return;
    }
    list.replaceChildren(
      ...state.stack.map((layer) => {
        const effect = Effects.get(layer.effectId);
        const missingMask = effect.requiresMask && !state.hasMask;
        const classes = ['stack-item'];
        if (layer.uid === state.selected) classes.push('selected');
        if (!layer.enabled || missingMask) classes.push('is-off');
        return h(
          'li',
          { class: classes.join(' ') },
          h(
            'button',
            {
              class: 'stack-name',
              type: 'button',
              onclick: () => {
                state.selected = layer.uid;
                refreshAll();
              },
            },
            document.createTextNode(effect.name),
            missingMask ? h('span', { class: 'stack-warn', text: 'needs subject' }) : null,
          ),
          h('button', {
            class: 'row-btn',
            type: 'button',
            'aria-label': `Reset ${effect.name}`,
            icon: 'reset',
            onclick: () => resetLayer(layer),
          }),
          h(
            'button',
            {
              class: 'row-btn',
              type: 'button',
              'aria-label': `Toggle ${effect.name}`,
              'aria-pressed': String(layer.enabled),
              onclick: () => {
                layer.enabled = !layer.enabled;
                refreshAll();
              },
            },
            h('span', { class: 'dot' }),
          ),
          h('button', {
            class: 'row-btn',
            type: 'button',
            'aria-label': `Remove ${effect.name}`,
            icon: 'close',
            onclick: () => removeLayer(layer.uid),
          }),
        );
      }),
    );
  }

  // --- Position handles ---------------------------------------------------

  function handleList(layer) {
    return Effects.params(Effects.get(layer.effectId)).find((param) => param.type === 'list' && param.handle);
  }

  function syncParamInput(key, value) {
    const range = document.querySelector(`[data-param="${key}"]`);
    const number = document.querySelector(`[data-number="${key}"]`);
    if (range) {
      range.value = value;
      setRangeFill(range);
      if (number) number.value = formatNumber(value, Number(range.step));
    }
  }

  function selectItem(layer, index) {
    if (layer.activeItem === index) return;
    layer.activeItem = index;
    renderInspector();
    renderHandles();
  }

  function moveItem(layer, index, x, y) {
    const list = handleList(layer);
    const item = layer.params[list.id][index];
    const fit = (id, value) => {
      const { min, max } = list.fields.find((field) => field.id === id);
      return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
    };
    updateLayer(layer, () => {
      item[list.handle.x] = fit(list.handle.x, x);
      item[list.handle.y] = fit(list.handle.y, y);
    });
    syncParamInput(`${list.id}.${list.handle.x}`, item[list.handle.x]);
    syncParamInput(`${list.id}.${list.handle.y}`, item[list.handle.y]);
  }

  function createHandle() {
    const node = h('button', { class: 'light-handle', type: 'button' });
    const index = () => Number(node.dataset.index);

    node.addEventListener('pointerdown', (event) => {
      node.setPointerCapture(event.pointerId);
      event.preventDefault();
      selectItem(selectedLayer(), index());
    });
    node.addEventListener('pointermove', (event) => {
      if (!node.hasPointerCapture(event.pointerId)) return;
      const rect = $('#frame').getBoundingClientRect();
      moveItem(selectedLayer(), index(), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    });
    node.addEventListener('keydown', (event) => {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      const layer = selectedLayer();
      const list = handleList(layer);
      const item = layer.params[list.id][index()];
      const step = event.shiftKey ? 0.05 : 0.01;
      selectItem(layer, index());
      moveItem(layer, index(), item[list.handle.x] + direction[0] * step, item[list.handle.y] + direction[1] * step);
    });
    return node;
  }

  function renderHandles() {
    const container = $('#handles');
    const layer = selectedLayer();
    const list = layer && isRenderable(layer) && !state.compare ? handleList(layer) : null;
    const items = list ? layer.params[list.id] : [];

    // Handles are reused rather than rebuilt: one may be mid-drag.
    while (container.children.length > items.length) container.lastChild.remove();
    while (container.children.length < items.length) container.append(createHandle());

    // A light may sit outside the frame; its handle stays pinned to the edge.
    const clamp = (value) => Math.min(1, Math.max(0, value));
    items.forEach((item, index) => {
      const node = container.children[index];
      node.dataset.index = index;
      node.style.left = `${clamp(item[list.handle.x]) * 100}%`;
      node.style.top = `${clamp(item[list.handle.y]) * 100}%`;
      node.style.backgroundColor = item[list.swatch];
      node.classList.toggle('is-active', index === layer.activeItem);
      node.classList.toggle('is-off', !item.enabled);
      const tags = list.fields.filter((field) => field.tag && field.tag[itemValue(item, field)]);
      node.classList.toggle('is-tagged', tags.length > 0);
      const suffix = tags.map((field) => `, ${field.tag[itemValue(item, field)].toLowerCase()}`).join('');
      node.setAttribute('aria-label', `Move ${list.itemLabel} ${index + 1}${suffix}`);
    });
  }

  // --- Menu and inline name prompts ---------------------------------------

  let menuAnchor = null;

  function closeMenu(restoreFocus) {
    if ($('#menu').hidden) return;
    $('#menu').hidden = true;
    if (restoreFocus && menuAnchor) menuAnchor.focus();
    menuAnchor = null;
  }

  function openMenu(anchor, items, emptyText) {
    const menu = $('#menu');
    menuAnchor = anchor;
    menu.replaceChildren(
      ...(items.length
        ? items.map((item) =>
            h('button', {
              type: 'button',
              role: 'menuitem',
              text: item.label,
              onclick: () => {
                closeMenu(true);
                item.action();
              },
            }),
          )
        : [h('div', { class: 'menu-empty', text: emptyText })]),
    );
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.right - box.width, window.innerWidth - box.width - 8)}px`;
    menu.style.top = `${Math.max(8, rect.top - box.height - 4)}px`;
    const first = menu.querySelector('button');
    if (first) first.focus();
  }

  function askName(row) {
    const form = $(row);
    const input = form.querySelector('input');
    form.hidden = false;
    input.value = '';
    input.focus();

    return new Promise((resolve) => {
      function finish(value) {
        form.hidden = true;
        form.removeEventListener('submit', onSubmit);
        form.removeEventListener('keydown', onKey);
        cancel.removeEventListener('click', onCancel);
        resolve(value);
      }
      function onSubmit(event) {
        event.preventDefault();
        finish(input.value.trim() || null);
      }
      function onKey(event) {
        if (event.key === 'Escape') finish(null);
      }
      function onCancel() {
        finish(null);
      }
      const cancel = form.querySelector('[data-cancel]');
      form.addEventListener('submit', onSubmit);
      form.addEventListener('keydown', onKey);
      cancel.addEventListener('click', onCancel);
    });
  }

  function saveUserData() {
    Bridge.call('user.save', state.user).catch((error) => setStatus(error.message, true));
  }

  // --- Commands -----------------------------------------------------------

  async function reloadDocument() {
    const { result, bin } = await Bridge.call('doc.snapshot');
    if (result.noDocument) {
      state.doc = null;
      state.hasMask = false;
      $('#frame').hidden = true;
      $('#empty').hidden = false;
      return;
    }
    state.doc = result;
    state.hasMask = false;
    state.zoom = null;
    engine.setPreview({ width: result.previewWidth, height: result.previewHeight, components: 4, data: bin.pixels });
    $('#empty').hidden = true;
    $('#frame').hidden = false;
    applyZoom();
    renderThumbnails();
    refreshAll();
  }

  async function detectSubject() {
    const { result, bin } = await Bridge.call('doc.detectSubject', {
      docId: state.doc.docId,
      previewWidth: state.doc.previewWidth,
      previewHeight: state.doc.previewHeight,
    });
    engine.setMask({ width: result.width, height: result.height, components: 1, data: bin.mask });
    state.hasMask = true;
    renderThumbnails();
    if (!state.stack.length) addLayer('rim-light');
    else refreshAll();
  }

  function layerName() {
    return activeStack()
      .map((layer) => Effects.get(layer.effectId).name)
      .join(' + ');
  }

  async function applyToLayer() {
    const stack = activeStack();
    const { docId } = state.doc;
    setStatus('Reading full image…');
    const { result, bin } = await Bridge.call('doc.full', { docId });

    setStatus('Rendering…');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const mask = bin.mask ? { width: result.width, height: result.height, components: 1, data: bin.mask } : null;
    const pixels = engine.renderFull(
      stack,
      { width: result.width, height: result.height, components: result.components, data: bin.pixels },
      mask,
    );

    setStatus('Writing layer…');
    await Bridge.call('doc.apply', { docId, width: result.width, height: result.height, name: layerName() }, { pixels });
  }

  function bindCommands() {
    $('#reload').addEventListener('click', async () => {
      const loaded = await task('Reading document…', reloadDocument);
      if (loaded && state.doc) await task('Detecting subject…', detectSubject);
    });
    $('#detect').addEventListener('click', () => task('Detecting subject…', detectSubject));
    $('#apply').addEventListener('click', () => task('Applying…', applyToLayer));

    $('#compare').addEventListener('click', () => {
      state.compare = !state.compare;
      $('#compare').setAttribute('aria-pressed', String(state.compare));
      $('#compare').setAttribute('aria-label', state.compare ? 'Show filtered result' : 'Show original');
      renderHandles();
      invalidate();
    });

    $('#zoomIn').addEventListener('click', () => zoomBy(ZOOM_STEP));
    $('#zoomOut').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    $('#zoomFit').addEventListener('click', () => {
      state.zoom = null;
      applyZoom();
    });
    new ResizeObserver(() => {
      if (state.zoom === null) applyZoom();
    }).observe($('#stage'));

    $('#galleryToggle').addEventListener('click', () => {
      const hidden = $('#app').classList.toggle('gallery-hidden');
      $('#galleryToggle').setAttribute('aria-pressed', String(!hidden));
    });

    $('#presetSelect').addEventListener('change', (event) => {
      const layer = selectedLayer();
      const [source, id] = event.target.value.split(/:(.*)/s);
      const preset =
        source === 'b'
          ? builtinPreset(layer.effectId, id)
          : userPresets(layer.effectId).find((item) => item.name === id);
      layer.presetKey = event.target.value;
      layer.params = paramsFromPreset(layer.effectId, preset);
      refreshAll();
    });

    $('#presetAdd').addEventListener('click', async () => {
      const layer = selectedLayer();
      const name = await askName('#presetNameRow');
      if (!name) return;
      const list = userPresets(layer.effectId).filter((preset) => preset.name !== name);
      list.push({ name, params: clone(layer.params) });
      state.user.presets[layer.effectId] = list;
      layer.presetKey = `u:${name}`;
      saveUserData();
      refreshAll();
    });

    $('#presetRemove').addEventListener('click', () => {
      const layer = selectedLayer();
      const name = layer.presetKey.slice(2);
      state.user.presets[layer.effectId] = userPresets(layer.effectId).filter((preset) => preset.name !== name);
      layer.presetKey = null;
      saveUserData();
      refreshAll();
    });

    $('#addFilter').addEventListener('click', (event) => {
      event.stopPropagation();
      openMenu(
        event.currentTarget,
        Effects.list().map((effect) => ({ label: effect.name, action: () => addLayer(effect.id) })),
      );
    });

    $('#stackSave').addEventListener('click', async () => {
      if (!state.stack.length) return;
      const name = await askName('#stackNameRow');
      if (!name) return;
      const others = state.user.stacks.filter((stack) => stack.name !== name);
      others.push({
        name,
        layers: state.stack.map(({ effectId, enabled, params }) => ({ effectId, enabled, params: clone(params) })),
      });
      state.user.stacks = others;
      saveUserData();
      setStatus(`Saved stack “${name}”`);
    });

    $('#stackMenu').addEventListener('click', (event) => {
      event.stopPropagation();
      openMenu(
        event.currentTarget,
        state.user.stacks.map((stack) => ({ label: stack.name, action: () => loadStack(stack) })),
        'No saved stacks',
      );
    });

    document.addEventListener('click', (event) => {
      if (!$('#menu').hidden && !$('#menu').contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu(true);
    });
    $('#menu').addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      const items = Array.from($('#menu').querySelectorAll('button'));
      if (!step || !items.length) return;
      event.preventDefault();
      items[(items.indexOf(document.activeElement) + step + items.length) % items.length].focus();
    });
  }

  function loadStack(saved) {
    state.stack = saved.layers
      .filter((layer) => Effects.get(layer.effectId))
      .map((layer) => ({
        uid: nextUid++,
        effectId: layer.effectId,
        enabled: layer.enabled,
        presetKey: null,
        params: Object.assign(Effects.defaults(Effects.get(layer.effectId)), clone(layer.params)),
      }));
    state.selected = state.stack.length ? state.stack[0].uid : null;
    refreshAll();
  }

  async function loadPresets() {
    await Promise.all(
      Effects.list().map(async (effect) => {
        const { result } = await Bridge.call('presets.get', { effectId: effect.id });
        state.presets[effect.id] = result.presets;
      }),
    );
    const { result } = await Bridge.call('user.load');
    if (result) state.user = { presets: result.presets || {}, stacks: result.stacks || [] };
  }

  async function boot() {
    $('#compare').innerHTML = ICONS.eye;
    $('#reload').innerHTML = ICONS.reload;
    $('#detect').innerHTML = ICONS.person;
    $('#galleryToggle').innerHTML = ICONS.gallery;
    $('#stackMenu').innerHTML = ICONS.caret;

    try {
      engine = new Engine($('#preview'));
    } catch (error) {
      setStatus(error.message, true);
      return;
    }

    buildGallery();
    bindCommands();
    refreshAll();

    Bridge.onProgress(({ done, total }) => {
      if (state.busy && total > 8 * 1024 * 1024) setProgress(done / total);
    });

    const ready = await task('Loading…', loadPresets);
    if (!ready) return;
    const loaded = await task('Reading document…', reloadDocument);
    if (loaded && state.doc) await task('Detecting subject…', detectSubject);
  }

  boot();
})();
