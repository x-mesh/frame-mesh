// 작업실 패널(레이어·속성·변경 목록). 엔진과는 bridge.call(method, ...args)로만 대화하고 상태 스냅샷으로 그린다.
import { PROP_GROUPS } from '../core/props.js';

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
  const view = { state: null, selectionId: null, fields: new Map(), treeRows: new Map(), dragId: null, dropRow: null, handoff: null, noticeTimer: 0 };
  const doc = els.props.ownerDocument;

  function call(method, ...args) {
    return bridge.call(method, ...args).catch((err) => notice(`명령 실패: ${err.message}`));
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
    const frag = doc.createDocumentFragment();
    rows.forEach((r) => {
      const row = doc.createElement('div');
      row.className = 'tree__row';
      row.style.setProperty('--depth', r.depth);
      row.dataset.id = r.id;
      row.dataset.canHold = r.canHold ? '1' : '';
      row.draggable = r.draggable;
      row.innerHTML = `<span class="tree__tag">${esc(r.tag)}</span><span class="tree__meta">${esc(r.meta)}</span>`;
      frag.appendChild(row);
      view.treeRows.set(r.id, row);
    });
    if (truncated) {
      const more = doc.createElement('div');
      more.className = 'tree__more';
      more.textContent = `레이어가 많아 ${rows.length}개까지만 표시합니다. 나머지는 미리보기에서 직접 선택하세요.`;
      frag.appendChild(more);
    }
    els.tree.appendChild(frag);
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
      if (row) call('select', row.dataset.id);
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
    label.textContent = def.label;
    label.title = def.prop;
    let input;
    if (def.kind === 'font') {
      input = doc.createElement('select');
      input.append(new Option('기본', ''));
      const fonts = [...((view.state && view.state.fonts) || []), 'system-ui', 'sans-serif', 'serif', 'monospace'];
      [...new Set(fonts)].forEach((f) => {
        const label = f.split(',')[0].replace(/["']/g, '').trim();
        const opt = new Option(label, f);
        opt.title = f;
        input.append(opt);
      });
    } else if (def.kind === 'select') {
      input = doc.createElement('select');
      input.append(new Option('기본', ''));
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
    reset.title = '기본값으로 되돌리기';
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
        chip.title = `글자 크기 ${size}px (이 페이지에서 쓰는 크기)`;
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

  function rebuildSelection(sel) {
    const root = els.props;
    root.textContent = '';
    view.fields.clear();
    const head = section(null);
    head.innerHTML = '<div class="props__title" data-role="title"></div><div class="props__dims" data-role="dims"></div>';
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
    const hint = doc.createElement('div');
    hint.className = 'props__hint';
    hint.dataset.role = 'hint';
    hint.hidden = true;
    head.appendChild(hint);
    root.appendChild(head);

    const struct = section('구조');
    if (sel.parent) {
      const info = doc.createElement('div');
      info.className = 'props__parent';
      info.textContent = `부모 ${sel.parent.label} (${sel.parent.flow})`;
      struct.appendChild(info);
    }
    const row = doc.createElement('div');
    row.className = 'actions-row';
    row.append(
      actionButton('부모 선택', () => call('selectParent'), '⇧Enter'),
      actionButton('▲ 앞으로', () => call('moveWithin', -1), '같은 컨테이너 안에서 한 칸 앞으로'),
      actionButton('▼ 뒤로', () => call('moveWithin', 1), '같은 컨테이너 안에서 한 칸 뒤로'),
    );
    const pushRight = actionButton('오른쪽 밀기', () => call('togglePushRight'), 'margin-left: auto 켜기·끄기');
    pushRight.dataset.role = 'pushRight';
    row.appendChild(pushRight);
    if (sel.editable) {
      const edit = actionButton('문구 편집', () => call('editText', sel.id), '페이지에서 바로 글을 고칩니다. Enter로 확정, Esc로 취소 (선택한 글자를 더블클릭해도 됩니다)');
      edit.dataset.role = 'editText';
      row.appendChild(edit);
    }
    struct.appendChild(row);
    root.appendChild(struct);

    PROP_GROUPS.forEach((group) => {
      const sec = section(group.title);
      const grid = doc.createElement('div');
      grid.className = `fields${group.single ? ' fields--single' : ''}`;
      group.fields.forEach((def) => grid.appendChild(createField(def)));
      sec.appendChild(grid);
      root.appendChild(sec);
    });
    const note = doc.createElement('p');
    note.className = 'props__note';
    note.textContent = '값은 요소의 인라인 스타일로 들어가며 모든 뷰포트에 똑같이 적용됩니다. 원본 CSS에 반영하려면 변경 로그를 LLM에 전달합니다.';
    root.appendChild(note);
  }

  function refreshSelection(sel) {
    const root = els.props;
    root.querySelector('[data-role="title"]').textContent = sel.label;
    root.querySelector('[data-role="dims"]').textContent = `${sel.dims} · x ${sel.x} · y ${sel.y} · ${sel.id}`;
    const hint = root.querySelector('[data-role="hint"]');
    hint.hidden = !sel.hint;
    hint.textContent = sel.hint || '';
    const pushRight = root.querySelector('[data-role="pushRight"]');
    if (pushRight) pushRight.classList.toggle('is-active', sel.pushRight);
    const editBtn = root.querySelector('[data-role="editText"]');
    if (editBtn) {
      editBtn.classList.toggle('is-active', !!sel.editing);
      editBtn.textContent = sel.editing ? '편집 중 · Enter 확정' : '문구 편집';
    }
    for (const { def, input, wrap, valueLine } of view.fields.values()) {
      const { inline, computed } = sel.fields[def.prop] || { inline: '', computed: '' };
      if (def.scale) {
        const cur = Math.round(parseFloat(computed) * 10) / 10;
        wrap.querySelectorAll('.scale__chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.size) === cur));
      }
      const modified = inline !== '';
      wrap.classList.toggle('is-modified', modified);
      if (valueLine) valueLine.textContent = modified ? `${inline} (계산값 ${computed})` : computed;
      if (doc.activeElement === input) continue;
      if (def.kind === 'px') {
        const n = parseFloat(inline);
        input.value = modified && !Number.isNaN(n) ? String(n) : '';
        input.placeholder = modified && Number.isNaN(n) ? inline : formatComputed(computed);
      } else if (def.kind === 'color') {
        input.value = toHex(inline) || toHex(computed) || '#000000';
      } else if (def.kind === 'font') {
        input.options[0].textContent = `기본 (${computed.split(',')[0].replace(/["']/g, '').trim()})`;
        if (modified && !Array.from(input.options).some((o) => o.value === inline)) input.append(new Option(inline.split(',')[0].replace(/["']/g, ''), inline));
        input.value = modified ? inline : '';
      } else if (def.kind === 'select') {
        input.options[0].textContent = `기본 (${computed})`;
        input.value = modified && Array.from(input.options).some((o) => o.value === inline) ? inline : '';
      } else {
        input.value = inline;
        input.placeholder = computed;
      }
    }
  }

  function renderSelection(sel) {
    if (!sel) {
      view.selectionId = null;
      view.fields.clear();
      els.props.innerHTML = '<p class="props__empty">클릭하면 링크용 투명 가리개를 건너뛰고 눈에 보이는 상자를 고르고, 더블클릭은 한 단계 안쪽, ⌘클릭은 가장 깊은 요소, 우클릭은 겹친 요소 목록에서 고릅니다. 선택한 요소는 끌어 옮기고, 핸들로 크기를 바꾸고, 방향키로 1px씩 움직입니다.</p>';
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
      li.title = c.undone ? '여기까지 다시 실행' : '여기까지만 유지';
      const time = c.at ? new Date(c.at).toTimeString().slice(0, 8) : '';
      if (c.lost) li.classList.add('change--lost');
      const flag = c.lost ? '복원 실패' : c.restored ? '복원' : '';
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
      els.diff.appendChild(Object.assign(doc.createElement('p'), { className: 'diff__empty', textContent: '원본과 달라진 곳이 없습니다.' }));
      return;
    }
    diff.forEach((d) => {
      const block = doc.createElement('div');
      block.className = 'diff__block';
      const head = doc.createElement('button');
      head.type = 'button';
      head.className = 'diff__head';
      head.title = '이 요소 선택';
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
    if (els.modeSeg) {
      els.modeSeg.addEventListener('click', (e) => {
        const b = e.target.closest('.seg__btn');
        if (b) call('setMode', b.dataset.mode);
      });
    }
    if (els.moveSeg) {
      els.moveSeg.addEventListener('click', (e) => {
        const b = e.target.closest('.seg__btn');
        if (b) call('setMoveMode', b.dataset.move);
      });
    }
    if (els.btnMeasure) els.btnMeasure.addEventListener('click', () => call('setMeasure', !(view.state && view.state.measure)));
    if (els.btnXray) els.btnXray.addEventListener('click', () => call('setXray', !(view.state && view.state.xray)));
    if (els.btnFocus) els.btnFocus.addEventListener('click', () => call('setFocus', !(view.state && view.state.focus)));
    if (els.btnPeek) els.btnPeek.addEventListener('click', () => call('setPeek', !(view.state && view.state.peek)));
    if (els.btnDiffView) els.btnDiffView.addEventListener('click', () => call('setDiffView', !(view.state && view.state.diffView)));
    if (els.btnUndo) els.btnUndo.addEventListener('click', () => call('undo'));
    if (els.btnRedo) els.btnRedo.addEventListener('click', () => call('redo'));
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
    if (keyboard) doc.addEventListener('keydown', onKeydown);
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
      els.btnPeek.textContent = state.peek ? '변경 다시 보기' : '원본 보기';
    }
    if (els.btnUndo) els.btnUndo.disabled = !state.canUndo;
    if (els.btnRedo) els.btnRedo.disabled = !state.canRedo;
    if (els.modeSeg) els.modeSeg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === state.mode));
    if (els.moveSeg) els.moveSeg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.move === state.moveMode));
  }

  // ---------- LLM 전달 ----------
  async function openHandoff() {
    const h = els.handoff;
    if (!h) return;
    let result;
    try {
      result = await bridge.call('getHandoff');
    } catch (err) {
      notice(`전달 묶음을 만들지 못했습니다: ${err.message}`);
      return;
    }
    view.handoff = result;
    h.text.value = result.markdown;
    const applied = view.state ? view.state.cursor : 0;
    h.summary.textContent = `적용된 변경 ${applied}건 · ${Math.round(result.markdown.length / 1024)}KB · ${result.json.htmlMode === 'full' ? '전체 HTML 포함' : '변경 요소만 포함'}`;
    h.dialog.showModal();
  }

  async function copyHandoff() {
    try {
      await navigator.clipboard.writeText(view.handoff.markdown);
      notice('클립보드에 복사했습니다. 에이전트에게 붙여 넣으세요.');
    } catch (err) {
      els.handoff.text.focus();
      els.handoff.text.select();
      notice(`클립보드 복사 실패: ${err.message}. 텍스트를 직접 복사하세요.`);
    }
  }

  // 대화상자 없이 변경 로그·요청·결과 HTML 묶음을 바로 복사한다.
  async function copyLogForLlm() {
    let result;
    try {
      result = await bridge.call('getHandoff');
    } catch (err) {
      notice(`전달 묶음을 만들지 못했습니다: ${err.message}`);
      return;
    }
    view.handoff = result;
    const applied = view.state ? view.state.cursor : 0;
    try {
      await navigator.clipboard.writeText(result.markdown);
      notice(`변경 ${applied}건과 결과 HTML을 LLM용 마크다운으로 복사했습니다.`);
    } catch (err) {
      notice(`클립보드 복사 실패: ${err.message}. "전달…"에서 텍스트를 직접 복사하세요.`);
    }
  }

  // 전달 묶음을 개발 서버(POST /handoff)로 보내 프로젝트의 handoffs/ 에 파일로 남긴다.
  async function sendToProject() {
    const url = await receiverStore.get();
    let result;
    try {
      result = await bridge.call('getHandoff');
    } catch (err) {
      notice(`전달 묶음을 만들지 못했습니다: ${err.message}`);
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
      if (!body || !body.ok) throw new Error((body && body.error) || '저장 실패');
      notice(`프로젝트에 저장했습니다: ${body.files.join(', ')}`);
    } catch (err) {
      notice(`수신기(${url})에 보내지 못했습니다: ${err.message}. make dev가 실행 중인지 확인하세요.`);
    }
  }

  async function clearLog() {
    const total = view.state ? view.state.total : 0;
    if (!total) return;
    if (!window.confirm(`변경 ${total}건을 모두 되돌리고 로그를 지울까요?`)) return;
    await call('clearLog');
    notice('로그를 지우고 변경을 모두 되돌렸습니다.');
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

  function onKeydown(e) {
    // 전달 대화상자가 열린 동안 단축키가 뒤의 문서를 바꾸면 대화상자 내용과 어긋난다.
    if (els.handoff && els.handoff.dialog.open) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
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
    renderSelection(state.selection);
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
