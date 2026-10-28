// 호스트(웹 작업실, 확장)와 무관한 편집 엔진. 대상 document/window 안에서 선택·이동·크기 조절·이력을 처리한다.
import { History } from './history.js';
import { ALL_PROPS, TEXT_PROP } from './props.js';
import { buildHandoff, describeOp, elementPath } from './handoff.js';
import { t } from './i18n.js';
import { isLetterKey } from './keys.js';

const COALESCE_MS = 1000;
const DRAG_THRESHOLD = 4;
// 요소 가장자리 30% 영역은 앞/뒤 삽입, 가운데는 안으로 삽입
const DROP_EDGE_RATIO = 0.3;
const AUTOSCROLL_ZONE = 48;
const AUTOSCROLL_STEP = 14;
const MIN_SIZE = 8;
const MAX_TREE_ROWS = 2000;
// 대화 참조용 다중 선택의 상한(주 선택 포함). 넘으면 가장 오래된 선택부터 버린다.
const MAX_SELECTION = 10;
// 선택 이름표에 붙일 개체 글자 길이.
const SELECTION_TEXT_LEN = 24;
const CHAT_STYLE_KEYS = ['display', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'gap', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border-radius'];
// DOM 변경이 잦은 페이지에서 트리 갱신을 묶어 보내는 대기 시간
const DOM_SETTLE_MS = 300;
// 새로고침 뒤 늦게 그려지는 요소를 기다려 복원을 다시 시도하는 시간
const RESTORE_RETRY_MS = 15000;
const UI_ATTR = 'data-fm-ui';
// 빈 요소가 absolute/fixed로 부모(또는 기준 상자)를 이 비율 이상 덮으면 클릭 가리개(mask)로 본다.
const MASK_ATTR = 'data-fm-mask';
const MASK_COVER_RATIO = 0.8;
const MASK_MIN_SIZE = 24;
const PICKER_MAX = 12;
// 측정 모드: 눈금자 두께와 거리 표시 색
const RULER_SIZE = 20;
const MEASURE_COLOR = '#e5484d';
// 분해 보기: 이름표를 붙이는 최소 크기
const XRAY_LABEL_MIN_W = 48;
const XRAY_LABEL_MIN_H = 18;
const REPLACED_TAGS = new Set(['img', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'canvas', 'svg', 'iframe', 'object', 'embed', 'picture']);
const NO_CHILDREN = new Set(['img', 'input', 'br', 'hr', 'textarea', 'select', 'video', 'audio', 'canvas', 'svg', 'iframe']);
const TREE_HIDDEN = new Set(['script', 'style', 'link', 'meta', 'title', 'noscript', 'template']);
// 클릭·드래그가 잡는 단위가 되는 태그. 글자 요소(p, h1, span…)는 배경·테두리가 없으면 상위 상자로 올라간다.
const UNIT_TAGS = new Set(['li', 'button', 'img', 'a', 'input', 'select', 'textarea', 'table', 'tr', 'td', 'th', 'figure', 'video', 'audio', 'canvas', 'svg', 'iframe', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'form', 'fieldset', 'details', 'summary', 'dialog', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'hr']);
// 선택 모드에서 대상 문서로 전달하지 않는 이벤트. 포인터·클릭·더블클릭은 전용 처리기가 직접 막는다.
// auxclick: 가운데 버튼 클릭은 click이 아니라 auxclick으로 와서 링크를 새 탭에 연다.
const SWALLOWED_EVENTS = ['mousedown', 'mouseup', 'auxclick', 'touchstart', 'touchend', 'submit', 'change', 'input', 'keypress', 'keyup'];
const ARROW_DELTAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const OVERLAY_CSS = `
:host { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; --fm-scale: 1; --fm-accent: #0d99ff; --fm-hover: #7c3aed; font: 11px/1 "SF Mono", Menlo, Consolas, monospace; }
.ov { position: absolute; left: 0; top: 0; box-sizing: border-box; pointer-events: none; }
.ov[hidden] { display: none; }
.ov--hover { outline: 1px dashed var(--fm-hover); outline-offset: -1px; background: rgba(124, 58, 237, 0.05); }
.ov--select { outline: 2px solid var(--fm-accent); outline-offset: -1px; background: rgba(13, 153, 255, 0.08); }
.ov--extra { outline-style: dashed; background: none; }
.ov--extra .tag { opacity: 0.85; }
.focus { position: absolute; left: 0; top: 0; pointer-events: none; }
.focus[hidden] { display: none; }
.dim { position: absolute; left: 0; top: 0; background: rgba(15, 15, 25, 0.45); }
.boxmodel { position: absolute; left: 0; top: 0; pointer-events: none; }
.marks { position: absolute; left: 0; top: 0; pointer-events: none; }
.mark { position: absolute; left: 0; top: 0; outline: 1.5px dashed #f59e0b; outline-offset: 1px; }
.dv { position: absolute; left: 0; top: 0; pointer-events: none; }
.dv__orig { position: absolute; left: 0; top: 0; border: 2px dashed #e5484d; background: rgba(229, 72, 77, 0.08); }
.dv__cur { position: absolute; left: 0; top: 0; border: 2px solid #16a34a; background: rgba(22, 163, 74, 0.10); }
.dv__tag { position: absolute; left: -2px; top: -2px; padding: 1px 5px; color: #fff; white-space: nowrap; transform: translateY(-100%) scale(calc(1 / var(--fm-scale))); transform-origin: 0 100%; }
.dv__orig .dv__tag { background: #e5484d; top: auto; bottom: -2px; transform: translateY(100%) scale(calc(1 / var(--fm-scale))); transform-origin: 0 0; }
.dv__cur .dv__tag { background: #16a34a; }
.dv__line { position: absolute; left: 0; top: 0; height: 2px; background: #f59e0b; transform-origin: 0 50%; }
.dv__line::after { content: ""; position: absolute; right: -2px; top: -4px; border: 5px solid transparent; border-left: 8px solid #f59e0b; border-right: 0; }
.dv__note { position: absolute; left: 0; top: 0; padding: 4px 7px; background: #fff; border: 1px solid #d0d0d8; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.15); white-space: nowrap; transform: scale(calc(1 / var(--fm-scale))); transform-origin: 0 0; line-height: 1.6; }
.dv__prop { color: #5c5c66; }
.dv__old { color: #b42318; text-decoration: line-through; }
.dv__new { color: #1e7a3a; font-weight: 700; }
.mark--preview { outline-color: #0d99ff; }
.mark--preview .mark__n { background: #0d99ff; }
.mark__n { position: absolute; right: -2px; top: -2px; padding: 1px 5px; border-radius: 8px; background: #f59e0b; color: #fff; font-weight: 700; white-space: nowrap; transform: translate(50%, -50%) scale(calc(1 / var(--fm-scale))); }
.band { position: absolute; left: 0; top: 0; }
.band--margin { background: rgba(124, 58, 237, 0.14); }
.band--padding { background: rgba(34, 197, 94, 0.16); }
.band__label { position: absolute; padding: 1px 5px; border-radius: 4px; color: #fff; white-space: nowrap; transform: translate(-50%, -50%) scale(calc(1 / var(--fm-scale))); }
.band--margin .band__label { background: #7c3aed; }
.band--padding .band__label { background: #16a34a; }
.ov--container { outline: 1px dashed var(--fm-accent); outline-offset: 2px; }
.ov--drop { background: var(--fm-accent); box-shadow: 0 0 0 1px #fff; }
.ov--ghost { background: rgba(13, 153, 255, 0.12); outline: 1px solid var(--fm-accent); }
.tag, .size { position: absolute; padding: 3px 6px; border-radius: 3px; color: #fff; white-space: nowrap; background: var(--fm-accent); transform: scale(calc(1 / var(--fm-scale))); }
.tag { left: 0; bottom: 100%; margin-bottom: 3px; transform-origin: 0 100%; }
.tag.is-inside { bottom: auto; top: 0; margin: 0; transform-origin: 0 0; }
.size { left: 50%; top: 100%; margin-top: 4px; transform-origin: 50% 0; translate: -50% 0; }
.ov--hover .tag { background: var(--fm-hover); }
.ov--container .tag { opacity: 0.85; }
.handle { position: absolute; width: 8px; height: 8px; background: #fff; border: 1.5px solid var(--fm-accent); border-radius: 1px; pointer-events: auto; transform: scale(calc(1 / var(--fm-scale))); }
.handle[data-dir="e"] { right: -4px; top: 50%; margin-top: -4px; cursor: ew-resize; }
.handle[data-dir="s"] { bottom: -4px; left: 50%; margin-left: -4px; cursor: ns-resize; }
.handle[data-dir="se"] { right: -4px; bottom: -4px; cursor: nwse-resize; }
.picker { position: absolute; left: 0; top: 0; min-width: 220px; max-width: 340px; background: #fff; color: #1d1d22; border: 1px solid #e2e2e8; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); pointer-events: auto; transform: scale(calc(1 / var(--fm-scale))); transform-origin: 0 0; overflow: hidden; }
.picker[hidden] { display: none; }
.picker__head { padding: 5px 8px; color: #9a9aa6; border-bottom: 1px solid #e2e2e8; font-size: 10px; }
.picker__row { display: flex; justify-content: space-between; gap: 8px; padding: 5px 8px; cursor: pointer; white-space: nowrap; }
.picker__row:hover { background: #f4f4f7; }
.picker__row.is-current { color: var(--fm-accent); }
.picker__row.is-mask { color: #9a9aa6; }
.picker__label { overflow: hidden; text-overflow: ellipsis; }
.picker__size { color: #9a9aa6; }
.xray { position: fixed; left: 0; top: 0; pointer-events: none; }
.xray[hidden] { display: none; }
.ruler { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 3; }
.ruler[hidden], .corner[hidden], .guide[hidden] { display: none; }
.corner { position: fixed; left: 0; top: 0; width: 20px; height: 20px; background: #fff; border-right: 1px solid #c9c9d1; border-bottom: 1px solid #c9c9d1; z-index: 4; }
.guide { position: absolute; left: 0; top: 0; pointer-events: none; }
.guide--v { width: 0; border-left: 1px dashed var(--fm-accent); }
.guide--h { height: 0; border-top: 1px dashed var(--fm-accent); }
.measure { position: absolute; left: 0; top: 0; pointer-events: none; }
.mline { position: absolute; background: #e5484d; }
.mlabel { position: absolute; padding: 2px 5px; background: #fff; color: #e5484d; border: 1px solid #e5484d; border-radius: 3px; white-space: nowrap; transform: translate(-50%, -50%) scale(calc(1 / var(--fm-scale))); }
.ov--hover.is-measure { outline: 1px solid #e5484d; }
.ov--hover.is-measure .tag { background: #e5484d; }
`;

// iframe 안(광고 등 다른 출처 문서)은 엔진이 닿지 않아 클릭이 그대로 링크로 간다. 선택 모드에서는 iframe이 클릭을 받지 않게 해 바깥 컨테이너가 잡히게 한다.
const PAGE_CSS = `
html[data-fm-mode="select"] * { cursor: default !important; user-select: none !important; }
html[data-fm-mode="select"] [data-fm-editing], html[data-fm-mode="select"] [data-fm-editing] * { cursor: text !important; user-select: text !important; -webkit-user-select: text !important; }
[data-fm-editing] { outline: 2px solid #f59e0b !important; outline-offset: 2px !important; background: rgba(245, 158, 11, 0.08) !important; }
html[data-fm-mode="select"] [data-fm-mask] { pointer-events: none !important; }
html[data-fm-mode="select"] iframe, html[data-fm-mode="select"] frame { pointer-events: none !important; }
[data-fm-dragging] { opacity: 0.35 !important; }
`;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pxLimit = (value, fallback) => (/px$/.test(value) ? parseFloat(value) : fallback);

// initialMode 'interact'는 패널이 붙기 전까지 페이지를 건드리지 않는 대기 상태다. blockNavigation은 iframe 미리보기처럼 이탈을 막아야 할 때만 켠다.
// rasterViaImage: 스크립트가 차단된 sandbox iframe 안에서는 canvas가 화면에 합성되지 않아, 그린 결과를 img로 옮겨 보여 준다.
export function createEngine({ doc, win, source = '', onChange = () => {}, onNotice = () => {}, getViewport, viewportLabel, autoScroll, initialMode = 'select', blockNavigation = true, rasterViaImage = false, modeKeys = () => true }) {
  const state = {
    mode: initialMode,
    moveMode: 'flow',
    selectedId: null,
    extraIds: [],
    // 선택한 요소의 {path, label, excerpt}. 페이지가 목록을 다시 그려 요소가 바뀌면 이것으로 새 요소를 찾는다.
    selRefs: new Map(),
    hoverId: null,
    elementCount: 0,
    nextId: 0,
    domTimer: 0,
    restoreStartedAt: 0,
    measure: false,
    xray: false,
    focus: false,
    peek: false,
    diffView: false,
    editing: null,
    hold: null,
    // 속성을 처음 바꾸기 직전의 계산값. 패널에서 "원래 → 지금"을 보여 주는 데만 쓴다.
    origins: new Map(),
    typeInv: null,
    preview: null,
    xrayRaf: 0,
    drag: null,
    resize: null,
    suppressClick: false,
    scrollRaf: 0,
    treeTruncated: false,
  };
  const ui = {};
  const uiRoots = [];
  const listeners = [];
  const readViewport = getViewport || (() => ({ key: 'window', width: win.innerWidth }));
  const labelViewport = viewportLabel || ((op) => t('op.width', { width: op.width }));
  const scroller = autoScroll || defaultAutoScroll;
  const history = new History({ apply: applyOp, revert: revertOp, onChange: onHistoryChange });
  const sumPx = (cs, keys) => keys.reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);

  // ---------- 요소 ----------
  function byId(id) {
    return id ? doc.querySelector(`[data-fm-id="${id}"]`) : null;
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('');
    return `${tag}${id}${classes}`;
  }

  function treeMeta(el) {
    const parts = [];
    if (el.id) parts.push(`#${el.id}`);
    if (el.classList.length) parts.push(Array.from(el.classList).map((c) => `.${c}`).join(''));
    if (!el.children.length) {
      const t = el.textContent.trim().replace(/\s+/g, ' ');
      if (t) parts.push(`"${t.length > 24 ? `${t.slice(0, 24)}…` : t}"`);
    }
    return parts.join(' ');
  }

  const canHoldChildren = (el) => !NO_CHILDREN.has(el.tagName.toLowerCase());

  function hasVisibleBox(el) {
    const cs = win.getComputedStyle(el);
    const bg = cs.backgroundColor;
    const alpha = bg.startsWith('rgba') ? parseFloat(bg.slice(bg.lastIndexOf(',') + 1)) : 1;
    if (bg !== 'transparent' && alpha > 0) return true;
    if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
    return ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((k) => parseFloat(cs[k]) > 0);
  }

  const isUnit = (el) => el === doc.body || UNIT_TAGS.has(el.tagName.toLowerCase()) || hasVisibleBox(el);

  // 포인터 아래 가장 깊은 요소에서 출발해 선택된 요소나 눈에 보이는 상자를 만날 때까지 올라간다.
  // withExtras: Shift+클릭으로 추가 선택된 요소도 멈춤 지점으로 본다. 그래야 글자 요소를 추가 선택한 뒤 같은 곳을 Shift+클릭해 뺄 수 있다.
  function grabUnit(hit, withExtras = false) {
    let cur = hit;
    let last = hit;
    while (cur && cur.dataset && cur.dataset.fmId) {
      if (cur.dataset.fmId === state.selectedId || isUnit(cur) || (withExtras && state.extraIds.includes(cur.dataset.fmId))) return cur;
      last = cur;
      cur = cur.parentElement;
    }
    return last;
  }

  const deepSelect = (e) => e.metaKey || e.ctrlKey;
  const isUiEvent = (e) => {
    const path = e.composedPath();
    return path.includes(ui.host) || uiRoots.some((r) => path.includes(r));
  };
  const isPageElement = (n) => n && n.nodeType === 1 && doc.body.contains(n) && !n.closest(`[${UI_ATTR}]`);

  // 링크용 클릭 가리개, 호버 마스크처럼 내용 없이 상자를 덮는 요소. 선택 모드에서는 투명하게 통과시킨다.
  function isMaskLike(el) {
    if (el.hasAttribute(MASK_ATTR)) return true;
    if (el === doc.body || REPLACED_TAGS.has(el.tagName.toLowerCase())) return false;
    if (el.children.length || el.textContent.trim()) return false;
    const cs = win.getComputedStyle(el);
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    if (r.width < MASK_MIN_SIZE || r.height < MASK_MIN_SIZE) return false;
    const ref = el.offsetParent || el.parentElement;
    if (!ref) return false;
    const rr = ref.getBoundingClientRect();
    return r.width >= rr.width * MASK_COVER_RATIO && r.height >= rr.height * MASK_COVER_RATIO;
  }

  function markMask(el) {
    if (!el.hasAttribute(MASK_ATTR)) el.setAttribute(MASK_ATTR, '');
  }

  // 점 아래에서 가리개와 작업실 UI를 제외한 가장 위 요소
  function elementAtPoint(x, y, exclude) {
    const stack = doc.elementsFromPoint(x, y);
    for (const n of stack) {
      if (!isPageElement(n)) continue;
      if (exclude && (n === exclude || exclude.contains(n))) continue;
      if (isMaskLike(n)) {
        markMask(n);
        continue;
      }
      return n;
    }
    return null;
  }

  function frameAtPoint(x, y) {
    if (x == null || y == null) return null;
    const frames = doc.querySelectorAll('iframe, frame');
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const f = frames[i];
      if (!doc.body.contains(f) || f.closest(`[${UI_ATTR}]`)) continue;
      const r = f.getBoundingClientRect();
      if (r.width && r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return f;
    }
    return null;
  }

  function targetElement(e) {
    if (isUiEvent(e)) return null;
    const t = e.target;
    const el = t && t.nodeType === 1 ? t : (t && t.parentElement) || null;
    if (!el || el === doc.documentElement || !doc.body.contains(el)) return null;
    let hit = el;
    // 선택 모드에서 iframe은 클릭을 받지 않으므로(PAGE_CSS), 그 지점에 iframe이 있으면 직접 찾아 고른다.
    const frame = frameAtPoint(e.clientX, e.clientY);
    if (frame) {
      ensureAncestorsIds(frame);
      return frame;
    }
    if (isMaskLike(el)) {
      markMask(el);
      hit = elementAtPoint(e.clientX, e.clientY) || el.parentElement;
      if (!hit || !doc.body.contains(hit)) return null;
    }
    ensureAncestorsIds(hit);
    return hit;
  }

  function ensureId(el) {
    if (!el.dataset.fmId) {
      el.dataset.fmId = `fm${state.nextId}`;
      state.nextId += 1;
      state.elementCount += 1;
    }
    return el.dataset.fmId;
  }

  // 요소와 그 아래 전체에 ID를 붙인다. 작업실 UI(data-fm-ui) 아래는 건너뛴다.
  function assignTree(root) {
    if (root.nodeType !== 1 || root.closest(`[${UI_ATTR}]`)) return;
    ensureId(root);
    root.querySelectorAll('*').forEach((el) => {
      if (!el.closest(`[${UI_ATTR}]`)) ensureId(el);
    });
  }

  // 이벤트로 잡힌 요소가 주입 뒤에 생겼을 수 있으므로 조상까지 ID를 보장한다.
  function ensureAncestorsIds(el) {
    for (let cur = el; cur && cur !== doc.documentElement; cur = cur.parentElement) ensureId(cur);
  }

  function assignIds() {
    // 이전 인스턴스가 남긴 ID와 겹치지 않게 새로 매긴다.
    doc.querySelectorAll('[data-fm-id]').forEach((el) => el.removeAttribute('data-fm-id'));
    state.nextId = 0;
    state.elementCount = 0;
    assignTree(doc.body);
  }

  // SPA처럼 주입 뒤에 그려지는 요소도 선택·이동할 수 있도록 추가된 노드에 ID를 붙이고 트리를 갱신한다.
  function onMutations(records) {
    let changed = false;
    records.forEach((r) => {
      if (r.addedNodes.length || r.removedNodes.length) changed = true;
      r.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && !n.closest(`[${UI_ATTR}]`)) assignTree(n);
      });
    });
    if (!changed) return;
    win.clearTimeout(state.domTimer);
    state.domTimer = win.setTimeout(onDomSettled, DOM_SETTLE_MS);
  }

  function onDomSettled() {
    state.domTimer = 0;
    // 변경을 먼저 다시 적용한다. 이동한 요소가 제자리로 돌아가야 이동 뒤에 기록한 선택 경로가 맞는다.
    retryLost();
    relocateSelection();
    state.elementCount = doc.querySelectorAll('[data-fm-id]').length;
    computeTypeInventory();
    updateOverlays();
    scheduleXray();
    renderDiffView();
    onChange({ type: 'dom' });
  }

  // ---------- 저장과 복원 ----------
  function exportOps() {
    return { ops: history.ops.map((op) => ({ ...op })), cursor: history.cursor };
  }

  // 표식(tag#id.class…)이 요소와 맞는지 본다. 표식은 클래스를 두 개까지만 적으므로 정확히 같지 않아도,
  // 태그와 id가 같고 적힌 클래스가 모두 있으면 같은 요소로 본다. LLM이 클래스를 빼고 적은 경우도 받아들인다.
  function labelMatches(el, label) {
    if (!label) return false;
    if (describe(el) === label) return true;
    const m = /^([a-z0-9-]+)(#[^.\s]+)?((?:\.[^.\s]+)*)$/i.exec(label.trim());
    if (!m || m[1].toLowerCase() !== el.tagName.toLowerCase()) return false;
    if (m[2] && m[2].slice(1) !== el.id) return false;
    if (!m[2] && el.id && !m[3]) return false;
    return m[3].split('.').filter(Boolean).every((c) => el.classList.contains(c));
  }

  function resolveByPath(path, label) {
    if (!path) return null;
    let el = null;
    try {
      el = doc.querySelector(path);
    } catch (_) {
      // 저장된 경로가 선택자로 성립하지 않으면(비정상 id 등) 복원 실패로 처리한다.
      return null;
    }
    if (!el || !doc.body.contains(el) || !labelMatches(el, label)) return null;
    ensureAncestorsIds(el);
    return el;
  }

  // 저장된 연산을 새 DOM의 요소에 연결한다. 경로와 요소 표식이 모두 맞을 때만 성공한다.
  function materialize(op) {
    if (op.kind === 'batch') return op.ops.every((child) => materialize(child));
    const el = findOpTarget(op);
    if (!el) return false;
    if (op.kind === 'style') {
      op.before = el.style.getPropertyValue(op.prop);
    } else if (op.kind === 'styles') {
      op.before = Object.fromEntries(Object.keys(op.after).map((p) => [p, el.style.getPropertyValue(p)]));
    } else if (op.kind === 'text') {
      if (!isTextLeaf(el)) return false;
      op.before = el.textContent;
    } else if (op.kind === 'move') {
      const toParent = resolveByPath(op.toPath, op.toLabel);
      if (!toParent || !canHoldChildren(toParent) || toParent === el || el.contains(toParent)) return false;
      const fromParent = el.parentElement;
      ensureId(fromParent);
      const siblings = Array.from(toParent.children).filter((c) => c !== el);
      op.from = { parent: fromParent.dataset.fmId, index: Array.from(fromParent.children).indexOf(el) };
      op.to = { parent: toParent.dataset.fmId, index: Math.min(op.to.index, siblings.length) };
      op.fromLabel = describe(fromParent);
      op.fromPath = elementPath(fromParent);
    }
    op.target = el.dataset.fmId;
    return true;
  }

  function restoreOps({ ops, cursor }) {
    ensureLive();
    state.restoreStartedAt = Date.now();
    let restored = 0;
    let lost = 0;
    (ops || []).forEach((saved) => {
      const op = { ...saved, restored: true, lost: false };
      if (materialize(op)) restored += 1;
      else {
        op.lost = true;
        lost += 1;
      }
      history.push(op);
    });
    history.goto(Math.min(cursor || 0, history.ops.length));
    return { restored, lost };
  }

  const targetsLive = (op) => (op.kind === 'batch' ? op.ops.every(targetsLive) : !!byId(op.target));

  // 대상 요소가 문서에 없는 변경을 경로로 새 요소에 다시 연결하고, 적용 중인 변경이면 다시 적용한다.
  // 복원 직후에는 늦게 그려진 요소를 기다리는 것이고, 그 뒤로는 페이지가 목록 등을 다시 그려(replaceChildren 등)
  // 요소가 바뀐 경우다. 순서대로 다시 적용해야 이동한 뒤에 기록한 경로도 맞는다.
  // 알림은 복원 직후에만 띄운다. 화면을 자주 다시 그리는 페이지에서는 갱신 때마다 일어나기 때문이다.
  function retryLost() {
    let fixed = 0;
    let changed = false;
    history.ops.forEach((op, i) => {
      if (!op.lost && targetsLive(op)) return;
      if (!materialize(op)) {
        if (!op.lost) {
          op.lost = true;
          changed = true;
        }
        return;
      }
      if (op.lost) fixed += 1;
      op.lost = false;
      changed = true;
      if (i < history.cursor) applyOp(op);
    });
    if (!changed) return;
    onChange({ type: 'history', kind: 'restore' });
    if (fixed && state.restoreStartedAt && Date.now() - state.restoreStartedAt <= RESTORE_RETRY_MS) onNotice(t('engine.reapplied', { n: fixed }));
  }

  function clearHistory() {
    ensureLive();
    history.goto(0);
    history.clear();
  }

  // ---------- 오버레이 ----------
  function mountOverlay() {
    const host = doc.createElement('fm-overlay');
    host.setAttribute(UI_ATTR, '');
    const root = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = OVERLAY_CSS;
    root.appendChild(style);
    ui.xray = doc.createElement('canvas');
    ui.xray.className = 'xray';
    ui.xray.hidden = true;
    root.appendChild(ui.xray);
    ui.xrayImg = rasterTwin(ui.xray);
    // innerHTML을 쓰지 않는다. Trusted Types를 강제하는 사이트에서는 문자열 HTML 대입이 막힌다.
    const span = (cls, attrs = {}) => {
      const el = doc.createElement('span');
      el.className = cls;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const box = (cls, children) => {
      const el = doc.createElement('div');
      el.className = `ov ${cls}`;
      el.hidden = true;
      children.forEach((child) => el.appendChild(child));
      root.appendChild(el);
      return el;
    };
    ui.host = host;
    ui.focus = doc.createElement('div');
    ui.focus.className = 'focus';
    ui.focus.hidden = true;
    ui.dims = [0, 1, 2, 3].map(() => {
      const d = doc.createElement('div');
      d.className = 'dim';
      ui.focus.appendChild(d);
      return d;
    });
    root.appendChild(ui.focus);
    ui.marks = doc.createElement('div');
    ui.marks.className = 'marks';
    root.appendChild(ui.marks);
    ui.dv = doc.createElement('div');
    ui.dv.className = 'dv';
    root.appendChild(ui.dv);
    ui.boxModel = doc.createElement('div');
    ui.boxModel.className = 'boxmodel';
    root.appendChild(ui.boxModel);
    ui.container = box('ov--container', [span('tag')]);
    ui.drop = box('ov--drop', []);
    ui.hover = box('ov--hover', [span('tag')]);
    // 추가 선택 상자는 주 선택 상자보다 먼저 만들어 겹칠 때 주 선택이 위에 그려진다.
    ui.extras = Array.from({ length: MAX_SELECTION - 1 }, () => box('ov--select ov--extra', [span('tag')]));
    ui.select = box('ov--select', [span('tag'), span('size'), span('handle', { 'data-dir': 'e' }), span('handle', { 'data-dir': 's' }), span('handle', { 'data-dir': 'se' })]);
    ui.ghost = box('ov--ghost', [span('tag')]);
    ui.picker = doc.createElement('div');
    ui.picker.className = 'picker';
    ui.picker.hidden = true;
    root.appendChild(ui.picker);
    const canvas = (cls) => {
      const c = doc.createElement('canvas');
      c.className = cls;
      c.hidden = true;
      root.appendChild(c);
      return c;
    };
    ui.rulerX = canvas('ruler ruler--x');
    ui.rulerXImg = rasterTwin(ui.rulerX);
    ui.rulerY = canvas('ruler ruler--y');
    ui.rulerYImg = rasterTwin(ui.rulerY);
    ui.corner = doc.createElement('div');
    ui.corner.className = 'corner';
    ui.corner.hidden = true;
    root.appendChild(ui.corner);
    ui.guides = ['v', 'v', 'h', 'h'].map((dir) => {
      const g = doc.createElement('div');
      g.className = `guide guide--${dir}`;
      g.hidden = true;
      root.appendChild(g);
      return g;
    });
    ui.measure = doc.createElement('div');
    ui.measure.className = 'measure';
    root.appendChild(ui.measure);
    ui.select.querySelectorAll('.handle').forEach((h) => h.addEventListener('pointerdown', onHandleDown));
    doc.documentElement.appendChild(host);

    const pageStyle = doc.createElement('style');
    pageStyle.setAttribute(UI_ATTR, '');
    pageStyle.textContent = PAGE_CSS;
    doc.head.appendChild(pageStyle);
    ui.pageStyle = pageStyle;
  }

  // 캔버스 대신 보여 줄 img 쌍둥이. rasterViaImage가 아니면 만들지 않는다.
  function rasterTwin(c) {
    if (!rasterViaImage) return null;
    const img = doc.createElement('img');
    img.className = c.className;
    img.hidden = true;
    img.alt = '';
    c.style.display = 'none';
    c.parentNode.insertBefore(img, c.nextSibling);
    return img;
  }

  function setCanvasHidden(key, hidden) {
    ui[key].hidden = hidden;
    const img = ui[`${key}Img`];
    if (img) img.hidden = hidden;
  }

  function present(key) {
    const img = ui[`${key}Img`];
    if (!img) return;
    const c = ui[key];
    img.style.width = c.style.width;
    img.style.height = c.style.height;
    img.src = c.toDataURL('image/png');
  }

  function placeBox(box, left, top, width, height) {
    box.hidden = false;
    box.style.transform = `translate(${left + win.scrollX}px, ${top + win.scrollY}px)`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  }

  function placeOverlay(box, id, withSize) {
    const el = byId(id);
    if (!el) {
      box.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    placeBox(box, r.left, r.top, r.width, r.height);
    const tag = box.querySelector('.tag');
    const size = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    tag.textContent = state.measure && !withSize ? `${describe(el)} · ${size}` : describe(el);
    tag.classList.toggle('is-inside', r.top + win.scrollY < 24);
    if (withSize) {
      box.querySelector('.size').textContent = state.measure
        ? `x ${Math.round(r.left + win.scrollX)} · y ${Math.round(r.top + win.scrollY)} · ${size}`
        : size;
    }
  }

  function updateOverlays() {
    // 이동하면 경로가 바뀌므로, 화면을 그릴 때마다 선택 요소의 위치 정보를 새로 적어 둔다.
    rememberSelection();
    placeOverlay(ui.select, state.selectedId, true);
    // 추가 선택 요소 위에서는 hover 상자를 숨긴다. 같은 자리에 점선 둘이 겹쳐 보이기 때문이다.
    const hover = state.hoverId && state.hoverId !== state.selectedId && !state.extraIds.includes(state.hoverId) ? state.hoverId : null;
    placeOverlay(ui.hover, hover, false);
    ui.extras.forEach((box, i) => placeOverlay(box, state.extraIds[i] || null, false));
    renderMarks();
    renderBoxModel(byId(state.selectedId));
    renderFocus(byId(state.selectedId));
    renderMeasure();
  }

  // ---------- 변경 표식 ----------
  // 적용 중인 변경이 있는 요소마다 주황 점선과 변경 번호를 붙여, 원래 페이지 상태로 오해하지 않게 한다.
  function renderMarks() {
    ui.marks.textContent = '';
    if (state.mode !== 'select' || state.peek || state.diffView) return;
    const byTarget = new Map();
    history.ops.slice(0, history.cursor).forEach((op, i) => {
      if (op.lost) return;
      (op.kind === 'batch' ? op.ops : [op]).forEach((child) => {
        if (!byTarget.has(child.target)) byTarget.set(child.target, []);
        byTarget.get(child.target).push(i + 1);
      });
    });
    // 미리보기 중인 제안 대상은 파란 점선으로 따로 표시한다.
    if (state.preview) {
      state.preview.op.ops.forEach((child) => {
        const el = byId(child.target);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const m = doc.createElement('div');
        m.className = 'mark mark--preview';
        m.style.cssText = `transform:translate(${r.left + win.scrollX}px,${r.top + win.scrollY}px);width:${r.width}px;height:${r.height}px`;
        const n = doc.createElement('span');
        n.className = 'mark__n';
        n.textContent = t('engine.proposalTag');
        m.appendChild(n);
        ui.marks.appendChild(m);
      });
    }
    byTarget.forEach((nums, id) => {
      const el = byId(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const m = doc.createElement('div');
      m.className = 'mark';
      m.style.cssText = `transform:translate(${r.left + win.scrollX}px,${r.top + win.scrollY}px);width:${r.width}px;height:${r.height}px`;
      const n = doc.createElement('span');
      n.className = 'mark__n';
      n.textContent = nums.length > 3 ? `${nums.slice(0, 3).join(',')}…` : nums.join(',');
      m.appendChild(n);
      ui.marks.appendChild(m);
    });
  }

  // ---------- 원본 보기와 차이 ----------
  // 이력은 그대로 두고 적용 중인 변경만 잠시 걷어 낸다. 편집을 시작하면 자동으로 원래대로 다시 적용한다.
  function applied() {
    return history.ops.slice(0, history.cursor).filter((op) => !op.lost);
  }

  function setPeek(on) {
    on = !!on;
    if (on === state.peek) return;
    const ops = applied();
    if (on) {
      for (let i = ops.length - 1; i >= 0; i -= 1) revertOp(ops[i]);
    } else {
      ops.forEach(applyOp);
    }
    state.peek = on;
    updateOverlays();
    scheduleXray();
    renderDiffView();
    onChange({ type: 'history', kind: 'move' });
  }

  // ---------- 페이지 위 차이 표시 ----------
  function setDiffView(on) {
    state.diffView = !!on;
    updateOverlays();
    renderDiffView();
    onChange({ type: 'mode' });
  }

  function docRect(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left + win.scrollX, top: r.top + win.scrollY, width: r.width, height: r.height };
  }

  // 원래 자리는 같은 태스크 안에서 변경을 걷어 내고 재어 본 뒤 바로 다시 적용해 얻는다. 그사이 화면은 그려지지 않는다.
  function measureOriginals(ids) {
    const ops = applied();
    const out = new Map();
    for (let i = ops.length - 1; i >= 0; i -= 1) revertOp(ops[i]);
    ids.forEach((id) => {
      const el = byId(id);
      if (el) out.set(id, docRect(el));
    });
    ops.forEach(applyOp);
    // 측정용으로 옮긴 노드 기록은 실제 DOM 변경이 아니므로 버린다.
    if (ui.observer) ui.observer.takeRecords();
    return out;
  }

  function renderDiffView() {
    if (!ui.dv) return;
    ui.dv.textContent = '';
    if (!state.diffView || state.peek || state.mode !== 'select') return;
    const diff = getDiff();
    if (!diff.length) return;
    const originals = measureOriginals(diff.map((d) => d.id));
    const box = (cls, r, tagText) => {
      const b = doc.createElement('div');
      b.className = cls;
      b.style.cssText = `transform:translate(${r.left}px,${r.top}px);width:${r.width}px;height:${r.height}px`;
      const t = doc.createElement('span');
      t.className = 'dv__tag';
      t.textContent = tagText;
      b.appendChild(t);
      ui.dv.appendChild(b);
    };
    diff.forEach((d, idx) => {
      const el = byId(d.id);
      if (!el) return;
      const cur = docRect(el);
      const orig = originals.get(d.id);
      const moved = orig && (Math.abs(orig.left - cur.left) > 2 || Math.abs(orig.top - cur.top) > 2);
      const resized = orig && (Math.abs(orig.width - cur.width) > 1 || Math.abs(orig.height - cur.height) > 1);
      if (orig && (moved || resized)) box('dv__orig', orig, t('engine.dvOrig', { n: idx + 1, w: Math.round(orig.width), h: Math.round(orig.height) }));
      box('dv__cur', cur, t('engine.dvCur', { n: idx + 1, w: Math.round(cur.width), h: Math.round(cur.height) }));
      if (moved) {
        const x1 = orig.left + orig.width / 2;
        const y1 = orig.top + orig.height / 2;
        const x2 = cur.left + cur.width / 2;
        const y2 = cur.top + cur.height / 2;
        const line = doc.createElement('div');
        line.className = 'dv__line';
        line.style.cssText = `transform:translate(${x1}px,${y1}px) rotate(${Math.atan2(y2 - y1, x2 - x1)}rad);width:${Math.hypot(x2 - x1, y2 - y1)}px`;
        ui.dv.appendChild(line);
      }
      // 속성 변화 말풍선: - 줄과 + 줄을 "속성 이전 → 이후" 한 줄로 합친다.
      const note = doc.createElement('div');
      note.className = 'dv__note';
      for (let i = 0; i < d.lines.length; i += 2) {
        const del = d.lines[i].text;
        const add = d.lines[i + 1] ? d.lines[i + 1].text : '';
        const sep = del.indexOf(': ');
        const prop = del.slice(0, sep);
        const row = doc.createElement('div');
        const p = Object.assign(doc.createElement('span'), { className: 'dv__prop', textContent: `${prop} ` });
        const o = Object.assign(doc.createElement('span'), { className: 'dv__old', textContent: del.slice(sep + 2) });
        const n = Object.assign(doc.createElement('span'), { className: 'dv__new', textContent: add.slice(add.indexOf(': ') + 2) });
        row.append(p, o, ' → ', n);
        note.appendChild(row);
      }
      note.style.left = `${cur.left + cur.width + 8}px`;
      note.style.top = `${cur.top}px`;
      ui.dv.appendChild(note);
      // 화면 오른쪽을 넘으면 상자 왼쪽에 붙인다.
      const nw = note.offsetWidth;
      // 말풍선이 보이는 화면 오른쪽 끝을 넘으면 상자 왼쪽에 붙이고, 그래도 모자라면 상자 아래로 내린다.
      const rightEdge = win.scrollX + doc.documentElement.clientWidth;
      if (cur.left + cur.width + 8 + nw > rightEdge) {
        const leftPos = cur.left - nw - 8;
        if (leftPos >= win.scrollX) note.style.left = `${leftPos}px`;
        else {
          note.style.left = `${Math.max(win.scrollX, rightEdge - nw - 4)}px`;
          note.style.top = `${cur.top + cur.height + 8}px`;
        }
      }
    });
  }

  function ensureLive() {
    if (state.peek) setPeek(false);
    if (state.preview) clearPreview();
  }

  // ---------- LLM 제안 ----------
  // 제안 ops: {kind:'style'|'text'|'move', path, label, prop?, value?, parentPath?, parentLabel?, index?}
  // 경로와 표식이 모두 맞는 요소에만 적용한다. 하나라도 못 찾으면 제안 전체를 거절한다.
  function buildProposal(id, summary, ops, reason = '') {
    const children = [];
    const errors = [];
    (ops || []).forEach((p, i) => {
      const el = resolveByPath(p.path, p.label);
      if (!el) {
        errors.push(t('engine.err.notFound', { n: i + 1, label: p.label || '?', path: p.path || '?' }));
        return;
      }
      if (p.kind === 'style') {
        if (!p.prop) {
          errors.push(t('engine.err.noProp', { n: i + 1 }));
          return;
        }
        children.push({ kind: 'style', ...opBase(el), prop: p.prop, before: el.style.getPropertyValue(p.prop), after: p.value || '' });
      } else if (p.kind === 'text') {
        if (!isTextLeaf(el) || !(p.value || '').trim()) {
          errors.push(t('engine.err.text', { n: i + 1 }));
          return;
        }
        children.push({ kind: 'text', ...opBase(el), before: el.textContent, after: p.value });
      } else if (p.kind === 'move') {
        const parent = resolveByPath(p.parentPath, p.parentLabel);
        if (!parent || parent === el || el.contains(parent) || !canHoldChildren(parent) || el === doc.body) {
          errors.push(t('engine.err.move', { n: i + 1 }));
          return;
        }
        const fromParent = el.parentElement;
        ensureId(fromParent);
        const siblings = Array.from(parent.children).filter((c) => c !== el);
        children.push({
          kind: 'move', ...opBase(el),
          from: { parent: fromParent.dataset.fmId, index: Array.from(fromParent.children).indexOf(el) },
          to: { parent: parent.dataset.fmId, index: Math.max(0, Math.min(p.index ?? siblings.length, siblings.length)) },
          fromLabel: describe(fromParent), toLabel: describe(parent), fromPath: elementPath(fromParent), toPath: elementPath(parent),
        });
      } else {
        errors.push(t('engine.err.kind', { n: i + 1, kind: p.kind }));
      }
    });
    if (errors.length || !children.length) return { errors: errors.length ? errors : [t('engine.err.empty')] };
    const vp = readViewport();
    return { op: { kind: 'batch', proposalId: id, summary: summary || '', reason: reason || '', label: t('op.proposalLabel', { summary: summary || id }), target: children[0].target, path: children[0].path, ops: children, viewport: vp.key, width: vp.width, at: Date.now() } };
  }

  function clearPreview() {
    if (!state.preview) return;
    revertOp(state.preview.op);
    state.preview = null;
    updateOverlays();
    renderDiffView();
  }

  function previewProposal(id, summary, ops, reason) {
    ensureLive();
    const built = buildProposal(id, summary, ops, reason);
    if (built.errors) return { ok: false, errors: built.errors };
    applyOp(built.op);
    state.preview = { id, op: built.op };
    updateOverlays();
    onChange({ type: 'mode' });
    return { ok: true };
  }

  function acceptProposal(id, summary, ops, reason) {
    let op = null;
    if (state.preview && state.preview.id === id) {
      op = state.preview.op;
      revertOp(op);
      state.preview = null;
    } else {
      ensureLive();
      const built = buildProposal(id, summary, ops, reason);
      if (built.errors) return { ok: false, errors: built.errors };
      op = built.op;
    }
    history.push(op);
    return { ok: true };
  }

  function rejectProposal(id) {
    if (state.preview && state.preview.id === id) clearPreview();
    onChange({ type: 'mode' });
    return { ok: true };
  }

  function chatSelection(el) {
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      label: describe(el),
      path: elementPath(el),
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      text: isTextLeaf(el) ? el.textContent.trim().slice(0, 200) : undefined,
      parent: el.parentElement && el.parentElement !== doc.documentElement ? { label: describe(el.parentElement), path: elementPath(el.parentElement) } : null,
      styles: Object.fromEntries(CHAT_STYLE_KEYS.map((k) => [k, cs.getPropertyValue(k)])),
    };
  }

  // 대화 요청에 함께 보낼 페이지 문맥. 페이지 글은 자료로만 쓰이도록 짧게 줄인다.
  function getChatContext() {
    const el = byId(state.selectedId);
    const selection = el ? chatSelection(el) : null;
    return {
      url: source,
      selection,
      selections: selectedElements().map((item) => {
        const { parent, ...fields } = chatSelection(item);
        return { id: item.dataset.fmId, excerpt: shortText(item), ...fields };
      }),
      applied: appliedCount(),
      diff: getDiff().map((d) => ({ label: d.label, path: d.currentPath || d.path, lines: d.lines.map((l) => `${l.sign} ${l.text}`) })),
    };
  }

  const showValue = (v) => (v === '' || v == null ? t('op.default') : v);

  // 요소별 순 변경: 같은 속성을 여러 번 바꿨으면 처음 값과 지금 값만, 이동은 처음 자리와 지금 자리만 남긴다.
  const flatten = (ops) => ops.flatMap((op) => (op.kind === 'batch' ? op.ops : [op]));

  function getDiff() {
    const byTarget = new Map();
    flatten(applied()).forEach((op) => {
      if (!byTarget.has(op.target)) byTarget.set(op.target, { label: op.label, path: op.path, props: new Map(), move: null });
      const entry = byTarget.get(op.target);
      const record = (prop, before, after) => {
        if (!entry.props.has(prop)) entry.props.set(prop, { before, after });
        else entry.props.get(prop).after = after;
      };
      if (op.kind === 'style') record(op.prop, op.before, op.after);
      else if (op.kind === 'text') record(TEXT_PROP, op.before, op.after);
      else if (op.kind === 'styles') Object.keys(op.after).forEach((p) => record(p, op.before[p], op.after[p]));
      else if (op.kind === 'move') {
        if (!entry.move) entry.move = { from: t('op.at', { parent: op.fromLabel, index: op.from.index + 1 }), fromKey: `${op.from.parent}:${op.from.index}` };
        entry.move.to = t('op.at', { parent: op.toLabel, index: op.to.index + 1 });
        entry.move.toKey = `${op.to.parent}:${op.to.index}`;
      }
    });
    const out = [];
    byTarget.forEach((entry, id) => {
      const lines = [];
      if (entry.move && entry.move.fromKey !== entry.move.toKey) {
        const pos = t('op.positionLabel');
        lines.push({ sign: '-', text: `${pos}: ${entry.move.from}` }, { sign: '+', text: `${pos}: ${entry.move.to}` });
      }
      entry.props.forEach(({ before, after }, prop) => {
        if ((before || '') === (after || '')) return;
        const name = prop === TEXT_PROP ? t('op.textLabel') : prop;
        lines.push({ sign: '-', text: `${name}: ${showValue(before)}` }, { sign: '+', text: `${name}: ${showValue(after)}` });
      });
      if (!lines.length) return;
      const el = byId(id);
      out.push({ id, label: entry.label, path: entry.path, currentPath: el ? elementPath(el) : null, lines });
    });
    return out;
  }

  function appliedCount() {
    return history.ops.slice(0, history.cursor).filter((op) => !op.lost).length;
  }

  // ---------- 집중 보기 ----------
  function setFocus(on) {
    state.focus = !!on;
    updateOverlays();
    onChange({ type: 'mode' });
  }

  // 선택 요소만 남기고 문서의 나머지를 네 개의 어두운 띠로 가린다.
  function renderFocus(el) {
    if (!state.focus || !el || el === doc.body) {
      ui.focus.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    const sx = win.scrollX;
    const sy = win.scrollY;
    const W = Math.max(doc.documentElement.scrollWidth, win.innerWidth);
    const H = Math.max(doc.documentElement.scrollHeight, win.innerHeight);
    const L = Math.max(0, r.left + sx);
    const T = Math.max(0, r.top + sy);
    const R = Math.min(W, r.right + sx);
    const B = Math.min(H, r.bottom + sy);
    const place = (d, x, y, w, h) => {
      d.style.cssText = `transform:translate(${x}px,${y}px);width:${Math.max(0, w)}px;height:${Math.max(0, h)}px`;
    };
    place(ui.dims[0], 0, 0, W, T);
    place(ui.dims[1], 0, B, W, H - B);
    place(ui.dims[2], 0, T, L, B - T);
    place(ui.dims[3], R, T, W - R, B - T);
    ui.focus.hidden = false;
  }

  // 선택 요소의 마진·패딩 영역을 띠로 칠하고 px 값을 적는다. 0인 변은 그리지 않는다.
  function renderBoxModel(el) {
    ui.boxModel.textContent = '';
    if (!el || el === doc.body) return;
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const sx = win.scrollX;
    const sy = win.scrollY;
    const num = (v) => Math.max(0, parseFloat(v) || 0);
    const m = { top: num(cs.marginTop), right: num(cs.marginRight), bottom: num(cs.marginBottom), left: num(cs.marginLeft) };
    const p = { top: num(cs.paddingTop), right: num(cs.paddingRight), bottom: num(cs.paddingBottom), left: num(cs.paddingLeft) };
    const b = { top: num(cs.borderTopWidth), right: num(cs.borderRightWidth), bottom: num(cs.borderBottomWidth), left: num(cs.borderLeftWidth) };
    const band = (kind, x, y, w, h, value, horizontal) => {
      if (value <= 0 || w <= 0 || h <= 0) return;
      const d = doc.createElement('div');
      d.className = `band band--${kind}`;
      d.style.cssText = `transform:translate(${x + sx}px,${y + sy}px);width:${w}px;height:${h}px`;
      const label = doc.createElement('span');
      label.className = 'band__label';
      label.textContent = String(Math.round(value));
      label.style.cssText = horizontal ? `left:${Math.min(16, w / 2)}px;top:50%` : `left:50%;top:${Math.min(16, h / 2)}px`;
      d.appendChild(label);
      ui.boxModel.appendChild(d);
    };
    const outerW = r.width + m.left + m.right;
    band('margin', r.left - m.left, r.top - m.top, outerW, m.top, m.top, true);
    band('margin', r.left - m.left, r.bottom, outerW, m.bottom, m.bottom, true);
    band('margin', r.left - m.left, r.top, m.left, r.height, m.left, false);
    band('margin', r.right, r.top, m.right, r.height, m.right, false);
    const il = r.left + b.left;
    const it = r.top + b.top;
    const iw = r.width - b.left - b.right;
    const ih = r.height - b.top - b.bottom;
    band('padding', il, it, iw, p.top, p.top, true);
    band('padding', il, it + ih - p.bottom, iw, p.bottom, p.bottom, true);
    band('padding', il, it + p.top, p.left, ih - p.top - p.bottom, p.left, false);
    band('padding', il + iw - p.right, it + p.top, p.right, ih - p.top - p.bottom, p.right, false);
  }

  // ---------- 분해 보기 ----------
  function setXray(on) {
    state.xray = !!on;
    setCanvasHidden('xray', !state.xray);
    // 토글 직후에는 바로 그린다. 탭이 뒤에 있으면 requestAnimationFrame이 돌지 않아 빈 화면이 남는다.
    renderXray();
    onChange({ type: 'mode' });
  }

  function scheduleXray() {
    if (!state.xray || state.xrayRaf) return;
    state.xrayRaf = win.requestAnimationFrame(() => {
      state.xrayRaf = 0;
      renderXray();
    });
  }

  // 화면 안 모든 요소의 윤곽을 깊이별 색으로 그리고, 눈에 보이는 상자에는 이름표를 붙인다.
  function renderXray() {
    if (!state.xray) return;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const ctx = setupCanvas(ui.xray, vw, vh);
    ctx.clearRect(0, 0, vw, vh);
    ctx.font = '9px Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    const walk = (el, depth) => {
      for (const child of el.children) {
        if (child.hasAttribute(UI_ATTR) || TREE_HIDDEN.has(child.tagName.toLowerCase())) continue;
        const r = child.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= vh && r.left <= vw;
        if (visible) {
          const hue = (depth * 47) % 360;
          const mask = isMaskLike(child);
          ctx.strokeStyle = mask ? 'rgba(120,120,130,0.5)' : `hsla(${hue}, 70%, 45%, 0.6)`;
          ctx.setLineDash(mask ? [3, 3] : []);
          ctx.strokeRect(Math.round(r.left) + 0.5, Math.round(r.top) + 0.5, Math.max(1, Math.round(r.width) - 1), Math.max(1, Math.round(r.height) - 1));
          if (!mask && r.width >= XRAY_LABEL_MIN_W && r.height >= XRAY_LABEL_MIN_H && isUnit(child)) {
            const text = describe(child);
            const tw = Math.min(ctx.measureText(text).width + 6, r.width);
            ctx.fillStyle = `hsla(${hue}, 70%, 45%, 0.9)`;
            ctx.fillRect(r.left, r.top, tw, 12);
            ctx.save();
            ctx.beginPath();
            ctx.rect(r.left, r.top, tw, 12);
            ctx.clip();
            ctx.fillStyle = '#fff';
            ctx.fillText(text, r.left + 3, r.top + 2);
            ctx.restore();
          }
        }
        walk(child, depth + 1);
      }
    };
    walk(doc.body, 0);
    present('xray');
  }

  // ---------- 측정 모드 ----------
  function setMeasure(on) {
    state.measure = !!on;
    ui.hover.classList.toggle('is-measure', state.measure);
    updateOverlays();
    onChange({ type: 'mode' });
  }

  function setupCanvas(c, w, h) {
    const dpr = win.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // 눈금은 페이지 좌표(스크롤 포함)로 적어 요소의 x/y와 맞춘다.
  function drawAxis(ctx, axis, length, scroll, band) {
    const w = axis === 'x' ? length : RULER_SIZE;
    const h = axis === 'x' ? RULER_SIZE : length;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillRect(0, 0, w, h);
    if (band) {
      ctx.fillStyle = 'rgba(13,153,255,0.28)';
      if (axis === 'x') ctx.fillRect(band[0], 0, band[1] - band[0], h);
      else ctx.fillRect(0, band[0], w, band[1] - band[0]);
    }
    ctx.strokeStyle = '#9a9aa6';
    ctx.fillStyle = '#5c5c66';
    ctx.font = '9px Menlo, monospace';
    ctx.lineWidth = 1;
    const offset = Math.round(scroll);
    for (let v = -(offset % 10); v <= length; v += 10) {
      const page = v + offset;
      const major = page % 100 === 0;
      const len = major ? 12 : page % 50 === 0 ? 8 : 4;
      ctx.beginPath();
      if (axis === 'x') {
        ctx.moveTo(v + 0.5, RULER_SIZE);
        ctx.lineTo(v + 0.5, RULER_SIZE - len);
      } else {
        ctx.moveTo(RULER_SIZE, v + 0.5);
        ctx.lineTo(RULER_SIZE - len, v + 0.5);
      }
      ctx.stroke();
      if (!major) continue;
      if (axis === 'x') ctx.fillText(String(page), v + 3, 9);
      else {
        ctx.save();
        ctx.translate(9, v + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.fillText(String(page), 0, 0);
        ctx.restore();
      }
    }
    ctx.strokeStyle = '#c9c9d1';
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(0, RULER_SIZE - 0.5);
      ctx.lineTo(w, RULER_SIZE - 0.5);
    } else {
      ctx.moveTo(RULER_SIZE - 0.5, 0);
      ctx.lineTo(RULER_SIZE - 0.5, h);
    }
    ctx.stroke();
  }

  function placeGuide(g, dir, pos, len) {
    g.hidden = false;
    if (dir === 'v') {
      g.style.transform = `translate(${pos}px, 0)`;
      g.style.height = `${len}px`;
    } else {
      g.style.transform = `translate(0, ${pos}px)`;
      g.style.width = `${len}px`;
    }
  }

  function addMeasureSegment(axis, from, to, at) {
    const len = to - from;
    if (len < 0.5) return;
    const sx = win.scrollX;
    const sy = win.scrollY;
    const line = doc.createElement('div');
    line.className = 'mline';
    const label = doc.createElement('span');
    label.className = 'mlabel';
    label.textContent = `${Math.round(len)}px`;
    if (axis === 'x') {
      line.style.cssText = `left:${from + sx}px;top:${at + sy}px;width:${len}px;height:1px`;
      label.style.cssText = `left:${from + len / 2 + sx}px;top:${at + sy}px`;
    } else {
      line.style.cssText = `left:${at + sx}px;top:${from + sy}px;width:1px;height:${len}px`;
      label.style.cssText = `left:${at + sx}px;top:${from + len / 2 + sy}px`;
    }
    ui.measure.append(line, label);
  }

  // 선택 요소(a)와 호버 요소(b) 사이 거리. 한쪽이 다른 쪽을 품으면 네 변의 안쪽 거리.
  function drawDistances(a, b) {
    const contains = (o, i) => i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom;
    if (contains(a, b) || contains(b, a)) {
      const outer = contains(a, b) ? a : b;
      const inner = outer === a ? b : a;
      const my = (inner.top + inner.bottom) / 2;
      const mx = (inner.left + inner.right) / 2;
      addMeasureSegment('x', outer.left, inner.left, my);
      addMeasureSegment('x', inner.right, outer.right, my);
      addMeasureSegment('y', outer.top, inner.top, mx);
      addMeasureSegment('y', inner.bottom, outer.bottom, mx);
      return;
    }
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const midY = overlapY > 0 ? (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 : (a.top + a.bottom) / 2;
    const midX = overlapX > 0 ? (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2 : (a.left + a.right) / 2;
    if (b.left >= a.right) addMeasureSegment('x', a.right, b.left, midY);
    else if (b.right <= a.left) addMeasureSegment('x', b.right, a.left, midY);
    if (b.top >= a.bottom) addMeasureSegment('y', a.bottom, b.top, midX);
    else if (b.bottom <= a.top) addMeasureSegment('y', b.bottom, a.top, midX);
  }

  function renderMeasure() {
    if (!ui.rulerX) return;
    const on = state.measure;
    setCanvasHidden('rulerX', !on);
    setCanvasHidden('rulerY', !on);
    ui.corner.hidden = !on;
    ui.guides.forEach((g) => { g.hidden = true; });
    ui.measure.textContent = '';
    if (!on) return;
    const sel = byId(state.selectedId);
    const hov = state.hoverId && state.hoverId !== state.selectedId ? byId(state.hoverId) : null;
    const selRect = sel ? sel.getBoundingClientRect() : null;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    drawAxis(setupCanvas(ui.rulerX, vw, RULER_SIZE), 'x', vw, win.scrollX, selRect ? [selRect.left, selRect.right] : null);
    drawAxis(setupCanvas(ui.rulerY, RULER_SIZE, vh), 'y', vh, win.scrollY, selRect ? [selRect.top, selRect.bottom] : null);
    present('rulerX');
    present('rulerY');
    if (!selRect) return;
    const docW = doc.documentElement.scrollWidth;
    const docH = doc.documentElement.scrollHeight;
    placeGuide(ui.guides[0], 'v', selRect.left + win.scrollX, docH);
    placeGuide(ui.guides[1], 'v', selRect.right + win.scrollX, docH);
    placeGuide(ui.guides[2], 'h', selRect.top + win.scrollY, docW);
    placeGuide(ui.guides[3], 'h', selRect.bottom + win.scrollY, docW);
    if (hov) drawDistances(selRect, hov.getBoundingClientRect());
  }

  function hideDragOverlays() {
    ui.ghost.hidden = true;
    ui.drop.hidden = true;
    ui.container.hidden = true;
  }

  // ---------- 이벤트 ----------
  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  }

  function installHooks() {
    doc.documentElement.setAttribute('data-fm-mode', state.mode);
    if (state.mode === 'select') releasePageFocus();
    listen(doc, 'keydown', onKeydown, true);
    listen(doc, 'keyup', onKeyup, true);
    listen(win, 'blur', () => holdInteract(false));
    listen(doc, 'pointerdown', onPointerDown, true);
    listen(doc, 'pointermove', onPointerMove, true);
    listen(doc, 'pointerup', onPointerUp, true);
    listen(doc, 'pointercancel', onPointerCancel, true);
    listen(doc, 'click', onClick, true);
    listen(doc, 'dblclick', onDblClick, true);
    listen(doc, 'contextmenu', onContextMenu, true);
    listen(doc, 'mouseover', onHover, true);
    listen(doc, 'mouseleave', () => { if (!state.drag) setHover(null); }, true);
    SWALLOWED_EVENTS.forEach((type) => listen(doc, type, swallowInSelectMode, true));
    listen(win, 'pointermove', onHandleMove);
    listen(win, 'pointerup', onHandleUp);
    listen(win, 'pointercancel', onHandleUp);
    listen(win, 'lostpointercapture', onHandleUp);
    // 선택 모드에서는 페이지 스크립트가 일으키는 이동(배너의 location 변경 등)도 막는다. 링크를 따라가려면 동작 모드로 바꾼다.
    if (win.navigation) {
      listen(win.navigation, 'navigate', (e) => {
        if (state.mode !== 'select' || !e.cancelable || e.hashChange || e.downloadRequest) return;
        e.preventDefault();
        onNotice(t('engine.navBlocked'));
      });
    }
    listen(win, 'scroll', () => { hidePicker(); updateOverlays(); scheduleXray(); }, { passive: true });
    listen(win, 'resize', () => { updateOverlays(); scheduleXray(); renderDiffView(); });
    const observer = new win.MutationObserver(onMutations);
    observer.observe(doc.body, { childList: true, subtree: true });
    ui.observer = observer;
    listeners.push(() => observer.disconnect());
  }

  const inEditing = (e) => !!(state.editing && e.composedPath().includes(state.editing.el));

  function swallowInSelectMode(e) {
    if (state.mode !== 'select' || isUiEvent(e) || inEditing(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    if (isUiEvent(e)) return;
    if (inEditing(e)) {
      // 편집 중인 버튼이 클릭으로 동작하지 않게 막는다. 캐럿 이동은 그대로 둔다.
      if (e.target.closest && e.target.closest('button, a[href]')) e.preventDefault();
      return;
    }
    if (state.mode === 'select') {
      e.preventDefault();
      e.stopPropagation();
      if (state.suppressClick) {
        state.suppressClick = false;
        return;
      }
      const hit = targetElement(e);
      if (e.shiftKey) {
        // 빈 곳이나 문서 바탕(body)에서 Shift+클릭은 놓친 클릭일 가능성이 커서 선택을 건드리지 않는다.
        const target = hit && (deepSelect(e) ? hit : grabUnit(hit, true));
        if (target && target !== doc.body) toggleSelection(target.dataset.fmId);
        return;
      }
      if (!hit) {
        select(null);
        return;
      }
      select((deepSelect(e) ? hit : grabUnit(hit)).dataset.fmId);
      return;
    }
    // 동작 미리보기 모드: 문서 이탈만 막는다. 이탈하면 요소 ID와 이력이 끊어진다.
    if (!blockNavigation) return;
    const link = e.target && typeof e.target.closest === 'function' ? e.target.closest('a[href]') : null;
    if (link) {
      e.preventDefault();
      onNotice(t('engine.navBlockedPreview'));
    }
  }

  function onDblClick(e) {
    if (state.mode !== 'select' || isUiEvent(e) || inEditing(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const hit = targetElement(e);
    if (!hit) return;
    const selected = byId(state.selectedId);
    // 이미 고른 글자 요소를 다시 더블클릭하면 문구 편집을 시작한다.
    if (selected && selected === hit && isTextLeaf(hit)) {
      editText(hit.dataset.fmId);
      return;
    }
    if (selected && selected !== hit && selected.contains(hit)) {
      let child = hit;
      while (child.parentElement !== selected) child = child.parentElement;
      select(child.dataset.fmId);
      return;
    }
    select(grabUnit(hit).dataset.fmId);
  }

  // Figma의 "아래 레이어 선택"처럼, 그 지점에 겹친 요소를 위에서부터 나열해 고르게 한다. 가리개도 목록에는 넣는다.
  function onContextMenu(e) {
    if (state.mode !== 'select' || isUiEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    const entries = [];
    doc.elementsFromPoint(x, y).forEach((n) => {
      if (!isPageElement(n) || n === doc.body) return;
      if (isMaskLike(n)) {
        markMask(n);
        return;
      }
      entries.push({ el: n, mask: false });
    });
    const masks = [];
    doc.querySelectorAll(`[${MASK_ATTR}]`).forEach((m) => {
      const r = m.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) masks.push({ el: m, mask: true });
    });
    // 목록이 길면 깊은 조상부터 자르고, 가리개 항목은 항상 남긴다.
    showPicker(x, y, [...entries.slice(0, Math.max(1, PICKER_MAX - masks.length)), ...masks]);
  }

  function showPicker(x, y, entries) {
    const p = ui.picker;
    p.textContent = '';
    if (!entries.length) {
      p.hidden = true;
      return;
    }
    const head = doc.createElement('div');
    head.className = 'picker__head';
    head.textContent = t('engine.pickerHead');
    p.appendChild(head);
    entries.forEach(({ el, mask }) => {
      ensureAncestorsIds(el);
      const r = el.getBoundingClientRect();
      const row = doc.createElement('div');
      row.className = `picker__row${mask ? ' is-mask' : ''}${el.dataset.fmId === state.selectedId ? ' is-current' : ''}`;
      const label = doc.createElement('span');
      label.className = 'picker__label';
      label.textContent = `${describe(el)}${mask ? t('engine.mask') : ''}`;
      const size = doc.createElement('span');
      size.className = 'picker__size';
      size.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
      row.append(label, size);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hidePicker();
        select(el.dataset.fmId);
      });
      p.appendChild(row);
    });
    p.hidden = false;
    p.style.transform = `translate(${x + win.scrollX + 2}px, ${y + win.scrollY + 2}px) scale(calc(1 / var(--fm-scale)))`;
  }

  function hidePicker() {
    if (ui.picker && !ui.picker.hidden) ui.picker.hidden = true;
  }

  function onHover(e) {
    if (state.mode !== 'select' || state.drag || isUiEvent(e)) return;
    const hit = targetElement(e);
    if (!hit) {
      setHover(null);
      return;
    }
    setHover((deepSelect(e) ? hit : grabUnit(hit)).dataset.fmId);
  }

  // ---------- 선택 ----------
  // 선택 순서(오래된 것부터). 주 선택이 가장 최근에 고른 요소로 마지막에 온다.
  const selectionIds = () => (state.selectedId ? [...state.extraIds, state.selectedId] : []);
  const selectedElements = () => selectionIds().map(byId).filter(Boolean);

  // ids의 마지막이 주 선택이고 나머지는 추가 선택이다. 문서에 없는 ID와 중복은 버린다.
  function setSelection(ids) {
    const live = [...new Set(ids)].filter((id) => byId(id)).slice(-MAX_SELECTION);
    state.selectedId = live.length ? live[live.length - 1] : null;
    state.extraIds = live.slice(0, -1);
    updateOverlays();
    onChange({ type: 'select' });
  }

  function select(id) {
    setSelection(id ? [id] : []);
  }

  function toggleSelection(id) {
    const ids = selectionIds();
    setSelection(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  // 같은 클래스의 개체가 여럿이면 이름만으로 구분되지 않아 글자 일부를 함께 보여 준다.
  const shortText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, SELECTION_TEXT_LEN);

  // 지금 문서에 있는 선택 요소의 위치 정보를 갱신한다. 사라진 요소의 정보는 relocateSelection이 쓰도록 남긴다.
  function rememberSelection() {
    const ids = selectionIds();
    [...state.selRefs.keys()].forEach((id) => { if (!ids.includes(id)) state.selRefs.delete(id); });
    ids.forEach((id) => {
      const el = byId(id);
      if (el) state.selRefs.set(id, { path: elementPath(el), label: describe(el), excerpt: shortText(el) });
    });
  }

  // 표식과 글자가 같은 요소가 문서에 하나뿐이면 그 요소. 목록이 다시 그려져 순서가 바뀐 요소를 찾을 때 쓴다.
  function uniqueByText(label, excerpt, taken = new Set()) {
    const tag = (/^[a-z0-9-]+/i.exec(label || '') || [])[0];
    if (!tag || !excerpt) return null;
    const same = [...doc.querySelectorAll(tag)].filter((el) => !taken.has(el) && labelMatches(el, label) && shortText(el) === excerpt);
    if (same.length !== 1) return null;
    ensureAncestorsIds(same[0]);
    return same[0];
  }

  // 사라진 선택 요소 대신 들어온 요소를 찾는다. 같은 경로에 같은 글자면 그 요소다. 목록 순서가 바뀌었을 수 있으므로,
  // 아니면 같은 표식과 같은 글자를 가진 요소가 하나뿐일 때 그 요소로 본다. 그것도 없으면 같은 경로의 요소를 쓴다.
  function relocate(ref, taken) {
    const atPath = resolveByPath(ref.path, ref.label);
    const free = atPath && !taken.has(atPath) ? atPath : null;
    if (free && shortText(free) === ref.excerpt) return free;
    return uniqueByText(ref.label, ref.excerpt, taken) || free;
  }

  // 변경을 연결할 요소. 목록에서 항목이 빠지면 경로가 당겨져 같은 경로에 다른 항목이 온다. 기록한 글자가 다르면
  // 같은 표식과 같은 글자를 가진 요소가 하나뿐일 때만 그 요소로 보고, 아니면 연결하지 않는다. 선택과 달리
  // 다른 요소에 변경을 적용하면 화면이 틀어지므로 같은 경로로 물러서지 않는다. 글자를 기록하지 않은 이전 이력은 경로만 본다.
  function findOpTarget(op) {
    const el = resolveByPath(op.path, op.label);
    if (op.excerpt == null || (el && shortText(el) === op.excerpt)) return el;
    return uniqueByText(op.label, op.excerpt);
  }

  // 페이지가 화면 일부를 다시 그리면(예: replaceChildren) 선택한 요소가 새 요소로 바뀐다. 새 요소를 찾아 선택을 이어 가고,
  // 찾지 못한 추가 선택은 조용히 뺀다. 선택이 하나도 남지 않을 때만 알린다.
  function relocateSelection() {
    const before = selectionIds();
    if (before.every((id) => byId(id))) return;
    const taken = new Set(before.map(byId).filter(Boolean));
    const next = before.map((id) => {
      if (byId(id)) return id;
      const ref = state.selRefs.get(id);
      const el = ref ? relocate(ref, taken) : null;
      if (!el) return null;
      taken.add(el);
      return ensureId(el);
    }).filter(Boolean);
    state.selectedId = next.length ? next[next.length - 1] : null;
    state.extraIds = next.slice(0, -1);
    if (!state.selectedId) onNotice(t('engine.selectionGone'));
  }

  // 대화 말풍선의 개체 표시에서 선택을 되살린다. id가 바뀌었을 수 있어 경로로도 찾고, 하나도 못 찾으면 선택을 건드리지 않는다.
  function selectTargets(items) {
    const list = (Array.isArray(items) ? items : []).filter(Boolean);
    // ID로 찾은 요소를 먼저 확정한다. 요소가 지워지면 형제의 nth-of-type 경로가 앞당겨져,
    // 경로로 찾은 요소가 다른 항목의 요소일 수 있기 때문이다. 그런 요소는 찾지 못한 것으로 센다.
    const byItem = list.map((item) => byId(item.id));
    const claimed = new Set(byItem.filter(Boolean));
    const ids = [];
    let missing = 0;
    list.forEach((item, i) => {
      let el = byItem[i];
      if (!el) {
        el = resolveByPath(item.path, item.label);
        if (el && claimed.has(el)) el = null;
        if (el) claimed.add(el);
      }
      if (!el) {
        missing += 1;
        return;
      }
      ids.push(el.dataset.fmId);
    });
    const found = new Set(ids).size;
    if (found) setSelection(ids);
    return { ok: found > 0, found, missing };
  }

  function selectParent() {
    const el = byId(state.selectedId);
    const parent = el && el.parentElement;
    if (parent && parent.dataset.fmId) select(parent.dataset.fmId);
  }

  function setHover(id) {
    if (state.hoverId === id) return;
    state.hoverId = id;
    updateOverlays();
  }

  function setMode(mode) {
    state.mode = mode;
    doc.documentElement.setAttribute('data-fm-mode', mode);
    if (mode === 'select') releasePageFocus();
    hidePicker();
    if (mode !== 'select' && state.editing) finishEdit(true);
    if (mode !== 'select') {
      // 선택 모드 밖에서는 측정·분해 표시도 거둔다. 패널이 닫힌 뒤 화면에 남으면 안 된다.
      state.measure = false;
      ui.hover.classList.remove('is-measure');
      state.xray = false;
      setCanvasHidden('xray', true);
      state.focus = false;
      state.diffView = false;
      ui.dv.textContent = '';
      // 선택 모드 밖에서 선택 표시나 핸들이 남아 있으면 사용자가 편집 중이라고 오해한다. 진행 중인 제스처도 끝낸다.
      if (state.drag) {
        const d = state.drag;
        state.drag = null;
        stopAutoScroll();
        if (d.phase !== 'pending') cancelDrag(d);
      }
      endResize();
      state.hoverId = null;
      state.selectedId = null;
      state.extraIds = [];
      updateOverlays();
    }
    onChange({ type: 'mode' });
  }

  function setMoveMode(mode) {
    state.moveMode = mode;
    onChange({ type: 'mode' });
  }

  function setScale(scale) {
    ui.host.style.setProperty('--fm-scale', scale);
  }

  // ---------- 변경 연산 ----------
  function writeStyle(el, prop, value) {
    if (value === '' || value == null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, value);
  }

  function placeElement(el, { parent, index }) {
    const parentEl = byId(parent);
    if (!parentEl) throw new Error(t('engine.err.container', { parent }));
    el.remove();
    parentEl.insertBefore(el, parentEl.children[index] || null);
  }

  function applyOp(op) {
    if (op.lost) return;
    if (op.kind === 'batch') {
      op.ops.forEach(applyOp);
      return;
    }
    const el = byId(op.target);
    if (!el) {
      onNotice(t('engine.applyLost', { label: op.label }));
      return;
    }
    if (op.kind === 'style' || op.kind === 'styles') {
      const cs = win.getComputedStyle(el);
      (op.kind === 'style' ? [op.prop] : Object.keys(op.after)).forEach((p) => {
        const key = `${op.target}|${p}`;
        if (!state.origins.has(key)) state.origins.set(key, cs.getPropertyValue(p));
      });
    }
    if (op.kind === 'style') writeStyle(el, op.prop, op.after);
    else if (op.kind === 'styles') Object.entries(op.after).forEach(([p, v]) => writeStyle(el, p, v));
    else if (op.kind === 'move') placeElement(el, op.to);
    else if (op.kind === 'text') el.textContent = op.after;
  }

  function revertOp(op) {
    if (op.lost) return;
    if (op.kind === 'batch') {
      for (let i = op.ops.length - 1; i >= 0; i -= 1) revertOp(op.ops[i]);
      return;
    }
    const el = byId(op.target);
    if (!el) {
      onNotice(t('engine.undoLost', { label: op.label }));
      return;
    }
    if (op.kind === 'style') writeStyle(el, op.prop, op.before);
    else if (op.kind === 'styles') Object.entries(op.before).forEach(([p, v]) => writeStyle(el, p, v));
    else if (op.kind === 'move') placeElement(el, op.from);
    else if (op.kind === 'text') el.textContent = op.before;
  }

  // ---------- 문구 편집 ----------
  // 자식 요소 없이 글자만 담은 요소만 편집한다. 자식이 섞인 상자를 고치면 구조가 깨질 수 있다.
  function isTextLeaf(el) {
    if (!el || el === doc.body || el.children.length) return false;
    if (REPLACED_TAGS.has(el.tagName.toLowerCase()) && el.tagName.toLowerCase() !== 'button') return false;
    return el.textContent.trim().length > 0;
  }

  function editText(id) {
    const el = byId(id);
    if (!el || !isTextLeaf(el)) {
      onNotice(t('engine.textOnly'));
      return;
    }
    ensureLive();
    if (state.editing) finishEdit(true);
    if (state.selectedId !== id) select(id);
    state.editing = { el, id, before: el.textContent };
    el.setAttribute('data-fm-editing', '');
    try {
      el.contentEditable = 'plaintext-only';
    } catch (_) {
      // plaintext-only를 모르는 브라우저는 일반 편집으로 대신한다.
      el.contentEditable = 'true';
    }
    el.addEventListener('blur', onEditBlur);
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    onChange({ type: 'mode' });
  }

  function insertAtCaret(text) {
    const sel = win.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = doc.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function onEditBlur() {
    if (state.editing) finishEdit(true);
  }

  function finishEdit(commit) {
    const ed = state.editing;
    if (!ed) return;
    state.editing = null;
    const { el, id, before } = ed;
    el.removeEventListener('blur', onEditBlur);
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-fm-editing');
    const after = el.textContent.replace(/\s*\n\s*/g, ' ');
    el.textContent = before;
    win.getSelection().removeAllRanges();
    if (commit && after !== before && after.trim()) {
      history.push({ kind: 'text', ...opBase(el), before, after });
    } else if (commit && !after.trim()) {
      onNotice(t('engine.textEmpty'));
    }
    updateOverlays();
    onChange({ type: 'mode' });
  }

  // ---------- 글자 목록 ----------
  // 페이지가 실제로 쓰는 글자 크기와 글꼴을 모아, 패널에서 단계로 고를 수 있게 한다.
  function computeTypeInventory() {
    const sizes = new Map();
    const fonts = new Map();
    let seen = 0;
    const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && seen < 4000) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || el.closest(`[${UI_ATTR}]`) || TREE_HIDDEN.has(el.tagName.toLowerCase())) continue;
      seen += 1;
      const cs = win.getComputedStyle(el);
      const size = Math.round(parseFloat(cs.fontSize) * 10) / 10;
      sizes.set(size, (sizes.get(size) || 0) + 1);
      fonts.set(cs.fontFamily, (fonts.get(cs.fontFamily) || 0) + 1);
    }
    const topSizes = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => s).sort((a, b) => a - b);
    const topFonts = [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f]) => f);
    state.typeInv = { sizes: topSizes, fonts: topFonts };
  }

  function onHistoryChange(op) {
    updateOverlays();
    scheduleXray();
    renderDiffView();
    onChange({ type: 'history', kind: op ? op.kind : 'clear' });
  }

  function opBase(el) {
    const vp = readViewport();
    return { target: el.dataset.fmId, label: describe(el), path: elementPath(el), excerpt: shortText(el), viewport: vp.key, width: vp.width, at: Date.now() };
  }

  function setStyle(id, prop, value) {
    ensureLive();
    const el = byId(id);
    if (!el) return;
    const now = Date.now();
    const last = history.last;
    const coalesce = last && history.atEnd && last.kind === 'style' && last.target === id && last.prop === prop && now - last.at < COALESCE_MS;
    if (coalesce) {
      history.amendLast({ after: value, at: now });
      return;
    }
    const before = el.style.getPropertyValue(prop);
    if (before === value) return;
    history.push({ kind: 'style', ...opBase(el), prop, before, after: value });
  }

  function togglePushRight() {
    const el = byId(state.selectedId);
    if (!el) return;
    setStyle(state.selectedId, 'margin-left', el.style.getPropertyValue('margin-left') === 'auto' ? '' : 'auto');
  }

  // position: relative + left/top 오프셋. static 요소는 relative로 바꾼다.
  function offsetOp(el, left, top) {
    const cs = win.getComputedStyle(el);
    const before = { left: el.style.getPropertyValue('left'), top: el.style.getPropertyValue('top') };
    const after = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
    if (cs.position === 'static') {
      before.position = el.style.getPropertyValue('position');
      after.position = 'relative';
    }
    return { before, after };
  }

  function currentOffset(el) {
    const cs = win.getComputedStyle(el);
    return { left: parseFloat(cs.left) || 0, top: parseFloat(cs.top) || 0 };
  }

  function nudge(dx, dy) {
    ensureLive();
    const el = byId(state.selectedId);
    if (!el || el === doc.body) return;
    const now = Date.now();
    const last = history.last;
    if (last && history.atEnd && last.kind === 'styles' && last.gesture === 'nudge' && last.target === el.dataset.fmId && now - last.at < COALESCE_MS) {
      const after = { ...last.after, left: `${(parseFloat(last.after.left) || 0) + dx}px`, top: `${(parseFloat(last.after.top) || 0) + dy}px` };
      history.amendLast({ after, at: now });
      return;
    }
    const cur = currentOffset(el);
    history.push({ kind: 'styles', ...opBase(el), gesture: 'nudge', ...offsetOp(el, cur.left + dx, cur.top + dy) });
  }

  function moveElement(el, toParentEl, beforeEl) {
    ensureLive();
    if (!el || !toParentEl || !toParentEl.dataset.fmId) return;
    if (el === doc.body) {
      onNotice(t('engine.moveBody'));
      return;
    }
    if (el === toParentEl || el.contains(toParentEl)) {
      onNotice(t('engine.moveSelf'));
      return;
    }
    if (!canHoldChildren(toParentEl)) {
      onNotice(t('engine.noChildren', { el: describe(toParentEl) }));
      return;
    }
    while (beforeEl === el) beforeEl = beforeEl.nextElementSibling;
    const siblings = Array.from(toParentEl.children).filter((c) => c !== el);
    const toIndex = beforeEl ? siblings.indexOf(beforeEl) : siblings.length;
    const fromParent = el.parentElement;
    ensureId(fromParent);
    const from = { parent: fromParent.dataset.fmId, index: Array.from(fromParent.children).indexOf(el) };
    const to = { parent: toParentEl.dataset.fmId, index: toIndex };
    if (from.parent === to.parent && from.index === to.index) return;
    history.push({ kind: 'move', ...opBase(el), from, to, fromLabel: describe(fromParent), toLabel: describe(toParentEl), fromPath: elementPath(fromParent), toPath: elementPath(toParentEl) });
  }

  // zone: 'before' | 'after' | 'inside' (refId 기준)
  function requestMove(id, refId, zone) {
    const el = byId(id);
    const ref = byId(refId);
    if (!el || !ref) return;
    if (zone === 'inside') moveElement(el, ref, null);
    else moveElement(el, ref.parentElement, zone === 'before' ? ref : ref.nextElementSibling);
  }

  function moveWithin(delta) {
    const el = byId(state.selectedId);
    const parent = el && el.parentElement;
    if (!el || !parent || el === doc.body) return;
    const all = Array.from(parent.children);
    const i = all.indexOf(el);
    const j = i + delta;
    if (j < 0 || j >= all.length) return;
    moveElement(el, parent, delta < 0 ? all[j] : all[j].nextElementSibling);
  }

  // ---------- 문서 안 드래그 ----------
  function onPointerDown(e) {
    if (isUiEvent(e) || inEditing(e)) return;
    // 편집 중인 요소 밖을 누르면 편집을 확정한다.
    if (state.editing) finishEdit(true);
    hidePicker();
    if (state.mode !== 'select' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    releasePageFocus();
    state.suppressClick = false;
    // Shift+클릭은 선택을 더하고 빼는 동작이라, 이어지는 끌기가 선택을 단일로 되돌리거나 요소를 옮기지 않게 드래그를 시작하지 않는다.
    if (e.shiftKey) return;
    const hit = targetElement(e);
    if (!hit || hit === doc.body) return;
    const el = deepSelect(e) ? hit : grabUnit(hit);
    if (el === doc.body) return;
    const free = (state.moveMode === 'free') !== e.altKey;
    state.drag = { phase: 'pending', id: el.dataset.fmId, free, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, target: null };
    hit.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (e.buttons === 0) {
      onPointerUp(e);
      return;
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.phase === 'pending') {
      if (Math.hypot(d.x - d.startX, d.y - d.startY) < DRAG_THRESHOLD) return;
      beginDrag(d);
      if (!state.drag) return;
    }
    updateDrag(d);
  }

  function onPointerUp(e) {
    const d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    state.drag = null;
    stopAutoScroll();
    if (d.phase === 'pending') return;
    finishDrag(d);
    state.suppressClick = true;
  }

  function onPointerCancel(e) {
    const d = state.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    state.drag = null;
    stopAutoScroll();
    if (d.phase !== 'pending') cancelDrag(d);
  }

  function beginDrag(d) {
    ensureLive();
    const el = byId(d.id);
    if (!el) {
      state.drag = null;
      return;
    }
    d.phase = 'active';
    if (state.selectedId !== d.id) select(d.id);
    setHover(null);
    const r = el.getBoundingClientRect();
    d.grabX = d.startX - r.left;
    d.grabY = d.startY - r.top;
    if (d.free) {
      d.start = currentOffset(el);
      history.push({ kind: 'styles', ...opBase(el), gesture: 'offset', ...offsetOp(el, d.start.left, d.start.top) });
      d.op = history.last;
      return;
    }
    el.setAttribute('data-fm-dragging', '');
    ui.ghost.style.width = `${r.width}px`;
    ui.ghost.style.height = `${r.height}px`;
    ui.ghost.querySelector('.tag').textContent = describe(el);
    ui.ghost.hidden = false;
  }

  function updateDrag(d) {
    const el = byId(d.id);
    if (!el) return;
    if (d.free) {
      if (history.last !== d.op) return;
      const after = { ...d.op.after, left: `${Math.round(d.start.left + d.x - d.startX)}px`, top: `${Math.round(d.start.top + d.y - d.startY)}px` };
      history.amendLast({ after, at: Date.now() });
    } else {
      ui.ghost.style.transform = `translate(${d.x - d.grabX + win.scrollX}px, ${d.y - d.grabY + win.scrollY}px)`;
      d.target = findDropTarget(d, el);
      showDropIndicator(d.target, el);
    }
    scheduleAutoScroll();
  }

  function finishDrag(d) {
    if (d.free) {
      if (history.last === d.op && d.x === d.startX && d.y === d.startY) history.discardLast();
      return;
    }
    const el = byId(d.id);
    if (el) el.removeAttribute('data-fm-dragging');
    hideDragOverlays();
    if (d.target) moveElement(el, d.target.container, d.target.beforeEl);
    else onNotice(t('engine.noDrop'));
  }

  function cancelDrag(d) {
    if (d.free) {
      if (history.last === d.op) history.discardLast();
      return;
    }
    const el = byId(d.id);
    if (el) el.removeAttribute('data-fm-dragging');
    hideDragOverlays();
  }

  function flowAxis(container) {
    const cs = win.getComputedStyle(container);
    if (cs.display.includes('flex')) return cs.flexDirection.startsWith('row') ? 'x' : 'y';
    if (cs.display.includes('grid')) return 'grid';
    return 'y';
  }

  // 커서가 요소의 어느 쪽에 있는지: 부모 흐름 축 기준 앞/뒤, 가운데는 안
  function edgeZone(el, parent, d, allowInside) {
    const r = el.getBoundingClientRect();
    const tx = (d.x - r.left) / Math.max(1, r.width);
    const ty = (d.y - r.top) / Math.max(1, r.height);
    const axis = flowAxis(parent);
    let t;
    if (axis === 'x') t = tx;
    else if (axis === 'y') t = ty;
    else t = Math.min(tx, 1 - tx) < Math.min(ty, 1 - ty) ? tx : ty;
    const edge = allowInside ? DROP_EDGE_RATIO : 0.5;
    if (t < edge) return 'before';
    if (t > 1 - edge) return 'after';
    return allowInside ? 'inside' : 'after';
  }

  function nearestInsertion(container, dragEl, d) {
    const kids = Array.from(container.children).filter((c) => c !== dragEl);
    kids.forEach(ensureId);
    if (!kids.length) return null;
    let best = null;
    let bestDist = Infinity;
    kids.forEach((kid) => {
      const r = kid.getBoundingClientRect();
      const dist = Math.hypot(d.x - (r.left + r.width / 2), d.y - (r.top + r.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = kid;
      }
    });
    const r = best.getBoundingClientRect();
    const axis = flowAxis(container);
    const tx = (d.x - r.left) / Math.max(1, r.width);
    const ty = (d.y - r.top) / Math.max(1, r.height);
    const t = axis === 'x' ? tx : axis === 'y' ? ty : (Math.abs(tx - 0.5) > Math.abs(ty - 0.5) ? tx : ty);
    return t < 0.5 ? best : best.nextElementSibling;
  }

  function findDropTarget(d, dragEl) {
    // 자동 스크롤 중 포인터가 화면 밖으로 나가도 가장 가까운 가장자리 위치에 놓을 수 있게 한다.
    const x = clamp(d.x, 1, win.innerWidth - 1);
    const y = clamp(d.y, 1, win.innerHeight - 1);
    const hovered = elementAtPoint(x, y, dragEl);
    if (!hovered) return null;
    ensureAncestorsIds(hovered);
    const parent = hovered.parentElement;
    const hasParent = parent && parent.dataset.fmId;
    // 같은 부모의 형제 위에서는 순서 변경만 한다. 카드가 카드 안으로 들어가는 사고를 막는다.
    const allowInside = canHoldChildren(hovered) && hovered.parentElement !== dragEl.parentElement;
    const zone = hasParent ? edgeZone(hovered, parent, d, allowInside) : 'inside';
    if (zone === 'inside') return { container: hovered, beforeEl: nearestInsertion(hovered, dragEl, d), axis: flowAxis(hovered) };
    if (!hasParent) return null;
    return { container: parent, beforeEl: zone === 'before' ? hovered : hovered.nextElementSibling, axis: flowAxis(parent) };
  }

  function showDropIndicator(target, dragEl) {
    if (!target) {
      ui.drop.hidden = true;
      ui.container.hidden = true;
      return;
    }
    const { container, beforeEl } = target;
    const cr = container.getBoundingClientRect();
    placeBox(ui.container, cr.left, cr.top, cr.width, cr.height);
    ui.container.querySelector('.tag').textContent = `→ ${describe(container)}`;

    const cs = win.getComputedStyle(container);
    const kids = Array.from(container.children).filter((c) => c !== dragEl);
    const ref = beforeEl && beforeEl !== dragEl ? beforeEl : null;
    const tail = !ref && kids.length ? kids[kids.length - 1] : null;
    const anchor = (ref || tail) ? (ref || tail).getBoundingClientRect() : null;
    if (target.axis === 'x') {
      const top = anchor ? anchor.top : cr.top + sumPx(cs, ['paddingTop', 'borderTopWidth']);
      const height = anchor ? anchor.height : cr.height - sumPx(cs, ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']);
      const left = ref ? anchor.left - 1 : tail ? anchor.right - 1 : cr.left + sumPx(cs, ['paddingLeft', 'borderLeftWidth']);
      placeBox(ui.drop, left, top, 2, height);
    } else {
      const left = anchor ? anchor.left : cr.left + sumPx(cs, ['paddingLeft', 'borderLeftWidth']);
      const width = anchor ? anchor.width : cr.width - sumPx(cs, ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']);
      const top = ref ? anchor.top - 1 : tail ? anchor.bottom - 1 : cr.top + sumPx(cs, ['paddingTop', 'borderTopWidth']);
      placeBox(ui.drop, left, top, width, 2);
    }
  }

  // 기본 자동 스크롤: 대상 창 자체를 스크롤한다. 화면의 포인터는 그대로이므로 좌표 보정은 0이다.
  function defaultAutoScroll(point) {
    let dir = 0;
    if (point.y < AUTOSCROLL_ZONE) dir = -1;
    else if (point.y > win.innerHeight - AUTOSCROLL_ZONE) dir = 1;
    if (!dir) return null;
    const before = win.scrollY;
    win.scrollBy(0, dir * AUTOSCROLL_STEP);
    return win.scrollY === before ? null : 0;
  }

  function scheduleAutoScroll() {
    if (!state.scrollRaf) state.scrollRaf = win.requestAnimationFrame(autoScrollTick);
  }

  function autoScrollTick() {
    state.scrollRaf = 0;
    const d = state.drag;
    if (!d || d.phase !== 'active') return;
    const adjust = scroller({ x: d.x, y: d.y });
    if (adjust === null) return;
    d.y += adjust;
    updateDrag(d);
  }

  function stopAutoScroll() {
    if (state.scrollRaf) win.cancelAnimationFrame(state.scrollRaf);
    state.scrollRaf = 0;
  }

  // ---------- 크기 조절 핸들 ----------
  function onHandleDown(e) {
    const el = byId(state.selectedId);
    if (!el || e.button !== 0 || state.mode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    ensureLive();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const dir = handle.dataset.dir;
    // content-box 요소는 패딩·테두리를 뺀 값이 width/height가 된다.
    const extraW = cs.boxSizing === 'border-box' ? 0 : sumPx(cs, ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']);
    const extraH = cs.boxSizing === 'border-box' ? 0 : sumPx(cs, ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']);
    const inline = (prop) => el.style.getPropertyValue(prop);
    const before = {};
    const after = {};
    if (dir.includes('e')) {
      before.width = inline('width');
      after.width = `${Math.round(r.width - extraW)}px`;
    }
    if (dir.includes('s')) {
      before.height = inline('height');
      after.height = `${Math.round(r.height - extraH)}px`;
    }
    history.push({ kind: 'styles', ...opBase(el), gesture: 'resize', before, after });
    state.resize = {
      op: history.last, dir, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      w: r.width, h: r.height, extraW, extraH, moved: false,
      // CSS의 min/max가 핸들로 정한 크기를 가로막지 않도록, 넘어서는 순간 같은 값으로 함께 덮어쓴다.
      limits: {
        'min-width': { bound: pxLimit(cs.minWidth, 0), below: true, inline: inline('min-width') },
        'max-width': { bound: pxLimit(cs.maxWidth, Infinity), below: false, inline: inline('max-width') },
        'min-height': { bound: pxLimit(cs.minHeight, 0), below: true, inline: inline('min-height') },
        'max-height': { bound: pxLimit(cs.maxHeight, Infinity), below: false, inline: inline('max-height') },
      },
    };
  }

  function applyLimit(rz, before, after, prop, target, cssValue) {
    const lim = rz.limits[prop];
    const blocked = lim.below ? target < lim.bound : target > lim.bound;
    if (blocked) {
      before[prop] = lim.inline;
      after[prop] = cssValue;
    } else if (prop in after) {
      after[prop] = lim.inline;
    }
  }

  function onHandleMove(e) {
    const rz = state.resize;
    if (!rz || e.pointerId !== rz.pointerId) return;
    // pointerup을 받지 못한 채 버튼이 떼어진 상태면 조절을 끝낸다. 그대로 두면 이후 마우스 이동이 크기를 계속 바꾼다.
    if (e.buttons === 0) {
      endResize();
      return;
    }
    if (history.last !== rz.op) return;
    const dx = e.clientX - rz.startX;
    const dy = e.clientY - rz.startY;
    const before = { ...rz.op.before };
    const after = { ...rz.op.after };
    const targetW = Math.max(MIN_SIZE, Math.round(rz.w + dx));
    let targetH = Math.max(MIN_SIZE, Math.round(rz.h + dy));
    // Shift: 모서리 핸들에서 가로세로 비율 유지
    if (e.shiftKey && rz.dir === 'se') targetH = Math.max(MIN_SIZE, Math.round(rz.h * (targetW / rz.w)));
    if (rz.dir.includes('e')) {
      const cssW = `${targetW - rz.extraW}px`;
      after.width = cssW;
      applyLimit(rz, before, after, 'min-width', targetW, cssW);
      applyLimit(rz, before, after, 'max-width', targetW, cssW);
    }
    if (rz.dir.includes('s')) {
      const cssH = `${targetH - rz.extraH}px`;
      after.height = cssH;
      applyLimit(rz, before, after, 'min-height', targetH, cssH);
      applyLimit(rz, before, after, 'max-height', targetH, cssH);
    }
    rz.moved = rz.moved || dx !== 0 || dy !== 0;
    history.amendLast({ before, after, at: Date.now() });
  }

  function endResize() {
    const rz = state.resize;
    if (!rz) return;
    state.resize = null;
    if (!rz.moved && history.last === rz.op) history.discardLast();
  }

  function onHandleUp(e) {
    const rz = state.resize;
    if (!rz || e.pointerId !== rz.pointerId) return;
    endResize();
  }

  // ---------- 키보드 ----------
  function isEditable(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  }

  // 편집 모드에서는 클릭을 막으므로(preventDefault) 브라우저가 초점을 옮기지 않는다. 네이버 검색창처럼 처음부터
  // 초점을 가진 페이지 입력란이 남아 있으면 단축키가 모두 그 입력란으로 가므로, 편집 모드에 들어가거나 페이지를 누를 때 초점을 뺀다.
  // 도크의 대화 입력창처럼 Shadow DOM 안에 있는 입력란은 doc.activeElement가 바깥 호스트를 가리키므로 안쪽까지 따라간다.
  function releasePageFocus() {
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    if (!active || active === doc.body || state.editing || !isEditable(active)) return;
    active.blur();
  }

  // 모드 단축키를 받을지. 글자를 입력하는 중이면 넘긴다. 초점이 버튼에 있어도 받는다:
  // Space를 떼는 keyup을 막으므로, 방금 누른 도크 버튼이 다시 눌리지 않는다.
  function modeKeyTarget(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || !modeKeys()) return false;
    return !(state.editing || isEditable(e.composedPath()[0]));
  }

  // Space를 누르는 동안만 페이지를 쓴다. 손을 떼면 선택과 보기 표시를 그대로 되살린다.
  function holdInteract(on) {
    if (on) {
      if (state.hold || state.mode !== 'select') return;
      state.hold = { selectedId: state.selectedId, extraIds: state.extraIds, measure: state.measure, xray: state.xray, focus: state.focus, diffView: state.diffView };
      setMode('interact');
      return;
    }
    const h = state.hold;
    if (!h) return;
    state.hold = null;
    setMode('select');
    if (h.measure) setMeasure(true);
    if (h.xray) setXray(true);
    if (h.focus) setFocus(true);
    if (h.diffView) setDiffView(true);
    if (h.selectedId && byId(h.selectedId)) setSelection([...h.extraIds, h.selectedId]);
  }

  function onKeyup(e) {
    if (e.key === ' ' && state.hold) {
      e.preventDefault();
      e.stopPropagation();
      holdInteract(false);
    }
  }

  function onKeydown(e) {
    if (e.key === ' ' && state.hold) {
      e.preventDefault();
      return;
    }
    if (isLetterKey(e, 'e') && !e.shiftKey && !e.repeat && modeKeyTarget(e)) {
      e.preventDefault();
      e.stopPropagation();
      holdInteract(false);
      setMode(state.mode === 'select' ? 'interact' : 'select');
      return;
    }
    if (state.mode !== 'select') return;
    if (e.key === ' ' && !e.repeat && modeKeyTarget(e)) {
      e.preventDefault();
      holdInteract(true);
      return;
    }
    if (state.editing && inEditing(e)) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finishEdit(false);
      } else if (e.key === ' ' && !e.isComposing) {
        // button 같은 요소는 스페이스를 "누르기"로 처리해 글자가 들어가지 않으므로 직접 넣는다.
        e.preventDefault();
        insertAtCaret(' ');
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !isEditable(e.composedPath()[0])) {
      const sel = byId(state.selectedId);
      if (sel && isTextLeaf(sel)) {
        e.preventDefault();
        editText(state.selectedId);
        return;
      }
    }
    // 도크의 입력란(Shadow DOM 안)에서 타이핑할 때는 단축키를 가로채지 않는다.
    if (isEditable(e.composedPath()[0])) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && isLetterKey(e, 'z')) {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (isEditable(e.target)) return;
    if (e.key === 'Escape') {
      if (state.peek) {
        setPeek(false);
        return;
      }
      if (ui.picker && !ui.picker.hidden) {
        hidePicker();
        return;
      }
      if (state.drag) {
        const d = state.drag;
        state.drag = null;
        stopAutoScroll();
        if (d.phase !== 'pending') cancelDrag(d);
        return;
      }
      select(null);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && state.selectedId) {
      e.preventDefault();
      selectParent();
      return;
    }
    if (ARROW_DELTAS[e.key] && state.selectedId && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = ARROW_DELTAS[e.key];
      nudge(dx * step, dy * step);
    }
  }

  // ---------- 상태 스냅샷 ----------
  function emptySpaceHint(el, cs) {
    const minH = parseFloat(cs.minHeight);
    if (!(minH > 0)) return null;
    const rect = el.getBoundingClientRect();
    if (Math.abs(rect.height - minH) > 1) return null;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const content = range.getBoundingClientRect();
    const frame = sumPx(cs, ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']);
    const empty = rect.height - frame - content.height;
    if (empty < 4) return null;
    return t('engine.hint.minHeight', { min: Math.round(minH), empty: Math.round(empty) });
  }

  function flowLabel(el) {
    const cs = win.getComputedStyle(el);
    if (cs.display.includes('flex')) return `flex · ${cs.flexDirection} · ${cs.justifyContent}`;
    if (cs.display.includes('grid')) return t('engine.grid', { n: cs.gridTemplateColumns.split(' ').length });
    return cs.display;
  }

  function selectionInfo(el) {
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const crumbs = [];
    for (let cur = el; cur && cur.dataset.fmId; cur = cur.parentElement) crumbs.unshift({ id: cur.dataset.fmId, tag: cur.tagName.toLowerCase(), label: describe(cur) });
    const parent = el.parentElement && el.parentElement.dataset.fmId ? el.parentElement : null;
    const fields = {};
    ALL_PROPS.forEach((prop) => { fields[prop] = { inline: el.style.getPropertyValue(prop), computed: cs.getPropertyValue(prop) }; });
    return {
      id: el.dataset.fmId,
      label: describe(el),
      dims: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
      x: Math.round(rect.left + win.scrollX),
      y: Math.round(rect.top + win.scrollY),
      hint: emptySpaceHint(el, cs),
      crumbs,
      parent: parent ? { label: describe(parent), flow: flowLabel(parent) } : null,
      pushRight: el.style.getPropertyValue('margin-left') === 'auto',
      editable: isTextLeaf(el),
      editing: !!(state.editing && state.editing.id === el.dataset.fmId),
      fields,
      snippet: treeMeta(el),
      changes: selectionChanges(el.dataset.fmId),
    };
  }

  // 선택 요소에서 원본과 달라진 속성. before는 처음 바꾸기 직전 값(계산값), beforeInline은 되돌릴 때 쓸 인라인 값이다.
  function selectionChanges(id) {
    const props = new Map();
    flatten(applied()).forEach((op) => {
      if (op.target !== id) return;
      const record = (prop, before, after) => {
        if (!props.has(prop)) props.set(prop, { prop, beforeInline: before || '', after: after || '' });
        else props.get(prop).after = after || '';
      };
      if (op.kind === 'style') record(op.prop, op.before, op.after);
      else if (op.kind === 'styles') Object.keys(op.after).forEach((p) => record(p, op.before[p], op.after[p]));
      else if (op.kind === 'text') record(TEXT_PROP, op.before, op.after);
    });
    return [...props.values()]
      .filter((c) => c.beforeInline !== c.after)
      .map((c) => ({ ...c, before: c.prop === TEXT_PROP ? c.beforeInline : (c.beforeInline || state.origins.get(`${id}|${c.prop}`) || '') }));
  }

  function buildTree() {
    const rows = [];
    state.treeTruncated = false;
    const walk = (el, depth) => {
      if (TREE_HIDDEN.has(el.tagName.toLowerCase())) return;
      if (rows.length >= MAX_TREE_ROWS) {
        state.treeTruncated = true;
        return;
      }
      rows.push({ id: ensureId(el), depth, tag: el.tagName.toLowerCase(), meta: treeMeta(el), draggable: el !== doc.body, canHold: canHoldChildren(el) });
      for (const child of el.children) walk(child, depth + 1);
    };
    walk(doc.body, 0);
    return rows;
  }

  function getState({ tree = false } = {}) {
    const el = byId(state.selectedId);
    return {
      source,
      elementCount: state.elementCount,
      mode: state.mode,
      holding: !!state.hold,
      moveMode: state.moveMode,
      measure: state.measure,
      xray: state.xray,
      focus: state.focus,
      selection: el ? selectionInfo(el) : null,
      selections: selectedElements().map((item) => ({ id: item.dataset.fmId, label: describe(item), path: elementPath(item), excerpt: shortText(item) })),
      changes: history.ops.map((op, i) => ({ n: i + 1, at: op.at, label: op.label, desc: describeOp(op), vp: labelViewport(op), undone: i >= history.cursor, restored: !!op.restored, lost: !!op.lost })),
      cursor: history.cursor,
      total: history.ops.length,
      applied: appliedCount(),
      peek: state.peek,
      diffView: state.diffView,
      previewId: state.preview ? state.preview.id : null,
      typeScale: state.typeInv ? state.typeInv.sizes : [],
      fonts: state.typeInv ? state.typeInv.fonts : [],
      diff: getDiff(),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      tree: tree ? buildTree() : undefined,
      treeTruncated: state.treeTruncated,
    };
  }

  function getHandoff(options = {}) {
    // 원본 보기 중이면 결과 HTML이 원본이 되므로 잠시 다시 적용한 상태로 만든다.
    const wasPeek = state.peek;
    if (wasPeek) setPeek(false);
    const result = buildHandoff({ sourceName: source, ops: history.ops, cursor: history.cursor, doc, viewportLabel: labelViewport, byId, htmlMode: options.htmlMode, diff: getDiff() });
    if (wasPeek) setPeek(true);
    return result;
  }

  // ---------- 수명 ----------
  function init() {
    assignIds();
    mountOverlay();
    installHooks();
    computeTypeInventory();
    onChange({ type: 'load' });
  }

  function destroy() {
    stopAutoScroll();
    win.clearTimeout(state.domTimer);
    if (state.xrayRaf) win.cancelAnimationFrame(state.xrayRaf);
    listeners.splice(0).forEach((off) => off());
    ui.host.remove();
    ui.pageStyle.remove();
    doc.documentElement.removeAttribute('data-fm-mode');
    doc.querySelectorAll('[data-fm-id]').forEach((el) => el.removeAttribute('data-fm-id'));
    doc.querySelectorAll(`[${MASK_ATTR}]`).forEach((el) => el.removeAttribute(MASK_ATTR));
  }

  // 도크처럼 페이지 안에 띄운 작업실 UI를 등록해 선택·드래그 대상에서 제외한다.
  function registerUiRoot(el) {
    uiRoots.push(el);
  }

  return {
    init, destroy, select, selectParent, setMode, holdInteract, setMoveMode, setMeasure, setXray, setFocus, setScale, setStyle, registerUiRoot, togglePushRight, nudge, moveWithin, requestMove,
    undo: () => { ensureLive(); history.undo(); }, redo: () => { ensureLive(); history.redo(); }, goto: (n) => { ensureLive(); history.goto(n); },
    setPeek, getDiff, setDiffView, editText,
    previewProposal, acceptProposal, rejectProposal, getChatContext, selectTargets,
    refresh: updateOverlays, getState, getHandoff, exportOps, restoreOps, clearHistory,
    get selectedId() { return state.selectedId; },
  };
}
