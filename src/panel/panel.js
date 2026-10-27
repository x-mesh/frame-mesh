// 작업실 패널(레이어·속성·변경 목록). 엔진과는 bridge.call(method, ...args)로만 대화하고 상태 스냅샷으로 그린다.
import { PROP_GROUPS, TEXT_PROP, groupTitle, fieldLabel } from '../core/props.js';
import { t } from '../core/i18n.js';
import { isLetterKey } from '../core/keys.js';

const NOTICE_MS = 4000;
const ARROW_DELTAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toHex(value) {
  if (!value) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  const m = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function formatComputed(value) {
  const n = parseFloat(value);
  if (!Number.isNaN(n) && /px$/.test(value)) return String(Math.round(n * 10) / 10);
  return value;
}

export function createPanel({ els, bridge, receiver, keyboard = true }) {
  const receiverStore = receiver || { get: async () => '/handoff', set: async () => {} };
  const view = {
    state: null, selectionId: null, fields: new Map(), treeRows: new Map(), dragId: null, dropRow: null, handoff: null, noticeTimer: 0,
    // 레이어 접기: treeInfo는 행마다 부모와 자식 유무, expanded·collapsed는 사용자가 직접 펼치고 접은 행이다.
    treeInfo: new Map(), expanded: new Set(), collapsed: new Set(), modifiedIds: new Set(),
    // 속성 묶음을 사용자가 직접 펼치거나 접은 기록. 요소를 바꿔도 유지한다.
    groupOverride: new Map(),
  };
  const doc = els.props.ownerDocument;
  // 빈 로그 안내는 CSS ::before가 그리므로 문구를 속성으로 넘긴다.
  if (els.changes) els.changes.dataset.empty = t('panel.changesEmpty');

  function call(method, ...args) {
    return bridge.call(method, ...args).catch((err) => notice(t('panel.cmdFailed', { msg: err.message })));
  }

  function notice(message) {
    if (!els.notice) return;
    els.notice.textContent = message;
    els.notice.hidden = false;
    clearTimeout(view.noticeTimer);
    view.noticeTimer = setTimeout(() => { els.notice.hidden = true; }, NOTICE_MS);
  }

  // ---------- 레이어 트리 ----------
  function renderTree(rows, truncated) {
    if (!els.tree) return;
    els.tree.textContent = '';
    view.treeRows.clear();
    view.treeInfo.clear();
    const frag = doc.createDocumentFragment();
    const stack = [];
    rows.forEach((r, i) => {
      while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].id : null;
      const hasChildren = !!(rows[i + 1] && rows[i + 1].depth > r.depth);
      view.treeInfo.set(r.id, { parent, depth: r.depth, hasChildren });
      stack.push(r);
      const row = doc.createElement('div');
      row.className = 'tree__row';
      row.style.setProperty('--depth', r.depth);
      row.dataset.id = r.id;
      row.dataset.canHold = r.canHold ? '1' : '';
      row.draggable = r.draggable;
      row.innerHTML = `<span class="tree__caret" title="${esc(t('panel.treeToggle'))}"></span><span class="tree__tag">${esc(r.tag)}</span><span class="tree__meta">${esc(r.meta)}</span>`;
      frag.appendChild(row);
      view.treeRows.set(r.id, row);
    });
    if (truncated) {
      const more = doc.createElement('div');
      more.className = 'tree__more';
      more.textContent = t('panel.treeMore', { n: rows.length });
      frag.appendChild(more);
    }
    els.tree.appendChild(frag);
  }

  // 선택한 요소의 조상은 저절로 펼치고, 나머지는 사용자가 펼친 것만 보인다. 접힌 행 안에 바뀐 요소가 있으면 점으로 알린다.
  function applyTreeVisibility() {
    const sel = view.state && view.state.selection;
    const auto = new Set(sel ? sel.crumbs.map((c) => c.id) : []);
    const isOpen = (id, info) => !view.collapsed.has(id) && (info.depth === 0 || auto.has(id) || view.expanded.has(id));
    const insideModified = new Set();
    view.modifiedIds.forEach((id) => {
      for (let cur = view.treeInfo.get(id); cur && cur.parent; cur = view.treeInfo.get(cur.parent)) insideModified.add(cur.parent);
    });
    const visible = new Map();
    for (const [id, row] of view.treeRows) {
      const info = view.treeInfo.get(id);
      const shown = !info.parent || (visible.get(info.parent) && isOpen(info.parent, view.treeInfo.get(info.parent)));
      visible.set(id, shown);
      row.hidden = !shown;
      const open = info.hasChildren && isOpen(id, info);
      row.querySelector('.tree__caret').textContent = info.hasChildren ? (open ? '▾' : '▸') : '';
      row.classList.toggle('is-modified', view.modifiedIds.has(id));
      row.classList.toggle('has-modified', info.hasChildren && !open && insideModified.has(id));
    }
  }

  function toggleTreeRow(id) {
    const info = view.treeInfo.get(id);
    if (!info || !info.hasChildren) return;
    const sel = view.state && view.state.selection;
    const auto = sel && sel.crumbs.some((c) => c.id === id);
    const open = !view.collapsed.has(id) && (info.depth === 0 || auto || view.expanded.has(id));
    if (open) {
      view.expanded.delete(id);
      view.collapsed.add(id);
    } else {
      view.collapsed.delete(id);
      view.expanded.add(id);
    }
    applyTreeVisibility();
  }

  function highlightTreeRow() {
    for (const [id, row] of view.treeRows) {
      const on = id === view.selectionId;
      row.classList.toggle('is-selected', on);
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
  }

  const rowFromEvent = (e) => (e.target && typeof e.target.closest === 'function' ? e.target.closest('.tree__row') : null);

  function dropZone(row, e) {
    const rect = row.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (!row.dataset.canHold) return y < 0.5 ? 'before' : 'after';
    if (y < 0.25) return 'before';
    if (y > 0.75) return 'after';
    return 'inside';
  }

  function clearDropRow() {
    if (view.dropRow) view.dropRow.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
    view.dropRow = null;
  }

  function installTreeEvents() {
    els.tree.addEventListener('click', (e) => {
      const row = rowFromEvent(e);
      if (!row) return;
      if (e.target.closest('.tree__caret')) {
        toggleTreeRow(row.dataset.id);
        return;
      }
      call('select', row.dataset.id);
    });
    els.tree.addEventListener('dragstart', (e) => {
      const row = rowFromEvent(e);
      if (!row || !row.draggable) {
        e.preventDefault();
        return;
      }
      view.dragId = row.dataset.id;
      row.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
    });
    els.tree.addEventListener('dragover', (e) => {
      const row = rowFromEvent(e);
      if (!row || !view.dragId || row.dataset.id === view.dragId) {
        clearDropRow();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const zone = dropZone(row, e);
      if (view.dropRow !== row) clearDropRow();
      view.dropRow = row;
      row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
      row.classList.add(`is-drop-${zone}`);
      row.dataset.zone = zone;
    });
    els.tree.addEventListener('dragleave', (e) => {
      if (rowFromEvent(e) === view.dropRow && !els.tree.contains(e.relatedTarget)) clearDropRow();
    });
    els.tree.addEventListener('drop', async (e) => {
      e.preventDefault();
      const row = rowFromEvent(e);
      const dragId = view.dragId;
      clearDropRow();
      if (!row || !dragId) return;
      await call('requestMove', dragId, row.dataset.id, row.dataset.zone || dropZone(row, e));
      call('select', dragId);
    });
    els.tree.addEventListener('dragend', () => {
      const row = view.treeRows.get(view.dragId);
      if (row) row.classList.remove('is-dragging');
      view.dragId = null;
      clearDropRow();
    });
  }

  // ---------- 속성 패널 ----------
  function section(title) {
    const wrap = doc.createElement('div');
    wrap.className = 'props__section';
    if (title) {
      const head = doc.createElement('div');
      head.className = 'props__section-title';
      head.innerHTML = `<span>${esc(title)}</span>`;
      wrap.appendChild(head);
    }
    return wrap;
  }

  function actionButton(label, onClick, title) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function createField(def) {
    const wrap = doc.createElement('label');
    wrap.className = 'field';
    const label = doc.createElement('span');
    label.className = 'field__label';
    label.textContent = fieldLabel(def);
    label.title = def.prop;
    let input;
    if (def.kind === 'font') {
      input = doc.createElement('select');
      input.append(new Option(t('panel.default'), ''));
      const fonts = [...((view.state && view.state.fonts) || []), 'system-ui', 'sans-serif', 'serif', 'monospace'];
      [...new Set(fonts)].forEach((f) => {
        const label = f.split(',')[0].replace(/["']/g, '').trim();
        const opt = new Option(label, f);
        opt.title = f;
        input.append(opt);
      });
    } else if (def.kind === 'select') {
      input = doc.createElement('select');
      input.append(new Option(t('panel.default'), ''));
      def.options.forEach((o) => input.append(new Option(o, o)));
    } else if (def.kind === 'color') {
      input = doc.createElement('input');
      input.type = 'color';
    } else {
      input = doc.createElement('input');
      input.type = def.kind === 'px' ? 'number' : 'text';
      if (def.kind === 'px') input.step = '1';
    }
    const dot = doc.createElement('span');
    dot.className = 'field__dot';
    const reset = doc.createElement('button');
    reset.type = 'button';
    reset.className = 'field__reset';
    reset.textContent = '×';
    reset.title = t('panel.resetField');
    wrap.append(label, input, dot, reset);
    let valueLine = null;
    if (def.kind === 'color') {
      valueLine = doc.createElement('span');
      valueLine.className = 'field__value';
      wrap.appendChild(valueLine);
    }
    if (def.scale) {
      // 페이지가 쓰는 글자 크기를 단계로 보여 주고, 누르면 그 값으로 맞춘다.
      const chips = doc.createElement('div');
      chips.className = 'scale';
      ((view.state && view.state.typeScale) || []).forEach((size) => {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'scale__chip';
        chip.textContent = String(size);
        chip.dataset.size = String(size);
        chip.title = t('panel.scaleChip', { size });
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          if (view.selectionId) call('setStyle', view.selectionId, 'font-size', `${size}px`);
        });
        chips.appendChild(chip);
      });
      if (chips.children.length) wrap.appendChild(chips);
    }
    input.addEventListener('input', () => {
      if (!view.selectionId) return;
      const raw = input.value;
      call('setStyle', view.selectionId, def.prop, def.kind === 'px' ? (raw === '' ? '' : `${raw}px`) : raw);
    });
    if (def.kind === 'px') input.addEventListener('keydown', (e) => stepByKey(e, input));
    reset.addEventListener('click', (e) => {
      e.preventDefault();
      call('setStyle', view.selectionId, def.prop, '');
    });
    view.fields.set(def.prop, { def, input, wrap, valueLine });
    return wrap;
  }

  // Shift+방향키는 10px 단위로 조정한다.
  function stepByKey(e, input) {
    if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const base = input.value === '' ? parseFloat(input.placeholder) || 0 : parseFloat(input.value) || 0;
    input.value = String(base + (e.key === 'ArrowUp' ? 10 : -10));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const PROP_LABELS = new Map(PROP_GROUPS.flatMap((g) => g.fields.map((f) => [f.prop, `${groupTitle(g)} · ${fieldLabel(f)}`])));
  const showValue = (v) => (v === '' || v == null ? t('panel.none') : formatComputed(String(v)));
  const quoted = (snippet) => {
    const m = /"(.*)"$/.exec(snippet || '');
    return m ? m[1] : '';
  };

  // 안에 링크나 강조가 섞여 있어도 글자가 중심인 태그.
  const TEXT_TAGS = /^(h[1-6]|p|a|span|label|button|strong|em|b|i|small|figcaption)$/;

  // 요소 종류에 따라 처음 펼칠 속성 묶음. 사용자가 직접 펼치거나 접은 묶음은 그 선택을 따른다.
  function groupOpen(key, sel) {
    if (view.groupOverride.has(key)) return view.groupOverride.get(key);
    const group = PROP_GROUPS.find((g) => g.key === key);
    if (group.fields.some((f) => (sel.fields[f.prop] || {}).inline)) return true;
    // 빈 공간 경고는 최소 높이 때문이므로 크기 묶음을 함께 펼친다.
    if (key === 'size' && sel.hint) return true;
    const tag = sel.crumbs.length ? sel.crumbs[sel.crumbs.length - 1].tag : '';
    return sel.editable || TEXT_TAGS.test(tag) ? ['text', 'color'].includes(key) : ['size', 'padding', 'margin', 'layout'].includes(key);
  }

  function rebuildSelection(sel) {
    const root = els.props;
    root.textContent = '';
    view.fields.clear();

    // 머리글은 스크롤해도 위에 남아, 지금 무엇을 편집하는지 늘 보이게 한다.
    const head = doc.createElement('div');
    head.className = 'props__head';
    head.innerHTML = '<div class="props__head-row"><span class="props__title" data-role="title"></span><span class="props__badge" data-role="modCount" hidden></span><span class="props__head-actions" data-role="headActions"></span></div><div class="props__snippet" data-role="snippet"></div><div class="props__dims" data-role="dims"></div>';
    const crumbs = doc.createElement('div');
    crumbs.className = 'crumbs';
    sel.crumbs.forEach((node, i) => {
      if (i) crumbs.appendChild(Object.assign(doc.createElement('span'), { textContent: '›' }));
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = node.tag;
      b.title = node.label;
      b.classList.toggle('is-current', node.id === sel.id);
      b.addEventListener('click', () => call('select', node.id));
      crumbs.appendChild(b);
    });
    head.appendChild(crumbs);
    const parentBtn = actionButton(t('panel.parent'), () => call('selectParent'), t('panel.parentTitle'));
    const clearBtn = actionButton('✕', () => call('select', null), t('panel.clearTitle'));
    parentBtn.disabled = !sel.parent;
    head.querySelector('[data-role="headActions"]').append(parentBtn, clearBtn);
    const hint = doc.createElement('div');
    hint.className = 'props__hint';
    hint.dataset.role = 'hint';
    hint.hidden = true;
    head.appendChild(hint);
    root.appendChild(head);
    // 경로는 한 줄로 두고 끝(현재 요소)이 보이게 맨 오른쪽으로 민다.
    requestAnimationFrame(() => { crumbs.scrollLeft = crumbs.scrollWidth; });

    const changes = section(t('panel.changed'));
    changes.classList.add('props__changes');
    changes.dataset.role = 'changes';
    changes.appendChild(Object.assign(doc.createElement('div'), { className: 'change-list' }));
    root.appendChild(changes);

    const struct = section(t('panel.structure'));
    if (sel.parent) {
      const info = doc.createElement('div');
      info.className = 'props__parent';
      info.textContent = t('panel.parentInfo', { label: sel.parent.label, flow: sel.parent.flow });
      struct.appendChild(info);
    }
    const row = doc.createElement('div');
    row.className = 'actions-row';
    row.append(
      actionButton(t('panel.forward'), () => call('moveWithin', -1), t('panel.forwardTitle')),
      actionButton(t('panel.back'), () => call('moveWithin', 1), t('panel.backTitle')),
    );
    const pushRight = actionButton(t('panel.pushRight'), () => call('togglePushRight'), t('panel.pushRightTitle'));
    pushRight.dataset.role = 'pushRight';
    row.appendChild(pushRight);
    if (sel.editable) {
      const edit = actionButton(t('panel.editText'), () => call('editText', sel.id), t('panel.editTextTitle'));
      edit.dataset.role = 'editText';
      row.appendChild(edit);
    }
    struct.appendChild(row);
    root.appendChild(struct);

    PROP_GROUPS.forEach((group) => {
      const sec = doc.createElement('div');
      sec.className = 'props__section props__group';
      sec.dataset.group = group.key;
      const title = doc.createElement('button');
      title.type = 'button';
      title.className = 'props__section-title props__group-title';
      title.innerHTML = `<span><span class="props__caret"></span>${esc(groupTitle(group))}</span><span class="props__group-count" data-role="count"></span>`;
      const grid = doc.createElement('div');
      grid.className = `fields${group.single ? ' fields--single' : ''}`;
      group.fields.forEach((def) => grid.appendChild(createField(def)));
      const setOpen = (open) => {
        sec.classList.toggle('is-collapsed', !open);
        title.querySelector('.props__caret').textContent = open ? '▾' : '▸';
      };
      title.addEventListener('click', () => {
        const open = sec.classList.contains('is-collapsed');
        view.groupOverride.set(group.key, open);
        setOpen(open);
      });
      setOpen(groupOpen(group.key, sel));
      sec.append(title, grid);
      root.appendChild(sec);
    });
    const note = doc.createElement('p');
    note.className = 'props__note';
    note.textContent = t('panel.note');
    root.appendChild(note);
  }

  function renderChangeList(sel) {
    const sec = els.props.querySelector('[data-role="changes"]');
    const list = sec.querySelector('.change-list');
    list.textContent = '';
    sec.hidden = !sel.changes.length;
    sec.querySelector('.props__section-title span').textContent = t('panel.changedN', { n: sel.changes.length });
    sel.changes.forEach((c) => {
      const item = doc.createElement('div');
      item.className = 'change-item';
      const label = Object.assign(doc.createElement('span'), { className: 'change-item__label', textContent: c.prop === TEXT_PROP ? t('op.textLabel') : PROP_LABELS.get(c.prop) || c.prop });
      label.title = c.prop;
      const values = doc.createElement('span');
      values.className = 'change-item__values';
      values.append(
        Object.assign(doc.createElement('span'), { className: 'change-item__before', textContent: showValue(c.before) }),
        Object.assign(doc.createElement('span'), { className: 'change-item__arrow', textContent: '→' }),
        Object.assign(doc.createElement('span'), { className: 'change-item__after', textContent: showValue(c.after) }),
      );
      values.title = `${showValue(c.before)} → ${showValue(c.after)}`;
      item.append(label, values);
      // 문구는 되돌릴 API가 없어 로그의 되돌리기를 쓴다.
      if (c.prop !== TEXT_PROP) {
        const undo = Object.assign(doc.createElement('button'), { type: 'button', className: 'change-item__undo', textContent: '↺', title: t('panel.undoOne') });
        undo.addEventListener('click', () => call('setStyle', sel.id, c.prop, c.beforeInline));
        item.appendChild(undo);
      }
      list.appendChild(item);
    });
  }

  function refreshSelection(sel) {
    const root = els.props;
    root.querySelector('[data-role="title"]').textContent = sel.label;
    const snippet = root.querySelector('[data-role="snippet"]');
    snippet.textContent = quoted(sel.snippet) ? `“${quoted(sel.snippet)}”` : '';
    snippet.hidden = !snippet.textContent;
    root.querySelector('[data-role="dims"]').textContent = `${sel.dims} · x ${sel.x} · y ${sel.y}`;
    const badge = root.querySelector('[data-role="modCount"]');
    badge.hidden = !sel.changes.length;
    badge.textContent = t('panel.modN', { n: sel.changes.length });
    const hint = root.querySelector('[data-role="hint"]');
    hint.hidden = !sel.hint;
    hint.textContent = sel.hint || '';
    renderChangeList(sel);
    const pushRight = root.querySelector('[data-role="pushRight"]');
    if (pushRight) pushRight.classList.toggle('is-active', sel.pushRight);
    const editBtn = root.querySelector('[data-role="editText"]');
    if (editBtn) {
      editBtn.classList.toggle('is-active', !!sel.editing);
      editBtn.textContent = sel.editing ? t('panel.editing') : t('panel.editText');
    }
    root.querySelectorAll('.props__group').forEach((sec) => {
      const group = PROP_GROUPS.find((g) => g.key === sec.dataset.group);
      const n = group.fields.filter((f) => (sel.fields[f.prop] || {}).inline).length;
      sec.querySelector('[data-role="count"]').textContent = n ? t('panel.modN', { n }) : '';
      sec.classList.toggle('has-modified', n > 0);
    });
    for (const { def, input, wrap, valueLine } of view.fields.values()) {
      const { inline, computed } = sel.fields[def.prop] || { inline: '', computed: '' };
      if (def.scale) {
        const cur = Math.round(parseFloat(computed) * 10) / 10;
        wrap.querySelectorAll('.scale__chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.size) === cur));
      }
      const modified = inline !== '';
      wrap.classList.toggle('is-modified', modified);
      if (valueLine) valueLine.textContent = modified ? t('panel.computed', { inline, computed }) : computed;
      if (doc.activeElement === input) continue;
      if (def.kind === 'px') {
        const n = parseFloat(inline);
        input.value = modified && !Number.isNaN(n) ? String(n) : '';
        input.placeholder = modified && Number.isNaN(n) ? inline : formatComputed(computed);
      } else if (def.kind === 'color') {
        input.value = toHex(inline) || toHex(computed) || '#000000';
      } else if (def.kind === 'font') {
        input.options[0].textContent = t('panel.defaultOf', { v: computed.split(',')[0].replace(/["']/g, '').trim() });
        if (modified && !Array.from(input.options).some((o) => o.value === inline)) input.append(new Option(inline.split(',')[0].replace(/["']/g, ''), inline));
        input.value = modified ? inline : '';
      } else if (def.kind === 'select') {
        input.options[0].textContent = t('panel.defaultOf', { v: computed });
        input.value = modified && Array.from(input.options).some((o) => o.value === inline) ? inline : '';
      } else {
        input.value = inline;
        input.placeholder = computed;
      }
    }
  }

  const EMPTY_KEYS = ['click', 'dbl', 'cmd', 'right', 'drag', 'arrows', 'e', 'space'];

  function renderSelection(sel) {
    if (!sel) {
      view.selectionId = null;
      view.fields.clear();
      els.props.textContent = '';
      const wrap = Object.assign(doc.createElement('div'), { className: 'props__empty' });
      wrap.appendChild(Object.assign(doc.createElement('p'), { className: 'props__empty-title', textContent: t('panel.emptyTitle') }));
      const list = Object.assign(doc.createElement('dl'), { className: 'keys' });
      EMPTY_KEYS.forEach((k) => list.append(Object.assign(doc.createElement('dt'), { textContent: t(`keys.${k}`) }), Object.assign(doc.createElement('dd'), { textContent: t(`keys.${k}Desc`) })));
      wrap.appendChild(list);
      els.props.appendChild(wrap);
      return;
    }
    if (sel.id !== view.selectionId) {
      view.selectionId = sel.id;
      rebuildSelection(sel);
    }
    refreshSelection(sel);
  }

  // ---------- 변경 목록 ----------
  function renderChanges(state) {
    if (!els.changes) return;
    els.changes.textContent = '';
    state.changes.forEach((c) => {
      const li = doc.createElement('li');
      li.className = `change${c.undone ? ' is-undone' : ''}`;
      li.title = c.undone ? t('panel.redoTo') : t('panel.keepTo');
      const time = c.at ? new Date(c.at).toTimeString().slice(0, 8) : '';
      if (c.lost) li.classList.add('change--lost');
      const flag = c.lost ? t('panel.restoreFailed') : c.restored ? t('panel.restored') : '';
      li.innerHTML = `<span class="change__n">${c.n}</span><span class="change__time">${time}</span><span class="change__target">${esc(c.label)}</span><span class="change__desc">${esc(c.desc)}${flag ? ` <span class="change__flag">${flag}</span>` : ''}</span><span class="change__vp">${esc(c.vp)}</span>`;
      li.addEventListener('click', () => call('goto', c.n));
      els.changes.appendChild(li);
    });
    if (els.changeCount) els.changeCount.textContent = !state.total ? '' : state.cursor === state.total ? String(state.total) : `${state.cursor}/${state.total}`;
  }

  // ---------- 변경 요약 (diff) ----------
  function renderDiff(state) {
    if (!els.diff) return;
    els.diff.textContent = '';
    const diff = state.diff || [];
    if (!diff.length) {
      els.diff.appendChild(Object.assign(doc.createElement('p'), { className: 'diff__empty', textContent: t('panel.diffEmpty') }));
      return;
    }
    diff.forEach((d) => {
      const block = doc.createElement('div');
      block.className = 'diff__block';
      const head = doc.createElement('button');
      head.type = 'button';
      head.className = 'diff__head';
      head.title = t('panel.selectThis');
      head.textContent = `${d.label}  ${d.currentPath || d.path}`;
      head.addEventListener('click', () => call('select', d.id));
      block.appendChild(head);
      d.lines.forEach((l) => {
        const line = doc.createElement('div');
        line.className = `diff__line diff__line--${l.sign === '+' ? 'add' : 'del'}`;
        line.textContent = `${l.sign} ${l.text}`;
        block.appendChild(line);
      });
      els.diff.appendChild(block);
    });
  }

  // ---------- 모드와 버튼 ----------
  function installControls() {
    if (els.modeToggle) {
      els.modeToggle.addEventListener('click', () => {
        if (view.state) call('setMode', view.state.mode === 'select' ? 'interact' : 'select');
      });
    }
    if (els.modeSeg) {
      els.modeSeg.addEventListener('click', (e) => {
        const b = e.target.closest('.seg__btn');
        if (b) call('setMode', b.dataset.mode);
      });
    }
    if (els.moveToggle) {
      els.moveToggle.addEventListener('click', () => call('setMoveMode', view.state && view.state.moveMode === 'free' ? 'flow' : 'free'));
    }
    if (els.btnMeasure) els.btnMeasure.addEventListener('click', () => call('setMeasure', !(view.state && view.state.measure)));
    if (els.btnXray) els.btnXray.addEventListener('click', () => call('setXray', !(view.state && view.state.xray)));
    if (els.btnFocus) els.btnFocus.addEventListener('click', () => call('setFocus', !(view.state && view.state.focus)));
    if (els.btnPeek) els.btnPeek.addEventListener('click', () => call('setPeek', !(view.state && view.state.peek)));
    if (els.btnDiffView) els.btnDiffView.addEventListener('click', () => call('setDiffView', !(view.state && view.state.diffView)));
    if (els.btnUndo) els.btnUndo.addEventListener('click', () => call('undo'));
    if (els.btnRedo) els.btnRedo.addEventListener('click', () => call('redo'));
    if (els.btnReset) els.btnReset.addEventListener('click', () => call('goto', 0));
    if (els.btnHandoff) els.btnHandoff.addEventListener('click', openHandoff);
    if (els.btnCopyLog) els.btnCopyLog.addEventListener('click', copyLogForLlm);
    if (els.btnSendLog) els.btnSendLog.addEventListener('click', sendToProject);
    if (els.btnClearLog) els.btnClearLog.addEventListener('click', clearLog);
    const h = els.handoff;
    if (h) {
      h.btnCopy.addEventListener('click', copyHandoff);
      h.btnMd.addEventListener('click', () => downloadText(handoffFileName('md'), view.handoff.markdown, 'text/markdown'));
      h.btnJson.addEventListener('click', () => downloadText(handoffFileName('json'), JSON.stringify(view.handoff.json, null, 2), 'application/json'));
      h.btnClose.addEventListener('click', () => h.dialog.close());
      if (h.receiverInput) {
        receiverStore.get().then((url) => { h.receiverInput.value = url; });
        h.receiverInput.addEventListener('change', () => receiverStore.set(h.receiverInput.value.trim()));
      }
    }
    if (keyboard) {
      doc.addEventListener('keydown', onKeydown);
      doc.addEventListener('keyup', onKeyup);
    }
  }

  function syncControls(state) {
    if (els.btnMeasure) els.btnMeasure.classList.toggle('is-active', !!state.measure);
    if (els.btnXray) els.btnXray.classList.toggle('is-active', !!state.xray);
    if (els.btnFocus) els.btnFocus.classList.toggle('is-active', !!state.focus);
    if (els.btnDiffView) {
      els.btnDiffView.classList.toggle('is-active', !!state.diffView);
      els.btnDiffView.disabled = !state.diffView && !state.applied;
    }
    if (els.btnPeek) {
      els.btnPeek.classList.toggle('is-active', !!state.peek);
      els.btnPeek.disabled = !state.peek && !state.applied;
      els.btnPeek.textContent = state.peek ? t('panel.peekBack') : t('panel.peek');
    }
    if (els.btnUndo) els.btnUndo.disabled = !state.canUndo;
    if (els.btnRedo) els.btnRedo.disabled = !state.canRedo;
    if (els.btnReset) els.btnReset.disabled = !state.canUndo;
    if (els.modeToggle) {
      els.modeToggle.setAttribute('aria-checked', String(state.mode === 'select'));
      els.modeLabel.textContent = state.mode === 'select' ? t('mode.editing') : state.holding ? t('mode.holding') : t('mode.using');
    }
    if (els.modeSeg) els.modeSeg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === state.mode));
    if (els.moveToggle) els.moveToggle.setAttribute('aria-checked', String(state.moveMode === 'free'));
  }

  // ---------- LLM 전달 ----------
  async function openHandoff() {
    const h = els.handoff;
    if (!h) return;
    let result;
    try {
      result = await bridge.call('getHandoff');
    } catch (err) {
      notice(t('panel.handoffFailed', { msg: err.message }));
      return;
    }
    view.handoff = result;
    h.text.value = result.markdown;
    const applied = view.state ? view.state.cursor : 0;
    h.summary.textContent = t('panel.handoffSummary', { n: applied, kb: Math.round(result.markdown.length / 1024), mode: result.json.htmlMode === 'full' ? t('panel.htmlFull') : t('panel.htmlChanged') });
    h.dialog.showModal();
  }

  async function copyHandoff() {
    try {
      await navigator.clipboard.writeText(view.handoff.markdown);
      notice(t('panel.copied'));
    } catch (err) {
      els.handoff.text.focus();
      els.handoff.text.select();
      notice(t('panel.copyFailed', { msg: err.message }));
    }
  }

  // 대화상자 없이 변경 로그·요청·결과 HTML 묶음을 바로 복사한다.
  async function copyLogForLlm() {
    let result;
    try {
      result = await bridge.call('getHandoff');
    } catch (err) {
      notice(t('panel.handoffFailed', { msg: err.message }));
      return;
    }
    view.handoff = result;
    const applied = view.state ? view.state.cursor : 0;
    try {
      await navigator.clipboard.writeText(result.markdown);
      notice(t('panel.copiedLlm', { n: applied }));
    } catch (err) {
      notice(t('panel.copyFailedLlm', { msg: err.message }));
    }
  }

  // 전달 묶음을 개발 서버(POST /handoff)로 보내 프로젝트의 handoffs/ 에 파일로 남긴다.
  async function sendToProject() {
    const url = await receiverStore.get();
    let result;
    try {
      result = await bridge.call('getHandoff');
    } catch (err) {
      notice(t('panel.handoffFailed', { msg: err.message }));
      return;
    }
    view.handoff = result;
    try {
      const payload = { source: result.json.source, markdown: result.markdown, json: result.json };
      // 확장 도크는 페이지 출처로 요청하면 개발 서버가 막으므로, 호스트가 준 전송 함수(사이드 패널 경유)를 쓴다.
      let body;
      if (receiverStore.post) {
        body = await receiverStore.post(payload);
      } else {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      }
      if (!body || !body.ok) throw new Error((body && body.error) || t('panel.saveFailed'));
      notice(t('panel.saved', { files: body.files.join(', ') }));
    } catch (err) {
      notice(t('panel.sendFailed', { url, msg: err.message }));
    }
  }

  async function clearLog() {
    const total = view.state ? view.state.total : 0;
    if (!total) return;
    if (!window.confirm(t('panel.clearConfirm', { n: total }))) return;
    await call('clearLog');
    notice(t('panel.cleared'));
  }

  function downloadText(name, content, type) {
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const handoffFileName = (ext) => `frame-mesh-handoff-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;

  // ---------- 키보드 (패널 문서) ----------
  const isEditable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

  function onKeyup(e) {
    if (e.key === ' ' && spaceHeld) {
      spaceHeld = false;
      e.preventDefault();
      call('holdInteract', false);
    }
  }

  // 웹 작업실에서는 초점이 미리보기 바깥에 있어 엔진이 키를 받지 못하므로, 같은 모드 단축키를 여기서도 받는다.
  let spaceHeld = false;
  function onKeydown(e) {
    // 전달 대화상자가 열린 동안 단축키가 뒤의 문서를 바꾸면 대화상자 내용과 어긋난다.
    if (els.handoff && els.handoff.dialog.open) return;
    const mod = e.metaKey || e.ctrlKey;
    const plain = !mod && !e.altKey && !e.isComposing && !isEditable(e.target);
    if (e.key === ' ' && spaceHeld) {
      e.preventDefault();
      return;
    }
    if (plain && isLetterKey(e, 'e') && !e.shiftKey && !e.repeat && view.state) {
      e.preventDefault();
      call('setMode', view.state.mode === 'select' ? 'interact' : 'select');
      return;
    }
    if (plain && e.key === ' ' && !e.repeat && view.state && view.state.mode === 'select') {
      e.preventDefault();
      spaceHeld = true;
      call('holdInteract', true);
      return;
    }
    if (mod && isLetterKey(e, 'z')) {
      e.preventDefault();
      // 입력 중인 필드는 갱신을 건너뛰므로, 되돌리기 전에 포커스를 풀어 값이 갱신되게 한다.
      if (isEditable(e.target)) e.target.blur();
      call(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (isEditable(e.target)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      call('select', null);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && view.selectionId) {
      e.preventDefault();
      call('selectParent');
      return;
    }
    if (e.key === 'Enter' && !mod && view.state && view.state.selection && view.state.selection.editable) {
      e.preventDefault();
      call('editText', view.selectionId);
      return;
    }
    if (ARROW_DELTAS[e.key] && view.selectionId && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = ARROW_DELTAS[e.key];
      call('nudge', dx * step, dy * step);
    }
  }

  // ---------- 갱신 ----------
  function update(state) {
    view.state = state;
    if (state.tree && els.tree) renderTree(state.tree, state.treeTruncated);
    view.modifiedIds = new Set((state.diff || []).map((d) => d.id));
    renderSelection(state.selection);
    if (els.tree) applyTreeVisibility();
    highlightTreeRow();
    renderChanges(state);
    renderDiff(state);
    syncControls(state);
  }

  function clear() {
    view.state = null;
    view.selectionId = null;
    if (els.tree) els.tree.textContent = '';
    view.treeRows.clear();
    renderSelection(null);
    if (els.changes) els.changes.textContent = '';
    if (els.changeCount) els.changeCount.textContent = '';
  }

  if (els.tree) installTreeEvents();
  installControls();
  renderSelection(null);
  return { update, clear, notice, openHandoff, copyLogForLlm, sendToProject };
}
